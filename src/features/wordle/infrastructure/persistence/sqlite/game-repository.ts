import type { DatabaseSync } from "node:sqlite";

import type { WordleGame, WordlePuzzle } from "../../../domain/game.js";
import { getPreviousWordlePrintDate } from "../../../domain/print-date.js";
import { parseGame, parsePuzzle, validatePuzzle } from "./row-mappers.js";
import type { PersistedWordleGame, PersistedWordlePuzzle } from "./row-mappers.js";

interface PersistedPrintDate {
    print_date: string | null;
}

export class WordleGameRepository {
    public constructor(private readonly database: DatabaseSync) {}

    public getLatestPrintDate(): string | undefined {
        const row = this.database
            .prepare("SELECT MAX(print_date) AS print_date FROM wordle_puzzles")
            .get() as unknown as PersistedPrintDate;

        return row.print_date ?? undefined;
    }

    public deletePuzzlesExcept(printDates: readonly string[]): void {
        const [firstPrintDate, secondPrintDate] = printDates;

        if (
            printDates.length !== 2 ||
            firstPrintDate === undefined ||
            secondPrintDate === undefined
        ) {
            throw new RangeError("보존할 Wordle 퍼즐 날짜는 정확히 2개여야 합니다.");
        }

        this.database
            .prepare(
                `
                    DELETE FROM wordle_puzzles
                    WHERE print_date NOT IN (?, ?)
                `,
            )
            .run(firstPrintDate, secondPrintDate);
    }

    public getPuzzle(printDate: string): WordlePuzzle | undefined {
        const row = this.database
            .prepare(
                `
                    SELECT print_date, puzzle_id, solution, puzzle_number
                    FROM wordle_puzzles
                    WHERE print_date = ?
                `,
            )
            .get(printDate) as PersistedWordlePuzzle | undefined;

        return row === undefined ? undefined : parsePuzzle(row);
    }

    public getGame(userId: string, printDate: string): WordleGame | undefined {
        const row = this.database
            .prepare(
                `
                    SELECT
                        puzzle.puzzle_id,
                        puzzle.solution,
                        puzzle.puzzle_number,
                        game.guesses_json,
                        game.status
                    FROM wordle_games AS game
                    INNER JOIN wordle_puzzles AS puzzle
                        ON puzzle.print_date = game.print_date
                    WHERE game.user_id = ? AND game.print_date = ?
                `,
            )
            .get(userId, printDate) as PersistedWordleGame | undefined;

        return row === undefined ? undefined : parseGame(row, printDate);
    }

    public saveGame(userId: string, printDate: string, game: WordleGame): void {
        if (printDate !== game.puzzle.printDate) {
            throw new RangeError("저장 키와 Wordle 퍼즐 날짜가 일치하지 않습니다.");
        }

        validatePuzzle(game.puzzle);
        this.savePuzzle(game.puzzle);
        this.database
            .prepare(
                `
                    INSERT INTO wordle_games (
                        user_id,
                        print_date,
                        guesses_json,
                        status,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                    ON CONFLICT (user_id, print_date) DO UPDATE SET
                        guesses_json = excluded.guesses_json,
                        status = excluded.status,
                        updated_at = excluded.updated_at
                `,
            )
            .run(userId, printDate, JSON.stringify(game.guesses), game.status);
    }

    public savePuzzle(puzzle: WordlePuzzle): void {
        validatePuzzle(puzzle);
        const result = this.database
            .prepare(
                `
                    INSERT INTO wordle_puzzles (
                        print_date,
                        puzzle_id,
                        solution,
                        puzzle_number,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                    ON CONFLICT (print_date) DO UPDATE SET
                        updated_at = excluded.updated_at
                    WHERE wordle_puzzles.puzzle_id = excluded.puzzle_id
                        AND wordle_puzzles.solution = excluded.solution
                        AND wordle_puzzles.puzzle_number = excluded.puzzle_number
                `,
            )
            .run(puzzle.printDate, puzzle.id, puzzle.solution, puzzle.puzzleNumber);

        if (result.changes === 0) {
            throw new Error(`이미 저장된 Wordle 퍼즐과 정보가 다릅니다: ${puzzle.printDate}`);
        }
    }

    public hasPuzzle(printDate: string): boolean {
        getPreviousWordlePrintDate(printDate);
        return (
            this.database
                .prepare("SELECT 1 FROM wordle_puzzles WHERE print_date = ?")
                .get(printDate) !== undefined
        );
    }
}
