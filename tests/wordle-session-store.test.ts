import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Message } from "discord.js";
import { afterEach, describe, expect, it } from "vitest";

import { createWordleGame, submitGuess } from "../src/features/wordle/game.js";
import type { WordleGame, WordlePuzzle } from "../src/features/wordle/game.js";
import { WordleSessionStore } from "../src/features/wordle/session-store.js";
import type { WordleSession } from "../src/features/wordle/session-store.js";

const puzzle: WordlePuzzle = {
    id: 2_906,
    solution: "apple",
    printDate: "2026-07-24",
    puzzleNumber: 1_861,
};
const userId = "12345678901234567";
const guildId = "22345678901234567";

function createSession(game: WordleGame): WordleSession {
    return {
        game,
        panelMessage: undefined,
        privateResponseInteraction: undefined,
        privateResponseMessageId: undefined,
        resultShared: false,
    };
}

describe("Wordle SQLite 세션 저장소", () => {
    const temporaryDirectories: string[] = [];
    const stores: WordleSessionStore[] = [];

    function createDatabasePath(): string {
        const temporaryDirectory = mkdtempSync(join(tmpdir(), "kkomaengtong-wordle-"));
        temporaryDirectories.push(temporaryDirectory);

        return join(temporaryDirectory, "nested", "wordle.sqlite");
    }

    function openStore(databasePath: string): WordleSessionStore {
        const store = new WordleSessionStore({ databasePath });
        stores.push(store);

        return store;
    }

    afterEach(() => {
        for (const store of stores.splice(0)) {
            store.close();
        }

        for (const temporaryDirectory of temporaryDirectories.splice(0)) {
            rmSync(temporaryDirectory, { recursive: true, force: true });
        }
    });

    it("봇이 재시작되어도 사용자의 추측과 게임 상태를 복원합니다", () => {
        const databasePath = createDatabasePath();
        const firstStore = openStore(databasePath);
        const playingGame = submitGuess(createWordleGame(puzzle), "crane");

        firstStore.set(userId, puzzle.printDate, guildId, {
            ...createSession(playingGame),
            panelMessage: { id: "public-panel" } as Message,
            resultShared: true,
        });
        firstStore.close();

        const restartedStore = openStore(databasePath);
        const restoredSession = restartedStore.get(userId, puzzle.printDate, guildId);

        expect(restoredSession?.game).toEqual(playingGame);
        expect(restoredSession).toMatchObject({
            panelMessage: undefined,
            privateResponseInteraction: undefined,
            privateResponseMessageId: undefined,
            resultShared: false,
        });
    });

    it("복원한 게임에 추가한 추측도 SQLite에 다시 저장합니다", () => {
        const databasePath = createDatabasePath();
        const firstStore = openStore(databasePath);
        const playingGame = submitGuess(createWordleGame(puzzle), "crane");

        firstStore.set(userId, puzzle.printDate, guildId, createSession(playingGame));
        firstStore.close();

        const secondStore = openStore(databasePath);
        const restoredSession = secondStore.get(userId, puzzle.printDate, guildId);

        expect(restoredSession).toBeDefined();

        if (restoredSession === undefined) {
            throw new Error("복원할 Wordle 세션이 없습니다.");
        }

        const wonGame = submitGuess(restoredSession.game, "apple");
        secondStore.set(userId, puzzle.printDate, guildId, createSession(wonGame));
        secondStore.close();

        const thirdStore = openStore(databasePath);

        expect(thirdStore.get(userId, puzzle.printDate, guildId)?.game).toEqual(wonGame);
    });

    it("저장된 게임은 다른 서버에서도 같은 사용자의 진행 사항으로 복원합니다", () => {
        const databasePath = createDatabasePath();
        const firstStore = openStore(databasePath);
        const game = submitGuess(createWordleGame(puzzle), "crane");

        firstStore.set(userId, puzzle.printDate, guildId, createSession(game));
        firstStore.close();

        const restartedStore = openStore(databasePath);
        const otherGuildId = "32345678901234567";

        expect(restartedStore.get(userId, puzzle.printDate, otherGuildId)?.game).toEqual(game);
    });

    it("같은 날짜에 진행한 서로 다른 사용자의 게임을 분리해서 저장합니다", () => {
        const databasePath = createDatabasePath();
        const firstStore = openStore(databasePath);
        const otherUserId = "42345678901234567";
        const firstGame = submitGuess(createWordleGame(puzzle), "crane");
        const otherGame = submitGuess(createWordleGame(puzzle), "slate");

        firstStore.set(userId, puzzle.printDate, guildId, createSession(firstGame));
        firstStore.set(otherUserId, puzzle.printDate, guildId, createSession(otherGame));
        firstStore.close();

        const restartedStore = openStore(databasePath);

        expect(restartedStore.get(userId, puzzle.printDate, guildId)?.game).toEqual(firstGame);
        expect(restartedStore.get(otherUserId, puzzle.printDate, guildId)?.game).toEqual(otherGame);
    });
});
