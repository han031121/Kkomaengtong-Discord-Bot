import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    SlashCommandBuilder,
} from "discord.js";
import type { ButtonInteraction, ChatInputCommandInteraction, Message } from "discord.js";

import { AsyncKeyedLock } from "../features/wordle/async-keyed-lock.js";
import { DictionaryClient, DictionaryServiceError } from "../features/wordle/dictionary-client.js";
import {
    createWordleGame,
    normalizeGuess,
    submitGuess,
    WORDLE_MAX_GUESSES,
} from "../features/wordle/game.js";
import type { WordleGame, WordlePuzzle } from "../features/wordle/game.js";
import { NytWordleClient, NytWordleServiceError } from "../features/wordle/nyt-wordle-client.js";
import { createPrivateWordlePanel, createWordlePanel } from "../features/wordle/panel.js";
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
const WORDLE_VIEW_BUTTON_PREFIX = "wordle:view";

type WordleInteraction = ChatInputCommandInteraction | ButtonInteraction;
type WordleButtonAction = "share" | "spoiler" | "view";

interface ParsedWordleButton {
    action: WordleButtonAction;
    printDate: string;
    userId: string;
}

const data = new SlashCommandBuilder()
    .setName("워들")
    .setDescription("워들이나 합시다.")
    .setDMPermission(false);

data.addStringOption((option) =>
    option
        .setName("키워드")
        .setDescription("5글자 영단어 입력")
        .setRequired(true)
        .setMinLength(5)
        .setMaxLength(5),
);

function createPanel(interaction: WordleInteraction, game: WordleGame) {
    return createWordlePanel(game, interaction.user.displayAvatarURL());
}

function createPublicPanelContent(userId: string): string {
    return `<@${userId}>님의 게임`;
}

export async function sendPublicWordlePanel(
    interaction: WordleInteraction,
    game: WordleGame,
): Promise<Message> {
    const channel =
        interaction.channel ?? (await interaction.client.channels.fetch(interaction.channelId));

    if (channel === null || !channel.isSendable()) {
        throw new Error("Wordle 공개 패널을 보낼 수 있는 채널이 아닙니다.");
    }

    return channel.send({
        content: createPublicPanelContent(interaction.user.id),
        embeds: [createPanel(interaction, game)],
        components: [createPublicWordlePanelButtons(game, interaction.user.id)],
        allowedMentions: { users: [interaction.user.id] },
    });
}

function createButtonCustomId(
    prefix:
        | typeof WORDLE_SHARE_BUTTON_PREFIX
        | typeof WORDLE_SPOILER_BUTTON_PREFIX
        | typeof WORDLE_VIEW_BUTTON_PREFIX,
    printDate: string,
    userId: string,
): string {
    return `${prefix}:${printDate}:${userId}`;
}

export function createPublicWordlePanelButtons(
    game: WordleGame,
    userId: string,
): ActionRowBuilder<ButtonBuilder> {
    const viewButton = new ButtonBuilder()
        .setCustomId(createButtonCustomId(WORDLE_VIEW_BUTTON_PREFIX, game.puzzle.printDate, userId))
        .setLabel("내 게임 보기")
        .setStyle(ButtonStyle.Secondary);

    return new ActionRowBuilder<ButtonBuilder>().addComponents(viewButton);
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
    const panelLinkButton = new ButtonBuilder()
        .setLabel("게임 패널로 이동")
        .setStyle(ButtonStyle.Link)
        .setURL(session.panelMessage.url);
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

    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        shareButton,
        panelLinkButton,
        spoilerButton,
    );
}

export function createWordleResultComponents(
    session: WordleSession,
    userId: string,
): readonly ActionRowBuilder<ButtonBuilder>[] {
    return session.game.status === "won" ? [createWordleResultButtons(session, userId)] : [];
}

function parseWordleButton(customId: string): ParsedWordleButton | undefined {
    const [scope, action, printDate, userId, extraPart] = customId.split(":");

    if (
        scope !== "wordle" ||
        (action !== "share" && action !== "spoiler" && action !== "view") ||
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
    interaction: ChatInputCommandInteraction,
    session: WordleSession,
    game: WordleGame,
): Promise<Message> {
    if (!session.panelMessage.editable) {
        console.warn("기존 Wordle 패널을 수정할 수 없어 새 공개 패널을 생성합니다.");
        return sendPublicWordlePanel(interaction, game);
    }

    try {
        return await session.panelMessage.edit({
            content: createPublicPanelContent(interaction.user.id),
            embeds: [createPanel(interaction, game)],
            components: [createPublicWordlePanelButtons(game, interaction.user.id)],
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

function createProgressResponse(game: WordleGame): string {
    switch (game.status) {
        case "won":
            return `정답입니다! ${game.guesses.length}/${WORDLE_MAX_GUESSES}회 만에 성공했습니다.`;
        case "lost":
            return `게임이 종료되었습니다. 정답은 **${game.puzzle.solution.toUpperCase()}**였습니다.`;
        case "playing":
            return `${game.guesses.length}/${WORDLE_MAX_GUESSES}회차 입력을 반영했습니다.`;
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
    content: string,
): Promise<void> {
    await deletePreviousPrivateResponse(session, interaction);

    const response = {
        content,
        embeds: [createPrivateWordlePanel(session.game)],
        components: createWordleResultComponents(session, interaction.user.id),
    };
    let privateResponseMessage: Message;

    if (interaction.deferred) {
        await interaction.deleteReply();
        privateResponseMessage = await interaction.followUp({
            ...response,
            flags: MessageFlags.Ephemeral,
        });
    } else {
        await interaction.reply({ ...response, flags: MessageFlags.Ephemeral });
        privateResponseMessage = await interaction.fetchReply();
    }

    sessionStore.set(interaction.user.id, session.game.puzzle.printDate, {
        ...session,
        privateResponseInteraction: interaction,
        privateResponseMessageId: privateResponseMessage.id,
    });
}

async function processGuess(
    interaction: ChatInputCommandInteraction,
    puzzle: WordlePuzzle,
    guess: string,
): Promise<void> {
    const currentSession = sessionStore.get(interaction.user.id, puzzle.printDate);

    if (currentSession !== undefined && currentSession.game.status !== "playing") {
        await showPrivateWordleState(
            interaction,
            currentSession,
            createCompletedResponse(currentSession),
        );
        return;
    }

    const isDictionaryWord = await dictionaryClient.isEnglishWord(guess);

    if (!isDictionaryWord && guess !== puzzle.solution) {
        const invalidWordMessage =
            "사전에 등록된 5글자 영단어가 아닙니다. 입력 횟수는 차감되지 않았습니다.";

        if (currentSession === undefined) {
            await interaction.editReply({ content: invalidWordMessage });
        } else {
            await showPrivateWordleState(interaction, currentSession, invalidWordMessage);
        }
        return;
    }

    const currentGame = currentSession?.game ?? createWordleGame(puzzle);
    const updatedGame = submitGuess(currentGame, guess);
    const panelMessage =
        currentSession === undefined
            ? await sendPublicWordlePanel(interaction, updatedGame)
            : await updatePublicWordlePanel(interaction, currentSession, updatedGame);

    const updatedSession: WordleSession = {
        game: updatedGame,
        panelMessage,
        privateResponseInteraction: currentSession?.privateResponseInteraction,
        privateResponseMessageId: currentSession?.privateResponseMessageId,
        resultShared: currentSession?.resultShared ?? false,
    };
    sessionStore.set(interaction.user.id, puzzle.printDate, updatedSession);

    await showPrivateWordleState(interaction, updatedSession, createProgressResponse(updatedGame));
}

async function handleShareButton(
    interaction: ButtonInteraction,
    parsedButton: ParsedWordleButton,
    session: WordleSession,
): Promise<void> {
    if (session.game.status !== "won") {
        await interaction.reply({
            content: "정답을 맞힌 뒤 결과를 공유할 수 있습니다.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.deferUpdate();
    await userLock.runExclusive(parsedButton.userId, async () => {
        const latestSession = sessionStore.get(parsedButton.userId, parsedButton.printDate);

        if (latestSession === undefined) {
            return;
        }

        if (latestSession.resultShared) {
            await interaction.editReply({
                components: createWordleResultComponents(latestSession, parsedButton.userId),
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
        sessionStore.set(parsedButton.userId, parsedButton.printDate, sharedSession);

        await interaction.editReply({
            components: createWordleResultComponents(sharedSession, parsedButton.userId),
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
        content: [
            `<@${user.id}>님의 스포일러`,
            `# ${[...session.game.puzzle.solution.toUpperCase()].join(" ")}`,
        ].join("\n"),
        allowedMentions: { users: [user.id] },
    });
}

export async function handleWordleButton(interaction: ButtonInteraction): Promise<void> {
    const parsedButton = parseWordleButton(interaction.customId);

    if (parsedButton === undefined) {
        return;
    }

    if (interaction.user.id !== parsedButton.userId) {
        await interaction.reply({
            content: "이 Wordle 결과의 버튼은 게임을 진행한 사용자만 사용할 수 있습니다.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const session = sessionStore.get(parsedButton.userId, parsedButton.printDate);

    if (session === undefined) {
        await interaction.reply({
            content: "Wordle 게임 정보를 찾을 수 없습니다. 봇이 재시작되었을 수 있습니다.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (parsedButton.action === "view") {
        await showPrivateWordleState(interaction, session, "현재 Wordle 진행 상황입니다.");
        return;
    }

    if (parsedButton.action === "share") {
        await handleShareButton(interaction, parsedButton, session);
        return;
    }

    await handleSpoilerButton(interaction, session);
}

async function executeWordle(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guess = normalizeGuess(interaction.options.getString("키워드", true));

    if (guess === undefined) {
        await interaction.editReply({ content: "영문 알파벳 5글자만 입력할 수 있습니다." });
        return;
    }

    try {
        const puzzle = await nytWordleClient.getTodaysPuzzle();
        await userLock.runExclusive(interaction.user.id, () =>
            processGuess(interaction, puzzle, guess),
        );
    } catch (error) {
        if (error instanceof NytWordleServiceError) {
            console.error("오늘의 NYT Wordle을 불러오지 못했습니다.", error);
            await interaction.editReply({
                content: "오늘의 NYT Wordle을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
            });
            return;
        }

        if (error instanceof DictionaryServiceError) {
            console.error("Wordle 입력 단어를 사전에서 확인하지 못했습니다.", error);
            await interaction.editReply({
                content: "영어 사전에 있는 단어를 입력하세요.",
            });
            return;
        }

        throw error;
    }
}

export const wordleCommand: BotCommand = {
    data,
    execute: executeWordle,
};
