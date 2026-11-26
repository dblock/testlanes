import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { version } from "../src/index.js";
import { cli, project } from "./support.js";

for (const name of /** @type {const} */ (["vitest", "jest", "node"])) {
  const suffix = name === "node" ? "test.js" : "spec.js";
  describe(`${name} lifecycle`, () => {
    test("plans, runs every shard, collects, and replans by runtime", async () => {
      const cwd = await project(name);
      const work = await mkdtemp(join(tmpdir(), "testlanes-work-"));
      const output = join(work, "github-output");
      await writeFile(output, "");
      const planned = cli(["plan", "--framework", name, "--shards", "2", "--out", join(work, "plan"), "--matrix", "workers", "--expect-version", version], { cwd, env: { GITHUB_OUTPUT: output } });
      assert.equal(planned.code, 0, planned.stderr);
      assert.match(planned.stderr, /Prepared 2 shards of 5 files using filesize grouping\./u);
      assert.deepEqual(JSON.parse(planned.stdout), [{ shard: 1, name: "1 of 2" }, { shard: 2, name: "2 of 2" }]);
      assert.match(await readFile(output, "utf8"), /^matrix=\[.+\]\ngroup-by=filesize\nshards=2\n$/u);

      const plan = JSON.parse(await readFile(join(work, "plan", "plan.json"), "utf8"));
      for (const shard of [1, 2]) {
        const ran = cli(["run", "--plan", join(work, "plan"), "--shard", String(shard), "--attempt", "1", "--out", join(work, "results", `shard-${shard}`)], { cwd });
        assert.equal(ran.code, 0, ran.stderr);
        const timings = JSON.parse(await readFile(join(work, "results", `shard-${shard}`, "timings.json"), "utf8"));
        assert.deepEqual(Object.keys(timings).sort(), [...plan.groups[shard - 1]].sort());
        assert.ok(!existsSync(join(work, "results", `shard-${shard}`, "measurements.json")));
      }

      const collected = cli(["collect", "--plan", join(work, "plan"), "--results", join(work, "results"), "--out", join(work, "baseline", "timings.json")], { cwd });
      assert.equal(collected.code, 0, collected.stderr);
      assert.match(collected.stderr, /Collected timings for 5 files\./u);
      const baseline = JSON.parse(await readFile(join(work, "baseline", "timings.json"), "utf8"));
      assert.deepEqual(Object.keys(baseline), ["alpha", "bravo", "charlie", "delta", "nested/echo"].map((spec) => `specs/${spec}.${suffix}`));
      assert.ok(baseline[`specs/alpha.${suffix}`] > baseline[`specs/nested/echo.${suffix}`]);

      const replanned = cli(["plan", "--framework", name, "--shards", "2", "--timings", join(work, "baseline", "timings.json")], { cwd });
      assert.equal(replanned.code, 0, replanned.stderr);
      assert.match(replanned.stderr, /using runtime grouping/u);
      assert.deepEqual(JSON.parse(replanned.stdout).flatMap((/** @type {{ files: string[] }} */ entry) => entry.files).sort(), Object.keys(baseline));
    });

    test("returns the runner exit code and writes no result when tests fail", async () => {
      const cwd = await project(name);
      const work = await mkdtemp(join(tmpdir(), "testlanes-work-"));
      const failing = {
        vitest: 'import { test } from "vitest";\ntest("fails", () => { throw new Error("boom"); });\n',
        jest: 'test("fails", () => { throw new Error("boom"); });\n',
        node: 'import { test } from "node:test";\ntest("fails", () => { throw new Error("boom"); });\n',
      }[name];
      await writeFile(join(cwd, "specs", `alpha.${suffix}`), failing);
      assert.equal(cli(["plan", "--framework", name, "--shards", "1", "--out", join(work, "plan")], { cwd }).code, 0);
      const ran = cli(["run", "--plan", join(work, "plan"), "--shard", "1", "--out", join(work, "result")], { cwd });
      assert.equal(ran.code, 1);
      assert.ok(!existsSync(join(work, "result", "result.json")));
      assert.ok(!existsSync(join(work, "result", "timings.json")));
    });

    test("rejects files that changed after preparation", async () => {
      const cwd = await project(name);
      const work = await mkdtemp(join(tmpdir(), "testlanes-work-"));
      assert.equal(cli(["plan", "--framework", name, "--out", join(work, "plan")], { cwd }).code, 0);
      await rm(join(cwd, "specs", `delta.${suffix}`));
      const ran = cli(["run", "--plan", join(work, "plan"), "--shard", "1", "--out", join(work, "result")], { cwd });
      assert.equal(ran.code, 1);
      assert.match(ran.stderr, /testlanes: Selected test files or sizes changed after preparation\./u);
    });

    test("selects files with a glob pattern", async () => {
      const cwd = await project(name);
      const planned = cli(["plan", "--framework", name, "--pattern", `specs/*.${suffix}`, "--shards", "8"], { cwd });
      assert.equal(planned.code, 0, planned.stderr);
      assert.equal(JSON.parse(planned.stdout).length, 4);
    });
  });
}

describe("run safeguards", () => {
  test("fails when Vitest runs files other than the assigned ones", async () => {
    const cwd = await project("vitest");
    const work = await mkdtemp(join(tmpdir(), "testlanes-work-"));
    // Vitest treats file arguments as substring filters, so a.spec.js also selects a.spec.jsx.
    await writeFile(join(cwd, "specs", "alpha.spec.jsx"), 'import { test } from "vitest";\ntest("x", () => {});\n');
    assert.equal(cli(["plan", "--framework", "vitest", "--shards", "6", "--out", join(work, "plan")], { cwd }).code, 0);
    const plan = JSON.parse(await readFile(join(work, "plan", "plan.json"), "utf8"));
    const shard = plan.groups.findIndex((/** @type {string[]} */ group) => group.includes("specs/alpha.spec.js")) + 1;
    const ran = cli(["run", "--plan", join(work, "plan"), "--shard", String(shard), "--out", join(work, "result")], { cwd });
    assert.equal(ran.code, 1);
    assert.match(ran.stderr, new RegExp(`Shard ${shard} ran .+alpha\\.spec\\.jsx.+ instead of its assigned`, "u"));
  });

  test("rejects plans from other versions and shards outside the plan", async () => {
    const cwd = await project("jest");
    const work = await mkdtemp(join(tmpdir(), "testlanes-work-"));
    assert.equal(cli(["plan", "--framework", "jest", "--shards", "2", "--out", join(work, "plan")], { cwd }).code, 0);
    const outside = cli(["run", "--plan", join(work, "plan"), "--shard", "3", "--out", join(work, "result")], { cwd });
    assert.match(outside.stderr, /Shard 3 is outside the prepared 2 shards\./u);
    const path = join(work, "plan", "plan.json");
    await writeFile(path, JSON.stringify({ ...JSON.parse(await readFile(path, "utf8")), testlanes: "0.0.1" }));
    const stale = cli(["run", "--plan", join(work, "plan"), "--shard", "1", "--out", join(work, "result")], { cwd });
    assert.match(stale.stderr, new RegExp(`prepared by testlanes 0\\.0\\.1, but testlanes ${version.replaceAll(".", "\\.")} is installed\\.`, "u"));
  });

  test("fails when the reporter records nothing", async () => {
    const cwd = await project("jest");
    const work = await mkdtemp(join(tmpdir(), "testlanes-work-"));
    assert.equal(cli(["plan", "--framework", "jest", "--shards", "1", "--out", join(work, "plan")], { cwd }).code, 0);
    // Clearing TESTLANES_TIMINGS inside the runner process disables the reporter.
    const ran = cli(["run", "--plan", join(work, "plan"), "--shard", "1", "--out", join(work, "result")], { cwd, env: { NODE_OPTIONS: "--import=data:text/javascript,process.env.TESTLANES_TIMINGS=''" } });
    assert.equal(ran.code, 1);
    assert.match(ran.stderr, /No timings were recorded by the testlanes jest reporter\./u);
  });
});

describe("command line", () => {
  test("prints the version and help", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "testlanes-cli-"));
    assert.equal(cli(["--version"], { cwd }).stdout, `${version}\n`);
    assert.match(cli(["--help"], { cwd }).stdout, /Usage: testlanes <command>/u);
    const bare = cli([], { cwd });
    assert.equal(bare.code, 1);
    assert.match(bare.stdout, /Commands:/u);
    for (const command of ["plan", "run", "collect", "history"]) {
      const help = cli([command, "--help"], { cwd });
      assert.equal(help.code, 0);
      assert.match(help.stdout, new RegExp(`Usage: testlanes ${command}`, "u"));
    }
  });

  test("reports invalid commands and options", async () => {
    const cwd = await project("vitest");
    /** @type {[string[], RegExp][]} */
    const cases = [
      [["deploy"], /Unknown command "deploy"\./u],
      [["plan", "--bogus"], /Unknown option '--bogus'/u],
      [["plan"], /Missing required option --framework\./u],
      [["plan", "--framework", "vitest", "--matrix", "rows"], /Invalid matrix "rows"; expected files or workers\./u],
      [["plan", "--framework", "vitest", "--test-args=--ci"], /Test arguments must be a JSON array of strings\./u],
      [["plan", "--framework", "vitest", "--test-args", "[1]"], /Test arguments must be a JSON array of strings\./u],
      [["plan", "--framework", "vitest", "--expect-version", "9.9.9"], /version 9\.9\.9 was expected; keep the package and workflow versions matched\./u],
      [["plan", "--framework", "vitest", "--group-by", "runtime"], /Runtime grouping requires timings for at least half the selected files\./u],
      [["plan", "--framework", "vitest", "--pattern", "nothing/*.js"], /No test files match "nothing\/\*\.js"\./u],
      [["plan", "--framework", "vitest", "--test-args", '["--project","missing"]'], /Listing vitest test files failed with exit code 1\./u],
      [["run", "--plan", "x"], /Missing required option --shard\./u],
      [["collect", "--plan", "x", "--results", "y"], /Missing required option --out\./u],
    ];
    for (const [args, message] of cases) {
      const result = cli(args, { cwd });
      assert.equal(result.code, 1, args.join(" "));
      assert.match(result.stderr, message, args.join(" "));
    }
  });

  test("ignores unusable and missing timing history", async () => {
    const cwd = await project("vitest");
    await writeFile(join(cwd, "timings.json"), "{");
    const unusable = cli(["plan", "--framework", "vitest", "--timings", "timings.json"], { cwd });
    assert.equal(unusable.code, 0);
    assert.match(unusable.stderr, /Ignoring unusable timing history: timings\.json is not valid JSON\./u);
    const missing = cli(["plan", "--framework", "vitest", "--timings", "absent.json"], { cwd });
    assert.equal(missing.code, 0);
    assert.match(missing.stderr, /using filesize grouping/u);
  });
});

describe("imported node:test modules", () => {
  test("attributes tests defined in imported modules to the file that ran them", async () => {
    const cwd = await project("node");
    const work = await mkdtemp(join(tmpdir(), "testlanes-work-"));
    await mkdir(join(cwd, "examples"));
    await writeFile(join(cwd, "examples", "shared.test.js"), 'import { test } from "node:test";\ntest("shared", async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });\n');
    await writeFile(join(cwd, "specs", "importer.test.js"), 'import "../examples/shared.test.js";\n');
    assert.equal(cli(["plan", "--framework", "node", "--pattern", "specs/**/*.test.js", "--shards", "1", "--out", join(work, "plan")], { cwd }).code, 0);
    const ran = cli(["run", "--plan", join(work, "plan"), "--shard", "1", "--out", join(work, "result")], { cwd });
    assert.equal(ran.code, 0, ran.stderr);
    const timings = JSON.parse(await readFile(join(work, "result", "timings.json"), "utf8"));
    assert.ok(timings["specs/importer.test.js"] >= 0.02);
    assert.ok(!Object.hasOwn(timings, "examples/shared.test.js"));
  });
});
