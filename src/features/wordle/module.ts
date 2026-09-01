import type { Interaction } from "discord.js";

import type { BotModule, BotModuleRegistration } from "../../bot/contracts.js";
import { AsyncKeyedLock } from "../../infrastructure/concurrency/async-keyed-lock.js";
import { WordlePuzzleCache } from "./application/puzzle-cache.js";
import { NytWordleClient } from "./infrastructure/clients/nyt-wordle-client.js";
import { LocalDictionary } from "./infrastructure/dictionary/local-dictionary.js";
import { WordleDataStore } from "./infrastructure/persistence/wordle-data-store.js";
import { createWordleCommandData } from "./presentation/command-definition.js";
import { createWordleCommand } from "./presentation/command.js";
import { handleWordleButton, handleWordleModal } from "./presentation/interaction-handlers.js";
import { isWordleButton, isWordleModal } from "./presentation/interaction-builders.js";
import { WordleSessionStore } from "./presentation/session-store.js";
import { publishPendingYesterdayWordleRecords } from "./presentation/yesterday-status.js";

export interface WordleRegistrationOptions {
    databasePath: string;
    enableTestCommands?: boolean;
}

export function createWordleRegistration(
    options: WordleRegistrationOptions,
): BotModuleRegistration {
    const enableTestCommands = options.enableTestCommands ?? false;
    const commandData = createWordleCommandData(enableTestCommands);

    return {
        name: "wordle",
        commandData: [commandData],
        createModule: () =>
            createWordleModule({
                commandData,
                databasePath: options.databasePath,
                enableTestCommands,
            }),
    };
}

interface CreateWordleModuleOptions {
    commandData: ReturnType<typeof createWordleCommandData>;
    databasePath: string;
    enableTestCommands: boolean;
}

function createWordleModule(options: CreateWordleModuleOptions): BotModule {
    const repository = new WordleDataStore({ databasePath: options.databasePath });
    const store = new WordleSessionStore(repository);
    const puzzleCache = new WordlePuzzleCache(new NytWordleClient());
    const interactionDependencies = {
        dictionary: new LocalDictionary(),
        puzzleProvider: puzzleCache,
        store,
        userLock: new AsyncKeyedLock(),
    };
    const command = createWordleCommand({
        ...interactionDependencies,
        commandData: options.commandData,
        enableTestCommands: options.enableTestCommands,
        puzzleRefresher: puzzleCache,
    });
    let removeBeforeRefreshListener: (() => void) | undefined;
    let removeRefreshListener: (() => void) | undefined;

    return {
        name: "wordle",
        commands: [command],
        handleInteraction: (interaction) =>
            handleWordleInteraction(interaction, interactionDependencies),
        start: (client) => {
            if (removeRefreshListener !== undefined) {
                return;
            }

            removeBeforeRefreshListener = puzzleCache.addBeforeRefreshListener((printDate) => {
                store.finalizeAbandonedGames(printDate);
            });
            removeRefreshListener = puzzleCache.addRefreshListener(async (puzzle) => {
                store.activatePuzzle(puzzle);
                await publishPendingYesterdayWordleRecords(client, puzzle.printDate, store);
            });
            puzzleCache.startStartupRefresh();
            puzzleCache.startDailyRefresh();
        },
        stop: async () => {
            await puzzleCache.stopRefreshes();
            removeBeforeRefreshListener?.();
            removeRefreshListener?.();
            removeBeforeRefreshListener = undefined;
            removeRefreshListener = undefined;
            store.close();
        },
    };
}

async function handleWordleInteraction(
    interaction: Interaction,
    dependencies: Parameters<typeof handleWordleButton>[1],
): Promise<boolean> {
    if (interaction.isButton() && isWordleButton(interaction.customId)) {
        await handleWordleButton(interaction, dependencies);
        return true;
    }

    if (interaction.isModalSubmit() && isWordleModal(interaction.customId)) {
        await handleWordleModal(interaction, dependencies);
        return true;
    }

    return false;
}
