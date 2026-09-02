import { ContainerBuilder, TextDisplayBuilder } from "@discordjs/builders";
import { Colors, MessageFlags } from "discord.js";

function createNoticeContainer(content: string): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(Colors.Yellow)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

export function createEphemeralNoticeResponse(content: string) {
    return {
        components: [createNoticeContainer(content)],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    };
}

export function createNoticeEditResponse(content: string) {
    return {
        content: null,
        embeds: [],
        components: [createNoticeContainer(content)],
        flags: MessageFlags.IsComponentsV2 as const,
    };
}
