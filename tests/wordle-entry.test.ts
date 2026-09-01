import type { ChatInputCommandInteraction, Message } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import { WordlePuzzleUnavailableError } from "../src/features/wordle/application/puzzle-cache.js";
import { createWordleGame, submitGuess } from "../src/features/wordle/domain/game.js";
import { createWordleCommand, handleWordleModal, runWordle } from "../src/features/wordle/index.js";
import { LocalDictionary } from "../src/features/wordle/infrastructure/dictionary/local-dictionary.js";
import {
    createCommandInteraction,
    createDictionary,
    createModalInteraction,
    createPuzzleProvider,
    createWordleDependencies,
    createWordleStore,
    getComponentJson,
    seedSession,
    WORDLE_TEST_IDS,
    WORDLE_TEST_PUZZLE,
} from "./wordle-test-helpers.js";

const { guild: guildId } = WORDLE_TEST_IDS;
const puzzle = WORDLE_TEST_PUZZLE;

describe("Wordle 실행 흐름", () => {
    it("/워들 플레이는 비공개 화면과 서버 참여 상태를 생성합니다", async () => {
        const userId = "32345678901234567";
        const store = createWordleStore();
        const context = createCommandInteraction({ userId });

        await createWordleCommand(createWordleDependencies(store, createPuzzleProvider())).execute(
            context.interaction,
        );

        expect(context.send).not.toHaveBeenCalled();
        expect(store.getRecentPlayers(guildId, puzzle.printDate, 8)).toMatchObject({
            totalPlayers: 1,
            players: [{ activityOrder: 1, game: { guesses: [] }, userId }],
        });
        expect(getComponentJson(context.editReply)).toContain("### 나의 Wordle #1860");
        expect(getComponentJson(context.editReply)).toContain("단어 입력");
    });

    it("/워들 입력은 모달 없이 정규화한 추측을 제출합니다", async () => {
        const store = createWordleStore();
        const context = createCommandInteraction({ guess: "CRANE", subcommand: "입력" });
        const dictionaryRequest = vi
            .spyOn(LocalDictionary.prototype, "isEnglishWord")
            .mockReturnValue(true);

        try {
            await createWordleCommand(
                createWordleDependencies(store, createPuzzleProvider(), new LocalDictionary()),
            ).execute(context.interaction);

            expect(dictionaryRequest).toHaveBeenCalledWith("crane");
            expect(getComponentJson(context.editReply)).toContain("`CRANE`");
            expect(getComponentJson(context.editReply)).toContain("진행 중 · 1/6");
        } finally {
            dictionaryRequest.mockRestore();
        }
    });

    it("오늘 퍼즐 캐시가 없으면 전용 안내 화면을 표시합니다", async () => {
        const context = createCommandInteraction();
        const puzzleProvider = {
            getTodaysPuzzle: vi.fn(() => {
                throw new WordlePuzzleUnavailableError("cache miss");
            }),
        };

        await createWordleCommand(
            createWordleDependencies(createWordleStore(), puzzleProvider),
        ).execute(context.interaction);

        expect(getComponentJson(context.editReply)).toContain(
            "오늘의 Wordle이 아직 준비되지 않았습니다.",
        );
    });

    it("/워들 점수판은 공개 점수판과 이동 링크를 표시합니다", async () => {
        const messageId = "62345678901234567";
        const send = vi.fn().mockResolvedValue({ id: messageId });
        const context = createCommandInteraction({ send, subcommand: "점수판" });

        await createWordleCommand(
            createWordleDependencies(createWordleStore(), createPuzzleProvider()),
        ).execute(context.interaction);

        expect(getComponentJson(send)).toContain("### 오늘의 Wordle 점수판");
        expect(getComponentJson(context.editReply)).toContain(
            `https://discord.com/channels/${guildId}/${WORDLE_TEST_IDS.channel}/${messageId}`,
        );
    });

    it("/워들 기록은 저장된 개인 기록을 표시합니다", async () => {
        const store = createWordleStore();
        const gameContext = createCommandInteraction();

        await runWordle(gameContext.interaction, {
            ...createWordleDependencies(store, createPuzzleProvider(), createDictionary()),
            guess: "apple",
        });
        store.recordSpoilerUse(WORDLE_TEST_IDS.user, "genuine");
        store.recordUnregisteredWord(WORDLE_TEST_IDS.user);

        const recordContext = createCommandInteraction({
            recordUserId: WORDLE_TEST_IDS.user,
            subcommand: "기록",
        });
        await createWordleCommand(createWordleDependencies(store, createPuzzleProvider())).execute(
            recordContext.interaction,
        );

        const panelJson = getComponentJson(recordContext.reply);
        expect(panelJson).toContain("성공 횟수: **1회**");
        expect(panelJson).toContain("찐스포: **1회**");
        expect(panelJson).toContain("사전 미등록 단어 입력 횟수: **1회**");
    });

    it("/워들 기록은 기록 보유자가 없으면 빈 서버 순위를 표시합니다", async () => {
        const context = createCommandInteraction({ subcommand: "기록" });

        await createWordleCommand(
            createWordleDependencies(createWordleStore(), createPuzzleProvider()),
        ).execute(context.interaction);

        expect(context.fetchGuildMember).not.toHaveBeenCalled();
        expect(getComponentJson(context.editReply)).toContain("현재 서버 Wordle 기록 순위");
        expect(getComponentJson(context.editReply).match(/기록 없음/g)).toHaveLength(3);
    });
});

describe("Wordle 서버 간 진행 상태", () => {
    it("게임은 서버 간 공유하고 현재 서버의 공개 패널만 갱신합니다", async () => {
        const userId = "42345678901234567";
        const otherGuildId = WORDLE_TEST_IDS.otherGuild;
        const store = createWordleStore();
        const panelMessage = { editable: true } as Message;
        const panelEdit = vi.fn().mockResolvedValue(panelMessage);

        Object.assign(panelMessage, { edit: panelEdit });
        seedSession(
            store,
            { game: submitGuess(createWordleGame(puzzle), "crane"), panelMessage },
            userId,
        );

        const otherGuild = createCommandInteraction({ guildId: otherGuildId, userId });
        await runWordle(
            otherGuild.interaction,
            createWordleDependencies(store, createPuzzleProvider()),
        );
        expect(panelEdit).not.toHaveBeenCalled();
        expect(store.get(userId, puzzle.printDate, otherGuildId)?.game.guesses[0]?.word).toBe(
            "crane",
        );

        const currentGuild = createCommandInteraction({ userId });
        await runWordle(
            currentGuild.interaction,
            createWordleDependencies(store, createPuzzleProvider()),
        );
        expect(panelEdit).toHaveBeenCalledOnce();
    });

    it("다른 서버의 입력을 활성 화면과 참여 서버의 공개 현황에 반영합니다", async () => {
        const userId = "72345678901234567";
        const otherGuildId = "82345678901234567";
        const statusChannelId = "92345678901234567";
        const statusMessageId = "93345678901234567";
        const store = createWordleStore();
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
        await handleWordleModal(
            context.interaction,
            createWordleDependencies(store, createPuzzleProvider(), createDictionary()),
        );

        expect(sharedEdit).toHaveBeenCalledOnce();
        expect(privateEdit).toHaveBeenCalledOnce();
        expect(statusEdit).toHaveBeenCalledOnce();
        expect(store.get(userId, puzzle.printDate, guildId)?.game.guesses[0]?.word).toBe("crane");
        expect(store.get(userId, puzzle.printDate, otherGuildId)?.game.guesses[0]?.word).toBe(
            "crane",
        );
    });

    it("다른 서버의 비공개 메시지가 만료되어도 게임을 계속 진행합니다", async () => {
        const userId = "74345678901234567";
        const otherGuildId = "84345678901234567";
        const store = createWordleStore();
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
        await handleWordleModal(
            context.interaction,
            createWordleDependencies(store, createPuzzleProvider(), createDictionary()),
        );

        expect(expiredEdit).toHaveBeenCalledOnce();
        expect(context.editReply).toHaveBeenCalledOnce();
        expect(store.get(userId, puzzle.printDate, guildId)).toMatchObject({
            game: { guesses: [{ word: "crane" }] },
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
        });
    });
});
