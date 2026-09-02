import { ApplicationCommandOptionType, Events, SlashCommandBuilder } from "discord.js";
import type { Interaction } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import { collectCommandData, createFeatureRegistrations } from "../src/app/feature-registry.js";
import type { BotCommand, BotCommandData, BotModule } from "../src/bot/contracts.js";
import { createClient, startBotModules, stopBot } from "../src/bot/create-client.js";

function createCommand(
    name: string,
    execute = vi.fn<BotCommand["execute"]>().mockResolvedValue(undefined),
): BotCommand {
    return {
        data: new SlashCommandBuilder().setName(name).setDescription(`${name} 명령어`),
        execute,
    };
}

function createModule(name: string, commands: readonly BotCommand[] = []): BotModule {
    return { name, commands };
}

function createCommandData(enableTestCommands = false): readonly BotCommandData[] {
    return collectCommandData(
        createFeatureRegistrations({
            enableTestCommands,
            wordleDatabasePath: ":memory:",
        }),
    );
}

function getCommandData(name: string, commands: readonly BotCommandData[]) {
    const command = commands.find((candidate) => candidate.name === name);

    if (command === undefined) {
        throw new Error(`${name} 명령어가 등록되지 않았습니다.`);
    }

    return command.toJSON();
}

describe("봇 기능 모듈", () => {
    it("슬래시 명령과 그 외 인터랙션을 주입된 기능에 라우팅합니다", async () => {
        const execute = vi.fn<BotCommand["execute"]>().mockResolvedValue(undefined);
        const firstHandler = vi.fn().mockResolvedValue(false);
        const secondHandler = vi.fn().mockResolvedValue(true);
        const modules: readonly BotModule[] = [
            {
                ...createModule("first", [createCommand("sample", execute)]),
                handleInteraction: firstHandler,
            },
            { ...createModule("second"), handleInteraction: secondHandler },
        ];
        const client = createClient(modules);
        const commandInteraction = {
            commandName: "sample",
            isChatInputCommand: () => true,
        } as unknown as Interaction;
        const componentInteraction = {
            isChatInputCommand: () => false,
        } as unknown as Interaction;

        client.emit(Events.InteractionCreate, commandInteraction);
        client.emit(Events.InteractionCreate, componentInteraction);

        await vi.waitFor(() => {
            expect(execute).toHaveBeenCalledWith(commandInteraction);
            expect(firstHandler).toHaveBeenCalledWith(componentInteraction);
            expect(secondHandler).toHaveBeenCalledWith(componentInteraction);
        });
        await stopBot(client, modules);
    });

    it("모듈과 명령 이름의 중복을 거부합니다", () => {
        expect(() => createClient([createModule("same"), createModule("same")])).toThrow(
            "중복된 봇 모듈 이름입니다: same",
        );
        expect(() =>
            createClient([
                createModule("first", [createCommand("same")]),
                createModule("second", [createCommand("same")]),
            ]),
        ).toThrow("중복된 명령어 이름입니다: same");
    });

    it("등록 순서로 시작하고 역순으로 종료합니다", async () => {
        const calls: string[] = [];
        const modules: readonly BotModule[] = [
            {
                ...createModule("first"),
                start: () => {
                    calls.push("start:first");
                },
                stop: () => {
                    calls.push("stop:first");
                },
            },
            {
                ...createModule("second"),
                start: () => {
                    calls.push("start:second");
                },
                stop: () => {
                    calls.push("stop:second");
                },
            },
        ];
        const client = createClient(modules);

        await startBotModules(modules, client);
        await stopBot(client, modules);

        expect(calls).toEqual(["start:first", "start:second", "stop:second", "stop:first"]);
    });

    it("진행 중인 인터랙션이 끝난 뒤 클라이언트와 모듈을 종료합니다", async () => {
        let finishExecution: (() => void) | undefined;
        const execution = new Promise<void>((resolve) => {
            finishExecution = resolve;
        });
        const execute = vi.fn<BotCommand["execute"]>().mockReturnValue(execution);
        const calls: string[] = [];
        const modules: readonly BotModule[] = [
            {
                ...createModule("sample", [createCommand("sample", execute)]),
                stop: () => {
                    calls.push("stop");
                },
            },
        ];
        const client = createClient(modules);
        const destroy = vi.spyOn(client, "destroy").mockImplementation(() => {
            calls.push("destroy");
            return Promise.resolve();
        });
        const interaction = {
            commandName: "sample",
            isChatInputCommand: () => true,
        } as unknown as Interaction;

        client.emit(Events.InteractionCreate, interaction);
        await vi.waitFor(() => {
            expect(execute).toHaveBeenCalledOnce();
        });

        const stopping = stopBot(client, modules);
        await Promise.resolve();
        expect(calls).toEqual([]);

        finishExecution?.();
        await stopping;

        expect(calls).toEqual(["destroy", "stop"]);
        expect(destroy).toHaveBeenCalledOnce();

        client.emit(Events.InteractionCreate, interaction);
        expect(execute).toHaveBeenCalledOnce();
    });
});

describe("기능 레지스트리", () => {
    it("중복 없이 직렬화 가능한 명령 정의를 제공합니다", () => {
        const commands = createCommandData();
        const names = commands.map((command) => command.name);
        const testCommand = getCommandData("테스트", commands);

        expect(new Set(names).size).toBe(names.length);
        expect(commands.every((command) => command.toJSON().description.length > 0)).toBe(true);
        expect(testCommand.options).toHaveLength(1);
        expect(testCommand.options?.[0]).toMatchObject({
            type: ApplicationCommandOptionType.String,
            name: "기능",
            required: true,
        });
        expect(JSON.stringify(testCommand.options?.[0])).toContain(
            JSON.stringify({ name: "핑", value: "ping" }),
        );
        expect(JSON.stringify(testCommand.options?.[0])).toContain(
            JSON.stringify({ name: "인사", value: "greeting" }),
        );
    });

    it("운영과 개발 환경에 맞는 Wordle 서브커맨드를 제공합니다", () => {
        const production = getCommandData("워들", createCommandData(false));
        const development = getCommandData("워들", createCommandData(true));

        expect(production.options?.map((option) => option.name)).toEqual([
            "플레이",
            "공유",
            "입력",
            "점수판",
            "통계",
        ]);
        expect(development.options?.map((option) => option.name)).toEqual([
            "플레이",
            "공유",
            "입력",
            "점수판",
            "통계",
            "갱신_test",
            "어제기록_test",
        ]);
        expect(production.dm_permission).toBe(false);
        expect(development.dm_permission).toBe(false);
    });
});
