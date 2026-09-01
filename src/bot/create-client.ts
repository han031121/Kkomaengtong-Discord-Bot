import { Client, Collection, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import type { Interaction, RepliableInteraction } from "discord.js";

import type { BotCommand, BotModule } from "./contracts.js";

interface InteractionRouterState {
    readonly activeTasks: Set<Promise<void>>;
    readonly listener: (interaction: Interaction) => void;
    stopPromise?: Promise<void>;
}

const interactionRouters = new WeakMap<Client, InteractionRouterState>();

export function createClient(modules: readonly BotModule[]): Client {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    const commandMap = createCommandMap(modules);

    client.once(Events.ClientReady, (readyClient) => {
        console.log(`${readyClient.user.tag}(으)로 로그인했습니다.`);
    });

    const activeTasks = new Set<Promise<void>>();
    const listener = (interaction: Interaction): void => {
        const task = routeInteraction(interaction, commandMap, modules)
            .catch((error: unknown) => {
                console.error("인터랙션 라우팅을 완료하지 못했습니다.", error);
            })
            .finally(() => {
                activeTasks.delete(task);
            });

        activeTasks.add(task);
    };

    client.on(Events.InteractionCreate, listener);
    interactionRouters.set(client, { activeTasks, listener });

    return client;
}

export async function startBotModules(
    modules: readonly BotModule[],
    client: Client,
): Promise<void> {
    for (const module of modules) {
        await module.start?.(client);
    }
}

export async function stopBotModules(modules: readonly BotModule[]): Promise<void> {
    const errors: unknown[] = [];

    for (const module of [...modules].reverse()) {
        try {
            await module.stop?.();
        } catch (error) {
            errors.push(error);
        }
    }

    if (errors.length > 0) {
        throw new AggregateError(errors, "봇 기능 모듈을 종료하는 중 오류가 발생했습니다.");
    }
}

export async function stopBot(client: Client, modules: readonly BotModule[]): Promise<void> {
    const errors: unknown[] = [];

    try {
        await stopInteractionRouting(client);
    } catch (error) {
        errors.push(error);
    }

    try {
        await client.destroy();
    } catch (error) {
        errors.push(error);
    }

    try {
        await stopBotModules(modules);
    } catch (error) {
        errors.push(error);
    }

    if (errors.length > 0) {
        throw new AggregateError(errors, "봇을 종료하는 중 오류가 발생했습니다.");
    }
}

async function stopInteractionRouting(client: Client): Promise<void> {
    const router = interactionRouters.get(client);

    if (router === undefined) {
        return;
    }

    router.stopPromise ??= drainInteractionRouter(client, router);
    await router.stopPromise;
}

async function drainInteractionRouter(
    client: Client,
    router: InteractionRouterState,
): Promise<void> {
    client.off(Events.InteractionCreate, router.listener);
    await Promise.all(router.activeTasks);
    interactionRouters.delete(client);
}

function createCommandMap(modules: readonly BotModule[]): Collection<string, BotCommand> {
    const moduleNames = new Set<string>();
    const commandMap = new Collection<string, BotCommand>();

    for (const module of modules) {
        if (moduleNames.has(module.name)) {
            throw new Error(`중복된 봇 모듈 이름입니다: ${module.name}`);
        }

        moduleNames.add(module.name);

        for (const command of module.commands) {
            const commandName = command.data.name;

            if (commandMap.has(commandName)) {
                throw new Error(`중복된 명령어 이름입니다: ${commandName}`);
            }

            commandMap.set(commandName, command);
        }
    }

    return commandMap;
}

async function routeInteraction(
    interaction: Interaction,
    commandMap: ReadonlyMap<string, BotCommand>,
    modules: readonly BotModule[],
): Promise<void> {
    if (interaction.isChatInputCommand()) {
        const command = commandMap.get(interaction.commandName);

        if (command === undefined) {
            console.warn(`등록되지 않은 명령어 요청: ${interaction.commandName}`);
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(`명령어 실행 실패: ${interaction.commandName}`, error);
            await sendErrorResponse(interaction);
        }

        return;
    }

    for (const module of modules) {
        if (module.handleInteraction === undefined) {
            continue;
        }

        try {
            if (await module.handleInteraction(interaction)) {
                return;
            }
        } catch (error) {
            console.error(`인터랙션 처리 실패: ${module.name}`, error);

            if (interaction.isRepliable()) {
                await sendErrorResponse(interaction);
            }

            return;
        }
    }
}

async function sendErrorResponse(interaction: RepliableInteraction): Promise<void> {
    const response = {
        content: "요청을 처리하는 중 오류가 발생했습니다.",
        flags: MessageFlags.Ephemeral,
    } as const;

    if (interaction.deferred) {
        await interaction.editReply({ content: response.content });
    } else if (interaction.replied) {
        await interaction.followUp(response);
    } else {
        await interaction.reply(response);
    }
}
