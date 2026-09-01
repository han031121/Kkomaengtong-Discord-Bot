import { SeparatorBuilder } from "@discordjs/builders";
import { Colors, SeparatorSpacingSize } from "discord.js";

import { WORDLE_MAX_GUESSES } from "../../domain/game.js";
import type { GameStatus, TileState, WordleGame } from "../../domain/game.js";

export const TILE_EMOJI: Readonly<Record<TileState, string>> = {
    absent: "⬛",
    present: "🟨",
    correct: "🟩",
};

const SUCCESS_MESSAGES = [
    "Genius",
    "Magnificent",
    "Impressive",
    "Splendid",
    "Great",
    "Phew",
] as const;

export function getStatusText(game: WordleGame): string {
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

export function getPanelColor(status: GameStatus): number {
    switch (status) {
        case "won":
            return Colors.Green;
        case "lost":
            return Colors.DarkGrey;
        case "playing":
            return Colors.Yellow;
    }
}

export function createSeparator(): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}
