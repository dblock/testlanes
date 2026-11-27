import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { version } from "../src/index.js";
import { root } from "./support.js";

/** @param {string} path */
const read = (path) => readFile(join(root, path), "utf8");

test("the action runs testlanes github matrix and pins no version", async () => {
  const action = await read("action.yml");
  assert.doesNotMatch(action, /TESTLANES_VERSION|--expect-version|^ +shell:/mu);
  assert.match(action, /await exec\.exec\("npx", \["--no-install", "testlanes", "github", "matrix"\]/u);
});

test("the reusable workflow pins no testlanes version", async () => {
  const workflow = await read(".github/workflows/testlanes.yml");
  assert.doesNotMatch(workflow, /TESTLANES_VERSION|--expect-version/u);
});

test("release references never edit workflow files or the action", async () => {
  const config = await import("../npr.config.js");
  assert.equal(Object.hasOwn(config, "versionReferences"), false);
  for (const path of Object.keys(config.releaseReferences)) {
    assert.ok(!path.startsWith(".github/workflows/") && path !== "action.yml", `${path} carries no version.`);
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
  assert.doesNotMatch(workflow, /runner\.os|pwsh|bash -|^ +shell:/mu);
  for (const step of ["history", "prepare", "run", "collect"]) {
    assert.match(workflow, new RegExp(`await exec\\.exec\\("npx", \\["--no-install", "testlanes", "github", "${step}"\\]`, "u"));
  }
  // Only the caller's own scripts run in a shell.
  assert.deepEqual([...workflow.matchAll(/^ +run: (.+)$/gmu)].map((match) => match[1]), ["${{ inputs.install-command }}", "${{ inputs.setup }}"]);
});

test("the package manager detection step reads lockfiles, packageManager, and version files", async () => {
  const workflow = await read(".github/workflows/testlanes.yml");
  const block = /- name: Detect Package Manager\n(?: {8}.+\n)*? {10}script: \|\n((?: {12}.*\n)+)/u.exec(workflow);
  assert.ok(block, "detection step not found");
  const script = block[1].replaceAll(/^ {12}/gmu, "");
  const scratch = await mkdtemp(join(tmpdir(), "testlanes-detect-"));
  // github-script runs the script as an async function body with require and core.
  const run = new Function("require", "core", "process", script);
  /** @param {Record<string, string>} files */
  const detect = async (files) => {
    const project = await mkdtemp(join(scratch, "project-"));
    for (const [name, content] of Object.entries(files)) await writeFile(join(project, name), content);
    /** @type {Record<string, string>} */
    const outputs = {};
    /** @type {Record<string, string>} */
    const variables = {};
    const core = {
      /** @param {string} key @param {string} value */
      setOutput: (key, value) => { outputs[key] = value; },
      /** @param {string} key @param {string} value */
      exportVariable: (key, value) => { variables[key] = value; },
    };
    run(createRequire(import.meta.url), core, { env: { WORKING_DIRECTORY: project } });
    assert.deepEqual(variables, {
      TESTLANES_PACKAGE_MANAGER: outputs["package-manager"],
      TESTLANES_LOCKFILE: outputs.lockfile,
      TESTLANES_INSTALL: outputs.install,
      TESTLANES_NODE_VERSION_FILE: outputs["node-version-file"],
    });
    return { ...outputs, "node-version-file": outputs["node-version-file"].replace(project, "app") };
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
  for (const anchor of ["checkout", "setup-node", "enable-corepack", "install", "install-command", "download-plan"]) {
    assert.equal(workflow.match(new RegExp(`- &${anchor}\n`, "gu"))?.length, 1, anchor);
  }
  assert.equal(workflow.match(/- \*install\n/gu)?.length, 2);
  assert.equal(workflow.match(/- \*install-command\n/gu)?.length, 2);
});

test("the reusable workflow uploads shard artifacts even when tests fail", async () => {
  const workflow = await read(".github/workflows/testlanes.yml");
  assert.match(workflow, /- name: Upload Test Artifacts\n {8}if: always\(\) && inputs\.artifacts != ''\n/u);
  assert.match(workflow, /name: \$\{\{ inputs\.artifact-prefix \}\}-artifacts-\$\{\{ matrix\.entry\.shard \}\}\n/u);
});

test("the reusable workflow installs with install-node-version and tests with node-version", async () => {
  const workflow = await read(".github/workflows/testlanes.yml");
  assert.equal(workflow.match(/node-version: \$\{\{ inputs\.install-node-version \|\| inputs\.node-version \}\}\n/gu)?.length, 1);
  const testNode = workflow.indexOf("- name: Set Up Test Node\n        if: inputs.install-node-version != ''\n");
  assert.ok(testNode > 0);
  assert.ok(testNode < workflow.indexOf("- name: Set Up Application\n"));
  assert.ok(testNode > workflow.indexOf("- name: Install Dependencies\n", workflow.indexOf("\n  test:\n")));
});

test("the reusable workflow needs no shell or Node.js on the runner for its own steps", async () => {
  const workflow = await read(".github/workflows/testlanes.yml");
  const detect = workflow.indexOf("- name: Detect Package Manager\n");
  assert.ok(detect > 0 && detect < workflow.indexOf("- &setup-node\n"), "Detect Package Manager runs first, on github-script.");
  assert.match(workflow.slice(detect), /^- name: Detect Package Manager\n {8}id: tools\n(?: {8}#.*\n)? {8}uses: actions\/github-script@[0-9a-f]{40} # v9\.0\.0\n/u);
  assert.doesNotMatch(workflow, /hashFiles|shell: node/u);
  assert.match(workflow, /node-version-file: \$\{\{ inputs\.install-node-version == '' && inputs\.node-version == '' && env\.TESTLANES_NODE_VERSION_FILE \|\| '' \}\}/u);
});

test("the reusable workflow collects timings only on default-branch pushes", async () => {
  const workflow = await read(".github/workflows/testlanes.yml");
  const collect = workflow.slice(workflow.indexOf("\n  collect:\n"));
  assert.match(collect, /^\n {2}collect:\n {4}name: Collect Timings\n {4}needs: \[prepare, test\]\n(?: {4}#.*\n)? {4}if: github\.event_name == 'push' && github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)\n/u);
  assert.match(collect, /- name: Publish Trusted Baseline\n {8}uses: /u);
});
