import { existsSync, realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { collect } from "./collect.js";
import { discover } from "./discover.js";
import { artifactPrefix, findHistory, requiredEnv, writeOutputs } from "./github.js";
import { version } from "./index.js";
import { createPlan, fileMatrix, formatPlan, positiveInteger, testArguments, testWrapper, workerMatrix } from "./plan.js";
import { runShard } from "./run.js";
import { readTimings } from "./timings.js";

const usage = `Usage: testlanes <command> [options]

Commands:
  plan      Select test files and assign them to shards.
  run       Run one shard of a prepared plan and record its timings.
  collect   Validate shard results and merge their timings into a baseline.
  history   Find the newest trusted timing baseline in GitHub Actions.
  github    Run one step of the testlanes reusable workflow.

Run testlanes <command> --help for options.
`;

/** @type {Record<string, { options: import("node:util").ParseArgsOptionsConfig, help: string }>} */
const commands = {
  plan: {
    options: {
      framework: { type: "string" },
      shards: { type: "string", default: "4" },
      "group-by": { type: "string", default: "auto" },
      pattern: { type: "string", default: "" },
      timings: { type: "string", default: "" },
      "test-args": { type: "string", default: "[]" },
      "test-wrapper": { type: "string", default: "[]" },
      out: { type: "string", default: "" },
      matrix: { type: "string", default: "files" },
      "expect-version": { type: "string", default: "" },
    },
    help: `Usage: testlanes plan --framework <vitest|jest|node> [options]

Options:
  --shards <n>             Maximum number of shards, from 1 to 256 (default 4).
  --group-by <mode>        auto, filesize, or runtime (default auto).
  --pattern <glob>         Select files with a glob instead of the framework's listing or default patterns.
  --timings <file>         Timing history JSON; a missing file supplies no history.
  --test-args <json>       JSON array of extra framework arguments (default []).
  --test-wrapper <json>    JSON array of a command and arguments that wrap test runs, such as c8 (default []).
  --out <directory>        Write plan.json to this directory.
  --matrix <files|workers> Matrix entries with assigned files or display names (default files).
  --expect-version <v>     Fail unless the installed testlanes version matches.
`,
  },
  run: {
    options: {
      plan: { type: "string" },
      shard: { type: "string" },
      attempt: { type: "string", default: process.env.GITHUB_RUN_ATTEMPT || "1" },
      out: { type: "string" },
    },
    help: `Usage: testlanes run --plan <directory> --shard <n> --out <directory> [--attempt <n>]
`,
  },
  collect: {
    options: {
      plan: { type: "string" },
      results: { type: "string" },
      out: { type: "string" },
    },
    help: `Usage: testlanes collect --plan <directory> --results <directory> --out <file>
`,
  },
  history: {
    options: {
      prefix: { type: "string", default: "testlanes" },
    },
    help: `Usage: testlanes history [--prefix <artifact-prefix>]
`,
  },
  github: {
    options: {},
    help: `Usage: testlanes github <history|prepare|run|collect>

Runs one step of the testlanes reusable workflow. Reads the workflow's inputs
from TESTLANES_INPUTS (toJSON(inputs)), the shard from TESTLANES_SHARD, keeps
files under RUNNER_TEMP/testlanes, and writes step outputs to GITHUB_OUTPUT.
`,
  },
};

/**
 * Runs the testlanes command line and returns its exit code.
 *
 * @param {string[]} argv
 * @param {{ cwd?: string, stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream, env?: NodeJS.ProcessEnv }} [io]
 * @returns {Promise<number>}
 */
export async function main(argv, { cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr, env = process.env } = {}) {
  // Test runners report long paths, so expand Windows short (8.3) names before computing relative paths.
  cwd = realpathSync.native(cwd);
  const [name, ...rest] = argv;
  if (name === "--version" || name === "-v") {
    stdout.write(`${version}\n`);
    return 0;
  }
  if (name === undefined || name === "--help" || name === "-h") {
    stdout.write(usage);
    return name === undefined ? 1 : 0;
  }
  const command = commands[name];
  if (!command) {
    stderr.write(`testlanes: Unknown command ${JSON.stringify(name)}.\n${usage}`);
    return 1;
  }
  try {
    if (rest.includes("--help") || rest.includes("-h")) {
      stdout.write(command.help);
      return 0;
    }
    if (name === "github") return await github(rest, { cwd, stdout, stderr, env });
    const { values } = parseArgs({ args: rest, options: command.options, strict: true, allowPositionals: false });
    switch (name) {
      case "plan":
        return await plan(/** @type {Record<string, string>} */ (values), { cwd, stdout, stderr, env });
      case "run":
        return await runShard({
          plan: requireOption(values, "plan"),
          shard: requireOption(values, "shard"),
          attempt: values.attempt,
          out: requireOption(values, "out"),
          cwd,
          version,
        });
      case "collect": {
        const combined = await collect({ plan: requireOption(values, "plan"), results: requireOption(values, "results"), out: requireOption(values, "out") });
        stderr.write(`Collected timings for ${Object.keys(combined).length} files.\n`);
        return 0;
      }
      default:
        return await history(String(values.prefix), { stderr, env });
    }
  } catch (error) {
    stderr.write(`testlanes: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

/**
 * @param {Record<string, string>} values
 * @param {{ cwd: string, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream, env: NodeJS.ProcessEnv }} io
 * @returns {Promise<number>}
 */
async function plan(values, { cwd, stdout, stderr, env }) {
  if (values["expect-version"] && values["expect-version"] !== version) {
    throw new Error(`testlanes ${version} is installed, but version ${values["expect-version"]} was expected; keep the package and workflow versions matched.`);
  }
  if (values.matrix !== "files" && values.matrix !== "workers") {
    throw new Error(`Invalid matrix ${JSON.stringify(values.matrix)}; expected files or workers.`);
  }
  let testArgs;
  try {
    testArgs = testArguments(JSON.parse(values["test-args"]));
  } catch {
    throw new Error("Test arguments must be a JSON array of strings.");
  }
  let wrapper;
  try {
    wrapper = testWrapper(JSON.parse(values["test-wrapper"]));
  } catch {
    throw new Error("The test wrapper must be a JSON array of strings starting with a command.");
  }
  const framework = requireOption(values, "framework");
  const pattern = values.pattern || null;
  let timings = {};
  if (values.timings && values["group-by"] !== "filesize" && existsSync(values.timings)) {
    try {
      timings = await readTimings(values.timings);
    } catch (error) {
      stderr.write(`Ignoring unusable timing history: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  const files = await discover({ framework, cwd, pattern, testArgs });
  const prepared = createPlan({ version, framework, files, shards: values.shards, groupBy: values["group-by"], timings, pattern, testArgs, testWrapper: wrapper });
  if (values.out) {
    await mkdir(values.out, { recursive: true });
    await writeFile(join(values.out, "plan.json"), formatPlan(prepared));
  }
  const matrix = JSON.stringify(values.matrix === "workers" ? workerMatrix(prepared) : fileMatrix(prepared));
  await writeOutputs({ matrix, "group-by": prepared.groupBy, shards: prepared.groups.length }, env);
  stdout.write(`${matrix}\n`);
  stderr.write(`Prepared ${prepared.groups.length} shards of ${Object.keys(files).length} files using ${prepared.groupBy} grouping.\n`);
  return 0;
}

/**
 * @param {string} prefix
 * @param {{ stderr: NodeJS.WritableStream, env: NodeJS.ProcessEnv }} io
 * @returns {Promise<number>}
 */
async function history(prefix, { stderr, env }) {
  let found;
  try {
    found = await findHistory({ prefix, env });
  } catch (error) {
    stderr.write(`Timing history unavailable: ${error instanceof Error ? error.message : String(error)}\n`);
    return 0;
  }
  if (!found) {
    stderr.write("No trusted timing history was found.\n");
    return 0;
  }
  await writeOutputs({ "history-run": found.run, "history-artifact": found.artifact }, env);
  stderr.write(`Found timing history in run ${found.run}.\n`);
  return 0;
}

/**
 * Runs one step of the reusable workflow from its JSON inputs.
 *
 * @param {string[]} args
 * @param {{ cwd: string, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream, env: NodeJS.ProcessEnv }} io
 * @returns {Promise<number>}
 */
async function github(args, io) {
  const { env, cwd, stderr } = io;
  const [step, ...extra] = args;
  if (extra.length > 0) throw new Error(`Unexpected arguments: ${extra.join(" ")}.`);
  if (!["history", "prepare", "run", "collect"].includes(step)) {
    throw new Error(`Unknown github step ${JSON.stringify(step)}; expected history, prepare, run, or collect.`);
  }
  let inputs;
  try {
    inputs = JSON.parse(requiredEnv(env, "TESTLANES_INPUTS"));
  } catch (error) {
    if (error instanceof SyntaxError) inputs = undefined;
    else throw error;
  }
  if (inputs === null || typeof inputs !== "object" || Array.isArray(inputs)) {
    throw new Error("TESTLANES_INPUTS must be a JSON object of workflow inputs.");
  }
  /** @param {string} key @param {string} fallback */
  const input = (key, fallback) => (inputs[key] === undefined || inputs[key] === null ? fallback : String(inputs[key]));
  const prefix = artifactPrefix(input("artifact-prefix", "testlanes"));
  const base = join(requiredEnv(env, "RUNNER_TEMP"), "testlanes");
  const attempt = env.GITHUB_RUN_ATTEMPT || "1";
  switch (step) {
    case "history":
      return await history(prefix, io);
    case "prepare":
      await plan({
        framework: input("framework", ""),
        shards: input("shards", "4"),
        "group-by": input("group-by", "auto"),
        pattern: input("pattern", ""),
        timings: join(base, "history", "timings.json"),
        "test-args": input("test-args", "[]"),
        "test-wrapper": input("test-wrapper", "[]"),
        out: join(base, "plan"),
        matrix: "workers",
        "expect-version": "",
      }, io);
      await writeOutputs({ artifact: `${prefix}-plan-${attempt}` }, env);
      return 0;
    case "run": {
      const shard = positiveInteger(requiredEnv(env, "TESTLANES_SHARD"), "shard");
      const code = await runShard({ plan: join(base, "plan"), shard, attempt, out: join(base, "result"), cwd, version });
      if (code === 0) await writeOutputs({ artifact: `${prefix}-shard-${shard}-${attempt}` }, env);
      return code;
    }
    default: {
      const combined = await collect({ plan: join(base, "plan"), results: join(base, "results"), out: join(base, "baseline", "timings.json") });
      stderr.write(`Collected timings for ${Object.keys(combined).length} files.\n`);
      return 0;
    }
  }
}

/**
 * @param {Record<string, unknown>} values
 * @param {string} name
 * @returns {string}
 */
function requireOption(values, name) {
  const value = values[name];
  if (typeof value !== "string" || value === "") throw new Error(`Missing required option --${name}.`);
  return value;
}
