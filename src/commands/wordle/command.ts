import { MessageFlags, SlashCommandBuilder } from "discord.js";

import { createWordleGame, normalizeGuess } from "../../features/wordle/game.js";
import type { WordlePuzzle } from "../../features/wordle/game.js";
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
import type { WordleInteraction } from "./interaction-builders.js";
import { processWordleGuess } from "./modal-handler.js";
import type { WordleDictionary } from "./modal-handler.js";
import { refreshWordlePublicStatusPanels, updatePublicWordlePanel } from "./public-status.js";
import type { WordleSession, WordleSessionStore } from "./session-store.js";

const localDictionary = new LocalDictionary();
const WORDLE_GUESS_OPTION_NAME = "단어";

export interface WordlePuzzleProvider {
    getTodaysPuzzle(now?: Date): WordlePuzzle;
}

export interface RunWordleOptions {
    dictionary?: WordleDictionary;
    guess?: string;
    puzzleProvider?: WordlePuzzleProvider;
    store: WordleSessionStore;
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

export async function runWordle(
    interaction: WordleInteraction,
    options: RunWordleOptions,
): Promise<void> {
    const {
        dictionary = localDictionary,
        guess: rawGuess,
        puzzleProvider = wordlePuzzleCache,
        store,
    } = options;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const puzzle = puzzleProvider.getTodaysPuzzle();
        const game = createWordleGame(puzzle);
        await wordleUserLock.runExclusive(interaction.user.id, async () => {
            const guildId = getWordleGuildId(interaction);
            const existingSession = store.get(interaction.user.id, puzzle.printDate, guildId);
            let session: WordleSession = existingSession ?? {
                game,
                panelMessage: undefined,
                privateResponseInteraction: undefined,
                privateResponseMessageId: undefined,
                resultShared: false,
            };

            if (rawGuess === undefined && existingSession?.panelMessage !== undefined) {
                session = {
                    ...existingSession,
                    panelMessage: await updatePublicWordlePanel(
                        interaction,
                        existingSession,
                        existingSession.game,
                    ),
                };
            } else if (rawGuess !== undefined) {
                if (existingSession !== undefined) {
                    await deletePreviousPrivateResponse(existingSession, interaction);
                }

                session = {
                    ...session,
                    resultShared: false,
                };
            }

            store.set(interaction.user.id, puzzle.printDate, guildId, session);
            store.registerGuildParticipant(interaction.user.id, puzzle.printDate, guildId);
            await refreshWordlePublicStatusPanels(interaction, puzzle.printDate, store);

            if (rawGuess === undefined) {
                await showPrivateWordleState(
                    interaction,
                    session,
                    session.game.status === "playing"
                        ? undefined
                        : createCompletedResponse(session),
                    store,
                );
                return;
            }

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

            await processWordleGuess(interaction, puzzle.printDate, guess, store, dictionary);
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
        execute: (interaction) => {
            const guess = interaction.options.getString(WORDLE_GUESS_OPTION_NAME);

            return runWordle(interaction, {
                ...(guess === null ? {} : { guess }),
                puzzleProvider,
                store,
            });
        },
    };
}

export const wordleCommand = createWordleCommand(defaultWordleSessionStore, wordlePuzzleCache);
