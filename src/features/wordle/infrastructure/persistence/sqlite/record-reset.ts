import type { DatabaseSync } from "node:sqlite";

import type { WordleDailyResult, WordleRecordResetResult } from "../../../domain/models.js";
import { parseGameStatus, parseGuesses } from "./row-mappers.js";
import type { PersistedCompletableGame } from "./row-mappers.js";

type SaveDailyResult = (
    userId: string,
    printDate: string,
    result: WordleDailyResult,
    guessCount: number,
) => boolean;

export function resetWordleGameRecords(
    database: DatabaseSync,
    printDate: string,
    saveDailyResult: SaveDailyResult,
): WordleRecordResetResult {
    database.exec(`
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

    const participantInsertion = database
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
    const games = database
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
            throw new Error("완료된 Wordle 게임 조회 결과에 진행 중인 게임이 포함되었습니다.");
        }

        if (
            saveDailyResult(
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
}
