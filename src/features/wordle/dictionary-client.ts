const DICTIONARY_API_BASE_URL = "https://api.dictionaryapi.dev/api/v2/entries/en";
const REQUEST_TIMEOUT_MS = 7_000;

export class DictionaryServiceError extends Error {
    public constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "DictionaryServiceError";
    }
}

export class DictionaryClient {
    private readonly cache = new Map<string, Promise<boolean>>();

    public constructor(private readonly fetchImplementation: typeof fetch = globalThis.fetch) {}

    public isEnglishWord(word: string): Promise<boolean> {
        const cachedValidation = this.cache.get(word);

        if (cachedValidation !== undefined) {
            return cachedValidation;
        }

        const validation = this.lookup(word).catch((error: unknown) => {
            this.cache.delete(word);
            throw error;
        });
        this.cache.set(word, validation);

        return validation;
    }

    private async lookup(word: string): Promise<boolean> {
        let response: Response;

        try {
            response = await this.fetchImplementation(
                `${DICTIONARY_API_BASE_URL}/${encodeURIComponent(word)}`,
                {
                    headers: {
                        accept: "application/json",
                    },
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                },
            );
        } catch (error) {
            throw new DictionaryServiceError("영어 사전 서버에 연결할 수 없습니다.", {
                cause: error,
            });
        }

        if (response.status === 404) {
            return false;
        }

        if (!response.ok) {
            throw new DictionaryServiceError(
                `영어 사전 서버가 HTTP ${response.status} 상태를 반환했습니다.`,
            );
        }

        let body: unknown;

        try {
            body = await response.json();
        } catch (error) {
            throw new DictionaryServiceError("영어 사전 응답이 올바른 JSON이 아닙니다.", {
                cause: error,
            });
        }

        if (!Array.isArray(body) || body.length === 0) {
            throw new DictionaryServiceError("영어 사전 응답 형식이 예상과 다릅니다.");
        }

        return true;
    }
}
