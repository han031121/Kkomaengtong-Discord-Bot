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
                projectService: {
                    allowDefaultProject: ["tests/*.ts"],
                },
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
);
