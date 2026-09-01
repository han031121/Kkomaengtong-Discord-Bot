import { getPreviousWordlePrintDate } from "../../../domain/print-date.js";
import type { PersistedDailyResult } from "./row-mappers.js";

export interface WordleGameRecordSummary {
    lastSuccessDate: string | null;
    playedCount: number;
    recentSuccessStreak: number;
    successCount: number;
    successfulGuessCountSum: number;
}

export function calculateWordleGameRecord(
    results: readonly PersistedDailyResult[],
): WordleGameRecordSummary {
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

    return {
        lastSuccessDate,
        playedCount: results.length,
        recentSuccessStreak,
        successCount,
        successfulGuessCountSum,
    };
}
