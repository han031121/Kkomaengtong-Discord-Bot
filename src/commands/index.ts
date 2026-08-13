import { testCommand } from "./test.js";
import { createDefaultWordleCommand } from "./wordle.js";

import type { BotCommand } from "../types/command.js";

export function createCommands(enableTestCommands = false): readonly BotCommand[] {
    return [testCommand, createDefaultWordleCommand(enableTestCommands)];
}

export const commands: readonly BotCommand[] = createCommands();
