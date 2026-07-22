import { ApplicationCommandOptionType } from "discord.js";
import { describe, expect, it } from "vitest";

import { commands } from "../src/commands/index.js";

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
        const [command] = commands;

        expect(command).toBeDefined();

        if (command === undefined) {
            throw new Error("테스트 명령어가 등록되지 않았습니다.");
        }

        const commandData = command.data.toJSON();

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
});
