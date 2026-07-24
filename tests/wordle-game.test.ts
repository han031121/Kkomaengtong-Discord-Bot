import { describe, expect, it } from "vitest";

import {
    createWordleGame,
    evaluateGuess,
    normalizeGuess,
    submitGuess,
} from "../src/features/wordle/game.js";
import type { WordlePuzzle } from "../src/features/wordle/game.js";
import {
    createPrivateWordleContainer,
    createPublicWordleContainer,
} from "../src/features/wordle/panel.js";

const puzzle: WordlePuzzle = {
    id: 1234,
    solution: "apple",
    printDate: "2026-07-23",
    puzzleNumber: 1890,
};

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
        let game = createWordleGame(puzzle);

        for (let attempt = 0; attempt < 6; attempt += 1) {
            game = submitGuess(game, "crane");
        }

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
