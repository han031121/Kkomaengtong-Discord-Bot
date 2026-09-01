import { createBotModules, createFeatureRegistrations } from "./app/feature-registry.js";
import { createClient, startBotModules, stopBot } from "./bot/create-client.js";
import { env } from "./config/env.js";

const registrations = createFeatureRegistrations({
    enableTestCommands: env.enableTestCommands,
    wordleDatabasePath: env.wordleDatabasePath,
});
const modules = createBotModules(registrations);
const client = createClient(modules);
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;
    console.log(`${signal} 신호를 받아 봇을 종료합니다.`);

    await stopBot(client, modules);
}

function requestShutdown(signal: string): void {
    void shutdown(signal).catch((error: unknown) => {
        console.error("봇을 정상적으로 종료하지 못했습니다.", error);
        process.exitCode = 1;
    });
}

process.once("SIGINT", () => {
    requestShutdown("SIGINT");
});

process.once("SIGTERM", () => {
    requestShutdown("SIGTERM");
});

try {
    await client.login(env.discordToken);
    await startBotModules(modules, client);
} catch (error) {
    console.error("Discord 봇을 시작하지 못했습니다.", error);
    await stopBot(client, modules).catch((shutdownError: unknown) => {
        console.error("시작 실패 후 봇을 정리하지 못했습니다.", shutdownError);
    });
    process.exitCode = 1;
}
