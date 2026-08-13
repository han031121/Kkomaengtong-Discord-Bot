import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { WordleDataStore } from "../features/wordle/data-store.js";
import { formatDateInTimeZone } from "../features/wordle/nyt-wordle-client.js";

const WORDLE_TIME_ZONE = "Asia/Seoul";
const DEFAULT_DATABASE_PATH = "data/wordle.sqlite";

function printHelp(): void {
    console.log(`Wordle 게임 기록을 초기화하고 오늘 완료된 결과를 다시 반영합니다.

스포일러 사용 횟수와 사전 미등록 단어 입력 횟수는 보존합니다.

사용법:
    npm run reset:wordle-records -- --confirm-reset [--database-path <경로>]

옵션:
    --confirm-reset          초기화 실행을 확인합니다. 실제 실행 시 반드시 필요합니다.
    --database-path <경로>  초기화할 SQLite 파일입니다.
                            생략하면 WORDLE_DATABASE_PATH 또는 ${DEFAULT_DATABASE_PATH}를 사용합니다.
    -h, --help              도움말을 표시합니다.

초기화 전에 봇 프로세스를 중지해야 합니다.`);
}

function getDatabasePath(databasePathOption: string | undefined): string {
    const configuredPath =
        databasePathOption ?? process.env.WORDLE_DATABASE_PATH ?? DEFAULT_DATABASE_PATH;

    if (configuredPath.trim() === "" || configuredPath === ":memory:") {
        throw new Error("초기화할 SQLite 파일 경로를 올바르게 지정해 주세요.");
    }

    const databasePath = resolve(configuredPath);

    if (!existsSync(databasePath)) {
        throw new Error(`Wordle SQLite 파일을 찾을 수 없습니다: ${databasePath}`);
    }

    return databasePath;
}

function resetWordleRecords(): void {
    const { values } = parseArgs({
        allowPositionals: false,
        options: {
            "confirm-reset": {
                type: "boolean",
            },
            "database-path": {
                type: "string",
            },
            help: {
                short: "h",
                type: "boolean",
            },
        },
        strict: true,
    });

    if (values.help === true) {
        printHelp();
        return;
    }

    if (values["confirm-reset"] !== true) {
        throw new Error("초기화를 실행하려면 --confirm-reset 옵션이 필요합니다.");
    }

    const databasePath = getDatabasePath(values["database-path"]);
    const now = new Date();
    const printDate = formatDateInTimeZone(now, WORDLE_TIME_ZONE);
    const store = new WordleDataStore({ databasePath });

    try {
        const result = store.resetGameRecordsForDate(printDate);

        console.log("Wordle 게임 기록 초기화를 완료했습니다.");
        console.log(`SQLite 파일: ${databasePath}`);
        console.log(`다시 반영한 날짜: ${result.printDate}`);
        console.log(`완료 결과: ${result.reappliedResultCount}건`);
        console.log(`서버 참여 관계: ${result.reappliedParticipantCount}건`);
        console.log("찐스포·짭스포와 사전 미등록 단어 입력 횟수는 기존 값을 보존했습니다.");
    } finally {
        store.close();
    }
}

try {
    resetWordleRecords();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`Wordle 기록 테이블 초기화에 실패했습니다: ${message}`);
    process.exitCode = 1;
}
