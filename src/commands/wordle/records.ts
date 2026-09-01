import { MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction, Guild, Message } from "discord.js";

import { AsyncKeyedLock } from "../../features/wordle/async-keyed-lock.js";
import { getDiscordErrorCode, SUPPRESSED_ALLOWED_MENTIONS } from "./interaction-builders.js";
import { createAllWordleRecordsContainer } from "./panel.js";
import type {
    WordleGuildPersonalRecord,
    WordleServerRecordPanel,
    WordleSessionStore,
} from "./session-store.js";

const WORDLE_RECORD_RANKING_LIMIT = 5;
const UNKNOWN_MEMBER_ERROR_CODES = new Set([10_007, 10_013]);
const serverRecordPanelLock = new AsyncKeyedLock();

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
): Promise<readonly WordleGuildPersonalRecord[]> {
    const currentRecords = await Promise.all(
        records.map(async (record) => {
            try {
                const member = await guild.members.fetch(record.userId);

                return member.user.bot ? undefined : record;
            } catch (error) {
                if (isUnknownMemberError(error)) {
                    return undefined;
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

async function deletePreviousRecordPanel(
    interaction: ChatInputCommandInteraction,
    panel: WordleServerRecordPanel,
): Promise<void> {
    const channel = interaction.channel;

    if (channel === null || !channel.isSendable() || interaction.channelId !== panel.channelId) {
        throw new Error("기존 Wordle 전체 기록 메시지의 채널을 찾을 수 없습니다.");
    }

    try {
        const message = await channel.messages.fetch({
            force: true,
            message: panel.messageId,
        });

        await message.delete();
    } catch (error) {
        if (getDiscordErrorCode(error) === 10_008) {
            return;
        }

        throw error;
    }
}

export async function replaceWordleServerRecordPanel(
    interaction: ChatInputCommandInteraction,
    store: WordleSessionStore,
    rankings: WordleServerRecordRankings,
): Promise<Message> {
    const guildId = interaction.guildId;
    const channelId = interaction.channelId;

    if (guildId === null || channelId === null) {
        throw new Error("Wordle 전체 기록 메시지를 생성할 서버 또는 채널을 찾을 수 없습니다.");
    }

    return serverRecordPanelLock.runExclusive(guildId, async () => {
        const previousPanel = store.getServerRecordPanel(guildId, channelId);

        if (previousPanel !== undefined) {
            await deletePreviousRecordPanel(interaction, previousPanel);
            store.deleteServerRecordPanel(guildId, channelId);
        }

        const message = await interaction.editReply({
            components: [createAllWordleRecordsContainer(rankings)],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: SUPPRESSED_ALLOWED_MENTIONS,
        });

        store.setServerRecordPanel({
            channelId,
            guildId,
            messageId: message.id,
        });

        return message;
    });
}
