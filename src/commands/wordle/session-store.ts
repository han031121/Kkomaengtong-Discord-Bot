import type {
    ButtonInteraction,
    ChatInputCommandInteraction,
    Message,
    ModalSubmitInteraction,
} from "discord.js";

import { getPreviousWordlePrintDate, WordleDataStore } from "../../features/wordle/data-store.js";
import type {
    WordleDataStoreOptions,
    WordlePublicStatusPanel,
    WordleRecentPlayers,
} from "../../features/wordle/data-store.js";
import type { WordleGame, WordlePuzzle } from "../../features/wordle/game.js";

export type { WordlePublicStatusPanel } from "../../features/wordle/data-store.js";

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

export class WordleSessionStore {
    private readonly dataStore: WordleDataStore;
    private readonly serverStates = new Map<string, StoredWordleServerState>();

    public constructor(options: WordleDataStoreOptions = {}) {
        this.dataStore = new WordleDataStore(options);
    }

    public activatePuzzle(puzzle: WordlePuzzle): void {
        const activePrintDate = this.dataStore.activatePuzzle(puzzle);

        const retainedPrintDates = new Set([
            activePrintDate,
            getPreviousWordlePrintDate(activePrintDate),
        ]);

        for (const [key, state] of this.serverStates) {
            if (!retainedPrintDates.has(state.printDate)) {
                this.serverStates.delete(key);
            }
        }
    }

    public getPuzzle(printDate: string): WordlePuzzle | undefined {
        return this.dataStore.getPuzzle(printDate);
    }

    public get(userId: string, printDate: string, guildId: string): WordleSession | undefined {
        const game = this.dataStore.get(userId, printDate);

        if (game === undefined) {
            return undefined;
        }

        const serverState = this.serverStates.get(this.createServerKey(userId, printDate, guildId));

        return {
            game,
            panelMessage: serverState?.panelMessage,
            privateResponseInteraction: serverState?.privateResponseInteraction,
            privateResponseMessageId: serverState?.privateResponseMessageId,
        };
    }

    public set(userId: string, printDate: string, guildId: string, session: WordleSession): void {
        this.dataStore.set(userId, printDate, session.game);
        this.storeServerState(userId, printDate, guildId, session);
    }

    public registerGuildParticipant(userId: string, printDate: string, guildId: string): number {
        return this.dataStore.registerGuildParticipant(userId, printDate, guildId);
    }

    public recordValidGuess(
        userId: string,
        printDate: string,
        guildId: string,
        session: WordleSession,
    ): number {
        const activityOrder = this.dataStore.recordValidGuess(
            userId,
            printDate,
            guildId,
            session.game,
        );

        this.storeServerState(userId, printDate, guildId, session);
        return activityOrder;
    }

    public listServerGuildIds(userId: string, printDate: string): readonly string[] {
        return [...this.serverStates.values()]
            .filter((state) => state.userId === userId && state.printDate === printDate)
            .map((state) => state.guildId);
    }

    public listParticipantGuildIds(userId: string, printDate: string): readonly string[] {
        return this.dataStore.listParticipantGuildIds(userId, printDate);
    }

    public setSharedPanelMessage(
        userId: string,
        printDate: string,
        guildId: string,
        message: Message,
    ): void {
        const key = this.createServerKey(userId, printDate, guildId);
        const state = this.serverStates.get(key);

        if (state === undefined) {
            return;
        }

        this.serverStates.set(key, {
            ...state,
            panelMessage: message,
        });
    }

    public getRecentPlayers(
        guildId: string,
        printDate: string,
        limit: number,
    ): WordleRecentPlayers {
        return this.dataStore.getRecentPlayers(guildId, printDate, limit);
    }

    public getPublicStatusPanel(
        guildId: string,
        channelId: string,
    ): WordlePublicStatusPanel | undefined {
        return this.dataStore.getPublicStatusPanel(guildId, channelId);
    }

    public listPublicStatusPanels(
        guildId: string,
        printDate: string,
    ): readonly WordlePublicStatusPanel[] {
        return this.dataStore.listPublicStatusPanels(guildId, printDate);
    }

    public setPublicStatusPanel(panel: WordlePublicStatusPanel): void {
        this.dataStore.setPublicStatusPanel(panel);
    }

    public deletePublicStatusPanel(guildId: string, channelId: string): void {
        this.dataStore.deletePublicStatusPanel(guildId, channelId);
    }

    public close(): void {
        this.dataStore.close();
    }

    private storeServerState(
        userId: string,
        printDate: string,
        guildId: string,
        session: WordleSession,
    ): void {
        this.serverStates.set(this.createServerKey(userId, printDate, guildId), {
            guildId,
            panelMessage: session.panelMessage,
            printDate,
            privateResponseInteraction: session.privateResponseInteraction,
            privateResponseMessageId: session.privateResponseMessageId,
            userId,
        });
    }

    private createServerKey(userId: string, printDate: string, guildId: string): string {
        return `${guildId}:${userId}:${printDate}`;
    }
}
