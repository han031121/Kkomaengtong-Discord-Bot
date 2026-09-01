import type { WordleGame } from "./game.js";

export interface WordleRecentPlayer {
    userId: string;
    game: WordleGame;
    activityOrder: number;
}

export interface WordleRecentPlayers {
    players: readonly WordleRecentPlayer[];
    totalPlayers: number;
}

export interface WordlePublicStatusPanel {
    guildId: string;
    channelId: string;
    messageId: string;
    printDate: string;
}

export interface WordleYesterdayAnnouncementTarget {
    guildId: string;
    channelId: string;
    recordDate: string;
}

export interface WordlePersonalRecord {
    averageGuessCount: number | undefined;
    fakeSpoilerCount: number;
    genuineSpoilerCount: number;
    playedCount: number;
    recentSuccessStreak: number;
    successCount: number;
    unregisteredWordCount: number;
    winRate: number | undefined;
}

export interface WordleGuildPersonalRecord {
    record: WordlePersonalRecord;
    userId: string;
}

export interface WordleServerRecordPanel {
    channelId: string;
    guildId: string;
    messageId: string;
}

export interface WordleRecordResetResult {
    printDate: string;
    reappliedParticipantCount: number;
    reappliedResultCount: number;
}

export type WordleSpoilerType = "fake" | "genuine";
export type WordleDailyResult = "abandoned" | "lost" | "won";
