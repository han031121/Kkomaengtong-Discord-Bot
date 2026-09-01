import type { DatabaseSync } from "node:sqlite";

import type { WordleRecentPlayers } from "../../../domain/models.js";
import { getPreviousWordlePrintDate } from "../../../domain/print-date.js";
import { parseGame } from "./row-mappers.js";
import type { PersistedRecentPlayer } from "./row-mappers.js";

interface PersistedGuildId {
    guild_id: string;
}

interface PersistedPlayerCount {
    player_count: number;
}

export class WordleActivityRepository {
    public constructor(private readonly database: DatabaseSync) {}

    public registerParticipant(
        userId: string,
        printDate: string,
        guildId: string,
        channelId: string,
    ): number {
        const activityOrder = this.saveParticipantActivity(userId, printDate, guildId);
        this.saveRecordParticipant(userId, printDate, guildId);
        this.saveDailyChannel(guildId, printDate, channelId);
        return activityOrder;
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
                game: parseGame(row, printDate),
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

    private saveParticipantActivity(userId: string, printDate: string, guildId: string): number {
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

    private saveRecordParticipant(userId: string, printDate: string, guildId: string): void {
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

    private saveDailyChannel(guildId: string, printDate: string, channelId: string): void {
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
}
