import { SlashCommandBuilder } from "discord.js";

import type { BotCommand } from "../types/command.js";

export const pingCommand: BotCommand = {
    data: new SlashCommandBuilder()
        .setName("핑")
        .setDescription("봇의 WebSocket 응답 속도를 확인합니다."),
    async execute(interaction) {
        await interaction.reply({
            content: `🏓 퐁! WebSocket 지연 시간: ${interaction.client.ws.ping}ms`,
            ephemeral: true,
        });
    },
};
