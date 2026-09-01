import { z } from "zod";

import type { WordlePuzzle } from "../../domain/game.js";
import { formatDateInTimeZone } from "../../domain/print-date.js";

const NYT_WORDLE_API_BASE_URL = "https://www.nytimes.com/svc/wordle/v2";
const REQUEST_TIMEOUT_MS = 7_000;

const nytWordleResponseSchema = z.object({
    id: z.number().int(),
    solution: z.string().regex(/^[a-z]{5}$/i),
    print_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    days_since_launch: z.number().int().positive(),
});

export class NytWordleServiceError extends Error {
    public constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "NytWordleServiceError";
    }
}

export class NytWordleClient {
    private readonly cache = new Map<string, Promise<WordlePuzzle>>();

    public constructor(
        private readonly fetchImplementation: typeof fetch = globalThis.fetch,
        private readonly timeZone = "Asia/Seoul",
    ) {}

    public getTodaysPuzzle(now = new Date()): Promise<WordlePuzzle> {
        return this.getPuzzle(formatDateInTimeZone(now, this.timeZone));
    }

    public getPuzzle(
        date: string,
        options: { forceRefresh?: boolean } = {},
    ): Promise<WordlePuzzle> {
        if (options.forceRefresh === true) {
            const request = this.fetchPuzzle(date).catch((error: unknown) => {
                this.cache.delete(date);
                throw error;
            });
            this.cache.set(date, request);

            return request;
        }

        const cachedPuzzle = this.cache.get(date);

        if (cachedPuzzle !== undefined) {
            return cachedPuzzle;
        }

        const request = this.fetchPuzzle(date).catch((error: unknown) => {
            this.cache.delete(date);
            throw error;
        });
        this.cache.set(date, request);

        return request;
    }

    private async fetchPuzzle(date: string): Promise<WordlePuzzle> {
        let response: Response;

        try {
            response = await this.fetchImplementation(`${NYT_WORDLE_API_BASE_URL}/${date}.json`, {
                headers: {
                    accept: "application/json",
                },
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch (error) {
            throw new NytWordleServiceError("NYT Wordle 서버에 연결할 수 없습니다.", {
                cause: error,
            });
        }

        if (!response.ok) {
            throw new NytWordleServiceError(
                `NYT Wordle 서버가 HTTP ${response.status} 상태를 반환했습니다.`,
            );
        }

        let body: unknown;

        try {
            body = await response.json();
        } catch (error) {
            throw new NytWordleServiceError("NYT Wordle 응답이 올바른 JSON이 아닙니다.", {
                cause: error,
            });
        }

        const parsedBody = nytWordleResponseSchema.safeParse(body);

        if (!parsedBody.success) {
            throw new NytWordleServiceError("NYT Wordle 응답 형식이 예상과 다릅니다.");
        }

        if (parsedBody.data.print_date !== date) {
            throw new NytWordleServiceError("NYT Wordle 응답 날짜가 요청한 날짜와 다릅니다.");
        }

        return {
            id: parsedBody.data.id,
            solution: parsedBody.data.solution.toLowerCase(),
            printDate: parsedBody.data.print_date,
            puzzleNumber: parsedBody.data.days_since_launch,
        };
    }
}
