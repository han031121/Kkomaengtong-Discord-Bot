import type { WordleGame, WordlePuzzle } from "../domain/game.js";
import type {
    WordleGuildPersonalRecord,
    WordlePersonalRecord,
    WordlePublicStatusPanel,
    WordleRecentPlayers,
    WordleRecordResetResult,
    WordleServerRecordPanel,
    WordleSpoilerType,
    WordleYesterdayAnnouncementTarget,
} from "../domain/models.js";

export interface WordleDictionary {
    isEnglishWord(word: string): boolean;
}

export interface WordlePuzzleProvider {
    getTodaysPuzzle(now?: Date): WordlePuzzle;
}

export interface WordlePuzzleRequestOptions {
    forceRefresh?: boolean;
}

export interface WordlePuzzleClient {
    getPuzzle(date: string, options?: WordlePuzzleRequestOptions): Promise<WordlePuzzle>;
}

export interface WordlePuzzleRefresher {
    getTodaysPuzzle(now?: Date): WordlePuzzle;
    refreshForDateChangeTest(
        previousPuzzle: WordlePuzzle,
        prepareDateChange: () => void,
        now?: Date,
    ): Promise<WordlePuzzle>;
}

export interface WordleGameRepository {
    activatePuzzle(puzzle: WordlePuzzle): string;
    getPuzzle(printDate: string): WordlePuzzle | undefined;
    get(userId: string, printDate: string): WordleGame | undefined;
    set(userId: string, printDate: string, game: WordleGame): void;
}

export interface WordleActivityRepository {
    registerGuildParticipant(
        userId: string,
        printDate: string,
        guildId: string,
        channelId: string,
    ): number;
    recordValidGuess(
        userId: string,
        printDate: string,
        guildId: string,
        channelId: string,
        game: WordleGame,
    ): number;
    finalizeAbandonedGames(currentPrintDate: string): number;
    listParticipantGuildIds(userId: string, printDate: string): readonly string[];
    getRecentPlayers(guildId: string, printDate: string, limit: number): WordleRecentPlayers;
}

export interface WordleRecordRepository {
    getPersonalRecord(userId: string): WordlePersonalRecord;
    listGuildPersonalRecords(guildId: string): readonly WordleGuildPersonalRecord[];
    recordSpoilerUse(userId: string, spoilerType: WordleSpoilerType): void;
    recordUnregisteredWord(userId: string): void;
    resetGameRecordsForDate(printDate: string): WordleRecordResetResult;
}

export interface WordleAnnouncementRepository {
    listPendingYesterdayAnnouncements(
        currentPrintDate: string,
    ): readonly WordleYesterdayAnnouncementTarget[];
    rearmYesterdayAnnouncements(currentPrintDate: string): number;
    markYesterdayAnnouncementSent(
        target: WordleYesterdayAnnouncementTarget,
        messageId: string,
    ): void;
}

export interface WordlePanelRepository {
    getPublicStatusPanel(guildId: string, channelId: string): WordlePublicStatusPanel | undefined;
    listPublicStatusPanels(guildId: string, printDate: string): readonly WordlePublicStatusPanel[];
    setPublicStatusPanel(panel: WordlePublicStatusPanel): void;
    deletePublicStatusPanel(guildId: string, channelId: string): void;
    getServerRecordPanel(guildId: string, channelId: string): WordleServerRecordPanel | undefined;
    setServerRecordPanel(panel: WordleServerRecordPanel): void;
    deleteServerRecordPanel(guildId: string, channelId: string): void;
}

export interface ClosableRepository {
    close(): void;
}

export interface WordleRepository
    extends
        WordleGameRepository,
        WordleActivityRepository,
        WordleRecordRepository,
        WordleAnnouncementRepository,
        WordlePanelRepository,
        ClosableRepository {}
