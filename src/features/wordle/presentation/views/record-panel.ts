import { ContainerBuilder, TextDisplayBuilder } from "@discordjs/builders";
import { Colors } from "discord.js";

import type { WordlePersonalRecord } from "../../domain/models.js";
import type { WordleRecordRankingEntry, WordleServerRecordRankings } from "../records.js";
import { createSeparator } from "./shared.js";

export function createPersonalWordleRecordContainer(
    userId: string,
    record: WordlePersonalRecord,
): ContainerBuilder {
    const winRate = record.winRate === undefined ? "기록 없음" : `${record.winRate.toFixed(1)}%`;
    const averageGuessCount =
        record.averageGuessCount === undefined
            ? "기록 없음"
            : `${record.averageGuessCount.toFixed(1)}회`;

    return new ContainerBuilder()
        .setAccentColor(Colors.Blurple)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`### <@${userId}>님의 Wordle 개인 기록`),
        )
        .addSeparatorComponents(createSeparator())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                [
                    `- 성공 횟수: **${record.successCount}회**`,
                    `- 연속 성공: **${record.recentSuccessStreak}일**`,
                    `- 정답률: **${winRate}**`,
                    `- 평균 시도 횟수: **${averageGuessCount}**`,
                    `- 스포일러 사용 횟수`,
                    `  - 찐스포: **${record.genuineSpoilerCount}회**`,
                    `  - 짭스포: **${record.fakeSpoilerCount}회**`,
                    `- 사전 미등록 단어 입력 횟수: **${record.unregisteredWordCount}회**`,
                ].join("\n"),
            ),
        );
}

function formatRecordRanking(
    entries: readonly WordleRecordRankingEntry[],
    formatValue: (value: number) => string,
): string {
    if (entries.length === 0) {
        return "기록 없음";
    }

    return entries
        .map((entry, index) => `${index + 1}. <@${entry.userId}> · **${formatValue(entry.value)}**`)
        .join("\n");
}

export function createAllWordleRecordsContainer(
    rankings: WordleServerRecordRankings,
): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(Colors.Blurple)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent("### 현재 서버 Wordle 기록 순위"),
        )
        .addSeparatorComponents(createSeparator())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                [
                    "**연속 성공**",
                    formatRecordRanking(rankings.recentSuccessStreak, (value) => `${value}일`),
                    "",
                    "**정답률**",
                    formatRecordRanking(rankings.winRate, (value) => `${value.toFixed(1)}%`),
                    "",
                    "**평균 시도 횟수**",
                    formatRecordRanking(
                        rankings.averageGuessCount,
                        (value) => `${value.toFixed(1)}회`,
                    ),
                ].join("\n"),
            ),
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# 항목별 최대 5위까지 표기`),
        );
}
