import type { Message } from "discord.js";

import { getDiscordErrorCode, getWordleGuildId } from "../interactions/private-state.js";
import type { WordleInteraction } from "../interactions/types.js";
import type { WordleSessionStore } from "../session-store.js";
import {
    createAndStorePublicStatusPanel,
    deleteExistingPublicStatusMessage,
    fetchPublicStatusPanelMessage,
    publicStatusPanelLock,
    resolveSendableChannel,
} from "./status-board-support.js";

export async function replaceWordlePublicStatusPanel(
    interaction: WordleInteraction,
    printDate: string,
    store: WordleSessionStore,
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

            return { action: "created", messageId: message.id };
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

            return { action: "recreated", messageId: message.id };
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

            return { action: "recreated", messageId: replacementMessage.id };
        }

        const newerMessages = await channel.messages.fetch({
            after: panel.messageId,
            limit: 1,
        });

        if (newerMessages.size === 0) {
            return { action: "existing", messageId: message.id };
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

        return { action: "recreated", messageId: replacementMessage.id };
    });
}
