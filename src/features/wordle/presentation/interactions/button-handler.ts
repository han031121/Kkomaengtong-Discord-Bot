import { MessageFlags } from "discord.js";
import type { ButtonInteraction } from "discord.js";

import { runWordle } from "../actions/play.js";
import { createPublicWordleContainer, createWordlePlayActionRow } from "../panel.js";
import { accessWordlePublicStatusPanel } from "../public-panels/status-board-access.js";
import { replacePublicWordlePanel } from "../public-panels/shared-game-panel.js";
import type { WordleSession, WordleSessionStore } from "../session-store.js";
import {
    createEphemeralNoticeResponse,
    createNoticeEditResponse,
    createWordleGuessModal,
    createWordleSpoilerModal,
    SUPPRESSED_ALLOWED_MENTIONS,
} from "./components.js";
import type { WordleInteractionDependencies } from "./context.js";
import { parseWordleButton } from "./custom-id.js";
import {
    createCompletedResponse,
    getWordleGuildId,
    updatePrivateWordleState,
} from "./private-state.js";
import type { ParsedWordleTargetButton } from "./types.js";

async function handlePublicStatusPanelButton(
    interaction: ButtonInteraction,
    parsedButton: ParsedWordleTargetButton,
    dependencies: WordleInteractionDependencies,
): Promise<void> {
    const { store, userLock } = dependencies;
    const guildId = getWordleGuildId(interaction);
    await interaction.deferUpdate();

    await userLock.runExclusive(parsedButton.userId, async () => {
        const latestSession = store.get(parsedButton.userId, parsedButton.printDate, guildId);

        if (latestSession === undefined) {
            await interaction.editReply(
                createNoticeEditResponse(
                    "Wordle 게임 정보를 찾을 수 없습니다. `/워들 플레이`로 게임을 다시 시작해 주세요.",
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

async function handleShareButton(
    interaction: ButtonInteraction,
    parsedButton: ParsedWordleTargetButton,
    dependencies: WordleInteractionDependencies,
): Promise<void> {
    const { store, userLock } = dependencies;
    const guildId = getWordleGuildId(interaction);

    await interaction.deferUpdate();
    await userLock.runExclusive(parsedButton.userId, async () => {
        const latestSession = store.get(parsedButton.userId, parsedButton.printDate, guildId);

        if (latestSession === undefined) {
            await interaction.editReply(
                createNoticeEditResponse(
                    "Wordle 게임 정보를 찾을 수 없습니다. `/워들 플레이`로 게임을 다시 시작해 주세요.",
                ),
            );
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
            sharedSession.game.status === "playing"
                ? "현재 진행 상황을 공개했습니다."
                : createCompletedResponse(sharedSession),
            store,
        );
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
    dependencies: WordleInteractionDependencies,
): Promise<void> {
    const { store } = dependencies;
    const parsedButton = parseWordleButton(interaction.customId);

    if (parsedButton === undefined) {
        return;
    }

    if (parsedButton.action === "play") {
        await runWordle(interaction, dependencies);
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
        await handlePublicStatusPanelButton(interaction, parsedButton, dependencies);
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
        await handleShareButton(interaction, parsedButton, dependencies);
        return;
    }

    if (session.game.status !== "won") {
        await interaction.reply(
            createEphemeralNoticeResponse("Wordle 성공 결과에서만 스포일러를 작성할 수 있습니다."),
        );
        return;
    }

    await interaction.showModal(
        createWordleSpoilerModal(
            parsedButton.printDate,
            parsedButton.userId,
            session.game.puzzle.solution,
        ),
    );
}
