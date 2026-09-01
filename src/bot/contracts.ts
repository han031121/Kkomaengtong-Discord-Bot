import type {
    ChatInputCommandInteraction,
    Client,
    Interaction,
    SlashCommandBuilder,
    SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

export type BotCommandData = SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder;

export interface BotCommand {
    data: BotCommandData;
    execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

export interface BotModule {
    name: string;
    commands: readonly BotCommand[];
    handleInteraction?(interaction: Interaction): Promise<boolean>;
    start?(client: Client): Promise<void> | void;
    stop?(): Promise<void> | void;
}

export interface BotModuleRegistration {
    name: string;
    commandData: readonly BotCommandData[];
    createModule(): BotModule;
}
