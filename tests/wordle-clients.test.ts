import { describe, expect, it, vi } from "vitest";

import {
    DictionaryClient,
    DictionaryServiceError,
} from "../src/features/wordle/dictionary-client.js";
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

describe("영어 사전 클라이언트", () => {
    it("사전에 있는 단어를 확인하고 결과를 캐시합니다", async () => {
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockResolvedValue(new Response(JSON.stringify([{ word: "crane" }]), { status: 200 }));
        const client = new DictionaryClient(fetchMock);

        await expect(client.isEnglishWord("crane")).resolves.toBe(true);
        await expect(client.isEnglishWord("crane")).resolves.toBe(true);

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("사전의 404 응답은 존재하지 않는 단어로 처리합니다", async () => {
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockResolvedValue(new Response(null, { status: 404 }));
        const client = new DictionaryClient(fetchMock);

        await expect(client.isEnglishWord("zzzzz")).resolves.toBe(false);
    });

    it("사전 장애를 존재하지 않는 단어로 오인하지 않습니다", async () => {
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockResolvedValue(new Response(null, { status: 503 }));
        const client = new DictionaryClient(fetchMock);

        await expect(client.isEnglishWord("crane")).rejects.toBeInstanceOf(DictionaryServiceError);
    });
});
