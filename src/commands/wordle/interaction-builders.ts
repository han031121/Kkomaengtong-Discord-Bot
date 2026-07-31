import { LabelBuilder, ModalBuilder, TextInputBuilder } from "@discordjs/builders";
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    TextInputStyle,
} from "discord.js";
import type {
    ButtonInteraction,
    ChatInputCommandInteraction,
    Message,
    ModalSubmitInteraction,
} from "discord.js";

import { AsyncKeyedLock } from "../../features/wordle/async-keyed-lock.js";
import { WORDLE_MAX_GUESSES } from "../../features/wordle/game.js";
import type { WordleGame } from "../../features/wordle/game.js";
import { createPrivateWordleContainer, createWordleNoticeContainer } from "./panel.js";
import { WordleSessionStore } from "./session-store.js";
import type { WordleSession } from "./session-store.js";

const WORDLE_SHARE_BUTTON_PREFIX = "wordle:share";
const WORDLE_SPOILER_BUTTON_PREFIX = "wordle:spoiler";
const WORDLE_INPUT_BUTTON_PREFIX = "wordle:input";
const WORDLE_PROGRESS_SHARE_BUTTON_PREFIX = "wordle:progress-share";
const WORDLE_STATUS_PANEL_BUTTON_PREFIX = "wordle:status-panel";
const WORDLE_GUESS_MODAL_PREFIX = "wordle:guess-modal";

export const WORDLE_GUESS_INPUT_ID = "wordle:guess";
export const SUPPRESSED_ALLOWED_MENTIONS = {
    parse: [],
    users: [],
    roles: [],
    repliedUser: false,
} as const;
export const defaultWordleSessionStore = new WordleSessionStore();
export const wordleUserLock = new AsyncKeyedLock();

export type WordleInteraction =
    ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction;
type WordleButtonAction =
    "share" | "spoiler" | "input" | "progress-share" | "status-panel" | "status-view";

export interface ParsedWordleTargetButton {
    action: WordleButtonAction;
    printDate: string;
    userId: string;
}

export type ParsedWordleButton = { action: "play" } | ParsedWordleTargetButton;

export interface ParsedWordleModal {
    printDate: string;
    userId: string;
}

function createButtonCustomId(
    prefix:
        | typeof WORDLE_SHARE_BUTTON_PREFIX
        | typeof WORDLE_SPOILER_BUTTON_PREFIX
        | typeof WORDLE_INPUT_BUTTON_PREFIX
        | typeof WORDLE_PROGRESS_SHARE_BUTTON_PREFIX
        | typeof WORDLE_STATUS_PANEL_BUTTON_PREFIX,
    printDate: string,
    userId: string,
): string {
    return `${prefix}:${printDate}:${userId}`;
}

function createWordleStatusPanelButton(printDate: string, userId: string): ButtonBuilder {
    return new ButtonBuilder()
        .setCustomId(createButtonCustomId(WORDLE_STATUS_PANEL_BUTTON_PREFIX, printDate, userId))
        .setLabel("공개 현황 보기")
        .setStyle(ButtonStyle.Secondary);
}

export function createWordlePlayingButtons(
    session: WordleSession,
    userId: string,
): ActionRowBuilder<ButtonBuilder> {
    const inputButton = new ButtonBuilder()
        .setCustomId(
            createButtonCustomId(WORDLE_INPUT_BUTTON_PREFIX, session.game.puzzle.printDate, userId),
        )
        .setLabel("단어 입력")
        .setStyle(ButtonStyle.Primary);
    const progressShareButton = new ButtonBuilder()
        .setCustomId(
            createButtonCustomId(
                WORDLE_PROGRESS_SHARE_BUTTON_PREFIX,
                session.game.puzzle.printDate,
                userId,
            ),
        )
        .setLabel("현재 진행 공유")
        .setStyle(ButtonStyle.Secondary);
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        inputButton,
        progressShareButton,
        createWordleStatusPanelButton(session.game.puzzle.printDate, userId),
    );
}

export function createWordleGuessModal(printDate: string, userId: string): ModalBuilder {
    const guessInput = new TextInputBuilder()
        .setCustomId(WORDLE_GUESS_INPUT_ID)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("")
        .setMinLength(5)
        .setMaxLength(5)
        .setRequired(true);
    const guessLabel = new LabelBuilder()
        .setLabel("5글자 영단어")
        .setDescription("오늘의 Wordle 정답을 추측해 주세요.")
        .setTextInputComponent(guessInput);

    return new ModalBuilder()
        .setCustomId(`${WORDLE_GUESS_MODAL_PREFIX}:${printDate}:${userId}`)
        .setTitle("Wordle 단어 입력")
        .addLabelComponents(guessLabel);
}

export function createWordleResultButtons(
    session: WordleSession,
    userId: string,
): ActionRowBuilder<ButtonBuilder> {
    const shareButton = new ButtonBuilder()
        .setCustomId(
            createButtonCustomId(WORDLE_SHARE_BUTTON_PREFIX, session.game.puzzle.printDate, userId),
        )
        .setLabel("결과 공유")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(session.game.status === "playing");
    const spoilerButton = new ButtonBuilder()
        .setCustomId(
            createButtonCustomId(
                WORDLE_SPOILER_BUTTON_PREFIX,
                session.game.puzzle.printDate,
                userId,
            ),
        )
        .setLabel("스포하기")
        .setStyle(ButtonStyle.Danger);
    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(shareButton);

    if (session.game.status === "won") {
        actionRow.addComponents(spoilerButton);
    }

    return actionRow.addComponents(
        createWordleStatusPanelButton(session.game.puzzle.printDate, userId),
    );
}

export function createWordleResultComponents(
    session: WordleSession,
    userId: string,
): readonly ActionRowBuilder<ButtonBuilder>[] {
    return session.game.status === "playing" ? [] : [createWordleResultButtons(session, userId)];
}

export function createPrivatePanel(session: WordleSession, userId: string, notice?: string) {
    const container = createPrivateWordleContainer(session.game, notice);

    if (session.game.status === "playing") {
        container.addActionRowComponents(createWordlePlayingButtons(session, userId).toJSON());
    }

    for (const actionRow of createWordleResultComponents(session, userId)) {
        container.addActionRowComponents(actionRow.toJSON());
    }

    return container;
}

export function createEphemeralNoticeResponse(content: string) {
    return {
        components: [createWordleNoticeContainer(content)],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    };
}

export function createNoticeEditResponse(content: string) {
    return {
        content: null,
        embeds: [],
        components: [createWordleNoticeContainer(content)],
        flags: MessageFlags.IsComponentsV2 as const,
    };
}

export function getWordleGuildId(interaction: WordleInteraction): string {
    if (interaction.guildId === null) {
        throw new Error("Wordle은 Discord 서버에서만 이용할 수 있습니다.");
    }

    return interaction.guildId;
}

export function parseWordleButton(customId: string): ParsedWordleButton | undefined {
    if (customId === "wordle:play") {
        return { action: "play" };
    }

    const [scope, action, printDate, userId, extraPart] = customId.split(":");

    if (
        scope !== "wordle" ||
        (action !== "share" &&
            action !== "spoiler" &&
            action !== "input" &&
            action !== "progress-share" &&
            action !== "status-panel" &&
            action !== "status-view") ||
        printDate === undefined ||
        !/^\d{4}-\d{2}-\d{2}$/.test(printDate) ||
        userId === undefined ||
        !/^\d{17,20}$/.test(userId) ||
        extraPart !== undefined
    ) {
        return undefined;
    }

    return { action, printDate, userId };
}

export function isWordleButton(customId: string): boolean {
    return parseWordleButton(customId) !== undefined;
}

export function parseWordleModal(customId: string): ParsedWordleModal | undefined {
    const [scope, action, printDate, userId, extraPart] = customId.split(":");

    if (
        scope !== "wordle" ||
        action !== "guess-modal" ||
        printDate === undefined ||
        !/^\d{4}-\d{2}-\d{2}$/.test(printDate) ||
        userId === undefined ||
        !/^\d{17,20}$/.test(userId) ||
        extraPart !== undefined
    ) {
        return undefined;
    }

    return { printDate, userId };
}

export function isWordleModal(customId: string): boolean {
    return parseWordleModal(customId) !== undefined;
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
    content?: string,
    store: WordleSessionStore = defaultWordleSessionStore,
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
