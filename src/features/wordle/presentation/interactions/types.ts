import type {
    ButtonInteraction,
    ChatInputCommandInteraction,
    ModalSubmitInteraction,
} from "discord.js";

export type WordleInteraction =
    ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction;

export type WordleButtonAction = "share" | "spoiler" | "input" | "status-panel" | "status-view";

export interface ParsedWordleTargetButton {
    action: WordleButtonAction;
    printDate: string;
    userId: string;
}

export type ParsedWordleButton = { action: "play" } | ParsedWordleTargetButton;

export interface ParsedWordleModal {
    action: "guess" | "spoiler";
    printDate: string;
    userId: string;
}
