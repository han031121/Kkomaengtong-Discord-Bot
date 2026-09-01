import type { ParsedWordleButton, ParsedWordleModal, WordleButtonAction } from "./types.js";

export const WORDLE_GUESS_INPUT_ID = "wordle:guess";
export const WORDLE_SPOILER_INPUT_ID = "wordle:spoiler-word";

export type WordleButtonPrefix = "share" | "spoiler" | "input" | "status-panel";

export function createWordleButtonCustomId(
    action: WordleButtonPrefix,
    printDate: string,
    userId: string,
): string {
    return `wordle:${action}:${printDate}:${userId}`;
}

export function createWordleModalCustomId(
    action: "guess-modal" | "spoiler-modal",
    printDate: string,
    userId: string,
): string {
    return `wordle:${action}:${printDate}:${userId}`;
}

export function parseWordleButton(customId: string): ParsedWordleButton | undefined {
    if (customId === "wordle:play") {
        return { action: "play" };
    }

    const [scope, action, printDate, userId, extraPart] = customId.split(":");

    if (
        scope !== "wordle" ||
        !isWordleButtonAction(action) ||
        printDate === undefined ||
        !/^\d{4}-\d{2}-\d{2}$/.test(printDate) ||
        userId === undefined ||
        !/^\d{17,20}$/.test(userId) ||
        extraPart !== undefined
    ) {
        return undefined;
    }

    return {
        action: action === "progress-share" ? "share" : action,
        printDate,
        userId,
    };
}

export function isWordleButton(customId: string): boolean {
    return parseWordleButton(customId) !== undefined;
}

export function parseWordleModal(customId: string): ParsedWordleModal | undefined {
    const [scope, action, printDate, userId, extraPart] = customId.split(":");

    if (
        scope !== "wordle" ||
        (action !== "guess-modal" && action !== "spoiler-modal") ||
        printDate === undefined ||
        !/^\d{4}-\d{2}-\d{2}$/.test(printDate) ||
        userId === undefined ||
        !/^\d{17,20}$/.test(userId) ||
        extraPart !== undefined
    ) {
        return undefined;
    }

    return {
        action: action === "guess-modal" ? "guess" : "spoiler",
        printDate,
        userId,
    };
}

export function isWordleModal(customId: string): boolean {
    return parseWordleModal(customId) !== undefined;
}

function isWordleButtonAction(
    action: string | undefined,
): action is WordleButtonAction | "progress-share" {
    return (
        action === "share" ||
        action === "spoiler" ||
        action === "input" ||
        action === "progress-share" ||
        action === "status-panel" ||
        action === "status-view"
    );
}
