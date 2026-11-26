import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { version } from "../src/index.js";
import { root } from "./support.js";

/** @param {string} path */
const read = (path) => readFile(join(root, path), "utf8");

test("workflow and action versions match the package version", async () => {
  for (const path of [".github/workflows/lanes.yml", "action.yml"]) {
    assert.match(await read(path), new RegExp(`TESTLANES_VERSION: ${version.replaceAll(".", "\\.")}\\n`, "u"), path);
  }
});

test("framework workflows forward every shared input", async () => {
  const lanes = await read(".github/workflows/lanes.yml");
  const inputs = [...lanes.split("\njobs:")[0].matchAll(/^ {6}([a-z-]+):\n {8}description:/gmu)].map((match) => match[1]).filter((name) => name !== "framework");
  for (const [path, name] of [[".github/workflows/vitest.yml", "vitest"], [".github/workflows/jest.yml", "jest"]]) {
    const text = await read(path);
    assert.match(text, new RegExp(`framework: ${name}\\n`, "u"));
    for (const input of inputs) {
      assert.match(text, new RegExp(`\\n {6}${input}:\\n {8}description:`, "u"), `${path} declares ${input}`);
      assert.match(text, new RegExp(`\\n {6}${input}: \\$\\{\\{ inputs\\.${input} \\}\\}\\n`, "u"), `${path} forwards ${input}`);
    }
  }
});
