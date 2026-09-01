import type { Message } from "discord.js";

import type { WordleRepository } from "../application/ports.js";
import type { WordlePuzzle } from "../domain/game.js";
import type {
    WordleGuildPersonalRecord,
    WordlePersonalRecord,
    WordlePublicStatusPanel,
    WordleRecentPlayers,
    WordleServerRecordPanel,
    WordleSpoilerType,
    WordleYesterdayAnnouncementTarget,
} from "../domain/models.js";
import { getPreviousWordlePrintDate } from "../domain/print-date.js";
import { WordleSessionStateStore } from "./session-state.js";
import type { WordleSession } from "./session-state.js";

export type {
    WordleGuildPersonalRecord,
    WordlePersonalRecord,
    WordlePublicStatusPanel,
    WordleServerRecordPanel,
    WordleSpoilerType,
    WordleYesterdayAnnouncementTarget,
} from "../domain/models.js";
export type { WordleSession } from "./session-state.js";

export class WordleSessionStore {
    private readonly sessionStates = new WordleSessionStateStore();

    public constructor(private readonly dataStore: WordleRepository) {}

    public activatePuzzle(puzzle: WordlePuzzle): void {
        const activePrintDate = this.dataStore.activatePuzzle(puzzle);

        const retainedPrintDates = new Set([
            activePrintDate,
            getPreviousWordlePrintDate(activePrintDate),
        ]);

        this.sessionStates.retainPrintDates(retainedPrintDates);
    }

    public getPuzzle(printDate: string): WordlePuzzle | undefined {
        return this.dataStore.getPuzzle(printDate);
    }

    public get(userId: string, printDate: string, guildId: string): WordleSession | undefined {
        const game = this.dataStore.get(userId, printDate);

        if (game === undefined) {
            return undefined;
        }

        const serverState = this.sessionStates.get(userId, printDate, guildId);

        return {
            game,
            panelMessage: serverState?.panelMessage,
            privateResponseInteraction: serverState?.privateResponseInteraction,
            privateResponseMessageId: serverState?.privateResponseMessageId,
        };
    }

    public set(userId: string, printDate: string, guildId: string, session: WordleSession): void {
        this.dataStore.set(userId, printDate, session.game);
        this.sessionStates.store(userId, printDate, guildId, session);
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

        this.sessionStates.store(userId, printDate, guildId, session);
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
        return this.sessionStates.listGuildIds(userId, printDate);
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
        this.sessionStates.setSharedPanelMessage(userId, printDate, guildId, message);
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
}
