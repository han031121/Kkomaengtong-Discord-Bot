export const WORDLE_WORD_LENGTH = 5;
export const WORDLE_MAX_GUESSES = 6;

export type TileState = "absent" | "present" | "correct";
export type GameStatus = "playing" | "won" | "lost";

export interface WordlePuzzle {
    id: number;
    solution: string;
    printDate: string;
    puzzleNumber: number;
}

export interface EvaluatedGuess {
    word: string;
    tiles: readonly TileState[];
}

export interface WordleGame {
    puzzle: WordlePuzzle;
    guesses: readonly EvaluatedGuess[];
    status: GameStatus;
}

export function normalizeGuess(value: string): string | undefined {
    const normalized = value.trim().toLowerCase();

    return /^[a-z]{5}$/.test(normalized) ? normalized : undefined;
}

export function evaluateGuess(solution: string, guess: string): readonly TileState[] {
    if (solution.length !== WORDLE_WORD_LENGTH || guess.length !== WORDLE_WORD_LENGTH) {
        throw new Error("Wordle 정답과 추측은 모두 5글자여야 합니다.");
    }

    const tiles: TileState[] = Array.from({ length: WORDLE_WORD_LENGTH }, () => "absent");
    const remainingLetters = new Map<string, number>();

    for (let index = 0; index < WORDLE_WORD_LENGTH; index += 1) {
        const solutionLetter = solution[index];
        const guessLetter = guess[index];

        if (solutionLetter === undefined || guessLetter === undefined) {
            throw new Error("Wordle 글자를 판정할 수 없습니다.");
        }

        if (solutionLetter === guessLetter) {
            tiles[index] = "correct";
        } else {
            remainingLetters.set(solutionLetter, (remainingLetters.get(solutionLetter) ?? 0) + 1);
        }
    }

    for (let index = 0; index < WORDLE_WORD_LENGTH; index += 1) {
        if (tiles[index] === "correct") {
            continue;
        }

        const guessLetter = guess[index];

        if (guessLetter === undefined) {
            throw new Error("Wordle 글자를 판정할 수 없습니다.");
        }

        const remainingCount = remainingLetters.get(guessLetter) ?? 0;

        if (remainingCount > 0) {
            tiles[index] = "present";
            remainingLetters.set(guessLetter, remainingCount - 1);
        }
    }

    return tiles;
}

export function createWordleGame(puzzle: WordlePuzzle): WordleGame {
    return {
        puzzle,
        guesses: [],
        status: "playing",
    };
}

export function submitGuess(game: WordleGame, guess: string): WordleGame {
    if (game.status !== "playing") {
        throw new Error("이미 종료된 Wordle 게임입니다.");
    }

    const tiles = evaluateGuess(game.puzzle.solution, guess);
    const guesses = [...game.guesses, { word: guess, tiles }];
    const status: GameStatus =
        guess === game.puzzle.solution
            ? "won"
            : guesses.length >= WORDLE_MAX_GUESSES
              ? "lost"
              : "playing";

    return {
        ...game,
        guesses,
        status,
    };
}
