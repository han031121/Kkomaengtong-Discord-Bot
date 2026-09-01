import { MessageFlags } from "discord.js";
import type { Message, SendableChannels } from "discord.js";

import { AsyncKeyedLock } from "../../../../infrastructure/concurrency/async-keyed-lock.js";
import { createWordlePlayActionRow, createWordlePublicStatusContainer } from "../panel.js";
import type { WordlePublicStatusPanel, WordleSessionStore } from "../session-store.js";
import { SUPPRESSED_ALLOWED_MENTIONS } from "../interactions/components.js";
import type { WordleInteraction } from "../interactions/types.js";
import { getDiscordErrorCode } from "../interactions/private-state.js";

const WORDLE_PUBLIC_STATUS_PLAYER_LIMIT = 8;

export const publicStatusPanelLock = new AsyncKeyedLock();

export async function resolveSendableChannel(
    interaction: WordleInteraction,
    channelId: string,
): Promise<SendableChannels> {
    const currentChannel = interaction.channel;

    if (
        interaction.channelId === channelId &&
        currentChannel !== null &&
        currentChannel !== undefined &&
        currentChannel.isSendable()
    ) {
        return currentChannel;
    }

    const channel = await interaction.client.channels.fetch(channelId);

    if (channel === null || !channel.isSendable()) {
        throw new Error("Wordle 공개 현황 패널을 보낼 수 있는 채널이 아닙니다.");
    }

    return channel;
}

export function createPublicStatusPanelComponents(
    store: WordleSessionStore,
    guildId: string,
    printDate: string,
) {
    const recentPlayers = store.getRecentPlayers(
        guildId,
        printDate,
        WORDLE_PUBLIC_STATUS_PLAYER_LIMIT,
    );

    return [
        createWordlePublicStatusContainer(
            recentPlayers.players,
            recentPlayers.totalPlayers,
            printDate,
        ),
        createWordlePlayActionRow(),
    ];
}

export async function sendPublicStatusPanelMessage(
    channel: SendableChannels,
    store: WordleSessionStore,
    guildId: string,
    printDate: string,
): Promise<Message> {
    return channel.send({
        components: createPublicStatusPanelComponents(store, guildId, printDate),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: SUPPRESSED_ALLOWED_MENTIONS,
    });
}

export async function fetchPublicStatusPanelMessage(
    channel: SendableChannels,
    messageId: string,
): Promise<Message> {
    return channel.messages.fetch({
        message: messageId,
        force: true,
    });
}

export async function deleteExistingPublicStatusMessage(
    channel: SendableChannels,
    panel: WordlePublicStatusPanel,
): Promise<void> {
    try {
        const message = await fetchPublicStatusPanelMessage(channel, panel.messageId);
        await message.delete();
    } catch (error) {
        if (getDiscordErrorCode(error) === 10_008) {
            return;
        }

        throw error;
    }
}

export async function createAndStorePublicStatusPanel(
    channel: SendableChannels,
    store: WordleSessionStore,
    guildId: string,
    channelId: string,
    printDate: string,
): Promise<Message> {
    const message = await sendPublicStatusPanelMessage(channel, store, guildId, printDate);
    store.setPublicStatusPanel({
        guildId,
        channelId,
        messageId: message.id,
        printDate,
    });

    return message;
}
