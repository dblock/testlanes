import { createHash } from "node:crypto";
import { partition } from "./partition.js";
import { framework } from "./frameworks.js";
import { validatePath } from "./paths.js";

export const MAX_SHARDS = 256;

/**
 * @typedef {object} Plan
 * @property {string} testlanes Version of testlanes that prepared the plan.
 * @property {string} framework
 * @property {string | null} pattern
 * @property {string[]} testArgs
 * @property {string[]} testWrapper Command prefix for running tests, such as a coverage tool.
 * @property {"filesize" | "runtime"} groupBy
 * @property {Record<string, number>} files Selected files and their sizes in bytes.
 * @property {string[][]} groups Files assigned to each shard, in shard order.
 */

/**
 * Parses a positive integer from a number or decimal string.
 *
 * @param {unknown} value
 * @param {string} name
 * @returns {number}
 */
export function positiveInteger(value, name) {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`Expected ${name} to be a positive integer.`);
  return number;
}

/**
 * Validates test arguments.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function testArguments(value) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("Test arguments must be a JSON array of strings.");
  }
  return value;
}

/**
 * Validates a test wrapper: a command and its arguments that run before the test runner.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function testWrapper(value) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string") || value[0] === "") {
    throw new Error("The test wrapper must be a JSON array of strings starting with a command.");
  }
  return value;
}

/**
 * Chooses the grouping mode from the requested mode and timing coverage.
 *
 * @param {string} requested
 * @param {number} known
 * @param {number} total
 * @returns {"filesize" | "runtime"}
 */
export function grouping(requested, known, total) {
  const sufficient = known * 2 >= total;
  if (requested === "auto") return sufficient ? "runtime" : "filesize";
  if (requested === "filesize") return "filesize";
  if (requested === "runtime") {
    if (sufficient) return "runtime";
    throw new Error("Runtime grouping requires timings for at least half the selected files.");
  }
  throw new Error(`Invalid group-by ${JSON.stringify(requested)}; expected auto, filesize, or runtime.`);
}

/**
 * Builds a shard plan.
 *
 * @param {object} options
 * @param {string} options.version
 * @param {string} options.framework
 * @param {Record<string, number>} options.files
 * @param {unknown} [options.shards]
 * @param {string} [options.groupBy]
 * @param {Record<string, number>} [options.timings]
 * @param {string | null} [options.pattern]
 * @param {string[]} [options.testArgs]
 * @param {string[]} [options.testWrapper]
 * @returns {Plan}
 */
export function createPlan({ version, framework: name, files, shards = 4, groupBy = "auto", timings = {}, pattern = null, testArgs = [], testWrapper: wrapper = [] }) {
  framework(name);
  const requested = positiveInteger(shards, "shards");
  if (requested > MAX_SHARDS) throw new Error(`GitHub Actions allows at most ${MAX_SHARDS} shards.`);
  const paths = Object.keys(files).sort();
  if (paths.length === 0) throw new Error(pattern ? `No test files match ${JSON.stringify(pattern)}.` : `No ${name} test files were found.`);
  /** @type {Record<string, number>} */
  const known = {};
  if (groupBy !== "filesize") {
    for (const file of paths) if (Object.hasOwn(timings, file)) known[file] = timings[file];
  }
  const mode = grouping(groupBy, Object.keys(known).length, paths.length);
  /** @type {Record<string, number>} */
  const weights = {};
  if (mode === "runtime") {
    const measured = Object.values(known);
    const estimate = measured.reduce((sum, seconds) => sum + seconds, 0) / measured.length;
    for (const file of paths) weights[file] = Object.hasOwn(known, file) ? known[file] : estimate;
  } else {
    for (const file of paths) weights[file] = files[file];
  }
  /** @type {Record<string, number>} */
  const sorted = {};
  for (const file of paths) sorted[file] = files[file];
  return {
    testlanes: version,
    framework: name,
    pattern,
    testArgs: testArguments(testArgs),
    testWrapper: testWrapper(wrapper),
    groupBy: mode,
    files: sorted,
    groups: partition(weights, Math.min(requested, paths.length)),
  };
}

/**
 * Serializes a plan; its exact bytes determine the fingerprint.
 *
 * @param {Plan} plan
 * @returns {string}
 */
export function formatPlan(plan) {
  return `${JSON.stringify(plan)}\n`;
}

/**
 * Parses and validates a serialized plan.
 *
 * @param {string} text
 * @returns {Plan}
 */
export function parsePlan(text) {
  const plan = JSON.parse(text);
  const files = plan?.files;
  if (
    typeof plan?.testlanes !== "string" ||
    !Array.isArray(plan.groups) ||
    plan.groups.length === 0 ||
    files === null ||
    typeof files !== "object" ||
    !plan.groups.every((/** @type {unknown} */ group) => Array.isArray(group) && group.every((file) => Object.hasOwn(files, file)))
  ) {
    throw new Error("The shard plan is malformed.");
  }
  framework(plan.framework);
  testArguments(plan.testArgs);
  testWrapper(plan.testWrapper);
  Object.keys(files).forEach(validatePath);
  return plan;
}

/**
 * Returns the SHA256 fingerprint of serialized plan bytes.
 *
 * @param {string} text
 * @returns {string}
 */
export function fingerprint(text) {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Builds the workflow matrix of shard numbers and display names.
 *
 * @param {Plan} plan
 * @returns {{ shard: number, name: string }[]}
 */
export function workerMatrix(plan) {
  return plan.groups.map((_files, index) => ({ shard: index + 1, name: `${index + 1} of ${plan.groups.length}` }));
}

/**
 * Builds the standalone matrix of shard numbers and assigned files.
 *
 * @param {Plan} plan
 * @returns {{ shard: number, files: string[] }[]}
 */
export function fileMatrix(plan) {
  return plan.groups.map((files, index) => ({ shard: index + 1, files }));
}
