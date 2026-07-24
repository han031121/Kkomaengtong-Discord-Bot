import { createClient } from "./bot/create-client.js";
import { env } from "./config/env.js";
import { WordleSessionStore } from "./features/wordle/session-store.js";

const wordleSessionStore = new WordleSessionStore({
    databasePath: env.wordleDatabasePath,
});
const client = createClient(wordleSessionStore);

async function shutdown(signal: string): Promise<void> {
    console.log(`${signal} 신호를 받아 봇을 종료합니다.`);
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
} catch (error) {
    console.error("Discord 로그인에 실패했습니다.", error);
    wordleSessionStore.close();
    process.exitCode = 1;
}
