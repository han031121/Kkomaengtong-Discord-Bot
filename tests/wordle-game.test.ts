import type { Guild } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import {
    createWordleGame,
    evaluateGuess,
    normalizeGuess,
    submitGuess,
} from "../src/features/wordle/domain/game.js";
import {
    createAllWordleRecordsContainer,
    createPersonalWordleRecordContainer,
    createPrivateWordleContainer,
    createPublicWordleContainer,
    createWordlePublicStatusContainer,
    getFoundAlphabetCounts,
} from "../src/features/wordle/presentation/panel.js";
import {
    createWordleServerRecordRankings,
    filterCurrentGuildMemberRecords,
} from "../src/features/wordle/presentation/records.js";
import type { WordleGuildPersonalRecord } from "../src/features/wordle/presentation/session-store.js";
import { createLostGame, WORDLE_TEST_PUZZLE } from "./wordle-test-helpers.js";

const puzzle = {
    ...WORDLE_TEST_PUZZLE,
    puzzleNumber: 1890,
};

function createGuildRecord(
    userId: string,
    recentSuccessStreak: number,
    winRate: number | undefined,
    averageGuessCount: number | undefined,
): WordleGuildPersonalRecord {
    return {
        record: {
            averageGuessCount,
            fakeSpoilerCount: 0,
            genuineSpoilerCount: 0,
            playedCount: winRate === undefined ? 0 : 1,
            recentSuccessStreak,
            successCount: averageGuessCount === undefined ? 0 : 1,
            unregisteredWordCount: 0,
            winRate,
        },
        userId,
    };
}

describe("Wordle 도메인과 화면", () => {
    it("입력을 정규화하고 중복 글자와 게임 종료 규칙을 적용합니다", () => {
        expect(normalizeGuess(" CRANE ")).toBe("crane");
        expect(normalizeGuess("four")).toBeUndefined();
        expect(normalizeGuess("가나다라마")).toBeUndefined();
        expect(evaluateGuess("apple", "alley")).toEqual([
            "correct",
            "present",
            "absent",
            "present",
            "absent",
        ]);

        expect(submitGuess(createWordleGame(puzzle), "apple").status).toBe("won");
        const lostGame = createLostGame(puzzle);
        expect(lostGame.status).toBe("lost");
        expect(() => submitGuess(lostGame, "apple")).toThrow("이미 종료된 Wordle 게임입니다.");
    });

    it("공개 화면은 단어를 숨기고 비공개 화면만 입력 내용을 표시합니다", () => {
        const game = submitGuess(createWordleGame(puzzle), "alley");
        const publicPanel = JSON.stringify(
            createPublicWordleContainer(game, "12345678901234567").toJSON(),
        );
        const privatePanel = JSON.stringify(createPrivateWordleContainer(game).toJSON());

        expect(publicPanel).toContain("🟩🟨⬛🟨⬛");
        expect(publicPanel).not.toContain("alley");
        expect(publicPanel).not.toContain("apple");
        expect(privatePanel).toContain("`ALLEY` : 🟩🟨⬛🟨⬛");
        expect(privatePanel).toContain("`A`🟩");
        expect(privatePanel).not.toContain("apple");
    });

    it("개인 기록과 서버 순위를 사용자용 형식으로 표시합니다", () => {
        const personalPanel = JSON.stringify(
            createPersonalWordleRecordContainer("12345678901234567", {
                averageGuessCount: 2.25,
                fakeSpoilerCount: 4,
                genuineSpoilerCount: 3,
                playedCount: 8,
                recentSuccessStreak: 2,
                successCount: 6,
                unregisteredWordCount: 5,
                winRate: 75,
            }).toJSON(),
        );
        const serverPanel = JSON.stringify(
            createAllWordleRecordsContainer({
                averageGuessCount: [{ userId: "12345678901234567", value: 2.25 }],
                recentSuccessStreak: [{ userId: "12345678901234567", value: 2 }],
                recordHolderCount: 1,
                winRate: [{ userId: "12345678901234567", value: 75 }],
            }).toJSON(),
        );

        expect(personalPanel).toContain("정답률: **75.0%**");
        expect(personalPanel).toContain("평균 시도 횟수: **2.3회**");
        expect(personalPanel).toContain("찐스포: **3회**");
        expect(serverPanel).toContain("### 현재 서버 Wordle 기록 순위");
        expect(serverPanel).toContain("**75.0%**");
        expect(serverPanel).toContain("**2.3회**");
    });

    it("서버 기록을 항목별 방향으로 정렬하고 최대 다섯 명만 반환합니다", () => {
        const rankings = createWordleServerRecordRankings([
            createGuildRecord("5", 2, 80, 2.5),
            createGuildRecord("2", 4, 100, 3),
            createGuildRecord("4", 4, 90, 2),
            createGuildRecord("1", 1, undefined, undefined),
            createGuildRecord("3", 3, 70, 4),
            createGuildRecord("6", 5, 60, 5),
            createGuildRecord("7", 0, 50, 6),
        ]);

        expect(rankings.averageGuessCount.map((entry) => entry.userId)).toEqual([
            "4",
            "5",
            "2",
            "3",
            "6",
        ]);
        expect(rankings.recentSuccessStreak.map((entry) => entry.userId)).toEqual([
            "6",
            "2",
            "4",
            "3",
            "5",
        ]);
        expect(rankings.winRate.map((entry) => entry.userId)).toEqual(["2", "4", "5", "3", "6"]);
        expect(rankings.recordHolderCount).toBe(7);
    });

    it("현재 서버의 일반 사용자만 기록 대상에 포함합니다", async () => {
        const records = [
            createGuildRecord("1", 1, 100, 1),
            createGuildRecord("2", 1, 100, 1),
            createGuildRecord("3", 1, 100, 1),
        ];
        const fetch = vi.fn((userId: string) => {
            if (userId === "2") {
                return Promise.reject(Object.assign(new Error("Unknown Member"), { code: 10_007 }));
            }

            return Promise.resolve({ user: { bot: userId === "3" } });
        });
        const guild = { members: { fetch } } as unknown as Guild;

        await expect(filterCurrentGuildMemberRecords(guild, records)).resolves.toEqual([
            records[0],
        ]);

        const apiError = new Error("Discord API unavailable");
        const failingGuild = {
            members: { fetch: vi.fn().mockRejectedValue(apiError) },
        } as unknown as Guild;
        await expect(filterCurrentGuildMemberRecords(failingGuild, [records[0]!])).rejects.toBe(
            apiError,
        );
    });

    it("공개 현황에는 상태와 발견 글자 수만 표시하고 최대 인원을 제한합니다", () => {
        const playingGame = submitGuess(createWordleGame(puzzle), "alley");
        const wonGame = submitGuess(createWordleGame(puzzle), "apple");
        const statusPanel = JSON.stringify(
            createWordlePublicStatusContainer(
                [
                    { userId: "12345678901234561", game: wonGame },
                    { userId: "12345678901234562", game: playingGame },
                ],
                2,
                puzzle.printDate,
            ).toJSON(),
        );

        expect(statusPanel).toContain("<@12345678901234561> **성공** · **1/6**");
        expect(statusPanel).toContain("<@12345678901234562> **진행 중** · **1/6**");
        expect(statusPanel).not.toContain("alley");
        expect(statusPanel).not.toContain("apple");
        expect(getFoundAlphabetCounts(playingGame)).toEqual({ present: 2, correct: 1 });

        const tooManyEntries = Array.from({ length: 9 }, (_, index) => ({
            userId: `1234567890123456${index}`,
            game: playingGame,
        }));
        expect(() =>
            createWordlePublicStatusContainer(
                tooManyEntries,
                tooManyEntries.length,
                puzzle.printDate,
            ),
        ).toThrow("최대 8명");
    });
});
