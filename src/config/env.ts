import "dotenv/config";

import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/, "Discord ID 형식이 올바르지 않습니다.");

const envSchema = z.object({
    DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN이 필요합니다."),
    DISCORD_CLIENT_ID: snowflake,
    DISCORD_GUILD_ID: z.preprocess(
        (value) => (value === "" ? undefined : value),
        snowflake.optional(),
    ),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
    console.error("환경 변수 설정을 확인해 주세요.");
    console.error(z.prettifyError(parsedEnv.error));
    process.exit(1);
}

export const env = {
    discordToken: parsedEnv.data.DISCORD_TOKEN,
    discordClientId: parsedEnv.data.DISCORD_CLIENT_ID,
    discordGuildId: parsedEnv.data.DISCORD_GUILD_ID,
};
