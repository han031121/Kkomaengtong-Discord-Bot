import { ApplicationCommandOptionType } from "discord.js";
import { describe, expect, it } from "vitest";

import { commands, createCommands } from "../src/commands/index.js";
import type { BotCommand } from "../src/types/command.js";

function getCommand(name: string, commandList: readonly BotCommand[] = commands) {
    const command = commandList.find((candidate) => candidate.data.name === name);

    if (command === undefined) {
        throw new Error(`${name} 명령어가 등록되지 않았습니다.`);
    }

    return command.data.toJSON();
}

describe("슬래시 명령어 정의", () => {
    it("명령어 이름이 중복되지 않습니다", () => {
        const names = commands.map((command) => command.data.name);

        expect(new Set(names).size).toBe(names.length);
    });

    it("모든 명령어가 Discord API 형식으로 변환됩니다", () => {
        for (const command of commands) {
            const commandData = command.data.toJSON();

            expect(commandData.name).toBe(command.data.name);
            expect(commandData.description).toBeTypeOf("string");
        }
    });

    it("테스트 명령어는 다섯 선택지가 있는 필수 옵션을 사용합니다", () => {
        const commandData = getCommand("테스트");

        expect(commandData.name).toBe("테스트");
        expect(commandData.options).toEqual([
            {
                type: ApplicationCommandOptionType.String,
                name: "기능",
                description: "실행할 테스트 기능을 선택합니다.",
                required: true,
                choices: [
                    { name: "핑", value: "ping" },
                    { name: "서버", value: "server" },
                    { name: "사용자", value: "user" },
                    { name: "도움말", value: "help" },
                    { name: "인사", value: "greeting" },
                ],
            },
        ]);
    });

    it("메인 봇의 Wordle 명령어는 일반 기능 네 개만 사용합니다", () => {
        const commandData = getCommand("워들", createCommands(false));

        expect(commandData.options?.map((option) => option.name)).toEqual([
            "플레이",
            "입력",
            "점수판",
            "기록",
        ]);
        expect(commandData.dm_permission).toBe(false);
    });

    it("개발용 봇의 Wordle 명령어에는 테스트 기능 두 개를 추가합니다", () => {
        const developmentCommands = createCommands(true);
        const commandData = getCommand("워들", developmentCommands);

        expect(commandData.options).toEqual([
            {
                type: ApplicationCommandOptionType.Subcommand,
                name: "플레이",
                description: "오늘의 Wordle 플레이 화면을 표시합니다.",
                options: [],
            },
            {
                type: ApplicationCommandOptionType.Subcommand,
                name: "입력",
                description: "모달 없이 단어를 입력하고 플레이 화면을 표시합니다.",
                options: [
                    {
                        type: ApplicationCommandOptionType.String,
                        name: "단어",
                        description: "바로 제출할 5글자 영단어",
                        required: true,
                        min_length: 5,
                        max_length: 5,
                    },
                ],
            },
            {
                type: ApplicationCommandOptionType.Subcommand,
                name: "점수판",
                description: "오늘의 Wordle 점수판을 표시합니다.",
                options: [],
            },
            {
                type: ApplicationCommandOptionType.Subcommand,
                name: "기록",
                description: "다양한 Wordle 기록을 표시합니다.",
                options: [],
            },
            {
                type: ApplicationCommandOptionType.Subcommand,
                name: "갱신_test",
                description: "오늘의 Wordle 정답 캐시를 강제로 갱신합니다.",
                options: [],
            },
            {
                type: ApplicationCommandOptionType.Subcommand,
                name: "어제기록_test",
                description: "어제의 Wordle 기록판을 테스트합니다.",
                options: [],
            },
        ]);
        expect(commandData.dm_permission).toBe(false);
        expect(developmentCommands.map((command) => command.data.name)).not.toContain(
            "워들갱신_test",
        );
        expect(developmentCommands.map((command) => command.data.name)).not.toContain(
            "어제워들_test",
        );
    });
});
