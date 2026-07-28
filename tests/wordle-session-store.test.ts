import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

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

    it("최근 활동 순번으로 사용자 8명을 정확하게 정렬합니다", () => {
        const store = new WordleSessionStore();
        stores.push(store);
        const userIds = Array.from({ length: 9 }, (_, index) => `1234567890123456${index}`);

        for (const recentUserId of userIds) {
            const game = submitGuess(createWordleGame(puzzle), "crane");
            store.recordValidGuess(recentUserId, puzzle.printDate, guildId, createSession(game));
        }

        const firstRanking = store.getRecentPlayers(guildId, puzzle.printDate, 8);

        expect(firstRanking.totalPlayers).toBe(9);
        expect(firstRanking.players.map((player) => player.userId)).toEqual(
            userIds.slice(1).reverse(),
        );

        const firstUserId = userIds[0];

        if (firstUserId === undefined) {
            throw new Error("최근 활동 순서를 갱신할 사용자가 없습니다.");
        }

        const updatedGame = submitGuess(
            store.get(firstUserId, puzzle.printDate, guildId)?.game ?? createWordleGame(puzzle),
            "slate",
        );
        store.recordValidGuess(firstUserId, puzzle.printDate, guildId, createSession(updatedGame));

        expect(store.getRecentPlayers(guildId, puzzle.printDate, 8).players[0]?.userId).toBe(
            firstUserId,
        );
    });

    it("단어 입력 없이 등록한 서버 참여자를 upsert하고 재시작 후에도 조회합니다", () => {
        const databasePath = createDatabasePath();
        const firstStore = openStore(databasePath);
        const game = createWordleGame(puzzle);

        firstStore.set(userId, puzzle.printDate, guildId, createSession(game));
        firstStore.registerGuildParticipant(userId, puzzle.printDate, guildId);
        firstStore.registerGuildParticipant(userId, puzzle.printDate, guildId);
        firstStore.close();

        const restartedStore = openStore(databasePath);

        expect(restartedStore.getRecentPlayers(guildId, puzzle.printDate, 8)).toMatchObject({
            totalPlayers: 1,
            players: [
                {
                    userId,
                    game,
                    activityOrder: 2,
                },
            ],
        });
    });

    it("서버 참여 활동 순번과 채널별 공개 현황 메시지를 재시작 후에도 복원합니다", () => {
        const databasePath = createDatabasePath();
        const firstStore = openStore(databasePath);
        const game = submitGuess(createWordleGame(puzzle), "crane");
        const channelId = "32345678901234567";
        const messageId = "42345678901234567";

        firstStore.recordValidGuess(userId, puzzle.printDate, guildId, createSession(game));
        firstStore.setPublicStatusPanel({
            guildId,
            channelId,
            messageId,
            printDate: puzzle.printDate,
        });
        firstStore.close();

        const restartedStore = openStore(databasePath);

        expect(restartedStore.getRecentPlayers(guildId, puzzle.printDate, 8)).toMatchObject({
            totalPlayers: 1,
            players: [
                {
                    userId,
                    game,
                    activityOrder: 1,
                },
            ],
        });
        expect(restartedStore.getPublicStatusPanel(guildId, channelId)).toEqual({
            guildId,
            channelId,
            messageId,
            printDate: puzzle.printDate,
        });
        expect(restartedStore.listPublicStatusPanels(guildId, puzzle.printDate)).toEqual([
            {
                guildId,
                channelId,
                messageId,
                printDate: puzzle.printDate,
            },
        ]);
    });

    it("기존 입력 활동을 서버 참여자로 자동 이관합니다", () => {
        const databasePath = createDatabasePath();
        const firstStore = openStore(databasePath);
        const game = submitGuess(createWordleGame(puzzle), "crane");

        firstStore.recordValidGuess(userId, puzzle.printDate, guildId, createSession(game));
        firstStore.close();

        const legacyDatabase = new DatabaseSync(databasePath);
        legacyDatabase
            .prepare(
                `
                    INSERT INTO wordle_input_activity (guild_id, print_date, user_id)
                    VALUES (?, ?, ?)
                `,
            )
            .run(guildId, puzzle.printDate, userId);
        legacyDatabase.exec("DROP TABLE wordle_guild_participants");
        legacyDatabase.close();

        const migratedStore = openStore(databasePath);

        expect(migratedStore.getRecentPlayers(guildId, puzzle.printDate, 8)).toMatchObject({
            totalPlayers: 1,
            players: [
                {
                    userId,
                    game,
                    activityOrder: 1,
                },
            ],
        });
    });
});
