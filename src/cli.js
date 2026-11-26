import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { collect } from "./collect.js";
import { discover } from "./discover.js";
import { findHistory, writeOutputs } from "./github.js";
import { version } from "./index.js";
import { createPlan, fileMatrix, formatPlan, testArguments, workerMatrix } from "./plan.js";
import { runShard } from "./run.js";
import { readTimings } from "./timings.js";

const usage = `Usage: testlanes <command> [options]

Commands:
  plan      Select test files and assign them to shards.
  run       Run one shard of a prepared plan and record its timings.
  collect   Validate shard results and merge their timings into a baseline.
  history   Find the newest trusted timing baseline in GitHub Actions.

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
      out: { type: "string", default: "" },
      matrix: { type: "string", default: "files" },
      "expect-version": { type: "string", default: "" },
    },
    help: `Usage: testlanes plan --framework <vitest|jest> [options]

Options:
  --shards <n>             Maximum number of shards, from 1 to 256 (default 4).
  --group-by <mode>        auto, filesize, or runtime (default auto).
  --pattern <glob>         Select files with a glob instead of the framework's listing.
  --timings <file>         Timing history JSON; a missing file supplies no history.
  --test-args <json>       JSON array of extra framework arguments (default []).
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
};

/**
 * Runs the testlanes command line and returns its exit code.
 *
 * @param {string[]} argv
 * @param {{ cwd?: string, stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream, env?: NodeJS.ProcessEnv }} [io]
 * @returns {Promise<number>}
 */
export async function main(argv, { cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr, env = process.env } = {}) {
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
  const prepared = createPlan({ version, framework, files, shards: values.shards, groupBy: values["group-by"], timings, pattern, testArgs });
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
 * @param {Record<string, unknown>} values
 * @param {string} name
 * @returns {string}
 */
function requireOption(values, name) {
  const value = values[name];
  if (typeof value !== "string" || value === "") throw new Error(`Missing required option --${name}.`);
  return value;
}
