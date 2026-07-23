import { Colors, EmbedBuilder } from "discord.js";

import { WORDLE_MAX_GUESSES } from "./game.js";
import type { GameStatus, TileState, WordleGame } from "./game.js";

const TILE_EMOJI: Readonly<Record<TileState, string>> = {
    absent: "⬛",
    present: "🟨",
    correct: "🟩",
};
const EMPTY_TILE_EMOJI = "⬜";
const EMPTY_ROW = "⬜⬜⬜⬜⬜";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ALPHABET_LETTERS_PER_LINE = 7;
const TILE_PRIORITY: Readonly<Record<TileState, number>> = {
    absent: 1,
    present: 2,
    correct: 3,
};
const SUCCESS_MESSAGES = [
    "Genius",
    "Magnificent",
    "Impressive",
    "Splendid",
    "Great",
    "Phew",
] as const;

function getStatusText(game: WordleGame): string {
    switch (game.status) {
        case "won": {
            const successMessage = SUCCESS_MESSAGES[game.guesses.length - 1] ?? "Phew";

            return `성공 · ${game.guesses.length}/${WORDLE_MAX_GUESSES} · **_${successMessage}_**`;
        }
        case "lost":
            return `종료 · X/${WORDLE_MAX_GUESSES}`;
        case "playing":
            return `진행 중 · ${game.guesses.length}/${WORDLE_MAX_GUESSES}`;
    }
}

function getEmbedColor(status: GameStatus): number {
    switch (status) {
        case "won":
            return Colors.Green;
        case "lost":
            return Colors.DarkGrey;
        case "playing":
            return Colors.Yellow;
    }
}

export function createWordlePanel(game: WordleGame, avatarUrl?: string): EmbedBuilder {
    const rows = game.guesses.map((guess) => guess.tiles.map((tile) => TILE_EMOJI[tile]).join(""));

    while (rows.length < WORDLE_MAX_GUESSES) {
        rows.push(EMPTY_ROW);
    }

    const panel = new EmbedBuilder()
        .setColor(getEmbedColor(game.status))
        .setTitle(`Wordle #${game.puzzle.puzzleNumber}`)
        .setDescription(rows.join("\n"))
        .addFields({ name: "상태", value: getStatusText(game), inline: true })
        .setFooter({
            text: `${game.puzzle.printDate} · 입력한 단어는 공개되지 않습니다.`,
        });

    if (avatarUrl !== undefined) {
        panel.setThumbnail(avatarUrl);
    }

    return panel;
}

function createGuessHistory(game: WordleGame): string {
    if (game.guesses.length === 0) {
        return "아직 입력한 단어가 없습니다.";
    }

    return game.guesses
        .map(
            (guess) =>
                `\`${guess.word.toUpperCase()}\` : ${guess.tiles
                    .map((tile) => TILE_EMOJI[tile])
                    .join("")}`,
        )
        .join("\n");
}

function getAlphabetStates(game: WordleGame): ReadonlyMap<string, TileState> {
    const states = new Map<string, TileState>();

    for (const guess of game.guesses) {
        for (let index = 0; index < guess.word.length; index += 1) {
            const letter = guess.word[index]?.toUpperCase();
            const tile = guess.tiles[index];

            if (letter === undefined || tile === undefined) {
                continue;
            }

            const previousState = states.get(letter);

            if (previousState === undefined || TILE_PRIORITY[tile] > TILE_PRIORITY[previousState]) {
                states.set(letter, tile);
            }
        }
    }

    return states;
}

function createAlphabetTiles(game: WordleGame): string {
    const states = getAlphabetStates(game);
    const lines: string[] = [];

    for (let index = 0; index < ALPHABET.length; index += ALPHABET_LETTERS_PER_LINE) {
        const letterTiles = [...ALPHABET.slice(index, index + ALPHABET_LETTERS_PER_LINE)].map(
            (letter) => {
                const state = states.get(letter);
                const tile = state === undefined ? EMPTY_TILE_EMOJI : TILE_EMOJI[state];

                return `\`${letter}\`${tile}`;
            },
        );

        lines.push(letterTiles.join(" "));
    }

    return lines.join("\n");
}

export function createPrivateWordlePanel(game: WordleGame): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(getEmbedColor(game.status))
        .setTitle(`나의 Wordle #${game.puzzle.puzzleNumber}`)
        .setDescription(
            [
                "**입력 기록**",
                createGuessHistory(game),
                "**알파벳**",
                createAlphabetTiles(game),
            ].join("\n"),
        )
        .addFields({ name: "상태", value: getStatusText(game), inline: true })
        .setFooter({ text: "이 화면은 게임을 진행한 사용자에게만 표시됩니다." });
}
