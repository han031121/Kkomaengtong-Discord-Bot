import type {
    ButtonInteraction,
    ChatInputCommandInteraction,
    Message,
    ModalSubmitInteraction,
} from "discord.js";

import type { WordleGame } from "./game.js";

export interface WordleSession {
    game: WordleGame;
    panelMessage: Message | undefined;
    privateResponseInteraction:
        ButtonInteraction | ChatInputCommandInteraction | ModalSubmitInteraction | undefined;
    privateResponseMessageId: string | undefined;
    resultShared: boolean;
}

export class WordleSessionStore {
    private readonly sessions = new Map<string, WordleSession>();

    public get(userId: string, printDate: string): WordleSession | undefined {
        return this.sessions.get(this.createKey(userId, printDate));
    }

    public set(userId: string, printDate: string, session: WordleSession): void {
        this.sessions.set(this.createKey(userId, printDate), session);
    }

    private createKey(userId: string, printDate: string): string {
        return `${userId}:${printDate}`;
    }
}
