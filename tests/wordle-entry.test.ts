import type { ChatInputCommandInteraction, Message } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import {
    createWordleCommand,
    handleWordleModal,
    runWordle,
    WordleSessionStore,
} from "../src/commands/wordle.js";
import { createWordleGame, submitGuess } from "../src/features/wordle/game.js";
import { LocalDictionary } from "../src/features/wordle/local-dictionary.js";
import { WordlePuzzleUnavailableError } from "../src/features/wordle/puzzle-cache.js";
import {
    createButtonInteraction,
    createCommandInteraction,
    createDictionary,
    createModalInteraction,
    createPuzzleProvider,
    getCallArgument,
    getComponentJson,
    seedSession,
    WORDLE_TEST_IDS,
    WORDLE_TEST_PUZZLE,
} from "./wordle-test-helpers.js";

const { guild: guildId } = WORDLE_TEST_IDS;
const puzzle = WORDLE_TEST_PUZZLE;

describe("Wordle 실행 진입점", () => {
    it("/워들 플레이는 공개 메시지 없이 비공개 게임 화면과 서버 참여 상태를 생성합니다", async () => {
        const userId = "32345678901234567";
        const store = new WordleSessionStore();
        const puzzleProvider = createPuzzleProvider();
        const context = createCommandInteraction({ userId });

        await createWordleCommand(store, puzzleProvider).execute(context.interaction);

        expect(puzzleProvider.getTodaysPuzzle).toHaveBeenCalledOnce();
        expect(context.send).not.toHaveBeenCalled();
        expect(store.getRecentPlayers(guildId, puzzle.printDate, 8)).toMatchObject({
            totalPlayers: 1,
            players: [{ activityOrder: 1, game: { guesses: [] }, userId }],
        });
        expect(getCallArgument<{ flags: number }>(context.editReply).flags).toBe(32_768);
        expect(getComponentJson(context.editReply)).toContain("### 나의 Wordle #1860");
        expect(getComponentJson(context.editReply)).toContain("단어 입력");
        expect(getComponentJson(context.editReply)).toContain("현황 공유");
        expect(getComponentJson(context.editReply)).toContain("점수판");
    });

    it("버튼도 공용 진입점에서 같은 비공개 화면과 서버 참여 상태를 생성합니다", async () => {
        const userId = "33345678901234567";
        const store = new WordleSessionStore();
        const context = createButtonInteraction("wordle:start", { userId });

        await runWordle(context.interaction, {
            puzzleProvider: createPuzzleProvider(),
            store,
        });

        expect(context.deferReply).toHaveBeenCalledWith({ flags: 64 });
        expect(store.getRecentPlayers(guildId, puzzle.printDate, 8)).toMatchObject({
            totalPlayers: 1,
            players: [{ activityOrder: 1, game: { guesses: [] }, userId }],
        });
        expect(getComponentJson(context.editReply)).toContain("### 나의 Wordle #1860");
        expect(getComponentJson(context.editReply)).toContain("단어 입력");
    });

    it("/워들 입력은 모달 없이 정규화한 추측을 제출합니다", async () => {
        const store = new WordleSessionStore();
        const context = createCommandInteraction({
            guess: "CRANE",
            guildId: "93345678901234567",
            subcommand: "입력",
            userId: "92345678901234567",
        });
        const dictionaryRequest = vi
            .spyOn(LocalDictionary.prototype, "isEnglishWord")
            .mockReturnValue(true);

        try {
            await createWordleCommand(store, createPuzzleProvider()).execute(context.interaction);

            expect(dictionaryRequest).toHaveBeenCalledWith("crane");
            expect(getComponentJson(context.editReply)).toContain("`CRANE`");
            expect(getComponentJson(context.editReply)).toContain("진행 중 · 1/6");
        } finally {
            dictionaryRequest.mockRestore();
        }
    });

    it("/워들 플레이만 실행해도 기존 공개 현황 패널에 0/6 참여 상태를 반영합니다", async () => {
        const userId = "34345678901234567";
        const channelId = "44345678901234567";
        const statusMessageId = "54345678901234567";
        const statusMessageEdit = vi.fn().mockResolvedValue(undefined);
        const fetchMessage = vi.fn().mockResolvedValue({ edit: statusMessageEdit });
        const store = new WordleSessionStore();
        const context = createCommandInteraction({ channelId, fetchMessage, userId });

        store.activatePuzzle(puzzle);
        store.setPublicStatusPanel({
            channelId,
            guildId,
            messageId: statusMessageId,
            printDate: puzzle.printDate,
        });
        await createWordleCommand(store, createPuzzleProvider()).execute(context.interaction);

        expect(statusMessageEdit).toHaveBeenCalledOnce();
        expect(getComponentJson(statusMessageEdit)).toContain(`<@${userId}> **진행 중** · **0/6**`);
        expect(getComponentJson(statusMessageEdit)).toContain("최근 활동 순 1명 표시 · 전체 1명");
    });

    it("오늘 퍼즐 캐시가 없으면 전용 안내 화면만 표시합니다", async () => {
        const context = createCommandInteraction();
        const puzzleProvider = {
            getTodaysPuzzle: vi.fn(() => {
                throw new WordlePuzzleUnavailableError("cache miss");
            }),
        };

        await createWordleCommand(new WordleSessionStore(), puzzleProvider).execute(
            context.interaction,
        );

        expect(puzzleProvider.getTodaysPuzzle).toHaveBeenCalledOnce();
        expect(getComponentJson(context.editReply)).toContain(
            "오늘의 Wordle이 아직 준비되지 않았습니다.",
        );
    });

    it("/워들 점수판은 오늘의 공개 점수판과 이동 링크를 표시합니다", async () => {
        const messageId = "62345678901234567";
        const send = vi.fn().mockResolvedValue({ id: messageId });
        const store = new WordleSessionStore();
        const context = createCommandInteraction({ send, subcommand: "점수판" });

        await createWordleCommand(store, createPuzzleProvider()).execute(context.interaction);

        expect(context.deferReply).toHaveBeenCalledWith({ flags: 64 });
        expect(getComponentJson(send)).toContain("### 오늘의 Wordle 점수판");
        expect(getComponentJson(send)).toContain("아직 Wordle에 참여한 사용자가 없습니다.");
        expect(getComponentJson(context.editReply)).toContain(
            `https://discord.com/channels/${guildId}/${WORDLE_TEST_IDS.channel}/${messageId}`,
        );
    });

    it("/워들 기록 개인은 사용자를 생략하면 실행자의 빈 기록을 표시합니다", async () => {
        const context = createCommandInteraction({ subcommand: "개인" });

        await createWordleCommand(new WordleSessionStore(), createPuzzleProvider()).execute(
            context.interaction,
        );

        expect(context.getUser).toHaveBeenCalledWith("사용자");
        const response = getCallArgument<{ flags: number }>(context.reply);

        expect(response.flags).toBe(32_768);
        expect(getComponentJson(context.reply)).toContain(
            `### <@${WORDLE_TEST_IDS.user}>님의 Wordle 개인 기록`,
        );
    });

    it("/워들 기록 개인은 선택한 사용자의 기록을 표시합니다", async () => {
        const context = createCommandInteraction({
            recordUserId: WORDLE_TEST_IDS.otherUser,
            subcommand: "개인",
        });

        await createWordleCommand(new WordleSessionStore(), createPuzzleProvider()).execute(
            context.interaction,
        );

        expect(getComponentJson(context.reply)).toContain(
            `### <@${WORDLE_TEST_IDS.otherUser}>님의 Wordle 개인 기록`,
        );
    });

    it("/워들 기록 개인은 저장된 게임·스포일러·사전 기록을 형식에 맞게 표시합니다", async () => {
        const store = new WordleSessionStore();
        const gameContext = createCommandInteraction();

        await runWordle(gameContext.interaction, {
            dictionary: createDictionary(),
            guess: "apple",
            puzzleProvider: createPuzzleProvider(),
            store,
        });
        store.recordSpoilerUse(WORDLE_TEST_IDS.user, "genuine");
        store.recordSpoilerUse(WORDLE_TEST_IDS.user, "fake");
        store.recordUnregisteredWord(WORDLE_TEST_IDS.user);

        const recordContext = createCommandInteraction({ subcommand: "개인" });
        await createWordleCommand(store, createPuzzleProvider()).execute(recordContext.interaction);

        const panelJson = getComponentJson(recordContext.reply);

        expect(panelJson).toContain("성공 횟수: **1회**");
        expect(panelJson).toContain("찐스포: **1회**");
        expect(panelJson).toContain("사전 미등록 단어 입력 횟수: **1회**");
    });

    it("/워들 기록 전체는 사용자 선택 없이 현재 서버 랭킹 준비 안내를 표시합니다", async () => {
        const context = createCommandInteraction({ subcommand: "전체" });

        await createWordleCommand(new WordleSessionStore(), createPuzzleProvider()).execute(
            context.interaction,
        );

        expect(context.getUser).not.toHaveBeenCalled();
        expect(context.reply).toHaveBeenCalledWith({
            content: "현재 서버의 Wordle 전체 기록 및 랭킹 기능은 준비 중입니다.",
            flags: 64,
        });
    });
});

describe("Wordle 서버 간 진행 상태", () => {
    it("게임은 서버 간 공유하고 현재 서버의 개인 공개 패널만 갱신합니다", async () => {
        const userId = "42345678901234567";
        const otherGuildId = WORDLE_TEST_IDS.otherGuild;
        const store = new WordleSessionStore();
        const panelMessage = { editable: true } as Message;
        const panelEdit = vi.fn().mockResolvedValue(panelMessage);

        Object.assign(panelMessage, { edit: panelEdit });
        seedSession(
            store,
            {
                game: submitGuess(createWordleGame(puzzle), "crane"),
                panelMessage,
            },
            userId,
        );

        const otherGuild = createCommandInteraction({ guildId: otherGuildId, userId });
        await runWordle(otherGuild.interaction, {
            puzzleProvider: createPuzzleProvider(),
            store,
        });

        expect(panelEdit).not.toHaveBeenCalled();
        expect(
            store
                .get(userId, puzzle.printDate, otherGuildId)
                ?.game.guesses.map((guess) => guess.word),
        ).toEqual(["crane"]);
        expect(store.get(userId, puzzle.printDate, otherGuildId)?.panelMessage).toBeUndefined();
        expect(getComponentJson(otherGuild.editReply)).toContain("`CRANE`");

        const currentGuild = createCommandInteraction({ userId });
        await runWordle(currentGuild.interaction, {
            puzzleProvider: createPuzzleProvider(),
            store,
        });

        expect(panelEdit).toHaveBeenCalledOnce();
        expect(store.get(userId, puzzle.printDate, guildId)?.panelMessage).toBe(panelMessage);
        expect(getComponentJson(panelEdit)).toContain("진행 중 · 1/6");
        expect(getComponentJson(currentGuild.editReply)).toContain("`CRANE`");
    });

    it("다른 서버의 입력을 모든 활성 화면과 참여 서버의 공개 현황에 반영합니다", async () => {
        const userId = "72345678901234567";
        const otherGuildId = "82345678901234567";
        const statusChannelId = "92345678901234567";
        const statusMessageId = "93345678901234567";
        const store = new WordleSessionStore();
        const sharedMessage = { editable: true } as Message;
        const sharedEdit = vi.fn().mockResolvedValue(sharedMessage);
        const privateEdit = vi.fn().mockResolvedValue({ id: "current-private" });
        const statusEdit = vi.fn().mockResolvedValue(undefined);
        const statusFetch = vi.fn().mockResolvedValue({ edit: statusEdit });
        const statusChannel = {
            isSendable: () => true,
            messages: { fetch: statusFetch },
        };

        Object.assign(sharedMessage, { edit: sharedEdit });
        seedSession(
            store,
            {
                panelMessage: sharedMessage,
                privateResponseInteraction: {
                    editReply: privateEdit,
                    guildId,
                    id: "current-command",
                    user: { id: userId },
                } as unknown as ChatInputCommandInteraction,
                privateResponseMessageId: "current-private",
            },
            userId,
        );
        seedSession(store, {}, userId, otherGuildId);
        store.registerGuildParticipant(userId, puzzle.printDate, guildId, statusChannelId);
        store.setPublicStatusPanel({
            channelId: statusChannelId,
            guildId,
            messageId: statusMessageId,
            printDate: puzzle.printDate,
        });

        const context = createModalInteraction({
            fetchChannel: vi.fn().mockResolvedValue(statusChannel),
            guildId: otherGuildId,
            userId,
        });
        await handleWordleModal(context.interaction, store, createDictionary());

        expect(sharedEdit).toHaveBeenCalledOnce();
        expect(privateEdit).toHaveBeenCalledOnce();
        expect(statusFetch).toHaveBeenCalledWith({ force: true, message: statusMessageId });
        expect(statusEdit).toHaveBeenCalledOnce();
        expect(store.get(userId, puzzle.printDate, guildId)?.game.guesses[0]?.word).toBe("crane");
        expect(store.get(userId, puzzle.printDate, otherGuildId)?.game.guesses[0]?.word).toBe(
            "crane",
        );
        expect(getComponentJson(sharedEdit)).toContain("진행 중 · 1/6");
        expect(getComponentJson(privateEdit)).toContain("`CRANE`");
        expect(getComponentJson(statusEdit)).toContain(`<@${userId}> **진행 중** · **1/6**`);
    });

    it("다른 서버의 비공개 메시지가 만료되어도 현재 서버의 게임을 진행합니다", async () => {
        const userId = "74345678901234567";
        const otherGuildId = "84345678901234567";
        const store = new WordleSessionStore();
        const expiredEdit = vi.fn().mockRejectedValue({ code: 10_015 });
        const expiredInteraction = {
            editReply: expiredEdit,
            guildId,
            id: "expired-interaction",
            user: { id: userId },
        } as unknown as ChatInputCommandInteraction;

        seedSession(
            store,
            {
                privateResponseInteraction: expiredInteraction,
                privateResponseMessageId: "expired-message",
            },
            userId,
        );
        seedSession(store, {}, userId, otherGuildId);

        const context = createModalInteraction({ guildId: otherGuildId, userId });
        await handleWordleModal(context.interaction, store, createDictionary());

        expect(expiredEdit).toHaveBeenCalledOnce();
        expect(context.editReply).toHaveBeenCalledOnce();
        expect(store.get(userId, puzzle.printDate, guildId)).toMatchObject({
            game: { guesses: [{ word: "crane" }] },
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
        });
    });
});
