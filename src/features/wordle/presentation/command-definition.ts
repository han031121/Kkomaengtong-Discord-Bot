import { SlashCommandBuilder } from "discord.js";

import { WORDLE_COMMAND } from "./command-metadata.js";

export { WORDLE_COMMAND } from "./command-metadata.js";

export function createWordleCommandData(enableTestCommands: boolean) {
    const { play, input, records, refreshTest, scoreboard, yesterdayRecordTest } =
        WORDLE_COMMAND.subcommands;
    const data = new SlashCommandBuilder()
        .setName(WORDLE_COMMAND.name)
        .setDescription(WORDLE_COMMAND.description)
        .setDMPermission(false)
        .addSubcommand((subcommand) =>
            subcommand.setName(play.name).setDescription(play.description),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName(input.name)
                .setDescription(input.description)
                .addStringOption((option) =>
                    option
                        .setName(input.guessOption.name)
                        .setDescription(input.guessOption.description)
                        .setMinLength(input.guessOption.minLength)
                        .setMaxLength(input.guessOption.maxLength)
                        .setRequired(true),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand.setName(scoreboard.name).setDescription(scoreboard.description),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName(records.name)
                .setDescription(records.description)
                .addUserOption((option) =>
                    option
                        .setName(records.userOption.name)
                        .setDescription(records.userOption.description)
                        .setRequired(false),
                ),
        );

    if (enableTestCommands) {
        data.addSubcommand((subcommand) =>
            subcommand.setName(refreshTest.name).setDescription(refreshTest.description),
        ).addSubcommand((subcommand) =>
            subcommand
                .setName(yesterdayRecordTest.name)
                .setDescription(yesterdayRecordTest.description),
        );
    }

    return data;
}
