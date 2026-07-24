import { readFileSync } from "node:fs";

import wordListPath from "word-list";

const FIVE_LETTER_WORD_PATTERN = /^[a-z]{5}$/u;

const fiveLetterEnglishWords = new Set(
    readFileSync(wordListPath, "utf8")
        .split(/\r?\n/u)
        .filter((word) => FIVE_LETTER_WORD_PATTERN.test(word)),
);

export class LocalDictionary {
    public isEnglishWord(word: string): boolean {
        return fiveLetterEnglishWords.has(word);
    }
}
