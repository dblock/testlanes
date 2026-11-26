import markdown from "@eslint/markdown";
import preferences from "eslint-plugin-markdown-preferences";
import paragraph from "eslint-plugin-markdown-preferences-paragraph";
import proseSpellcheck from "eslint-plugin-prose-spellcheck";

export default [
  {
    files: ["*.md"],
    plugins: {
      markdown,
      "markdown-preferences": preferences,
      paragraph,
      "prose-spellcheck": proseSpellcheck,
    },
    language: "markdown/gfm",
    rules: {
      ...markdown.configs.recommended[0].rules,
      ...preferences.configs.standard.rules,
      "markdown/no-duplicate-headings": "error",
      "markdown/no-bare-urls": "error",
      "markdown/no-html": ["error", { allowed: ["img"] }],
      "markdown-preferences/no-heading-trailing-punctuation": "error",
      // Tables are left unaligned so rows stay readable in diffs.
      "markdown-preferences/table-pipe-alignment": "off",
      "markdown-preferences/heading-casing": ["error", {
        style: "Title Case",
        preserveWords: ["testlanes", "Vitest", "Jest", "GitHub", "CI", "npm", "API", "CLI"],
      }],
      "paragraph/wrap": ["error", { width: "nowrap" }],
      "prose-spellcheck/spellcheck": ["error", {
        dictionaries: ["@cspell/dict-en_us", "@cspell/dict-software-terms", "./.spellcheck.txt"],
        baseDir: import.meta.dirname,
      }],
    },
  },
];
