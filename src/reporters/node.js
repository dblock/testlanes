import { resolve } from "node:path";
import { Recorder } from "./record.js";

/**
 * node:test reporter that records each test file's duration when
 * `TESTLANES_TIMINGS` is set. With process isolation, `node --test` reports
 * each file it runs as a top-level test named by its path, covering module
 * loading; only those are recorded, because tests defined in imported modules
 * report the imported module's path. Without per-file events, the top-level
 * test durations of each file are summed instead.
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
    const durations = name && resolve(name) === file ? files : tests;
    durations.set(file, (durations.get(file) ?? 0) + (details?.duration_ms ?? 0));
  }
  const recorder = new Recorder();
  for (const [file, milliseconds] of files.size > 0 ? files : tests) recorder.add(file, milliseconds);
  recorder.write();
  yield* [];
}
