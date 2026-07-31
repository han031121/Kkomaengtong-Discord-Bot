import { MessageFlags } from "discord.js";
import type { ButtonInteraction } from "discord.js";

import { runWordle } from "./command.js";
import type { WordlePuzzleProvider } from "./command.js";
import {
    createPublicWordleContainer,
    createWordlePlayActionRow,
    createWordleSpoilerContainer,
} from "./panel.js";
import type { WordleSession, WordleSessionStore } from "./session-store.js";
import {
    createCompletedResponse,
    createEphemeralNoticeResponse,
    createNoticeEditResponse,
    createWordleGuessModal,
    defaultWordleSessionStore,
    getWordleGuildId,
    parseWordleButton,
    SUPPRESSED_ALLOWED_MENTIONS,
    updatePrivateWordleState,
    wordleUserLock,
} from "./interaction-builders.js";
import type { ParsedWordleTargetButton } from "./interaction-builders.js";
import { accessWordlePublicStatusPanel, replacePublicWordlePanel } from "./public-status.js";

async function handlePublicStatusPanelButton(
    interaction: ButtonInteraction,
    parsedButton: ParsedWordleTargetButton,
    store: WordleSessionStore,
): Promise<void> {
    const guildId = getWordleGuildId(interaction);
    await interaction.deferUpdate();

    await wordleUserLock.runExclusive(parsedButton.userId, async () => {
        const latestSession = store.get(parsedButton.userId, parsedButton.printDate, guildId);

        if (latestSession === undefined) {
            await interaction.editReply(
                createNoticeEditResponse(
                    "Wordle 게임 정보를 찾을 수 없습니다. `/워들`로 게임을 다시 시작해 주세요.",
                ),
            );
            return;
        }

        const panelAccess = await accessWordlePublicStatusPanel(
            interaction,
            parsedButton.printDate,
            store,
        );
        const panelUrl = `https://discord.com/channels/${guildId}/${interaction.channelId}/${panelAccess.messageId}`;
        const notice =
            panelAccess.action === "created"
                ? "이 채널에 Wordle 공개 현황 패널을 생성했습니다."
                : panelAccess.action === "existing"
                  ? "Wordle 공개 현황 패널이 채널의 최신 위치에 있습니다."
                  : "Wordle 공개 현황 패널을 채널 아래에 다시 생성했습니다.";

        await updatePrivateWordleState(
            interaction,
            latestSession,
            `${notice}\n[공개 현황으로 이동](${panelUrl})`,
            store,
        );
    });
}

async function handleProgressShareButton(
    interaction: ButtonInteraction,
    parsedButton: ParsedWordleTargetButton,
    session: WordleSession,
    store: WordleSessionStore,
): Promise<void> {
    const guildId = getWordleGuildId(interaction);

    if (session.game.status !== "playing") {
        await interaction.reply(
            createEphemeralNoticeResponse("진행 중인 게임만 현재 상황을 공유할 수 있습니다."),
        );
        return;
    }

    await interaction.deferUpdate();
    await wordleUserLock.runExclusive(parsedButton.userId, async () => {
        const latestSession = store.get(parsedButton.userId, parsedButton.printDate, guildId);

        if (latestSession === undefined) {
            await interaction.editReply(
                createNoticeEditResponse(
                    "Wordle 게임 정보를 찾을 수 없습니다. `/워들`로 게임을 다시 시작해 주세요.",
                ),
            );
            return;
        }

        if (latestSession.game.status !== "playing") {
            await updatePrivateWordleState(
                interaction,
                latestSession,
                createCompletedResponse(latestSession),
                store,
            );
            return;
        }

        const panelMessage = await replacePublicWordlePanel(
            interaction,
            latestSession,
            latestSession.game,
        );
        const sharedSession: WordleSession = {
            ...latestSession,
            panelMessage,
        };
        store.set(parsedButton.userId, parsedButton.printDate, guildId, sharedSession);

        await updatePrivateWordleState(
            interaction,
            sharedSession,
            "현재 진행 상황을 공개했습니다.",
            store,
        );
    });
}

async function handleShareButton(
    interaction: ButtonInteraction,
    parsedButton: ParsedWordleTargetButton,
    session: WordleSession,
    store: WordleSessionStore,
): Promise<void> {
    const guildId = getWordleGuildId(interaction);

    if (session.game.status === "playing") {
        await interaction.reply(
            createEphemeralNoticeResponse("게임을 완료한 뒤 결과를 공유할 수 있습니다."),
        );
        return;
    }

    await interaction.deferUpdate();
    await wordleUserLock.runExclusive(parsedButton.userId, async () => {
        const latestSession = store.get(parsedButton.userId, parsedButton.printDate, guildId);

        if (latestSession === undefined) {
            return;
        }

        const sharedPanelMessage = await replacePublicWordlePanel(
            interaction,
            latestSession,
            latestSession.game,
        );
        const sharedSession: WordleSession = {
            ...latestSession,
            panelMessage: sharedPanelMessage,
        };
        store.set(parsedButton.userId, parsedButton.printDate, guildId, sharedSession);

        await updatePrivateWordleState(
            interaction,
            sharedSession,
            createCompletedResponse(sharedSession),
            store,
        );
    });
}

export async function handleSpoilerButton(
    interaction: ButtonInteraction,
    session: WordleSession,
): Promise<void> {
    const { user } = interaction;
    await interaction.deferUpdate();

    const channel =
        interaction.channel ?? (await interaction.client.channels.fetch(interaction.channelId));

    if (channel === null || !channel.isSendable()) {
        throw new Error("Wordle 스포일러를 보낼 수 있는 채널이 아닙니다.");
    }

    await channel.send({
        components: [createWordleSpoilerContainer(session.game, user.id)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { users: [user.id] },
    });
}

async function handlePublicStatusViewButton(
    interaction: ButtonInteraction,
    parsedButton: ParsedWordleTargetButton,
    store: WordleSessionStore,
): Promise<void> {
    const guildId = getWordleGuildId(interaction);
    const session = store.get(parsedButton.userId, parsedButton.printDate, guildId);

    if (session === undefined) {
        await interaction.reply(
            createEphemeralNoticeResponse("해당 사용자의 Wordle 진행 정보를 찾을 수 없습니다."),
        );
        return;
    }

    await interaction.reply({
        components: [
            createPublicWordleContainer(session.game, parsedButton.userId),
            createWordlePlayActionRow(),
        ],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        allowedMentions: SUPPRESSED_ALLOWED_MENTIONS,
    });
}

export async function handleWordleButton(
    interaction: ButtonInteraction,
    store: WordleSessionStore = defaultWordleSessionStore,
    puzzleProvider?: WordlePuzzleProvider,
): Promise<void> {
    const parsedButton = parseWordleButton(interaction.customId);

    if (parsedButton === undefined) {
        return;
    }

    if (parsedButton.action === "play") {
        await runWordle(interaction, {
            ...(puzzleProvider === undefined ? {} : { puzzleProvider }),
            store,
        });
        return;
    }

    const guildId = getWordleGuildId(interaction);

    if (parsedButton.action === "status-view") {
        await handlePublicStatusViewButton(interaction, parsedButton, store);
        return;
    }

    if (interaction.user.id !== parsedButton.userId) {
        await interaction.reply(
            createEphemeralNoticeResponse(
                "이 Wordle 결과의 버튼은 게임을 진행한 사용자만 사용할 수 있습니다.",
            ),
        );
        return;
    }

    const session = store.get(parsedButton.userId, parsedButton.printDate, guildId);

    if (session === undefined) {
        await interaction.reply(
            createEphemeralNoticeResponse(
                "Wordle 게임 정보를 찾을 수 없습니다. 봇이 재시작되었을 수 있습니다.",
            ),
        );
        return;
    }

    if (parsedButton.action === "status-panel") {
        await handlePublicStatusPanelButton(interaction, parsedButton, store);
        return;
    }

    if (parsedButton.action === "progress-share") {
        await handleProgressShareButton(interaction, parsedButton, session, store);
        return;
    }

    if (parsedButton.action === "input") {
        if (session.game.status !== "playing") {
            await interaction.reply(
                createEphemeralNoticeResponse(createCompletedResponse(session)),
            );
            return;
        }

        await interaction.showModal(
            createWordleGuessModal(parsedButton.printDate, parsedButton.userId),
        );
        return;
    }

    if (parsedButton.action === "share") {
        await handleShareButton(interaction, parsedButton, session, store);
        return;
    }

    await handleSpoilerButton(interaction, session);
}
