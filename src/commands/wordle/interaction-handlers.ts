import { MessageFlags } from "discord.js";
import type { ButtonInteraction, ModalSubmitInteraction } from "discord.js";

import { normalizeGuess } from "../../features/wordle/game.js";
import { LocalDictionary } from "../../features/wordle/local-dictionary.js";

import { runWordle } from "./command.js";
import type { WordlePuzzleProvider } from "./command.js";
import { processWordleGuess } from "./guess-processing.js";
import type { WordleDictionary } from "./guess-processing.js";
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
    createWordleSpoilerModal,
    defaultWordleSessionStore,
    getWordleGuildId,
    parseWordleButton,
    parseWordleModal,
    SUPPRESSED_ALLOWED_MENTIONS,
    updatePrivateWordleState,
    WORDLE_GUESS_INPUT_ID,
    WORDLE_SPOILER_INPUT_ID,
    wordleUserLock,
} from "./interaction-builders.js";
import type { ParsedWordleTargetButton } from "./interaction-builders.js";
import { accessWordlePublicStatusPanel, replacePublicWordlePanel } from "./public-status.js";

const localDictionary = new LocalDictionary();

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

async function handleShareButton(
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

export async function handleSpoilerButton(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    session: WordleSession,
    spoilerWord: string,
): Promise<void> {
    const { user } = interaction;
    await interaction.deferUpdate();

    const channel =
        interaction.channel ??
        (interaction.channelId === null
            ? null
            : await interaction.client.channels.fetch(interaction.channelId));

    if (channel === null || !channel.isSendable()) {
        throw new Error("Wordle 스포일러를 보낼 수 있는 채널이 아닙니다.");
    }

    await channel.send({
        components: [createWordleSpoilerContainer(session.game, user.id, spoilerWord)],
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
        await handleShareButton(interaction, parsedButton, store);
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

export async function handleWordleModal(
    interaction: ModalSubmitInteraction,
    store: WordleSessionStore = defaultWordleSessionStore,
    dictionary: WordleDictionary = localDictionary,
): Promise<void> {
    const parsedModal = parseWordleModal(interaction.customId);

    if (parsedModal === undefined) {
        return;
    }

    const guildId = getWordleGuildId(interaction);

    if (interaction.user.id !== parsedModal.userId) {
        const inputName = parsedModal.action === "guess" ? "단어 입력창" : "스포일러 입력창";

        await interaction.reply(
            createEphemeralNoticeResponse(
                `이 Wordle ${inputName}은 게임을 진행한 사용자만 사용할 수 있습니다.`,
            ),
        );
        return;
    }

    const session = store.get(parsedModal.userId, parsedModal.printDate, guildId);

    if (session === undefined) {
        await interaction.reply(
            createEphemeralNoticeResponse(
                "Wordle 게임 정보를 찾을 수 없습니다. `/워들`로 게임을 다시 시작해 주세요.",
            ),
        );
        return;
    }

    if (parsedModal.action === "spoiler") {
        if (session.game.status !== "won") {
            await interaction.reply(
                createEphemeralNoticeResponse(
                    "Wordle 성공 결과에서만 스포일러를 작성할 수 있습니다.",
                ),
            );
            return;
        }

        const spoilerWord = normalizeGuess(
            interaction.fields.getTextInputValue(WORDLE_SPOILER_INPUT_ID),
        );

        if (spoilerWord === undefined) {
            await interaction.reply(
                createEphemeralNoticeResponse("영문 알파벳 5글자만 입력할 수 있습니다."),
            );
            return;
        }

        await handleSpoilerButton(interaction, session, spoilerWord);
        return;
    }

    await interaction.deferUpdate();

    const guess = normalizeGuess(interaction.fields.getTextInputValue(WORDLE_GUESS_INPUT_ID));

    if (guess === undefined) {
        await updatePrivateWordleState(
            interaction,
            session,
            "영문 알파벳 5글자만 입력할 수 있습니다.",
            store,
        );
        return;
    }

    await wordleUserLock.runExclusive(parsedModal.userId, () =>
        processWordleGuess(interaction, parsedModal.printDate, guess, store, dictionary),
    );
}
