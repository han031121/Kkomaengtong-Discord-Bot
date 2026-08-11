import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import { getPreviousWordlePrintDate } from "../features/wordle/data-store.js";
import { wordlePuzzleCache } from "../features/wordle/puzzle-cache.js";
import type { BotCommand } from "../types/command.js";
import type { WordlePuzzleProvider } from "./wordle/command.js";
import { defaultWordleSessionStore, getWordleGuildId } from "./wordle/interaction-builders.js";
import type { WordleSessionStore } from "./wordle/session-store.js";
import { createYesterdayWordleRecordResponse } from "./wordle/yesterday-status.js";

const data = new SlashCommandBuilder()
    .setName("어제워들_test")
    .setDescription("어제의 Wordle 기록판을 테스트합니다.")
    .setDMPermission(false);

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

export function createYesterdayWordleTestCommand(
    store: WordleSessionStore,
    puzzleProvider: WordlePuzzleProvider = wordlePuzzleCache,
): BotCommand {
    return {
        data,
        execute: (interaction) => runYesterdayWordleTest(interaction, store, puzzleProvider),
    };
}

export const yesterdayWordleTestCommand = createYesterdayWordleTestCommand(
    defaultWordleSessionStore,
    wordlePuzzleCache,
);
