import type { WordleDictionary, WordlePuzzleProvider } from "../../application/ports.js";
import type { WordleSessionStore } from "../session-store.js";

export interface WordleUserLock {
    runExclusive<T>(key: string, operation: () => Promise<T>): Promise<T>;
}

export interface WordleInteractionDependencies {
    dictionary: WordleDictionary;
    puzzleProvider: WordlePuzzleProvider;
    store: WordleSessionStore;
    userLock: WordleUserLock;
}
