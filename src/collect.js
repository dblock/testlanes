import { mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fingerprint, parsePlan, positiveInteger } from "./plan.js";
import { readTimings, writeTimings } from "./timings.js";

/**
 * Validates every shard's newest successful report for the plan and merges
 * their timings into a baseline.
 *
 * @param {object} options
 * @param {string} options.plan Directory containing `plan.json`.
 * @param {string} options.results Directory containing downloaded shard results.
 * @param {string} options.out Baseline timing file to write.
 * @returns {Promise<Record<string, number>>}
 */
export async function collect({ plan: directory, results, out }) {
  const text = await readFile(join(directory, "plan.json"), "utf8");
  const plan = parsePlan(text);
  const expected = fingerprint(text);
  /** @type {Map<number, { attempt: number, directory: string }[]>} */
  const reports = new Map();
  const entries = await readdir(results, { recursive: true });
  for (const entry of entries.filter((file) => file === "result.json" || file.endsWith("/result.json") || file.endsWith("\\result.json")).sort()) {
    const path = join(results, entry);
    const result = JSON.parse(await readFile(path, "utf8"));
    if (result?.plan !== expected) continue;
    const shard = positiveInteger(result.shard, "shard");
    const attempt = positiveInteger(result.attempt, "attempt");
    reports.set(shard, [...(reports.get(shard) ?? []), { attempt, directory: dirname(path) }]);
  }
  const shards = plan.groups.map((_group, index) => index + 1);
  if (JSON.stringify([...reports.keys()].sort((a, b) => a - b)) !== JSON.stringify(shards)) {
    throw new Error("Incomplete or unexpected shard reports.");
  }
  /** @type {Record<string, number>} */
  const combined = {};
  for (const shard of shards) {
    const candidates = /** @type {{ attempt: number, directory: string }[]} */ (reports.get(shard));
    const newest = Math.max(...candidates.map((candidate) => candidate.attempt));
    const latest = candidates.filter((candidate) => candidate.attempt === newest);
    if (latest.length !== 1) throw new Error(`Duplicate reports for shard ${shard} attempt ${newest}.`);
    const assigned = new Set(plan.groups[shard - 1]);
    for (const [file, seconds] of Object.entries(await readTimings(join(latest[0].directory, "timings.json")))) {
      if (!assigned.has(file)) throw new Error(`Shard ${shard} reported a timing for unassigned file ${file}.`);
      combined[file] = seconds;
    }
  }
  if (Object.keys(combined).length === 0) throw new Error("No test timings were recorded.");
  await mkdir(dirname(out), { recursive: true });
  await writeTimings(out, combined);
  return combined;
}
