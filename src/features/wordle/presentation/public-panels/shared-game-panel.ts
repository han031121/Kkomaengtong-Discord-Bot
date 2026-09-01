import { MessageFlags } from "discord.js";
import type { Message } from "discord.js";

import type { WordleGame } from "../../domain/game.js";
import { getDiscordErrorCode, getWordleGuildId } from "../interactions/private-state.js";
import { createPublicWordleContainer, createWordlePlayActionRow } from "../panel.js";
import type { WordleSession, WordleSessionStore } from "../session-store.js";
import type { WordleInteraction } from "../interactions/types.js";

const RECOVERABLE_PANEL_ERROR_CODES = new Set([10_003, 10_008, 10_015, 50_001, 50_013]);

function createPublicPanelComponents(interaction: WordleInteraction, game: WordleGame) {
    return [
        createPublicWordleContainer(game, interaction.user.id, interaction.user.displayAvatarURL()),
        createWordlePlayActionRow(),
    ];
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
        components: createPublicPanelComponents(interaction, game),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { users: [interaction.user.id] },
    });
}

export async function replacePublicWordlePanel(
    interaction: WordleInteraction,
    session: WordleSession,
    game: WordleGame,
): Promise<Message> {
    const panelMessage = session.panelMessage;

    if (panelMessage !== undefined) {
        try {
            await panelMessage.delete();
        } catch (error) {
            const errorCode = getDiscordErrorCode(error);

            if (errorCode !== 10_003 && errorCode !== 10_008) {
                throw error;
            }

            console.warn(
                `기존 Wordle 개인 공개 패널이 이미 없어 새 패널을 생성합니다. Discord 오류 코드: ${errorCode}`,
            );
        }
    }

    return sendPublicWordlePanel(interaction, game);
}

async function updateSharedWordlePanel(
    interaction: WordleInteraction,
    panelMessage: Message,
    game: WordleGame,
): Promise<Message | undefined> {
    if (!panelMessage.editable) {
        console.warn(
            "다른 서버의 기존 Wordle 현황 공유 메시지를 수정할 수 없어 자동 갱신을 중단합니다.",
        );
        return undefined;
    }

    try {
        return await panelMessage.edit({
            content: null,
            embeds: [],
            components: createPublicPanelComponents(interaction, game),
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { users: [interaction.user.id] },
        });
    } catch (error) {
        const errorCode = getDiscordErrorCode(error);

        if (errorCode === undefined || !RECOVERABLE_PANEL_ERROR_CODES.has(errorCode)) {
            throw error;
        }

        console.warn(
            `다른 서버의 기존 Wordle 현황 공유 메시지를 찾거나 수정하지 못해 자동 갱신을 중단합니다. Discord 오류 코드: ${errorCode}`,
        );
        return undefined;
    }
}

export async function refreshSharedWordlePanels(
    interaction: WordleInteraction,
    game: WordleGame,
    store: WordleSessionStore,
): Promise<Message | undefined> {
    const currentGuildId = getWordleGuildId(interaction);
    let currentPanelMessage: Message | undefined;

    for (const guildId of store.listServerGuildIds(interaction.user.id, game.puzzle.printDate)) {
        const session = store.get(interaction.user.id, game.puzzle.printDate, guildId);

        if (session?.panelMessage === undefined) {
            continue;
        }

        let updatedMessage: Message | undefined;

        try {
            updatedMessage =
                guildId === currentGuildId
                    ? await updatePublicWordlePanel(interaction, session, game)
                    : await updateSharedWordlePanel(interaction, session.panelMessage, game);
        } catch (error) {
            if (guildId === currentGuildId) {
                throw error;
            }

            console.warn("다른 서버의 Wordle 현재 상태 공유창을 갱신하지 못했습니다.", error);
            continue;
        }

        store.setSharedPanelMessage(
            interaction.user.id,
            game.puzzle.printDate,
            guildId,
            updatedMessage,
        );

        if (guildId === currentGuildId) {
            currentPanelMessage = updatedMessage;
        }
    }

    return currentPanelMessage;
}

export async function updatePublicWordlePanel(
    interaction: WordleInteraction,
    session: WordleSession,
    game: WordleGame,
): Promise<Message | undefined> {
    const panelMessage = session.panelMessage;

    if (panelMessage === undefined) {
        return sendPublicWordlePanel(interaction, game);
    }

    if (!panelMessage.editable) {
        console.warn("기존 Wordle 현황 공유 메시지를 수정할 수 없어 자동 갱신을 중단합니다.");
        return undefined;
    }

    try {
        return await panelMessage.edit({
            content: null,
            embeds: [],
            components: createPublicPanelComponents(interaction, game),
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { users: [interaction.user.id] },
        });
    } catch (error) {
        const errorCode = getDiscordErrorCode(error);

        if (errorCode === undefined || !RECOVERABLE_PANEL_ERROR_CODES.has(errorCode)) {
            throw error;
        }

        console.warn(
            `기존 Wordle 현황 공유 메시지를 찾거나 수정하지 못해 자동 갱신을 중단합니다. Discord 오류 코드: ${errorCode}`,
        );
        return undefined;
    }
}
