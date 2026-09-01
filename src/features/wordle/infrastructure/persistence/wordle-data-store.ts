import type { WordleRepository } from "../../application/ports.js";
import type { WordleGame, WordlePuzzle } from "../../domain/game.js";
import type {
    WordleGuildPersonalRecord,
    WordlePersonalRecord,
    WordlePublicStatusPanel,
    WordleRecentPlayers,
    WordleRecordResetResult,
    WordleServerRecordPanel,
    WordleSpoilerType,
    WordleYesterdayAnnouncementTarget,
} from "../../domain/models.js";
import { getPreviousWordlePrintDate } from "../../domain/print-date.js";
import { WordleActivityRepository } from "./sqlite/activity-repository.js";
import { WordleDatabase } from "./sqlite/database.js";
import type { WordleDatabaseOptions } from "./sqlite/database.js";
import { WordleGameRepository } from "./sqlite/game-repository.js";
import { WordlePanelRepository } from "./sqlite/panel-repository.js";
import { WordleRecordRepository } from "./sqlite/record-repository.js";
import { validatePuzzle } from "./sqlite/row-mappers.js";

export type WordleDataStoreOptions = WordleDatabaseOptions;

export class WordleDataStore implements WordleRepository {
    private readonly database: WordleDatabase;
    private readonly games: WordleGameRepository;
    private readonly activity: WordleActivityRepository;
    private readonly records: WordleRecordRepository;
    private readonly panels: WordlePanelRepository;

    public constructor(options: WordleDataStoreOptions = {}) {
        this.database = new WordleDatabase(options);
        const connection = this.database.connection;
        this.games = new WordleGameRepository(connection);
        this.activity = new WordleActivityRepository(connection);
        this.records = new WordleRecordRepository(connection);
        this.panels = new WordlePanelRepository(connection);
    }

    public activatePuzzle(puzzle: WordlePuzzle): string {
        validatePuzzle(puzzle);

        return this.database.runTransaction(() => {
            const latestPrintDate = this.games.getLatestPrintDate();

            if (latestPrintDate !== undefined && latestPrintDate > puzzle.printDate) {
                if (getPreviousWordlePrintDate(latestPrintDate) === puzzle.printDate) {
                    this.games.savePuzzle(puzzle);
                }

                return latestPrintDate;
            }

            this.records.finalizePreviousGames(puzzle.printDate);
            this.games.savePuzzle(puzzle);
            this.games.deletePuzzlesExcept([
                puzzle.printDate,
                getPreviousWordlePrintDate(puzzle.printDate),
            ]);

            return puzzle.printDate;
        });
    }

    public getPuzzle(printDate: string): WordlePuzzle | undefined {
        return this.games.getPuzzle(printDate);
    }

    public get(userId: string, printDate: string): WordleGame | undefined {
        return this.games.getGame(userId, printDate);
    }

    public set(userId: string, printDate: string, game: WordleGame): void {
        this.database.runTransaction(() => this.games.saveGame(userId, printDate, game));
    }

    public registerGuildParticipant(
        userId: string,
        printDate: string,
        guildId: string,
        channelId: string,
    ): number {
        return this.database.runTransaction(() =>
            this.activity.registerParticipant(userId, printDate, guildId, channelId),
        );
    }

    public recordValidGuess(
        userId: string,
        printDate: string,
        guildId: string,
        channelId: string,
        game: WordleGame,
    ): number {
        return this.database.runTransaction(() => {
            this.games.saveGame(userId, printDate, game);
            const activityOrder = this.activity.registerParticipant(
                userId,
                printDate,
                guildId,
                channelId,
            );

            if (game.status === "won" || game.status === "lost") {
                this.records.saveDailyResult(userId, printDate, game.status, game.guesses.length);
            }

            return activityOrder;
        });
    }

    public finalizeAbandonedGames(currentPrintDate: string): number {
        getPreviousWordlePrintDate(currentPrintDate);
        return this.database.runTransaction(() =>
            this.records.finalizePreviousGames(currentPrintDate),
        );
    }

    public resetGameRecordsForDate(printDate: string): WordleRecordResetResult {
        getPreviousWordlePrintDate(printDate);

        if (!this.games.hasPuzzle(printDate)) {
            throw new Error(
                `초기화 후 다시 반영할 Wordle 퍼즐이 저장되어 있지 않습니다: ${printDate}`,
            );
        }

        return this.database.runTransaction(() => this.records.resetGameRecordsForDate(printDate));
    }

    public getPersonalRecord(userId: string): WordlePersonalRecord {
        return this.records.getPersonalRecord(userId);
    }

    public listGuildPersonalRecords(guildId: string): readonly WordleGuildPersonalRecord[] {
        return this.records.listGuildPersonalRecords(guildId);
    }

    public recordSpoilerUse(userId: string, spoilerType: WordleSpoilerType): void {
        this.database.runTransaction(() => this.records.recordSpoilerUse(userId, spoilerType));
    }

    public recordUnregisteredWord(userId: string): void {
        this.database.runTransaction(() => this.records.recordUnregisteredWord(userId));
    }

    public listPendingYesterdayAnnouncements(
        currentPrintDate: string,
    ): readonly WordleYesterdayAnnouncementTarget[] {
        return this.panels.listPendingYesterdayAnnouncements(currentPrintDate);
    }

    public rearmYesterdayAnnouncements(currentPrintDate: string): number {
        return this.panels.rearmYesterdayAnnouncements(currentPrintDate);
    }

    public markYesterdayAnnouncementSent(
        target: WordleYesterdayAnnouncementTarget,
        messageId: string,
    ): void {
        this.panels.markYesterdayAnnouncementSent(target, messageId);
    }

    public listParticipantGuildIds(userId: string, printDate: string): readonly string[] {
        return this.activity.listParticipantGuildIds(userId, printDate);
    }

    public getRecentPlayers(
        guildId: string,
        printDate: string,
        limit: number,
    ): WordleRecentPlayers {
        return this.activity.getRecentPlayers(guildId, printDate, limit);
    }

    public getPublicStatusPanel(
        guildId: string,
        channelId: string,
    ): WordlePublicStatusPanel | undefined {
        return this.panels.getPublicStatusPanel(guildId, channelId);
    }

    public listPublicStatusPanels(
        guildId: string,
        printDate: string,
    ): readonly WordlePublicStatusPanel[] {
        return this.panels.listPublicStatusPanels(guildId, printDate);
    }

    public setPublicStatusPanel(panel: WordlePublicStatusPanel): void {
        this.panels.setPublicStatusPanel(panel);
    }

    public deletePublicStatusPanel(guildId: string, channelId: string): void {
        this.panels.deletePublicStatusPanel(guildId, channelId);
    }

    public getServerRecordPanel(
        guildId: string,
        channelId: string,
    ): WordleServerRecordPanel | undefined {
        return this.panels.getServerRecordPanel(guildId, channelId);
    }

    public setServerRecordPanel(panel: WordleServerRecordPanel): void {
        this.panels.setServerRecordPanel(panel);
    }

    public deleteServerRecordPanel(guildId: string, channelId: string): void {
        this.panels.deleteServerRecordPanel(guildId, channelId);
    }

    public close(): void {
        this.database.close();
    }
}
