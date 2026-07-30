import type {
    ButtonInteraction,
    ChatInputCommandInteraction,
    Message,
    ModalSubmitInteraction,
} from "discord.js";
import { describe, expect, it, vi } from "vitest";

import {
    createWordleCommand,
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
    sendPublicWordlePanel,
    showPrivateWordleState,
    updatePublicWordlePanel,
    WordleSessionStore,
    wordleCommand,
} from "../src/commands/wordle.js";
import type { WordleSession } from "../src/commands/wordle.js";
import { createWordleGame, submitGuess } from "../src/features/wordle/game.js";
import type { WordlePuzzle } from "../src/features/wordle/game.js";
import { LocalDictionary } from "../src/features/wordle/local-dictionary.js";
import { WordlePuzzleUnavailableError } from "../src/features/wordle/puzzle-cache.js";

const puzzle: WordlePuzzle = {
    id: 1234,
    solution: "apple",
    printDate: "2026-07-23",
    puzzleNumber: 1860,
};
const guildId = "22345678901234567";

function createPuzzleProvider(returnedPuzzle: WordlePuzzle = puzzle) {
    return {
        getTodaysPuzzle: vi.fn(() => returnedPuzzle),
    };
}

function createLostGame() {
    let game = createWordleGame(puzzle);

    for (let guessCount = 0; guessCount < 6; guessCount += 1) {
        game = submitGuess(game, "crane");
    }

    return game;
}

describe("Wordle 공개 메시지 전송", () => {
    it("/워들 명령어에 선택적인 5글자 단어 옵션을 등록합니다", () => {
        expect(wordleCommand.data.toJSON()).toMatchObject({
            options: [
                {
                    description: "모달을 열지 않고 바로 제출할 5글자 영단어",
                    max_length: 5,
                    min_length: 5,
                    name: "단어",
                    required: false,
                    type: 3,
                },
            ],
        });
    });

    it("/워들 실행 시 공개 패널 없이 현황 표시 버튼이 있는 비공개 화면만 표시합니다", async () => {
        const userId = "32345678901234567";
        const send = vi.fn();
        const editReply = vi.fn().mockResolvedValue({
            id: "initial-private-message",
        });
        let deferred = false;
        const interaction = {
            id: "initial-command",
            get deferred() {
                return deferred;
            },
            deferReply: vi.fn().mockImplementation(() => {
                deferred = true;
                return Promise.resolve();
            }),
            editReply,
            channel: {
                isSendable: () => true,
                send,
            },
            channelId: "42345678901234567",
            guildId,
            client: {
                channels: {
                    fetch: vi.fn(),
                },
            },
            options: {
                getString: () => null,
            },
            user: {
                id: userId,
                displayAvatarURL: () => "https://cdn.example.com/avatar.png",
            },
        } as unknown as ChatInputCommandInteraction;
        const puzzleProvider = createPuzzleProvider();
        const store = new WordleSessionStore();

        await createWordleCommand(store, puzzleProvider).execute(interaction);

        expect(puzzleProvider.getTodaysPuzzle).toHaveBeenCalledOnce();
        expect(send).not.toHaveBeenCalled();
        expect(editReply).toHaveBeenCalledOnce();
        expect(store.getRecentPlayers(guildId, puzzle.printDate, 8)).toMatchObject({
            totalPlayers: 1,
            players: [
                {
                    userId,
                    activityOrder: 1,
                    game: {
                        guesses: [],
                    },
                },
            ],
        });

        const privateResponse = editReply.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
            flags: number;
        };
        const serializedResponse = JSON.stringify(privateResponse.components[0]?.toJSON());

        expect(privateResponse.flags).toBe(32_768);
        expect(serializedResponse).toContain("### 나의 Wordle #1860");
        expect(serializedResponse).toContain("단어 입력");
        expect(serializedResponse).toContain("현재 진행 공유");
        expect(serializedResponse).toContain("공개 현황 보기");
    });

    it("명령이 아닌 상호작용도 공용 진입점에서 같은 Wordle 화면과 참여 상태를 생성합니다", async () => {
        const userId = "33345678901234567";
        const store = new WordleSessionStore();
        const editReply = vi.fn().mockResolvedValue({
            id: "button-private-message",
        });
        let deferred = false;
        const deferReply = vi.fn().mockImplementation(() => {
            deferred = true;
            return Promise.resolve();
        });
        const interaction = {
            id: "wordle-entry-button",
            get deferred() {
                return deferred;
            },
            deferReply,
            editReply,
            guildId,
            user: {
                id: userId,
                displayAvatarURL: () => "https://cdn.example.com/avatar.png",
            },
        } as unknown as ButtonInteraction;

        await runWordle(interaction, {
            puzzleProvider: createPuzzleProvider(),
            store,
        });

        expect(deferReply).toHaveBeenCalledWith({ flags: 64 });
        expect(store.getRecentPlayers(guildId, puzzle.printDate, 8)).toMatchObject({
            totalPlayers: 1,
            players: [
                {
                    userId,
                    activityOrder: 1,
                    game: {
                        guesses: [],
                    },
                },
            ],
        });

        const response = editReply.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
        };
        const serializedResponse = JSON.stringify(response.components[0]?.toJSON());

        expect(serializedResponse).toContain("### 나의 Wordle #1860");
        expect(serializedResponse).toContain("단어 입력");
    });

    it("/워들 단어 옵션으로 모달 없이 추측을 제출합니다", async () => {
        const userId = "92345678901234567";
        const directGuessGuildId = "93345678901234567";
        const editReply = vi.fn().mockResolvedValue({
            id: "direct-guess-private-message",
        });
        let deferred = false;
        const interaction = {
            id: "direct-guess-command",
            get deferred() {
                return deferred;
            },
            deferReply: vi.fn().mockImplementation(() => {
                deferred = true;
                return Promise.resolve();
            }),
            editReply,
            guildId: directGuessGuildId,
            options: {
                getString: () => "CRANE",
            },
            user: {
                id: userId,
                displayAvatarURL: () => "https://cdn.example.com/avatar.png",
            },
        } as unknown as ChatInputCommandInteraction;
        const puzzleProvider = createPuzzleProvider();
        const dictionaryRequest = vi
            .spyOn(LocalDictionary.prototype, "isEnglishWord")
            .mockReturnValue(true);

        try {
            await createWordleCommand(new WordleSessionStore(), puzzleProvider).execute(
                interaction,
            );

            expect(puzzleProvider.getTodaysPuzzle).toHaveBeenCalledOnce();
            expect(dictionaryRequest).toHaveBeenCalledWith("crane");
            expect(editReply).toHaveBeenCalledOnce();

            const privateResponse = editReply.mock.calls[0]?.[0] as {
                components: { toJSON(): unknown }[];
            };
            const serializedResponse = JSON.stringify(privateResponse.components[0]?.toJSON());

            expect(serializedResponse).toContain("`CRANE`");
            expect(serializedResponse).toContain("진행 중 · 1/6");
            expect(serializedResponse).toContain("단어 입력");
        } finally {
            dictionaryRequest.mockRestore();
        }
    });

    it("/워들만 실행해도 기존 공개 현황 패널에 참여 상태를 즉시 반영합니다", async () => {
        const userId = "34345678901234567";
        const channelId = "44345678901234567";
        const statusMessageId = "54345678901234567";
        const statusMessageEdit = vi.fn().mockResolvedValue(undefined);
        const statusMessage = {
            edit: statusMessageEdit,
        };
        const store = new WordleSessionStore();
        store.setPublicStatusPanel({
            guildId,
            channelId,
            messageId: statusMessageId,
            printDate: puzzle.printDate,
        });
        const interaction = {
            id: "command-with-existing-status-panel",
            deferred: true,
            deferReply: vi.fn().mockResolvedValue(undefined),
            editReply: vi.fn().mockResolvedValue({
                id: "private-message",
            }),
            channel: {
                isSendable: () => true,
                messages: {
                    fetch: vi.fn().mockResolvedValue(statusMessage),
                },
            },
            channelId,
            guildId,
            options: {
                getString: () => null,
            },
            user: {
                id: userId,
                displayAvatarURL: () => "https://cdn.example.com/avatar.png",
            },
        } as unknown as ChatInputCommandInteraction;

        await createWordleCommand(store, createPuzzleProvider()).execute(interaction);

        expect(statusMessageEdit).toHaveBeenCalledOnce();
        const statusUpdate = statusMessageEdit.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
        };
        const serializedStatus = JSON.stringify(statusUpdate.components[0]?.toJSON());

        expect(serializedStatus).toContain(`<@${userId}> **진행 중** · **0/6**`);
        expect(serializedStatus).toContain("최근 활동 순 1명 표시 · 전체 1명");
    });

    it("/워들 실행 시 오늘 퍼즐 캐시가 없으면 안내 메시지만 표시합니다", async () => {
        const editReply = vi.fn().mockResolvedValue({
            id: "unavailable-private-message",
        });
        let deferred = false;
        const interaction = {
            get deferred() {
                return deferred;
            },
            deferReply: vi.fn().mockImplementation(() => {
                deferred = true;
                return Promise.resolve();
            }),
            editReply,
            guildId,
            options: {
                getString: () => null,
            },
            user: {
                id: "92345678901234567",
                displayAvatarURL: () => "https://cdn.example.com/avatar.png",
            },
        } as unknown as ChatInputCommandInteraction;
        const puzzleProvider = {
            getTodaysPuzzle: vi.fn(() => {
                throw new WordlePuzzleUnavailableError("cache miss");
            }),
        };

        await createWordleCommand(new WordleSessionStore(), puzzleProvider).execute(interaction);

        expect(puzzleProvider.getTodaysPuzzle).toHaveBeenCalledOnce();
        expect(editReply).toHaveBeenCalledOnce();

        const privateResponse = editReply.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
        };
        const serializedResponse = JSON.stringify(privateResponse.components[0]?.toJSON());

        expect(serializedResponse).toContain("오늘의 Wordle이 아직 준비되지 않았습니다.");
    });

    it("비공개 화면의 현황 보기 버튼은 채팅 위로 올라간 패널을 다시 생성합니다", async () => {
        const userId = "12345678901234567";
        const channelId = "42345678901234567";
        const oldMessageId = "52345678901234567";
        const newMessage = {
            id: "62345678901234567",
        } as Message;
        const deleteOldMessage = vi.fn().mockResolvedValue(undefined);
        const existingMessage = {
            id: oldMessageId,
            delete: deleteOldMessage,
        };
        const fetchMessage = vi
            .fn()
            .mockImplementation((request: unknown) =>
                Promise.resolve(
                    typeof request === "object" && request !== null && "message" in request
                        ? existingMessage
                        : new Map([["72345678901234567", { id: "72345678901234567" }]]),
                ),
            );
        const send = vi.fn().mockResolvedValue(newMessage);
        const deferUpdate = vi.fn().mockResolvedValue(undefined);
        const editReply = vi.fn().mockResolvedValue({
            id: "private-status-response",
        });
        const store = new WordleSessionStore();
        store.set(userId, puzzle.printDate, guildId, {
            game: createWordleGame(puzzle),
            panelMessage: undefined,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        });
        store.setPublicStatusPanel({
            guildId,
            channelId,
            messageId: oldMessageId,
            printDate: puzzle.printDate,
        });
        const interaction = {
            customId: `wordle:status-panel:${puzzle.printDate}:${userId}`,
            channel: {
                isSendable: () => true,
                messages: {
                    fetch: fetchMessage,
                },
                send,
            },
            channelId,
            guildId,
            deferUpdate,
            editReply,
            id: "status-panel-button",
            user: {
                id: userId,
            },
        } as unknown as ButtonInteraction;

        await handleWordleButton(interaction, store);

        expect(deferUpdate).toHaveBeenCalledOnce();
        expect(fetchMessage).toHaveBeenCalledWith({
            message: oldMessageId,
            force: true,
        });
        expect(fetchMessage).toHaveBeenCalledWith({
            after: oldMessageId,
            limit: 1,
        });
        expect(deleteOldMessage).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledOnce();
        expect(store.getPublicStatusPanel(guildId, channelId)?.messageId).toBe(newMessage.id);

        const privateResponse = editReply.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
        };
        const serializedResponse = JSON.stringify(privateResponse.components[0]?.toJSON());

        expect(serializedResponse).toContain("Wordle 공개 현황 패널을");
        expect(serializedResponse).toContain("공개 현황 보기");
        expect(serializedResponse).toContain(
            `https://discord.com/channels/${guildId}/${channelId}/${newMessage.id}`,
        );
    });

    it("공개 현황 패널이 없으면 현황 보기 버튼으로 새 패널을 생성합니다", async () => {
        const userId = "13345678901234567";
        const channelId = "43345678901234567";
        const statusMessage = {
            id: "53345678901234567",
        } as Message;
        const fetchMessage = vi.fn();
        const send = vi.fn().mockResolvedValue(statusMessage);
        const editReply = vi.fn().mockResolvedValue({
            id: "private-create-status-response",
        });
        const store = new WordleSessionStore();
        store.set(userId, puzzle.printDate, guildId, {
            game: createWordleGame(puzzle),
            panelMessage: undefined,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        });
        const interaction = {
            customId: `wordle:status-panel:${puzzle.printDate}:${userId}`,
            channel: {
                isSendable: () => true,
                messages: {
                    fetch: fetchMessage,
                },
                send,
            },
            channelId,
            guildId,
            deferUpdate: vi.fn().mockResolvedValue(undefined),
            editReply,
            id: "create-status-panel-button",
            user: {
                id: userId,
            },
        } as unknown as ButtonInteraction;

        await handleWordleButton(interaction, store);

        expect(fetchMessage).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledOnce();
        expect(store.getPublicStatusPanel(guildId, channelId)?.messageId).toBe(statusMessage.id);

        const privateResponse = editReply.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
        };
        const serializedResponse = JSON.stringify(privateResponse.components[0]?.toJSON());

        expect(serializedResponse).toContain("공개 현황 패널을 생성했습니다.");
        expect(serializedResponse).toContain(
            `https://discord.com/channels/${guildId}/${channelId}/${statusMessage.id}`,
        );
    });

    it("삭제된 공개 현황 패널이 캐시에 남아 있어도 새 패널로 복구합니다", async () => {
        const userId = "15345678901234567";
        const channelId = "45345678901234567";
        const deletedMessageId = "55345678901234567";
        const replacementMessage = {
            id: "65345678901234567",
        } as Message;
        const staleCachedMessage = {
            id: deletedMessageId,
        };
        const fetchMessage = vi.fn().mockImplementation((request: unknown) => {
            if (typeof request === "string") {
                return Promise.resolve(staleCachedMessage);
            }

            if (typeof request === "object" && request !== null && "message" in request) {
                return Promise.reject(
                    Object.assign(new Error("Unknown Message"), {
                        code: 10_008,
                    }),
                );
            }

            return Promise.resolve(new Map());
        });
        const send = vi.fn().mockResolvedValue(replacementMessage);
        const editReply = vi.fn().mockResolvedValue({
            id: "private-recreated-status-response",
        });
        const store = new WordleSessionStore();
        store.set(userId, puzzle.printDate, guildId, {
            game: createWordleGame(puzzle),
            panelMessage: undefined,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        });
        store.setPublicStatusPanel({
            guildId,
            channelId,
            messageId: deletedMessageId,
            printDate: puzzle.printDate,
        });
        const interaction = {
            customId: `wordle:status-panel:${puzzle.printDate}:${userId}`,
            channel: {
                isSendable: () => true,
                messages: {
                    fetch: fetchMessage,
                },
                send,
            },
            channelId,
            guildId,
            deferUpdate: vi.fn().mockResolvedValue(undefined),
            editReply,
            id: "recreate-deleted-status-panel-button",
            user: {
                id: userId,
            },
        } as unknown as ButtonInteraction;

        await handleWordleButton(interaction, store);

        expect(fetchMessage).toHaveBeenCalledOnce();
        expect(fetchMessage).toHaveBeenCalledWith({
            message: deletedMessageId,
            force: true,
        });
        expect(send).toHaveBeenCalledOnce();
        expect(store.getPublicStatusPanel(guildId, channelId)?.messageId).toBe(
            replacementMessage.id,
        );

        const privateResponse = editReply.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
        };
        const serializedResponse = JSON.stringify(privateResponse.components[0]?.toJSON());

        expect(serializedResponse).toContain(
            "Wordle 공개 현황 패널을 채널 아래에 다시 생성했습니다.",
        );
        expect(serializedResponse).toContain(
            `https://discord.com/channels/${guildId}/${channelId}/${replacementMessage.id}`,
        );
    });

    it("공개 현황 패널이 최신 위치에 있으면 재생성하지 않고 이동 링크를 표시합니다", async () => {
        const userId = "14345678901234567";
        const channelId = "44345678901234567";
        const statusMessageId = "54345678901234567";
        const deleteMessage = vi.fn();
        const fetchMessage = vi.fn().mockImplementation((request: unknown) =>
            Promise.resolve(
                typeof request === "object" && request !== null && "message" in request
                    ? {
                          id: statusMessageId,
                          delete: deleteMessage,
                      }
                    : new Map(),
            ),
        );
        const send = vi.fn();
        const editReply = vi.fn().mockResolvedValue({
            id: "private-existing-status-response",
        });
        const store = new WordleSessionStore();
        store.set(userId, puzzle.printDate, guildId, {
            game: createWordleGame(puzzle),
            panelMessage: undefined,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        });
        store.setPublicStatusPanel({
            guildId,
            channelId,
            messageId: statusMessageId,
            printDate: puzzle.printDate,
        });
        const interaction = {
            customId: `wordle:status-panel:${puzzle.printDate}:${userId}`,
            channel: {
                isSendable: () => true,
                messages: {
                    fetch: fetchMessage,
                },
                send,
            },
            channelId,
            guildId,
            deferUpdate: vi.fn().mockResolvedValue(undefined),
            editReply,
            id: "existing-status-panel-button",
            user: {
                id: userId,
            },
        } as unknown as ButtonInteraction;

        await handleWordleButton(interaction, store);

        expect(fetchMessage).toHaveBeenCalledWith({
            message: statusMessageId,
            force: true,
        });
        expect(fetchMessage).toHaveBeenCalledWith({
            after: statusMessageId,
            limit: 1,
        });
        expect(deleteMessage).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
        expect(store.getPublicStatusPanel(guildId, channelId)?.messageId).toBe(statusMessageId);

        const privateResponse = editReply.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
        };
        const serializedResponse = JSON.stringify(privateResponse.components[0]?.toJSON());

        expect(serializedResponse).toContain("공개 현황 패널이 채널의 최신 위치에 있습니다.");
        expect(serializedResponse).toContain(
            `https://discord.com/channels/${guildId}/${channelId}/${statusMessageId}`,
        );
    });

    it("상호작용 후속 응답이 아닌 채널 일반 메시지로 패널을 전송합니다", async () => {
        const panelMessage = { id: "panel-message" } as Message;
        const send = vi
            .fn<(options: unknown) => Promise<Message>>()
            .mockResolvedValue(panelMessage);
        const fetchChannel = vi.fn();
        const interaction = {
            channel: {
                isSendable: () => true,
                send,
            },
            channelId: "channel-id",
            client: {
                channels: {
                    fetch: fetchChannel,
                },
            },
            user: {
                id: "12345678901234567",
                globalName: "테스터",
                username: "tester",
                displayAvatarURL: () => "https://cdn.example.com/avatar.png",
            },
        } as unknown as ChatInputCommandInteraction;
        const game = submitGuess(createWordleGame(puzzle), "crane");

        await expect(sendPublicWordlePanel(interaction, game)).resolves.toBe(panelMessage);

        expect(send).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({
                components: [expect.anything()],
                flags: 32_768,
                allowedMentions: { users: ["12345678901234567"] },
            }),
        );

        const sendOptions = send.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
        };
        const containerJson = JSON.stringify(sendOptions.components[0]?.toJSON());

        expect(sendOptions).not.toHaveProperty("content");
        expect(sendOptions).not.toHaveProperty("embeds");
        expect(containerJson).toContain("<@12345678901234567>님의 Wordle #1860");
        expect(containerJson).not.toContain("내 게임 보기");
        expect(fetchChannel).not.toHaveBeenCalled();
    });

    it("기존 패널을 수정할 수 없으면 현재 채널에 새 공개 패널을 생성합니다", async () => {
        const replacementMessage = { id: "replacement-message" } as Message;
        const send = vi
            .fn<(options: unknown) => Promise<Message>>()
            .mockResolvedValue(replacementMessage);
        const edit = vi.fn();
        const interaction = {
            channel: {
                isSendable: () => true,
                send,
            },
            channelId: "channel-id",
            client: {
                channels: {
                    fetch: vi.fn(),
                },
            },
            user: {
                id: "12345678901234567",
                globalName: "테스터",
                username: "tester",
                displayAvatarURL: () => "https://cdn.example.com/avatar.png",
            },
        } as unknown as ChatInputCommandInteraction;
        const game = submitGuess(createWordleGame(puzzle), "crane");
        const session: WordleSession = {
            game,
            panelMessage: {
                editable: false,
                edit,
            } as unknown as Message,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        };

        await expect(updatePublicWordlePanel(interaction, session, game)).resolves.toBe(
            replacementMessage,
        );

        expect(edit).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledOnce();
    });

    it("문자열 형태의 Unknown Message 오류도 새 공개 패널로 복구합니다", async () => {
        const replacementMessage = { id: "replacement-message" } as Message;
        const send = vi
            .fn<(options: unknown) => Promise<Message>>()
            .mockResolvedValue(replacementMessage);
        const edit = vi.fn().mockRejectedValue({ code: "10008" });
        const interaction = {
            channel: {
                isSendable: () => true,
                send,
            },
            channelId: "channel-id",
            client: {
                channels: {
                    fetch: vi.fn(),
                },
            },
            user: {
                id: "12345678901234567",
                globalName: "테스터",
                username: "tester",
                displayAvatarURL: () => "https://cdn.example.com/avatar.png",
            },
        } as unknown as ChatInputCommandInteraction;
        const game = submitGuess(createWordleGame(puzzle), "crane");
        const session: WordleSession = {
            game,
            panelMessage: {
                editable: true,
                edit,
            } as unknown as Message,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        };

        await expect(updatePublicWordlePanel(interaction, session, game)).resolves.toBe(
            replacementMessage,
        );

        expect(edit).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledOnce();
    });
});

describe("Wordle 서버별 진행 상태", () => {
    it("게임은 서버 간 공유하고 현재 서버의 기존 공개 패널만 갱신합니다", async () => {
        const userId = "42345678901234567";
        const otherGuildId = "52345678901234567";
        const store = new WordleSessionStore();
        const panelMessage = {
            editable: true,
        } as Message;
        const panelEdit = vi.fn().mockResolvedValue(panelMessage);
        Object.assign(panelMessage, { edit: panelEdit });
        const session: WordleSession = {
            game: submitGuess(createWordleGame(puzzle), "crane"),
            panelMessage,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        };
        store.set(userId, puzzle.printDate, guildId, session);

        const createInteraction = (interactionGuildId: string) => {
            const editReply = vi.fn().mockResolvedValue({
                id: `private-${interactionGuildId}`,
            });

            const interaction = {
                id: `command-${interactionGuildId}`,
                deferred: true,
                deferReply: vi.fn().mockResolvedValue(undefined),
                editReply,
                guildId: interactionGuildId,
                user: {
                    id: userId,
                    displayAvatarURL: () => "https://cdn.example.com/avatar.png",
                },
            } as unknown as ChatInputCommandInteraction;

            return { editReply, interaction };
        };
        const otherGuild = createInteraction(otherGuildId);

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
        expect(store.get(userId, puzzle.printDate, guildId)?.game.guesses).toHaveLength(1);
        expect(store.getRecentPlayers(otherGuildId, puzzle.printDate, 8)).toMatchObject({
            totalPlayers: 1,
            players: [
                {
                    userId,
                    game: {
                        guesses: [
                            {
                                word: "crane",
                            },
                        ],
                    },
                },
            ],
        });

        const otherGuildPrivateUpdate = otherGuild.editReply.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
        };
        expect(JSON.stringify(otherGuildPrivateUpdate.components[0]?.toJSON())).toContain(
            "`CRANE`",
        );

        const currentGuild = createInteraction(guildId);
        await runWordle(currentGuild.interaction, {
            puzzleProvider: createPuzzleProvider(),
            store,
        });

        expect(panelEdit).toHaveBeenCalledOnce();
        expect(store.get(userId, puzzle.printDate, guildId)?.panelMessage).toBe(panelMessage);

        const panelUpdate = panelEdit.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
        };
        const serializedPanel = JSON.stringify(panelUpdate.components[0]?.toJSON());
        const privateUpdate = currentGuild.editReply.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
        };
        const serializedPrivatePanel = JSON.stringify(privateUpdate.components[0]?.toJSON());

        expect(serializedPanel).toContain("진행 중 · 1/6");
        expect(serializedPrivatePanel).toContain("`CRANE`");
    });

    it("다른 서버의 단어 입력을 모든 활성 화면과 공개 게임 현황에 반영합니다", async () => {
        const userId = "72345678901234567";
        const otherGuildId = "82345678901234567";
        const statusChannelId = "92345678901234567";
        const statusMessageId = "93345678901234567";
        const store = new WordleSessionStore();
        const sharedStateMessage = {
            editable: true,
        } as Message;
        const sharedStateEdit = vi.fn().mockResolvedValue(sharedStateMessage);
        const privateStateEdit = vi.fn().mockResolvedValue({
            id: "current-guild-private-message",
        });
        const statusMessageEdit = vi.fn().mockResolvedValue(undefined);
        const statusMessageFetch = vi.fn().mockResolvedValue({
            edit: statusMessageEdit,
        });
        const statusChannel = {
            isSendable: () => true,
            messages: {
                fetch: statusMessageFetch,
            },
        };
        Object.assign(sharedStateMessage, { edit: sharedStateEdit });
        const currentGuildSession: WordleSession = {
            game: createWordleGame(puzzle),
            panelMessage: sharedStateMessage,
            privateResponseInteraction: {
                guildId,
                id: "current-guild-command",
                editReply: privateStateEdit,
                user: {
                    id: userId,
                },
            } as unknown as ChatInputCommandInteraction,
            privateResponseMessageId: "current-guild-private-message",
            resultShared: false,
        };
        const otherGuildSession: WordleSession = {
            game: createWordleGame(puzzle),
            panelMessage: undefined,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        };
        store.set(userId, puzzle.printDate, guildId, currentGuildSession);
        store.set(userId, puzzle.printDate, otherGuildId, otherGuildSession);
        store.registerGuildParticipant(userId, puzzle.printDate, guildId);
        store.setPublicStatusPanel({
            guildId,
            channelId: statusChannelId,
            messageId: statusMessageId,
            printDate: puzzle.printDate,
        });

        const interaction = {
            customId: `wordle:guess-modal:${puzzle.printDate}:${userId}`,
            client: {
                channels: {
                    fetch: vi.fn().mockResolvedValue(statusChannel),
                },
            },
            deferUpdate: vi.fn().mockResolvedValue(undefined),
            editReply: vi.fn().mockResolvedValue({
                id: "other-guild-private-message",
            }),
            fields: {
                getTextInputValue: () => "crane",
            },
            guildId: otherGuildId,
            id: "other-guild-modal",
            user: {
                id: userId,
                displayAvatarURL: () => "https://cdn.example.com/avatar.png",
            },
        } as unknown as ModalSubmitInteraction;
        const dictionary = {
            isEnglishWord: vi.fn().mockReturnValue(true),
        };

        await handleWordleModal(interaction, store, dictionary);

        expect(sharedStateEdit).toHaveBeenCalledOnce();
        expect(privateStateEdit).toHaveBeenCalledOnce();
        expect(statusMessageFetch).toHaveBeenCalledWith({
            message: statusMessageId,
            force: true,
        });
        expect(statusMessageEdit).toHaveBeenCalledOnce();
        expect(
            store.get(userId, puzzle.printDate, guildId)?.game.guesses.map((guess) => guess.word),
        ).toEqual(["crane"]);
        expect(
            store
                .get(userId, puzzle.printDate, otherGuildId)
                ?.game.guesses.map((guess) => guess.word),
        ).toEqual(["crane"]);

        const sharedStateUpdate = sharedStateEdit.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
        };
        const privateStateUpdate = privateStateEdit.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
        };
        const publicStatusUpdate = statusMessageEdit.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
        };

        expect(JSON.stringify(sharedStateUpdate.components[0]?.toJSON())).toContain(
            "진행 중 · 1/6",
        );
        expect(JSON.stringify(privateStateUpdate.components[0]?.toJSON())).toContain("`CRANE`");
        expect(JSON.stringify(publicStatusUpdate.components[0]?.toJSON())).toContain(
            `<@${userId}> **진행 중** · **1/6**`,
        );
    });

    it("다른 서버의 비공개 메시지가 만료되어도 현재 서버의 게임 진행을 유지합니다", async () => {
        const userId = "74345678901234567";
        const otherGuildId = "84345678901234567";
        const store = new WordleSessionStore();
        const expiredPrivateEdit = vi.fn().mockRejectedValue({
            code: 10_015,
        });
        const session: WordleSession = {
            game: createWordleGame(puzzle),
            panelMessage: undefined,
            privateResponseInteraction: {
                guildId,
                id: "expired-private-interaction",
                editReply: expiredPrivateEdit,
                user: {
                    id: userId,
                },
            } as unknown as ChatInputCommandInteraction,
            privateResponseMessageId: "expired-private-message",
            resultShared: false,
        };
        store.set(userId, puzzle.printDate, guildId, session);
        store.set(userId, puzzle.printDate, otherGuildId, {
            ...session,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
        });

        const currentPrivateEdit = vi.fn().mockResolvedValue({
            id: "other-guild-private-message",
        });
        const interaction = {
            customId: `wordle:guess-modal:${puzzle.printDate}:${userId}`,
            deferUpdate: vi.fn().mockResolvedValue(undefined),
            editReply: currentPrivateEdit,
            fields: {
                getTextInputValue: () => "crane",
            },
            guildId: otherGuildId,
            id: "other-guild-modal",
            user: {
                id: userId,
                displayAvatarURL: () => "https://cdn.example.com/avatar.png",
            },
        } as unknown as ModalSubmitInteraction;

        await handleWordleModal(interaction, store, {
            isEnglishWord: vi.fn().mockReturnValue(true),
        });

        expect(expiredPrivateEdit).toHaveBeenCalledOnce();
        expect(currentPrivateEdit).toHaveBeenCalledOnce();
        expect(store.get(userId, puzzle.printDate, guildId)).toMatchObject({
            game: {
                guesses: [
                    {
                        word: "crane",
                    },
                ],
            },
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
        });
    });
});

describe("Wordle 결과 버튼", () => {
    it("진행 중인 비공개 화면에 입력·진행 공유·공개 현황 버튼을 생성합니다", () => {
        const session: WordleSession = {
            game: createWordleGame(puzzle),
            panelMessage: undefined,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        };

        expect(createWordlePlayingButtons(session, "12345678901234567").toJSON()).toEqual({
            type: 1,
            components: [
                {
                    type: 2,
                    custom_id: "wordle:input:2026-07-23:12345678901234567",
                    label: "단어 입력",
                    style: 1,
                },
                {
                    type: 2,
                    custom_id: "wordle:progress-share:2026-07-23:12345678901234567",
                    label: "현재 진행 공유",
                    style: 2,
                },
                {
                    type: 2,
                    custom_id: "wordle:status-panel:2026-07-23:12345678901234567",
                    label: "공개 현황 보기",
                    style: 2,
                },
            ],
        });
    });

    it("현재 진행을 공유한 뒤에도 단어 입력과 공개 현황 버튼을 표시합니다", () => {
        const session: WordleSession = {
            game: createWordleGame(puzzle),
            panelMessage: {
                url: "https://discord.com/channels/guild/channel/panel",
            } as Message,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        };
        const actionRow = createWordlePlayingButtons(session, "12345678901234567").toJSON();

        expect(actionRow.components).toEqual([
            {
                type: 2,
                custom_id: "wordle:input:2026-07-23:12345678901234567",
                label: "단어 입력",
                style: 1,
            },
            {
                type: 2,
                custom_id: "wordle:status-panel:2026-07-23:12345678901234567",
                label: "공개 현황 보기",
                style: 2,
            },
        ]);
    });

    it("단어 입력 모달에 5글자 영단어 입력란을 생성합니다", () => {
        const modalJson = createWordleGuessModal(puzzle.printDate, "12345678901234567").toJSON();
        const serializedModal = JSON.stringify(modalJson);

        expect(modalJson).toMatchObject({
            custom_id: "wordle:guess-modal:2026-07-23:12345678901234567",
            title: "Wordle 단어 입력",
        });
        expect(serializedModal).toContain("5글자 영단어");
        expect(serializedModal).toContain("wordle:guess");
        expect(serializedModal).toContain('"min_length":5');
        expect(serializedModal).toContain('"max_length":5');
    });

    it("결과 공유와 스포하기 및 공개 현황 버튼을 순서대로 생성합니다", () => {
        const panelMessage = {
            url: "https://discord.com/channels/guild/channel/message",
        } as Message;
        const session: WordleSession = {
            game: submitGuess(createWordleGame(puzzle), "apple"),
            panelMessage,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        };

        expect(createWordleResultButtons(session, "12345678901234567").toJSON()).toEqual({
            type: 1,
            components: [
                {
                    type: 2,
                    custom_id: "wordle:share:2026-07-23:12345678901234567",
                    label: "결과 공유",
                    style: 1,
                    disabled: false,
                },
                {
                    type: 2,
                    custom_id: "wordle:spoiler:2026-07-23:12345678901234567",
                    label: "스포하기",
                    style: 4,
                },
                {
                    type: 2,
                    custom_id: "wordle:status-panel:2026-07-23:12345678901234567",
                    label: "공개 현황 보기",
                    style: 2,
                },
            ],
        });
    });

    it("공개한 진행 패널이 없어도 결과 공유·스포일러·공개 현황 버튼을 생성합니다", () => {
        const session: WordleSession = {
            game: submitGuess(createWordleGame(puzzle), "apple"),
            panelMessage: undefined,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        };

        expect(createWordleResultButtons(session, "12345678901234567").toJSON()).toMatchObject({
            components: [
                {
                    label: "결과 공유",
                },
                {
                    label: "스포하기",
                },
                {
                    label: "공개 현황 보기",
                },
            ],
        });
    });

    it("진행 중이거나 같은 내 게임 화면에서 이미 공유한 경우 버튼을 비활성화합니다", () => {
        const panelMessage = {
            url: "https://discord.com/channels/guild/channel/message",
        } as Message;
        const playingSession: WordleSession = {
            game: submitGuess(createWordleGame(puzzle), "crane"),
            panelMessage,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        };
        const sharedSession: WordleSession = {
            game: submitGuess(createWordleGame(puzzle), "apple"),
            panelMessage,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: true,
        };

        expect(createWordleResultComponents(playingSession, "12345678901234567")).toEqual([]);
        expect(
            createWordleResultComponents(sharedSession, "12345678901234567")[0]?.toJSON(),
        ).toHaveProperty("components.0.disabled", true);
    });

    it("실패한 게임에도 활성화된 결과 공유 버튼을 표시합니다", () => {
        const session: WordleSession = {
            game: createLostGame(),
            panelMessage: undefined,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        };
        const actionRow = createWordleResultComponents(session, "12345678901234567")[0]?.toJSON();

        expect(actionRow?.components[0]).toMatchObject({
            label: "결과 공유",
            disabled: false,
        });
        expect(actionRow?.components[1]).toMatchObject({
            label: "공개 현황 보기",
        });
        expect(actionRow?.components).toHaveLength(2);
    });

    it("같은 내 게임 화면의 실패 결과는 한 번만 공유합니다", async () => {
        const userId = "62345678901234567";
        const store = new WordleSessionStore();
        const session: WordleSession = {
            game: createLostGame(),
            panelMessage: undefined,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        };
        const panelMessage = {
            id: "lost-result-panel",
        } as Message;
        const send = vi.fn().mockResolvedValue(panelMessage);
        const editReply = vi.fn().mockResolvedValue({
            id: "private-result-message",
        });
        const interaction = {
            customId: `wordle:share:${puzzle.printDate}:${userId}`,
            deferUpdate: vi.fn().mockResolvedValue(undefined),
            editReply,
            guildId,
            channel: {
                isSendable: () => true,
                send,
            },
            channelId: "channel-id",
            client: {
                channels: {
                    fetch: vi.fn(),
                },
            },
            message: {
                id: "private-result-message",
            },
            user: {
                id: userId,
                displayAvatarURL: () => "https://cdn.example.com/avatar.png",
            },
        } as unknown as ButtonInteraction;
        store.set(userId, puzzle.printDate, guildId, session);

        await handleWordleButton(interaction, store);
        await handleWordleButton(interaction, store);

        expect(send).toHaveBeenCalledOnce();
        expect(store.get(userId, puzzle.printDate, guildId)).toMatchObject({
            panelMessage,
            resultShared: true,
        });

        const publicResponse = send.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
        };
        const privateResponse = editReply.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
        };

        expect(JSON.stringify(publicResponse.components[0]?.toJSON())).toContain("종료 · X/6");
        expect(JSON.stringify(privateResponse.components[0]?.toJSON())).toContain(
            '"disabled":true',
        );
    });

    it("새 내 게임 화면을 열면 결과 공유 횟수를 초기화합니다", async () => {
        const userId = "64345678901234567";
        const store = new WordleSessionStore();
        const session: WordleSession = {
            game: createLostGame(),
            panelMessage: undefined,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: true,
        };
        const editReply = vi.fn().mockResolvedValue({
            id: "reopened-private-message",
        });
        const interaction = {
            id: "reopen-wordle-command",
            deferred: true,
            deferReply: vi.fn().mockResolvedValue(undefined),
            editReply,
            guildId,
            user: {
                id: userId,
                displayAvatarURL: () => "https://cdn.example.com/avatar.png",
            },
        } as unknown as ChatInputCommandInteraction;
        store.set(userId, puzzle.printDate, guildId, session);

        await runWordle(interaction, {
            puzzleProvider: createPuzzleProvider(),
            store,
        });

        expect(store.get(userId, puzzle.printDate, guildId)?.resultShared).toBe(false);

        const privateResponse = editReply.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
        };
        const serializedResponse = JSON.stringify(privateResponse.components[0]?.toJSON());

        expect(serializedResponse).toContain('"label":"결과 공유"');
        expect(serializedResponse).toContain('"disabled":false');
    });

    it("Wordle 버튼 식별자는 날짜와 사용자 ID 형식을 검증합니다", () => {
        expect(isWordleButton("wordle:share:2026-07-23:12345678901234567")).toBe(true);
        expect(isWordleButton("wordle:spoiler:2026-07-23:12345678901234567")).toBe(true);
        expect(isWordleButton("wordle:view:2026-07-23:12345678901234567")).toBe(false);
        expect(isWordleButton("wordle:input:2026-07-23:12345678901234567")).toBe(true);
        expect(isWordleButton("wordle:progress-share:2026-07-23:12345678901234567")).toBe(true);
        expect(isWordleButton("wordle:status-panel:2026-07-23:12345678901234567")).toBe(true);
        expect(isWordleButton("wordle:status-view:2026-07-23:12345678901234567")).toBe(true);
        expect(isWordleButton("wordle:share:wrong-date:12345678901234567")).toBe(false);
        expect(isWordleButton("another:share:2026-07-23:12345678901234567")).toBe(false);
    });

    it("공개 현황의 보기 버튼은 다른 사용자도 최신 보드를 ephemeral로 확인합니다", async () => {
        const targetUserId = "12345678901234567";
        const viewerUserId = "22345678901234567";
        const store = new WordleSessionStore();
        const game = submitGuess(createWordleGame(puzzle), "alley");
        store.set(targetUserId, puzzle.printDate, guildId, {
            game,
            panelMessage: undefined,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        });
        const reply = vi.fn().mockResolvedValue(undefined);
        const interaction = {
            customId: `wordle:status-view:${puzzle.printDate}:${targetUserId}`,
            guildId,
            reply,
            user: {
                id: viewerUserId,
            },
        } as unknown as ButtonInteraction;

        await handleWordleButton(interaction, store);

        expect(reply).toHaveBeenCalledOnce();
        const response = reply.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
            flags: number;
            allowedMentions: unknown;
        };
        const serializedResponse = JSON.stringify(response.components[0]?.toJSON());

        expect(response.flags).toBe(32_832);
        expect(response.allowedMentions).toEqual({
            parse: [],
            users: [],
            roles: [],
            repliedUser: false,
        });
        expect(serializedResponse).toContain(`<@${targetUserId}>님의 Wordle #1860`);
        expect(serializedResponse).toContain("🟩🟨⬛🟨⬛");
        expect(serializedResponse).not.toContain("alley");
        expect(serializedResponse).not.toContain("apple");
    });

    it("Wordle 단어 입력 모달 식별자는 날짜와 사용자 ID 형식을 검증합니다", () => {
        expect(isWordleModal("wordle:guess-modal:2026-07-23:12345678901234567")).toBe(true);
        expect(isWordleModal("wordle:guess-modal:wrong-date:12345678901234567")).toBe(false);
        expect(isWordleModal("wordle:input:2026-07-23:12345678901234567")).toBe(false);
    });

    it("스포일러를 비공개 메시지에 답장하지 않고 빨간 컨테이너로 전송합니다", async () => {
        const deferUpdate = vi.fn<() => Promise<void>>().mockResolvedValue();
        const reply = vi.fn();
        const send = vi.fn().mockResolvedValue({ id: "spoiler-message" });
        const interaction = {
            channel: {
                isSendable: () => true,
                send,
            },
            channelId: "channel-id",
            client: {
                channels: {
                    fetch: vi.fn(),
                },
            },
            deferUpdate,
            reply,
            user: {
                id: "12345678901234567",
            },
        } as unknown as ButtonInteraction;
        const session: WordleSession = {
            game: submitGuess(createWordleGame(puzzle), "apple"),
            panelMessage: {
                url: "https://discord.com/channels/guild/channel/message",
            } as Message,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        };

        await handleSpoilerButton(interaction, session);

        expect(deferUpdate).toHaveBeenCalledOnce();
        expect(reply).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledWith({
            components: [expect.anything()],
            flags: 32_768,
            allowedMentions: { users: ["12345678901234567"] },
        });

        const sendOptions = send.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
        };
        const containerJson = JSON.stringify(sendOptions.components[0]?.toJSON());

        expect(sendOptions).not.toHaveProperty("content");
        expect(sendOptions).not.toHaveProperty("embeds");
        expect(containerJson).toContain("<@12345678901234567>님의 스포일러");
        expect(containerJson).toContain("# A P P L E");
        expect(containerJson).toContain("Wordle #1860 · 2026-07-23");
    });
});

describe("Wordle 비공개 화면", () => {
    it("단어 입력 버튼을 누르면 해당 사용자의 입력 모달을 표시합니다", async () => {
        const userId = "12345678901234567";
        const store = new WordleSessionStore();
        const session: WordleSession = {
            game: createWordleGame(puzzle),
            panelMessage: {
                url: "https://discord.com/channels/guild/channel/panel",
            } as Message,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        };
        const showModal = vi.fn().mockResolvedValue(undefined);
        const interaction = {
            customId: `wordle:input:${puzzle.printDate}:${userId}`,
            guildId,
            user: {
                id: userId,
            },
            showModal,
        } as unknown as ButtonInteraction;

        store.set(userId, puzzle.printDate, guildId, session);

        await handleWordleButton(interaction, store);

        expect(showModal).toHaveBeenCalledOnce();
        const shownModal = showModal.mock.calls[0]?.[0] as {
            toJSON(): unknown;
        };
        expect(shownModal.toJSON()).toMatchObject({
            custom_id: `wordle:guess-modal:${puzzle.printDate}:${userId}`,
            title: "Wordle 단어 입력",
        });
    });

    it("현재 진행 공유 버튼을 누르면 공개 패널을 만들고 공유 버튼을 제거합니다", async () => {
        const userId = "12345678901234567";
        const store = new WordleSessionStore();
        const session: WordleSession = {
            game: createWordleGame(puzzle),
            panelMessage: undefined,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        };
        const panelMessage = {
            id: "public-panel",
            editable: true,
            url: "https://discord.com/channels/guild/channel/public-panel",
        } as Message;
        const send = vi.fn().mockResolvedValue(panelMessage);
        const deferUpdate = vi.fn().mockResolvedValue(undefined);
        const editReply = vi.fn().mockResolvedValue({
            id: "private-message",
        });
        const interaction = {
            customId: `wordle:progress-share:${puzzle.printDate}:${userId}`,
            guildId,
            id: "progress-share-interaction",
            channel: {
                isSendable: () => true,
                send,
            },
            channelId: "channel-id",
            client: {
                channels: {
                    fetch: vi.fn(),
                },
            },
            deferUpdate,
            editReply,
            user: {
                id: userId,
                displayAvatarURL: () => "https://cdn.example.com/avatar.png",
            },
        } as unknown as ButtonInteraction;

        store.set(userId, puzzle.printDate, guildId, session);

        await handleWordleButton(interaction, store);

        expect(deferUpdate).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledOnce();
        expect(editReply).toHaveBeenCalledOnce();
        expect(store.get(userId, puzzle.printDate, guildId)?.panelMessage).toBe(panelMessage);

        const editOptions = editReply.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
        };
        const serializedResponse = JSON.stringify(editOptions.components[0]?.toJSON());

        expect(serializedResponse).toContain("현재 진행 상황을 공개했습니다.");
        expect(serializedResponse).not.toContain("현재 진행 공유");
        expect(serializedResponse).not.toContain("게임 패널로 이동");
    });

    it("이전 화면을 삭제한 뒤 현재 지연 응답을 비공개 게임 화면으로 수정합니다", async () => {
        const previousDeleteReply = vi.fn().mockResolvedValue(undefined);
        const editReply = vi.fn<(options: unknown) => Promise<Message>>().mockResolvedValue({
            id: "private-message",
        } as Message);
        const previousInteraction = {
            id: "previous-interaction",
            deleteReply: previousDeleteReply,
        } as unknown as ChatInputCommandInteraction;
        const currentInteraction = {
            id: "current-interaction",
            deferred: true,
            editReply,
            guildId,
            user: {
                id: "12345678901234567",
            },
        } as unknown as ChatInputCommandInteraction;
        const session: WordleSession = {
            game: submitGuess(createWordleGame(puzzle), "crane"),
            panelMessage: {
                url: "https://discord.com/channels/guild/channel/message",
            } as Message,
            privateResponseInteraction: previousInteraction,
            privateResponseMessageId: "previous-private-message",
            resultShared: false,
        };

        await showPrivateWordleState(currentInteraction, session, "진행 상황입니다.");

        expect(previousDeleteReply).toHaveBeenCalledWith("previous-private-message");
        expect(editReply).toHaveBeenCalledOnce();
        expect(editReply.mock.calls[0]?.[0]).toMatchObject({
            components: [expect.anything()],
            flags: 32_768,
        });

        const editOptions = editReply.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
        };
        const containerJson = JSON.stringify(editOptions.components[0]?.toJSON());

        expect(editOptions).toMatchObject({
            content: null,
            embeds: [],
        });
        expect(containerJson).toContain("진행 상황입니다.");
        expect(containerJson).toContain("### 나의 Wordle #1860");
        expect(containerJson).toContain("단어 입력");
    });
});

describe("Wordle 모달 입력", () => {
    it("로컬 목록에 없는 단어는 횟수를 차감하지 않고 입력 버튼이 있는 화면으로 돌아갑니다", async () => {
        const userId = "12345678901234567";
        const store = new WordleSessionStore();
        const session: WordleSession = {
            game: createWordleGame(puzzle),
            panelMessage: undefined,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        };
        const deferUpdate = vi.fn().mockResolvedValue(undefined);
        const editReply = vi.fn().mockResolvedValue({
            id: "private-message",
        });
        const interaction = {
            customId: `wordle:guess-modal:${puzzle.printDate}:${userId}`,
            guildId,
            id: "modal-interaction",
            deferUpdate,
            editReply,
            fields: {
                getTextInputValue: () => "zzzzz",
            },
            user: {
                id: userId,
            },
        } as unknown as ModalSubmitInteraction;
        const dictionary = {
            isEnglishWord: vi.fn().mockReturnValue(false),
        };

        store.set(userId, puzzle.printDate, guildId, session);

        await handleWordleModal(interaction, store, dictionary);

        expect(dictionary.isEnglishWord).toHaveBeenCalledWith("zzzzz");
        expect(store.get(userId, puzzle.printDate, guildId)?.game.guesses).toEqual([]);
        expect(store.getRecentPlayers(guildId, puzzle.printDate, 8).totalPlayers).toBe(0);
        expect(deferUpdate).toHaveBeenCalledOnce();
        expect(editReply).toHaveBeenCalledOnce();

        const response = editReply.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
            flags: number;
        };
        const serializedResponse = JSON.stringify(response.components[0]?.toJSON());

        expect(response.flags).toBe(32_768);
        expect(serializedResponse).toContain("등록된 5글자 영단어가 아닙니다.");
        expect(serializedResponse).toContain("단어 입력");
    });

    it("현재 진행을 공유하지 않은 게임은 단어 입력 후에도 공개 패널을 만들지 않습니다", async () => {
        const userId = "12345678901234567";
        const store = new WordleSessionStore();
        const session: WordleSession = {
            game: createWordleGame(puzzle),
            panelMessage: undefined,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        };
        const deferUpdate = vi.fn().mockResolvedValue(undefined);
        const editReply = vi.fn().mockResolvedValue({
            id: "private-message",
        });
        const interaction = {
            customId: `wordle:guess-modal:${puzzle.printDate}:${userId}`,
            guildId,
            id: "modal-interaction",
            deferUpdate,
            editReply,
            fields: {
                getTextInputValue: () => "CRANE",
            },
            user: {
                id: userId,
                displayAvatarURL: () => "https://cdn.example.com/avatar.png",
            },
        } as unknown as ModalSubmitInteraction;
        const dictionary = {
            isEnglishWord: vi.fn().mockReturnValue(true),
        };

        store.set(userId, puzzle.printDate, guildId, session);

        await handleWordleModal(interaction, store, dictionary);

        const updatedSession = store.get(userId, puzzle.printDate, guildId);

        expect(updatedSession?.panelMessage).toBeUndefined();
        expect(updatedSession?.game.guesses.map((guess) => guess.word)).toEqual(["crane"]);
        expect(deferUpdate).toHaveBeenCalledOnce();
        expect(editReply).toHaveBeenCalledOnce();
    });

    it("유효한 단어 입력은 활동 순번을 기록하고 공개 현황 패널을 수정합니다", async () => {
        const userId = "12345678901234567";
        const channelId = "32345678901234567";
        const statusMessageId = "42345678901234567";
        const store = new WordleSessionStore();
        const session: WordleSession = {
            game: createWordleGame(puzzle),
            panelMessage: undefined,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        };
        const statusMessageEdit = vi.fn().mockResolvedValue(undefined);
        const statusMessage = {
            edit: statusMessageEdit,
        };
        const fetchStatusMessage = vi.fn().mockResolvedValue(statusMessage);
        const editReply = vi.fn().mockResolvedValue({
            id: "private-message",
        });
        const interaction = {
            customId: `wordle:guess-modal:${puzzle.printDate}:${userId}`,
            guildId,
            channelId,
            channel: {
                isSendable: () => true,
                messages: {
                    fetch: fetchStatusMessage,
                },
            },
            id: "modal-interaction",
            deferUpdate: vi.fn().mockResolvedValue(undefined),
            editReply,
            fields: {
                getTextInputValue: () => "ALLEY",
            },
            user: {
                id: userId,
            },
        } as unknown as ModalSubmitInteraction;
        const dictionary = {
            isEnglishWord: vi.fn().mockReturnValue(true),
        };

        store.set(userId, puzzle.printDate, guildId, session);
        store.setPublicStatusPanel({
            guildId,
            channelId,
            messageId: statusMessageId,
            printDate: puzzle.printDate,
        });

        await handleWordleModal(interaction, store, dictionary);

        expect(fetchStatusMessage).toHaveBeenCalledWith({
            message: statusMessageId,
            force: true,
        });
        expect(statusMessageEdit).toHaveBeenCalledOnce();
        expect(store.getRecentPlayers(guildId, puzzle.printDate, 8)).toMatchObject({
            totalPlayers: 1,
            players: [
                {
                    userId,
                    activityOrder: 1,
                },
            ],
        });

        const statusUpdate = statusMessageEdit.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
            allowedMentions: unknown;
        };
        const serializedStatus = JSON.stringify(statusUpdate.components[0]?.toJSON());

        expect(statusUpdate.allowedMentions).toEqual({
            parse: [],
            users: [],
            roles: [],
            repliedUser: false,
        });
        expect(serializedStatus).toContain(`<@${userId}> **진행 중** · **1/6**`);
        expect(serializedStatus).toContain("찾음: 🟨 2개 · 🟩 1개");
        expect(serializedStatus).toContain(`wordle:status-view:${puzzle.printDate}:${userId}`);
        expect(serializedStatus).not.toContain("alley");
        expect(serializedStatus).not.toContain("apple");
    });

    it("현재 진행을 공유한 게임은 단어 입력 후 공개 패널과 기존 비공개 화면을 수정합니다", async () => {
        const userId = "12345678901234567";
        const store = new WordleSessionStore();
        const panelMessage = {
            editable: true,
            url: "https://discord.com/channels/guild/channel/panel",
        } as Message;
        const panelEdit = vi.fn().mockResolvedValue(panelMessage);
        Object.assign(panelMessage, { edit: panelEdit });
        const session: WordleSession = {
            game: createWordleGame(puzzle),
            panelMessage,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        };
        const deferUpdate = vi.fn().mockResolvedValue(undefined);
        const editReply = vi.fn().mockResolvedValue({
            id: "private-message",
        });
        const interaction = {
            customId: `wordle:guess-modal:${puzzle.printDate}:${userId}`,
            guildId,
            id: "modal-interaction",
            deferUpdate,
            editReply,
            fields: {
                getTextInputValue: () => "CRANE",
            },
            user: {
                id: userId,
                displayAvatarURL: () => "https://cdn.example.com/avatar.png",
            },
        } as unknown as ModalSubmitInteraction;
        const dictionary = {
            isEnglishWord: vi.fn().mockReturnValue(true),
        };

        store.set(userId, puzzle.printDate, guildId, session);

        await handleWordleModal(interaction, store, dictionary);

        expect(panelEdit).toHaveBeenCalledOnce();
        expect(
            store.get(userId, puzzle.printDate, guildId)?.game.guesses.map((guess) => guess.word),
        ).toEqual(["crane"]);
        expect(deferUpdate).toHaveBeenCalledOnce();
        expect(editReply).toHaveBeenCalledOnce();

        const response = editReply.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
        };
        const serializedResponse = JSON.stringify(response.components[0]?.toJSON());

        expect(serializedResponse).toContain("`CRANE`");
        expect(serializedResponse).toContain("단어 입력");
    });
});
