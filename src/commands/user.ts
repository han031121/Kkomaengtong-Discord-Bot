import { SlashCommandBuilder, time, TimestampStyles } from "discord.js";

import type { BotCommand } from "../types/command.js";

export const userCommand: BotCommand = {
    data: new SlashCommandBuilder()
        .setName("사용자")
        .setDescription("내 Discord 계정 정보를 표시합니다."),
    async execute(interaction) {
        const { user } = interaction;

        await interaction.reply({
            content: [
                `**사용자:** ${user.tag}`,
                `**사용자 ID:** ${user.id}`,
                `**계정 생성:** ${time(user.createdAt, TimestampStyles.LongDateTime)}`,
            ].join("\n"),
            ephemeral: true,
        });
    },
};
