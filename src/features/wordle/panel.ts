import {
    ContainerBuilder,
    SectionBuilder,
    SeparatorBuilder,
    TextDisplayBuilder,
    ThumbnailBuilder,
} from "@discordjs/builders";
import { Colors, SeparatorSpacingSize } from "discord.js";

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

function getPanelColor(status: GameStatus): number {
    switch (status) {
        case "won":
            return Colors.Green;
        case "lost":
            return Colors.DarkGrey;
        case "playing":
            return Colors.Yellow;
    }
}

function createSeparator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

export function createPublicWordleContainer(
    game: WordleGame,
    userId: string,
    avatarUrl?: string,
): ContainerBuilder {
    const rows = game.guesses.map((guess) => guess.tiles.map((tile) => TILE_EMOJI[tile]).join(""));

    while (rows.length < WORDLE_MAX_GUESSES) {
        rows.push(EMPTY_ROW);
    }

    const title = new TextDisplayBuilder().setContent(
        `### <@${userId}>님의 Wordle #${game.puzzle.puzzleNumber}`,
    );
    const gameContent = new TextDisplayBuilder().setContent(
        [rows.join("\n"), "", "### 상태", getStatusText(game), `-# ${game.puzzle.printDate}`].join(
            "\n",
        ),
    );
    const container = new ContainerBuilder()
        .setAccentColor(getPanelColor(game.status))
        .addTextDisplayComponents(title)
        .addSeparatorComponents(createSeparator());

    if (avatarUrl !== undefined) {
        container.addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(gameContent)
                .setThumbnailAccessory(
                    new ThumbnailBuilder()
                        .setURL(avatarUrl)
                        .setDescription(`<@${userId}>님의 프로필 이미지`),
                ),
        );
    } else {
        container.addTextDisplayComponents(gameContent);
    }

    return container;
}

export function createWordleSpoilerContainer(game: WordleGame, userId: string): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(Colors.Red)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`### <@${userId}>님의 스포일러`),
        )
        .addSeparatorComponents(createSeparator())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                [
                    `# ${[...game.puzzle.solution.toUpperCase()].join(" ")}`,
                    `-# Wordle #${game.puzzle.puzzleNumber} · ${game.puzzle.printDate}`,
                ].join("\n"),
            ),
        );
}

export function createWordleNoticeContainer(content: string): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(Colors.Yellow)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
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

export function createPrivateWordleContainer(game: WordleGame, notice?: string): ContainerBuilder {
    const container = new ContainerBuilder().setAccentColor(getPanelColor(game.status));

    if (notice !== undefined) {
        container
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(notice))
            .addSeparatorComponents(createSeparator());
    }

    return container
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                [
                    `### 나의 Wordle #${game.puzzle.puzzleNumber}`,
                    "",
                    "**입력 기록**",
                    createGuessHistory(game),
                    "",
                    "**알파벳**",
                    createAlphabetTiles(game),
                    "",
                    "### 상태",
                    getStatusText(game),
                ].join("\n"),
            ),
        )
        .addSeparatorComponents(createSeparator());
}
