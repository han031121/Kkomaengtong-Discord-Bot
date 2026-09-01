import type {
    EvaluatedGuess,
    GameStatus,
    TileState,
    WordleGame,
    WordlePuzzle,
} from "../../../domain/game.js";
import type {
    WordlePersonalRecord,
    WordlePublicStatusPanel,
    WordleYesterdayAnnouncementTarget,
} from "../../../domain/models.js";
import { assertWordlePrintDate } from "../../../domain/print-date.js";

export interface PersistedWordleGame {
    puzzle_id: number;
    solution: string;
    puzzle_number: number;
    guesses_json: string;
    status: string;
}

export interface PersistedWordlePuzzle {
    print_date: string;
    puzzle_id: number;
    solution: string;
    puzzle_number: number;
}

export interface PersistedRecentPlayer extends PersistedWordleGame {
    user_id: string;
    last_activity_order: number;
}

export interface PersistedWordlePersonalRecord {
    current_success_streak: number;
    fake_spoiler_count: number;
    genuine_spoiler_count: number;
    played_count: number;
    success_count: number;
    successful_guess_count_sum: number;
    unregistered_word_count: number;
}

export interface PersistedGuildPersonalRecord extends PersistedWordlePersonalRecord {
    user_id: string;
}

export interface PersistedCompletableGame {
    guesses_json: string;
    print_date: string;
    status: string;
    user_id: string;
}

export interface PersistedDailyResult {
    guess_count: number;
    print_date: string;
    result: string;
}

export interface PersistedPublicStatusPanel {
    guild_id: string;
    channel_id: string;
    message_id: string;
    print_date: string;
}

export interface PersistedYesterdayAnnouncementTarget {
    guild_id: string;
    channel_id: string;
    record_date: string;
}

export function validatePuzzle(puzzle: WordlePuzzle): void {
    assertWordlePrintDate(puzzle.printDate);

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

export function parseGuesses(value: string): readonly EvaluatedGuess[] {
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

export function parseGameStatus(value: string): GameStatus {
    if (value === "playing" || value === "won" || value === "lost") {
        return value;
    }

    throw new Error(`SQLite에 저장된 Wordle 게임 상태가 올바르지 않습니다: ${value}`);
}

export function parseGame(row: PersistedWordleGame, printDate: string): WordleGame {
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

export function parsePuzzle(row: PersistedWordlePuzzle): WordlePuzzle {
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

export function createEmptyPersonalRecord(): WordlePersonalRecord {
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

export function parsePersonalRecord(row: PersistedWordlePersonalRecord): WordlePersonalRecord {
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
        winRate: row.played_count === 0 ? undefined : (row.success_count / row.played_count) * 100,
    };
}

export function parsePublicStatusPanel(row: PersistedPublicStatusPanel): WordlePublicStatusPanel {
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

export function parseYesterdayAnnouncementTarget(
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
