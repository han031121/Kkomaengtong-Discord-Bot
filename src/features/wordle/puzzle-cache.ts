import type { WordlePuzzle } from "./game.js";
import { formatDateInTimeZone, NytWordleClient } from "./nyt-wordle-client.js";

const DEFAULT_WORDLE_TIME_ZONE = "Asia/Seoul";
const DAILY_REFRESH_START_OFFSET_MS = 0;
const DAILY_REFRESH_INTERVAL_MS = 60_000;
const DAILY_REFRESH_WINDOW_MS = 10 * 60_000;
const MAX_DATE_CHANGE_SEARCH_MS = 48 * 60 * 60 * 1_000;

export interface WordlePuzzleRequestOptions {
    forceRefresh?: boolean;
}

export interface WordlePuzzleClient {
    getPuzzle(date: string, options?: WordlePuzzleRequestOptions): Promise<WordlePuzzle>;
}

export class WordlePuzzleUnavailableError extends Error {
    public constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "WordlePuzzleUnavailableError";
    }
}

export function getMillisecondsUntilNextDateInTimeZone(now: Date, timeZone: string): number {
    const currentDate = formatDateInTimeZone(now, timeZone);
    let lowerBoundMs = 1;
    let upperBoundMs = 60 * 60 * 1_000;

    while (
        upperBoundMs < MAX_DATE_CHANGE_SEARCH_MS &&
        formatDateInTimeZone(new Date(now.getTime() + upperBoundMs), timeZone) === currentDate
    ) {
        upperBoundMs *= 2;
    }

    if (upperBoundMs >= MAX_DATE_CHANGE_SEARCH_MS) {
        throw new Error("Wordle 날짜 변경 시점을 계산할 수 없습니다.");
    }

    while (lowerBoundMs < upperBoundMs) {
        const middleMs = Math.floor((lowerBoundMs + upperBoundMs) / 2);
        const middleDate = formatDateInTimeZone(new Date(now.getTime() + middleMs), timeZone);

        if (middleDate === currentDate) {
            lowerBoundMs = middleMs + 1;
        } else {
            upperBoundMs = middleMs;
        }
    }

    return lowerBoundMs;
}

export class WordlePuzzleCache {
    private cachedPuzzle: WordlePuzzle | undefined;
    private refreshTimer: NodeJS.Timeout | undefined;
    private dailyRefreshStarted = false;

    public constructor(
        private readonly client: WordlePuzzleClient = new NytWordleClient(),
        private readonly timeZone = DEFAULT_WORDLE_TIME_ZONE,
        private readonly dailyRefreshStartOffsetMs = DAILY_REFRESH_START_OFFSET_MS,
        private readonly dailyRefreshIntervalMs = DAILY_REFRESH_INTERVAL_MS,
        private readonly dailyRefreshWindowMs = DAILY_REFRESH_WINDOW_MS,
    ) {}

    public async refresh(now = new Date()): Promise<WordlePuzzle> {
        const printDate = formatDateInTimeZone(now, this.timeZone);
        const puzzle = await this.client.getPuzzle(printDate, { forceRefresh: true });

        this.cachedPuzzle = puzzle;

        return puzzle;
    }

    public getTodaysPuzzle(now = new Date()): WordlePuzzle {
        const printDate = formatDateInTimeZone(now, this.timeZone);

        if (this.cachedPuzzle?.printDate === printDate) {
            return this.cachedPuzzle;
        }

        throw new WordlePuzzleUnavailableError(
            `오늘의 Wordle(${printDate})이 아직 캐시에 준비되지 않았습니다.`,
        );
    }

    public startDailyRefresh(): void {
        if (this.dailyRefreshStarted) {
            return;
        }

        this.dailyRefreshStarted = true;
        this.scheduleNextDailyRefreshWindow();
    }

    public stopDailyRefresh(): void {
        this.dailyRefreshStarted = false;

        if (this.refreshTimer === undefined) {
            return;
        }

        clearTimeout(this.refreshTimer);
        this.refreshTimer = undefined;
    }

    private scheduleNextDailyRefreshWindow(): void {
        if (!this.dailyRefreshStarted) {
            return;
        }

        const windowStartTimeMs =
            Date.now() +
            getMillisecondsUntilNextDateInTimeZone(new Date(), this.timeZone) +
            this.dailyRefreshStartOffsetMs;

        this.scheduleRefreshAttempt(windowStartTimeMs, 0);
    }

    private scheduleRefreshAttempt(windowStartTimeMs: number, attemptIndex: number): void {
        if (!this.dailyRefreshStarted) {
            return;
        }

        const attemptTimeMs = windowStartTimeMs + attemptIndex * this.dailyRefreshIntervalMs;
        const delayMs = Math.max(0, attemptTimeMs - Date.now());
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = undefined;
            void this.refreshDuringDateChangeWindow(windowStartTimeMs, attemptIndex);
        }, delayMs);

        if (typeof this.refreshTimer.unref === "function") {
            this.refreshTimer.unref();
        }
    }

    private async refreshDuringDateChangeWindow(
        windowStartTimeMs: number,
        attemptIndex: number,
    ): Promise<void> {
        try {
            await this.refresh();
        } catch (error) {
            console.error("날짜 변경 후 오늘의 NYT Wordle을 캐시하지 못했습니다.", error);
        } finally {
            const nextAttemptIndex = attemptIndex + 1;

            if (nextAttemptIndex * this.dailyRefreshIntervalMs <= this.dailyRefreshWindowMs) {
                this.scheduleRefreshAttempt(windowStartTimeMs, nextAttemptIndex);
                return;
            }

            this.scheduleNextDailyRefreshWindow();
        }
    }
}

export const wordlePuzzleCache = new WordlePuzzleCache();
