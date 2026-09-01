import type { ChatInputCommandInteraction, Message } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import {
    createWordleGuessModal,
    createWordlePlayingButtons,
    createWordleResultButtons,
    createWordleResultComponents,
    createWordleSpoilerModal,
    handleWordleButton,
    handleWordleModal,
    isWordleButton,
    isWordleModal,
    showPrivateWordleState,
} from "../src/features/wordle/index.js";
import { createWordleGame, submitGuess } from "../src/features/wordle/domain/game.js";
import {
    createButtonInteraction,
    createCommandInteraction,
    createDictionary,
    createLostGame,
    createModalInteraction,
    createPuzzleProvider,
    createSession,
    createWordleDependencies,
    createWordleStore,
    getCallArgument,
    getComponentJson,
    seedSession,
    wordleButtonId,
    WORDLE_TEST_IDS,
    WORDLE_TEST_PUZZLE,
} from "./wordle-test-helpers.js";

const { guild: guildId, user: userId } = WORDLE_TEST_IDS;
const puzzle = WORDLE_TEST_PUZZLE;

describe("Wordle UI 구성 요소", () => {
    it("게임 상태에 맞는 버튼과 입력 모달을 구성합니다", () => {
        const playingSession = createSession({
            game: submitGuess(createWordleGame(puzzle), "crane"),
            panelMessage: { id: "panel" } as Message,
        });
        const wonSession = createSession({
            game: submitGuess(createWordleGame(puzzle), "apple"),
        });
        const playingButtons = createWordlePlayingButtons(playingSession, userId).toJSON();
        const resultButtons = createWordleResultButtons(wonSession, userId).toJSON();
        const guessModal = createWordleGuessModal(puzzle.printDate, userId).toJSON();
        const spoilerModal = createWordleSpoilerModal(
            puzzle.printDate,
            userId,
            puzzle.solution,
        ).toJSON();

        expect(playingButtons.components).toMatchObject([
            { custom_id: wordleButtonId("input"), label: "단어 입력" },
            { custom_id: wordleButtonId("share"), label: "현황 공유" },
            { custom_id: wordleButtonId("status-panel"), label: "점수판" },
        ]);
        expect(resultButtons.components).toMatchObject([
            { custom_id: wordleButtonId("share"), disabled: false, label: "결과 공유" },
            { custom_id: wordleButtonId("spoiler"), label: "스포하기" },
            { custom_id: wordleButtonId("status-panel"), label: "점수판" },
        ]);
        expect(createWordleResultComponents(playingSession, userId)).toEqual([]);
        expect(
            createWordleResultComponents(
                createSession({ game: createLostGame() }),
                userId,
            )[0]?.toJSON().components,
        ).toMatchObject([{ label: "결과 공유" }, { label: "점수판" }]);
        expect(guessModal).toMatchObject({
            custom_id: `wordle:guess-modal:${puzzle.printDate}:${userId}`,
            title: "Wordle 단어 입력",
        });
        expect(spoilerModal).toMatchObject({
            custom_id: `wordle:spoiler-modal:${puzzle.printDate}:${userId}`,
            title: "Wordle 스포일러 입력",
        });
        expect(JSON.stringify(spoilerModal)).toContain('"value":"APPLE"');
    });
});

describe("Wordle 식별자 검증", () => {
    it("지원하는 식별자 형식만 허용합니다", () => {
        const validButtons = [
            "wordle:play",
            "wordle:share:2026-07-23:12345678901234567",
            "wordle:spoiler:2026-07-23:12345678901234567",
            "wordle:input:2026-07-23:12345678901234567",
            "wordle:progress-share:2026-07-23:12345678901234567",
            "wordle:status-panel:2026-07-23:12345678901234567",
            "wordle:status-view:2026-07-23:12345678901234567",
        ];
        const invalidButtons = [
            "wordle:play:2026-07-23:12345678901234567",
            "wordle:view:2026-07-23:12345678901234567",
            "wordle:share:wrong-date:12345678901234567",
            "another:share:2026-07-23:12345678901234567",
        ];
        const modals = [
            ["wordle:guess-modal:2026-07-23:12345678901234567", true],
            ["wordle:spoiler-modal:2026-07-23:12345678901234567", true],
            ["wordle:guess-modal:wrong-date:12345678901234567", false],
            ["wordle:spoiler-modal:wrong-date:12345678901234567", false],
            ["wordle:input:2026-07-23:12345678901234567", false],
        ] as const;

        for (const customId of validButtons) {
            expect(isWordleButton(customId)).toBe(true);
        }
        for (const customId of invalidButtons) {
            expect(isWordleButton(customId)).toBe(false);
        }
        for (const [customId, expected] of modals) {
            expect(isWordleModal(customId)).toBe(expected);
        }
    });
});

describe("Wordle 버튼 상호작용", () => {
    it("결과 공유를 다시 누르면 기존 개인 공개 패널을 삭제하고 새로 공유합니다", async () => {
        const ownerId = "62345678901234567";
        const store = createWordleStore();
        const deletePreviousPanel = vi.fn().mockResolvedValue(undefined);
        const previousPanelMessage = {
            delete: deletePreviousPanel,
            id: "previous-lost-result-panel",
        } as unknown as Message;
        const replacementPanelMessage = { id: "replacement-lost-result-panel" } as Message;
        const send = vi.fn().mockResolvedValue(replacementPanelMessage);
        const context = createButtonInteraction(wordleButtonId("share", ownerId), {
            send,
            userId: ownerId,
        });

        seedSession(store, { game: createLostGame(), panelMessage: previousPanelMessage }, ownerId);
        await handleWordleButton(context.interaction, createWordleDependencies(store));

        expect(deletePreviousPanel).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledOnce();
        expect(store.get(ownerId, puzzle.printDate, guildId)?.panelMessage).toBe(
            replacementPanelMessage,
        );
        expect(getComponentJson(send)).toContain("종료 · X/6");
        expect(getComponentJson(context.editReply)).toContain('"label":"결과 공유"');
        expect(getComponentJson(context.editReply)).toContain('"disabled":false');
    });

    it("공개 현황의 보기 버튼은 누구나 최신 보드를 비공개로 확인합니다", async () => {
        const viewerId = WORDLE_TEST_IDS.otherUser;
        const store = createWordleStore();
        const context = createButtonInteraction(wordleButtonId("status-view"), {
            userId: viewerId,
        });

        seedSession(store, {
            game: submitGuess(createWordleGame(puzzle), "alley"),
        });
        await handleWordleButton(context.interaction, createWordleDependencies(store));

        const response = getCallArgument<{
            allowedMentions: unknown;
            flags: number;
        }>(context.reply);

        expect(response.flags).toBe(32_832);
        expect(response.allowedMentions).toEqual({
            parse: [],
            repliedUser: false,
            roles: [],
            users: [],
        });
        expect(getComponentJson(context.reply)).toContain(`<@${userId}>님의 Wordle #1860`);
        expect(getComponentJson(context.reply)).toContain("🟩🟨⬛🟨⬛");
        expect(getComponentJson(context.reply)).not.toContain("alley");
        expect(getComponentJson(context.reply)).not.toContain("apple");
        expect(getComponentJson(context.reply, 0, 1)).toContain('"label":"지금 플레이"');
    });

    it("스포일러 버튼은 단어를 바로 공개하지 않고 입력 모달을 표시합니다", async () => {
        const store = createWordleStore();
        const send = vi.fn().mockResolvedValue({ id: "spoiler-message" });
        const context = createButtonInteraction(wordleButtonId("spoiler"), { send });

        seedSession(store, {
            game: submitGuess(createWordleGame(puzzle), "apple"),
        });
        await handleWordleButton(context.interaction, createWordleDependencies(store));

        expect(context.showModal).toHaveBeenCalledOnce();
        expect(getCallArgument<{ toJSON(): unknown }>(context.showModal).toJSON()).toMatchObject({
            custom_id: `wordle:spoiler-modal:${puzzle.printDate}:${userId}`,
            title: "Wordle 스포일러 입력",
        });
        expect(
            JSON.stringify(getCallArgument<{ toJSON(): unknown }>(context.showModal).toJSON()),
        ).toContain('"value":"APPLE"');
        expect(context.deferUpdate).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    it("단어 입력 버튼은 해당 사용자의 입력 모달을 표시합니다", async () => {
        const store = createWordleStore();
        const context = createButtonInteraction(wordleButtonId("input"));

        seedSession(store, { panelMessage: { id: "panel" } as Message });
        await handleWordleButton(context.interaction, createWordleDependencies(store));

        expect(context.showModal).toHaveBeenCalledOnce();
        expect(getCallArgument<{ toJSON(): unknown }>(context.showModal).toJSON()).toMatchObject({
            custom_id: `wordle:guess-modal:${puzzle.printDate}:${userId}`,
            title: "Wordle 단어 입력",
        });
    });

    it("현황 공유를 다시 누르면 기존 패널을 삭제하고 버튼을 유지합니다", async () => {
        const store = createWordleStore();
        const deletePreviousPanel = vi.fn().mockResolvedValue(undefined);
        const previousPanelMessage = {
            delete: deletePreviousPanel,
            id: "previous-public-panel",
        } as unknown as Message;
        const replacementPanelMessage = { id: "replacement-public-panel" } as Message;
        const send = vi.fn().mockResolvedValue(replacementPanelMessage);
        const context = createButtonInteraction(wordleButtonId("share"), { send });

        seedSession(store, { panelMessage: previousPanelMessage });
        await handleWordleButton(context.interaction, createWordleDependencies(store));

        expect(context.deferUpdate).toHaveBeenCalledOnce();
        expect(deletePreviousPanel).toHaveBeenCalledOnce();
        expect(store.get(userId, puzzle.printDate, guildId)?.panelMessage).toBe(
            replacementPanelMessage,
        );
        expect(getComponentJson(context.editReply)).toContain("현재 진행 상황을 공개했습니다.");
        expect(getComponentJson(context.editReply)).toContain("현황 공유");
    });

    it("기존 진행 공유 버튼도 통합된 공유 동작을 수행합니다", async () => {
        const store = createWordleStore();
        const send = vi.fn().mockResolvedValue({ id: "legacy-progress-panel" });
        const context = createButtonInteraction(wordleButtonId("progress-share"), { send });

        seedSession(store);
        await handleWordleButton(context.interaction, createWordleDependencies(store));

        expect(context.deferUpdate).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledOnce();
        expect(getComponentJson(context.editReply)).toContain("현재 진행 상황을 공개했습니다.");
    });
});

describe("Wordle 비공개 화면", () => {
    it("이전 화면을 삭제한 뒤 현재 지연 응답을 게임 화면으로 수정합니다", async () => {
        const store = createWordleStore();
        const previousDelete = vi.fn().mockResolvedValue(undefined);
        const previousInteraction = {
            deleteReply: previousDelete,
            id: "previous-interaction",
        } as unknown as ChatInputCommandInteraction;
        const current = createCommandInteraction({ deferred: true });
        const session = createSession({
            game: submitGuess(createWordleGame(puzzle), "crane"),
            privateResponseInteraction: previousInteraction,
            privateResponseMessageId: "previous-message",
        });

        await showPrivateWordleState(current.interaction, session, "진행 상황입니다.", store);

        expect(previousDelete).toHaveBeenCalledWith("previous-message");
        expect(getCallArgument<Record<string, unknown>>(current.editReply)).toMatchObject({
            content: null,
            embeds: [],
            flags: 32_768,
        });
        expect(getComponentJson(current.editReply)).toContain("진행 상황입니다.");
        expect(getComponentJson(current.editReply)).toContain("### 나의 Wordle #1860");
    });
});

describe("Wordle 모달 입력", () => {
    it("스포일러 모달의 유효한 단어를 채널에 전송합니다", async () => {
        const store = createWordleStore();
        const send = vi.fn().mockResolvedValue({ id: "spoiler-message" });
        const context = createModalInteraction({
            guess: "CRANE",
            modalAction: "spoiler",
            send,
        });
        const dictionary = createDictionary();

        seedSession(store, {
            game: submitGuess(createWordleGame(puzzle), "apple"),
        });
        await handleWordleModal(
            context.interaction,
            createWordleDependencies(store, createPuzzleProvider(), dictionary),
        );

        expect(dictionary.isEnglishWord).not.toHaveBeenCalled();
        expect(context.deferUpdate).toHaveBeenCalledOnce();
        expect(context.reply).not.toHaveBeenCalled();
        expect(getComponentJson(send)).toContain("# C R A N E");
        expect(store.getPersonalRecord(userId)).toMatchObject({
            fakeSpoilerCount: 1,
            genuineSpoilerCount: 0,
        });
    });

    it("정답 스포일러는 찐스포 사용 횟수로 기록합니다", async () => {
        const store = createWordleStore();
        const context = createModalInteraction({
            guess: "APPLE",
            modalAction: "spoiler",
        });

        seedSession(store, {
            game: submitGuess(createWordleGame(puzzle), "apple"),
        });
        await handleWordleModal(
            context.interaction,
            createWordleDependencies(store, createPuzzleProvider(), createDictionary()),
        );

        expect(store.getPersonalRecord(userId)).toMatchObject({
            fakeSpoilerCount: 0,
            genuineSpoilerCount: 1,
        });
    });

    it("사전에 없는 스포일러 단어도 공개합니다", async () => {
        const store = createWordleStore();
        const context = createModalInteraction({
            guess: "ZZZZZ",
            modalAction: "spoiler",
        });
        const dictionary = createDictionary(false);

        seedSession(store, {
            game: submitGuess(createWordleGame(puzzle), "apple"),
        });
        await handleWordleModal(
            context.interaction,
            createWordleDependencies(store, createPuzzleProvider(), dictionary),
        );

        expect(dictionary.isEnglishWord).not.toHaveBeenCalled();
        expect(context.deferUpdate).toHaveBeenCalledOnce();
        expect(context.reply).not.toHaveBeenCalled();
        expect(getComponentJson(context.send)).toContain("# Z Z Z Z Z");
    });

    it("영문 알파벳 5글자가 아닌 스포일러 문자열은 공개하지 않습니다", async () => {
        const store = createWordleStore();
        const context = createModalInteraction({
            guess: "AB12!",
            modalAction: "spoiler",
        });
        const dictionary = createDictionary();

        seedSession(store, {
            game: submitGuess(createWordleGame(puzzle), "apple"),
        });
        await handleWordleModal(
            context.interaction,
            createWordleDependencies(store, createPuzzleProvider(), dictionary),
        );

        expect(dictionary.isEnglishWord).not.toHaveBeenCalled();
        expect(context.deferUpdate).not.toHaveBeenCalled();
        expect(context.send).not.toHaveBeenCalled();
        expect(getComponentJson(context.reply)).toContain(
            "영문 알파벳 5글자만 입력할 수 있습니다.",
        );
    });

    it("사전에 없는 단어는 횟수와 활동 순번을 차감하지 않습니다", async () => {
        const store = createWordleStore();
        const context = createModalInteraction({ guess: "zzzzz" });
        const dictionary = createDictionary(false);

        seedSession(store);
        await handleWordleModal(
            context.interaction,
            createWordleDependencies(store, createPuzzleProvider(), dictionary),
        );

        expect(dictionary.isEnglishWord).toHaveBeenCalledWith("zzzzz");
        expect(store.get(userId, puzzle.printDate, guildId)?.game.guesses).toEqual([]);
        expect(store.getRecentPlayers(guildId, puzzle.printDate, 8).totalPlayers).toBe(0);
        expect(store.getPersonalRecord(userId).unregisteredWordCount).toBe(1);
        expect(getComponentJson(context.editReply)).toContain("등록된 5글자 영단어가 아닙니다.");
        expect(getComponentJson(context.editReply)).toContain("단어 입력");
    });

    it("정답 입력 시 성공 횟수·정답률·평균 시도 횟수를 기록합니다", async () => {
        const store = createWordleStore();
        const context = createModalInteraction({ guess: "APPLE" });

        seedSession(store, {
            game: submitGuess(createWordleGame(puzzle), "crane"),
        });
        await handleWordleModal(
            context.interaction,
            createWordleDependencies(store, createPuzzleProvider(), createDictionary()),
        );

        expect(store.getPersonalRecord(userId)).toMatchObject({
            averageGuessCount: 2,
            playedCount: 1,
            recentSuccessStreak: 1,
            successCount: 1,
            winRate: 100,
        });
    });

    it("유효한 입력은 활동 순번과 공개 현황 패널을 갱신합니다", async () => {
        const channelId = WORDLE_TEST_IDS.channel;
        const statusMessageId = WORDLE_TEST_IDS.message;
        const store = createWordleStore();
        const statusEdit = vi.fn().mockResolvedValue(undefined);
        const fetchMessage = vi.fn().mockResolvedValue({ edit: statusEdit });
        const context = createModalInteraction({
            channelId,
            fetchMessage,
            guess: "ALLEY",
        });

        seedSession(store);
        store.setPublicStatusPanel({
            channelId,
            guildId,
            messageId: statusMessageId,
            printDate: puzzle.printDate,
        });
        await handleWordleModal(
            context.interaction,
            createWordleDependencies(store, createPuzzleProvider(), createDictionary()),
        );

        expect(fetchMessage).toHaveBeenCalledWith({ force: true, message: statusMessageId });
        expect(store.getRecentPlayers(guildId, puzzle.printDate, 8)).toMatchObject({
            players: [{ activityOrder: 1, userId }],
            totalPlayers: 1,
        });

        const statusUpdate = getCallArgument<{ allowedMentions: unknown }>(statusEdit);

        expect(statusUpdate.allowedMentions).toEqual({
            parse: [],
            repliedUser: false,
            roles: [],
            users: [],
        });
        expect(getComponentJson(statusEdit)).toContain(`<@${userId}> **진행 중** · **1/6**`);
        expect(getComponentJson(statusEdit)).toContain("찾음: 🟨 2개 · 🟩 1개");
        expect(getComponentJson(statusEdit)).not.toContain("alley");
        expect(getComponentJson(statusEdit)).not.toContain("apple");
    });

    it("공유 중인 게임은 입력 후 공개 패널과 비공개 화면을 함께 수정합니다", async () => {
        const store = createWordleStore();
        const panelMessage = { editable: true } as Message;
        const panelEdit = vi.fn().mockResolvedValue(panelMessage);
        const context = createModalInteraction({ guess: "CRANE" });

        Object.assign(panelMessage, { edit: panelEdit });
        seedSession(store, { panelMessage });
        await handleWordleModal(
            context.interaction,
            createWordleDependencies(store, createPuzzleProvider(), createDictionary()),
        );

        expect(panelEdit).toHaveBeenCalledOnce();
        expect(store.get(userId, puzzle.printDate, guildId)?.game.guesses[0]?.word).toBe("crane");
        expect(getComponentJson(context.editReply)).toContain("`CRANE`");
        expect(getComponentJson(context.editReply)).toContain("단어 입력");
    });

    it("삭제된 현황 공유 메시지는 새로 생성하지 않고 이후 갱신 대상에서도 제외합니다", async () => {
        const store = createWordleStore();
        const panelEdit = vi.fn().mockRejectedValue({ code: "10008" });
        const panelMessage = {
            edit: panelEdit,
            editable: true,
        } as unknown as Message;
        const firstContext = createModalInteraction({ guess: "CRANE" });

        seedSession(store, { panelMessage });
        await handleWordleModal(
            firstContext.interaction,
            createWordleDependencies(store, createPuzzleProvider(), createDictionary()),
        );

        expect(panelEdit).toHaveBeenCalledOnce();
        expect(firstContext.send).not.toHaveBeenCalled();
        expect(store.get(userId, puzzle.printDate, guildId)?.panelMessage).toBeUndefined();

        const secondContext = createModalInteraction({ guess: "ALLEY" });

        await handleWordleModal(
            secondContext.interaction,
            createWordleDependencies(store, createPuzzleProvider(), createDictionary()),
        );

        expect(panelEdit).toHaveBeenCalledOnce();
        expect(secondContext.send).not.toHaveBeenCalled();
        expect(
            store.get(userId, puzzle.printDate, guildId)?.game.guesses.map((guess) => guess.word),
        ).toEqual(["crane", "alley"]);
    });
});
