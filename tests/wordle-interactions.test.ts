import type { ChatInputCommandInteraction, Message } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import {
    createWordleGuessModal,
    createWordlePlayingButtons,
    createWordleResultButtons,
    createWordleResultComponents,
    handleSpoilerButton,
    handleWordleButton,
    handleWordleModal,
    isWordleButton,
    isWordleModal,
    runWordle,
    showPrivateWordleState,
    WordleSessionStore,
} from "../src/commands/wordle.js";
import { createWordleGame, submitGuess } from "../src/features/wordle/game.js";
import {
    createButtonInteraction,
    createCommandInteraction,
    createDictionary,
    createLostGame,
    createModalInteraction,
    createPuzzleProvider,
    createSession,
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
    it("진행 화면에 입력·진행 공유·공개 현황 버튼을 생성합니다", () => {
        expect(createWordlePlayingButtons(createSession(), userId).toJSON()).toMatchObject({
            components: [
                {
                    custom_id: wordleButtonId("input"),
                    label: "단어 입력",
                    style: 1,
                },
                {
                    custom_id: wordleButtonId("progress-share"),
                    label: "현재 진행 공유",
                    style: 2,
                },
                {
                    custom_id: wordleButtonId("status-panel"),
                    label: "공개 현황 보기",
                    style: 2,
                },
            ],
            type: 1,
        });
    });

    it("진행을 공유한 뒤에는 입력과 공개 현황 버튼만 표시합니다", () => {
        const session = createSession({
            panelMessage: { id: "panel" } as Message,
        });

        expect(createWordlePlayingButtons(session, userId).toJSON()).toMatchObject({
            components: [{ label: "단어 입력" }, { label: "공개 현황 보기" }],
        });
    });

    it("단어 입력 모달에 5글자 영단어 입력란을 생성합니다", () => {
        const modal = createWordleGuessModal(puzzle.printDate, userId).toJSON();
        const serialized = JSON.stringify(modal);

        expect(modal).toMatchObject({
            custom_id: `wordle:guess-modal:${puzzle.printDate}:${userId}`,
            title: "Wordle 단어 입력",
        });
        expect(serialized).toContain("5글자 영단어");
        expect(serialized).toContain('"min_length":5');
        expect(serialized).toContain('"max_length":5');
    });

    it.each([undefined, { id: "panel" } as Message])(
        "성공 결과에는 공유·스포일러·공개 현황 버튼을 생성합니다",
        (panelMessage) => {
            const session = createSession({
                game: submitGuess(createWordleGame(puzzle), "apple"),
                panelMessage,
            });

            expect(createWordleResultButtons(session, userId).toJSON()).toMatchObject({
                components: [
                    {
                        custom_id: wordleButtonId("share"),
                        disabled: false,
                        label: "결과 공유",
                        style: 1,
                    },
                    {
                        custom_id: wordleButtonId("spoiler"),
                        label: "스포하기",
                        style: 4,
                    },
                    {
                        custom_id: wordleButtonId("status-panel"),
                        label: "공개 현황 보기",
                        style: 2,
                    },
                ],
            });
        },
    );

    it("진행 중에는 결과 버튼이 없고 이미 공유한 결과 버튼은 비활성화합니다", () => {
        const playingSession = createSession({
            game: submitGuess(createWordleGame(puzzle), "crane"),
        });
        const sharedSession = createSession({
            game: submitGuess(createWordleGame(puzzle), "apple"),
            resultShared: true,
        });

        expect(createWordleResultComponents(playingSession, userId)).toEqual([]);
        expect(createWordleResultComponents(sharedSession, userId)[0]?.toJSON()).toHaveProperty(
            "components.0.disabled",
            true,
        );
    });

    it("실패 결과에는 활성화된 공유 버튼과 공개 현황 버튼만 표시합니다", () => {
        const buttons = createWordleResultComponents(
            createSession({ game: createLostGame() }),
            userId,
        )[0]?.toJSON().components;

        expect(buttons).toMatchObject([
            { disabled: false, label: "결과 공유" },
            { label: "공개 현황 보기" },
        ]);
    });
});

describe("Wordle 식별자 검증", () => {
    it.each([
        "wordle:share:2026-07-23:12345678901234567",
        "wordle:spoiler:2026-07-23:12345678901234567",
        "wordle:input:2026-07-23:12345678901234567",
        "wordle:progress-share:2026-07-23:12345678901234567",
        "wordle:status-panel:2026-07-23:12345678901234567",
        "wordle:status-view:2026-07-23:12345678901234567",
    ])("%s 버튼 식별자를 허용합니다", (customId) => {
        expect(isWordleButton(customId)).toBe(true);
    });

    it.each([
        "wordle:view:2026-07-23:12345678901234567",
        "wordle:share:wrong-date:12345678901234567",
        "another:share:2026-07-23:12345678901234567",
    ])("%s 버튼 식별자를 거부합니다", (customId) => {
        expect(isWordleButton(customId)).toBe(false);
    });

    it.each([
        ["wordle:guess-modal:2026-07-23:12345678901234567", true],
        ["wordle:guess-modal:wrong-date:12345678901234567", false],
        ["wordle:input:2026-07-23:12345678901234567", false],
    ])("%s 모달 식별자 검증 결과는 %s입니다", (customId, expected) => {
        expect(isWordleModal(customId)).toBe(expected);
    });
});

describe("Wordle 버튼 상호작용", () => {
    it("실패 결과는 같은 비공개 화면에서 한 번만 공유합니다", async () => {
        const ownerId = "62345678901234567";
        const store = new WordleSessionStore();
        const panelMessage = { id: "lost-result-panel" } as Message;
        const send = vi.fn().mockResolvedValue(panelMessage);
        const context = createButtonInteraction(wordleButtonId("share", ownerId), {
            send,
            userId: ownerId,
        });

        seedSession(store, { game: createLostGame() }, ownerId);
        await handleWordleButton(context.interaction, store);
        await handleWordleButton(context.interaction, store);

        expect(send).toHaveBeenCalledOnce();
        expect(store.get(ownerId, puzzle.printDate, guildId)).toMatchObject({
            panelMessage,
            resultShared: true,
        });
        expect(getComponentJson(send)).toContain("종료 · X/6");
        expect(getComponentJson(context.editReply)).toContain('"disabled":true');
    });

    it("새 비공개 게임 화면을 열면 결과 공유 여부를 초기화합니다", async () => {
        const ownerId = "64345678901234567";
        const store = new WordleSessionStore();
        const context = createCommandInteraction({ userId: ownerId });

        seedSession(store, { game: createLostGame(), resultShared: true }, ownerId);
        await runWordle(context.interaction, {
            puzzleProvider: createPuzzleProvider(),
            store,
        });

        expect(store.get(ownerId, puzzle.printDate, guildId)?.resultShared).toBe(false);
        expect(getComponentJson(context.editReply)).toContain('"label":"결과 공유"');
        expect(getComponentJson(context.editReply)).toContain('"disabled":false');
    });

    it("공개 현황의 보기 버튼은 누구나 최신 보드를 비공개로 확인합니다", async () => {
        const viewerId = WORDLE_TEST_IDS.otherUser;
        const store = new WordleSessionStore();
        const context = createButtonInteraction(wordleButtonId("status-view"), {
            userId: viewerId,
        });

        seedSession(store, {
            game: submitGuess(createWordleGame(puzzle), "alley"),
        });
        await handleWordleButton(context.interaction, store);

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
    });

    it("스포일러는 비공개 응답이 아닌 채널의 빨간 컨테이너로 전송합니다", async () => {
        const send = vi.fn().mockResolvedValue({ id: "spoiler-message" });
        const context = createButtonInteraction(wordleButtonId("spoiler"), { send });
        const session = createSession({
            game: submitGuess(createWordleGame(puzzle), "apple"),
        });

        await handleSpoilerButton(context.interaction, session);

        expect(context.deferUpdate).toHaveBeenCalledOnce();
        expect(context.reply).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledWith({
            allowedMentions: { users: [userId] },
            components: [expect.anything()],
            flags: 32_768,
        });
        expect(getComponentJson(send)).toContain(`<@${userId}>님의 스포일러`);
        expect(getComponentJson(send)).toContain("# A P P L E");
    });

    it("단어 입력 버튼은 해당 사용자의 입력 모달을 표시합니다", async () => {
        const store = new WordleSessionStore();
        const context = createButtonInteraction(wordleButtonId("input"));

        seedSession(store, { panelMessage: { id: "panel" } as Message });
        await handleWordleButton(context.interaction, store);

        expect(context.showModal).toHaveBeenCalledOnce();
        expect(getCallArgument<{ toJSON(): unknown }>(context.showModal).toJSON()).toMatchObject({
            custom_id: `wordle:guess-modal:${puzzle.printDate}:${userId}`,
            title: "Wordle 단어 입력",
        });
    });

    it("현재 진행 공유 버튼은 공개 패널을 만들고 공유 버튼을 제거합니다", async () => {
        const store = new WordleSessionStore();
        const panelMessage = { editable: true, id: "public-panel" } as Message;
        const send = vi.fn().mockResolvedValue(panelMessage);
        const context = createButtonInteraction(wordleButtonId("progress-share"), { send });

        seedSession(store);
        await handleWordleButton(context.interaction, store);

        expect(context.deferUpdate).toHaveBeenCalledOnce();
        expect(store.get(userId, puzzle.printDate, guildId)?.panelMessage).toBe(panelMessage);
        expect(getComponentJson(context.editReply)).toContain("현재 진행 상황을 공개했습니다.");
        expect(getComponentJson(context.editReply)).not.toContain("현재 진행 공유");
    });
});

describe("Wordle 비공개 화면", () => {
    it("이전 화면을 삭제한 뒤 현재 지연 응답을 게임 화면으로 수정합니다", async () => {
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

        await showPrivateWordleState(current.interaction, session, "진행 상황입니다.");

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
    it("사전에 없는 단어는 횟수와 활동 순번을 차감하지 않습니다", async () => {
        const store = new WordleSessionStore();
        const context = createModalInteraction({ guess: "zzzzz" });
        const dictionary = createDictionary(false);

        seedSession(store);
        await handleWordleModal(context.interaction, store, dictionary);

        expect(dictionary.isEnglishWord).toHaveBeenCalledWith("zzzzz");
        expect(store.get(userId, puzzle.printDate, guildId)?.game.guesses).toEqual([]);
        expect(store.getRecentPlayers(guildId, puzzle.printDate, 8).totalPlayers).toBe(0);
        expect(getComponentJson(context.editReply)).toContain("등록된 5글자 영단어가 아닙니다.");
        expect(getComponentJson(context.editReply)).toContain("단어 입력");
    });

    it("공유하지 않은 게임에 입력해도 개인 공개 패널을 만들지 않습니다", async () => {
        const store = new WordleSessionStore();
        const context = createModalInteraction({ guess: "CRANE" });

        seedSession(store);
        await handleWordleModal(context.interaction, store, createDictionary());

        expect(store.get(userId, puzzle.printDate, guildId)).toMatchObject({
            game: { guesses: [{ word: "crane" }] },
            panelMessage: undefined,
        });
        expect(context.send).not.toHaveBeenCalled();
    });

    it("유효한 입력은 활동 순번과 공개 현황 패널을 갱신합니다", async () => {
        const channelId = WORDLE_TEST_IDS.channel;
        const statusMessageId = WORDLE_TEST_IDS.message;
        const store = new WordleSessionStore();
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
        await handleWordleModal(context.interaction, store, createDictionary());

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
        const store = new WordleSessionStore();
        const panelMessage = { editable: true } as Message;
        const panelEdit = vi.fn().mockResolvedValue(panelMessage);
        const context = createModalInteraction({ guess: "CRANE" });

        Object.assign(panelMessage, { edit: panelEdit });
        seedSession(store, { panelMessage });
        await handleWordleModal(context.interaction, store, createDictionary());

        expect(panelEdit).toHaveBeenCalledOnce();
        expect(store.get(userId, puzzle.printDate, guildId)?.game.guesses[0]?.word).toBe("crane");
        expect(getComponentJson(context.editReply)).toContain("`CRANE`");
        expect(getComponentJson(context.editReply)).toContain("단어 입력");
    });
});
