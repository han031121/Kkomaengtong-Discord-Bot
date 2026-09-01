import type { DatabaseSync } from "node:sqlite";

import { migrateLegacyWordleSchema } from "./legacy-schema-migration.js";
import { createCurrentWordleSchema } from "./schema-definition.js";
import { tableExists } from "./schema-inspection.js";
import type { PersistedTableColumn } from "./schema-inspection.js";

function backfillGuildDailyChannels(database: DatabaseSync): void {
    database.exec(`
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

function migrateServerRecordPanelSchema(database: DatabaseSync): void {
    const columns = database
        .prepare("PRAGMA table_info(wordle_server_record_panels)")
        .all() as unknown as PersistedTableColumn[];
    const guildIdColumn = columns.find((column) => column.name === "guild_id");
    const channelIdColumn = columns.find((column) => column.name === "channel_id");

    if (guildIdColumn?.pk === 1 && channelIdColumn?.pk === 2) {
        return;
    }

    database.exec("BEGIN IMMEDIATE;");

    try {
        database.exec(`
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
        database.exec("ROLLBACK;");
        throw error;
    }
}

export function migrateWordleSchema(database: DatabaseSync): void {
    if (!tableExists(database, "wordle_games")) {
        createCurrentWordleSchema(database);
        backfillGuildDailyChannels(database);
        migrateServerRecordPanelSchema(database);
        return;
    }

    const gameColumns = database
        .prepare("PRAGMA table_info(wordle_games)")
        .all() as unknown as PersistedTableColumn[];
    const isLegacySchema = gameColumns.some((column) => column.name === "solution");

    if (isLegacySchema) {
        migrateLegacyWordleSchema(database);
    } else {
        createCurrentWordleSchema(database);
    }

    backfillGuildDailyChannels(database);
    migrateServerRecordPanelSchema(database);
}
