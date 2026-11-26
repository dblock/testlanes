import { resolve } from "node:path";
import { Recorder } from "./record.js";

/**
 * node:test reporter that records each test file's duration when
 * `TESTLANES_TIMINGS` is set. With process isolation, `node --test` reports
 * each file as a top-level test named by its path, covering module loading;
 * otherwise the file's top-level test durations are summed.
 *
 * @param {AsyncIterable<{ type: string, data: { nesting?: number, file?: string, name?: string, details?: { duration_ms?: number } } }>} source
 * @returns {AsyncGenerator<string>}
 */
export default async function* testlanesNodeReporter(source) {
  /** @type {Map<string, number>} */
  const files = new Map();
  /** @type {Map<string, number>} */
  const tests = new Map();
  for await (const event of source) {
    const { nesting, file, name, details } = event.data ?? {};
    if (event.type !== "test:complete" || nesting !== 0 || !file) continue;
    const duration = details?.duration_ms ?? 0;
    if (name && resolve(name) === file) files.set(file, (files.get(file) ?? 0) + duration);
    else tests.set(file, (tests.get(file) ?? 0) + duration);
  }
  const recorder = new Recorder();
  for (const file of new Set([...files.keys(), ...tests.keys()])) {
    recorder.add(file, files.get(file) ?? /** @type {number} */ (tests.get(file)));
  }
  recorder.write();
  yield* [];
}
