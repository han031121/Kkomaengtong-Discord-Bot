import type { ModalSubmitInteraction } from "discord.js";

import { normalizeGuess } from "../../domain/game.js";
import { processWordleGuess } from "../guess-processing.js";
import { createEphemeralNoticeResponse } from "./components.js";
import type { WordleInteractionDependencies } from "./context.js";
import { parseWordleModal, WORDLE_GUESS_INPUT_ID, WORDLE_SPOILER_INPUT_ID } from "./custom-id.js";
import { getWordleGuildId, updatePrivateWordleState } from "./private-state.js";
import { handleSpoilerButton } from "./spoiler-handler.js";

export async function handleWordleModal(
    interaction: ModalSubmitInteraction,
    dependencies: WordleInteractionDependencies,
): Promise<void> {
    const { dictionary, store, userLock } = dependencies;
    const parsedModal = parseWordleModal(interaction.customId);

    if (parsedModal === undefined) {
        return;
    }

    const guildId = getWordleGuildId(interaction);

    if (interaction.user.id !== parsedModal.userId) {
        const inputName = parsedModal.action === "guess" ? "단어 입력창" : "스포일러 입력창";

        await interaction.reply(
            createEphemeralNoticeResponse(
                `이 Wordle ${inputName}은 게임을 진행한 사용자만 사용할 수 있습니다.`,
            ),
        );
        return;
    }

    const session = store.get(parsedModal.userId, parsedModal.printDate, guildId);

    if (session === undefined) {
        await interaction.reply(
            createEphemeralNoticeResponse(
                "Wordle 게임 정보를 찾을 수 없습니다. `/워들 플레이`로 게임을 다시 시작해 주세요.",
            ),
        );
        return;
    }

    if (parsedModal.action === "spoiler") {
        if (session.game.status !== "won") {
            await interaction.reply(
                createEphemeralNoticeResponse(
                    "Wordle 성공 결과에서만 스포일러를 작성할 수 있습니다.",
                ),
            );
            return;
        }

        const spoilerWord = normalizeGuess(
            interaction.fields.getTextInputValue(WORDLE_SPOILER_INPUT_ID),
        );

        if (spoilerWord === undefined) {
            await interaction.reply(
                createEphemeralNoticeResponse("영문 알파벳 5글자만 입력할 수 있습니다."),
            );
            return;
        }

        await handleSpoilerButton(interaction, session, spoilerWord, store);
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

    await userLock.runExclusive(parsedModal.userId, () =>
        processWordleGuess(interaction, parsedModal.printDate, guess, store, dictionary),
    );
}
