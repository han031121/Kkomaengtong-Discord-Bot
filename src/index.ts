import { createClient } from "./bot/create-client.js";
import { publishPendingYesterdayWordleRecords, WordleSessionStore } from "./commands/wordle.js";
import { env } from "./config/env.js";
import { WordlePuzzleCache } from "./features/wordle/puzzle-cache.js";

const wordleSessionStore = new WordleSessionStore({
    databasePath: env.wordleDatabasePath,
});
const wordlePuzzleCache = new WordlePuzzleCache();
const client = createClient(wordleSessionStore, wordlePuzzleCache);
wordlePuzzleCache.addRefreshListener(async (puzzle) => {
    wordleSessionStore.activatePuzzle(puzzle);
    await publishPendingYesterdayWordleRecords(client, puzzle.printDate, wordleSessionStore);
});

async function shutdown(signal: string): Promise<void> {
    console.log(`${signal} 신호를 받아 봇을 종료합니다.`);
    wordlePuzzleCache.stopRefreshes();
    await client.destroy();
    wordleSessionStore.close();
}

process.once("SIGINT", () => {
    void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
});

try {
    await client.login(env.discordToken);
    wordlePuzzleCache.startStartupRefresh();
    wordlePuzzleCache.startDailyRefresh();
} catch (error) {
    console.error("Discord 로그인에 실패했습니다.", error);
    wordlePuzzleCache.stopRefreshes();
    wordleSessionStore.close();
    process.exitCode = 1;
}
