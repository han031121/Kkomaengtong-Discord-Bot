import { MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import { createNoticeEditResponse } from "../interactions/components.js";
import type { WordleInteractionDependencies } from "../interactions/context.js";
import { getWordleGuildId } from "../interactions/private-state.js";
import type { WordleInteraction } from "../interactions/types.js";
import { replacePublicWordlePanel } from "../public-panels/shared-game-panel.js";
import { handleWordlePuzzleUnavailable } from "./puzzle-unavailable.js";

type ShareWordleDependencies = Pick<WordleInteractionDependencies, "store" | "userLock">;

export async function shareWordleSession(
    interaction: WordleInteraction,
    printDate: string,
    dependencies: ShareWordleDependencies,
): Promise<boolean> {
    const { store, userLock } = dependencies;
    const guildId = getWordleGuildId(interaction);

    return userLock.runExclusive(interaction.user.id, async () => {
        const latestSession = store.get(interaction.user.id, printDate, guildId);

        if (latestSession === undefined) {
            return false;
        }

        const panelMessage = await replacePublicWordlePanel(
            interaction,
            latestSession,
            latestSession.game,
        );
        store.set(interaction.user.id, printDate, guildId, {
            ...latestSession,
            panelMessage,
        });
        return true;
    });
}

export async function runWordleShare(
    interaction: ChatInputCommandInteraction,
    dependencies: WordleInteractionDependencies,
): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const puzzle = dependencies.puzzleProvider.getTodaysPuzzle();
        const shared = await shareWordleSession(interaction, puzzle.printDate, dependencies);

        await interaction.editReply(
            createNoticeEditResponse(
                shared
                    ? "현재 Wordle 게임을 공유했습니다."
                    : "공유할 Wordle 게임이 없습니다. `/워들 플레이`로 게임을 시작해 주세요.",
            ),
        );
    } catch (error) {
        if (await handleWordlePuzzleUnavailable(interaction, error)) {
            return;
        }

        throw error;
    }
}
