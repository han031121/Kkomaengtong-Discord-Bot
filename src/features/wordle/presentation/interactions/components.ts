import { LabelBuilder, ModalBuilder, TextInputBuilder } from "@discordjs/builders";
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    TextInputStyle,
} from "discord.js";

import { createPrivateWordleContainer, createWordleNoticeContainer } from "../panel.js";
import type { WordleSession } from "../session-store.js";
import {
    createWordleButtonCustomId,
    createWordleModalCustomId,
    WORDLE_GUESS_INPUT_ID,
    WORDLE_SPOILER_INPUT_ID,
} from "./custom-id.js";

export const SUPPRESSED_ALLOWED_MENTIONS = {
    parse: [],
    users: [],
    roles: [],
    repliedUser: false,
} as const;

function createWordleStatusPanelButton(printDate: string, userId: string): ButtonBuilder {
    return new ButtonBuilder()
        .setCustomId(createWordleButtonCustomId("status-panel", printDate, userId))
        .setLabel("점수판")
        .setStyle(ButtonStyle.Secondary);
}

export function createWordlePlayingButtons(
    session: WordleSession,
    userId: string,
): ActionRowBuilder<ButtonBuilder> {
    const inputButton = new ButtonBuilder()
        .setCustomId(createWordleButtonCustomId("input", session.game.puzzle.printDate, userId))
        .setLabel("단어 입력")
        .setStyle(ButtonStyle.Primary);
    const progressShareButton = new ButtonBuilder()
        .setCustomId(createWordleButtonCustomId("share", session.game.puzzle.printDate, userId))
        .setLabel("현황 공유")
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
        .setCustomId(createWordleModalCustomId("guess-modal", printDate, userId))
        .setTitle("Wordle 단어 입력")
        .addLabelComponents(guessLabel);
}

export function createWordleSpoilerModal(
    printDate: string,
    userId: string,
    solution: string,
): ModalBuilder {
    const spoilerInput = new TextInputBuilder()
        .setCustomId(WORDLE_SPOILER_INPUT_ID)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("")
        .setValue(solution.toUpperCase())
        .setMinLength(5)
        .setMaxLength(5)
        .setRequired(true);
    const spoilerLabel = new LabelBuilder()
        .setLabel("5글자 영단어")
        .setDescription("스포일러로 공개할 단어를 입력해 주세요.")
        .setTextInputComponent(spoilerInput);

    return new ModalBuilder()
        .setCustomId(createWordleModalCustomId("spoiler-modal", printDate, userId))
        .setTitle("Wordle 스포일러 입력")
        .addLabelComponents(spoilerLabel);
}

export function createWordleResultButtons(
    session: WordleSession,
    userId: string,
): ActionRowBuilder<ButtonBuilder> {
    const shareButton = new ButtonBuilder()
        .setCustomId(createWordleButtonCustomId("share", session.game.puzzle.printDate, userId))
        .setLabel("결과 공유")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(session.game.status === "playing");
    const spoilerButton = new ButtonBuilder()
        .setCustomId(createWordleButtonCustomId("spoiler", session.game.puzzle.printDate, userId))
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
