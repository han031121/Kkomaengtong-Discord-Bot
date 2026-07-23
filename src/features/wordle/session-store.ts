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

type WordleServerState = Omit<WordleSession, "game">;

export class WordleSessionStore {
    private readonly games = new Map<string, WordleGame>();
    private readonly serverStates = new Map<string, WordleServerState>();

    public get(userId: string, printDate: string, guildId: string): WordleSession | undefined {
        const gameKey = this.createGameKey(userId, printDate);
        const game = this.games.get(gameKey);

        if (game === undefined) {
            return undefined;
        }

        const serverState = this.serverStates.get(this.createServerKey(gameKey, guildId));

        return {
            game,
            panelMessage: serverState?.panelMessage,
            privateResponseInteraction: serverState?.privateResponseInteraction,
            privateResponseMessageId: serverState?.privateResponseMessageId,
            resultShared: serverState?.resultShared ?? false,
        };
    }

    public set(userId: string, printDate: string, guildId: string, session: WordleSession): void {
        const gameKey = this.createGameKey(userId, printDate);
        this.games.set(gameKey, session.game);
        this.serverStates.set(this.createServerKey(gameKey, guildId), {
            panelMessage: session.panelMessage,
            privateResponseInteraction: session.privateResponseInteraction,
            privateResponseMessageId: session.privateResponseMessageId,
            resultShared: session.resultShared,
        });
    }

    private createGameKey(userId: string, printDate: string): string {
        return `${userId}:${printDate}`;
    }

    private createServerKey(gameKey: string, guildId: string): string {
        return `${guildId}:${gameKey}`;
    }
}
