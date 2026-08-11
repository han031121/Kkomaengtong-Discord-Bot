import {
    ButtonBuilder,
    ContainerBuilder,
    SectionBuilder,
    SeparatorBuilder,
    TextDisplayBuilder,
    ThumbnailBuilder,
} from "@discordjs/builders";
import { ActionRowBuilder, ButtonStyle, Colors, SeparatorSpacingSize } from "discord.js";

import { WORDLE_MAX_GUESSES } from "../../features/wordle/game.js";
import type {
    GameStatus,
    TileState,
    WordleGame,
    WordlePuzzle,
} from "../../features/wordle/game.js";

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
const PUBLIC_STATUS_PLAYER_LIMIT = 8;

export interface WordlePublicStatusEntry {
    userId: string;
    game: WordleGame;
}

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

export function createWordlePlayActionRow(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId("wordle:play")
            .setLabel("지금 플레이")
            .setStyle(ButtonStyle.Primary),
    );
}

function getPublicStatusLabel(status: GameStatus): string {
    switch (status) {
        case "won":
            return "성공";
        case "lost":
            return "실패";
        case "playing":
            return "진행 중";
    }
}

export function getFoundAlphabetCounts(
    game: WordleGame,
): Readonly<{ present: number; correct: number }> {
    const knownOccurrences = new Map<string, number>();
    const correctPositions = new Map<string, Set<number>>();
    let present = 0;
    let correct = 0;

    for (const guess of game.guesses) {
        const matchedOccurrences = new Map<string, number>();

        for (let index = 0; index < guess.word.length; index += 1) {
            const letter = guess.word[index]?.toUpperCase();
            const tile = guess.tiles[index];

            if (letter === undefined || tile === undefined || tile === "absent") {
                continue;
            }

            matchedOccurrences.set(letter, (matchedOccurrences.get(letter) ?? 0) + 1);

            if (tile === "correct") {
                const positions = correctPositions.get(letter) ?? new Set<number>();

                positions.add(index);
                correctPositions.set(letter, positions);
            }
        }

        for (const [letter, count] of matchedOccurrences) {
            knownOccurrences.set(letter, Math.max(knownOccurrences.get(letter) ?? 0, count));
        }
    }

    for (const [letter, occurrenceCount] of knownOccurrences) {
        const correctCount = correctPositions.get(letter)?.size ?? 0;

        correct += correctCount;
        present += Math.max(occurrenceCount, correctCount) - correctCount;
    }

    return { present, correct };
}

export function createWordlePublicStatusContainer(
    entries: readonly WordlePublicStatusEntry[],
    totalPlayers: number,
    printDate: string,
): ContainerBuilder {
    validatePublicStatusEntries(entries, totalPlayers);

    const container = new ContainerBuilder()
        .setAccentColor(Colors.Blurple)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                [
                    "### 오늘의 Wordle 점수판",
                    `-# 최근 활동 순 ${entries.length}명 표시 · 전체 ${totalPlayers}명 · ${printDate}`,
                ].join("\n"),
            ),
        );

    return addPublicStatusEntries(container, entries);
}

export function createYesterdayWordleStatusContainer(
    entries: readonly WordlePublicStatusEntry[],
    totalPlayers: number,
    puzzle: WordlePuzzle,
): ContainerBuilder {
    validatePublicStatusEntries(entries, totalPlayers);

    const container = new ContainerBuilder()
        .setAccentColor(Colors.Blurple)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                [
                    "### 어제의 Wordle 점수판",
                    `**정답 · \`${puzzle.solution.toUpperCase()}\`**`,
                    "새로운 Wordle이 시작되었습니다!\n",
                    `-# 최근 활동 순 ${entries.length}명 표시 · 전체 ${totalPlayers}명 · ${puzzle.printDate}`,
                ].join("\n"),
            ),
        );

    return addPublicStatusEntries(container, entries);
}

function validatePublicStatusEntries(
    entries: readonly WordlePublicStatusEntry[],
    totalPlayers: number,
): void {
    if (entries.length > PUBLIC_STATUS_PLAYER_LIMIT) {
        throw new RangeError(
            `Wordle 공개 현황에는 최대 ${PUBLIC_STATUS_PLAYER_LIMIT}명만 표시할 수 있습니다.`,
        );
    }

    if (!Number.isSafeInteger(totalPlayers) || totalPlayers < entries.length) {
        throw new RangeError("Wordle 공개 현황의 전체 참여자 수가 올바르지 않습니다.");
    }
}

function addPublicStatusEntries(
    container: ContainerBuilder,
    entries: readonly WordlePublicStatusEntry[],
): ContainerBuilder {
    if (entries.length === 0) {
        return container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent("아직 Wordle에 참여한 사용자가 없습니다."),
        );
    }

    for (const entry of entries) {
        const attemptCount = `${entry.game.guesses.length}/${WORDLE_MAX_GUESSES}`;
        const foundAlphabetCounts = getFoundAlphabetCounts(entry.game);

        container.addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        [
                            `<@${entry.userId}> **${getPublicStatusLabel(entry.game.status)}** · **${attemptCount}**`,
                            `찾음: ${TILE_EMOJI.present} ${foundAlphabetCounts.present}개 · ${TILE_EMOJI.correct} ${foundAlphabetCounts.correct}개`,
                        ].join("\n"),
                    ),
                )
                .setButtonAccessory(
                    new ButtonBuilder()
                        .setCustomId(
                            `wordle:status-view:${entry.game.puzzle.printDate}:${entry.userId}`,
                        )
                        .setLabel("보기")
                        .setStyle(ButtonStyle.Secondary),
                ),
        );
    }

    return container;
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
        [rows.join("\n"), "", getStatusText(game), `-# ${game.puzzle.printDate}`].join("\n"),
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

export function createWordleSpoilerContainer(
    game: WordleGame,
    userId: string,
    spoilerWord: string,
): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(Colors.Red)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`### <@${userId}>님의 스포일러`),
        )
        .addSeparatorComponents(createSeparator())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                [
                    `# ${[...spoilerWord.toUpperCase()].join(" ")}`,
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
                    "**상태**",
                    getStatusText(game),
                ].join("\n"),
            ),
        )
        .addSeparatorComponents(createSeparator());
}
