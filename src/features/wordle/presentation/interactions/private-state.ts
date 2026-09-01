import { MessageFlags } from "discord.js";
import type { Message } from "discord.js";

import { WORDLE_MAX_GUESSES } from "../../domain/game.js";
import type { WordleGame } from "../../domain/game.js";
import type { WordleSession, WordleSessionStore } from "../session-store.js";
import { createPrivatePanel } from "./components.js";
import type { WordleInteraction } from "./types.js";

export function getWordleGuildId(interaction: WordleInteraction): string {
    if (interaction.guildId === null) {
        throw new Error("Wordle은 Discord 서버에서만 이용할 수 있습니다.");
    }

    return interaction.guildId;
}

export function getDiscordErrorCode(error: unknown): number | undefined {
    if (typeof error !== "object" || error === null || !("code" in error)) {
        return undefined;
    }

    if (typeof error.code === "number") {
        return error.code;
    }

    if (typeof error.code === "string" && /^\d+$/.test(error.code)) {
        return Number(error.code);
    }

    return undefined;
}

export function createProgressResponse(game: WordleGame): string | undefined {
    switch (game.status) {
        case "won":
            return `정답입니다! ${game.guesses.length}/${WORDLE_MAX_GUESSES}회 만에 성공했습니다.`;
        case "lost":
            return `게임이 종료되었습니다. 정답은 **${game.puzzle.solution.toUpperCase()}**였습니다.`;
        case "playing":
            return undefined;
    }
}

export function createCompletedResponse(session: WordleSession): string {
    if (session.game.status === "won") {
        return `오늘의 Wordle을 이미 ${session.game.guesses.length}/${WORDLE_MAX_GUESSES}회 만에 완료했습니다.`;
    }

    return `오늘의 Wordle은 이미 종료되었습니다. 정답은 **${session.game.puzzle.solution.toUpperCase()}**였습니다.`;
}

export async function deletePreviousPrivateResponse(
    session: WordleSession,
    currentInteraction: WordleInteraction,
): Promise<void> {
    const previousInteraction = session.privateResponseInteraction;

    if (previousInteraction === undefined || previousInteraction.id === currentInteraction.id) {
        return;
    }

    try {
        await previousInteraction.deleteReply(session.privateResponseMessageId ?? "@original");
    } catch (error) {
        const errorCode = getDiscordErrorCode(error);

        if (
            errorCode !== undefined &&
            (errorCode === 10_008 || errorCode === 10_015 || errorCode === 50_027)
        ) {
            return;
        }

        console.warn("이전 Wordle 비공개 화면을 삭제하지 못했습니다.", error);
    }
}

export async function showPrivateWordleState(
    interaction: WordleInteraction,
    session: WordleSession,
    content: string | undefined,
    store: WordleSessionStore,
): Promise<void> {
    const guildId = getWordleGuildId(interaction);
    await deletePreviousPrivateResponse(session, interaction);

    const response = {
        content: null,
        embeds: [],
        components: [createPrivatePanel(session, interaction.user.id, content)],
        flags: MessageFlags.IsComponentsV2 as const,
    };
    let privateResponseMessage: Message;

    if (interaction.deferred) {
        privateResponseMessage = await interaction.editReply(response);
    } else {
        await interaction.reply({
            components: response.components,
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
        privateResponseMessage = await interaction.fetchReply();
    }

    store.set(interaction.user.id, session.game.puzzle.printDate, guildId, {
        ...session,
        privateResponseInteraction: interaction,
        privateResponseMessageId: privateResponseMessage.id,
    });
}

export async function updatePrivateWordleState(
    interaction: WordleInteraction,
    session: WordleSession,
    content: string | undefined,
    store: WordleSessionStore,
): Promise<void> {
    const guildId = getWordleGuildId(interaction);
    const privateResponseMessage = await interaction.editReply({
        content: null,
        embeds: [],
        components: [createPrivatePanel(session, interaction.user.id, content)],
        flags: MessageFlags.IsComponentsV2,
    });

    store.set(interaction.user.id, session.game.puzzle.printDate, guildId, {
        ...session,
        privateResponseInteraction: interaction,
        privateResponseMessageId: privateResponseMessage.id,
    });
}

export async function refreshOtherPrivateWordleStates(
    interaction: WordleInteraction,
    game: WordleGame,
    store: WordleSessionStore,
): Promise<void> {
    const currentGuildId = getWordleGuildId(interaction);

    for (const guildId of store.listServerGuildIds(interaction.user.id, game.puzzle.printDate)) {
        if (guildId === currentGuildId) {
            continue;
        }

        const session = store.get(interaction.user.id, game.puzzle.printDate, guildId);
        const privateInteraction = session?.privateResponseInteraction;

        if (session === undefined || privateInteraction === undefined) {
            continue;
        }

        const updatedSession = {
            ...session,
            game,
        };

        try {
            await updatePrivateWordleState(
                privateInteraction,
                updatedSession,
                createProgressResponse(game),
                store,
            );
        } catch (error) {
            const errorCode = getDiscordErrorCode(error);

            if (errorCode === 10_008 || errorCode === 10_015 || errorCode === 50_027) {
                store.set(interaction.user.id, game.puzzle.printDate, guildId, {
                    ...updatedSession,
                    privateResponseInteraction: undefined,
                    privateResponseMessageId: undefined,
                });
                continue;
            }

            console.warn("다른 서버의 Wordle 비공개 메시지를 갱신하지 못했습니다.", error);
        }
    }
}
