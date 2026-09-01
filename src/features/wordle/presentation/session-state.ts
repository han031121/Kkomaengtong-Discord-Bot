import type {
    ButtonInteraction,
    ChatInputCommandInteraction,
    Message,
    ModalSubmitInteraction,
} from "discord.js";

import type { WordleGame } from "../domain/game.js";

export interface WordleSession {
    game: WordleGame;
    panelMessage: Message | undefined;
    privateResponseInteraction:
        ButtonInteraction | ChatInputCommandInteraction | ModalSubmitInteraction | undefined;
    privateResponseMessageId: string | undefined;
}

type WordleServerState = Omit<WordleSession, "game">;

interface StoredWordleServerState extends WordleServerState {
    guildId: string;
    printDate: string;
    userId: string;
}

export class WordleSessionStateStore {
    private readonly states = new Map<string, StoredWordleServerState>();

    public get(userId: string, printDate: string, guildId: string): WordleServerState | undefined {
        return this.states.get(this.createKey(userId, printDate, guildId));
    }

    public store(userId: string, printDate: string, guildId: string, session: WordleSession): void {
        this.states.set(this.createKey(userId, printDate, guildId), {
            guildId,
            panelMessage: session.panelMessage,
            printDate,
            privateResponseInteraction: session.privateResponseInteraction,
            privateResponseMessageId: session.privateResponseMessageId,
            userId,
        });
    }

    public listGuildIds(userId: string, printDate: string): readonly string[] {
        return [...this.states.values()]
            .filter((state) => state.userId === userId && state.printDate === printDate)
            .map((state) => state.guildId);
    }

    public setSharedPanelMessage(
        userId: string,
        printDate: string,
        guildId: string,
        message: Message | undefined,
    ): void {
        const key = this.createKey(userId, printDate, guildId);
        const state = this.states.get(key);

        if (state === undefined) {
            return;
        }

        this.states.set(key, {
            ...state,
            panelMessage: message,
        });
    }

    public retainPrintDates(printDates: ReadonlySet<string>): void {
        for (const [key, state] of this.states) {
            if (!printDates.has(state.printDate)) {
                this.states.delete(key);
            }
        }
    }

    private createKey(userId: string, printDate: string, guildId: string): string {
        return `${guildId}:${userId}:${printDate}`;
    }
}
