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
});
