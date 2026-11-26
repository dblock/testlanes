import js from "@eslint/js";
import markdown from "@eslint/markdown";
import globals from "globals";

export default [
  {
    ignores: ["coverage/**", "types/**"],
  },
  {
    ...js.configs.recommended,
    files: ["**/*.js"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Jest fixtures are CommonJS test files that use Jest's globals.
    files: ["fixtures/jest/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.jest,
    },
  },
  {
    files: ["*.md"],
    plugins: { markdown },
    processor: "markdown/markdown",
  },
  {
    // Documentation examples are standalone excerpts.
    files: ["**/*.md/*.js"],
    rules: {
      "no-unused-vars": "off",
    },
  },
];
