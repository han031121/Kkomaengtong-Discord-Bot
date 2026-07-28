import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
    ButtonInteraction,
    ChatInputCommandInteraction,
    Message,
    ModalSubmitInteraction,
} from "discord.js";

import type { EvaluatedGuess, GameStatus, TileState, WordleGame } from "./game.js";

export interface WordleSession {
    game: WordleGame;
    panelMessage: Message | undefined;
    privateResponseInteraction:
        ButtonInteraction | ChatInputCommandInteraction | ModalSubmitInteraction | undefined;
    privateResponseMessageId: string | undefined;
    resultShared: boolean;
}

type WordleServerState = Omit<WordleSession, "game">;

interface StoredWordleServerState extends WordleServerState {
    guildId: string;
    printDate: string;
    userId: string;
}

export interface WordleSessionStoreOptions {
    databasePath?: string;
}

export interface WordleRecentPlayer {
    userId: string;
    game: WordleGame;
    activityOrder: number;
}

export interface WordleRecentPlayers {
    players: readonly WordleRecentPlayer[];
    totalPlayers: number;
}

export interface WordlePublicStatusPanel {
    guildId: string;
    channelId: string;
    messageId: string;
    printDate: string;
}

interface PersistedWordleGame {
    puzzle_id: number;
    solution: string;
    puzzle_number: number;
    guesses_json: string;
    status: string;
}

interface PersistedRecentPlayer extends PersistedWordleGame {
    user_id: string;
    last_activity_order: number;
}

interface PersistedPlayerCount {
    player_count: number;
}

interface PersistedGuildId {
    guild_id: string;
}

interface PersistedPublicStatusPanel {
    guild_id: string;
    channel_id: string;
    message_id: string;
    print_date: string;
}

function isTileState(value: unknown): value is TileState {
    return value === "absent" || value === "present" || value === "correct";
}

function isTileStates(value: unknown): value is readonly TileState[] {
    return (
        Array.isArray(value) &&
        value.length === 5 &&
        value.every((tile: unknown) => isTileState(tile))
    );
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function parseGuesses(value: string): readonly EvaluatedGuess[] {
    let parsedValue: unknown;

    try {
        parsedValue = JSON.parse(value);
    } catch (error) {
        throw new Error("SQLite에 저장된 Wordle 추측 기록이 올바른 JSON이 아닙니다.", {
            cause: error,
        });
    }

    if (!Array.isArray(parsedValue)) {
        throw new Error("SQLite에 저장된 Wordle 추측 기록이 배열이 아닙니다.");
    }

    return parsedValue.map((guess: unknown) => {
        if (
            !isUnknownRecord(guess) ||
            typeof guess.word !== "string" ||
            !/^[a-z]{5}$/.test(guess.word) ||
            !isTileStates(guess.tiles)
        ) {
            throw new Error("SQLite에 저장된 Wordle 추측 기록 형식이 올바르지 않습니다.");
        }

        return {
            word: guess.word,
            tiles: guess.tiles,
        };
    });
}

function parseGameStatus(value: string): GameStatus {
    if (value === "playing" || value === "won" || value === "lost") {
        return value;
    }

    throw new Error(`SQLite에 저장된 Wordle 게임 상태가 올바르지 않습니다: ${value}`);
}

export class WordleSessionStore {
    private readonly serverStates = new Map<string, StoredWordleServerState>();
    private readonly database: DatabaseSync;
    private databaseClosed = false;

    public constructor(options: WordleSessionStoreOptions = {}) {
        const requestedPath = options.databasePath ?? ":memory:";
        const databasePath = requestedPath === ":memory:" ? requestedPath : resolve(requestedPath);

        if (databasePath !== ":memory:") {
            mkdirSync(dirname(databasePath), { recursive: true });
        }

        this.database = new DatabaseSync(databasePath);
        this.database.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 5000;

            CREATE TABLE IF NOT EXISTS wordle_games (
                user_id TEXT NOT NULL,
                print_date TEXT NOT NULL,
                puzzle_id INTEGER NOT NULL,
                solution TEXT NOT NULL,
                puzzle_number INTEGER NOT NULL,
                guesses_json TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('playing', 'won', 'lost')),
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, print_date)
            );

            CREATE TABLE IF NOT EXISTS wordle_input_activity (
                order_id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                print_date TEXT NOT NULL,
                user_id TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS wordle_input_activity_recent
            ON wordle_input_activity (guild_id, print_date, order_id DESC);

            CREATE TABLE IF NOT EXISTS wordle_guild_participants (
                guild_id TEXT NOT NULL,
                print_date TEXT NOT NULL,
                user_id TEXT NOT NULL,
                last_activity_order INTEGER NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (guild_id, print_date, user_id)
            );

            CREATE INDEX IF NOT EXISTS wordle_guild_participants_recent
            ON wordle_guild_participants (
                guild_id,
                print_date,
                last_activity_order DESC
            );

            INSERT INTO wordle_guild_participants (
                guild_id,
                print_date,
                user_id,
                last_activity_order,
                updated_at
            )
            SELECT
                guild_id,
                print_date,
                user_id,
                MAX(order_id),
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            FROM wordle_input_activity
            GROUP BY guild_id, print_date, user_id
            ON CONFLICT (guild_id, print_date, user_id) DO NOTHING;

            CREATE TABLE IF NOT EXISTS wordle_public_status_panels (
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                print_date TEXT NOT NULL,
                PRIMARY KEY (guild_id, channel_id)
            );
        `);
    }

    public get(userId: string, printDate: string, guildId: string): WordleSession | undefined {
        const game = this.loadGame(userId, printDate);

        if (game === undefined) {
            return undefined;
        }

        const serverState = this.serverStates.get(this.createServerKey(userId, printDate, guildId));

        return {
            game,
            panelMessage: serverState?.panelMessage,
            privateResponseInteraction: serverState?.privateResponseInteraction,
            privateResponseMessageId: serverState?.privateResponseMessageId,
            resultShared: serverState?.resultShared ?? false,
        };
    }

    public set(userId: string, printDate: string, guildId: string, session: WordleSession): void {
        this.saveGame(userId, printDate, session.game);
        this.storeServerState(userId, printDate, guildId, session);
    }

    public registerGuildParticipant(userId: string, printDate: string, guildId: string): number {
        return this.runTransaction(() =>
            this.saveGuildParticipantActivity(userId, printDate, guildId),
        );
    }

    public recordValidGuess(
        userId: string,
        printDate: string,
        guildId: string,
        session: WordleSession,
    ): number {
        const activityOrder = this.runTransaction(() => {
            this.saveGame(userId, printDate, session.game);
            return this.saveGuildParticipantActivity(userId, printDate, guildId);
        });

        this.storeServerState(userId, printDate, guildId, session);
        return activityOrder;
    }

    public listServerGuildIds(userId: string, printDate: string): readonly string[] {
        return [...this.serverStates.values()]
            .filter((state) => state.userId === userId && state.printDate === printDate)
            .map((state) => state.guildId);
    }

    public listParticipantGuildIds(userId: string, printDate: string): readonly string[] {
        const rows = this.database
            .prepare(
                `
                    SELECT guild_id
                    FROM wordle_guild_participants
                    WHERE user_id = ? AND print_date = ?
                    ORDER BY guild_id
                `,
            )
            .all(userId, printDate) as unknown as PersistedGuildId[];

        return rows.map((row) => row.guild_id);
    }

    public setSharedPanelMessage(
        userId: string,
        printDate: string,
        guildId: string,
        message: Message,
    ): void {
        const key = this.createServerKey(userId, printDate, guildId);
        const state = this.serverStates.get(key);

        if (state === undefined) {
            return;
        }

        this.serverStates.set(key, {
            ...state,
            panelMessage: message,
        });
    }

    public getRecentPlayers(
        guildId: string,
        printDate: string,
        limit: number,
    ): WordleRecentPlayers {
        if (!Number.isSafeInteger(limit) || limit < 1) {
            throw new RangeError("최근 Wordle 사용자 조회 수는 1 이상의 정수여야 합니다.");
        }

        const rows = this.database
            .prepare(
                `
                    SELECT
                        participant.user_id,
                        participant.last_activity_order,
                        game.puzzle_id,
                        game.solution,
                        game.puzzle_number,
                        game.guesses_json,
                        game.status
                    FROM wordle_guild_participants AS participant
                    INNER JOIN wordle_games AS game
                        ON game.user_id = participant.user_id
                        AND game.print_date = participant.print_date
                    WHERE participant.guild_id = ? AND participant.print_date = ?
                    ORDER BY participant.last_activity_order DESC
                    LIMIT ?
                `,
            )
            .all(guildId, printDate, limit) as unknown as PersistedRecentPlayer[];
        const countRow = this.database
            .prepare(
                `
                    SELECT COUNT(*) AS player_count
                    FROM wordle_guild_participants AS participant
                    INNER JOIN wordle_games AS game
                        ON game.user_id = participant.user_id
                        AND game.print_date = participant.print_date
                    WHERE participant.guild_id = ? AND participant.print_date = ?
                `,
            )
            .get(guildId, printDate) as unknown as PersistedPlayerCount;

        const players = rows.map((row) => {
            if (!Number.isSafeInteger(row.last_activity_order)) {
                throw new Error("SQLite에 저장된 Wordle 참여 활동 순서 정보가 올바르지 않습니다.");
            }

            return {
                userId: row.user_id,
                game: this.parseGame(row, printDate),
                activityOrder: row.last_activity_order,
            };
        });

        if (!Number.isSafeInteger(countRow.player_count) || countRow.player_count < 0) {
            throw new Error("SQLite에 저장된 Wordle 참여자 수가 올바르지 않습니다.");
        }

        return {
            players,
            totalPlayers: countRow.player_count,
        };
    }

    public getPublicStatusPanel(
        guildId: string,
        channelId: string,
    ): WordlePublicStatusPanel | undefined {
        const row = this.database
            .prepare(
                `
                    SELECT guild_id, channel_id, message_id, print_date
                    FROM wordle_public_status_panels
                    WHERE guild_id = ? AND channel_id = ?
                `,
            )
            .get(guildId, channelId) as PersistedPublicStatusPanel | undefined;

        if (row === undefined) {
            return undefined;
        }

        return this.parsePublicStatusPanel(row);
    }

    public listPublicStatusPanels(
        guildId: string,
        printDate: string,
    ): readonly WordlePublicStatusPanel[] {
        const rows = this.database
            .prepare(
                `
                    SELECT guild_id, channel_id, message_id, print_date
                    FROM wordle_public_status_panels
                    WHERE guild_id = ? AND print_date = ?
                    ORDER BY channel_id
                `,
            )
            .all(guildId, printDate) as unknown as PersistedPublicStatusPanel[];

        return rows.map((row) => this.parsePublicStatusPanel(row));
    }

    public setPublicStatusPanel(panel: WordlePublicStatusPanel): void {
        this.database
            .prepare(
                `
                    INSERT INTO wordle_public_status_panels (
                        guild_id,
                        channel_id,
                        message_id,
                        print_date
                    )
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT (guild_id, channel_id) DO UPDATE SET
                        message_id = excluded.message_id,
                        print_date = excluded.print_date
                `,
            )
            .run(panel.guildId, panel.channelId, panel.messageId, panel.printDate);
    }

    public deletePublicStatusPanel(guildId: string, channelId: string): void {
        this.database
            .prepare(
                `
                    DELETE FROM wordle_public_status_panels
                    WHERE guild_id = ? AND channel_id = ?
                `,
            )
            .run(guildId, channelId);
    }

    public close(): void {
        if (this.databaseClosed) {
            return;
        }

        this.database.close();
        this.databaseClosed = true;
    }

    private loadGame(userId: string, printDate: string): WordleGame | undefined {
        const row = this.database
            .prepare(
                `
                    SELECT puzzle_id, solution, puzzle_number, guesses_json, status
                    FROM wordle_games
                    WHERE user_id = ? AND print_date = ?
                `,
            )
            .get(userId, printDate) as PersistedWordleGame | undefined;

        if (row === undefined) {
            return undefined;
        }

        return this.parseGame(row, printDate);
    }

    private parseGame(row: PersistedWordleGame, printDate: string): WordleGame {
        if (
            !Number.isSafeInteger(row.puzzle_id) ||
            !Number.isSafeInteger(row.puzzle_number) ||
            !/^[a-z]{5}$/.test(row.solution)
        ) {
            throw new Error("SQLite에 저장된 Wordle 퍼즐 정보 형식이 올바르지 않습니다.");
        }

        return {
            puzzle: {
                id: row.puzzle_id,
                solution: row.solution,
                printDate,
                puzzleNumber: row.puzzle_number,
            },
            guesses: parseGuesses(row.guesses_json),
            status: parseGameStatus(row.status),
        };
    }

    private saveGame(userId: string, printDate: string, game: WordleGame): void {
        this.database
            .prepare(
                `
                    INSERT INTO wordle_games (
                        user_id,
                        print_date,
                        puzzle_id,
                        solution,
                        puzzle_number,
                        guesses_json,
                        status,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                    ON CONFLICT (user_id, print_date) DO UPDATE SET
                        puzzle_id = excluded.puzzle_id,
                        solution = excluded.solution,
                        puzzle_number = excluded.puzzle_number,
                        guesses_json = excluded.guesses_json,
                        status = excluded.status,
                        updated_at = excluded.updated_at
                `,
            )
            .run(
                userId,
                printDate,
                game.puzzle.id,
                game.puzzle.solution,
                game.puzzle.puzzleNumber,
                JSON.stringify(game.guesses),
                game.status,
            );
    }

    private saveGuildParticipantActivity(
        userId: string,
        printDate: string,
        guildId: string,
    ): number {
        const row = this.database
            .prepare(
                `
                    SELECT COALESCE(MAX(last_activity_order), 0) + 1 AS next_activity_order
                    FROM wordle_guild_participants
                    WHERE guild_id = ? AND print_date = ?
                `,
            )
            .get(guildId, printDate) as { next_activity_order: number };
        const activityOrder = row.next_activity_order;

        if (!Number.isSafeInteger(activityOrder) || activityOrder < 1) {
            throw new Error("SQLite에서 Wordle 참여 활동 순서를 생성하지 못했습니다.");
        }

        this.database
            .prepare(
                `
                    INSERT INTO wordle_guild_participants (
                        guild_id,
                        print_date,
                        user_id,
                        last_activity_order,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                    ON CONFLICT (guild_id, print_date, user_id) DO UPDATE SET
                        last_activity_order = excluded.last_activity_order,
                        updated_at = excluded.updated_at
                `,
            )
            .run(guildId, printDate, userId, activityOrder);

        return activityOrder;
    }

    private runTransaction<T>(operation: () => T): T {
        this.database.exec("BEGIN IMMEDIATE");

        try {
            const result = operation();
            this.database.exec("COMMIT");
            return result;
        } catch (error) {
            this.database.exec("ROLLBACK");
            throw error;
        }
    }

    private storeServerState(
        userId: string,
        printDate: string,
        guildId: string,
        session: WordleSession,
    ): void {
        this.serverStates.set(this.createServerKey(userId, printDate, guildId), {
            guildId,
            panelMessage: session.panelMessage,
            printDate,
            privateResponseInteraction: session.privateResponseInteraction,
            privateResponseMessageId: session.privateResponseMessageId,
            resultShared: session.resultShared,
            userId,
        });
    }

    private parsePublicStatusPanel(row: PersistedPublicStatusPanel): WordlePublicStatusPanel {
        if (
            !/^\d{17,20}$/.test(row.guild_id) ||
            !/^\d{17,20}$/.test(row.channel_id) ||
            !/^\d{17,20}$/.test(row.message_id) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(row.print_date)
        ) {
            throw new Error("SQLite에 저장된 Wordle 공개 현황 패널 정보가 올바르지 않습니다.");
        }

        return {
            guildId: row.guild_id,
            channelId: row.channel_id,
            messageId: row.message_id,
            printDate: row.print_date,
        };
    }

    private createServerKey(userId: string, printDate: string, guildId: string): string {
        return `${guildId}:${userId}:${printDate}`;
    }
}
