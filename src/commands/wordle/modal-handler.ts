import type { ModalSubmitInteraction } from "discord.js";

import { normalizeGuess, submitGuess } from "../../features/wordle/game.js";
import { LocalDictionary } from "../../features/wordle/local-dictionary.js";
import type { WordleSessionStore } from "../../features/wordle/session-store.js";
import type { WordleSession } from "../../features/wordle/session-store.js";
import {
    createCompletedResponse,
    createEphemeralNoticeResponse,
    createNoticeEditResponse,
    createProgressResponse,
    defaultWordleSessionStore,
    getWordleGuildId,
    parseWordleModal,
    refreshOtherPrivateWordleStates,
    updatePrivateWordleState,
    WORDLE_GUESS_INPUT_ID,
    wordleUserLock,
} from "./interaction-builders.js";
import type { WordleGuessInteraction } from "./interaction-builders.js";
import { refreshSharedWordlePanels, refreshWordlePublicStatusPanels } from "./public-status.js";

const localDictionary = new LocalDictionary();

export type WordleDictionary = Pick<LocalDictionary, "isEnglishWord">;

export async function processWordleGuess(
    interaction: WordleGuessInteraction,
    printDate: string,
    guess: string,
    store: WordleSessionStore,
    dictionary: WordleDictionary,
): Promise<void> {
    const guildId = getWordleGuildId(interaction);
    const currentSession = store.get(interaction.user.id, printDate, guildId);

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

    if (!dictionary.isEnglishWord(guess) && guess !== currentSession.game.puzzle.solution) {
        const invalidWordMessage =
            "등록된 5글자 영단어가 아닙니다. 입력 횟수는 차감되지 않았습니다.";

        await updatePrivateWordleState(interaction, currentSession, invalidWordMessage, store);
        return;
    }

    const updatedGame = submitGuess(currentSession.game, guess);
    const sessionWithUpdatedGame: WordleSession = {
        ...currentSession,
        game: updatedGame,
    };
    store.recordValidGuess(interaction.user.id, printDate, guildId, sessionWithUpdatedGame);
    const panelMessage = await refreshSharedWordlePanels(interaction, updatedGame, store);

    const updatedSession: WordleSession = {
        ...sessionWithUpdatedGame,
        panelMessage,
    };
    store.set(interaction.user.id, printDate, guildId, updatedSession);
    await updatePrivateWordleState(
        interaction,
        updatedSession,
        createProgressResponse(updatedGame),
        store,
    );
    await Promise.all([
        refreshOtherPrivateWordleStates(interaction, updatedGame, store),
        refreshWordlePublicStatusPanels(interaction, printDate, store),
    ]);
}

export async function handleWordleModal(
    interaction: ModalSubmitInteraction,
    store: WordleSessionStore = defaultWordleSessionStore,
    dictionary: WordleDictionary = localDictionary,
): Promise<void> {
    const parsedModal = parseWordleModal(interaction.customId);

    if (parsedModal === undefined) {
        return;
    }

    const guildId = getWordleGuildId(interaction);

    if (interaction.user.id !== parsedModal.userId) {
        await interaction.reply(
            createEphemeralNoticeResponse(
                "이 Wordle 단어 입력창은 게임을 진행한 사용자만 사용할 수 있습니다.",
            ),
        );
        return;
    }

    const session = store.get(parsedModal.userId, parsedModal.printDate, guildId);

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

    await wordleUserLock.runExclusive(parsedModal.userId, () =>
        processWordleGuess(interaction, parsedModal.printDate, guess, store, dictionary),
    );
}
