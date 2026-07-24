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

interface PersistedWordleGame {
    puzzle_id: number;
    solution: string;
    puzzle_number: number;
    guesses_json: string;
    status: string;
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
    private readonly database: DatabaseSync | undefined;
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
        this.games.set(gameKey, session.game);
        this.serverStates.set(this.createServerKey(gameKey, guildId), {
            panelMessage: session.panelMessage,
            privateResponseInteraction: session.privateResponseInteraction,
            privateResponseMessageId: session.privateResponseMessageId,
            resultShared: session.resultShared,
        });
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

    private createGameKey(userId: string, printDate: string): string {
        return `${userId}:${printDate}`;
    }

    private createServerKey(gameKey: string, guildId: string): string {
        return `${guildId}:${gameKey}`;
    }
}
