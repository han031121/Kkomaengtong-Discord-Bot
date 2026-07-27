import { createClient } from "./bot/create-client.js";
import { env } from "./config/env.js";
import { WordlePuzzleCache } from "./features/wordle/puzzle-cache.js";
import { WordleSessionStore } from "./features/wordle/session-store.js";

const wordleSessionStore = new WordleSessionStore({
    databasePath: env.wordleDatabasePath,
});
const wordlePuzzleCache = new WordlePuzzleCache();
const client = createClient(wordleSessionStore, wordlePuzzleCache);

async function refreshInitialWordlePuzzle(): Promise<void> {
    try {
        const puzzle = await wordlePuzzleCache.refresh();
        console.log(
            `오늘의 NYT Wordle #${puzzle.puzzleNumber}(${puzzle.printDate})을 캐시했습니다.`,
        );
    } catch (error) {
        console.error("봇 시작 시 오늘의 NYT Wordle을 캐시하지 못했습니다.", error);
    }
}

async function shutdown(signal: string): Promise<void> {
    console.log(`${signal} 신호를 받아 봇을 종료합니다.`);
    await client.destroy();
    wordlePuzzleCache.stopDailyRefresh();
    wordleSessionStore.close();
}

process.once("SIGINT", () => {
    void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
});

try {
    await refreshInitialWordlePuzzle();
    wordlePuzzleCache.startDailyRefresh();
    await client.login(env.discordToken);
} catch (error) {
    console.error("Discord 로그인에 실패했습니다.", error);
    wordlePuzzleCache.stopDailyRefresh();
    wordleSessionStore.close();
    process.exitCode = 1;
}
