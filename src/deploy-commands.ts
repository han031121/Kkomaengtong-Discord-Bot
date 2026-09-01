import { REST, Routes } from "discord.js";

import { collectCommandData, createFeatureRegistrations } from "./app/feature-registry.js";
import { env } from "./config/env.js";

const registrations = createFeatureRegistrations({
    enableTestCommands: env.enableTestCommands,
    wordleDatabasePath: env.wordleDatabasePath,
});
const commandData = collectCommandData(registrations).map((data) => data.toJSON());
const rest = new REST().setToken(env.discordToken);
const route =
    env.discordGuildId === undefined
        ? Routes.applicationCommands(env.discordClientId)
        : Routes.applicationGuildCommands(env.discordClientId, env.discordGuildId);
const target = env.discordGuildId === undefined ? "전역" : `개발 서버(${env.discordGuildId})`;
const commandMode = env.enableTestCommands ? "테스트 명령 포함" : "운영 명령만";

try {
    console.log(`${commandData.length}개의 명령어를 ${target}에 등록합니다. (${commandMode})`);
    await rest.put(route, { body: commandData });
    console.log("명령어 등록을 완료했습니다.");
} catch (error) {
    console.error("명령어 등록에 실패했습니다.", error);
    process.exitCode = 1;
}
