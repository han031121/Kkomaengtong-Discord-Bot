import { MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction, Message } from "discord.js";

import { AsyncKeyedLock } from "../../features/wordle/async-keyed-lock.js";
import { getDiscordErrorCode, SUPPRESSED_ALLOWED_MENTIONS } from "./interaction-builders.js";
import { createAllWordleRecordsContainer } from "./panel.js";
import type { WordleServerRecordRankings } from "./record-rankings.js";
import type { WordleServerRecordPanel, WordleSessionStore } from "./session-store.js";

const serverRecordPanelLock = new AsyncKeyedLock();
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
