import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import JestReporter from "../src/reporters/jest.js";
import nodeReporter from "../src/reporters/node.js";
import VitestReporter from "../src/reporters/vitest.js";

describe("reporters", () => {
  afterEach(() => {
    delete process.env.TESTLANES_TIMINGS;
  });

  test("Vitest reporter sums module phases and repeated modules", async () => {
    const output = join(await mkdtemp(join(tmpdir(), "testlanes-reporter-")), "timings.json");
    process.env.TESTLANES_TIMINGS = output;
    const reporter = new VitestReporter();
    const diagnostic = { environmentSetupDuration: 1, prepareDuration: 2, collectDuration: 3, setupDuration: 4, duration: 100, importDurations: {} };
    reporter.onTestModuleEnd({ moduleId: "/r/b.js", diagnostic: () => diagnostic });
    reporter.onTestModuleEnd({ moduleId: "/r/b.js", diagnostic: () => ({ duration: 390 }) });
    reporter.onTestModuleEnd({ moduleId: "/r/a.js", diagnostic: () => ({ duration: Number.NaN }) });
    reporter.onTestRunEnd();
    assert.equal(await readFile(output, "utf8"), '{\n  "/r/a.js": 0,\n  "/r/b.js": 0.5\n}\n');
  });

  test("Jest reporter records runtimes and reports no errors", async () => {
    const output = join(await mkdtemp(join(tmpdir(), "testlanes-reporter-")), "timings.json");
    process.env.TESTLANES_TIMINGS = output;
    const reporter = new JestReporter();
    reporter.onTestResult({}, { testFilePath: "/r/a.js", perfStats: { runtime: 1234 } });
    reporter.onTestResult({}, { testFilePath: "/r/b.js" });
    reporter.onRunComplete();
    assert.equal(reporter.getLastError(), undefined);
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), { "/r/a.js": 1.234, "/r/b.js": 0 });
  });

  /**
   * @param {object[]} events
   * @returns {Promise<Record<string, number>>}
   */
  async function nodeTimings(events) {
    const output = join(await mkdtemp(join(tmpdir(), "testlanes-reporter-")), "timings.json");
    process.env.TESTLANES_TIMINGS = output;
    const chunks = [];
    for await (const chunk of nodeReporter((async function* () { yield* events; })())) chunks.push(chunk);
    assert.deepEqual(chunks, []);
    return JSON.parse(await readFile(output, "utf8"));
  }

  test("node:test reporter records only file-level durations when node --test reports them", async () => {
    const a = join(process.cwd(), "a.test.js");
    assert.deepEqual(await nodeTimings([
      { type: "test:pass", data: { nesting: 0, file: a, name: "ignored", details: { duration_ms: 999 } } },
      { type: "test:complete", data: { nesting: 0, file: a, name: "first", details: { duration_ms: 100 } } },
      { type: "test:complete", data: { nesting: 1, file: a, name: "nested", details: { duration_ms: 999 } } },
      { type: "test:complete", data: { nesting: 0, file: "/r/imported.test.js", name: "imported", details: { duration_ms: 20 } } },
      { type: "test:complete", data: { nesting: 0, file: a, name: a, details: { duration_ms: 250 } } },
      { type: "test:complete", data: { nesting: 0, name: "no file", details: { duration_ms: 1 } } },
      { type: "test:diagnostic", data: { message: "tests 3" } },
    ]), { [a]: 0.25 });
  });

  test("node:test reporter sums top-level tests without file-level events", async () => {
    assert.deepEqual(await nodeTimings([
      { type: "test:complete", data: { nesting: 0, file: "/r/b.test.js", name: "one", details: { duration_ms: 20 } } },
      { type: "test:complete", data: { nesting: 0, file: "/r/b.test.js", name: "two" } },
      { type: "test:complete", data: { nesting: 0, file: "/r/c.test.js", name: "three", details: { duration_ms: 5 } } },
      { type: "test:complete" },
    ]), { "/r/b.test.js": 0.02, "/r/c.test.js": 0.005 });
  });

  test("records nothing when TESTLANES_TIMINGS is unset", async () => {
    const directory = await mkdtemp(join(tmpdir(), "testlanes-reporter-"));
    const reporter = new JestReporter();
    reporter.onTestResult({}, { testFilePath: "/r/a.js", perfStats: { runtime: 1 } });
    reporter.onRunComplete();
    assert.ok(!existsSync(join(directory, "timings.json")));
  });
});
