import type { DatabaseSync } from "node:sqlite";

import type { GameStatus } from "../../../domain/game.js";
import type {
    WordleDailyResult,
    WordleGuildPersonalRecord,
    WordlePersonalRecord,
    WordleRecordResetResult,
    WordleSpoilerType,
} from "../../../domain/models.js";
import { getPreviousWordlePrintDate } from "../../../domain/print-date.js";
import { createEmptyPersonalRecord, parseGuesses, parsePersonalRecord } from "./row-mappers.js";
import type {
    PersistedCompletableGame,
    PersistedDailyResult,
    PersistedGuildPersonalRecord,
    PersistedWordlePersonalRecord,
} from "./row-mappers.js";
import { calculateWordleGameRecord } from "./record-calculator.js";
import { resetWordleGameRecords } from "./record-reset.js";

export class WordleRecordRepository {
    public constructor(private readonly database: DatabaseSync) {}

    public resetGameRecordsForDate(printDate: string): WordleRecordResetResult {
        return resetWordleGameRecords(
            this.database,
            printDate,
            (userId, resultPrintDate, result, guessCount) =>
                this.saveDailyResult(userId, resultPrintDate, result, guessCount),
        );
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

        return row === undefined ? createEmptyPersonalRecord() : parsePersonalRecord(row);
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
            record: parsePersonalRecord(row),
            userId: row.user_id,
        }));
    }

    public recordSpoilerUse(userId: string, spoilerType: WordleSpoilerType): void {
        const column = spoilerType === "genuine" ? "genuine_spoiler_count" : "fake_spoiler_count";

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
    }

    public recordUnregisteredWord(userId: string): void {
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
    }

    public saveDailyResult(
        userId: string,
        printDate: string,
        result: Exclude<GameStatus, "playing"> | "abandoned",
        guessCount: number,
    ): boolean {
        getPreviousWordlePrintDate(printDate);
        this.validateDailyResult(result, guessCount);
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

    public finalizePreviousGames(currentPrintDate: string): number {
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

    private validateDailyResult(result: WordleDailyResult, guessCount: number): void {
        if (
            !Number.isSafeInteger(guessCount) ||
            guessCount < 1 ||
            guessCount > 6 ||
            (result === "lost" && guessCount !== 6) ||
            (result === "abandoned" && guessCount >= 6)
        ) {
            throw new RangeError("저장할 Wordle 일별 결과의 시도 횟수가 올바르지 않습니다.");
        }
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
        const summary = calculateWordleGameRecord(results);

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
                summary.successCount,
                summary.playedCount,
                summary.successfulGuessCountSum,
                summary.recentSuccessStreak,
                summary.lastSuccessDate,
                userId,
            );
    }
}
