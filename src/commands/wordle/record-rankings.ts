import type { Guild } from "discord.js";

import type { WordleGuildPersonalRecord } from "./session-store.js";

const WORDLE_RECORD_RANKING_LIMIT = 5;
const UNKNOWN_MEMBER_ERROR_CODES = new Set([10_007, 10_013]);

export interface WordleRecordRankingEntry {
    userId: string;
    value: number;
}

export interface WordleServerRecordRankings {
    averageGuessCount: readonly WordleRecordRankingEntry[];
    recentSuccessStreak: readonly WordleRecordRankingEntry[];
    recordHolderCount: number;
    winRate: readonly WordleRecordRankingEntry[];
}

function isUnknownMemberError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "number" &&
        UNKNOWN_MEMBER_ERROR_CODES.has(error.code)
    );
}

export async function filterCurrentGuildMemberRecords(
    guild: Guild,
    records: readonly WordleGuildPersonalRecord[],
    includeUnknownMemberRecords = false,
): Promise<readonly WordleGuildPersonalRecord[]> {
    const currentRecords = await Promise.all(
        records.map(async (record) => {
            try {
                const member = await guild.members.fetch(record.userId);

                return member.user.bot ? undefined : record;
            } catch (error) {
                if (isUnknownMemberError(error)) {
                    return includeUnknownMemberRecords ? record : undefined;
                }

                throw error;
            }
        }),
    );

    return currentRecords.filter((record) => record !== undefined);
}

function createRanking(
    records: readonly WordleGuildPersonalRecord[],
    getValue: (record: WordleGuildPersonalRecord) => number | undefined,
    direction: "ascending" | "descending",
): readonly WordleRecordRankingEntry[] {
    return records
        .flatMap((record) => {
            const value = getValue(record);

            return value === undefined ? [] : [{ userId: record.userId, value }];
        })
        .sort((left, right) => {
            const valueDifference =
                direction === "ascending" ? left.value - right.value : right.value - left.value;

            return valueDifference === 0
                ? left.userId.localeCompare(right.userId)
                : valueDifference;
        })
        .slice(0, WORDLE_RECORD_RANKING_LIMIT);
}

export function createWordleServerRecordRankings(
    records: readonly WordleGuildPersonalRecord[],
): WordleServerRecordRankings {
    return {
        averageGuessCount: createRanking(
            records,
            (record) => record.record.averageGuessCount,
            "ascending",
        ),
        recentSuccessStreak: createRanking(
            records,
            (record) => record.record.recentSuccessStreak,
            "descending",
        ),
        recordHolderCount: records.length,
        winRate: createRanking(records, (record) => record.record.winRate, "descending"),
    };
}
