import type { DatabaseSync } from "node:sqlite";

export const WORDLE_SCHEMA_VERSION = 5;

export function createCurrentWordleSchema(database: DatabaseSync): void {
    database.exec(`
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
