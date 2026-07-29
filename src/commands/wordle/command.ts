import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import { createWordleGame, normalizeGuess } from "../../features/wordle/game.js";
import type { WordleGame, WordlePuzzle } from "../../features/wordle/game.js";
import { LocalDictionary } from "../../features/wordle/local-dictionary.js";
import {
    WordlePuzzleUnavailableError,
    wordlePuzzleCache,
} from "../../features/wordle/puzzle-cache.js";
import type { BotCommand } from "../../types/command.js";
import {
    createCompletedResponse,
    createNoticeEditResponse,
    defaultWordleSessionStore,
    deletePreviousPrivateResponse,
    getWordleGuildId,
    showPrivateWordleState,
    updatePrivateWordleState,
    wordleUserLock,
} from "./interaction-builders.js";
import { processWordleGuess } from "./modal-handler.js";
import type { WordleDictionary } from "./modal-handler.js";
import { refreshWordlePublicStatusPanels, updatePublicWordlePanel } from "./public-status.js";
import type { WordleSession, WordleSessionStore } from "./session-store.js";

const localDictionary = new LocalDictionary();
const WORDLE_GUESS_OPTION_NAME = "단어";

export interface WordlePuzzleProvider {
    getTodaysPuzzle(now?: Date): WordlePuzzle;
}

const data = new SlashCommandBuilder()
    .setName("워들")
    .setDescription("워들이나 합시다.")
    .setDMPermission(false);

data.addStringOption((option) =>
    option
        .setName(WORDLE_GUESS_OPTION_NAME)
        .setDescription("모달을 열지 않고 바로 제출할 5글자 영단어")
        .setMinLength(5)
        .setMaxLength(5)
        .setRequired(false),
);

function createNewWordleSession(game: WordleGame): WordleSession {
    return {
        game,
        panelMessage: undefined,
        privateResponseInteraction: undefined,
        privateResponseMessageId: undefined,
        resultShared: false,
    };
}

async function registerWordleCommandParticipation(
    interaction: ChatInputCommandInteraction,
    printDate: string,
    store: WordleSessionStore,
): Promise<void> {
    const guildId = getWordleGuildId(interaction);

    store.registerGuildParticipant(interaction.user.id, printDate, guildId);
    await refreshWordlePublicStatusPanels(interaction, printDate, store);
}

export async function startWordleGame(
    interaction: ChatInputCommandInteraction,
    game: WordleGame,
    store: WordleSessionStore,
): Promise<void> {
    const guildId = getWordleGuildId(interaction);
    const existingSession = store.get(interaction.user.id, game.puzzle.printDate, guildId);

    if (existingSession !== undefined) {
        const refreshedPanelMessage =
            existingSession.panelMessage === undefined
                ? undefined
                : await updatePublicWordlePanel(interaction, existingSession, existingSession.game);
        const refreshedSession: WordleSession = {
            ...existingSession,
            panelMessage: refreshedPanelMessage,
        };
        store.set(interaction.user.id, game.puzzle.printDate, guildId, refreshedSession);
        await registerWordleCommandParticipation(interaction, game.puzzle.printDate, store);

        await showPrivateWordleState(
            interaction,
            refreshedSession,
            refreshedSession.game.status === "playing"
                ? undefined
                : createCompletedResponse(refreshedSession),
            store,
        );
        return;
    }

    const session = createNewWordleSession(game);
    store.set(interaction.user.id, game.puzzle.printDate, guildId, session);
    await registerWordleCommandParticipation(interaction, game.puzzle.printDate, store);

    await showPrivateWordleState(interaction, session, undefined, store);
}

async function submitWordleCommandGuess(
    interaction: ChatInputCommandInteraction,
    game: WordleGame,
    rawGuess: string,
    store: WordleSessionStore,
    dictionary: WordleDictionary,
): Promise<void> {
    const guildId = getWordleGuildId(interaction);
    const existingSession = store.get(interaction.user.id, game.puzzle.printDate, guildId);
    const session: WordleSession = {
        ...(existingSession ?? createNewWordleSession(game)),
        resultShared: false,
    };

    if (existingSession !== undefined) {
        await deletePreviousPrivateResponse(existingSession, interaction);
    }
    store.set(interaction.user.id, game.puzzle.printDate, guildId, session);
    await registerWordleCommandParticipation(interaction, game.puzzle.printDate, store);

    const guess = normalizeGuess(rawGuess);

    if (guess === undefined) {
        await updatePrivateWordleState(
            interaction,
            session,
            "영문 알파벳 5글자만 입력할 수 있습니다.",
            store,
        );
        return;
    }

    await processWordleGuess(interaction, session.game.puzzle.printDate, guess, store, dictionary);
}

async function executeWordle(
    interaction: ChatInputCommandInteraction,
    store: WordleSessionStore,
    puzzleProvider: WordlePuzzleProvider,
): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const rawGuess = interaction.options.getString(WORDLE_GUESS_OPTION_NAME);

    try {
        const puzzle = puzzleProvider.getTodaysPuzzle();
        const game = createWordleGame(puzzle);
        await wordleUserLock.runExclusive(interaction.user.id, async () => {
            if (rawGuess === null) {
                await startWordleGame(interaction, game, store);
                return;
            }

            await submitWordleCommandGuess(interaction, game, rawGuess, store, localDictionary);
        });
    } catch (error) {
        if (error instanceof WordlePuzzleUnavailableError) {
            console.error("오늘의 NYT Wordle 캐시를 찾을 수 없습니다.", error);
            await interaction.editReply(
                createNoticeEditResponse(
                    "오늘의 Wordle이 아직 준비되지 않았습니다. 봇 시작 또는 날짜 갱신 시 캐시에 실패했을 수 있습니다.",
                ),
            );
            return;
        }

        throw error;
    }
}

export function createWordleCommand(
    store: WordleSessionStore,
    puzzleProvider: WordlePuzzleProvider = wordlePuzzleCache,
): BotCommand {
    return {
        data,
        execute: (interaction) => executeWordle(interaction, store, puzzleProvider),
    };
}

export const wordleCommand = createWordleCommand(defaultWordleSessionStore, wordlePuzzleCache);
