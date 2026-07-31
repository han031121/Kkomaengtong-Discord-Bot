import type {
    ButtonInteraction,
    ChatInputCommandInteraction,
    ModalSubmitInteraction,
} from "discord.js";
import { vi } from "vitest";
import type { Mock } from "vitest";

import type { WordleSession, WordleSessionStore } from "../src/commands/wordle.js";
import { createWordleGame, submitGuess } from "../src/features/wordle/game.js";
import type { WordleGame, WordlePuzzle } from "../src/features/wordle/game.js";

export const WORDLE_TEST_IDS = {
    channel: "32345678901234567",
    guild: "22345678901234567",
    message: "42345678901234567",
    otherGuild: "52345678901234567",
    otherUser: "13345678901234567",
    user: "12345678901234567",
} as const;

export const WORDLE_TEST_PUZZLE: WordlePuzzle = {
    id: 1234,
    solution: "apple",
    printDate: "2026-07-23",
    puzzleNumber: 1860,
};

export function createPuzzleProvider(puzzle: WordlePuzzle = WORDLE_TEST_PUZZLE) {
    return {
        getTodaysPuzzle: vi.fn(() => puzzle),
    };
}

export function createLostGame(puzzle: WordlePuzzle = WORDLE_TEST_PUZZLE): WordleGame {
    let game = createWordleGame(puzzle);

    for (let guessCount = 0; guessCount < 6; guessCount += 1) {
        game = submitGuess(game, "crane");
    }

    return game;
}

export function createSession(overrides: Partial<WordleSession> = {}): WordleSession {
    return {
        game: createWordleGame(WORDLE_TEST_PUZZLE),
        panelMessage: undefined,
        privateResponseInteraction: undefined,
        privateResponseMessageId: undefined,
        resultShared: false,
        ...overrides,
    };
}

export function seedSession(
    store: WordleSessionStore,
    overrides: Partial<WordleSession> = {},
    userId = WORDLE_TEST_IDS.user,
    guildId = WORDLE_TEST_IDS.guild,
): WordleSession {
    const session = createSession(overrides);

    store.set(userId, session.game.puzzle.printDate, guildId, session);
    return session;
}

export function createDictionary(isValid = true) {
    return {
        isEnglishWord: vi.fn().mockReturnValue(isValid),
    };
}

interface InteractionOptions {
    channelId?: string;
    fetchChannel?: Mock;
    fetchMessage?: Mock;
    guildId?: string;
    send?: Mock;
    userId?: string;
}

interface CommandInteractionOptions extends InteractionOptions {
    deferred?: boolean;
    guess?: string | null;
}

export function createCommandInteraction(options: CommandInteractionOptions = {}) {
    let deferred = options.deferred ?? false;
    const send = options.send ?? vi.fn();
    const fetchMessage = options.fetchMessage ?? vi.fn();
    const fetchChannel = options.fetchChannel ?? vi.fn();
    const editReply = vi.fn().mockResolvedValue({ id: "private-message" });
    const deferReply = vi.fn().mockImplementation(() => {
        deferred = true;
        return Promise.resolve();
    });
    const interaction = {
        id: "command-interaction",
        get deferred() {
            return deferred;
        },
        channel: {
            isSendable: () => true,
            messages: { fetch: fetchMessage },
            send,
        },
        channelId: options.channelId ?? WORDLE_TEST_IDS.channel,
        client: {
            channels: { fetch: fetchChannel },
        },
        deferReply,
        editReply,
        guildId: options.guildId ?? WORDLE_TEST_IDS.guild,
        options: {
            getString: () => options.guess ?? null,
        },
        user: {
            id: options.userId ?? WORDLE_TEST_IDS.user,
            displayAvatarURL: () => "https://cdn.example.com/avatar.png",
        },
    } as unknown as ChatInputCommandInteraction;

    return {
        deferReply,
        editReply,
        fetchChannel,
        fetchMessage,
        interaction,
        send,
    };
}

type ButtonInteractionOptions = InteractionOptions;

export function createButtonInteraction(customId: string, options: ButtonInteractionOptions = {}) {
    let deferred = false;
    const send = options.send ?? vi.fn();
    const fetchMessage = options.fetchMessage ?? vi.fn();
    const fetchChannel = options.fetchChannel ?? vi.fn();
    const editReply = vi.fn().mockResolvedValue({ id: "private-message" });
    const deferReply = vi.fn().mockImplementation(() => {
        deferred = true;
        return Promise.resolve();
    });
    const deferUpdate = vi.fn().mockImplementation(() => {
        deferred = true;
        return Promise.resolve();
    });
    const reply = vi.fn().mockResolvedValue(undefined);
    const showModal = vi.fn().mockResolvedValue(undefined);
    const interaction = {
        id: "button-interaction",
        get deferred() {
            return deferred;
        },
        channel: {
            isSendable: () => true,
            messages: { fetch: fetchMessage },
            send,
        },
        channelId: options.channelId ?? WORDLE_TEST_IDS.channel,
        client: {
            channels: { fetch: fetchChannel },
        },
        customId,
        deferReply,
        deferUpdate,
        editReply,
        guildId: options.guildId ?? WORDLE_TEST_IDS.guild,
        message: {
            id: WORDLE_TEST_IDS.message,
        },
        reply,
        showModal,
        user: {
            id: options.userId ?? WORDLE_TEST_IDS.user,
            displayAvatarURL: () => "https://cdn.example.com/avatar.png",
        },
    } as unknown as ButtonInteraction;

    return {
        deferReply,
        deferUpdate,
        editReply,
        fetchChannel,
        fetchMessage,
        interaction,
        reply,
        send,
        showModal,
    };
}

interface ModalInteractionOptions extends InteractionOptions {
    guess?: string;
}

export function createModalInteraction(options: ModalInteractionOptions = {}) {
    const userId = options.userId ?? WORDLE_TEST_IDS.user;
    const send = options.send ?? vi.fn();
    const fetchMessage = options.fetchMessage ?? vi.fn();
    const fetchChannel = options.fetchChannel ?? vi.fn();
    const editReply = vi.fn().mockResolvedValue({ id: "private-message" });
    const deferUpdate = vi.fn().mockResolvedValue(undefined);
    const interaction = {
        channel: {
            isSendable: () => true,
            messages: { fetch: fetchMessage },
            send,
        },
        channelId: options.channelId ?? WORDLE_TEST_IDS.channel,
        client: {
            channels: { fetch: fetchChannel },
        },
        customId: `wordle:guess-modal:${WORDLE_TEST_PUZZLE.printDate}:${userId}`,
        deferUpdate,
        editReply,
        fields: {
            getTextInputValue: () => options.guess ?? "crane",
        },
        guildId: options.guildId ?? WORDLE_TEST_IDS.guild,
        id: "modal-interaction",
        user: {
            id: userId,
            displayAvatarURL: () => "https://cdn.example.com/avatar.png",
        },
    } as unknown as ModalSubmitInteraction;

    return {
        deferUpdate,
        editReply,
        fetchChannel,
        fetchMessage,
        interaction,
        send,
    };
}

export function getCallArgument<T>(mock: Mock, callIndex = 0): T {
    const call = mock.mock.calls[callIndex];

    if (call === undefined) {
        throw new Error(`호출 기록 ${callIndex}번을 찾을 수 없습니다.`);
    }

    return call[0] as T;
}

export function getComponentJson(mock: Mock, callIndex = 0, componentIndex = 0): string {
    const response = getCallArgument<{
        components: { toJSON(): unknown }[];
    }>(mock, callIndex);

    return JSON.stringify(response.components[componentIndex]?.toJSON());
}

export function wordleButtonId(
    action:
        "input" | "play" | "progress-share" | "share" | "spoiler" | "status-panel" | "status-view",
    userId = WORDLE_TEST_IDS.user,
): string {
    if (action === "play") {
        return "wordle:play";
    }

    return `wordle:${action}:${WORDLE_TEST_PUZZLE.printDate}:${userId}`;
}
