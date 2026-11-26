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

test("README pins name one released version that is not ahead of the package", async () => {
  const readme = await read("README.md");
  const pins = [
    /npm install --save-dev testlanes@(\d+\.\d+\.\d+)\n/u,
    /dblock\/testlanes\/\.github\/workflows\/testlanes\.yml@v(\d+\.\d+\.\d+)\n/u,
    /dblock\/testlanes@v(\d+\.\d+\.\d+)\n/u,
  ].map((pattern) => readme.match(pattern)?.[1]);
  assert.equal(new Set(pins).size, 1, `README pins differ: ${pins.join(", ")}.`);
  const [pinned] = pins;
  assert.ok(pinned);
  const parts = (/** @type {string} */ value) => value.split(".").map(Number);
  const [a, b] = [parts(pinned), parts(version)];
  const order = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  assert.ok(order <= 0, `README pins ${pinned}, which is ahead of the package version ${version}.`);
});

test("the reusable workflow requires a framework and defaults the artifact prefix", async () => {
  const workflow = await read(".github/workflows/testlanes.yml");
  assert.match(workflow, /\n {6}framework:\n {8}description: Test framework, either vitest, jest, or node\.\n {8}type: string\n {8}required: true\n/u);
  assert.match(workflow, /\n {6}artifact-prefix:\n(?: {8}.+\n)*? {8}default: testlanes\n/u);
});
