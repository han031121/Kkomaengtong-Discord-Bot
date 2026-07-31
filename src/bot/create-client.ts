import { Client, Collection, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import type {
    ButtonInteraction,
    ChatInputCommandInteraction,
    Interaction,
    ModalSubmitInteraction,
    RepliableInteraction,
} from "discord.js";

import { commands } from "../commands/index.js";
import {
    createWordleCommand,
    handleWordleButton,
    handleWordleModal,
    isWordleButton,
    isWordleModal,
    wordleCommand,
} from "../commands/wordle.js";
import type { WordlePuzzleProvider, WordleSessionStore } from "../commands/wordle.js";
import type { BotCommand } from "../types/command.js";

export function createClient(
    wordleSessionStore?: WordleSessionStore,
    wordlePuzzleProvider?: WordlePuzzleProvider,
): Client {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    const commandMap = new Collection<string, BotCommand>();

    for (const command of commands) {
        const commandName = command.data.name;

        if (commandMap.has(commandName)) {
            throw new Error(`중복된 명령어 이름입니다: ${commandName}`);
        }

        commandMap.set(commandName, command);
    }

    if (wordleSessionStore !== undefined) {
        commandMap.set(
            wordleCommand.data.name,
            createWordleCommand(wordleSessionStore, wordlePuzzleProvider),
        );
    }

    client.once(Events.ClientReady, (readyClient) => {
        console.log(`${readyClient.user.tag}(으)로 로그인했습니다.`);
    });

    async function handleChatInputCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        const command = commandMap.get(interaction.commandName);

        if (command === undefined) {
            console.warn(`등록되지 않은 명령어 요청: ${interaction.commandName}`);
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(`명령어 실행 실패: ${interaction.commandName}`, error);
            await sendErrorResponse(interaction);
        }
    }

    async function handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
        if (!isWordleButton(interaction.customId)) {
            return;
        }

        try {
            await handleWordleButton(interaction, wordleSessionStore, wordlePuzzleProvider);
        } catch (error) {
            console.error(`버튼 처리 실패: ${interaction.customId}`, error);
            await sendErrorResponse(interaction);
        }
    }

    async function handleModalSubmitInteraction(
        interaction: ModalSubmitInteraction,
    ): Promise<void> {
        if (!isWordleModal(interaction.customId)) {
            return;
        }

        try {
            await handleWordleModal(interaction, wordleSessionStore);
        } catch (error) {
            console.error(`모달 처리 실패: ${interaction.customId}`, error);
            await sendErrorResponse(interaction);
        }
    }

    async function sendErrorResponse(interaction: RepliableInteraction): Promise<void> {
        const response = {
            content: "요청을 처리하는 중 오류가 발생했습니다.",
            flags: MessageFlags.Ephemeral,
        } as const;

        if (interaction.deferred) {
            await interaction.editReply({ content: response.content });
        } else if (interaction.replied) {
            await interaction.followUp(response);
        } else {
            await interaction.reply(response);
        }
    }

    async function handleInteraction(interaction: Interaction): Promise<void> {
        if (interaction.isChatInputCommand()) {
            await handleChatInputCommand(interaction);
            return;
        }

        if (interaction.isButton()) {
            await handleButtonInteraction(interaction);
            return;
        }

        if (interaction.isModalSubmit()) {
            await handleModalSubmitInteraction(interaction);
        }
    }

    client.on(Events.InteractionCreate, (interaction) => {
        void handleInteraction(interaction);
    });

    return client;
}
