import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { version } from "../src/index.js";
import { root } from "./support.js";

/** @param {string} path */
const read = (path) => readFile(join(root, path), "utf8");

/**
 * Returns the github-script body of the named step, unindented.
 *
 * @param {string} workflow
 * @param {string} name
 */
const script = (workflow, name) => {
  const block = new RegExp(`name: ${name}\\n(?: {8}.+\\n)*? {10}script: \\|\\n((?: {12}.*\\n)+)`, "u").exec(workflow);
  assert.ok(block, `${name} step not found`);
  return block[1].replaceAll(/^ {12}/gmu, "");
};

/** A fake github-script core that records outputs and failures. */
const fakeCore = () => {
  /** @type {Record<string, string>} */
  const outputs = {};
  /** @type {string[]} */
  const messages = [];
  /** @type {string[]} */
  const warnings = [];
  return {
    outputs,
    messages,
    warnings,
    /** @param {string} message */
    warning: (message) => { warnings.push(message); },
    /** @param {string} key @param {string} value */
    setOutput: (key, value) => { outputs[key] = value; },
    /** @param {string} message */
    info: (message) => { messages.push(message); },
  };
};

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
  for (const step of ["run", "collect"]) {
    assert.match(workflow, new RegExp(`await exec\\.exec\\("npx", \\["--no-install", "testlanes", "github", "${step}"\\]`, "u"));
  }
  // Only the caller's own scripts run in a shell.
  assert.deepEqual([...workflow.matchAll(/^ +run: (.+)$/gmu)].map((match) => match[1]), ["${{ inputs.install-command }}", "${{ inputs.setup }}"]);
});

test("the package manager detection step reads lockfiles, packageManager, and version files", async () => {
  const workflow = await read(".github/workflows/testlanes.yml");
  const block = script(workflow, "Detect Package Manager");
  const scratch = await mkdtemp(join(tmpdir(), "testlanes-detect-"));
  // github-script runs the script as an async function body with require and core.
  const run = new Function("require", "core", "process", block);
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
  for (const anchor of ["checkout", "detect", "setup-node", "enable-corepack", "install", "install-command", "download-results"]) {
    assert.equal(workflow.match(new RegExp(`- &${anchor}\n`, "gu"))?.length, 1, anchor);
  }
  for (const alias of ["checkout", "detect", "setup-node", "enable-corepack", "install", "install-command", "download-results"]) {
    assert.equal(workflow.match(new RegExp(`- \\*${alias}\n`, "gu"))?.length, 1, alias);
  }
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
  const detect = workflow.indexOf("name: Detect Package Manager\n");
  assert.ok(detect > 0 && detect < workflow.indexOf("- &setup-node\n"), "Detect Package Manager runs first, on github-script.");
  assert.match(workflow.slice(detect), /^name: Detect Package Manager\n {8}id: tools\n(?: {8}#.*\n)? {8}uses: actions\/github-script@[0-9a-f]{40} # v9\.0\.0\n/u);
  assert.doesNotMatch(workflow, /hashFiles|shell: node/u);
  assert.match(workflow, /node-version-file: \$\{\{ inputs\.install-node-version == '' && inputs\.node-version == '' && env\.TESTLANES_NODE_VERSION_FILE \|\| '' \}\}/u);
});

test("the reusable workflow collects timings only on default-branch pushes", async () => {
  const workflow = await read(".github/workflows/testlanes.yml");
  const collect = workflow.slice(workflow.indexOf("\n  collect:\n"));
  assert.match(collect, /^\n {2}collect:\n {4}name: Collect Timings\n {4}needs: \[test, verify\]\n(?: {4}#.*\n)? {4}if: github\.event_name == 'push' && github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)\n/u);
  assert.match(collect, /- name: Publish Trusted Baseline\n {8}uses: /u);
});

test("the matrix job lists shard numbers without checking out code", async () => {
  const workflow = await read(".github/workflows/testlanes.yml");
  const job = workflow.slice(workflow.indexOf("\n  matrix:\n"), workflow.indexOf("\n  test:\n"));
  assert.doesNotMatch(job, /actions\/checkout|actions\/setup-node|npx/u);
  const run = new Function("core", "process", script(workflow, "List Shards"));
  /** @param {string} shards */
  const matrix = (shards) => {
    const core = fakeCore();
    run(core, { env: { SHARDS: shards } });
    return JSON.parse(core.outputs.matrix);
  };
  assert.deepEqual(matrix("2"), [{ shard: 1, name: "1 of 2" }, { shard: 2, name: "2 of 2" }]);
  assert.equal(matrix("256").length, 256);
  for (const shards of ["0", "257", "1.5", ""]) assert.throws(() => matrix(shards), /shards must be an integer from 1 to 256\./u);
});

test("the verify job requires one plan and a result from every planned shard", async () => {
  const workflow = await read(".github/workflows/testlanes.yml");
  assert.match(workflow, /\n {2}verify:\n {4}name: Verify Shards\n {4}needs: test\n {4}runs-on: /u);
  const run = new Function("require", "core", "process", script(workflow, "Check Shards Used One Plan"));
  /** @param {object[]} reports */
  const verify = async (reports) => {
    const directory = await mkdtemp(join(tmpdir(), "testlanes-verify-"));
    for (const [index, report] of reports.entries()) {
      await mkdir(join(directory, `lanes-shard-${index}`), { recursive: true });
      await writeFile(join(directory, `lanes-shard-${index}`, "result.json"), JSON.stringify(report));
    }
    const core = fakeCore();
    run(createRequire(import.meta.url), core, { env: { RESULTS: directory } });
    return core.messages;
  };
  assert.deepEqual(await verify([{ plan: "a", shard: 1, shards: 2, attempt: 1 }, { plan: "a", shard: 2, shards: 2, attempt: 1 }]), ["2 shards used one plan."]);
  // A failed-job retry that planned from another baseline fails, but re-running all jobs replaces earlier attempts.
  await assert.rejects(verify([{ plan: "a", shard: 1, shards: 2, attempt: 1 }, { plan: "b", shard: 2, shards: 2, attempt: 2 }]), /Shards planned differently \(2 plan fingerprints\), because the timing baseline changed or could not be downloaded for some shards; re-run all jobs\./u);
  assert.deepEqual(await verify([{ plan: "a", shard: 1, shards: 3, attempt: 1 }, { plan: "b", shard: 1, shards: 2, attempt: 2 }, { plan: "b", shard: 2, shards: 2, attempt: 2 }]), ["2 shards used one plan."]);
  await assert.rejects(verify([{ plan: "a", shard: 1, shards: 3, attempt: 1 }]), /No results from shards 2, 3\./u);
});

test("the matrix job finds the newest trusted, unexpired baseline once per run", async () => {
  const workflow = await read(".github/workflows/testlanes.yml");
  assert.equal(workflow.match(/- name: Find Trusted History\n/gu)?.length, 1);
  assert.match(workflow, /artifact-ids: \$\{\{ needs\.matrix\.outputs\.history-artifact \}\}\n {10}run-id: \$\{\{ needs\.matrix\.outputs\.history-run \}\}/u);
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const run = new AsyncFunction("github", "context", "core", "process", script(workflow, "Find Trusted History"));
  const trusted = { event: "push", conclusion: "success", head_branch: "main", head_repository: { full_name: "owner/repo" } };
  /** @type {Record<number, object[]>} */
  const artifacts = {
    5: [{ id: 50, name: "lanes-timings", expired: true }],
    6: [{ id: 60, name: "lanes-timings", expired: false }],
  };
  /** @type {unknown[]} */
  const calls = [];
  /** @param {{ fail?: boolean, runs?: object[] }} options */
  const lookup = async ({ fail = false, runs = [{ ...trusted, id: 7 }, { ...trusted, id: 1, head_repository: { full_name: "fork/repo" } }, { ...trusted, id: 2, head_branch: "feature" }, { ...trusted, id: 3, event: "pull_request" }, { ...trusted, id: 4, conclusion: "failure" }, { ...trusted, id: 5 }, { ...trusted, id: 6 }] } = {}) => {
    calls.length = 0;
    const github = {
      rest: {
        actions: {
          /** @param {object} request */
          getWorkflowRun: async (request) => {
            calls.push(["run", request]);
            if (fail) throw new Error("Not Found");
            return { data: { id: 7, workflow_id: 42 } };
          },
          /** @param {object} request */
          listWorkflowRuns: async (request) => { calls.push(["runs", request]); return { data: { workflow_runs: runs } }; },
          /** @param {{ run_id: number }} request */
          listWorkflowRunArtifacts: async (request) => { calls.push(["artifacts", request.run_id]); return { data: { artifacts: artifacts[request.run_id] ?? [] } }; },
        },
      },
    };
    const context = { repo: { owner: "owner", repo: "repo" }, runId: 7, payload: { repository: { default_branch: "main" } } };
    const core = fakeCore();
    await run(github, context, core, { env: { ARTIFACT_PREFIX: "lanes" } });
    return core;
  };
  const found = await lookup();
  assert.deepEqual(found.outputs, { "history-run": "6", "history-artifact": "60" });
  assert.deepEqual(found.messages, ["Found timing history in run 6."]);
  assert.deepEqual(calls, [
    ["run", { owner: "owner", repo: "repo", run_id: 7 }],
    ["runs", { owner: "owner", repo: "repo", workflow_id: 42, branch: "main", event: "push", status: "success", per_page: 20 }],
    ["artifacts", 5],
    ["artifacts", 6],
  ]);
  const none = await lookup({ runs: [] });
  assert.deepEqual([none.outputs, none.messages], [{}, ["No trusted timing history was found."]]);
  const failed = await lookup({ fail: true });
  assert.deepEqual([failed.outputs, failed.warnings], [{}, ["Timing history unavailable: Not Found"]]);
});

test("every job accepts a runner label, label array, or runner group object", async () => {
  const workflow = await read(".github/workflows/testlanes.yml");
  const runsOn = [...workflow.matchAll(/^ {4}runs-on: (.+)$/gmu)].map((match) => match[1]);
  assert.equal(runsOn.length, 4);
  for (const value of runsOn) assert.equal(value, "${{ (startsWith(inputs.runs-on, '[') || startsWith(inputs.runs-on, '{')) && fromJSON(inputs.runs-on) || inputs.runs-on }}");
});
