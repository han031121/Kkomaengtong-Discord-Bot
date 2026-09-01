import type { DatabaseSync } from "node:sqlite";

import { createCurrentWordleSchema } from "./schema-definition.js";
import { tableExists } from "./schema-inspection.js";

export function migrateLegacyWordleSchema(database: DatabaseSync): void {
    const conflictingPuzzle = database
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

    const hasParticipants = tableExists(database, "wordle_guild_participants");
    const hasInputActivity = tableExists(database, "wordle_input_activity");
    const hasPublicStatusPanels = tableExists(database, "wordle_public_status_panels");

    database.exec("PRAGMA foreign_keys = OFF;");
    database.exec("BEGIN IMMEDIATE;");

    try {
        database.exec(`
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
            database.exec(
                "ALTER TABLE wordle_guild_participants RENAME TO wordle_guild_participants_legacy;",
            );
        }

        if (hasPublicStatusPanels) {
            database.exec(
                "ALTER TABLE wordle_public_status_panels RENAME TO wordle_public_status_panels_legacy;",
            );
        }

        database.exec("DROP INDEX IF EXISTS wordle_guild_participants_recent;");
        createCurrentWordleSchema(database);
        database.exec(`
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
            database.exec(`
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
            database.exec(`
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
            database.exec(`
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

        database.exec(`
            DROP TABLE wordle_games_legacy;
            DROP TABLE IF EXISTS wordle_guild_participants_legacy;
            DROP TABLE IF EXISTS wordle_public_status_panels_legacy;
            DROP TABLE IF EXISTS wordle_input_activity;
            COMMIT;
        `);
    } catch (error) {
        database.exec("ROLLBACK;");
        throw error;
    }
}
