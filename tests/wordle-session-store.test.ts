import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { createWordleGame, submitGuess } from "../src/features/wordle/game.js";
import { getPreviousWordlePrintDate, WordleDataStore } from "../src/features/wordle/data-store.js";
import { WORDLE_TEST_IDS, WORDLE_TEST_PUZZLE } from "./wordle-test-helpers.js";

const puzzle = {
    ...WORDLE_TEST_PUZZLE,
    id: 2_906,
    printDate: "2026-07-24",
    puzzleNumber: 1_861,
};
const { guild: guildId, user: userId } = WORDLE_TEST_IDS;

describe("Wordle SQLite 세션 저장소", () => {
    const temporaryDirectories: string[] = [];
    const stores: WordleDataStore[] = [];

    function createDatabasePath(): string {
        const temporaryDirectory = mkdtempSync(join(tmpdir(), "kkomaengtong-wordle-"));
        temporaryDirectories.push(temporaryDirectory);

        const databasePath = join(temporaryDirectory, "nested", "wordle.sqlite");
        mkdirSync(dirname(databasePath), { recursive: true });

        return databasePath;
    }

    function openStore(databasePath: string): WordleDataStore {
        const store = new WordleDataStore({ databasePath });
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

    it("월말과 윤년을 반영해 바로 전날 날짜를 계산합니다", () => {
        expect(getPreviousWordlePrintDate("2024-03-01")).toBe("2024-02-29");
        expect(getPreviousWordlePrintDate("2026-01-01")).toBe("2025-12-31");
        expect(() => getPreviousWordlePrintDate("2026-02-30")).toThrow(RangeError);
    });

    it("봇이 재시작되어도 사용자의 추측과 게임 상태를 복원합니다", () => {
        const databasePath = createDatabasePath();
        const firstStore = openStore(databasePath);
        const playingGame = submitGuess(createWordleGame(puzzle), "crane");

        firstStore.set(userId, puzzle.printDate, playingGame);
        firstStore.close();

        const restartedStore = openStore(databasePath);
        const restoredSession = restartedStore.get(userId, puzzle.printDate);

        expect(restoredSession).toEqual(playingGame);
    });

    it("복원한 게임에 추가한 추측도 SQLite에 다시 저장합니다", () => {
        const databasePath = createDatabasePath();
        const firstStore = openStore(databasePath);
        const playingGame = submitGuess(createWordleGame(puzzle), "crane");

        firstStore.set(userId, puzzle.printDate, playingGame);
        firstStore.close();

        const secondStore = openStore(databasePath);
        const restoredSession = secondStore.get(userId, puzzle.printDate);

        expect(restoredSession).toBeDefined();

        if (restoredSession === undefined) {
            throw new Error("복원할 Wordle 세션이 없습니다.");
        }

        const wonGame = submitGuess(restoredSession, "apple");
        secondStore.set(userId, puzzle.printDate, wonGame);
        secondStore.close();

        const thirdStore = openStore(databasePath);

        expect(thirdStore.get(userId, puzzle.printDate)).toEqual(wonGame);
    });

    it("같은 날짜에 진행한 서로 다른 사용자의 게임을 분리해서 저장합니다", () => {
        const databasePath = createDatabasePath();
        const firstStore = openStore(databasePath);
        const otherUserId = "42345678901234567";
        const firstGame = submitGuess(createWordleGame(puzzle), "crane");
        const otherGame = submitGuess(createWordleGame(puzzle), "slate");

        firstStore.set(userId, puzzle.printDate, firstGame);
        firstStore.set(otherUserId, puzzle.printDate, otherGame);
        firstStore.close();

        const restartedStore = openStore(databasePath);

        expect(restartedStore.get(userId, puzzle.printDate)).toEqual(firstGame);
        expect(restartedStore.get(otherUserId, puzzle.printDate)).toEqual(otherGame);
    });

    it("날짜별 퍼즐과 정답은 사용자 수와 관계없이 한 번만 저장합니다", () => {
        const databasePath = createDatabasePath();
        const store = openStore(databasePath);
        const otherUserId = "42345678901234567";

        store.set(userId, puzzle.printDate, createWordleGame(puzzle));
        store.set(otherUserId, puzzle.printDate, createWordleGame(puzzle));

        const database = new DatabaseSync(databasePath, { readOnly: true });
        const puzzleCount = database
            .prepare("SELECT COUNT(*) AS count FROM wordle_puzzles")
            .get() as { count: number };
        const gameColumns = database
            .prepare("PRAGMA table_info(wordle_games)")
            .all() as unknown as {
            name: string;
        }[];
        database.close();

        expect(puzzleCount.count).toBe(1);
        expect(gameColumns.map((column) => column.name)).not.toContain("solution");
        expect(store.getPuzzle(puzzle.printDate)).toEqual(puzzle);
    });

    it("같은 날짜에 서로 다른 퍼즐 정보를 저장하지 않습니다", () => {
        const store = new WordleDataStore();
        stores.push(store);
        const conflictingPuzzle = {
            ...puzzle,
            solution: "slate",
        };

        store.set(userId, puzzle.printDate, createWordleGame(puzzle));

        expect(() =>
            store.set(
                "42345678901234567",
                conflictingPuzzle.printDate,
                createWordleGame(conflictingPuzzle),
            ),
        ).toThrow(`이미 저장된 Wordle 퍼즐과 정보가 다릅니다: ${puzzle.printDate}`);
        expect(store.getPuzzle(puzzle.printDate)).toEqual(puzzle);
    });

    it("새 퍼즐이 활성화되면 당일과 바로 전날의 관련 기록만 유지합니다", () => {
        const store = new WordleDataStore();
        stores.push(store);
        const puzzles = [
            {
                ...puzzle,
                id: 2_904,
                printDate: "2026-07-22",
                puzzleNumber: 1_859,
            },
            {
                ...puzzle,
                id: 2_905,
                printDate: "2026-07-23",
                puzzleNumber: 1_860,
            },
            puzzle,
        ];
        const channelIds = ["32345678901234567", "42345678901234567", "52345678901234567"];

        puzzles.forEach((datedPuzzle, index) => {
            const game = createWordleGame(datedPuzzle);
            const channelId = channelIds[index];

            if (channelId === undefined) {
                throw new Error("Wordle 테스트 채널 ID가 없습니다.");
            }

            store.set(userId, datedPuzzle.printDate, game);
            store.registerGuildParticipant(userId, datedPuzzle.printDate, guildId, channelId);
            store.setPublicStatusPanel({
                guildId,
                channelId,
                messageId: `6${channelId.slice(1)}`,
                printDate: datedPuzzle.printDate,
            });
        });

        store.activatePuzzle(puzzle);

        expect(store.getPuzzle("2026-07-22")).toBeUndefined();
        expect(store.get(userId, "2026-07-22")).toBeUndefined();
        expect(store.getRecentPlayers(guildId, "2026-07-22", 8).totalPlayers).toBe(0);
        expect(store.listPublicStatusPanels(guildId, "2026-07-22")).toEqual([]);
        expect(store.getPuzzle("2026-07-23")).toEqual(puzzles[1]);
        expect(store.getPuzzle("2026-07-24")).toEqual(puzzle);
    });

    it("늦게 완료된 전날 퍼즐 갱신은 최신 기록을 유지하면서 전날 정답을 보완합니다", () => {
        const store = new WordleDataStore();
        stores.push(store);
        const previousPuzzle = {
            ...puzzle,
            id: 2_905,
            printDate: "2026-07-23",
            puzzleNumber: 1_860,
        };

        store.activatePuzzle(puzzle);
        store.activatePuzzle(previousPuzzle);

        expect(store.getPuzzle(puzzle.printDate)).toEqual(puzzle);
        expect(store.getPuzzle(previousPuzzle.printDate)).toEqual(previousPuzzle);
    });

    it("전날 참여 서버의 최근 채널을 알림 대상으로 저장하고 전송 완료 후 제외합니다", () => {
        const store = new WordleDataStore();
        stores.push(store);
        const previousPuzzle = {
            ...puzzle,
            id: 2_905,
            printDate: "2026-07-23",
            puzzleNumber: 1_860,
        };
        const firstChannelId = "32345678901234567";
        const latestChannelId = "42345678901234567";

        store.set(userId, previousPuzzle.printDate, createWordleGame(previousPuzzle));
        store.registerGuildParticipant(userId, previousPuzzle.printDate, guildId, firstChannelId);
        store.registerGuildParticipant(userId, previousPuzzle.printDate, guildId, latestChannelId);
        store.activatePuzzle(puzzle);

        expect(store.listPendingYesterdayAnnouncements(puzzle.printDate)).toEqual([
            {
                guildId,
                channelId: latestChannelId,
                recordDate: previousPuzzle.printDate,
            },
        ]);

        const target = store.listPendingYesterdayAnnouncements(puzzle.printDate)[0];

        if (target === undefined) {
            throw new Error("전송 완료 처리할 어제 Wordle 알림 대상이 없습니다.");
        }

        store.markYesterdayAnnouncementSent(target, "52345678901234567");

        expect(store.listPendingYesterdayAnnouncements(puzzle.printDate)).toEqual([]);
        expect(store.rearmYesterdayAnnouncements(puzzle.printDate)).toBe(1);
        expect(store.listPendingYesterdayAnnouncements(puzzle.printDate)).toEqual([target]);
    });

    it("최근 활동 순번으로 사용자 8명을 정확하게 정렬합니다", () => {
        const store = new WordleDataStore();
        stores.push(store);
        const userIds = Array.from({ length: 9 }, (_, index) => `1234567890123456${index}`);

        for (const recentUserId of userIds) {
            const game = submitGuess(createWordleGame(puzzle), "crane");
            store.recordValidGuess(
                recentUserId,
                puzzle.printDate,
                guildId,
                WORDLE_TEST_IDS.channel,
                game,
            );
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
            store.get(firstUserId, puzzle.printDate) ?? createWordleGame(puzzle),
            "slate",
        );
        store.recordValidGuess(
            firstUserId,
            puzzle.printDate,
            guildId,
            WORDLE_TEST_IDS.channel,
            updatedGame,
        );

        expect(store.getRecentPlayers(guildId, puzzle.printDate, 8).players[0]?.userId).toBe(
            firstUserId,
        );
    });

    it("단어 입력 없이 등록한 서버 참여자를 upsert하고 재시작 후에도 조회합니다", () => {
        const databasePath = createDatabasePath();
        const firstStore = openStore(databasePath);
        const game = createWordleGame(puzzle);

        firstStore.set(userId, puzzle.printDate, game);
        firstStore.registerGuildParticipant(
            userId,
            puzzle.printDate,
            guildId,
            WORDLE_TEST_IDS.channel,
        );
        firstStore.registerGuildParticipant(
            userId,
            puzzle.printDate,
            guildId,
            WORDLE_TEST_IDS.channel,
        );
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

        firstStore.recordValidGuess(userId, puzzle.printDate, guildId, channelId, game);
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

    it("기존 스키마의 게임과 입력 활동을 정규화된 테이블로 자동 이관합니다", () => {
        const databasePath = createDatabasePath();
        const game = submitGuess(createWordleGame(puzzle), "crane");
        const legacyDatabase = new DatabaseSync(databasePath);
        legacyDatabase.exec(`
            CREATE TABLE wordle_games (
                user_id TEXT NOT NULL,
                print_date TEXT NOT NULL,
                puzzle_id INTEGER NOT NULL,
                solution TEXT NOT NULL,
                puzzle_number INTEGER NOT NULL,
                guesses_json TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('playing', 'won', 'lost')),
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, print_date)
            );

            CREATE TABLE wordle_input_activity (
                order_id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                print_date TEXT NOT NULL,
                user_id TEXT NOT NULL
            );

            CREATE TABLE wordle_guild_participants (
                guild_id TEXT NOT NULL,
                print_date TEXT NOT NULL,
                user_id TEXT NOT NULL,
                last_activity_order INTEGER NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (guild_id, print_date, user_id)
            );

            CREATE INDEX wordle_guild_participants_recent
            ON wordle_guild_participants (
                guild_id,
                print_date,
                last_activity_order DESC
            );

            CREATE TABLE wordle_public_status_panels (
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                print_date TEXT NOT NULL,
                PRIMARY KEY (guild_id, channel_id)
            );
        `);
        legacyDatabase
            .prepare(
                `
                    INSERT INTO wordle_games (
                        user_id,
                        print_date,
                        puzzle_id,
                        solution,
                        puzzle_number,
                        guesses_json,
                        status,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `,
            )
            .run(
                userId,
                puzzle.printDate,
                puzzle.id,
                puzzle.solution,
                puzzle.puzzleNumber,
                JSON.stringify(game.guesses),
                game.status,
                "2026-07-24T00:00:00.000Z",
            );
        legacyDatabase
            .prepare(
                `
                    INSERT INTO wordle_input_activity (guild_id, print_date, user_id)
                    VALUES (?, ?, ?)
                `,
            )
            .run(guildId, puzzle.printDate, userId);
        legacyDatabase
            .prepare(
                `
                    INSERT INTO wordle_guild_participants (
                        guild_id,
                        print_date,
                        user_id,
                        last_activity_order,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?)
                `,
            )
            .run(guildId, puzzle.printDate, userId, 1, "2026-07-24T00:00:00.000Z");
        legacyDatabase
            .prepare(
                `
                    INSERT INTO wordle_public_status_panels (
                        guild_id,
                        channel_id,
                        message_id,
                        print_date
                    )
                    VALUES (?, ?, ?, ?)
                `,
            )
            .run(guildId, "32345678901234567", "42345678901234567", puzzle.printDate);
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
        expect(migratedStore.getPuzzle(puzzle.printDate)).toEqual(puzzle);
        expect(migratedStore.getPublicStatusPanel(guildId, "32345678901234567")).toEqual({
            guildId,
            channelId: "32345678901234567",
            messageId: "42345678901234567",
            printDate: puzzle.printDate,
        });
        const nextPuzzle = {
            ...puzzle,
            id: puzzle.id + 1,
            printDate: "2026-07-25",
            puzzleNumber: puzzle.puzzleNumber + 1,
            solution: "slate",
        };

        migratedStore.activatePuzzle(nextPuzzle);

        expect(migratedStore.listPendingYesterdayAnnouncements(nextPuzzle.printDate)).toEqual([
            {
                guildId,
                channelId: "32345678901234567",
                recordDate: puzzle.printDate,
            },
        ]);

        const migratedDatabase = new DatabaseSync(databasePath, { readOnly: true });
        const legacyActivityTable = migratedDatabase
            .prepare(
                `
                    SELECT name
                    FROM sqlite_master
                    WHERE type = 'table' AND name = 'wordle_input_activity'
                `,
            )
            .get();
        const foreignKeyViolations = migratedDatabase.prepare("PRAGMA foreign_key_check").all();
        const userVersion = migratedDatabase.prepare("PRAGMA user_version").get() as {
            user_version: number;
        };
        migratedDatabase.close();

        expect(legacyActivityTable).toBeUndefined();
        expect(foreignKeyViolations).toEqual([]);
        expect(userVersion.user_version).toBe(2);
    });
});
