import { MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import { getPreviousWordlePrintDate } from "../domain/print-date.js";
import type { WordlePuzzleProvider } from "./command.js";
import { getWordleGuildId } from "./interaction-builders.js";
import type { WordleSessionStore } from "./session-store.js";
import { createYesterdayWordleRecordResponse } from "./yesterday-status.js";

export async function runYesterdayWordleTest(
    interaction: ChatInputCommandInteraction,
    store: WordleSessionStore,
    puzzleProvider: WordlePuzzleProvider,
): Promise<void> {
    const guildId = getWordleGuildId(interaction);
    let response: ReturnType<typeof createYesterdayWordleRecordResponse>;

    try {
        const currentPuzzle = puzzleProvider.getTodaysPuzzle();
        const recordDate = getPreviousWordlePrintDate(currentPuzzle.printDate);

        response = createYesterdayWordleRecordResponse(store, guildId, recordDate);
    } catch (error) {
        console.warn("어제 Wordle 테스트 기록판을 생성하지 못했습니다.", error);
        await interaction.reply({
            content: "표시할 어제 Wordle 기록이 없습니다.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.reply(response);
}
