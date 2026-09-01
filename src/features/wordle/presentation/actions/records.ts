import { MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import { WORDLE_RECORDS_USER_OPTION_NAME } from "../command-definition.js";
import { SUPPRESSED_ALLOWED_MENTIONS } from "../interactions/components.js";
import { getWordleGuildId } from "../interactions/private-state.js";
import { createPersonalWordleRecordContainer } from "../panel.js";
import {
    createWordleServerRecordRankings,
    filterCurrentGuildMemberRecords,
    replaceWordleServerRecordPanel,
} from "../records.js";
import type { WordleSessionStore } from "../session-store.js";

export async function runWordleRecords(
    interaction: ChatInputCommandInteraction,
    store: WordleSessionStore,
): Promise<void> {
    const selectedUser = interaction.options.getUser(WORDLE_RECORDS_USER_OPTION_NAME);

    if (selectedUser !== null) {
        const record = store.getPersonalRecord(selectedUser.id);

        await interaction.reply({
            components: [createPersonalWordleRecordContainer(selectedUser.id, record)],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: SUPPRESSED_ALLOWED_MENTIONS,
        });
        return;
    }

    const guildId = getWordleGuildId(interaction);
    const guild = interaction.guild;

    if (guild === null) {
        throw new Error("Wordle 전체 기록을 조회할 서버를 찾을 수 없습니다.");
    }

    await interaction.deferReply();

    const storedRecords = store.listGuildPersonalRecords(guildId);
    const currentMemberRecords = await filterCurrentGuildMemberRecords(guild, storedRecords);
    const rankings = createWordleServerRecordRankings(currentMemberRecords);

    await replaceWordleServerRecordPanel(interaction, store, rankings);
}
