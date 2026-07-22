import { SlashCommandBuilder } from "discord.js";

import type { BotCommand } from "../types/command.js";

export const serverCommand: BotCommand = {
    data: new SlashCommandBuilder()
        .setName("서버")
        .setDescription("현재 Discord 서버의 정보를 표시합니다."),
    async execute(interaction) {
        if (interaction.guild === null) {
            await interaction.reply({
                content: "이 명령어는 서버에서만 사용할 수 있습니다.",
                ephemeral: true,
            });
            return;
        }

        await interaction.reply({
            content: [
                `**서버 이름:** ${interaction.guild.name}`,
                `**서버 ID:** ${interaction.guild.id}`,
                `**멤버 수:** ${interaction.guild.memberCount}명`,
            ].join("\n"),
            ephemeral: true,
        });
    },
};
