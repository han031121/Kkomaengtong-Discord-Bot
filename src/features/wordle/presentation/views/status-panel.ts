import {
    ButtonBuilder,
    ContainerBuilder,
    SectionBuilder,
    TextDisplayBuilder,
} from "@discordjs/builders";
import { ActionRowBuilder, ButtonStyle, Colors } from "discord.js";

import { WORDLE_MAX_GUESSES } from "../../domain/game.js";
import type { GameStatus, WordleGame, WordlePuzzle } from "../../domain/game.js";
import { createSeparator, TILE_EMOJI } from "./shared.js";

const PUBLIC_STATUS_PLAYER_LIMIT = 8;

export interface WordlePublicStatusEntry {
    userId: string;
    game: WordleGame;
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
        .addTextDisplayComponents(new TextDisplayBuilder().setContent("### 오늘의 Wordle 점수판"))
        .addSeparatorComponents(createSeparator());

    addPublicStatusEntries(container, entries);
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `-# 최근 활동 순 ${entries.length}명 표시 · 전체 ${totalPlayers}명 · ${printDate}`,
        ),
    );
    return container;
}

export function createYesterdayWordleStatusContainer(
    entries: readonly WordlePublicStatusEntry[],
    totalPlayers: number,
    puzzle: WordlePuzzle,
): ContainerBuilder {
    validatePublicStatusEntries(entries, totalPlayers);

    const container = new ContainerBuilder()
        .setAccentColor(Colors.Blurple)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent("### 어제의 Wordle 점수판"))
        .addSeparatorComponents(createSeparator())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                [
                    `**정답 · \`${puzzle.solution.toUpperCase()}\`**`,
                    "새로운 Wordle이 시작되었습니다!",
                    "\u200B",
                ].join("\n"),
            ),
        );

    addPublicStatusEntries(container, entries);
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `-# 최근 활동 순 ${entries.length}명 표시 · 전체 ${totalPlayers}명 · ${puzzle.printDate}`,
        ),
    );
    return container;
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
