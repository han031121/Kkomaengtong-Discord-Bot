import { submitGuess } from "../../features/wordle/game.js";
import type { LocalDictionary } from "../../features/wordle/local-dictionary.js";
import {
    createCompletedResponse,
    createNoticeEditResponse,
    createProgressResponse,
    getWordleGuildId,
    refreshOtherPrivateWordleStates,
    updatePrivateWordleState,
} from "./interaction-builders.js";
import type { WordleInteraction } from "./interaction-builders.js";
import { refreshSharedWordlePanels, refreshWordlePublicStatusPanels } from "./public-status.js";
import type { WordleSession, WordleSessionStore } from "./session-store.js";

export type WordleDictionary = Pick<LocalDictionary, "isEnglishWord">;

export async function processWordleGuess(
    interaction: WordleInteraction,
    printDate: string,
    guess: string,
    store: WordleSessionStore,
    dictionary: WordleDictionary,
): Promise<void> {
    const guildId = getWordleGuildId(interaction);
    const channelId = interaction.channelId;

    if (channelId === null) {
        throw new Error("Wordle 참여 채널을 찾을 수 없습니다.");
    }

    const currentSession = store.get(interaction.user.id, printDate, guildId);

    if (currentSession === undefined) {
        await interaction.editReply(
            createNoticeEditResponse(
                "Wordle 게임 정보를 찾을 수 없습니다. `/워들 플레이`로 게임을 다시 시작해 주세요.",
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

        store.recordUnregisteredWord(interaction.user.id);
        await updatePrivateWordleState(interaction, currentSession, invalidWordMessage, store);
        return;
    }

    const updatedGame = submitGuess(currentSession.game, guess);
    const sessionWithUpdatedGame: WordleSession = {
        ...currentSession,
        game: updatedGame,
    };
    store.recordValidGuess(
        interaction.user.id,
        printDate,
        guildId,
        channelId,
        sessionWithUpdatedGame,
    );
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
