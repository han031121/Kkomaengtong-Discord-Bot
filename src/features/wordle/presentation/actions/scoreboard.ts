import { MessageFlags } from "discord.js";

import type { WordlePuzzleProvider } from "../../application/ports.js";
import { createNoticeEditResponse } from "../interactions/components.js";
import { getWordleGuildId } from "../interactions/private-state.js";
import type { WordleInteraction } from "../interactions/types.js";
import { accessWordlePublicStatusPanel } from "../public-panels/status-board-access.js";
import type { WordleSessionStore } from "../session-store.js";
import { handleWordlePuzzleUnavailable } from "./puzzle-unavailable.js";

export async function runWordleScoreboard(
    interaction: WordleInteraction,
    store: WordleSessionStore,
    puzzleProvider: WordlePuzzleProvider,
): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const puzzle = puzzleProvider.getTodaysPuzzle();
        const guildId = getWordleGuildId(interaction);
        const channelId = interaction.channelId;

        if (channelId === null) {
            throw new Error("Wordle 점수판을 표시할 채널을 찾을 수 없습니다.");
        }

        if (store.getPuzzle(puzzle.printDate) === undefined) {
            store.activatePuzzle(puzzle);
        }

        const panelAccess = await accessWordlePublicStatusPanel(
            interaction,
            puzzle.printDate,
            store,
        );
        const panelUrl = `https://discord.com/channels/${guildId}/${channelId}/${panelAccess.messageId}`;
        const notice =
            panelAccess.action === "created"
                ? "이 채널에 오늘의 Wordle 점수판을 생성했습니다."
                : panelAccess.action === "existing"
                  ? "오늘의 Wordle 점수판이 채널의 최신 위치에 있습니다."
                  : "오늘의 Wordle 점수판을 채널 아래에 다시 생성했습니다.";

        await interaction.editReply(
            createNoticeEditResponse(`${notice}\n[오늘의 점수판으로 이동](${panelUrl})`),
        );
    } catch (error) {
        if (await handleWordlePuzzleUnavailable(interaction, error)) {
            return;
        }

        throw error;
    }
}
