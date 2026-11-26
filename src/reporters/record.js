import { writeFileSync } from "node:fs";

/**
 * Accumulates per-file milliseconds and writes absolute paths with seconds to
 * the file named by `TESTLANES_TIMINGS`. Recording is disabled when it is unset.
 */
export class Recorder {
  constructor() {
    /** @type {Map<string, number>} */
    this.durations = new Map();
  }

  /**
   * @param {string} file
   * @param {number} milliseconds
   */
  add(file, milliseconds) {
    const value = Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : 0;
    this.durations.set(file, (this.durations.get(file) ?? 0) + value);
  }

  write() {
    const output = process.env.TESTLANES_TIMINGS;
    if (!output) return;
    /** @type {Record<string, number>} */
    const seconds = {};
    for (const file of [...this.durations.keys()].sort()) {
      seconds[file] = Math.round(/** @type {number} */ (this.durations.get(file))) / 1000;
    }
    writeFileSync(output, `${JSON.stringify(seconds, null, 2)}\n`);
  }
}
