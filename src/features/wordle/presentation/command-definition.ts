import { SlashCommandBuilder } from "discord.js";

export const WORDLE_GUESS_OPTION_NAME = "단어";
export const WORDLE_PLAY_SUBCOMMAND_NAME = "플레이";
export const WORDLE_INPUT_SUBCOMMAND_NAME = "입력";
export const WORDLE_SCOREBOARD_SUBCOMMAND_NAME = "점수판";
export const WORDLE_RECORDS_SUBCOMMAND_NAME = "기록";
export const WORDLE_RECORDS_USER_OPTION_NAME = "사용자";
export const WORDLE_REFRESH_TEST_SUBCOMMAND_NAME = "갱신_test";
export const WORDLE_YESTERDAY_RECORD_TEST_SUBCOMMAND_NAME = "어제기록_test";

export function createWordleCommandData(enableTestCommands: boolean) {
    const data = new SlashCommandBuilder()
        .setName("워들")
        .setDescription("워들이나 합시다.")
        .setDMPermission(false)
        .addSubcommand((subcommand) =>
            subcommand
                .setName(WORDLE_PLAY_SUBCOMMAND_NAME)
                .setDescription("오늘의 Wordle 플레이 화면을 표시합니다."),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName(WORDLE_INPUT_SUBCOMMAND_NAME)
                .setDescription("모달 없이 단어를 입력하고 플레이 화면을 표시합니다.")
                .addStringOption((option) =>
                    option
                        .setName(WORDLE_GUESS_OPTION_NAME)
                        .setDescription("바로 제출할 5글자 영단어")
                        .setMinLength(5)
                        .setMaxLength(5)
                        .setRequired(true),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName(WORDLE_SCOREBOARD_SUBCOMMAND_NAME)
                .setDescription("오늘의 Wordle 점수판을 표시합니다."),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName(WORDLE_RECORDS_SUBCOMMAND_NAME)
                .setDescription("사용자 개인 기록 또는 현재 서버의 전체 랭킹을 표시합니다.")
                .addUserOption((option) =>
                    option
                        .setName(WORDLE_RECORDS_USER_OPTION_NAME)
                        .setDescription(
                            "개인 기록을 확인할 사용자입니다. 생략하면 서버 랭킹입니다.",
                        )
                        .setRequired(false),
                ),
        );

    if (enableTestCommands) {
        data.addSubcommand((subcommand) =>
            subcommand
                .setName(WORDLE_REFRESH_TEST_SUBCOMMAND_NAME)
                .setDescription("오늘의 Wordle 정답 캐시를 강제로 갱신합니다."),
        ).addSubcommand((subcommand) =>
            subcommand
                .setName(WORDLE_YESTERDAY_RECORD_TEST_SUBCOMMAND_NAME)
                .setDescription("어제의 Wordle 기록판을 테스트합니다."),
        );
    }

    return data;
}
