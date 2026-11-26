import { readFile, writeFile } from "node:fs/promises";
import { validatePath } from "./paths.js";

/** @typedef {Record<string, number>} Timings */

/**
 * Parses a timing file that maps repository-relative paths to seconds.
 *
 * @param {string} text
 * @param {string} source
 * @returns {Timings}
 */
export function parseTimings(text, source) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${source} is not valid JSON.`);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${source} must contain a JSON object of file paths and seconds.`);
  }
  /** @type {Timings} */
  const timings = {};
  for (const [file, seconds] of Object.entries(data)) {
    validatePath(file);
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
      throw new Error(`Invalid duration for ${file} in ${source}.`);
    }
    timings[file] = seconds;
  }
  return timings;
}

/**
 * Reads and validates a timing file.
 *
 * @param {string} path
 * @returns {Promise<Timings>}
 */
export async function readTimings(path) {
  return parseTimings(await readFile(path, "utf8"), path);
}

/**
 * Serializes timings with sorted keys so identical measurements produce identical bytes.
 *
 * @param {Timings} timings
 * @returns {string}
 */
export function formatTimings(timings) {
  /** @type {Timings} */
  const sorted = {};
  for (const file of Object.keys(timings).sort()) sorted[file] = timings[file];
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/**
 * Writes timings to a file.
 *
 * @param {string} path
 * @param {Timings} timings
 * @returns {Promise<void>}
 */
export async function writeTimings(path, timings) {
  await writeFile(path, formatTimings(timings));
}
