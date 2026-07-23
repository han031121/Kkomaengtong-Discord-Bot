import { testCommand } from "./test.js";
import { wordleCommand } from "./wordle.js";

import type { BotCommand } from "../types/command.js";

export const commands: readonly BotCommand[] = [testCommand, wordleCommand];
