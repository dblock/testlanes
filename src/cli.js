import { existsSync, realpathSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { collect } from "./collect.js";
import { discover } from "./discover.js";
import { artifactPrefix, requiredEnv, writeOutputs } from "./github.js";
import { version } from "./index.js";
import { createPlan, fileMatrix, fingerprint, formatPlan, positiveInteger, testArguments, testWrapper, workerMatrix } from "./plan.js";
import { runShard } from "./run.js";
import { readTimings } from "./timings.js";

const usage = `Usage: testlanes <command> [options]

Commands:
  plan      Select test files and assign them to shards.
  run       Plan the shards and run one of them, recording its timings.
  collect   Validate shard results and merge their timings into a baseline.
  github    Run one step of the testlanes reusable workflow or standalone action.

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
    },
    help: `Usage: testlanes plan --framework <vitest|jest|node> [options]

Prints a JSON matrix of shard numbers and their assigned files.

Options:
  --shards <n>             Maximum number of shards, from 1 to 256 (default 4).
  --group-by <mode>        auto, filesize, or runtime (default auto).
  --pattern <glob>         Select files with a glob instead of the framework's listing or default patterns.
  --timings <file>         Timing history JSON; a missing file supplies no history.
  --test-args <json>       JSON array of extra framework arguments (default []).
  --test-wrapper <json>    JSON array of a command and arguments that wrap test runs, such as c8 (default []).
  --out <directory>        Write plan.json to this directory.
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
  github: {
    options: {},
    help: `Usage: testlanes github <run|collect|matrix>

Runs one step of the testlanes reusable workflow, or the standalone action's
matrix step. The run step plans the shards and runs one of them. Reads the inputs from TESTLANES_INPUTS (toJSON(inputs)), the shard
from TESTLANES_SHARD, keeps workflow files under RUNNER_TEMP/testlanes, and
writes step outputs to GITHUB_OUTPUT.
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
  const io = { cwd, stdout, stderr, env };
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
    if (name === "github") return await github(rest, io);
    const { values } = parseArgs({ args: rest, options: command.options, strict: true, allowPositionals: false });
    switch (name) {
      case "plan":
        return await plan(/** @type {Record<string, string>} */ (values), "files", io);
      case "run":
        return await runShard({
          plan: requireOption(values, "plan"),
          shard: requireOption(values, "shard"),
          attempt: values.attempt,
          out: requireOption(values, "out"),
          cwd,
          version,
        });
      default: {
        const combined = await collect({ plan: requireOption(values, "plan"), results: requireOption(values, "results"), out: requireOption(values, "out") });
        stderr.write(`Collected timings for ${Object.keys(combined).length} files.\n`);
        return 0;
      }
    }
  } catch (error) {
    stderr.write(`testlanes: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

/**
 * Plans shards and writes the matrix to standard output and `GITHUB_OUTPUT`.
 *
 * @param {Record<string, string>} values
 * @param {"files" | "workers"} kind Matrix entries with assigned files, or with workflow job names.
 * @param {{ cwd: string, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream, env: NodeJS.ProcessEnv }} io
 * @returns {Promise<number>}
 */
async function plan(values, kind, { cwd, stdout, stderr, env }) {
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
  const matrix = JSON.stringify(kind === "workers" ? workerMatrix(prepared) : fileMatrix(prepared));
  await writeOutputs({ matrix, "group-by": prepared.groupBy, shards: prepared.groups.length }, env);
  stdout.write(`${matrix}\n`);
  stderr.write(`Prepared ${prepared.groups.length} shards of ${Object.keys(files).length} files using ${prepared.groupBy} grouping.\n`);
  return 0;
}

/**
 * Runs one step of the reusable workflow or the standalone action from its JSON inputs.
 *
 * @param {string[]} args
 * @param {{ cwd: string, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream, env: NodeJS.ProcessEnv }} io
 * @returns {Promise<number>}
 */
async function github(args, io) {
  const { env, cwd, stderr } = io;
  const [step, ...extra] = args;
  if (extra.length > 0) throw new Error(`Unexpected arguments: ${extra.join(" ")}.`);
  if (!["run", "collect", "matrix"].includes(step)) {
    throw new Error(`Unknown github step ${JSON.stringify(step)}; expected run, collect, or matrix.`);
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
  /** @param {string} timings @param {string} out */
  const planValues = (timings, out) => ({
    framework: input("framework", ""),
    shards: input("shards", "4"),
    "group-by": input("group-by", "auto"),
    pattern: input("pattern", ""),
    timings,
    "test-args": input("test-args", "[]"),
    "test-wrapper": input("test-wrapper", "[]"),
    out,
  });
  if (step === "matrix") return await plan(planValues(input("timings", ""), ""), "files", io);
  const prefix = artifactPrefix(input("artifact-prefix", "testlanes"));
  const base = join(requiredEnv(env, "RUNNER_TEMP"), "testlanes");
  const attempt = env.GITHUB_RUN_ATTEMPT || "1";
  switch (step) {
    case "run": {
      const shard = positiveInteger(requiredEnv(env, "TESTLANES_SHARD"), "shard");
      // Every shard plans for itself from the same files and baseline, so plans match.
      await plan(planValues(join(base, "history", "timings.json"), join(base, "plan")), "workers", { ...io, env: { ...env, GITHUB_OUTPUT: "" }, stdout: stderr });
      const prepared = JSON.parse(await readFile(join(base, "plan", "plan.json"), "utf8"));
      if (shard > prepared.groups.length) {
        stderr.write(`Shard ${shard} has no files; the plan has ${prepared.groups.length} shards.\n`);
        return 0;
      }
      const code = await runShard({ plan: join(base, "plan"), shard, attempt, out: join(base, "result"), cwd, version });
      if (code === 0) await writeOutputs({ artifact: `${prefix}-shard-${shard}-${attempt}` }, env);
      return code;
    }
    default: {
      await sharedPlan(join(base, "results"), join(base, "plan"));
      const combined = await collect({ plan: join(base, "plan"), results: join(base, "results"), out: join(base, "baseline", "timings.json") });
      stderr.write(`Collected timings for ${Object.keys(combined).length} files.\n`);
      return 0;
    }
  }
}

/**
 * Copies the plan that shard results were produced from into a directory,
 * choosing a \`plan.json\` whose fingerprint matches its \`result.json\`.
 *
 * @param {string} results
 * @param {string} directory
 * @returns {Promise<void>}
 */
async function sharedPlan(results, directory) {
  const entries = (existsSync(results) ? await readdir(results, { recursive: true }) : []).filter((entry) => basename(entry) === "result.json");
  /** @type {{ attempt: number, text: string }[]} */
  const candidates = [];
  for (const entry of entries) {
    const folder = dirname(join(results, entry));
    let text;
    try {
      text = await readFile(join(folder, "plan.json"), "utf8");
    } catch {
      continue;
    }
    const report = JSON.parse(await readFile(join(folder, "result.json"), "utf8"));
    if (report.plan === fingerprint(text)) candidates.push({ attempt: Number(report.attempt), text });
  }
  // A re-run of all jobs may plan differently; the newest attempt's plan is the current one.
  const newest = candidates.sort((a, b) => b.attempt - a.attempt)[0];
  if (newest) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "plan.json"), newest.text);
    return;
  }
  throw new Error("No shard result includes the plan it was produced from.");
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
