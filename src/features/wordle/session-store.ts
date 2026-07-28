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

interface PersistedRecentPlayer {
    user_id: string;
    last_activity_order: number;
}

interface PersistedPlayerCount {
    player_count: number;
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
    private readonly games = new Map<string, WordleGame>();
    private readonly serverStates = new Map<string, WordleServerState>();
    private readonly participantActivityOrders = new Map<string, number>();
    private readonly publicStatusPanels = new Map<string, WordlePublicStatusPanel>();
    private readonly database: DatabaseSync | undefined;
    private nextActivityOrder = 1;
    private databaseClosed = false;

    public constructor(options: WordleSessionStoreOptions = {}) {
        if (options.databasePath === undefined) {
            this.database = undefined;
            return;
        }

        const databasePath =
            options.databasePath === ":memory:"
                ? options.databasePath
                : resolve(options.databasePath);

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
        const gameKey = this.createGameKey(userId, printDate);
        const game = this.games.get(gameKey) ?? this.loadGame(userId, printDate);

        if (game === undefined) {
            return undefined;
        }

        this.games.set(gameKey, game);
        const serverState = this.serverStates.get(this.createServerKey(gameKey, guildId));

        return {
            game,
            panelMessage: serverState?.panelMessage,
            privateResponseInteraction: serverState?.privateResponseInteraction,
            privateResponseMessageId: serverState?.privateResponseMessageId,
            resultShared: serverState?.resultShared ?? false,
        };
    }

    public set(userId: string, printDate: string, guildId: string, session: WordleSession): void {
        const gameKey = this.createGameKey(userId, printDate);

        this.saveGame(userId, printDate, session.game);
        this.storeSessionInMemory(gameKey, guildId, session);
    }

    public registerGuildParticipant(userId: string, printDate: string, guildId: string): number {
        let activityOrder: number;

        if (this.database === undefined) {
            activityOrder = this.nextActivityOrder;
            this.nextActivityOrder += 1;
        } else {
            this.database.exec("BEGIN IMMEDIATE");

            try {
                activityOrder = this.saveGuildParticipantActivity(userId, printDate, guildId);
                this.database.exec("COMMIT");
            } catch (error) {
                this.database.exec("ROLLBACK");
                throw error;
            }
        }

        this.participantActivityOrders.set(
            this.createParticipantKey(guildId, printDate, userId),
            activityOrder,
        );

        return activityOrder;
    }

    public recordValidGuess(
        userId: string,
        printDate: string,
        guildId: string,
        session: WordleSession,
    ): number {
        const gameKey = this.createGameKey(userId, printDate);
        let activityOrder: number;

        if (this.database === undefined) {
            activityOrder = this.nextActivityOrder;
            this.nextActivityOrder += 1;
        } else {
            this.database.exec("BEGIN IMMEDIATE");

            try {
                this.saveGame(userId, printDate, session.game);
                const result = this.database
                    .prepare(
                        `
                            INSERT INTO wordle_input_activity (guild_id, print_date, user_id)
                            VALUES (?, ?, ?)
                        `,
                    )
                    .run(guildId, printDate, userId);

                if (!Number.isSafeInteger(Number(result.lastInsertRowid))) {
                    throw new Error("SQLite에 Wordle 입력 활동을 기록하지 못했습니다.");
                }

                activityOrder = this.saveGuildParticipantActivity(userId, printDate, guildId);
                this.database.exec("COMMIT");
            } catch (error) {
                this.database.exec("ROLLBACK");
                throw error;
            }
        }

        this.participantActivityOrders.set(
            this.createParticipantKey(guildId, printDate, userId),
            activityOrder,
        );
        this.storeSessionInMemory(gameKey, guildId, session);

        return activityOrder;
    }

    public getRecentPlayers(
        guildId: string,
        printDate: string,
        limit: number,
    ): WordleRecentPlayers {
        if (!Number.isSafeInteger(limit) || limit < 1) {
            throw new RangeError("최근 Wordle 사용자 조회 수는 1 이상의 정수여야 합니다.");
        }

        if (this.database === undefined) {
            const recentPlayers = [...this.participantActivityOrders.entries()]
                .flatMap(([key, activityOrder]) => {
                    const parsedKey = this.parseParticipantKey(key);

                    if (
                        parsedKey === undefined ||
                        parsedKey.guildId !== guildId ||
                        parsedKey.printDate !== printDate
                    ) {
                        return [];
                    }

                    const game = this.games.get(
                        this.createGameKey(parsedKey.userId, parsedKey.printDate),
                    );

                    return game === undefined
                        ? []
                        : [
                              {
                                  userId: parsedKey.userId,
                                  game,
                                  activityOrder,
                              },
                          ];
                })
                .sort((left, right) => right.activityOrder - left.activityOrder);

            return {
                players: recentPlayers.slice(0, limit),
                totalPlayers: recentPlayers.length,
            };
        }

        const rows = this.database
            .prepare(
                `
                    SELECT participant.user_id, participant.last_activity_order
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
            const gameKey = this.createGameKey(row.user_id, printDate);
            const game = this.games.get(gameKey) ?? this.loadGame(row.user_id, printDate);

            if (game === undefined || !Number.isSafeInteger(row.last_activity_order)) {
                throw new Error("SQLite에 저장된 Wordle 참여 활동 순서 정보가 올바르지 않습니다.");
            }

            this.games.set(gameKey, game);

            return {
                userId: row.user_id,
                game,
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
        const panelKey = this.createPublicStatusPanelKey(guildId, channelId);
        const inMemoryPanel = this.publicStatusPanels.get(panelKey);

        if (inMemoryPanel !== undefined || this.database === undefined) {
            return inMemoryPanel;
        }

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

        const panel = this.parsePublicStatusPanel(row);
        this.publicStatusPanels.set(panelKey, panel);

        return panel;
    }

    public listPublicStatusPanels(
        guildId: string,
        printDate: string,
    ): readonly WordlePublicStatusPanel[] {
        if (this.database === undefined) {
            return [...this.publicStatusPanels.values()].filter(
                (panel) => panel.guildId === guildId && panel.printDate === printDate,
            );
        }

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

        return rows.map((row) => {
            const panel = this.parsePublicStatusPanel(row);
            this.publicStatusPanels.set(
                this.createPublicStatusPanelKey(panel.guildId, panel.channelId),
                panel,
            );

            return panel;
        });
    }

    public setPublicStatusPanel(panel: WordlePublicStatusPanel): void {
        if (this.database !== undefined) {
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

        this.publicStatusPanels.set(
            this.createPublicStatusPanelKey(panel.guildId, panel.channelId),
            panel,
        );
    }

    public deletePublicStatusPanel(guildId: string, channelId: string): void {
        if (this.database !== undefined) {
            this.database
                .prepare(
                    `
                        DELETE FROM wordle_public_status_panels
                        WHERE guild_id = ? AND channel_id = ?
                    `,
                )
                .run(guildId, channelId);
        }

        this.publicStatusPanels.delete(this.createPublicStatusPanelKey(guildId, channelId));
    }

    public close(): void {
        if (this.database === undefined || this.databaseClosed) {
            return;
        }

        this.database.close();
        this.databaseClosed = true;
    }

    private loadGame(userId: string, printDate: string): WordleGame | undefined {
        if (this.database === undefined) {
            return undefined;
        }

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
        if (this.database === undefined) {
            return;
        }

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
        if (this.database === undefined) {
            throw new Error("SQLite 없이 참여 활동 순서를 저장할 수 없습니다.");
        }

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

    private storeSessionInMemory(gameKey: string, guildId: string, session: WordleSession): void {
        this.games.set(gameKey, session.game);
        this.serverStates.set(this.createServerKey(gameKey, guildId), {
            panelMessage: session.panelMessage,
            privateResponseInteraction: session.privateResponseInteraction,
            privateResponseMessageId: session.privateResponseMessageId,
            resultShared: session.resultShared,
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

    private createGameKey(userId: string, printDate: string): string {
        return `${userId}:${printDate}`;
    }

    private createServerKey(gameKey: string, guildId: string): string {
        return `${guildId}:${gameKey}`;
    }

    private createParticipantKey(guildId: string, printDate: string, userId: string): string {
        return `${guildId}:${printDate}:${userId}`;
    }

    private parseParticipantKey(
        key: string,
    ): { guildId: string; printDate: string; userId: string } | undefined {
        const [guildId, printDate, userId, extraPart] = key.split(":");

        if (
            guildId === undefined ||
            printDate === undefined ||
            userId === undefined ||
            extraPart !== undefined
        ) {
            return undefined;
        }

        return { guildId, printDate, userId };
    }

    private createPublicStatusPanelKey(guildId: string, channelId: string): string {
        return `${guildId}:${channelId}`;
    }
}
