import { testCommand } from "./test.js";
import { wordleCommand } from "./wordle.js";
import { wordleRefreshTestCommand } from "./wordle-refresh-test.js";
import { yesterdayWordleTestCommand } from "./yesterday-wordle-test.js";

import type { BotCommand } from "../types/command.js";

export const commands: readonly BotCommand[] = [
    testCommand,
    wordleCommand,
    wordleRefreshTestCommand,
    yesterdayWordleTestCommand,
];
