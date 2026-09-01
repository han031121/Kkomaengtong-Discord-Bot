import { WordlePuzzleUnavailableError } from "../../application/puzzle-cache.js";
import { createNoticeEditResponse } from "../interactions/components.js";
import type { WordleInteraction } from "../interactions/types.js";

export async function handleWordlePuzzleUnavailable(
    interaction: WordleInteraction,
    error: unknown,
): Promise<boolean> {
    if (!(error instanceof WordlePuzzleUnavailableError)) {
        return false;
    }

    console.error("오늘의 NYT Wordle 캐시를 찾을 수 없습니다.", error);
    await interaction.editReply(
        createNoticeEditResponse(
            "오늘의 Wordle이 아직 준비되지 않았습니다. 봇 시작 또는 날짜 갱신 시 캐시에 실패했을 수 있습니다.",
        ),
    );
    return true;
}
