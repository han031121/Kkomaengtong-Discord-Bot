import { MessageFlags } from "discord.js";
import type { SendableChannels } from "discord.js";

import { SUPPRESSED_ALLOWED_MENTIONS } from "../interactions/components.js";
import { getDiscordErrorCode, getWordleGuildId } from "../interactions/private-state.js";
import type { WordleInteraction } from "../interactions/types.js";
import type { WordlePublicStatusPanel, WordleSessionStore } from "../session-store.js";
import {
    createPublicStatusPanelComponents,
    fetchPublicStatusPanelMessage,
    publicStatusPanelLock,
    resolveSendableChannel,
    sendPublicStatusPanelMessage,
} from "./status-board-support.js";

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
            components: createPublicStatusPanelComponents(store, panel.guildId, panel.printDate),
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
    store: WordleSessionStore,
): Promise<void> {
    const currentGuildId = getWordleGuildId(interaction);
    const guildIds = store.listParticipantGuildIds(interaction.user.id, printDate);

    await Promise.all(
        guildIds.map(async (guildId) => {
            if (store.listPublicStatusPanels(guildId, printDate).length === 0) {
                return;
            }

            try {
                await publicStatusPanelLock.runExclusive(guildId, async () => {
                    const panels = store.listPublicStatusPanels(guildId, printDate);

                    for (const panel of panels) {
                        await refreshPublicStatusPanelMessage(interaction, panel, store);
                    }
                });
            } catch (error) {
                if (guildId === currentGuildId) {
                    throw error;
                }

                console.warn("다른 서버의 Wordle 공개 게임 현황을 갱신하지 못했습니다.", error);
            }
        }),
    );
}
