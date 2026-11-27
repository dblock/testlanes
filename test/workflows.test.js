import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { version } from "../src/index.js";
import { root } from "./support.js";

/** @param {string} path */
const read = (path) => readFile(join(root, path), "utf8");

test("the action version matches the package version", async () => {
  assert.match(await read("action.yml"), new RegExp(`TESTLANES_VERSION: ${version.replaceAll(".", "\\.")}\\n`, "u"));
});

test("the reusable workflow pins no testlanes version", async () => {
  const workflow = await read(".github/workflows/testlanes.yml");
  assert.doesNotMatch(workflow, /TESTLANES_VERSION|--expect-version/u);
});

test("release references never edit workflow files", async () => {
  const { releaseReferences, versionReferences } = await import("../npr.config.js");
  for (const path of [...Object.keys(versionReferences), ...Object.keys(releaseReferences)]) {
    assert.ok(!path.startsWith(".github/workflows/"), `${path} is a workflow file.`);
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

test("the reusable workflow's steps are the same on every OS", async () => {
  const workflow = await read(".github/workflows/testlanes.yml");
  assert.doesNotMatch(workflow, /runner\.os|pwsh|bash -/u);
  for (const step of ["history", "prepare", "run", "collect"]) {
    assert.match(workflow, new RegExp(`run: npx --no-install testlanes github ${step}\n`, "u"));
  }
});

test("the package manager detection step reads lockfiles, packageManager, and version files", async () => {
  const workflow = await read(".github/workflows/testlanes.yml");
  assert.equal(workflow.match(/shell: node \{0\}/gu)?.length, 1);
  const block = /shell: node \{0\}\n(?: {8}.+\n)*? {8}run: \|\n((?: {10}.*\n)+)/u.exec(workflow);
  assert.ok(block, "detection step not found");
  const script = block[1].replaceAll(/^ {10}/gmu, "");
  const scratch = await mkdtemp(join(tmpdir(), "testlanes-detect-"));
  await writeFile(join(scratch, "detect.cjs"), script);
  /** @param {string} text */
  const parse = (text) => Object.fromEntries(text.trim().split("\n").map((line) => line.split(/=(.*)/su).slice(0, 2)));
  /** @param {Record<string, string>} files */
  const detect = async (files) => {
    const project = await mkdtemp(join(scratch, "project-"));
    for (const [name, content] of Object.entries(files)) await writeFile(join(project, name), content);
    const output = join(project, "output");
    const environment = join(project, "environment");
    await writeFile(output, "");
    await writeFile(environment, "");
    execFileSync(process.execPath, [join(scratch, "detect.cjs")], { cwd: project, env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_ENV: environment, WORKING_DIRECTORY: "app" } });
    const outputs = parse(await readFile(output, "utf8"));
    const variables = parse(await readFile(environment, "utf8"));
    assert.deepEqual(variables, {
      TESTLANES_PACKAGE_MANAGER: outputs["package-manager"],
      TESTLANES_LOCKFILE: outputs.lockfile,
      TESTLANES_INSTALL: outputs.install,
      TESTLANES_NODE_VERSION_FILE: outputs["node-version-file"],
    });
    return outputs;
  };
  assert.deepEqual(await detect({}), { "package-manager": "npm", lockfile: "package-lock.json", install: "npm ci", "node-version-file": "" });
  assert.deepEqual(await detect({ "pnpm-lock.yaml": "", ".nvmrc": "26" }), { "package-manager": "pnpm", lockfile: "pnpm-lock.yaml", install: "pnpm install --frozen-lockfile", "node-version-file": "app/.nvmrc" });
  assert.deepEqual(await detect({ "yarn.lock": "", ".yarnrc.yml": "" }), { "package-manager": "yarn", lockfile: "yarn.lock", install: "yarn install --immutable", "node-version-file": "" });
  assert.deepEqual(await detect({ "yarn.lock": "", "package.json": '{"packageManager":"yarn@1.22.22"}' }), { "package-manager": "yarn", lockfile: "yarn.lock", install: "yarn install --frozen-lockfile", "node-version-file": "app/package.json" });
  assert.deepEqual(await detect({ "package.json": '{"packageManager":"pnpm@10.0.0"}' }), { "package-manager": "pnpm", lockfile: "pnpm-lock.yaml", install: "pnpm install --frozen-lockfile", "node-version-file": "app/package.json" });
  assert.equal((await detect({ "package.json": "{" }))["package-manager"], "npm");
});

test("the reusable workflow defines each setup step once and reuses it", async () => {
  const workflow = await read(".github/workflows/testlanes.yml");
  for (const anchor of ["checkout", "setup-node", "enable-corepack", "cache-store", "install", "download-plan"]) {
    assert.equal(workflow.match(new RegExp(`- &${anchor}\n`, "gu"))?.length, 1, anchor);
  }
  assert.equal(workflow.match(/- \*install\n/gu)?.length, 2);
});

test("the reusable workflow uploads shard artifacts even when tests fail", async () => {
  const workflow = await read(".github/workflows/testlanes.yml");
  assert.match(workflow, /- name: Upload Test Artifacts\n {8}if: always\(\) && inputs\.artifacts != ''\n/u);
  assert.match(workflow, /name: \$\{\{ inputs\.artifact-prefix \}\}-artifacts-\$\{\{ matrix\.entry\.shard \}\}\n/u);
});

test("the reusable workflow installs with install-node-version and tests with node-version", async () => {
  const workflow = await read(".github/workflows/testlanes.yml");
  assert.equal(workflow.match(/node-version: \$\{\{ inputs\.install-node-version \|\| inputs\.node-version \}\}\n/gu)?.length, 2);
  const testNode = workflow.indexOf("- name: Set Up Test Node\n        if: inputs.install-node-version != ''\n");
  assert.ok(testNode > 0);
  assert.ok(testNode < workflow.indexOf("- name: Set Up Application\n"));
  assert.ok(testNode > workflow.indexOf("- name: Install Dependencies\n", workflow.indexOf("\n  test:\n")));
});
