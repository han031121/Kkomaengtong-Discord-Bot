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
    startWordleGame,
    updatePublicWordlePanel,
    wordleCommand,
} from "../src/commands/wordle.js";
import { DictionaryClient } from "../src/features/wordle/dictionary-client.js";
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
const guildId = "22345678901234567";

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
        const puzzleRequest = vi
            .spyOn(NytWordleClient.prototype, "getTodaysPuzzle")
            .mockResolvedValue(puzzle);
        const dictionaryRequest = vi
            .spyOn(DictionaryClient.prototype, "isEnglishWord")
            .mockResolvedValue(true);

        try {
            await wordleCommand.execute(interaction);

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
            puzzleRequest.mockRestore();
            dictionaryRequest.mockRestore();
        }
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

        await startWordleGame(otherGuild.interaction, createWordleGame(puzzle), store);

        expect(panelEdit).not.toHaveBeenCalled();
        expect(
            store
                .get(userId, puzzle.printDate, otherGuildId)
                ?.game.guesses.map((guess) => guess.word),
        ).toEqual(["crane"]);
        expect(store.get(userId, puzzle.printDate, otherGuildId)?.panelMessage).toBeUndefined();
        expect(store.get(userId, puzzle.printDate, guildId)?.game.guesses).toHaveLength(1);

        const otherGuildPrivateUpdate = otherGuild.editReply.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
        };
        expect(JSON.stringify(otherGuildPrivateUpdate.components[0]?.toJSON())).toContain(
            "`CRANE`",
        );

        const currentGuild = createInteraction(guildId);
        await startWordleGame(currentGuild.interaction, createWordleGame(puzzle), store);

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

    it("한 서버의 단어 입력은 공통 게임에 반영하고 해당 서버의 공개 패널만 수정합니다", async () => {
        const userId = "72345678901234567";
        const otherGuildId = "82345678901234567";
        const store = new WordleSessionStore();
        const currentGuildPanel = {
            editable: true,
        } as Message;
        const otherGuildPanel = {
            editable: true,
        } as Message;
        const currentGuildPanelEdit = vi.fn().mockResolvedValue(currentGuildPanel);
        const otherGuildPanelEdit = vi.fn().mockResolvedValue(otherGuildPanel);
        Object.assign(currentGuildPanel, { edit: currentGuildPanelEdit });
        Object.assign(otherGuildPanel, { edit: otherGuildPanelEdit });
        const createSession = (panelMessage: Message): WordleSession => ({
            game: createWordleGame(puzzle),
            panelMessage,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        });
        store.set(userId, puzzle.printDate, guildId, createSession(currentGuildPanel));
        store.set(userId, puzzle.printDate, otherGuildId, createSession(otherGuildPanel));

        const interaction = {
            customId: `wordle:guess-modal:${puzzle.printDate}:${userId}`,
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
            isEnglishWord: vi.fn().mockResolvedValue(true),
        };

        await handleWordleModal(interaction, store, dictionary);

        expect(currentGuildPanelEdit).not.toHaveBeenCalled();
        expect(otherGuildPanelEdit).toHaveBeenCalledOnce();
        expect(
            store.get(userId, puzzle.printDate, guildId)?.game.guesses.map((guess) => guess.word),
        ).toEqual(["crane"]);
        expect(
            store
                .get(userId, puzzle.printDate, otherGuildId)
                ?.game.guesses.map((guess) => guess.word),
        ).toEqual(["crane"]);
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
        expect(actionRow?.components).toHaveLength(1);
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
            editReply,
            guildId,
            user: {
                id: userId,
                displayAvatarURL: () => "https://cdn.example.com/avatar.png",
            },
        } as unknown as ChatInputCommandInteraction;
        store.set(userId, puzzle.printDate, guildId, session);

        await startWordleGame(interaction, createWordleGame(puzzle), store);

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
            isEnglishWord: vi.fn().mockResolvedValue(false),
        };

        store.set(userId, puzzle.printDate, guildId, session);

        await handleWordleModal(interaction, store, dictionary);

        expect(dictionary.isEnglishWord).toHaveBeenCalledWith("zzzzz");
        expect(store.get(userId, puzzle.printDate, guildId)?.game.guesses).toEqual([]);
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
            isEnglishWord: vi.fn().mockResolvedValue(true),
        };

        store.set(userId, puzzle.printDate, guildId, session);

        await handleWordleModal(interaction, store, dictionary);

        const updatedSession = store.get(userId, puzzle.printDate, guildId);

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
            isEnglishWord: vi.fn().mockResolvedValue(true),
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
