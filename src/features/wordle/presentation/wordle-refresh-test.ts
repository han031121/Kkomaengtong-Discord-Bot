import { MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import { createNoticeEditResponse } from "../../../bot/response-builders.js";
import type { WordlePuzzleRefresher } from "../application/ports.js";
import { getPreviousWordlePrintDate } from "../domain/print-date.js";
import type { WordleSessionStore } from "./session-store.js";

export type { WordlePuzzleRefresher } from "../application/ports.js";

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

        await interaction.editReply(
            createNoticeEditResponse(
                [
                    `Wordle #${puzzle.puzzleNumber} 정답 캐시를 강제로 갱신했습니다.`,
                    `날짜: \`${puzzle.printDate}\``,
                    `정답: \`${puzzle.solution.toUpperCase()}\``,
                    "자정과 동일한 Wordle 날짜 전환 및 어제 기록판 전송 처리를 완료했습니다.",
                ].join("\n"),
            ),
        );
    } catch (error) {
        console.warn("Wordle 정답 캐시 갱신 또는 어제 기록판 전송에 실패했습니다.", error);
        await interaction.editReply(
            createNoticeEditResponse(
                "Wordle 정답 갱신 또는 어제 기록판 전송에 실패했습니다. 잠시 후 다시 시도해 주세요.",
            ),
        );
    }
}
