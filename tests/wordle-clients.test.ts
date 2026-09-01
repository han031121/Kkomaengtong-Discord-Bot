import { afterEach, describe, expect, it, vi } from "vitest";

import {
    getMillisecondsUntilNextDateInTimeZone,
    WordlePuzzleCache,
    WordlePuzzleUnavailableError,
} from "../src/features/wordle/application/puzzle-cache.js";
import type { WordlePuzzle } from "../src/features/wordle/domain/game.js";
import { formatDateInTimeZone } from "../src/features/wordle/domain/print-date.js";
import {
    NytWordleClient,
    NytWordleServiceError,
} from "../src/features/wordle/infrastructure/clients/nyt-wordle-client.js";
import { LocalDictionary } from "../src/features/wordle/infrastructure/dictionary/local-dictionary.js";

const nytResponse = {
    days_since_launch: 1890,
    id: 42,
    print_date: "2026-07-23",
    solution: "CRANE",
};
const cachedPuzzle: WordlePuzzle = {
    id: 42,
    printDate: "2026-07-23",
    puzzleNumber: 1890,
    solution: "crane",
};

function createNytResponse(overrides: Partial<typeof nytResponse> = {}): Response {
    return new Response(JSON.stringify({ ...nytResponse, ...overrides }), {
        headers: { "content-type": "application/json" },
        status: 200,
    });
}

afterEach(() => {
    vi.useRealTimers();
});

describe("NYT Wordle 클라이언트", () => {
    it("시간대의 날짜를 YYYY-MM-DD 형식으로 계산합니다", () => {
        const date = new Date("2026-07-22T15:30:00.000Z");

        expect(formatDateInTimeZone(date, "Asia/Seoul")).toBe("2026-07-23");
        expect(formatDateInTimeZone(date, "America/New_York")).toBe("2026-07-22");
    });

    it("NYT 응답을 변환하고 일반 요청만 날짜별로 캐시합니다", async () => {
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockImplementation(() => Promise.resolve(createNytResponse()));
        const client = new NytWordleClient(fetchMock);

        await expect(client.getPuzzle("2026-07-23")).resolves.toEqual(cachedPuzzle);
        await client.getPuzzle("2026-07-23");
        expect(fetchMock).toHaveBeenCalledOnce();

        await client.getPuzzle("2026-07-23", { forceRefresh: true });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock).toHaveBeenLastCalledWith(
            "https://www.nytimes.com/svc/wordle/v2/2026-07-23.json",
            expect.objectContaining({ headers: { accept: "application/json" } }),
        );
    });

    it("잘못된 응답 형식과 요청 날짜 불일치를 거부합니다", async () => {
        const invalidClient = new NytWordleClient(
            vi
                .fn<typeof fetch>()
                .mockResolvedValue(new Response(JSON.stringify({ solution: "too-long" }))),
        );
        const wrongDateClient = new NytWordleClient(
            vi
                .fn<typeof fetch>()
                .mockResolvedValue(createNytResponse({ print_date: "2026-07-22" })),
        );

        await expect(invalidClient.getPuzzle("2026-07-23")).rejects.toBeInstanceOf(
            NytWordleServiceError,
        );
        await expect(wrongDateClient.getPuzzle("2026-07-23")).rejects.toThrow(
            "NYT Wordle 응답 날짜가 요청한 날짜와 다릅니다.",
        );
    });
});

describe("Wordle 퍼즐 캐시", () => {
    it("갱신 전처리와 완료 리스너를 순서대로 실행하고 결과를 캐시합니다", async () => {
        const callOrder: string[] = [];
        const getPuzzle = vi.fn(() => {
            callOrder.push("request");
            return Promise.resolve(cachedPuzzle);
        });
        const cache = new WordlePuzzleCache({ getPuzzle });
        const now = new Date("2026-07-22T15:30:00.000Z");

        cache.addBeforeRefreshListener((printDate) => {
            callOrder.push(`before:${printDate}`);
        });
        cache.addRefreshListener((puzzle) => {
            callOrder.push(`after:${puzzle.printDate}`);
        });

        await expect(cache.refresh(now)).resolves.toEqual(cachedPuzzle);

        expect(cache.getTodaysPuzzle(now)).toEqual(cachedPuzzle);
        expect(getPuzzle).toHaveBeenCalledWith("2026-07-23", { forceRefresh: true });
        expect(callOrder).toEqual(["before:2026-07-23", "request", "after:2026-07-23"]);
    });

    it("날짜 전환 테스트는 전날 상태를 준비한 뒤 오늘 퍼즐을 적용합니다", async () => {
        const previousPuzzle: WordlePuzzle = {
            ...cachedPuzzle,
            id: 41,
            printDate: "2026-07-22",
            puzzleNumber: 1889,
            solution: "slate",
        };
        const cache = new WordlePuzzleCache({
            getPuzzle: vi.fn().mockResolvedValue(cachedPuzzle),
        });
        const prepareDateChange = vi.fn();
        const refreshListener = vi.fn(() => {
            expect(prepareDateChange).toHaveBeenCalledOnce();
        });

        cache.addRefreshListener(refreshListener);

        await expect(
            cache.refreshForDateChangeTest(
                previousPuzzle,
                prepareDateChange,
                new Date("2026-07-22T15:30:00.000Z"),
            ),
        ).resolves.toEqual(cachedPuzzle);
        expect(refreshListener).toHaveBeenCalledWith(cachedPuzzle);
    });

    it("다른 날짜의 캐시는 반환하지 않고 다음 서울 자정까지 시간을 계산합니다", async () => {
        const cache = new WordlePuzzleCache({
            getPuzzle: vi.fn().mockResolvedValue(cachedPuzzle),
        });

        await cache.refresh(new Date("2026-07-22T15:30:00.000Z"));

        expect(() => cache.getTodaysPuzzle(new Date("2026-07-23T15:30:00.000Z"))).toThrow(
            WordlePuzzleUnavailableError,
        );
        expect(
            getMillisecondsUntilNextDateInTimeZone(
                new Date("2026-07-22T14:59:59.500Z"),
                "Asia/Seoul",
            ),
        ).toBe(500);
    });

    it("서울 자정부터 10분 동안 매분 퍼즐을 갱신합니다", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-07-22T14:59:59.000Z"));

        const getPuzzle = vi.fn().mockResolvedValue(cachedPuzzle);
        const cache = new WordlePuzzleCache({ getPuzzle }, "Asia/Seoul", 0);

        cache.startDailyRefresh();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(getPuzzle).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(600_000);
        expect(getPuzzle).toHaveBeenCalledTimes(11);

        await cache.stopRefreshes();
    });

    it("종료할 때 이미 시작된 예약 갱신이 끝날 때까지 기다립니다", async () => {
        vi.useFakeTimers();

        let finishRefresh: ((puzzle: WordlePuzzle) => void) | undefined;
        const request = new Promise<WordlePuzzle>((resolve) => {
            finishRefresh = resolve;
        });
        const cache = new WordlePuzzleCache({ getPuzzle: vi.fn().mockReturnValue(request) });
        let stopped = false;

        cache.startStartupRefresh();
        await vi.advanceTimersByTimeAsync(0);

        const stopping = cache.stopRefreshes().then(() => {
            stopped = true;
        });
        await Promise.resolve();
        expect(stopped).toBe(false);

        finishRefresh?.(cachedPuzzle);
        await stopping;
        expect(stopped).toBe(true);
    });
});

describe("로컬 영어 사전", () => {
    it("포함된 5글자 영단어만 허용합니다", () => {
        const dictionary = new LocalDictionary();

        expect(dictionary.isEnglishWord("crane")).toBe(true);
        expect(dictionary.isEnglishWord("aapas")).toBe(true);
        expect(dictionary.isEnglishWord("zzzzz")).toBe(false);
        expect(dictionary.isEnglishWord("cranes")).toBe(false);
    });
});
