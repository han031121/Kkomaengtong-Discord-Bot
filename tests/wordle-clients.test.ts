import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalDictionary } from "../src/features/wordle/local-dictionary.js";
import {
    formatDateInTimeZone,
    NytWordleClient,
    NytWordleServiceError,
} from "../src/features/wordle/nyt-wordle-client.js";
import {
    getMillisecondsUntilNextDateInTimeZone,
    WordlePuzzleCache,
    WordlePuzzleUnavailableError,
} from "../src/features/wordle/puzzle-cache.js";

const nytResponse = {
    days_since_launch: 1890,
    id: 42,
    print_date: "2026-07-23",
    solution: "CRANE",
};
const cachedPuzzle = {
    id: 42,
    printDate: "2026-07-23",
    puzzleNumber: 1890,
    solution: "crane",
};

function createNytResponse(overrides: Partial<typeof nytResponse> = {}, status = 200): Response {
    return new Response(JSON.stringify({ ...nytResponse, ...overrides }), {
        headers: { "content-type": "application/json" },
        status,
    });
}

afterEach(() => {
    vi.useRealTimers();
});

describe("NYT Wordle 클라이언트", () => {
    it("서울 날짜를 YYYY-MM-DD 형식으로 계산합니다", () => {
        const date = new Date("2026-07-22T15:30:00.000Z");

        expect(formatDateInTimeZone(date, "Asia/Seoul")).toBe("2026-07-23");
        expect(formatDateInTimeZone(date, "America/New_York")).toBe("2026-07-22");
    });

    it("NYT 응답을 게임 퍼즐로 변환하고 같은 날짜는 캐시합니다", async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(createNytResponse());
        const client = new NytWordleClient(fetchMock);

        await expect(client.getPuzzle("2026-07-23")).resolves.toEqual(cachedPuzzle);
        await client.getPuzzle("2026-07-23");

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://www.nytimes.com/svc/wordle/v2/2026-07-23.json",
            expect.objectContaining({ headers: { accept: "application/json" } }),
        );
    });

    it("강제 갱신은 같은 날짜 캐시를 우회합니다", async () => {
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockImplementation(() => Promise.resolve(createNytResponse()));
        const client = new NytWordleClient(fetchMock);

        await client.getPuzzle("2026-07-23", { forceRefresh: true });
        await client.getPuzzle("2026-07-23", { forceRefresh: true });

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("예상과 다른 NYT 응답을 서비스 오류로 처리합니다", async () => {
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockResolvedValue(new Response(JSON.stringify({ solution: "too-long" })));
        const client = new NytWordleClient(fetchMock);

        await expect(client.getPuzzle("2026-07-23")).rejects.toBeInstanceOf(NytWordleServiceError);
    });

    it("요청과 날짜가 다른 NYT 응답을 거부합니다", async () => {
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockResolvedValue(createNytResponse({ print_date: "2026-07-22" }));
        const client = new NytWordleClient(fetchMock);

        await expect(client.getPuzzle("2026-07-23")).rejects.toThrow(
            "NYT Wordle 응답 날짜가 요청한 날짜와 다릅니다.",
        );
    });
});

describe("Wordle 퍼즐 캐시", () => {
    it("refresh 때만 클라이언트를 호출하고 조회는 캐시만 읽습니다", async () => {
        const getPuzzle = vi.fn().mockResolvedValue(cachedPuzzle);
        const cache = new WordlePuzzleCache({ getPuzzle });

        await expect(cache.refresh(new Date("2026-07-22T15:30:00.000Z"))).resolves.toEqual(
            cachedPuzzle,
        );
        expect(cache.getTodaysPuzzle(new Date("2026-07-22T15:30:00.000Z"))).toEqual(cachedPuzzle);

        expect(getPuzzle).toHaveBeenCalledOnce();
        expect(getPuzzle).toHaveBeenCalledWith("2026-07-23", { forceRefresh: true });
    });

    it("퍼즐 갱신 성공을 등록된 저장 리스너에 전달합니다", async () => {
        const getPuzzle = vi.fn().mockResolvedValue(cachedPuzzle);
        const refreshListener = vi.fn();
        const cache = new WordlePuzzleCache({ getPuzzle });
        const removeListener = cache.addRefreshListener(refreshListener);

        await cache.refresh(new Date("2026-07-22T15:30:00.000Z"));
        removeListener();
        await cache.refresh(new Date("2026-07-22T15:30:00.000Z"));

        expect(refreshListener).toHaveBeenCalledOnce();
        expect(refreshListener).toHaveBeenCalledWith(cachedPuzzle);
    });

    it("캐시된 퍼즐 날짜가 오늘과 다르면 준비되지 않은 상태로 처리합니다", async () => {
        const getPuzzle = vi.fn().mockResolvedValue(cachedPuzzle);
        const cache = new WordlePuzzleCache({ getPuzzle });

        await cache.refresh(new Date("2026-07-22T15:30:00.000Z"));

        expect(() => cache.getTodaysPuzzle(new Date("2026-07-23T15:30:00.000Z"))).toThrow(
            WordlePuzzleUnavailableError,
        );
        expect(getPuzzle).toHaveBeenCalledOnce();
    });

    it("서울 기준 다음 날짜 변경까지 남은 시간을 계산합니다", () => {
        const delayMs = getMillisecondsUntilNextDateInTimeZone(
            new Date("2026-07-22T14:59:59.500Z"),
            "Asia/Seoul",
        );

        expect(delayMs).toBe(500);
    });

    it("일일 갱신은 서울 자정부터 00시 10분까지 매분 클라이언트를 강제 호출합니다", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-07-22T14:59:59.000Z"));

        const getPuzzle = vi.fn().mockResolvedValue(cachedPuzzle);
        const cache = new WordlePuzzleCache({ getPuzzle }, "Asia/Seoul", 0);

        cache.startDailyRefresh();
        await vi.advanceTimersByTimeAsync(999);

        expect(getPuzzle).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);

        expect(getPuzzle).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(600_000);

        expect(getPuzzle).toHaveBeenCalledTimes(11);
        expect(getPuzzle).toHaveBeenLastCalledWith("2026-07-23", { forceRefresh: true });

        cache.stopRefreshes();
    });

    it("부팅 갱신은 시작 직후부터 10분 동안 매분 클라이언트를 강제 호출합니다", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-07-23T03:45:00.000Z"));

        const getPuzzle = vi.fn().mockResolvedValue(cachedPuzzle);
        const cache = new WordlePuzzleCache({ getPuzzle }, "Asia/Seoul", 0);

        cache.startStartupRefresh();
        await vi.advanceTimersByTimeAsync(0);

        expect(getPuzzle).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(600_000);

        expect(getPuzzle).toHaveBeenCalledTimes(11);
        expect(getPuzzle).toHaveBeenLastCalledWith("2026-07-23", { forceRefresh: true });

        cache.stopRefreshes();
    });
});

describe("로컬 영어 사전", () => {
    it("로컬 단어 목록에 있는 5글자 영단어를 확인합니다", () => {
        const dictionary = new LocalDictionary();

        expect(dictionary.isEnglishWord("crane")).toBe(true);
        expect(dictionary.isEnglishWord("apple")).toBe(true);
        expect(dictionary.isEnglishWord("aapas")).toBe(true);
    });

    it("로컬 단어 목록에 없는 입력을 거부합니다", () => {
        const dictionary = new LocalDictionary();

        expect(dictionary.isEnglishWord("zzzzz")).toBe(false);
        expect(dictionary.isEnglishWord("cranes")).toBe(false);
    });
});
