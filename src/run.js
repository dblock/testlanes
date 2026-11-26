import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { discover } from "./discover.js";
import { execute, framework } from "./frameworks.js";
import { relativePath } from "./paths.js";
import { fingerprint, parsePlan, positiveInteger } from "./plan.js";
import { writeTimings } from "./timings.js";

/**
 * Runs one shard of a prepared plan. On success it writes `timings.json` and a
 * `result.json` marker; on failure it returns the runner's exit code and
 * writes neither.
 *
 * @param {object} options
 * @param {string} options.plan Directory containing `plan.json`.
 * @param {unknown} options.shard
 * @param {unknown} options.attempt
 * @param {string} options.out
 * @param {string} options.cwd
 * @param {string} options.version
 * @returns {Promise<number>}
 */
export async function runShard({ plan: directory, shard, attempt, out, cwd, version }) {
  const text = await readFile(join(directory, "plan.json"), "utf8");
  const plan = parsePlan(text);
  if (plan.testlanes !== version) {
    throw new Error(`The plan was prepared by testlanes ${plan.testlanes}, but testlanes ${version} is installed.`);
  }
  const index = positiveInteger(shard, "shard");
  const generation = positiveInteger(attempt, "attempt");
  if (index > plan.groups.length) throw new Error(`Shard ${index} is outside the prepared ${plan.groups.length} shards.`);
  const current = await discover({ framework: plan.framework, cwd, pattern: plan.pattern, testArgs: plan.testArgs });
  if (JSON.stringify(current) !== JSON.stringify(plan.files)) {
    throw new Error("Selected test files or sizes changed after preparation.");
  }
  await mkdir(out, { recursive: true });
  const measurements = resolve(out, "measurements.json");
  await Promise.all(["result.json", "timings.json", "measurements.json"].map((file) => rm(join(out, file), { force: true })));
  const selected = framework(plan.framework);
  const assigned = plan.groups[index - 1];
  const { code } = await execute(selected, selected.runArgs(assigned.map((file) => resolve(cwd, file)), plan.testArgs), {
    cwd,
    env: { ...process.env, TESTLANES_TIMINGS: measurements },
  });
  if (code !== 0) return code;
  let recorded;
  try {
    recorded = JSON.parse(await readFile(measurements, "utf8"));
  } catch {
    throw new Error(`No timings were recorded by the testlanes ${plan.framework} reporter.`);
  }
  /** @type {Record<string, number>} */
  const timings = {};
  for (const [file, seconds] of Object.entries(recorded)) timings[relativePath(cwd, file)] = seconds;
  const ran = Object.keys(timings).sort();
  if (JSON.stringify(ran) !== JSON.stringify([...assigned].sort())) {
    throw new Error(`Shard ${index} ran ${JSON.stringify(ran)} instead of its assigned ${JSON.stringify(assigned)}.`);
  }
  await rm(measurements, { force: true });
  await writeTimings(join(out, "timings.json"), timings);
  await writeFile(join(out, "result.json"), `${JSON.stringify({ plan: fingerprint(text), shard: index, attempt: generation })}\n`);
  return 0;
}
