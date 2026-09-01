import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const typescriptRules = tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts"],
}));

export default tseslint.config(
    {
        ignores: ["coverage", "dist", "node_modules"],
    },
    {
        ...eslint.configs.recommended,
        files: ["**/*.js"],
    },
    ...typescriptRules,
    {
        files: ["**/*.ts"],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            "@typescript-eslint/consistent-type-imports": "error",
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/no-misused-promises": "error",
            eqeqeq: ["error", "always"],
        },
    },
    {
        files: ["src/features/*/domain/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: [
                                "**/application/**",
                                "**/infrastructure/**",
                                "**/commands/**",
                                "**/bot/**",
                                "**/app/**",
                            ],
                            message: "도메인 계층은 다른 애플리케이션 계층에 의존할 수 없습니다.",
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ["src/features/*/application/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: [
                                "**/infrastructure/**",
                                "**/presentation/**",
                                "**/bot/**",
                                "**/app/**",
                            ],
                            message:
                                "애플리케이션 계층은 인프라 또는 표현 계층에 의존할 수 없습니다.",
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ["src/features/*/infrastructure/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["**/presentation/**", "**/bot/**", "**/app/**"],
                            message: "인프라 계층은 표현 계층에 의존할 수 없습니다.",
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ["src/bot/**/*.ts", "src/infrastructure/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["**/features/**"],
                            message: "공통 봇 및 인프라 코드는 개별 기능에 의존할 수 없습니다.",
                        },
                    ],
                },
            ],
        },
    },
);
