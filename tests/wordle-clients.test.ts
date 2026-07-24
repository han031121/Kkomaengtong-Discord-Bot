import { describe, expect, it, vi } from "vitest";

import { LocalDictionary } from "../src/features/wordle/local-dictionary.js";
import {
    formatDateInTimeZone,
    NytWordleClient,
    NytWordleServiceError,
} from "../src/features/wordle/nyt-wordle-client.js";

describe("NYT Wordle 클라이언트", () => {
    it("서울 날짜를 YYYY-MM-DD 형식으로 계산합니다", () => {
        const date = new Date("2026-07-22T15:30:00.000Z");

        expect(formatDateInTimeZone(date, "Asia/Seoul")).toBe("2026-07-23");
        expect(formatDateInTimeZone(date, "America/New_York")).toBe("2026-07-22");
    });

    it("NYT 응답을 게임 퍼즐로 변환하고 같은 날짜는 캐시합니다", async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({
                    id: 42,
                    solution: "CRANE",
                    print_date: "2026-07-23",
                    days_since_launch: 1890,
                    editor: "Wordle Editor",
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            ),
        );
        const client = new NytWordleClient(fetchMock);

        await expect(client.getPuzzle("2026-07-23")).resolves.toEqual({
            id: 42,
            solution: "crane",
            printDate: "2026-07-23",
            puzzleNumber: 1890,
        });
        await client.getPuzzle("2026-07-23");

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://www.nytimes.com/svc/wordle/v2/2026-07-23.json",
            expect.objectContaining({ headers: { accept: "application/json" } }),
        );
    });

    it("예상과 다른 NYT 응답을 서비스 오류로 처리합니다", async () => {
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockResolvedValue(new Response(JSON.stringify({ solution: "too-long" })));
        const client = new NytWordleClient(fetchMock);

        await expect(client.getPuzzle("2026-07-23")).rejects.toBeInstanceOf(NytWordleServiceError);
    });

    it("요청과 날짜가 다른 NYT 응답을 거부합니다", async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({
                    id: 42,
                    solution: "crane",
                    print_date: "2026-07-22",
                    days_since_launch: 1889,
                }),
            ),
        );
        const client = new NytWordleClient(fetchMock);

        await expect(client.getPuzzle("2026-07-23")).rejects.toThrow(
            "NYT Wordle 응답 날짜가 요청한 날짜와 다릅니다.",
        );
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
