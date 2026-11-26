import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import JestReporter from "../src/reporters/jest.js";
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

  test("records nothing when TESTLANES_TIMINGS is unset", async () => {
    const directory = await mkdtemp(join(tmpdir(), "testlanes-reporter-"));
    const reporter = new JestReporter();
    reporter.onTestResult({}, { testFilePath: "/r/a.js", perfStats: { runtime: 1 } });
    reporter.onRunComplete();
    assert.ok(!existsSync(join(directory, "timings.json")));
  });
});
