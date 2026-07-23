import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    SlashCommandBuilder,
    TextInputStyle,
} from "discord.js";
import type {
    ButtonInteraction,
    ChatInputCommandInteraction,
    Message,
    ModalSubmitInteraction,
} from "discord.js";
import { LabelBuilder, ModalBuilder, TextInputBuilder } from "@discordjs/builders";

import { AsyncKeyedLock } from "../features/wordle/async-keyed-lock.js";
import { DictionaryClient, DictionaryServiceError } from "../features/wordle/dictionary-client.js";
import {
    createWordleGame,
    normalizeGuess,
    submitGuess,
    WORDLE_MAX_GUESSES,
} from "../features/wordle/game.js";
import type { WordleGame } from "../features/wordle/game.js";
import { NytWordleClient, NytWordleServiceError } from "../features/wordle/nyt-wordle-client.js";
import {
    createPrivateWordleContainer,
    createPublicWordleContainer,
    createWordleNoticeContainer,
    createWordleSpoilerContainer,
} from "../features/wordle/panel.js";
import { WordleSessionStore } from "../features/wordle/session-store.js";
import type { WordleSession } from "../features/wordle/session-store.js";
import type { BotCommand } from "../types/command.js";

const dictionaryClient = new DictionaryClient();
const nytWordleClient = new NytWordleClient();
const sessionStore = new WordleSessionStore();
const userLock = new AsyncKeyedLock();
const RECOVERABLE_PANEL_ERROR_CODES = new Set([
    10_003, // Unknown Channel
    10_008, // Unknown Message
    10_015, // Unknown Webhook
    50_001, // Missing Access
    50_013, // Missing Permissions
]);
const WORDLE_SHARE_BUTTON_PREFIX = "wordle:share";
const WORDLE_SPOILER_BUTTON_PREFIX = "wordle:spoiler";
const WORDLE_INPUT_BUTTON_PREFIX = "wordle:input";
const WORDLE_PROGRESS_SHARE_BUTTON_PREFIX = "wordle:progress-share";
const WORDLE_GUESS_MODAL_PREFIX = "wordle:guess-modal";
const WORDLE_GUESS_INPUT_ID = "wordle:guess";

type WordleInteraction = ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction;
type WordleButtonAction = "share" | "spoiler" | "input" | "progress-share";
type WordleDictionary = Pick<DictionaryClient, "isEnglishWord">;

interface ParsedWordleButton {
    action: WordleButtonAction;
    printDate: string;
    userId: string;
}

interface ParsedWordleModal {
    printDate: string;
    userId: string;
}

const data = new SlashCommandBuilder()
    .setName("워들")
    .setDescription("워들이나 합시다.")
    .setDMPermission(false);

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

function createButtonCustomId(
    prefix:
        | typeof WORDLE_SHARE_BUTTON_PREFIX
        | typeof WORDLE_SPOILER_BUTTON_PREFIX
        | typeof WORDLE_INPUT_BUTTON_PREFIX
        | typeof WORDLE_PROGRESS_SHARE_BUTTON_PREFIX,
    printDate: string,
    userId: string,
): string {
    return `${prefix}:${printDate}:${userId}`;
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
    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(inputButton);

    if (session.panelMessage === undefined) {
        actionRow.addComponents(progressShareButton);
    }

    return actionRow;
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
        .setDisabled(session.game.status !== "won" || session.resultShared);
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

    return actionRow.addComponents(spoilerButton);
}

export function createWordleResultComponents(
    session: WordleSession,
    userId: string,
): readonly ActionRowBuilder<ButtonBuilder>[] {
    return session.game.status === "won" ? [createWordleResultButtons(session, userId)] : [];
}

function createPrivatePanel(session: WordleSession, userId: string, notice?: string) {
    const container = createPrivateWordleContainer(session.game, notice);

    if (session.game.status === "playing") {
        container.addActionRowComponents(createWordlePlayingButtons(session, userId).toJSON());
    }

    for (const actionRow of createWordleResultComponents(session, userId)) {
        container.addActionRowComponents(actionRow.toJSON());
    }

    return container;
}

function createEphemeralNoticeResponse(content: string) {
    return {
        components: [createWordleNoticeContainer(content)],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    };
}

function createNoticeEditResponse(content: string) {
    return {
        content: null,
        embeds: [],
        components: [createWordleNoticeContainer(content)],
        flags: MessageFlags.IsComponentsV2 as const,
    };
}

function parseWordleButton(customId: string): ParsedWordleButton | undefined {
    const [scope, action, printDate, userId, extraPart] = customId.split(":");

    if (
        scope !== "wordle" ||
        (action !== "share" &&
            action !== "spoiler" &&
            action !== "input" &&
            action !== "progress-share") ||
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

function parseWordleModal(customId: string): ParsedWordleModal | undefined {
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

function getDiscordErrorCode(error: unknown): number | undefined {
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

function createProgressResponse(game: WordleGame): string | undefined {
    switch (game.status) {
        case "won":
            return `정답입니다! ${game.guesses.length}/${WORDLE_MAX_GUESSES}회 만에 성공했습니다.`;
        case "lost":
            return `게임이 종료되었습니다. 정답은 **${game.puzzle.solution.toUpperCase()}**였습니다.`;
        case "playing":
            return undefined;
    }
}

function createCompletedResponse(session: WordleSession): string {
    if (session.game.status === "won") {
        return `오늘의 Wordle을 이미 ${session.game.guesses.length}/${WORDLE_MAX_GUESSES}회 만에 완료했습니다.`;
    }

    return `오늘의 Wordle은 이미 종료되었습니다. 정답은 **${session.game.puzzle.solution.toUpperCase()}**였습니다.`;
}

async function deletePreviousPrivateResponse(
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
    store: WordleSessionStore = sessionStore,
): Promise<void> {
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

    store.set(interaction.user.id, session.game.puzzle.printDate, {
        ...session,
        privateResponseInteraction: interaction,
        privateResponseMessageId: privateResponseMessage.id,
    });
}

async function updatePrivateWordleState(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    session: WordleSession,
    content: string | undefined,
    store: WordleSessionStore,
): Promise<void> {
    const privateResponseMessage = await interaction.editReply({
        content: null,
        embeds: [],
        components: [createPrivatePanel(session, interaction.user.id, content)],
        flags: MessageFlags.IsComponentsV2,
    });

    store.set(interaction.user.id, session.game.puzzle.printDate, {
        ...session,
        privateResponseInteraction: interaction,
        privateResponseMessageId: privateResponseMessage.id,
    });
}

async function processGuess(
    interaction: ModalSubmitInteraction,
    printDate: string,
    guess: string,
    store: WordleSessionStore,
    dictionary: WordleDictionary,
): Promise<void> {
    const currentSession = store.get(interaction.user.id, printDate);

    if (currentSession === undefined) {
        await interaction.editReply(
            createNoticeEditResponse(
                "Wordle 게임 정보를 찾을 수 없습니다. `/워들`로 게임을 다시 시작해 주세요.",
            ),
        );
        return;
    }

    if (currentSession.game.status !== "playing") {
        await updatePrivateWordleState(
            interaction,
            currentSession,
            createCompletedResponse(currentSession),
            store,
        );
        return;
    }

    const isDictionaryWord = await dictionary.isEnglishWord(guess);

    if (!isDictionaryWord && guess !== currentSession.game.puzzle.solution) {
        const invalidWordMessage =
            "사전에 등록된 5글자 영단어가 아닙니다. 입력 횟수는 차감되지 않았습니다.";

        await updatePrivateWordleState(interaction, currentSession, invalidWordMessage, store);
        return;
    }

    const updatedGame = submitGuess(currentSession.game, guess);
    const panelMessage =
        currentSession.panelMessage === undefined
            ? undefined
            : await updatePublicWordlePanel(interaction, currentSession, updatedGame);

    const updatedSession: WordleSession = {
        game: updatedGame,
        panelMessage,
        privateResponseInteraction: currentSession.privateResponseInteraction,
        privateResponseMessageId: currentSession.privateResponseMessageId,
        resultShared: currentSession.resultShared,
    };
    store.set(interaction.user.id, printDate, updatedSession);

    await updatePrivateWordleState(
        interaction,
        updatedSession,
        createProgressResponse(updatedGame),
        store,
    );
}

async function startWordleGame(
    interaction: ChatInputCommandInteraction,
    game: WordleGame,
    store: WordleSessionStore,
): Promise<void> {
    const existingSession = store.get(interaction.user.id, game.puzzle.printDate);

    if (existingSession !== undefined) {
        await showPrivateWordleState(
            interaction,
            existingSession,
            existingSession.game.status === "playing"
                ? undefined
                : createCompletedResponse(existingSession),
            store,
        );
        return;
    }

    const session: WordleSession = {
        game,
        panelMessage: undefined,
        privateResponseInteraction: undefined,
        privateResponseMessageId: undefined,
        resultShared: false,
    };
    store.set(interaction.user.id, game.puzzle.printDate, session);

    await showPrivateWordleState(interaction, session, undefined, store);
}

async function handleProgressShareButton(
    interaction: ButtonInteraction,
    parsedButton: ParsedWordleButton,
    session: WordleSession,
    store: WordleSessionStore,
): Promise<void> {
    if (session.game.status !== "playing") {
        await interaction.reply(
            createEphemeralNoticeResponse("진행 중인 게임만 현재 상황을 공유할 수 있습니다."),
        );
        return;
    }

    await interaction.deferUpdate();
    await userLock.runExclusive(parsedButton.userId, async () => {
        const latestSession = store.get(parsedButton.userId, parsedButton.printDate);

        if (latestSession === undefined) {
            await interaction.editReply(
                createNoticeEditResponse(
                    "Wordle 게임 정보를 찾을 수 없습니다. `/워들`로 게임을 다시 시작해 주세요.",
                ),
            );
            return;
        }

        if (latestSession.game.status !== "playing") {
            await updatePrivateWordleState(
                interaction,
                latestSession,
                createCompletedResponse(latestSession),
                store,
            );
            return;
        }

        const panelMessage =
            latestSession.panelMessage === undefined
                ? await sendPublicWordlePanel(interaction, latestSession.game)
                : await updatePublicWordlePanel(interaction, latestSession, latestSession.game);
        const sharedSession: WordleSession = {
            ...latestSession,
            panelMessage,
        };
        store.set(parsedButton.userId, parsedButton.printDate, sharedSession);

        await updatePrivateWordleState(
            interaction,
            sharedSession,
            "현재 진행 상황을 공개했습니다.",
            store,
        );
    });
}

async function handleShareButton(
    interaction: ButtonInteraction,
    parsedButton: ParsedWordleButton,
    session: WordleSession,
    store: WordleSessionStore,
): Promise<void> {
    if (session.game.status !== "won") {
        await interaction.reply(
            createEphemeralNoticeResponse("정답을 맞힌 뒤 결과를 공유할 수 있습니다."),
        );
        return;
    }

    await interaction.deferUpdate();
    await userLock.runExclusive(parsedButton.userId, async () => {
        const latestSession = store.get(parsedButton.userId, parsedButton.printDate);

        if (latestSession === undefined) {
            return;
        }

        if (latestSession.resultShared) {
            await interaction.editReply({
                components: [
                    createPrivatePanel(
                        latestSession,
                        parsedButton.userId,
                        createCompletedResponse(latestSession),
                    ),
                ],
            });
            return;
        }

        const sharedPanelMessage = await sendPublicWordlePanel(interaction, latestSession.game);
        const sharedSession: WordleSession = {
            ...latestSession,
            panelMessage: sharedPanelMessage,
            privateResponseInteraction: interaction,
            privateResponseMessageId: interaction.message.id,
            resultShared: true,
        };
        store.set(parsedButton.userId, parsedButton.printDate, sharedSession);

        await interaction.editReply({
            components: [
                createPrivatePanel(
                    sharedSession,
                    parsedButton.userId,
                    createCompletedResponse(sharedSession),
                ),
            ],
        });
    });
}

export async function handleSpoilerButton(
    interaction: ButtonInteraction,
    session: WordleSession,
): Promise<void> {
    const { user } = interaction;
    await interaction.deferUpdate();

    const channel =
        interaction.channel ?? (await interaction.client.channels.fetch(interaction.channelId));

    if (channel === null || !channel.isSendable()) {
        throw new Error("Wordle 스포일러를 보낼 수 있는 채널이 아닙니다.");
    }

    await channel.send({
        components: [createWordleSpoilerContainer(session.game, user.id)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { users: [user.id] },
    });
}

export async function handleWordleButton(
    interaction: ButtonInteraction,
    store: WordleSessionStore = sessionStore,
): Promise<void> {
    const parsedButton = parseWordleButton(interaction.customId);

    if (parsedButton === undefined) {
        return;
    }

    if (interaction.user.id !== parsedButton.userId) {
        await interaction.reply(
            createEphemeralNoticeResponse(
                "이 Wordle 결과의 버튼은 게임을 진행한 사용자만 사용할 수 있습니다.",
            ),
        );
        return;
    }

    const session = store.get(parsedButton.userId, parsedButton.printDate);

    if (session === undefined) {
        await interaction.reply(
            createEphemeralNoticeResponse(
                "Wordle 게임 정보를 찾을 수 없습니다. 봇이 재시작되었을 수 있습니다.",
            ),
        );
        return;
    }

    if (parsedButton.action === "progress-share") {
        await handleProgressShareButton(interaction, parsedButton, session, store);
        return;
    }

    if (parsedButton.action === "input") {
        if (session.game.status !== "playing") {
            await interaction.reply(
                createEphemeralNoticeResponse(createCompletedResponse(session)),
            );
            return;
        }

        await interaction.showModal(
            createWordleGuessModal(parsedButton.printDate, parsedButton.userId),
        );
        return;
    }

    if (parsedButton.action === "share") {
        await handleShareButton(interaction, parsedButton, session, store);
        return;
    }

    await handleSpoilerButton(interaction, session);
}

export async function handleWordleModal(
    interaction: ModalSubmitInteraction,
    store: WordleSessionStore = sessionStore,
    dictionary: WordleDictionary = dictionaryClient,
): Promise<void> {
    const parsedModal = parseWordleModal(interaction.customId);

    if (parsedModal === undefined) {
        return;
    }

    if (interaction.user.id !== parsedModal.userId) {
        await interaction.reply(
            createEphemeralNoticeResponse(
                "이 Wordle 단어 입력창은 게임을 진행한 사용자만 사용할 수 있습니다.",
            ),
        );
        return;
    }

    const session = store.get(parsedModal.userId, parsedModal.printDate);

    if (session === undefined) {
        await interaction.reply(
            createEphemeralNoticeResponse(
                "Wordle 게임 정보를 찾을 수 없습니다. `/워들`로 게임을 다시 시작해 주세요.",
            ),
        );
        return;
    }

    await interaction.deferUpdate();

    const guess = normalizeGuess(interaction.fields.getTextInputValue(WORDLE_GUESS_INPUT_ID));

    if (guess === undefined) {
        await updatePrivateWordleState(
            interaction,
            session,
            "영문 알파벳 5글자만 입력할 수 있습니다.",
            store,
        );
        return;
    }

    try {
        await userLock.runExclusive(parsedModal.userId, () =>
            processGuess(interaction, parsedModal.printDate, guess, store, dictionary),
        );
    } catch (error) {
        if (error instanceof DictionaryServiceError) {
            console.error("Wordle 입력 단어를 사전에서 확인하지 못했습니다.", error);

            const latestSession = store.get(parsedModal.userId, parsedModal.printDate) ?? session;
            await updatePrivateWordleState(
                interaction,
                latestSession,
                "영어 사전 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.",
                store,
            );
            return;
        }

        throw error;
    }
}

async function executeWordle(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const puzzle = await nytWordleClient.getTodaysPuzzle();
        const game = createWordleGame(puzzle);
        await userLock.runExclusive(interaction.user.id, () =>
            startWordleGame(interaction, game, sessionStore),
        );
    } catch (error) {
        if (error instanceof NytWordleServiceError) {
            console.error("오늘의 NYT Wordle을 불러오지 못했습니다.", error);
            await interaction.editReply(
                createNoticeEditResponse(
                    "오늘의 NYT Wordle을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
                ),
            );
            return;
        }

        throw error;
    }
}

export const wordleCommand: BotCommand = {
    data,
    execute: executeWordle,
};
