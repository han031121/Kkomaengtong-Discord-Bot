import { MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import { getPreviousWordlePrintDate } from "../features/wordle/data-store.js";
import type { WordlePuzzle } from "../features/wordle/game.js";
import type { WordleSessionStore } from "./wordle/session-store.js";

export interface WordlePuzzleRefresher {
    getTodaysPuzzle(now?: Date): WordlePuzzle;
    refreshForDateChangeTest(
        previousPuzzle: WordlePuzzle,
        prepareDateChange: () => void,
        now?: Date,
    ): Promise<WordlePuzzle>;
}

export async function runWordleRefreshTest(
    interaction: ChatInputCommandInteraction,
    store: WordleSessionStore,
    puzzleRefresher: WordlePuzzleRefresher,
): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const currentPuzzle = puzzleRefresher.getTodaysPuzzle();
        const previousPrintDate = getPreviousWordlePrintDate(currentPuzzle.printDate);
        const previousPuzzle = store.getPuzzle(previousPrintDate);

        if (previousPuzzle === undefined) {
            throw new Error(`날짜 전환 테스트에 필요한 전날 퍼즐이 없습니다: ${previousPrintDate}`);
        }

        const puzzle = await puzzleRefresher.refreshForDateChangeTest(previousPuzzle, () => {
            store.rearmYesterdayAnnouncements(currentPuzzle.printDate);
        });

        await interaction.editReply({
            content: [
                `Wordle #${puzzle.puzzleNumber} 정답 캐시를 강제로 갱신했습니다.`,
                `날짜: \`${puzzle.printDate}\``,
                `정답: \`${puzzle.solution.toUpperCase()}\``,
                "자정과 동일한 Wordle 날짜 전환 및 어제 기록판 전송 처리를 완료했습니다.",
            ].join("\n"),
        });
    } catch (error) {
        console.warn("Wordle 정답 캐시 갱신 또는 어제 기록판 전송에 실패했습니다.", error);
        await interaction.editReply({
            content:
                "Wordle 정답 갱신 또는 어제 기록판 전송에 실패했습니다. 잠시 후 다시 시도해 주세요.",
        });
    }
}
