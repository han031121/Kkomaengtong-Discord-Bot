import type { Client, Message } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import {
    createYesterdayWordleRecordResponse,
    handleWordleButton,
    publishPendingYesterdayWordleRecords,
    sendPublicWordlePanel,
    updatePublicWordlePanel,
    WordleSessionStore,
} from "../src/commands/wordle.js";
import { createWordleRefreshTestCommand } from "../src/commands/wordle-refresh-test.js";
import { createYesterdayWordleTestCommand } from "../src/commands/yesterday-wordle-test.js";
import { createWordleGame, submitGuess } from "../src/features/wordle/game.js";
import { WordlePuzzleCache } from "../src/features/wordle/puzzle-cache.js";
import {
    createButtonInteraction,
    createCommandInteraction,
    createPuzzleProvider,
    createSession,
    getCallArgument,
    getComponentJson,
    seedSession,
    wordleButtonId,
    WORDLE_TEST_IDS,
    WORDLE_TEST_PUZZLE,
} from "./wordle-test-helpers.js";

const { guild: guildId } = WORDLE_TEST_IDS;
const puzzle = WORDLE_TEST_PUZZLE;

afterEach(() => {
    vi.useRealTimers();
});

interface StatusPanelScenarioOptions {
    channelId: string;
    fetchMessage?: Mock;
    storedMessageId?: string;
    userId: string;
}

function createStatusPanelScenario(options: StatusPanelScenarioOptions) {
    const store = new WordleSessionStore();
    const send = vi.fn();
    const context = createButtonInteraction(wordleButtonId("status-panel", options.userId), {
        channelId: options.channelId,
        fetchMessage: options.fetchMessage,
        send,
        userId: options.userId,
    });

    seedSession(store, {}, options.userId);

    if (options.storedMessageId !== undefined) {
        store.setPublicStatusPanel({
            channelId: options.channelId,
            guildId,
            messageId: options.storedMessageId,
            printDate: puzzle.printDate,
        });
    }

    return { context, send, store };
}

describe("Wordle 공개 현황 패널 접근", () => {
    it("채팅 위로 올라간 패널은 삭제하고 채널 아래에 다시 생성합니다", async () => {
        const userId = WORDLE_TEST_IDS.user;
        const channelId = "42345678901234567";
        const oldMessageId = "52345678901234567";
        const newMessage = { id: "62345678901234567" } as Message;
        const deleteOldMessage = vi.fn().mockResolvedValue(undefined);
        const fetchMessage = vi
            .fn()
            .mockImplementation((request: unknown) =>
                Promise.resolve(
                    typeof request === "object" && request !== null && "message" in request
                        ? { delete: deleteOldMessage, id: oldMessageId }
                        : new Map([["72345678901234567", {}]]),
                ),
            );
        const scenario = createStatusPanelScenario({
            channelId,
            fetchMessage,
            storedMessageId: oldMessageId,
            userId,
        });

        scenario.send.mockResolvedValue(newMessage);
        await handleWordleButton(scenario.context.interaction, scenario.store);

        expect(fetchMessage).toHaveBeenCalledWith({ force: true, message: oldMessageId });
        expect(fetchMessage).toHaveBeenCalledWith({ after: oldMessageId, limit: 1 });
        expect(deleteOldMessage).toHaveBeenCalledOnce();
        expect(scenario.send).toHaveBeenCalledOnce();
        expect(scenario.store.getPublicStatusPanel(guildId, channelId)?.messageId).toBe(
            newMessage.id,
        );
        expect(getComponentJson(scenario.context.editReply)).toContain(
            `https://discord.com/channels/${guildId}/${channelId}/${newMessage.id}`,
        );
    });

    it("저장된 패널이 없으면 새 패널을 생성하고 이동 링크를 표시합니다", async () => {
        const userId = "13345678901234567";
        const channelId = "43345678901234567";
        const statusMessage = { id: "53345678901234567" } as Message;
        const scenario = createStatusPanelScenario({ channelId, userId });

        scenario.send.mockResolvedValue(statusMessage);
        await handleWordleButton(scenario.context.interaction, scenario.store);

        expect(scenario.context.fetchMessage).not.toHaveBeenCalled();
        expect(scenario.store.getPublicStatusPanel(guildId, channelId)?.messageId).toBe(
            statusMessage.id,
        );
        expect(getComponentJson(scenario.context.editReply)).toContain(
            "공개 현황 패널을 생성했습니다.",
        );
        expect(getComponentJson(scenario.context.editReply)).toContain(
            `https://discord.com/channels/${guildId}/${channelId}/${statusMessage.id}`,
        );
        expect(getComponentJson(scenario.send, 0, 1)).toContain('"label":"지금 플레이"');
    });

    it("저장된 패널 메시지가 삭제되었으면 새 패널로 복구합니다", async () => {
        const userId = "15345678901234567";
        const channelId = "45345678901234567";
        const deletedMessageId = "55345678901234567";
        const replacementMessage = { id: "65345678901234567" } as Message;
        const fetchMessage = vi.fn().mockRejectedValue(
            Object.assign(new Error("Unknown Message"), {
                code: 10_008,
            }),
        );
        const scenario = createStatusPanelScenario({
            channelId,
            fetchMessage,
            storedMessageId: deletedMessageId,
            userId,
        });

        scenario.send.mockResolvedValue(replacementMessage);
        await handleWordleButton(scenario.context.interaction, scenario.store);

        expect(fetchMessage).toHaveBeenCalledWith({ force: true, message: deletedMessageId });
        expect(scenario.store.getPublicStatusPanel(guildId, channelId)?.messageId).toBe(
            replacementMessage.id,
        );
        expect(getComponentJson(scenario.context.editReply)).toContain(
            "Wordle 공개 현황 패널을 채널 아래에 다시 생성했습니다.",
        );
    });

    it("패널이 채널의 최신 메시지이면 재생성하지 않습니다", async () => {
        const userId = "14345678901234567";
        const channelId = "44345678901234567";
        const statusMessageId = "54345678901234567";
        const deleteMessage = vi.fn();
        const fetchMessage = vi
            .fn()
            .mockImplementation((request: unknown) =>
                Promise.resolve(
                    typeof request === "object" && request !== null && "message" in request
                        ? { delete: deleteMessage, id: statusMessageId }
                        : new Map(),
                ),
            );
        const scenario = createStatusPanelScenario({
            channelId,
            fetchMessage,
            storedMessageId: statusMessageId,
            userId,
        });

        await handleWordleButton(scenario.context.interaction, scenario.store);

        expect(fetchMessage).toHaveBeenCalledWith({ force: true, message: statusMessageId });
        expect(fetchMessage).toHaveBeenCalledWith({ after: statusMessageId, limit: 1 });
        expect(deleteMessage).not.toHaveBeenCalled();
        expect(scenario.send).not.toHaveBeenCalled();
        expect(getComponentJson(scenario.context.editReply)).toContain(
            "공개 현황 패널이 채널의 최신 위치에 있습니다.",
        );
    });
});

describe("Wordle 개인 공개 패널 전송", () => {
    it("상호작용 후속 응답이 아닌 채널 일반 메시지로 전송합니다", async () => {
        const panelMessage = { id: "panel-message" } as Message;
        const send = vi.fn().mockResolvedValue(panelMessage);
        const context = createCommandInteraction({ send });
        const game = submitGuess(createWordleGame(puzzle), "crane");

        await expect(sendPublicWordlePanel(context.interaction, game)).resolves.toBe(panelMessage);

        expect(context.fetchChannel).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({
                allowedMentions: { users: [WORDLE_TEST_IDS.user] },
                components: [expect.anything(), expect.anything()],
                flags: 32_768,
            }),
        );
        expect(getComponentJson(send)).toContain(`<@${WORDLE_TEST_IDS.user}>님의 Wordle #1860`);
        expect(getComponentJson(send)).not.toContain("내 게임 보기");
        expect(getComponentJson(send, 0, 1)).toContain('"label":"지금 플레이"');
        expect(getCallArgument<Record<string, unknown>>(send)).not.toHaveProperty("content");
    });

    it.each([
        {
            editable: false,
            edit: vi.fn(),
            name: "수정할 수 없는",
        },
        {
            editable: true,
            edit: vi.fn().mockRejectedValue({ code: "10008" }),
            name: "삭제된",
        },
    ])(
        "$name 기존 패널은 새 메시지를 생성하지 않고 갱신을 중단합니다",
        async ({ edit, editable }) => {
            const send = vi.fn();
            const context = createCommandInteraction({ send });
            const game = submitGuess(createWordleGame(puzzle), "crane");
            const session = createSession({
                game,
                panelMessage: {
                    edit,
                    editable,
                } as unknown as Message,
            });

            await expect(
                updatePublicWordlePanel(context.interaction, session, game),
            ).resolves.toBeUndefined();

            expect(edit).toHaveBeenCalledTimes(editable ? 1 : 0);
            expect(send).not.toHaveBeenCalled();
        },
    );
});

const currentPuzzle = {
    ...WORDLE_TEST_PUZZLE,
    id: WORDLE_TEST_PUZZLE.id + 1,
    printDate: "2026-07-24",
    puzzleNumber: WORDLE_TEST_PUZZLE.puzzleNumber + 1,
    solution: "slate",
};

function createStoreWithYesterdayRecord(): WordleSessionStore {
    const store = new WordleSessionStore();
    const game = submitGuess(createWordleGame(puzzle), "crane");

    store.set(
        WORDLE_TEST_IDS.user,
        puzzle.printDate,
        WORDLE_TEST_IDS.guild,
        createSession({ game }),
    );
    store.registerGuildParticipant(
        WORDLE_TEST_IDS.user,
        puzzle.printDate,
        WORDLE_TEST_IDS.guild,
        WORDLE_TEST_IDS.channel,
    );
    store.activatePuzzle(currentPuzzle);

    return store;
}

describe("어제 Wordle 기록판", () => {
    it("어제 정답과 점수판 상태를 표시하되 입력 단어는 숨기고 참여자를 멘션합니다", () => {
        const store = createStoreWithYesterdayRecord();
        const response = createYesterdayWordleRecordResponse(
            store,
            WORDLE_TEST_IDS.guild,
            puzzle.printDate,
        );
        const componentJson = JSON.stringify(response.components[0]?.toJSON());

        expect(componentJson).toContain("어제의 Wordle 기록");
        expect(componentJson).toContain("정답 · `APPLE`");
        expect(componentJson).toContain(`<@${WORDLE_TEST_IDS.user}> **진행 중** · **1/6**`);
        expect(componentJson).toContain(
            `wordle:status-view:${puzzle.printDate}:${WORDLE_TEST_IDS.user}`,
        );
        expect(componentJson).not.toContain("crane");
        expect(response.allowedMentions.users).toEqual([WORDLE_TEST_IDS.user]);
        expect(response.flags).toBe(32_768);

        store.close();
    });

    it("퍼즐 갱신 후 서버별 기록판을 한 번만 전송하고 완료 상태를 저장합니다", async () => {
        const store = createStoreWithYesterdayRecord();
        const send = vi.fn().mockResolvedValue({ id: WORDLE_TEST_IDS.message });
        const fetch = vi.fn().mockResolvedValue({
            guildId: WORDLE_TEST_IDS.guild,
            isSendable: () => true,
            send,
        });
        const client = {
            channels: { fetch },
        } as unknown as Client;

        await expect(
            publishPendingYesterdayWordleRecords(client, currentPuzzle.printDate, store),
        ).resolves.toBe(1);
        await expect(
            publishPendingYesterdayWordleRecords(client, currentPuzzle.printDate, store),
        ).resolves.toBe(0);

        expect(fetch).toHaveBeenCalledOnce();
        expect(fetch).toHaveBeenCalledWith(WORDLE_TEST_IDS.channel);
        expect(send).toHaveBeenCalledOnce();
        expect(store.listPendingYesterdayAnnouncements(currentPuzzle.printDate)).toEqual([]);

        store.close();
    });

    it("/어제워들_test는 현재 채널에 어제 기록판을 출력합니다", async () => {
        const store = createStoreWithYesterdayRecord();
        const context = createCommandInteraction();
        const command = createYesterdayWordleTestCommand(
            store,
            createPuzzleProvider(currentPuzzle),
        );

        await command.execute(context.interaction);

        const response = getCallArgument<{
            allowedMentions: { users: string[] };
            components: { toJSON(): unknown }[];
            flags: number;
        }>(context.reply);
        expect(JSON.stringify(response.components[0]?.toJSON())).toContain("어제의 Wordle 기록");
        expect(response.allowedMentions.users).toEqual([WORDLE_TEST_IDS.user]);
        expect(response.flags).toBe(32_768);

        store.close();
    });

    it("/워들갱신_test는 자정과 동일한 퍼즐 전환 경로로 어제 기록판을 전송합니다", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-07-23T15:30:00.000Z"));

        const store = createStoreWithYesterdayRecord();
        const target = store.listPendingYesterdayAnnouncements(currentPuzzle.printDate)[0];

        if (target === undefined) {
            throw new Error("날짜 전환 테스트에 사용할 어제 Wordle 기록판 대상이 없습니다.");
        }

        store.markYesterdayAnnouncementSent(target, WORDLE_TEST_IDS.message);

        const send = vi.fn().mockResolvedValue({ id: "62345678901234567" });
        const fetchChannel = vi.fn().mockResolvedValue({
            guildId: WORDLE_TEST_IDS.guild,
            isSendable: () => true,
            send,
        });
        const context = createCommandInteraction({ fetchChannel });
        const getPuzzle = vi.fn().mockResolvedValue(currentPuzzle);
        const cache = new WordlePuzzleCache({ getPuzzle });

        await cache.refresh();

        const removeRefreshListener = cache.addRefreshListener(async (refreshedPuzzle) => {
            store.activatePuzzle(refreshedPuzzle);
            await publishPendingYesterdayWordleRecords(
                context.interaction.client,
                refreshedPuzzle.printDate,
                store,
            );
        });

        try {
            await createWordleRefreshTestCommand(store, cache).execute(context.interaction);

            expect(getPuzzle).toHaveBeenCalledTimes(2);
            expect(fetchChannel).toHaveBeenCalledWith(WORDLE_TEST_IDS.channel);
            expect(send).toHaveBeenCalledOnce();
            expect(getCallArgument<{ content: string }>(context.editReply).content).toContain(
                "자정과 동일한 Wordle 날짜 전환 및 어제 기록판 전송 처리를 완료했습니다.",
            );
            expect(store.listPendingYesterdayAnnouncements(currentPuzzle.printDate)).toEqual([]);
            expect(cache.getTodaysPuzzle()).toEqual(currentPuzzle);
        } finally {
            removeRefreshListener();
            store.close();
        }
    });
});
