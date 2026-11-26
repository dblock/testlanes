import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, test } from "node:test";
import { collect } from "../src/collect.js";
import { createPlan, fingerprint, formatPlan } from "../src/plan.js";

describe("collect", () => {
  /** @type {string} */
  let work;
  /** @type {string} */
  let id;

  /**
   * @param {string} name
   * @param {object} result
   * @param {Record<string, number>} timings
   */
  async function report(name, result, timings) {
    const directory = join(work, "results", name);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "result.json"), JSON.stringify(result));
    await writeFile(join(directory, "timings.json"), JSON.stringify(timings));
  }

  const options = () => ({ plan: join(work, "plan"), results: join(work, "results"), out: join(work, "baseline", "timings.json") });

  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "testlanes-collect-"));
    const text = formatPlan(createPlan({ version: "1.0.0", framework: "vitest", files: { "a.js": 2, "b.js": 1 }, shards: 2 }));
    id = fingerprint(text);
    await mkdir(join(work, "plan"));
    await writeFile(join(work, "plan", "plan.json"), text);
  });

  test("merges the newest successful attempt of every shard", async () => {
    await report("shard-1-1", { plan: id, shard: 1, attempt: 1 }, { "a.js": 9 });
    await report("shard-1-2", { plan: id, shard: 1, attempt: 2 }, { "a.js": 3 });
    await report("shard-2-1", { plan: id, shard: 2, attempt: 1 }, {});
    await report("other-plan", { plan: "f".repeat(64), shard: 3, attempt: 1 }, { "zzz.js": 1 });
    assert.deepEqual(await collect(options()), { "a.js": 3 });
    assert.equal(await readFile(join(work, "baseline", "timings.json"), "utf8"), '{\n  "a.js": 3\n}\n');
  });

  test("requires a report for every shard", async () => {
    await report("shard-1-1", { plan: id, shard: 1, attempt: 1 }, { "a.js": 1 });
    await assert.rejects(collect(options()), /Incomplete or unexpected shard reports\./u);
  });

  test("rejects shards outside the plan", async () => {
    await report("shard-1-1", { plan: id, shard: 1, attempt: 1 }, { "a.js": 1 });
    await report("shard-2-1", { plan: id, shard: 2, attempt: 1 }, { "b.js": 1 });
    await report("shard-3-1", { plan: id, shard: 3, attempt: 1 }, {});
    await assert.rejects(collect(options()), /Incomplete or unexpected shard reports\./u);
  });

  test("rejects duplicate reports for the newest attempt", async () => {
    await report("shard-1-2-a", { plan: id, shard: 1, attempt: 2 }, { "a.js": 1 });
    await report("shard-1-2-b", { plan: id, shard: 1, attempt: 2 }, { "a.js": 2 });
    await report("shard-2-1", { plan: id, shard: 2, attempt: 1 }, { "b.js": 1 });
    await assert.rejects(collect(options()), /Duplicate reports for shard 1 attempt 2\./u);
  });

  test("rejects timings for files assigned to other shards", async () => {
    await report("shard-1-1", { plan: id, shard: 1, attempt: 1 }, { "b.js": 1 });
    await report("shard-2-1", { plan: id, shard: 2, attempt: 1 }, { "b.js": 1 });
    await assert.rejects(collect(options()), /Shard 1 reported a timing for unassigned file b\.js\./u);
  });

  test("rejects invalid attempts and empty measurements", async () => {
    await report("shard-1-x", { plan: id, shard: 1, attempt: "x" }, {});
    await report("shard-2-1", { plan: id, shard: 2, attempt: 1 }, {});
    await assert.rejects(collect(options()), /Expected attempt to be a positive integer\./u);
    await report("shard-1-x", { plan: id, shard: 1, attempt: 1 }, {});
    await assert.rejects(collect(options()), /No test timings were recorded\./u);
  });
});
