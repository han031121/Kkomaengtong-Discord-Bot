import { readFileSync } from "node:fs";

const FIVE_LETTER_WORD_PATTERN = /^[a-z]{5}$/u;
const WORD_DATASET_URL = new URL("../../../assets/valid-five-letter-words.json", import.meta.url);

function isFiveLetterEnglishWord(value: unknown): value is string {
    return typeof value === "string" && FIVE_LETTER_WORD_PATTERN.test(value);
}

function loadFiveLetterEnglishWords(): ReadonlySet<string> {
    let parsedDataset: unknown;

    try {
        parsedDataset = JSON.parse(readFileSync(WORD_DATASET_URL, "utf8"));
    } catch (error) {
        throw new Error("로컬 영단어 데이터셋을 불러올 수 없습니다.", {
            cause: error,
        });
    }

    if (
        !Array.isArray(parsedDataset) ||
        parsedDataset.length === 0 ||
        !parsedDataset.every((word: unknown) => isFiveLetterEnglishWord(word))
    ) {
        throw new Error("로컬 영단어 데이터셋 형식이 올바르지 않습니다.");
    }

    const words = new Set<string>(parsedDataset);

    if (words.size !== parsedDataset.length) {
        throw new Error("로컬 영단어 데이터셋에 중복된 단어가 있습니다.");
    }

    return words;
}

const fiveLetterEnglishWords = loadFiveLetterEnglishWords();

export class LocalDictionary {
    public isEnglishWord(word: string): boolean {
        return fiveLetterEnglishWords.has(word);
    }
}
