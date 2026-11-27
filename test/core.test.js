import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { frameworks, framework, nodeTestPatterns, packageBin, wrapperCommand } from "../src/frameworks.js";
import { partition } from "../src/partition.js";
import { relativePath, validatePath } from "../src/paths.js";
import { createPlan, fileMatrix, fingerprint, formatPlan, grouping, parsePlan, positiveInteger, testArguments, testWrapper, workerMatrix } from "../src/plan.js";
import { formatTimings, parseTimings, readTimings } from "../src/timings.js";

describe("paths", () => {
  test("accepts normalized relative paths", () => {
    assert.equal(validatePath("specs/nested/a.spec.js"), "specs/nested/a.spec.js");
    assert.equal(relativePath("/repo", "/repo/specs/a.spec.js"), "specs/a.spec.js");
  });

  for (const path of ["", "/abs.js", "C:/a.js", "a\\b.js", "a\nb.js", "../a.js", "a/../b.js", "./a.js", "a//b.js", 1]) {
    test(`rejects ${JSON.stringify(path)}`, () => {
      assert.throws(() => validatePath(path), /Expected a relative repository path/u);
    });
  }

  test("rejects files outside the directory", () => {
    assert.throws(() => relativePath("/repo/project", "/repo/other/a.spec.js"), /relative repository path/u);
  });
});

describe("timings", () => {
  test("parses and formats sorted timings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "testlanes-timings-"));
    const file = join(directory, "timings.json");
    await writeFile(file, '{"b.js":2,"a.js":0}');
    assert.deepEqual(await readTimings(file), { "b.js": 2, "a.js": 0 });
    assert.equal(formatTimings({ "b.js": 2, "a.js": 0.5 }), '{\n  "a.js": 0.5,\n  "b.js": 2\n}\n');
  });

  test("rejects invalid JSON, shapes, paths, and durations", () => {
    assert.throws(() => parseTimings("{", "t.json"), /t\.json is not valid JSON\./u);
    assert.throws(() => parseTimings("[]", "t.json"), /must contain a JSON object/u);
    assert.throws(() => parseTimings("null", "t.json"), /must contain a JSON object/u);
    assert.throws(() => parseTimings('{"../a.js":1}', "t.json"), /relative repository path/u);
    for (const value of ["-1", '"1"', "null", "1e999"]) {
      assert.throws(() => parseTimings(`{"a.js":${value}}`, "t.json"), /Invalid duration for a\.js in t\.json\./u);
    }
  });
});

describe("partition", () => {
  test("assigns the heaviest files to the lightest shards deterministically", () => {
    assert.deepEqual(partition({ "a.js": 4, "b.js": 3, "c.js": 2, "d.js": 2, "e.js": 1 }, 2), [["a.js", "d.js"], ["b.js", "c.js", "e.js"]]);
  });

  test("breaks weight ties by path and spreads equal totals by file count", () => {
    assert.deepEqual(partition({ "c.js": 0, "a.js": 0, "b.js": 0, "d.js": 0 }, 3), [["a.js", "d.js"], ["b.js"], ["c.js"]]);
  });

  test("omits empty groups", () => {
    assert.deepEqual(partition({ "a.js": 1 }, 3), [["a.js"]]);
  });
});

describe("plan", () => {
  const files = { "a.js": 10, "b.js": 30, "c.js": 20, "d.js": 40 };

  test("parses positive integers and test arguments", () => {
    assert.equal(positiveInteger("12", "shards"), 12);
    assert.equal(positiveInteger(3, "shards"), 3);
    for (const value of ["0", "-1", "1.5", "x", 0, 1.5, null]) {
      assert.throws(() => positiveInteger(value, "shards"), /Expected shards to be a positive integer\./u);
    }
    assert.deepEqual(testArguments(["--ci"]), ["--ci"]);
    assert.throws(() => testArguments([1]), /JSON array of strings/u);
    assert.throws(() => testArguments("--ci"), /JSON array of strings/u);
    assert.deepEqual(testWrapper(["c8", "--all"]), ["c8", "--all"]);
    assert.deepEqual(testWrapper([]), []);
    for (const value of [[1], [""], "c8", null]) {
      assert.throws(() => testWrapper(value), /The test wrapper must be a JSON array of strings starting with a command\./u);
    }
  });

  test("chooses grouping from timing coverage", () => {
    assert.equal(grouping("auto", 2, 4), "runtime");
    assert.equal(grouping("auto", 1, 4), "filesize");
    assert.equal(grouping("filesize", 4, 4), "filesize");
    assert.equal(grouping("runtime", 2, 4), "runtime");
    assert.throws(() => grouping("runtime", 1, 4), /at least half the selected files/u);
    assert.throws(() => grouping("fastest", 1, 4), /Invalid group-by "fastest"; expected auto, filesize, or runtime\./u);
  });

  test("groups by file size without enough timings", () => {
    const plan = createPlan({ version: "1.0.0", framework: "vitest", files, shards: 2, timings: { "a.js": 1 } });
    assert.equal(plan.groupBy, "filesize");
    assert.deepEqual(plan.groups, [["a.js", "d.js"], ["b.js", "c.js"]]);
    assert.deepEqual(Object.keys(plan.files), ["a.js", "b.js", "c.js", "d.js"]);
  });

  test("groups by runtime, estimating unknown files and dropping stale paths", () => {
    const plan = createPlan({ version: "1.0.0", framework: "jest", files, shards: 2, timings: { "a.js": 9, "b.js": 1, "gone.js": 100 } });
    assert.equal(plan.groupBy, "runtime");
    // c.js and d.js are estimated at the mean known duration of 5 seconds.
    assert.deepEqual(plan.groups, [["a.js", "b.js"], ["c.js", "d.js"]]);
  });

  test("ignores timings when grouping by file size", () => {
    const plan = createPlan({ version: "1.0.0", framework: "vitest", files, shards: 2, groupBy: "filesize", timings: { "a.js": 1, "b.js": 1, "c.js": 1, "d.js": 1 } });
    assert.equal(plan.groupBy, "filesize");
  });

  test("caps shards at the file count", () => {
    const plan = createPlan({ version: "1.0.0", framework: "vitest", files: { "a.js": 1 }, shards: "8" });
    assert.equal(plan.groups.length, 1);
    assert.deepEqual(workerMatrix(plan), [{ shard: 1, name: "1 of 1" }]);
    assert.deepEqual(fileMatrix(plan), [{ shard: 1, files: ["a.js"] }]);
  });

  test("rejects invalid settings and empty selections", () => {
    assert.throws(() => createPlan({ version: "1", framework: "vitest", files, shards: 257 }), /at most 256 shards/u);
    assert.throws(() => createPlan({ version: "1", framework: "mocha", files }), /Unsupported test framework "mocha"; expected vitest, jest, or node\./u);
    assert.throws(() => createPlan({ version: "1", framework: "vitest", files: {} }), /No vitest test files were found\./u);
    assert.throws(() => createPlan({ version: "1", framework: "jest", files: {}, pattern: "x/*.js" }), /No test files match "x\/\*\.js"\./u);
  });

  test("round-trips, fingerprints, and validates serialized plans", () => {
    assert.deepEqual(createPlan({ version: "1.0.0", framework: "vitest", files }).testWrapper, []);
    const plan = createPlan({ version: "1.0.0", framework: "vitest", files, shards: 2, testArgs: ["--ci"], testWrapper: ["c8"] });
    assert.deepEqual(plan.testWrapper, ["c8"]);
    assert.throws(() => parsePlan(JSON.stringify({ ...plan, testWrapper: "c8" })), /The test wrapper must be a JSON array/u);
    const text = formatPlan(plan);
    assert.deepEqual(parsePlan(text), plan);
    assert.match(fingerprint(text), /^[0-9a-f]{64}$/u);
    assert.notEqual(fingerprint(text), fingerprint(formatPlan({ ...plan, testArgs: [] })));
    for (const broken of [{ ...plan, testlanes: 1 }, { ...plan, groups: [] }, { ...plan, groups: [["missing.js"]] }, { ...plan, files: null }]) {
      assert.throws(() => parsePlan(JSON.stringify(broken)), /The shard plan is malformed\./u);
    }
    assert.throws(() => parsePlan(JSON.stringify({ ...plan, framework: "mocha" })), /Unsupported test framework/u);
    assert.throws(() => parsePlan(JSON.stringify({ ...plan, files: { "../a.js": 1 }, groups: [["../a.js"]] })), /relative repository path/u);
  });
});

describe("frameworks", () => {
  test("builds listing and run arguments", () => {
    assert.deepEqual(frameworks.vitest.listArgs(["--project", "a"]), ["list", "--filesOnly", "--json", "--project", "a"]);
    assert.deepEqual(frameworks.vitest.runArgs(["/r/a.js"], ["--bail=1"]).slice(0, 2), ["run", "/r/a.js"]);
    assert.deepEqual(frameworks.jest.runArgs(["/r/a.js"], ["--ci"]).slice(-4), ["--ci", "--runTestsByPath", "--", "/r/a.js"]);
    assert.equal(framework("jest"), frameworks.jest);
    const node = frameworks.node.runArgs(["/r/a.test.js"], ["--test-concurrency=2"]);
    assert.deepEqual(node.slice(0, 3), ["--test", "--test-reporter=spec", "--test-reporter-destination=stdout"]);
    assert.match(node[3], /^--test-reporter=.+node\.js$/u);
    assert.deepEqual(node.slice(4), ["--test-reporter-destination=stderr", "--test-concurrency=2", "/r/a.test.js"]);
    assert.equal(frameworks.node.listArgs, null);
    assert.deepEqual(frameworks.node.parseList("ignored"), []);
    assert.deepEqual(frameworks.node.command("/r"), [process.execPath]);
    assert.deepEqual(frameworks.node.environment?.({ NODE_TEST_CONTEXT: "child-v8", PATH: "/bin" }), { PATH: "/bin" });
  });

  test("matches the default node --test patterns", () => {
    const patterns = nodeTestPatterns();
    assert.equal(patterns.length, 6);
    assert.ok(patterns.includes("**/test/**/*." + (process.features.typescript ? "{cjs,mjs,js,cts,mts,ts}" : "{cjs,mjs,js}")));
  });

  test("parses runner listings and rejects unexpected output", () => {
    assert.deepEqual(frameworks.vitest.parseList('[{"file":"/r/a.js"}]'), ["/r/a.js"]);
    assert.deepEqual(frameworks.jest.parseList('["/r/a.js"]'), ["/r/a.js"]);
    assert.throws(() => frameworks.vitest.parseList("no"), /Could not parse the vitest test listing as JSON\./u);
    assert.throws(() => frameworks.jest.parseList("{}"), /The jest test listing is not a JSON array\./u);
    assert.throws(() => frameworks.vitest.parseList('[{"name":"x"}]'), /vitest list returned an unexpected entry\./u);
    assert.throws(() => frameworks.vitest.parseList("[null]"), /vitest list returned an unexpected entry\./u);
    assert.throws(() => frameworks.jest.parseList("[1]"), /jest --listTests returned an unexpected entry\./u);
  });

  test("resolves wrapper commands to installed executables or runs them as given", () => {
    assert.deepEqual(wrapperCommand([], import.meta.dirname), []);
    const [node, c8, ...rest] = wrapperCommand(["c8", "--all"], import.meta.dirname);
    assert.equal(node, process.execPath);
    assert.match(c8, /c8[\\/]bin[\\/]c8\.js$/u);
    assert.deepEqual(rest, ["--all"]);
    assert.deepEqual(wrapperCommand(["not-an-installed-package", "-x"], import.meta.dirname), ["not-an-installed-package", "-x"]);
  });

  test("finds installed executables and reports missing ones", async () => {
    assert.match(packageBin("vitest", import.meta.dirname), /vitest\.mjs$/u);
    assert.match(packageBin("jest", import.meta.dirname), /jest\.js$/u);
    const directory = await mkdtemp(join(tmpdir(), "testlanes-bin-"));
    assert.throws(() => packageBin("vitest", directory), /vitest is not installed in .+ or its parent directories\./u);
    const fake = join(directory, "node_modules", "jest");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(fake, { recursive: true }));
    await writeFile(join(fake, "package.json"), '{"bin":{"other":"x.js"}}');
    assert.throws(() => packageBin("jest", directory), /jest does not declare a jest executable\./u);
  });
});
