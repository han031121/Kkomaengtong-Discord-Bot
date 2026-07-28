import { MessageFlags } from "discord.js";
import type { Message, SendableChannels } from "discord.js";

import { AsyncKeyedLock } from "../../features/wordle/async-keyed-lock.js";
import type { WordleGame } from "../../features/wordle/game.js";
import {
    createPublicWordleContainer,
    createWordlePublicStatusContainer,
} from "../../features/wordle/panel.js";
import type {
    WordlePublicStatusPanel,
    WordleSession,
    WordleSessionStore,
} from "../../features/wordle/session-store.js";
import {
    defaultWordleSessionStore,
    getDiscordErrorCode,
    getWordleGuildId,
    SUPPRESSED_ALLOWED_MENTIONS,
} from "./interaction-builders.js";
import type { WordleInteraction } from "./interaction-builders.js";

const publicStatusPanelLock = new AsyncKeyedLock();
const RECOVERABLE_PANEL_ERROR_CODES = new Set([
    10_003, // Unknown Channel
    10_008, // Unknown Message
    10_015, // Unknown Webhook
    50_001, // Missing Access
    50_013, // Missing Permissions
]);
const WORDLE_PUBLIC_STATUS_PLAYER_LIMIT = 8;

function createPublicPanel(interaction: WordleInteraction, game: WordleGame) {
    return createPublicWordleContainer(
        game,
        interaction.user.id,
        interaction.user.displayAvatarURL(),
    );
}

export async function sendPublicWordlePanel(
    interaction: WordleInteraction,
    game: WordleGame,
): Promise<Message> {
    const channel =
        interaction.channel ??
        (interaction.channelId === null
            ? null
            : await interaction.client.channels.fetch(interaction.channelId));

    if (channel === null || !channel.isSendable()) {
        throw new Error("Wordle 공개 패널을 보낼 수 있는 채널이 아닙니다.");
    }

    return channel.send({
        components: [createPublicPanel(interaction, game)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { users: [interaction.user.id] },
    });
}

async function resolveSendableChannel(
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

function createPublicStatusPanelComponent(
    store: WordleSessionStore,
    guildId: string,
    printDate: string,
) {
    const recentPlayers = store.getRecentPlayers(
        guildId,
        printDate,
        WORDLE_PUBLIC_STATUS_PLAYER_LIMIT,
    );

    return createWordlePublicStatusContainer(
        recentPlayers.players,
        recentPlayers.totalPlayers,
        printDate,
    );
}

async function sendPublicStatusPanelMessage(
    channel: SendableChannels,
    store: WordleSessionStore,
    guildId: string,
    printDate: string,
): Promise<Message> {
    return channel.send({
        components: [createPublicStatusPanelComponent(store, guildId, printDate)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: SUPPRESSED_ALLOWED_MENTIONS,
    });
}

async function fetchPublicStatusPanelMessage(
    channel: SendableChannels,
    messageId: string,
): Promise<Message> {
    return channel.messages.fetch({
        message: messageId,
        force: true,
    });
}

async function deleteExistingPublicStatusMessage(
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

async function createAndStorePublicStatusPanel(
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

export async function replaceWordlePublicStatusPanel(
    interaction: WordleInteraction,
    printDate: string,
    store: WordleSessionStore = defaultWordleSessionStore,
): Promise<Message> {
    const guildId = getWordleGuildId(interaction);
    const channelId = interaction.channelId;

    if (channelId === null) {
        throw new Error("Wordle 공개 현황 패널을 생성할 채널을 찾을 수 없습니다.");
    }

    return publicStatusPanelLock.runExclusive(guildId, async () => {
        const channel = await resolveSendableChannel(interaction, channelId);
        const previousPanel = store.getPublicStatusPanel(guildId, channelId);

        if (previousPanel !== undefined) {
            await deleteExistingPublicStatusMessage(channel, previousPanel);
            store.deletePublicStatusPanel(guildId, channelId);
        }

        return createAndStorePublicStatusPanel(channel, store, guildId, channelId, printDate);
    });
}

export type WordlePublicStatusPanelAccess = "created" | "existing" | "recreated";

export interface WordlePublicStatusPanelAccessResult {
    action: WordlePublicStatusPanelAccess;
    messageId: string;
}

export async function accessWordlePublicStatusPanel(
    interaction: WordleInteraction,
    printDate: string,
    store: WordleSessionStore,
): Promise<WordlePublicStatusPanelAccessResult> {
    const guildId = getWordleGuildId(interaction);
    const channelId = interaction.channelId;

    if (channelId === null) {
        throw new Error("Wordle 공개 현황 패널을 확인할 채널을 찾을 수 없습니다.");
    }

    return publicStatusPanelLock.runExclusive(guildId, async () => {
        const channel = await resolveSendableChannel(interaction, channelId);
        const panel = store.getPublicStatusPanel(guildId, channelId);

        if (panel === undefined) {
            const message = await createAndStorePublicStatusPanel(
                channel,
                store,
                guildId,
                channelId,
                printDate,
            );

            return {
                action: "created",
                messageId: message.id,
            };
        }

        if (panel.printDate !== printDate) {
            await deleteExistingPublicStatusMessage(channel, panel);
            store.deletePublicStatusPanel(guildId, channelId);
            const message = await createAndStorePublicStatusPanel(
                channel,
                store,
                guildId,
                channelId,
                printDate,
            );

            return {
                action: "recreated",
                messageId: message.id,
            };
        }

        let message: Message;

        try {
            message = await fetchPublicStatusPanelMessage(channel, panel.messageId);
        } catch (error) {
            if (getDiscordErrorCode(error) !== 10_008) {
                throw error;
            }

            store.deletePublicStatusPanel(guildId, channelId);
            const replacementMessage = await createAndStorePublicStatusPanel(
                channel,
                store,
                guildId,
                channelId,
                printDate,
            );

            return {
                action: "recreated",
                messageId: replacementMessage.id,
            };
        }

        const newerMessages = await channel.messages.fetch({
            after: panel.messageId,
            limit: 1,
        });

        if (newerMessages.size === 0) {
            return {
                action: "existing",
                messageId: message.id,
            };
        }

        await message.delete();
        store.deletePublicStatusPanel(guildId, channelId);
        const replacementMessage = await createAndStorePublicStatusPanel(
            channel,
            store,
            guildId,
            channelId,
            printDate,
        );

        return {
            action: "recreated",
            messageId: replacementMessage.id,
        };
    });
}

async function refreshPublicStatusPanelMessage(
    interaction: WordleInteraction,
    panel: WordlePublicStatusPanel,
    store: WordleSessionStore,
): Promise<void> {
    let channel: SendableChannels;

    try {
        channel = await resolveSendableChannel(interaction, panel.channelId);
    } catch (error) {
        const errorCode = getDiscordErrorCode(error);

        if (
            errorCode !== undefined &&
            (errorCode === 10_003 || errorCode === 50_001 || errorCode === 50_013)
        ) {
            store.deletePublicStatusPanel(panel.guildId, panel.channelId);
            return;
        }

        throw error;
    }

    try {
        const message = await fetchPublicStatusPanelMessage(channel, panel.messageId);
        await message.edit({
            content: null,
            embeds: [],
            components: [createPublicStatusPanelComponent(store, panel.guildId, panel.printDate)],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: SUPPRESSED_ALLOWED_MENTIONS,
        });
    } catch (error) {
        const errorCode = getDiscordErrorCode(error);

        if (
            errorCode !== undefined &&
            (errorCode === 10_003 || errorCode === 50_001 || errorCode === 50_013)
        ) {
            store.deletePublicStatusPanel(panel.guildId, panel.channelId);
            return;
        }

        if (errorCode !== 10_008) {
            throw error;
        }

        const replacementMessage = await sendPublicStatusPanelMessage(
            channel,
            store,
            panel.guildId,
            panel.printDate,
        );
        store.setPublicStatusPanel({
            ...panel,
            messageId: replacementMessage.id,
        });
    }
}

export async function refreshWordlePublicStatusPanels(
    interaction: WordleInteraction,
    printDate: string,
    store: WordleSessionStore = defaultWordleSessionStore,
): Promise<void> {
    const guildId = getWordleGuildId(interaction);

    if (store.listPublicStatusPanels(guildId, printDate).length === 0) {
        return;
    }

    await publicStatusPanelLock.runExclusive(guildId, async () => {
        const panels = store.listPublicStatusPanels(guildId, printDate);

        for (const panel of panels) {
            await refreshPublicStatusPanelMessage(interaction, panel, store);
        }
    });
}

export async function updatePublicWordlePanel(
    interaction: WordleInteraction,
    session: WordleSession,
    game: WordleGame,
): Promise<Message> {
    const panelMessage = session.panelMessage;

    if (panelMessage === undefined) {
        return sendPublicWordlePanel(interaction, game);
    }

    if (!panelMessage.editable) {
        console.warn("기존 Wordle 패널을 수정할 수 없어 새 공개 패널을 생성합니다.");
        return sendPublicWordlePanel(interaction, game);
    }

    try {
        return await panelMessage.edit({
            content: null,
            embeds: [],
            components: [createPublicPanel(interaction, game)],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { users: [interaction.user.id] },
        });
    } catch (error) {
        const errorCode = getDiscordErrorCode(error);

        if (errorCode === undefined || !RECOVERABLE_PANEL_ERROR_CODES.has(errorCode)) {
            throw error;
        }

        console.warn(
            `기존 Wordle 패널을 수정하지 못해 새 공개 패널을 생성합니다. Discord 오류 코드: ${errorCode}`,
        );
        return sendPublicWordlePanel(interaction, game);
    }
}
