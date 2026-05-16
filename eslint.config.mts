import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";
import js from "@eslint/js";

const rawObsidianConfig = obsidianmd.configs.recommended;
let obsRules = {};
if (rawObsidianConfig && Array.isArray(rawObsidianConfig)) {
  for (const config of rawObsidianConfig) {
      if (config.rules) {
          obsRules = { ...obsRules, ...config.rules };
      }
  }
} else if (rawObsidianConfig && rawObsidianConfig.rules) {
  obsRules = { ...rawObsidianConfig.rules };
}
delete obsRules["obsidianmd/commands/no-command-in-command-id"];

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "main.js",
      "versions.json",
      "esbuild.config.mjs",
      "version-bump.mjs",
      "eslint.config.mts"
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    plugins: {
      obsidianmd
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    files: ["src/**/*.ts", "main.ts"],
    rules: {
      ...obsRules,
      "obsidianmd/no-static-styles-assignment": "off",
      "obsidianmd/ui/sentence-case": "off",
      "no-console": "off",
    }
  }
);
