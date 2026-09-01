import type { BotCommand, BotCommandData } from "../../../bot/contracts.js";
import { runWordle } from "./actions/play.js";
import type { RunWordleOptions } from "./actions/play.js";
import { runWordleRecords } from "./actions/records.js";
import { runWordleScoreboard } from "./actions/scoreboard.js";
import {
    createWordleCommandData,
    WORDLE_GUESS_OPTION_NAME,
    WORDLE_INPUT_SUBCOMMAND_NAME,
    WORDLE_PLAY_SUBCOMMAND_NAME,
    WORDLE_RECORDS_SUBCOMMAND_NAME,
    WORDLE_REFRESH_TEST_SUBCOMMAND_NAME,
    WORDLE_SCOREBOARD_SUBCOMMAND_NAME,
    WORDLE_YESTERDAY_RECORD_TEST_SUBCOMMAND_NAME,
} from "./command-definition.js";
import type { WordleInteractionDependencies } from "./interactions/context.js";
import { runWordleRefreshTest } from "./wordle-refresh-test.js";
import type { WordlePuzzleRefresher } from "./wordle-refresh-test.js";
import { runYesterdayWordleTest } from "./yesterday-wordle-test.js";

export type { WordlePuzzleProvider } from "../application/ports.js";
export type { RunWordleOptions } from "./actions/play.js";
export { runWordle } from "./actions/play.js";
export { runWordleRecords } from "./actions/records.js";
export { runWordleScoreboard } from "./actions/scoreboard.js";

export interface CreateWordleCommandOptions extends WordleInteractionDependencies {
    commandData?: BotCommandData;
    enableTestCommands?: boolean;
    puzzleRefresher?: WordlePuzzleRefresher;
}

export function createWordleCommand(options: CreateWordleCommandOptions): BotCommand {
    const {
        commandData = createWordleCommandData(options.enableTestCommands ?? false),
        enableTestCommands = false,
        puzzleRefresher,
    } = options;

    return {
        data: commandData,
        execute: async (interaction) => {
            const subcommand = interaction.options.getSubcommand();

            if (
                !enableTestCommands &&
                (subcommand === WORDLE_REFRESH_TEST_SUBCOMMAND_NAME ||
                    subcommand === WORDLE_YESTERDAY_RECORD_TEST_SUBCOMMAND_NAME)
            ) {
                throw new Error(`운영 환경에서 사용할 수 없는 Wordle 명령어입니다: ${subcommand}`);
            }

            switch (subcommand) {
                case WORDLE_PLAY_SUBCOMMAND_NAME:
                    return runWordle(interaction, options);
                case WORDLE_INPUT_SUBCOMMAND_NAME: {
                    const runOptions: RunWordleOptions = {
                        ...options,
                        guess: interaction.options.getString(WORDLE_GUESS_OPTION_NAME, true),
                    };
                    return runWordle(interaction, runOptions);
                }
                case WORDLE_SCOREBOARD_SUBCOMMAND_NAME:
                    return runWordleScoreboard(interaction, options.store, options.puzzleProvider);
                case WORDLE_RECORDS_SUBCOMMAND_NAME:
                    return runWordleRecords(interaction, options.store);
                case WORDLE_REFRESH_TEST_SUBCOMMAND_NAME:
                    if (puzzleRefresher === undefined) {
                        throw new Error("Wordle 퍼즐 갱신기가 설정되지 않았습니다.");
                    }

                    return runWordleRefreshTest(interaction, options.store, puzzleRefresher);
                case WORDLE_YESTERDAY_RECORD_TEST_SUBCOMMAND_NAME:
                    return runYesterdayWordleTest(
                        interaction,
                        options.store,
                        options.puzzleProvider,
                    );
                default:
                    throw new Error(`지원하지 않는 Wordle 서브커맨드입니다: ${subcommand}`);
            }
        },
    };
}
