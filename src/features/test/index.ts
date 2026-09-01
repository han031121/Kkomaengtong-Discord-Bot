import type { BotModuleRegistration } from "../../bot/contracts.js";
import { testCommand } from "./command.js";

export function createTestRegistration(): BotModuleRegistration {
    return {
        name: "test",
        commandData: [testCommand.data],
        createModule: () => ({
            name: "test",
            commands: [testCommand],
        }),
    };
}
