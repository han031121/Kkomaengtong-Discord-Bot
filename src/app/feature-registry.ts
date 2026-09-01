import type { BotCommandData, BotModule, BotModuleRegistration } from "../bot/contracts.js";
import { createTestRegistration } from "../features/test/index.js";
import { createWordleRegistration } from "../features/wordle/index.js";

export interface FeatureRegistryOptions {
    enableTestCommands: boolean;
    wordleDatabasePath: string;
}

export function createFeatureRegistrations(
    options: FeatureRegistryOptions,
): readonly BotModuleRegistration[] {
    const registrations = [
        createTestRegistration(),
        createWordleRegistration({
            databasePath: options.wordleDatabasePath,
            enableTestCommands: options.enableTestCommands,
        }),
    ];

    validateRegistrations(registrations);
    return registrations;
}

export function createBotModules(
    registrations: readonly BotModuleRegistration[],
): readonly BotModule[] {
    return registrations.map((registration) => registration.createModule());
}

export function collectCommandData(
    registrations: readonly BotModuleRegistration[],
): readonly BotCommandData[] {
    return registrations.flatMap((registration) => registration.commandData);
}

function validateRegistrations(registrations: readonly BotModuleRegistration[]): void {
    const moduleNames = new Set<string>();
    const commandNames = new Set<string>();

    for (const registration of registrations) {
        if (moduleNames.has(registration.name)) {
            throw new Error(`중복된 봇 모듈 이름입니다: ${registration.name}`);
        }

        moduleNames.add(registration.name);

        for (const commandData of registration.commandData) {
            if (commandNames.has(commandData.name)) {
                throw new Error(`중복된 명령어 이름입니다: ${commandData.name}`);
            }

            commandNames.add(commandData.name);
        }
    }
}
