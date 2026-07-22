import { SlashCommandBuilder } from "discord.js";

import type { BotCommand } from "../types/command.js";

export const helpCommand: BotCommand = {
    data: new SlashCommandBuilder()
        .setName("도움말")
        .setDescription("사용할 수 있는 명령어를 안내합니다."),
    async execute(interaction) {
        await interaction.reply({
            content: [
                "**사용 가능한 명령어**",
                "`/핑` - 봇의 응답 속도를 확인합니다.",
                "`/서버` - 현재 서버 정보를 확인합니다.",
                "`/사용자` - 내 Discord 계정 정보를 확인합니다.",
                "`/도움말` - 이 안내를 표시합니다.",
            ].join("\n"),
            ephemeral: true,
        });
    },
};
