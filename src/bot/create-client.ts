import { Client, Collection, Events, GatewayIntentBits } from "discord.js";
import type { Interaction } from "discord.js";

import { commands } from "../commands/index.js";
import type { BotCommand } from "../types/command.js";

export function createClient(): Client {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    const commandMap = new Collection<string, BotCommand>();

    for (const command of commands) {
        const commandName = command.data.name;

        if (commandMap.has(commandName)) {
            throw new Error(`중복된 명령어 이름입니다: ${commandName}`);
        }

        commandMap.set(commandName, command);
    }

    client.once(Events.ClientReady, (readyClient) => {
        console.log(`${readyClient.user.tag}(으)로 로그인했습니다.`);
    });

    async function handleInteraction(interaction: Interaction): Promise<void> {
        if (!interaction.isChatInputCommand()) {
            return;
        }

        const command = commandMap.get(interaction.commandName);

        if (command === undefined) {
            console.warn(`등록되지 않은 명령어 요청: ${interaction.commandName}`);
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(`명령어 실행 실패: ${interaction.commandName}`, error);

            const response = {
                content: "명령어를 처리하는 중 오류가 발생했습니다.",
                ephemeral: true,
            } as const;

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(response);
            } else {
                await interaction.reply(response);
            }
        }
    }

    client.on(Events.InteractionCreate, (interaction) => {
        void handleInteraction(interaction);
    });

    return client;
}
