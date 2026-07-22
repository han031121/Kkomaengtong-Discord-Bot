import { MessageFlags, SlashCommandBuilder, time, TimestampStyles } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import type { BotCommand } from "../types/command.js";

const TEST_COMMAND_CHOICES = [
    { name: "핑", value: "ping" },
    { name: "서버", value: "server" },
    { name: "사용자", value: "user" },
    { name: "도움말", value: "help" },
    { name: "인사", value: "greeting" },
] as const;

function createPingResponse(interaction: ChatInputCommandInteraction): string {
    return `🏓 퐁! WebSocket 지연 시간: ${interaction.client.ws.ping}ms`;
}

function createServerResponse(interaction: ChatInputCommandInteraction): string {
    if (interaction.guild === null) {
        return "이 기능은 서버에서만 사용할 수 있습니다.";
    }

    return [
        `**서버 이름:** ${interaction.guild.name}`,
        `**서버 ID:** ${interaction.guild.id}`,
        `**멤버 수:** ${interaction.guild.memberCount}명`,
    ].join("\n");
}

function createUserResponse(interaction: ChatInputCommandInteraction): string {
    const { user } = interaction;

    return [
        `**사용자:** ${user.tag}`,
        `**사용자 ID:** ${user.id}`,
        `**계정 생성:** ${time(user.createdAt, TimestampStyles.LongDateTime)}`,
    ].join("\n");
}

function createHelpResponse(): string {
    return [
        "**사용 가능한 테스트 기능**",
        "`핑` - 봇의 응답 속도를 확인합니다.",
        "`서버` - 현재 서버 정보를 확인합니다.",
        "`사용자` - 내 Discord 계정 정보를 확인합니다.",
        "`도움말` - 이 안내를 표시합니다.",
        "`인사` - 꼬맹통봇과 인사합니다.",
    ].join("\n");
}

function createSelectionResponse(
    interaction: ChatInputCommandInteraction,
    selection: string | undefined,
): string {
    switch (selection) {
        case "ping":
            return createPingResponse(interaction);
        case "server":
            return createServerResponse(interaction);
        case "user":
            return createUserResponse(interaction);
        case "help":
            return createHelpResponse();
        case "greeting":
            return "안녕하세요 주인님";
        default:
            return "지원하지 않는 테스트 기능입니다.";
    }
}

const data = new SlashCommandBuilder()
    .setName("테스트")
    .setDescription("옵션에서 테스트할 기능을 고릅니다.");

data.addStringOption((option) =>
    option
        .setName("기능")
        .setDescription("실행할 테스트 기능을 선택합니다.")
        .setRequired(true)
        .addChoices(...TEST_COMMAND_CHOICES),
);

export const testCommand: BotCommand = {
    data,
    async execute(interaction) {
        const selection = interaction.options.getString("기능", true);

        await interaction.reply({
            content: createSelectionResponse(interaction, selection),
            flags: MessageFlags.Ephemeral,
        });
    },
};
