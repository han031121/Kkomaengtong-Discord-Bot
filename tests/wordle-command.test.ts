import type {
    ButtonInteraction,
    ChatInputCommandInteraction,
    Message,
    ModalSubmitInteraction,
} from "discord.js";
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
    sendPublicWordlePanel,
    showPrivateWordleState,
    updatePublicWordlePanel,
    wordleCommand,
} from "../src/commands/wordle.js";
import { createWordleGame, submitGuess } from "../src/features/wordle/game.js";
import type { WordlePuzzle } from "../src/features/wordle/game.js";
import { NytWordleClient } from "../src/features/wordle/nyt-wordle-client.js";
import { WordleSessionStore } from "../src/features/wordle/session-store.js";
import type { WordleSession } from "../src/features/wordle/session-store.js";

const puzzle: WordlePuzzle = {
    id: 1234,
    solution: "apple",
    printDate: "2026-07-23",
    puzzleNumber: 1860,
};

describe("Wordle 공개 메시지 전송", () => {
    it("/워들 실행 시 공개 패널 없이 버튼이 있는 비공개 화면만 표시합니다", async () => {
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
            channelId: "channel-id",
            client: {
                channels: {
                    fetch: vi.fn(),
                },
            },
            user: {
                id: userId,
                displayAvatarURL: () => "https://cdn.example.com/avatar.png",
            },
        } as unknown as ChatInputCommandInteraction;
        const puzzleRequest = vi
            .spyOn(NytWordleClient.prototype, "getTodaysPuzzle")
            .mockResolvedValue(puzzle);

        try {
            await wordleCommand.execute(interaction);
        } finally {
            puzzleRequest.mockRestore();
        }

        expect(send).not.toHaveBeenCalled();
        expect(editReply).toHaveBeenCalledOnce();

        const privateResponse = editReply.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
            flags: number;
        };
        const serializedResponse = JSON.stringify(privateResponse.components[0]?.toJSON());

        expect(privateResponse.flags).toBe(32_768);
        expect(serializedResponse).toContain("### 나의 Wordle #1860");
        expect(serializedResponse).toContain("단어 입력");
        expect(serializedResponse).toContain("현재 진행 공유");
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

describe("Wordle 결과 버튼", () => {
    it("진행 중인 비공개 화면에 단어 입력과 현재 진행 공유 버튼을 생성합니다", () => {
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
            ],
        });
    });

    it("현재 진행을 공유한 뒤에는 단어 입력 버튼만 표시합니다", () => {
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

    it("결과 공유와 스포하기 버튼을 순서대로 생성합니다", () => {
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
            ],
        });
    });

    it("공개한 진행 패널이 없어도 결과 공유와 스포하기 버튼을 생성합니다", () => {
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
            ],
        });
    });

    it("진행 중이거나 이미 공유한 게임에서는 결과 공유 버튼을 비활성화합니다", () => {
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

    it("Wordle 버튼 식별자는 날짜와 사용자 ID 형식을 검증합니다", () => {
        expect(isWordleButton("wordle:share:2026-07-23:12345678901234567")).toBe(true);
        expect(isWordleButton("wordle:spoiler:2026-07-23:12345678901234567")).toBe(true);
        expect(isWordleButton("wordle:view:2026-07-23:12345678901234567")).toBe(false);
        expect(isWordleButton("wordle:input:2026-07-23:12345678901234567")).toBe(true);
        expect(isWordleButton("wordle:progress-share:2026-07-23:12345678901234567")).toBe(true);
        expect(isWordleButton("wordle:share:wrong-date:12345678901234567")).toBe(false);
        expect(isWordleButton("another:share:2026-07-23:12345678901234567")).toBe(false);
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
            user: {
                id: userId,
            },
            showModal,
        } as unknown as ButtonInteraction;

        store.set(userId, puzzle.printDate, session);

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

        store.set(userId, puzzle.printDate, session);

        await handleWordleButton(interaction, store);

        expect(deferUpdate).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledOnce();
        expect(editReply).toHaveBeenCalledOnce();
        expect(store.get(userId, puzzle.printDate)?.panelMessage).toBe(panelMessage);

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
    it("사전에 없는 단어는 횟수를 차감하지 않고 입력 버튼이 있는 화면으로 돌아갑니다", async () => {
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
            isEnglishWord: vi.fn().mockResolvedValue(false),
        };

        store.set(userId, puzzle.printDate, session);

        await handleWordleModal(interaction, store, dictionary);

        expect(dictionary.isEnglishWord).toHaveBeenCalledWith("zzzzz");
        expect(store.get(userId, puzzle.printDate)?.game.guesses).toEqual([]);
        expect(deferUpdate).toHaveBeenCalledOnce();
        expect(editReply).toHaveBeenCalledOnce();

        const response = editReply.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
            flags: number;
        };
        const serializedResponse = JSON.stringify(response.components[0]?.toJSON());

        expect(response.flags).toBe(32_768);
        expect(serializedResponse).toContain("사전에 등록된 5글자 영단어가 아닙니다.");
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
            isEnglishWord: vi.fn().mockResolvedValue(true),
        };

        store.set(userId, puzzle.printDate, session);

        await handleWordleModal(interaction, store, dictionary);

        const updatedSession = store.get(userId, puzzle.printDate);

        expect(updatedSession?.panelMessage).toBeUndefined();
        expect(updatedSession?.game.guesses.map((guess) => guess.word)).toEqual(["crane"]);
        expect(deferUpdate).toHaveBeenCalledOnce();
        expect(editReply).toHaveBeenCalledOnce();
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
            isEnglishWord: vi.fn().mockResolvedValue(true),
        };

        store.set(userId, puzzle.printDate, session);

        await handleWordleModal(interaction, store, dictionary);

        expect(panelEdit).toHaveBeenCalledOnce();
        expect(
            store.get(userId, puzzle.printDate)?.game.guesses.map((guess) => guess.word),
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
