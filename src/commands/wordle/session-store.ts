import type {
    ButtonInteraction,
    ChatInputCommandInteraction,
    Message,
    ModalSubmitInteraction,
} from "discord.js";

import { getPreviousWordlePrintDate, WordleDataStore } from "../../features/wordle/data-store.js";
import type {
    WordleDataStoreOptions,
    WordleGuildPersonalRecord,
    WordlePersonalRecord,
    WordlePublicStatusPanel,
    WordleRecentPlayers,
    WordleServerRecordPanel,
    WordleSpoilerType,
    WordleYesterdayAnnouncementTarget,
} from "../../features/wordle/data-store.js";
import type { WordleGame, WordlePuzzle } from "../../features/wordle/game.js";

export type {
    WordleGuildPersonalRecord,
    WordlePersonalRecord,
    WordlePublicStatusPanel,
    WordleServerRecordPanel,
    WordleSpoilerType,
    WordleYesterdayAnnouncementTarget,
} from "../../features/wordle/data-store.js";

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

    public registerGuildParticipant(
        userId: string,
        printDate: string,
        guildId: string,
        channelId: string,
    ): number {
        return this.dataStore.registerGuildParticipant(userId, printDate, guildId, channelId);
    }

    public recordValidGuess(
        userId: string,
        printDate: string,
        guildId: string,
        channelId: string,
        session: WordleSession,
    ): number {
        const activityOrder = this.dataStore.recordValidGuess(
            userId,
            printDate,
            guildId,
            channelId,
            session.game,
        );

        this.storeServerState(userId, printDate, guildId, session);
        return activityOrder;
    }

    public finalizeAbandonedGames(currentPrintDate: string): number {
        return this.dataStore.finalizeAbandonedGames(currentPrintDate);
    }

    public getPersonalRecord(userId: string): WordlePersonalRecord {
        return this.dataStore.getPersonalRecord(userId);
    }

    public listGuildPersonalRecords(guildId: string): readonly WordleGuildPersonalRecord[] {
        return this.dataStore.listGuildPersonalRecords(guildId);
    }

    public recordSpoilerUse(userId: string, spoilerType: WordleSpoilerType): void {
        this.dataStore.recordSpoilerUse(userId, spoilerType);
    }

    public recordUnregisteredWord(userId: string): void {
        this.dataStore.recordUnregisteredWord(userId);
    }

    public listPendingYesterdayAnnouncements(
        currentPrintDate: string,
    ): readonly WordleYesterdayAnnouncementTarget[] {
        return this.dataStore.listPendingYesterdayAnnouncements(currentPrintDate);
    }

    public rearmYesterdayAnnouncements(currentPrintDate: string): number {
        return this.dataStore.rearmYesterdayAnnouncements(currentPrintDate);
    }

    public markYesterdayAnnouncementSent(
        target: WordleYesterdayAnnouncementTarget,
        messageId: string,
    ): void {
        this.dataStore.markYesterdayAnnouncementSent(target, messageId);
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
        message: Message | undefined,
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

    public getServerRecordPanel(
        guildId: string,
        channelId: string,
    ): WordleServerRecordPanel | undefined {
        return this.dataStore.getServerRecordPanel(guildId, channelId);
    }

    public setServerRecordPanel(panel: WordleServerRecordPanel): void {
        this.dataStore.setServerRecordPanel(panel);
    }

    public deleteServerRecordPanel(guildId: string, channelId: string): void {
        this.dataStore.deleteServerRecordPanel(guildId, channelId);
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
