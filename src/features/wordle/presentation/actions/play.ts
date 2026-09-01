import { MessageFlags } from "discord.js";

import type { WordleDictionary, WordlePuzzleProvider } from "../../application/ports.js";
import { createWordleGame, normalizeGuess } from "../../domain/game.js";
import {
    createCompletedResponse,
    deletePreviousPrivateResponse,
    getWordleGuildId,
    showPrivateWordleState,
    updatePrivateWordleState,
} from "../interactions/private-state.js";
import type { WordleUserLock } from "../interactions/context.js";
import type { WordleInteraction } from "../interactions/types.js";
import { processWordleGuess } from "../guess-processing.js";
import { refreshWordlePublicStatusPanels } from "../public-panels/status-board-refresh.js";
import { updatePublicWordlePanel } from "../public-panels/shared-game-panel.js";
import type { WordleSession, WordleSessionStore } from "../session-store.js";
import { handleWordlePuzzleUnavailable } from "./puzzle-unavailable.js";

export interface RunWordleOptions {
    dictionary: WordleDictionary;
    guess?: string;
    puzzleProvider: WordlePuzzleProvider;
    store: WordleSessionStore;
    userLock: WordleUserLock;
}

export async function runWordle(
    interaction: WordleInteraction,
    options: RunWordleOptions,
): Promise<void> {
    const { dictionary, guess: rawGuess, puzzleProvider, store, userLock } = options;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const puzzle = puzzleProvider.getTodaysPuzzle();
        const game = createWordleGame(puzzle);
        await userLock.runExclusive(interaction.user.id, async () => {
            const guildId = getWordleGuildId(interaction);
            const channelId = interaction.channelId;

            if (channelId === null) {
                throw new Error("Wordle 참여 채널을 찾을 수 없습니다.");
            }

            const existingSession = store.get(interaction.user.id, puzzle.printDate, guildId);
            let session: WordleSession = existingSession ?? {
                game,
                panelMessage: undefined,
                privateResponseInteraction: undefined,
                privateResponseMessageId: undefined,
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
            } else if (rawGuess !== undefined && existingSession !== undefined) {
                await deletePreviousPrivateResponse(existingSession, interaction);
            }

            store.set(interaction.user.id, puzzle.printDate, guildId, session);
            store.registerGuildParticipant(
                interaction.user.id,
                puzzle.printDate,
                guildId,
                channelId,
            );
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
        if (await handleWordlePuzzleUnavailable(interaction, error)) {
            return;
        }

        throw error;
    }
}
