import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import { createWordleGame, normalizeGuess } from "../../features/wordle/game.js";
import type { WordlePuzzle } from "../../features/wordle/game.js";
import { LocalDictionary } from "../../features/wordle/local-dictionary.js";
import {
    WordlePuzzleUnavailableError,
    wordlePuzzleCache,
} from "../../features/wordle/puzzle-cache.js";
import type { BotCommand } from "../../types/command.js";
import { runWordleRefreshTest } from "../wordle-refresh-test.js";
import type { WordlePuzzleRefresher } from "../wordle-refresh-test.js";
import { runYesterdayWordleTest } from "../yesterday-wordle-test.js";
import {
    createCompletedResponse,
    createNoticeEditResponse,
    defaultWordleSessionStore,
    deletePreviousPrivateResponse,
    getWordleGuildId,
    showPrivateWordleState,
    SUPPRESSED_ALLOWED_MENTIONS,
    updatePrivateWordleState,
    wordleUserLock,
} from "./interaction-builders.js";
import type { WordleInteraction } from "./interaction-builders.js";
import { processWordleGuess } from "./guess-processing.js";
import type { WordleDictionary } from "./guess-processing.js";
import { createPersonalWordleRecordContainer } from "./panel.js";
import {
    accessWordlePublicStatusPanel,
    refreshWordlePublicStatusPanels,
    updatePublicWordlePanel,
} from "./public-status.js";
import type { WordleSession, WordleSessionStore } from "./session-store.js";

const localDictionary = new LocalDictionary();
const WORDLE_GUESS_OPTION_NAME = "단어";
const WORDLE_PLAY_SUBCOMMAND_NAME = "플레이";
const WORDLE_INPUT_SUBCOMMAND_NAME = "입력";
const WORDLE_SCOREBOARD_SUBCOMMAND_NAME = "점수판";
const WORDLE_RECORDS_SUBCOMMAND_GROUP_NAME = "기록";
const WORDLE_PERSONAL_RECORDS_SUBCOMMAND_NAME = "개인";
const WORDLE_ALL_RECORDS_SUBCOMMAND_NAME = "전체";
const WORDLE_RECORDS_USER_OPTION_NAME = "사용자";
const WORDLE_REFRESH_TEST_SUBCOMMAND_NAME = "갱신_test";
const WORDLE_YESTERDAY_RECORD_TEST_SUBCOMMAND_NAME = "어제기록_test";

export interface WordlePuzzleProvider {
    getTodaysPuzzle(now?: Date): WordlePuzzle;
}

export interface RunWordleOptions {
    dictionary?: WordleDictionary;
    guess?: string;
    puzzleProvider?: WordlePuzzleProvider;
    store: WordleSessionStore;
}

function createWordleCommandData(enableTestCommands: boolean) {
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
        .addSubcommandGroup((group) =>
            group
                .setName(WORDLE_RECORDS_SUBCOMMAND_GROUP_NAME)
                .setDescription("개인 Wordle 기록과 현재 서버의 랭킹을 표시합니다.")
                .addSubcommand((subcommand) =>
                    subcommand
                        .setName(WORDLE_PERSONAL_RECORDS_SUBCOMMAND_NAME)
                        .setDescription("사용자의 Wordle 기록을 표시합니다.")
                        .addUserOption((option) =>
                            option
                                .setName(WORDLE_RECORDS_USER_OPTION_NAME)
                                .setDescription("기록을 확인할 사용자입니다. 생략하면 본인입니다.")
                                .setRequired(false),
                        ),
                )
                .addSubcommand((subcommand) =>
                    subcommand
                        .setName(WORDLE_ALL_RECORDS_SUBCOMMAND_NAME)
                        .setDescription("현재 서버의 Wordle 랭킹을 표시합니다."),
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

async function showWordlePuzzleUnavailableNotice(interaction: WordleInteraction): Promise<void> {
    await interaction.editReply(
        createNoticeEditResponse(
            "오늘의 Wordle이 아직 준비되지 않았습니다. 봇 시작 또는 날짜 갱신 시 캐시에 실패했을 수 있습니다.",
        ),
    );
}

export async function runWordle(
    interaction: WordleInteraction,
    options: RunWordleOptions,
): Promise<void> {
    const {
        dictionary = localDictionary,
        guess: rawGuess,
        puzzleProvider = wordlePuzzleCache,
        store,
    } = options;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const puzzle = puzzleProvider.getTodaysPuzzle();
        const game = createWordleGame(puzzle);
        await wordleUserLock.runExclusive(interaction.user.id, async () => {
            const guildId = getWordleGuildId(interaction);
            const channelId = interaction.channelId;

            if (channelId === null) {
                throw new Error("Wordle 참여 채널을 찾을 수 없습니다.");
            }

            const existingSession = store.get(interaction.user.id, puzzle.printDate, guildId);
            let session: WordleSession = existingSession ?? {
                game,
                panelMessage: undefined,
                privateResponseInteraction: undefined,
                privateResponseMessageId: undefined,
            };

            if (rawGuess === undefined && existingSession?.panelMessage !== undefined) {
                session = {
                    ...existingSession,
                    panelMessage: await updatePublicWordlePanel(
                        interaction,
                        existingSession,
                        existingSession.game,
                    ),
                };
            } else if (rawGuess !== undefined) {
                if (existingSession !== undefined) {
                    await deletePreviousPrivateResponse(existingSession, interaction);
                }
            }

            store.set(interaction.user.id, puzzle.printDate, guildId, session);
            store.registerGuildParticipant(
                interaction.user.id,
                puzzle.printDate,
                guildId,
                channelId,
            );
            await refreshWordlePublicStatusPanels(interaction, puzzle.printDate, store);

            if (rawGuess === undefined) {
                await showPrivateWordleState(
                    interaction,
                    session,
                    session.game.status === "playing"
                        ? undefined
                        : createCompletedResponse(session),
                    store,
                );
                return;
            }

            const guess = normalizeGuess(rawGuess);

            if (guess === undefined) {
                await updatePrivateWordleState(
                    interaction,
                    session,
                    "영문 알파벳 5글자만 입력할 수 있습니다.",
                    store,
                );
                return;
            }

            await processWordleGuess(interaction, puzzle.printDate, guess, store, dictionary);
        });
    } catch (error) {
        if (error instanceof WordlePuzzleUnavailableError) {
            console.error("오늘의 NYT Wordle 캐시를 찾을 수 없습니다.", error);
            await showWordlePuzzleUnavailableNotice(interaction);
            return;
        }

        throw error;
    }
}

export async function runWordleScoreboard(
    interaction: WordleInteraction,
    store: WordleSessionStore,
    puzzleProvider: WordlePuzzleProvider = wordlePuzzleCache,
): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const puzzle = puzzleProvider.getTodaysPuzzle();
        const guildId = getWordleGuildId(interaction);
        const channelId = interaction.channelId;

        if (channelId === null) {
            throw new Error("Wordle 점수판을 표시할 채널을 찾을 수 없습니다.");
        }

        if (store.getPuzzle(puzzle.printDate) === undefined) {
            store.activatePuzzle(puzzle);
        }

        const panelAccess = await accessWordlePublicStatusPanel(
            interaction,
            puzzle.printDate,
            store,
        );
        const panelUrl = `https://discord.com/channels/${guildId}/${channelId}/${panelAccess.messageId}`;
        const notice =
            panelAccess.action === "created"
                ? "이 채널에 오늘의 Wordle 점수판을 생성했습니다."
                : panelAccess.action === "existing"
                  ? "오늘의 Wordle 점수판이 채널의 최신 위치에 있습니다."
                  : "오늘의 Wordle 점수판을 채널 아래에 다시 생성했습니다.";

        await interaction.editReply(
            createNoticeEditResponse(`${notice}\n[오늘의 점수판으로 이동](${panelUrl})`),
        );
    } catch (error) {
        if (error instanceof WordlePuzzleUnavailableError) {
            console.error("오늘의 NYT Wordle 캐시를 찾을 수 없습니다.", error);
            await showWordlePuzzleUnavailableNotice(interaction);
            return;
        }

        throw error;
    }
}

export async function runPersonalWordleRecords(
    interaction: ChatInputCommandInteraction,
    store: WordleSessionStore,
): Promise<void> {
    const selectedUser = interaction.options.getUser(WORDLE_RECORDS_USER_OPTION_NAME);
    const targetUser = selectedUser ?? interaction.user;
    const record = store.getPersonalRecord(targetUser.id);

    await interaction.reply({
        components: [createPersonalWordleRecordContainer(targetUser.id, record)],
        flags: /*MessageFlags.Ephemeral |*/ MessageFlags.IsComponentsV2,
        allowedMentions: SUPPRESSED_ALLOWED_MENTIONS,
    });
}

export async function runAllWordleRecords(interaction: ChatInputCommandInteraction): Promise<void> {
    getWordleGuildId(interaction);

    await interaction.reply({
        content: "현재 서버의 Wordle 전체 기록 및 랭킹 기능은 준비 중입니다.",
        flags: MessageFlags.Ephemeral,
    });
}

export function createWordleCommand(
    store: WordleSessionStore,
    puzzleProvider: WordlePuzzleProvider = wordlePuzzleCache,
    puzzleRefresher: WordlePuzzleRefresher = wordlePuzzleCache,
    enableTestCommands = false,
): BotCommand {
    return {
        data: createWordleCommandData(enableTestCommands),
        execute: async (interaction) => {
            const subcommand = interaction.options.getSubcommand();
            const subcommandGroup = interaction.options.getSubcommandGroup(false);

            if (subcommandGroup === WORDLE_RECORDS_SUBCOMMAND_GROUP_NAME) {
                switch (subcommand) {
                    case WORDLE_PERSONAL_RECORDS_SUBCOMMAND_NAME:
                        return runPersonalWordleRecords(interaction, store);
                    case WORDLE_ALL_RECORDS_SUBCOMMAND_NAME:
                        return runAllWordleRecords(interaction);
                    default:
                        throw new Error(
                            `지원하지 않는 Wordle 기록 서브커맨드입니다: ${subcommand}`,
                        );
                }
            }

            if (subcommandGroup !== null) {
                throw new Error(`지원하지 않는 Wordle 서브커맨드 그룹입니다: ${subcommandGroup}`);
            }

            if (
                !enableTestCommands &&
                (subcommand === WORDLE_REFRESH_TEST_SUBCOMMAND_NAME ||
                    subcommand === WORDLE_YESTERDAY_RECORD_TEST_SUBCOMMAND_NAME)
            ) {
                throw new Error(`운영 환경에서 사용할 수 없는 Wordle 명령어입니다: ${subcommand}`);
            }

            switch (subcommand) {
                case WORDLE_PLAY_SUBCOMMAND_NAME:
                    return runWordle(interaction, { puzzleProvider, store });
                case WORDLE_INPUT_SUBCOMMAND_NAME:
                    return runWordle(interaction, {
                        guess: interaction.options.getString(WORDLE_GUESS_OPTION_NAME, true),
                        puzzleProvider,
                        store,
                    });
                case WORDLE_SCOREBOARD_SUBCOMMAND_NAME:
                    return runWordleScoreboard(interaction, store, puzzleProvider);
                case WORDLE_REFRESH_TEST_SUBCOMMAND_NAME:
                    return runWordleRefreshTest(interaction, store, puzzleRefresher);
                case WORDLE_YESTERDAY_RECORD_TEST_SUBCOMMAND_NAME:
                    return runYesterdayWordleTest(interaction, store, puzzleProvider);
                default:
                    throw new Error(`지원하지 않는 Wordle 서브커맨드입니다: ${subcommand}`);
            }
        },
    };
}

export function createDefaultWordleCommand(enableTestCommands = false): BotCommand {
    return createWordleCommand(
        defaultWordleSessionStore,
        wordlePuzzleCache,
        wordlePuzzleCache,
        enableTestCommands,
    );
}

export const wordleCommand = createDefaultWordleCommand();
