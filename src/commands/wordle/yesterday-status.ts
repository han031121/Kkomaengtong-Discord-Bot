import { MessageFlags } from "discord.js";
import type { Client } from "discord.js";

import { AsyncKeyedLock } from "../../features/wordle/async-keyed-lock.js";
import { createWordlePlayActionRow, createYesterdayWordleStatusContainer } from "./panel.js";
import type { WordleSessionStore, WordleYesterdayAnnouncementTarget } from "./session-store.js";

const WORDLE_YESTERDAY_PLAYER_LIMIT = 8;
const yesterdayAnnouncementLock = new AsyncKeyedLock();

export function createYesterdayWordleRecordResponse(
    store: WordleSessionStore,
    guildId: string,
    recordDate: string,
) {
    const puzzle = store.getPuzzle(recordDate);

    if (puzzle === undefined) {
        throw new Error(`어제 Wordle 퍼즐 정보를 찾을 수 없습니다: ${recordDate}`);
    }

    const recentPlayers = store.getRecentPlayers(
        guildId,
        recordDate,
        WORDLE_YESTERDAY_PLAYER_LIMIT,
    );

    if (recentPlayers.totalPlayers === 0) {
        throw new Error(`어제 Wordle 참여 기록을 찾을 수 없습니다: ${guildId}:${recordDate}`);
    }

    return {
        components: [
            createYesterdayWordleStatusContainer(
                recentPlayers.players,
                recentPlayers.totalPlayers,
                puzzle,
            ),
            createWordlePlayActionRow(),
        ],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: {
            parse: [],
            users: recentPlayers.players.map((player) => player.userId),
            roles: [],
            repliedUser: false,
        },
    } as const;
}

async function sendYesterdayWordleRecord(
    client: Client,
    target: WordleYesterdayAnnouncementTarget,
    store: WordleSessionStore,
): Promise<string> {
    const channel = await client.channels.fetch(target.channelId);

    if (channel === null || !channel.isSendable()) {
        throw new Error(`어제 Wordle 기록을 보낼 수 있는 채널이 아닙니다: ${target.channelId}`);
    }

    if ("guildId" in channel && channel.guildId !== target.guildId) {
        throw new Error(`어제 Wordle 기록의 서버와 채널이 일치하지 않습니다: ${target.guildId}`);
    }

    const message = await channel.send(
        createYesterdayWordleRecordResponse(store, target.guildId, target.recordDate),
    );

    return message.id;
}

async function publishYesterdayWordleRecordTarget(
    client: Client,
    target: WordleYesterdayAnnouncementTarget,
    store: WordleSessionStore,
): Promise<string> {
    const messageId = await sendYesterdayWordleRecord(client, target, store);
    store.markYesterdayAnnouncementSent(target, messageId);
    return messageId;
}

export async function publishPendingYesterdayWordleRecords(
    client: Client,
    currentPrintDate: string,
    store: WordleSessionStore,
): Promise<number> {
    return yesterdayAnnouncementLock.runExclusive(currentPrintDate, async () => {
        const targets = store.listPendingYesterdayAnnouncements(currentPrintDate);
        let sentCount = 0;

        for (const target of targets) {
            try {
                await publishYesterdayWordleRecordTarget(client, target, store);
                sentCount += 1;
            } catch (error) {
                console.error(
                    `어제 Wordle 기록 알림 전송에 실패했습니다: ${target.guildId}:${target.channelId}`,
                    error,
                );
            }
        }

        return sentCount;
    });
}
