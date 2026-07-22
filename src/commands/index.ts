import { helpCommand } from "./help.js";
import { pingCommand } from "./ping.js";
import { serverCommand } from "./server.js";
import { userCommand } from "./user.js";

import type { BotCommand } from "../types/command.js";

export const commands: readonly BotCommand[] = [
    pingCommand,
    serverCommand,
    userCommand,
    helpCommand,
];
