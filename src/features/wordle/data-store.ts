import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { EvaluatedGuess, GameStatus, TileState, WordleGame, WordlePuzzle } from "./game.js";

export interface WordleDataStoreOptions {
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

export interface WordleYesterdayAnnouncementTarget {
    guildId: string;
    channelId: string;
    recordDate: string;
}

export interface WordlePersonalRecord {
    averageGuessCount: number | undefined;
    fakeSpoilerCount: number;
    genuineSpoilerCount: number;
    playedCount: number;
    recentSuccessStreak: number;
    successCount: number;
    unregisteredWordCount: number;
    winRate: number | undefined;
}

export interface WordleGuildPersonalRecord {
    record: WordlePersonalRecord;
    userId: string;
}

export interface WordleServerRecordPanel {
    channelId: string;
    guildId: string;
    messageId: string;
}

export interface WordleRecordResetResult {
    printDate: string;
    reappliedParticipantCount: number;
    reappliedResultCount: number;
}

export type WordleSpoilerType = "fake" | "genuine";

type WordleDailyResult = "abandoned" | "lost" | "won";

interface PersistedWordleGame {
    puzzle_id: number;
    solution: string;
    puzzle_number: number;
    guesses_json: string;
    status: string;
}

interface PersistedWordlePuzzle {
    print_date: string;
    puzzle_id: number;
    solution: string;
    puzzle_number: number;
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

interface PersistedServerRecordPanel {
    channel_id: string;
    guild_id: string;
    message_id: string;
}

interface PersistedTableName {
    name: string;
}

interface PersistedTableColumn {
    name: string;
    pk: number;
}

interface PersistedPrintDate {
    print_date: string | null;
}

interface PersistedYesterdayAnnouncementTarget {
    guild_id: string;
    channel_id: string;
    record_date: string;
}

interface PersistedWordlePersonalRecord {
    current_success_streak: number;
    fake_spoiler_count: number;
    genuine_spoiler_count: number;
    played_count: number;
    success_count: number;
    successful_guess_count_sum: number;
    unregistered_word_count: number;
}

interface PersistedGuildPersonalRecord extends PersistedWordlePersonalRecord {
    user_id: string;
}

interface PersistedCompletableGame {
    guesses_json: string;
    print_date: string;
    status: string;
    user_id: string;
}

interface PersistedDailyResult {
    guess_count: number;
    print_date: string;
    result: string;
}

const WORDLE_SCHEMA_VERSION = 5;

export function getPreviousWordlePrintDate(printDate: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(printDate)) {
        throw new RangeError(`Wordle 날짜 형식이 올바르지 않습니다: ${printDate}`);
    }

    const date = new Date(`${printDate}T00:00:00.000Z`);

    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== printDate) {
        throw new RangeError(`실제로 존재하지 않는 Wordle 날짜입니다: ${printDate}`);
    }

    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
}

function validatePuzzle(puzzle: WordlePuzzle): void {
    getPreviousWordlePrintDate(puzzle.printDate);

    if (
        !Number.isSafeInteger(puzzle.id) ||
        puzzle.id < 0 ||
        !Number.isSafeInteger(puzzle.puzzleNumber) ||
        puzzle.puzzleNumber < 1 ||
        !/^[a-z]{5}$/.test(puzzle.solution)
    ) {
        throw new RangeError("저장할 Wordle 퍼즐 정보 형식이 올바르지 않습니다.");
    }
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

export class WordleDataStore {
    private readonly database: DatabaseSync;
    private databaseClosed = false;

    public constructor(options: WordleDataStoreOptions = {}) {
        const requestedPath = options.databasePath ?? ":memory:";
        const databasePath = requestedPath === ":memory:" ? requestedPath : resolve(requestedPath);

        if (databasePath !== ":memory:") {
            mkdirSync(dirname(databasePath), { recursive: true });
        }

        this.database = new DatabaseSync(databasePath);
        this.database.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 5000;
        `);
        this.migrateSchema();
        this.migrateServerRecordPanelSchema();
        this.database.exec("PRAGMA foreign_keys = ON;");
    }

    public activatePuzzle(puzzle: WordlePuzzle): string {
        validatePuzzle(puzzle);

        return this.runTransaction(() => {
            const latestRow = this.database
                .prepare("SELECT MAX(print_date) AS print_date FROM wordle_puzzles")
                .get() as unknown as PersistedPrintDate;

            if (latestRow.print_date !== null && latestRow.print_date > puzzle.printDate) {
                if (getPreviousWordlePrintDate(latestRow.print_date) === puzzle.printDate) {
                    this.savePuzzle(puzzle);
                }

                return latestRow.print_date;
            }

            this.finalizePreviousGames(puzzle.printDate);
            this.savePuzzle(puzzle);
            this.database
                .prepare(
                    `
                        DELETE FROM wordle_puzzles
                        WHERE print_date NOT IN (?, ?)
                    `,
                )
                .run(puzzle.printDate, getPreviousWordlePrintDate(puzzle.printDate));

            return puzzle.printDate;
        });
    }

    public getPuzzle(printDate: string): WordlePuzzle | undefined {
        const row = this.database
            .prepare(
                `
                    SELECT print_date, puzzle_id, solution, puzzle_number
                    FROM wordle_puzzles
                    WHERE print_date = ?
                `,
            )
            .get(printDate) as PersistedWordlePuzzle | undefined;

        return row === undefined ? undefined : this.parsePuzzle(row);
    }

    public get(userId: string, printDate: string): WordleGame | undefined {
        return this.loadGame(userId, printDate);
    }

    public set(userId: string, printDate: string, game: WordleGame): void {
        this.runTransaction(() => this.saveGame(userId, printDate, game));
    }

    public registerGuildParticipant(
        userId: string,
        printDate: string,
        guildId: string,
        channelId: string,
    ): number {
        return this.runTransaction(() => {
            const activityOrder = this.saveGuildParticipantActivity(userId, printDate, guildId);
            this.saveGuildRecordParticipant(userId, printDate, guildId);
            this.saveGuildDailyChannel(guildId, printDate, channelId);
            return activityOrder;
        });
    }

    public recordValidGuess(
        userId: string,
        printDate: string,
        guildId: string,
        channelId: string,
        game: WordleGame,
    ): number {
        const activityOrder = this.runTransaction(() => {
            this.saveGame(userId, printDate, game);
            const nextActivityOrder = this.saveGuildParticipantActivity(userId, printDate, guildId);
            this.saveGuildRecordParticipant(userId, printDate, guildId);
            this.saveGuildDailyChannel(guildId, printDate, channelId);

            if (game.status === "won" || game.status === "lost") {
                this.saveDailyResult(userId, printDate, game.status, game.guesses.length);
            }

            return nextActivityOrder;
        });

        return activityOrder;
    }

    public finalizeAbandonedGames(currentPrintDate: string): number {
        getPreviousWordlePrintDate(currentPrintDate);

        return this.runTransaction(() => this.finalizePreviousGames(currentPrintDate));
    }

    public resetGameRecordsForDate(printDate: string): WordleRecordResetResult {
        getPreviousWordlePrintDate(printDate);

        const puzzle = this.database
            .prepare("SELECT 1 FROM wordle_puzzles WHERE print_date = ?")
            .get(printDate);

        if (puzzle === undefined) {
            throw new Error(
                `초기화 후 다시 반영할 Wordle 퍼즐이 저장되어 있지 않습니다: ${printDate}`,
            );
        }

        return this.runTransaction(() => {
            this.database.exec(`
                DELETE FROM wordle_guild_record_participants;
                DELETE FROM wordle_user_daily_results;

                UPDATE wordle_user_records
                SET success_count = 0,
                    played_count = 0,
                    successful_guess_count_sum = 0,
                    current_success_streak = 0,
                    last_success_date = NULL,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
            `);

            const participantInsertion = this.database
                .prepare(
                    `
                        INSERT INTO wordle_guild_record_participants (
                            guild_id,
                            print_date,
                            user_id,
                            updated_at
                        )
                        SELECT guild_id, print_date, user_id, updated_at
                        FROM wordle_guild_participants
                        WHERE print_date = ?
                    `,
                )
                .run(printDate);
            const games = this.database
                .prepare(
                    `
                        SELECT user_id, print_date, guesses_json, status
                        FROM wordle_games
                        WHERE print_date = ? AND status IN ('won', 'lost')
                        ORDER BY user_id
                    `,
                )
                .all(printDate) as unknown as PersistedCompletableGame[];
            let reappliedResultCount = 0;

            for (const game of games) {
                const status = parseGameStatus(game.status);

                if (status === "playing") {
                    throw new Error(
                        "완료된 Wordle 게임 조회 결과에 진행 중인 게임이 포함되었습니다.",
                    );
                }

                if (
                    this.saveDailyResult(
                        game.user_id,
                        game.print_date,
                        status,
                        parseGuesses(game.guesses_json).length,
                    )
                ) {
                    reappliedResultCount += 1;
                }
            }

            return {
                printDate,
                reappliedParticipantCount: Number(participantInsertion.changes),
                reappliedResultCount,
            };
        });
    }

    public getPersonalRecord(userId: string): WordlePersonalRecord {
        const row = this.database
            .prepare(
                `
                    SELECT
                        success_count,
                        played_count,
                        successful_guess_count_sum,
                        current_success_streak,
                        genuine_spoiler_count,
                        fake_spoiler_count,
                        unregistered_word_count
                    FROM wordle_user_records
                    WHERE user_id = ?
                `,
            )
            .get(userId) as PersistedWordlePersonalRecord | undefined;

        return row === undefined ? this.createEmptyPersonalRecord() : this.parsePersonalRecord(row);
    }

    public listGuildPersonalRecords(guildId: string): readonly WordleGuildPersonalRecord[] {
        const rows = this.database
            .prepare(
                `
                    SELECT DISTINCT
                        record.user_id,
                        record.success_count,
                        record.played_count,
                        record.successful_guess_count_sum,
                        record.current_success_streak,
                        record.genuine_spoiler_count,
                        record.fake_spoiler_count,
                        record.unregistered_word_count
                    FROM wordle_guild_record_participants AS participant
                    INNER JOIN wordle_user_records AS record
                        ON record.user_id = participant.user_id
                    WHERE participant.guild_id = ?
                    ORDER BY record.user_id
                `,
            )
            .all(guildId) as unknown as PersistedGuildPersonalRecord[];

        return rows.map((row) => ({
            record: this.parsePersonalRecord(row),
            userId: row.user_id,
        }));
    }

    public recordSpoilerUse(userId: string, spoilerType: WordleSpoilerType): void {
        const column = spoilerType === "genuine" ? "genuine_spoiler_count" : "fake_spoiler_count";

        this.runTransaction(() => {
            this.ensureUserRecord(userId);
            this.database
                .prepare(
                    `
                        UPDATE wordle_user_records
                        SET ${column} = ${column} + 1,
                            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                        WHERE user_id = ?
                    `,
                )
                .run(userId);
        });
    }

    public recordUnregisteredWord(userId: string): void {
        this.runTransaction(() => {
            this.ensureUserRecord(userId);
            this.database
                .prepare(
                    `
                        UPDATE wordle_user_records
                        SET unregistered_word_count = unregistered_word_count + 1,
                            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                        WHERE user_id = ?
                    `,
                )
                .run(userId);
        });
    }

    public listPendingYesterdayAnnouncements(
        currentPrintDate: string,
    ): readonly WordleYesterdayAnnouncementTarget[] {
        const recordDate = getPreviousWordlePrintDate(currentPrintDate);
        const rows = this.database
            .prepare(
                `
                    SELECT
                        daily_channel.guild_id,
                        daily_channel.channel_id,
                        daily_channel.print_date AS record_date
                    FROM wordle_guild_daily_channels AS daily_channel
                    LEFT JOIN wordle_yesterday_announcements AS announcement
                        ON announcement.guild_id = daily_channel.guild_id
                        AND announcement.record_date = daily_channel.print_date
                    WHERE daily_channel.print_date = ?
                        AND announcement.guild_id IS NULL
                        AND EXISTS (
                            SELECT 1
                            FROM wordle_guild_participants AS participant
                            WHERE participant.guild_id = daily_channel.guild_id
                                AND participant.print_date = daily_channel.print_date
                        )
                    ORDER BY daily_channel.guild_id
                `,
            )
            .all(recordDate) as unknown as PersistedYesterdayAnnouncementTarget[];

        return rows.map((row) => this.parseYesterdayAnnouncementTarget(row));
    }

    public rearmYesterdayAnnouncements(currentPrintDate: string): number {
        const recordDate = getPreviousWordlePrintDate(currentPrintDate);
        const result = this.database
            .prepare(
                `
                    DELETE FROM wordle_yesterday_announcements
                    WHERE record_date = ?
                `,
            )
            .run(recordDate);

        return Number(result.changes);
    }

    public markYesterdayAnnouncementSent(
        target: WordleYesterdayAnnouncementTarget,
        messageId: string,
    ): void {
        this.database
            .prepare(
                `
                    INSERT INTO wordle_yesterday_announcements (
                        guild_id,
                        record_date,
                        channel_id,
                        message_id,
                        sent_at
                    )
                    VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                    ON CONFLICT (guild_id, record_date) DO UPDATE SET
                        channel_id = excluded.channel_id,
                        message_id = excluded.message_id,
                        sent_at = excluded.sent_at
                `,
            )
            .run(target.guildId, target.recordDate, target.channelId, messageId);
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
                        puzzle.puzzle_id,
                        puzzle.solution,
                        puzzle.puzzle_number,
                        game.guesses_json,
                        game.status
                    FROM wordle_guild_participants AS participant
                    INNER JOIN wordle_games AS game
                        ON game.user_id = participant.user_id
                        AND game.print_date = participant.print_date
                    INNER JOIN wordle_puzzles AS puzzle
                        ON puzzle.print_date = game.print_date
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

    public getServerRecordPanel(
        guildId: string,
        channelId: string,
    ): WordleServerRecordPanel | undefined {
        const row = this.database
            .prepare(
                `
                    SELECT guild_id, channel_id, message_id
                    FROM wordle_server_record_panels
                    WHERE guild_id = ? AND channel_id = ?
                `,
            )
            .get(guildId, channelId) as PersistedServerRecordPanel | undefined;

        return row === undefined
            ? undefined
            : {
                  channelId: row.channel_id,
                  guildId: row.guild_id,
                  messageId: row.message_id,
              };
    }

    public setServerRecordPanel(panel: WordleServerRecordPanel): void {
        this.database
            .prepare(
                `
                    INSERT INTO wordle_server_record_panels (
                        guild_id,
                        channel_id,
                        message_id,
                        updated_at
                    )
                    VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                    ON CONFLICT (guild_id, channel_id) DO UPDATE SET
                        message_id = excluded.message_id,
                        updated_at = excluded.updated_at
                `,
            )
            .run(panel.guildId, panel.channelId, panel.messageId);
    }

    public deleteServerRecordPanel(guildId: string, channelId: string): void {
        this.database
            .prepare(
                `
                    DELETE FROM wordle_server_record_panels
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

    private migrateSchema(): void {
        if (!this.tableExists("wordle_games")) {
            this.createCurrentSchema();
            this.backfillGuildDailyChannels();
            return;
        }

        const gameColumns = this.database
            .prepare("PRAGMA table_info(wordle_games)")
            .all() as unknown as PersistedTableColumn[];
        const isLegacySchema = gameColumns.some((column) => column.name === "solution");

        if (!isLegacySchema) {
            this.createCurrentSchema();
            this.backfillGuildDailyChannels();
            return;
        }

        this.migrateLegacySchema();
        this.backfillGuildDailyChannels();
    }

    private createCurrentSchema(): void {
        this.database.exec(`
            CREATE TABLE IF NOT EXISTS wordle_puzzles (
                print_date TEXT PRIMARY KEY CHECK (date(print_date) = print_date),
                puzzle_id INTEGER NOT NULL CHECK (puzzle_id >= 0),
                solution TEXT NOT NULL CHECK (
                    length(solution) = 5
                    AND solution GLOB '[a-z][a-z][a-z][a-z][a-z]'
                ),
                puzzle_number INTEGER NOT NULL CHECK (puzzle_number >= 1),
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS wordle_games (
                user_id TEXT NOT NULL,
                print_date TEXT NOT NULL,
                guesses_json TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('playing', 'won', 'lost')),
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, print_date),
                FOREIGN KEY (print_date)
                    REFERENCES wordle_puzzles (print_date)
                    ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS wordle_guild_participants (
                guild_id TEXT NOT NULL,
                print_date TEXT NOT NULL,
                user_id TEXT NOT NULL,
                last_activity_order INTEGER NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (guild_id, print_date, user_id),
                FOREIGN KEY (user_id, print_date)
                    REFERENCES wordle_games (user_id, print_date)
                    ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS wordle_guild_participants_recent
            ON wordle_guild_participants (
                guild_id,
                print_date,
                last_activity_order DESC
            );

            CREATE TABLE IF NOT EXISTS wordle_guild_daily_channels (
                guild_id TEXT NOT NULL,
                print_date TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (guild_id, print_date),
                FOREIGN KEY (print_date)
                    REFERENCES wordle_puzzles (print_date)
                    ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS wordle_public_status_panels (
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                print_date TEXT NOT NULL,
                PRIMARY KEY (guild_id, channel_id),
                FOREIGN KEY (print_date)
                    REFERENCES wordle_puzzles (print_date)
                    ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS wordle_server_record_panels (
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (guild_id, channel_id)
            );

            CREATE TABLE IF NOT EXISTS wordle_yesterday_announcements (
                guild_id TEXT NOT NULL,
                record_date TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                sent_at TEXT NOT NULL,
                PRIMARY KEY (guild_id, record_date),
                FOREIGN KEY (record_date)
                    REFERENCES wordle_puzzles (print_date)
                    ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS wordle_user_records (
                user_id TEXT PRIMARY KEY,
                success_count INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
                played_count INTEGER NOT NULL DEFAULT 0 CHECK (played_count >= 0),
                successful_guess_count_sum INTEGER NOT NULL DEFAULT 0 CHECK (
                    successful_guess_count_sum >= 0
                ),
                current_success_streak INTEGER NOT NULL DEFAULT 0 CHECK (
                    current_success_streak >= 0
                ),
                last_success_date TEXT CHECK (
                    last_success_date IS NULL OR date(last_success_date) = last_success_date
                ),
                genuine_spoiler_count INTEGER NOT NULL DEFAULT 0 CHECK (
                    genuine_spoiler_count >= 0
                ),
                fake_spoiler_count INTEGER NOT NULL DEFAULT 0 CHECK (fake_spoiler_count >= 0),
                unregistered_word_count INTEGER NOT NULL DEFAULT 0 CHECK (
                    unregistered_word_count >= 0
                ),
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS wordle_user_daily_results (
                user_id TEXT NOT NULL,
                print_date TEXT NOT NULL CHECK (date(print_date) = print_date),
                result TEXT NOT NULL CHECK (result IN ('won', 'lost', 'abandoned')),
                guess_count INTEGER NOT NULL CHECK (guess_count BETWEEN 1 AND 6),
                recorded_at TEXT NOT NULL,
                PRIMARY KEY (user_id, print_date),
                FOREIGN KEY (user_id)
                    REFERENCES wordle_user_records (user_id)
                    ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS wordle_user_daily_results_by_date
            ON wordle_user_daily_results (print_date, user_id);

            CREATE TABLE IF NOT EXISTS wordle_guild_record_participants (
                guild_id TEXT NOT NULL,
                print_date TEXT NOT NULL CHECK (date(print_date) = print_date),
                user_id TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (guild_id, print_date, user_id)
            );

            CREATE INDEX IF NOT EXISTS wordle_guild_record_participants_by_user
            ON wordle_guild_record_participants (guild_id, user_id, print_date);

            PRAGMA user_version = ${WORDLE_SCHEMA_VERSION};
        `);
    }

    private backfillGuildDailyChannels(): void {
        this.database.exec(`
            INSERT INTO wordle_guild_daily_channels (
                guild_id,
                print_date,
                channel_id,
                updated_at
            )
            SELECT
                panel.guild_id,
                panel.print_date,
                MIN(panel.channel_id),
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            FROM wordle_public_status_panels AS panel
            WHERE EXISTS (
                SELECT 1
                FROM wordle_guild_participants AS participant
                WHERE participant.guild_id = panel.guild_id
                    AND participant.print_date = panel.print_date
            )
            GROUP BY panel.guild_id, panel.print_date
            ON CONFLICT (guild_id, print_date) DO NOTHING;
        `);
    }

    private migrateLegacySchema(): void {
        const conflictingPuzzle = this.database
            .prepare(
                `
                    SELECT print_date
                    FROM wordle_games
                    GROUP BY print_date
                    HAVING COUNT(
                        DISTINCT CAST(puzzle_id AS TEXT) || ':' || lower(solution) || ':' ||
                            CAST(puzzle_number AS TEXT)
                    ) > 1
                    LIMIT 1
                `,
            )
            .get() as { print_date: string } | undefined;

        if (conflictingPuzzle !== undefined) {
            throw new Error(
                `같은 날짜에 서로 다른 Wordle 퍼즐이 저장되어 마이그레이션할 수 없습니다: ${conflictingPuzzle.print_date}`,
            );
        }

        const hasParticipants = this.tableExists("wordle_guild_participants");
        const hasInputActivity = this.tableExists("wordle_input_activity");
        const hasPublicStatusPanels = this.tableExists("wordle_public_status_panels");

        this.database.exec("PRAGMA foreign_keys = OFF;");
        this.database.exec("BEGIN IMMEDIATE;");

        try {
            this.database.exec(`
                CREATE TABLE wordle_puzzles (
                    print_date TEXT PRIMARY KEY CHECK (date(print_date) = print_date),
                    puzzle_id INTEGER NOT NULL CHECK (puzzle_id >= 0),
                    solution TEXT NOT NULL CHECK (
                        length(solution) = 5
                        AND solution GLOB '[a-z][a-z][a-z][a-z][a-z]'
                    ),
                    puzzle_number INTEGER NOT NULL CHECK (puzzle_number >= 1),
                    updated_at TEXT NOT NULL
                );

                INSERT INTO wordle_puzzles (
                    print_date,
                    puzzle_id,
                    solution,
                    puzzle_number,
                    updated_at
                )
                SELECT
                    print_date,
                    MIN(puzzle_id),
                    lower(MIN(solution)),
                    MIN(puzzle_number),
                    MAX(updated_at)
                FROM wordle_games
                GROUP BY print_date;

                ALTER TABLE wordle_games RENAME TO wordle_games_legacy;
            `);

            if (hasParticipants) {
                this.database.exec(
                    "ALTER TABLE wordle_guild_participants RENAME TO wordle_guild_participants_legacy;",
                );
            }

            if (hasPublicStatusPanels) {
                this.database.exec(
                    "ALTER TABLE wordle_public_status_panels RENAME TO wordle_public_status_panels_legacy;",
                );
            }

            this.database.exec("DROP INDEX IF EXISTS wordle_guild_participants_recent;");
            this.createCurrentSchema();
            this.database.exec(`
                INSERT INTO wordle_games (
                    user_id,
                    print_date,
                    guesses_json,
                    status,
                    updated_at
                )
                SELECT user_id, print_date, guesses_json, status, updated_at
                FROM wordle_games_legacy;
            `);

            if (hasParticipants) {
                this.database.exec(`
                    INSERT INTO wordle_guild_participants (
                        guild_id,
                        print_date,
                        user_id,
                        last_activity_order,
                        updated_at
                    )
                    SELECT
                        participant.guild_id,
                        participant.print_date,
                        participant.user_id,
                        participant.last_activity_order,
                        participant.updated_at
                    FROM wordle_guild_participants_legacy AS participant
                    INNER JOIN wordle_games AS game
                        ON game.user_id = participant.user_id
                        AND game.print_date = participant.print_date;
                `);
            }

            if (hasInputActivity) {
                this.database.exec(`
                    INSERT INTO wordle_guild_participants (
                        guild_id,
                        print_date,
                        user_id,
                        last_activity_order,
                        updated_at
                    )
                    SELECT
                        activity.guild_id,
                        activity.print_date,
                        activity.user_id,
                        MAX(activity.order_id),
                        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    FROM wordle_input_activity AS activity
                    INNER JOIN wordle_games AS game
                        ON game.user_id = activity.user_id
                        AND game.print_date = activity.print_date
                    GROUP BY activity.guild_id, activity.print_date, activity.user_id
                    ON CONFLICT (guild_id, print_date, user_id) DO UPDATE SET
                        last_activity_order = MAX(
                            wordle_guild_participants.last_activity_order,
                            excluded.last_activity_order
                        ),
                        updated_at = excluded.updated_at;
                `);
            }

            if (hasPublicStatusPanels) {
                this.database.exec(`
                    INSERT INTO wordle_public_status_panels (
                        guild_id,
                        channel_id,
                        message_id,
                        print_date
                    )
                    SELECT
                        panel.guild_id,
                        panel.channel_id,
                        panel.message_id,
                        panel.print_date
                    FROM wordle_public_status_panels_legacy AS panel
                    INNER JOIN wordle_puzzles AS puzzle
                        ON puzzle.print_date = panel.print_date;
                `);
            }

            this.database.exec(`
                DROP TABLE wordle_games_legacy;
                DROP TABLE IF EXISTS wordle_guild_participants_legacy;
                DROP TABLE IF EXISTS wordle_public_status_panels_legacy;
                DROP TABLE IF EXISTS wordle_input_activity;
                COMMIT;
            `);
        } catch (error) {
            this.database.exec("ROLLBACK;");
            throw error;
        }
    }

    private tableExists(tableName: string): boolean {
        const row = this.database
            .prepare(
                `
                    SELECT name
                    FROM sqlite_master
                    WHERE type = 'table' AND name = ?
                `,
            )
            .get(tableName) as PersistedTableName | undefined;

        return row !== undefined;
    }

    private migrateServerRecordPanelSchema(): void {
        const columns = this.database
            .prepare("PRAGMA table_info(wordle_server_record_panels)")
            .all() as unknown as PersistedTableColumn[];
        const guildIdColumn = columns.find((column) => column.name === "guild_id");
        const channelIdColumn = columns.find((column) => column.name === "channel_id");

        if (guildIdColumn?.pk === 1 && channelIdColumn?.pk === 2) {
            return;
        }

        this.database.exec("BEGIN IMMEDIATE;");

        try {
            this.database.exec(`
                ALTER TABLE wordle_server_record_panels
                RENAME TO wordle_server_record_panels_server_scoped;

                CREATE TABLE wordle_server_record_panels (
                    guild_id TEXT NOT NULL,
                    channel_id TEXT NOT NULL,
                    message_id TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (guild_id, channel_id)
                );

                INSERT INTO wordle_server_record_panels (
                    guild_id,
                    channel_id,
                    message_id,
                    updated_at
                )
                SELECT guild_id, channel_id, message_id, updated_at
                FROM wordle_server_record_panels_server_scoped;

                DROP TABLE wordle_server_record_panels_server_scoped;
                COMMIT;
            `);
        } catch (error) {
            this.database.exec("ROLLBACK;");
            throw error;
        }
    }

    private loadGame(userId: string, printDate: string): WordleGame | undefined {
        const row = this.database
            .prepare(
                `
                    SELECT
                        puzzle.puzzle_id,
                        puzzle.solution,
                        puzzle.puzzle_number,
                        game.guesses_json,
                        game.status
                    FROM wordle_games AS game
                    INNER JOIN wordle_puzzles AS puzzle
                        ON puzzle.print_date = game.print_date
                    WHERE game.user_id = ? AND game.print_date = ?
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

    private parsePuzzle(row: PersistedWordlePuzzle): WordlePuzzle {
        const puzzle = {
            id: row.puzzle_id,
            solution: row.solution,
            printDate: row.print_date,
            puzzleNumber: row.puzzle_number,
        };

        try {
            validatePuzzle(puzzle);
        } catch (error) {
            throw new Error("SQLite에 저장된 Wordle 퍼즐 정보 형식이 올바르지 않습니다.", {
                cause: error,
            });
        }

        return puzzle;
    }

    private createEmptyPersonalRecord(): WordlePersonalRecord {
        return {
            averageGuessCount: undefined,
            fakeSpoilerCount: 0,
            genuineSpoilerCount: 0,
            playedCount: 0,
            recentSuccessStreak: 0,
            successCount: 0,
            unregisteredWordCount: 0,
            winRate: undefined,
        };
    }

    private parsePersonalRecord(row: PersistedWordlePersonalRecord): WordlePersonalRecord {
        const counts = [
            row.success_count,
            row.played_count,
            row.successful_guess_count_sum,
            row.current_success_streak,
            row.genuine_spoiler_count,
            row.fake_spoiler_count,
            row.unregistered_word_count,
        ];

        if (
            counts.some((count) => !Number.isSafeInteger(count) || count < 0) ||
            row.success_count > row.played_count ||
            row.successful_guess_count_sum < row.success_count ||
            row.successful_guess_count_sum > row.success_count * 6
        ) {
            throw new Error("SQLite에 저장된 Wordle 개인 기록이 올바르지 않습니다.");
        }

        return {
            averageGuessCount:
                row.success_count === 0
                    ? undefined
                    : row.successful_guess_count_sum / row.success_count,
            fakeSpoilerCount: row.fake_spoiler_count,
            genuineSpoilerCount: row.genuine_spoiler_count,
            playedCount: row.played_count,
            recentSuccessStreak: row.current_success_streak,
            successCount: row.success_count,
            unregisteredWordCount: row.unregistered_word_count,
            winRate:
                row.played_count === 0 ? undefined : (row.success_count / row.played_count) * 100,
        };
    }

    private saveGame(userId: string, printDate: string, game: WordleGame): void {
        if (printDate !== game.puzzle.printDate) {
            throw new RangeError("저장 키와 Wordle 퍼즐 날짜가 일치하지 않습니다.");
        }

        validatePuzzle(game.puzzle);
        this.savePuzzle(game.puzzle);
        this.database
            .prepare(
                `
                    INSERT INTO wordle_games (
                        user_id,
                        print_date,
                        guesses_json,
                        status,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                    ON CONFLICT (user_id, print_date) DO UPDATE SET
                        guesses_json = excluded.guesses_json,
                        status = excluded.status,
                        updated_at = excluded.updated_at
                `,
            )
            .run(userId, printDate, JSON.stringify(game.guesses), game.status);
    }

    private savePuzzle(puzzle: WordlePuzzle): void {
        const result = this.database
            .prepare(
                `
                    INSERT INTO wordle_puzzles (
                        print_date,
                        puzzle_id,
                        solution,
                        puzzle_number,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                    ON CONFLICT (print_date) DO UPDATE SET
                        updated_at = excluded.updated_at
                    WHERE wordle_puzzles.puzzle_id = excluded.puzzle_id
                        AND wordle_puzzles.solution = excluded.solution
                        AND wordle_puzzles.puzzle_number = excluded.puzzle_number
                `,
            )
            .run(puzzle.printDate, puzzle.id, puzzle.solution, puzzle.puzzleNumber);

        if (result.changes === 0) {
            throw new Error(`이미 저장된 Wordle 퍼즐과 정보가 다릅니다: ${puzzle.printDate}`);
        }
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

    private saveGuildRecordParticipant(userId: string, printDate: string, guildId: string): void {
        getPreviousWordlePrintDate(printDate);

        this.database
            .prepare(
                `
                    INSERT INTO wordle_guild_record_participants (
                        guild_id,
                        print_date,
                        user_id,
                        updated_at
                    )
                    VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                    ON CONFLICT (guild_id, print_date, user_id) DO UPDATE SET
                        updated_at = excluded.updated_at
                `,
            )
            .run(guildId, printDate, userId);
    }

    private ensureUserRecord(userId: string): void {
        this.database
            .prepare(
                `
                    INSERT INTO wordle_user_records (user_id, updated_at)
                    VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                    ON CONFLICT (user_id) DO NOTHING
                `,
            )
            .run(userId);
    }

    private saveDailyResult(
        userId: string,
        printDate: string,
        result: WordleDailyResult,
        guessCount: number,
    ): boolean {
        getPreviousWordlePrintDate(printDate);

        if (
            !Number.isSafeInteger(guessCount) ||
            guessCount < 1 ||
            guessCount > 6 ||
            (result === "lost" && guessCount !== 6) ||
            (result === "abandoned" && guessCount >= 6)
        ) {
            throw new RangeError("저장할 Wordle 일별 결과의 시도 횟수가 올바르지 않습니다.");
        }

        this.ensureUserRecord(userId);
        const insertion = this.database
            .prepare(
                `
                    INSERT INTO wordle_user_daily_results (
                        user_id,
                        print_date,
                        result,
                        guess_count,
                        recorded_at
                    )
                    VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                    ON CONFLICT (user_id, print_date) DO NOTHING
                `,
            )
            .run(userId, printDate, result, guessCount);

        if (insertion.changes === 0) {
            return false;
        }

        this.recalculateUserGameRecord(userId);
        return true;
    }

    private recalculateUserGameRecord(userId: string): void {
        const results = this.database
            .prepare(
                `
                    SELECT print_date, result, guess_count
                    FROM wordle_user_daily_results
                    WHERE user_id = ?
                    ORDER BY print_date DESC
                `,
            )
            .all(userId) as unknown as PersistedDailyResult[];
        let successCount = 0;
        let successfulGuessCountSum = 0;
        let recentSuccessStreak = 0;
        let lastSuccessDate: string | null = null;
        let expectedStreakDate = results[0]?.print_date;

        for (const result of results) {
            getPreviousWordlePrintDate(result.print_date);

            if (
                !Number.isSafeInteger(result.guess_count) ||
                result.guess_count < 1 ||
                result.guess_count > 6
            ) {
                throw new Error("SQLite에 저장된 Wordle 일별 결과가 올바르지 않습니다.");
            }

            if (result.result === "won") {
                successCount += 1;
                successfulGuessCountSum += result.guess_count;
                lastSuccessDate ??= result.print_date;
            } else if (result.result !== "lost" && result.result !== "abandoned") {
                throw new Error("SQLite에 저장된 Wordle 일별 결과가 올바르지 않습니다.");
            }

            if (result.print_date === expectedStreakDate && result.result === "won") {
                recentSuccessStreak += 1;
                expectedStreakDate = getPreviousWordlePrintDate(result.print_date);
            } else {
                expectedStreakDate = undefined;
            }
        }

        this.database
            .prepare(
                `
                    UPDATE wordle_user_records
                    SET success_count = ?,
                        played_count = ?,
                        successful_guess_count_sum = ?,
                        current_success_streak = ?,
                        last_success_date = ?,
                        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    WHERE user_id = ?
                `,
            )
            .run(
                successCount,
                results.length,
                successfulGuessCountSum,
                recentSuccessStreak,
                lastSuccessDate,
                userId,
            );
    }

    private finalizePreviousGames(currentPrintDate: string): number {
        const previousPrintDate = getPreviousWordlePrintDate(currentPrintDate);
        const games = this.database
            .prepare(
                `
                    SELECT user_id, print_date, guesses_json, status
                    FROM wordle_games
                    WHERE print_date < ? AND status = 'playing'
                    ORDER BY print_date, user_id
                `,
            )
            .all(currentPrintDate) as unknown as PersistedCompletableGame[];
        let finalizedCount = 0;

        for (const game of games) {
            const guessCount = parseGuesses(game.guesses_json).length;

            if (
                guessCount > 0 &&
                this.saveDailyResult(game.user_id, game.print_date, "abandoned", guessCount)
            ) {
                finalizedCount += 1;
            }
        }

        this.database
            .prepare(
                `
                    UPDATE wordle_user_records
                    SET current_success_streak = 0,
                        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    WHERE current_success_streak > 0
                        AND last_success_date < ?
                `,
            )
            .run(previousPrintDate);

        return finalizedCount;
    }

    private saveGuildDailyChannel(guildId: string, printDate: string, channelId: string): void {
        if (!/^\d{17,20}$/.test(guildId) || !/^\d{17,20}$/.test(channelId)) {
            throw new RangeError("저장할 Wordle 서버 또는 채널 ID 형식이 올바르지 않습니다.");
        }

        this.database
            .prepare(
                `
                    INSERT INTO wordle_guild_daily_channels (
                        guild_id,
                        print_date,
                        channel_id,
                        updated_at
                    )
                    VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                    ON CONFLICT (guild_id, print_date) DO UPDATE SET
                        channel_id = excluded.channel_id,
                        updated_at = excluded.updated_at
                `,
            )
            .run(guildId, printDate, channelId);
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

    private parseYesterdayAnnouncementTarget(
        row: PersistedYesterdayAnnouncementTarget,
    ): WordleYesterdayAnnouncementTarget {
        if (
            !/^\d{17,20}$/.test(row.guild_id) ||
            !/^\d{17,20}$/.test(row.channel_id) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(row.record_date)
        ) {
            throw new Error("SQLite에 저장된 어제 Wordle 기록판 대상 정보가 올바르지 않습니다.");
        }

        return {
            guildId: row.guild_id,
            channelId: row.channel_id,
            recordDate: row.record_date,
        };
    }
}
