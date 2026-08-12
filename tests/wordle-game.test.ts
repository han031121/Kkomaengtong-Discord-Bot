import type { Guild } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import {
    createWordleGame,
    evaluateGuess,
    normalizeGuess,
    submitGuess,
} from "../src/features/wordle/game.js";
import type { WordlePuzzle } from "../src/features/wordle/game.js";
import type { WordleGuildPersonalRecord } from "../src/commands/wordle/session-store.js";
import {
    createWordleServerRecordRankings,
    filterCurrentGuildMemberRecords,
} from "../src/commands/wordle/record-rankings.js";
import {
    createAllWordleRecordsContainer,
    createPersonalWordleRecordContainer,
    createPrivateWordleContainer,
    createPublicWordleContainer,
    createWordlePlayActionRow,
    createWordlePublicStatusContainer,
    getFoundAlphabetCounts,
} from "../src/commands/wordle/panel.js";
import { createLostGame, WORDLE_TEST_PUZZLE } from "./wordle-test-helpers.js";

const puzzle = {
    ...WORDLE_TEST_PUZZLE,
    puzzleNumber: 1890,
};

function createGuildPersonalRecord(
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

function expectPlayButton(component: unknown): void {
    expect(component).toMatchObject({
        components: [
            {
                custom_id: "wordle:play",
                label: "지금 플레이",
                style: 1,
                type: 2,
            },
        ],
        type: 1,
    });
}

describe("Wordle 게임 규칙", () => {
    it("영문 알파벳 5글자만 정규화합니다", () => {
        expect(normalizeGuess(" CRANE ")).toBe("crane");
        expect(normalizeGuess("four")).toBeUndefined();
        expect(normalizeGuess("가나다라마")).toBeUndefined();
        expect(normalizeGuess("a-bcd")).toBeUndefined();
    });

    it("중복 글자는 정답에 남아 있는 개수만 노란색으로 판정합니다", () => {
        expect(evaluateGuess("apple", "alley")).toEqual([
            "correct",
            "present",
            "absent",
            "present",
            "absent",
        ]);
    });

    it("정답을 맞히면 즉시 성공 상태가 됩니다", () => {
        const game = submitGuess(createWordleGame(puzzle), "apple");

        expect(game.status).toBe("won");
        expect(game.guesses).toHaveLength(1);
    });

    it("여섯 번 안에 맞히지 못하면 종료 상태가 됩니다", () => {
        const game = createLostGame(puzzle);

        expect(game.status).toBe("lost");
        expect(() => submitGuess(game, "apple")).toThrow("이미 종료된 Wordle 게임입니다.");
    });
});

describe("Wordle 공개 패널", () => {
    it("타일 진행 상황만 표시하고 추측 및 정답 단어를 노출하지 않습니다", () => {
        const game = submitGuess(createWordleGame(puzzle), "alley");
        const container = createPublicWordleContainer(
            game,
            "12345678901234567",
            "https://cdn.example.com/avatar.png",
        ).toJSON();
        const panelJson = JSON.stringify(container);

        expect(container.components.map((component) => component.type)).toEqual([10, 14, 9]);
        expect(container.components[2]).toMatchObject({
            accessory: {
                type: 11,
                media: {
                    url: "https://cdn.example.com/avatar.png",
                },
            },
        });
        expect(panelJson).toContain("### <@12345678901234567>님의 Wordle #1890");
        expect(panelJson).toContain("🟩🟨⬛🟨⬛");
        expect(panelJson).not.toContain("alley");
        expect(panelJson).not.toContain("apple");
    });

    it("지금 플레이 버튼을 독립된 Action Row로 생성합니다", () => {
        expectPlayButton(createWordlePlayActionRow().toJSON());
    });

    it("성공한 횟수에 맞는 볼드체 성공 문구를 표시합니다", () => {
        const firstAttemptGame = submitGuess(createWordleGame(puzzle), "apple");
        const secondAttemptGame = submitGuess(
            submitGuess(createWordleGame(puzzle), "crane"),
            "apple",
        );

        const firstAttemptPanel = JSON.stringify(
            createPublicWordleContainer(firstAttemptGame, "12345678901234567").toJSON(),
        );
        const secondAttemptPanel = JSON.stringify(
            createPublicWordleContainer(secondAttemptGame, "12345678901234567").toJSON(),
        );

        expect(firstAttemptPanel).toContain("성공 · 1/6 · **_Genius_**");
        expect(secondAttemptPanel).toContain("성공 · 2/6 · **_Magnificent_**");
    });
});

describe("Wordle 개인 기록 패널", () => {
    it("기록이 없으면 계산 대상 통계를 기록 없음으로 표시합니다", () => {
        const containerJson = JSON.stringify(
            createPersonalWordleRecordContainer("12345678901234567", {
                averageGuessCount: undefined,
                fakeSpoilerCount: 0,
                genuineSpoilerCount: 0,
                playedCount: 0,
                recentSuccessStreak: 0,
                successCount: 0,
                unregisteredWordCount: 0,
                winRate: undefined,
            }).toJSON(),
        );

        expect(containerJson).toContain("### <@12345678901234567>님의 Wordle 개인 기록");
        expect(containerJson).toContain("성공 횟수: **0회**");
        expect(containerJson).toContain("최근 연속 성공: **0일**");
        expect(containerJson).toContain("정답률: **기록 없음**");
        expect(containerJson).toContain("평균 시도 횟수: **기록 없음**");
    });

    it("계산된 기록을 소수점 한 자리와 세부 횟수로 표시합니다", () => {
        const containerJson = JSON.stringify(
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

        expect(containerJson).toContain("성공 횟수: **6회**");
        expect(containerJson).toContain("최근 연속 성공: **2일**");
        expect(containerJson).toContain("정답률: **75.0%**");
        expect(containerJson).toContain("평균 시도 횟수: **2.3회**");
        expect(containerJson).toContain("  - 찐스포: **3회**");
        expect(containerJson).toContain("  - 짭스포: **4회**");
        expect(containerJson).not.toContain("\\t- 찐스포");
        expect(containerJson).not.toContain("\\t- 짭스포");
        expect(containerJson).toContain("사전 미등록 단어 입력 횟수: **5회**");
    });
});

describe("Wordle 전체 기록 순위 패널", () => {
    it("세 가지 순위와 기록 보유자 수를 항목별 단위에 맞춰 표시합니다", () => {
        const containerJson = JSON.stringify(
            createAllWordleRecordsContainer({
                averageGuessCount: [
                    { userId: "12345678901234567", value: 2.25 },
                    { userId: "13345678901234567", value: 3 },
                ],
                recentSuccessStreak: [
                    { userId: "13345678901234567", value: 4 },
                    { userId: "12345678901234567", value: 2 },
                ],
                recordHolderCount: 2,
                winRate: [
                    { userId: "12345678901234567", value: 75 },
                    { userId: "13345678901234567", value: 50 },
                ],
            }).toJSON(),
        );

        expect(containerJson).toContain("### 현재 서버 Wordle 기록 순위");
        expect(containerJson).toContain("기록 보유자 2명 · 항목별 최대 5위");
        expect(containerJson).toContain("1. <@13345678901234567> · **4일**");
        expect(containerJson).toContain("1. <@12345678901234567> · **75.0%**");
        expect(containerJson).toContain("1. <@12345678901234567> · **2.3회**");
    });

    it("계산 가능한 기록이 없는 항목은 기록 없음으로 표시합니다", () => {
        const containerJson = JSON.stringify(
            createAllWordleRecordsContainer({
                averageGuessCount: [],
                recentSuccessStreak: [],
                recordHolderCount: 0,
                winRate: [],
            }).toJSON(),
        );

        expect(containerJson.match(/기록 없음/g)).toHaveLength(3);
    });
});

describe("Wordle 서버 기록 순위", () => {
    it("항목별 방향으로 정렬해 최대 다섯 명만 반환하고 계산되지 않은 값은 제외합니다", () => {
        const records = [
            createGuildPersonalRecord("5", 2, 80, 2.5),
            createGuildPersonalRecord("2", 4, 100, 3),
            createGuildPersonalRecord("4", 4, 90, 2),
            createGuildPersonalRecord("1", 1, undefined, undefined),
            createGuildPersonalRecord("3", 3, 70, 4),
            createGuildPersonalRecord("6", 5, 60, 5),
            createGuildPersonalRecord("7", 0, 50, 6),
        ];

        expect(createWordleServerRecordRankings(records)).toEqual({
            averageGuessCount: [
                { userId: "4", value: 2 },
                { userId: "5", value: 2.5 },
                { userId: "2", value: 3 },
                { userId: "3", value: 4 },
                { userId: "6", value: 5 },
            ],
            recentSuccessStreak: [
                { userId: "6", value: 5 },
                { userId: "2", value: 4 },
                { userId: "4", value: 4 },
                { userId: "3", value: 3 },
                { userId: "5", value: 2 },
            ],
            recordHolderCount: 7,
            winRate: [
                { userId: "2", value: 100 },
                { userId: "4", value: 90 },
                { userId: "5", value: 80 },
                { userId: "3", value: 70 },
                { userId: "6", value: 60 },
            ],
        });
    });

    it("현재 서버의 일반 사용자 기록만 남깁니다", async () => {
        const records = [
            createGuildPersonalRecord("1", 1, 100, 1),
            createGuildPersonalRecord("2", 1, 100, 1),
            createGuildPersonalRecord("3", 1, 100, 1),
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
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("테스트 모드에서는 알 수 없는 사용자 기록을 유지합니다", async () => {
        const currentRecord = createGuildPersonalRecord("1", 1, 100, 1);
        const unknownRecord = createGuildPersonalRecord("2", 2, 100, 1);
        const guild = {
            members: {
                fetch: vi.fn((userId: string) =>
                    userId === unknownRecord.userId
                        ? Promise.reject(
                              Object.assign(new Error("Unknown Member"), { code: 10_007 }),
                          )
                        : Promise.resolve({ user: { bot: false } }),
                ),
            },
        } as unknown as Guild;

        await expect(
            filterCurrentGuildMemberRecords(guild, [currentRecord, unknownRecord], true),
        ).resolves.toEqual([currentRecord, unknownRecord]);
    });

    it("구성원 부재 이외의 Discord 조회 오류는 숨기지 않습니다", async () => {
        const error = new Error("Discord API unavailable");
        const guild = {
            members: { fetch: vi.fn().mockRejectedValue(error) },
        } as unknown as Guild;

        await expect(
            filterCurrentGuildMemberRecords(guild, [createGuildPersonalRecord("1", 1, 100, 1)]),
        ).rejects.toBe(error);
    });
});

describe("Wordle 공개 현황 패널", () => {
    it("사용자 상태를 두 줄과 accessory 보기 버튼으로 표시합니다", () => {
        const game = submitGuess(createWordleGame(puzzle), "alley");
        const container = createWordlePublicStatusContainer(
            [
                {
                    userId: "12345678901234567",
                    game,
                },
            ],
            3,
            puzzle.printDate,
        ).toJSON();
        const panelJson = JSON.stringify(container);

        expect(container.components.map((component) => component.type)).toEqual([10, 14, 9, 10]);
        expect(container.components[2]).toMatchObject({
            components: [
                {
                    type: 10,
                    content: "<@12345678901234567> **진행 중** · **1/6**\n찾음: 🟨 2개 · 🟩 1개",
                },
            ],
            accessory: {
                type: 2,
                custom_id: "wordle:status-view:2026-07-23:12345678901234567",
                label: "보기",
                style: 2,
            },
        });
        expect(panelJson).toContain("최근 활동 순 1명 표시 · 전체 3명");
        expect(panelJson).not.toContain("alley");
        expect(panelJson).not.toContain("apple");
        expect(getFoundAlphabetCounts(game)).toEqual({
            present: 2,
            correct: 1,
        });
    });

    it("알파벳이 노란색에서 초록색으로 바뀌면 초록색에만 집계합니다", () => {
        const game = submitGuess(submitGuess(createWordleGame(puzzle), "plead"), "amply");

        expect(getFoundAlphabetCounts(game)).toEqual({
            present: 1,
            correct: 3,
        });
    });

    it("자리를 모르는 중복 알파벳을 확인된 개수만큼 집계합니다", () => {
        const repeatedLetterPuzzle: WordlePuzzle = {
            ...puzzle,
            solution: "eagle",
        };
        const game = submitGuess(createWordleGame(repeatedLetterPuzzle), "speed");
        const panelJson = JSON.stringify(
            createWordlePublicStatusContainer(
                [{ userId: "12345678901234567", game }],
                1,
                repeatedLetterPuzzle.printDate,
            ).toJSON(),
        );

        expect(game.guesses[0]?.tiles).toEqual([
            "absent",
            "absent",
            "present",
            "present",
            "absent",
        ]);
        expect(getFoundAlphabetCounts(game)).toEqual({
            present: 2,
            correct: 0,
        });
        expect(panelJson).toContain("찾음: 🟨 2개 · 🟩 0개");
    });

    it("게임 상태를 성공, 실패, 진행 중 글자로 표시합니다", () => {
        const playingGame = submitGuess(createWordleGame(puzzle), "alley");
        const wonGame = submitGuess(createWordleGame(puzzle), "apple");
        const lostGame = createLostGame(puzzle);

        const panelJson = JSON.stringify(
            createWordlePublicStatusContainer(
                [
                    { userId: "12345678901234561", game: wonGame },
                    { userId: "12345678901234562", game: lostGame },
                    { userId: "12345678901234563", game: playingGame },
                ],
                3,
                puzzle.printDate,
            ).toJSON(),
        );

        expect(panelJson).toContain("<@12345678901234561> **성공** · **1/6**");
        expect(panelJson).toContain("<@12345678901234562> **실패** · **6/6**");
        expect(panelJson).toContain("<@12345678901234563> **진행 중** · **1/6**");
    });

    it("한 패널에는 최대 8명만 허용합니다", () => {
        const game = submitGuess(createWordleGame(puzzle), "crane");
        const entries = Array.from({ length: 9 }, (_, index) => ({
            userId: `1234567890123456${index}`,
            game,
        }));

        expect(() =>
            createWordlePublicStatusContainer(entries, entries.length, puzzle.printDate),
        ).toThrow("최대 8명");
    });
});

describe("Wordle 비공개 게임 화면", () => {
    it("추측 단어와 알파벳 상태를 모바일 호환 색상 타일로 표시합니다", () => {
        const game = submitGuess(createWordleGame(puzzle), "alley");
        const container = createPrivateWordleContainer(game).toJSON();
        const containerJson = JSON.stringify(container);

        expect(container.components.map((component) => component.type)).toEqual([10, 14]);
        expect(containerJson).toContain("### 나의 Wordle #1890");
        expect(containerJson).toContain("입력 기록");
        expect(containerJson).toContain("알파벳");
        expect(containerJson).toContain("`ALLEY` : 🟩🟨⬛🟨⬛");
        expect(containerJson).toContain("`A`🟩 `B`⬜ `C`⬜ `D`⬜ `E`🟨 `F`⬜ `G`⬜");
        expect(containerJson).toContain("`H`⬜ `I`⬜ `J`⬜ `K`⬜ `L`🟨 `M`⬜ `N`⬜");
        expect(containerJson).toContain("`V`⬜ `W`⬜ `X`⬜ `Y`⬛ `Z`⬜");
        expect(containerJson).not.toContain("입력을 반영했습니다.");
        expect(containerJson).not.toContain("\u001b[");
        expect(containerJson).not.toContain("apple");
    });

    it("여섯 번째에 성공하면 볼드체 Phew 문구를 표시합니다", () => {
        let game = createWordleGame(puzzle);

        for (let attempt = 0; attempt < 5; attempt += 1) {
            game = submitGuess(game, "crane");
        }

        game = submitGuess(game, "apple");

        const containerJson = JSON.stringify(
            createPrivateWordleContainer(game, "정답입니다.").toJSON(),
        );

        expect(containerJson).toContain("성공 · 6/6 · **_Phew_**");
    });
});
