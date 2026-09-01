import { MessageFlags } from "discord.js";
import type { ButtonInteraction, ModalSubmitInteraction } from "discord.js";

import { createWordleSpoilerContainer } from "../panel.js";
import type { WordleSession, WordleSessionStore } from "../session-store.js";

export async function handleSpoilerButton(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    session: WordleSession,
    spoilerWord: string,
    store: WordleSessionStore,
): Promise<void> {
    const { user } = interaction;
    await interaction.deferUpdate();

    const channel =
        interaction.channel ??
        (interaction.channelId === null
            ? null
            : await interaction.client.channels.fetch(interaction.channelId));

    if (channel === null || !channel.isSendable()) {
        throw new Error("Wordle 스포일러를 보낼 수 있는 채널이 아닙니다.");
    }

    await channel.send({
        components: [createWordleSpoilerContainer(session.game, user.id, spoilerWord)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { users: [user.id] },
    });
    store.recordSpoilerUse(
        user.id,
        spoilerWord === session.game.puzzle.solution ? "genuine" : "fake",
    );
}
