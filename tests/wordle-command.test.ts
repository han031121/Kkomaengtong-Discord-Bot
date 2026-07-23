import type { ButtonInteraction, ChatInputCommandInteraction, Message } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import {
    createPublicWordlePanelButtons,
    createWordleResultButtons,
    createWordleResultComponents,
    handleSpoilerButton,
    handleWordleButton,
    isWordleButton,
    sendPublicWordlePanel,
    showPrivateWordleState,
    updatePublicWordlePanel,
} from "../src/commands/wordle.js";
import { createWordleGame, submitGuess } from "../src/features/wordle/game.js";
import type { WordlePuzzle } from "../src/features/wordle/game.js";
import { WordleSessionStore } from "../src/features/wordle/session-store.js";
import type { WordleSession } from "../src/features/wordle/session-store.js";

const puzzle: WordlePuzzle = {
    id: 1234,
    solution: "apple",
    printDate: "2026-07-23",
    puzzleNumber: 1860,
};

describe("Wordle 공개 메시지 전송", () => {
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
        expect(containerJson).toContain("내 게임 보기");
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
    it("공개 패널에 소유자용 게임 보기 버튼을 생성합니다", () => {
        expect(
            createPublicWordlePanelButtons(createWordleGame(puzzle), "12345678901234567").toJSON(),
        ).toEqual({
            type: 1,
            components: [
                {
                    type: 2,
                    custom_id: "wordle:view:2026-07-23:12345678901234567",
                    label: "내 게임 보기",
                    style: 2,
                },
            ],
        });
    });

    it("결과 공유, 게임 패널 이동, 스포하기 버튼을 순서대로 생성합니다", () => {
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
                    label: "게임 패널로 이동",
                    style: 5,
                    url: panelMessage.url,
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
        expect(isWordleButton("wordle:view:2026-07-23:12345678901234567")).toBe(true);
        expect(isWordleButton("wordle:share:wrong-date:12345678901234567")).toBe(false);
        expect(isWordleButton("another:share:2026-07-23:12345678901234567")).toBe(false);
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
    it("다른 사용자의 공개 패널에서도 버튼을 누른 사용자의 게임을 표시합니다", async () => {
        const ownerId = "12345678901234567";
        const viewerId = "22345678901234567";
        const store = new WordleSessionStore();
        const ownerSession: WordleSession = {
            game: submitGuess(createWordleGame(puzzle), "alley"),
            panelMessage: {
                url: "https://discord.com/channels/guild/channel/owner-panel",
            } as Message,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        };
        const viewerSession: WordleSession = {
            game: submitGuess(createWordleGame(puzzle), "crane"),
            panelMessage: {
                url: "https://discord.com/channels/guild/channel/viewer-panel",
            } as Message,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        };
        const reply = vi.fn().mockResolvedValue(undefined);
        const fetchReply = vi.fn().mockResolvedValue({
            id: "viewer-private-message",
        });
        const interaction = {
            customId: `wordle:view:${puzzle.printDate}:${ownerId}`,
            id: "viewer-interaction",
            deferred: false,
            reply,
            fetchReply,
            user: {
                id: viewerId,
            },
        } as unknown as ButtonInteraction;

        store.set(ownerId, puzzle.printDate, ownerSession);
        store.set(viewerId, puzzle.printDate, viewerSession);

        await handleWordleButton(interaction, store);

        expect(reply).toHaveBeenCalledOnce();

        const replyOptions = reply.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
            flags: number;
        };
        const containerJson = JSON.stringify(replyOptions.components[0]?.toJSON());

        expect(replyOptions.flags).toBe(32_832);
        expect(containerJson).toContain("`CRANE`");
        expect(containerJson).not.toContain("`ALLEY`");
    });

    it("이전 화면과 지연 응답을 삭제한 뒤 새 비공개 후속 메시지를 생성합니다", async () => {
        const previousDeleteReply = vi.fn().mockResolvedValue(undefined);
        const currentDeleteReply = vi.fn().mockResolvedValue(undefined);
        const followUp = vi.fn<(options: unknown) => Promise<Message>>().mockResolvedValue({
            id: "private-message",
        } as Message);
        const previousInteraction = {
            id: "previous-interaction",
            deleteReply: previousDeleteReply,
        } as unknown as ChatInputCommandInteraction;
        const currentInteraction = {
            id: "current-interaction",
            deferred: true,
            deleteReply: currentDeleteReply,
            followUp,
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
        expect(currentDeleteReply).toHaveBeenCalledOnce();
        expect(followUp).toHaveBeenCalledOnce();
        expect(followUp.mock.calls[0]?.[0]).toMatchObject({
            components: [expect.anything()],
            flags: 32_832,
        });

        const followUpOptions = followUp.mock.calls[0]?.[0] as {
            components: { toJSON(): unknown }[];
        };
        const containerJson = JSON.stringify(followUpOptions.components[0]?.toJSON());

        expect(followUpOptions).not.toHaveProperty("content");
        expect(followUpOptions).not.toHaveProperty("embeds");
        expect(containerJson).toContain("진행 상황입니다.");
        expect(containerJson).toContain("### 나의 Wordle #1860");
    });
});
