import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { version } from "../src/index.js";
import { root } from "./support.js";

/** @param {string} path */
const read = (path) => readFile(join(root, path), "utf8");

test("workflow and action versions match the package version", async () => {
  for (const path of [".github/workflows/testlanes.yml", "action.yml"]) {
    assert.match(await read(path), new RegExp(`TESTLANES_VERSION: ${version.replaceAll(".", "\\.")}\\n`, "u"), path);
  }
});

test("the reusable workflow requires a framework and defaults the artifact prefix", async () => {
  const workflow = await read(".github/workflows/testlanes.yml");
  assert.match(workflow, /\n {6}framework:\n {8}description: Test framework, either vitest, jest, or node\.\n {8}type: string\n {8}required: true\n/u);
  assert.match(workflow, /\n {6}artifact-prefix:\n(?: {8}.+\n)*? {8}default: testlanes\n/u);
});
