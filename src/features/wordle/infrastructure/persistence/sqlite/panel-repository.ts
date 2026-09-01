import type { DatabaseSync } from "node:sqlite";

import type {
    WordlePublicStatusPanel,
    WordleServerRecordPanel,
    WordleYesterdayAnnouncementTarget,
} from "../../../domain/models.js";
import { getPreviousWordlePrintDate } from "../../../domain/print-date.js";
import { parsePublicStatusPanel, parseYesterdayAnnouncementTarget } from "./row-mappers.js";
import type {
    PersistedPublicStatusPanel,
    PersistedYesterdayAnnouncementTarget,
} from "./row-mappers.js";

interface PersistedServerRecordPanel {
    channel_id: string;
    guild_id: string;
    message_id: string;
}

export class WordlePanelRepository {
    public constructor(private readonly database: DatabaseSync) {}

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

        return rows.map((row) => parseYesterdayAnnouncementTarget(row));
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

        return row === undefined ? undefined : parsePublicStatusPanel(row);
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

        return rows.map((row) => parsePublicStatusPanel(row));
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
}
