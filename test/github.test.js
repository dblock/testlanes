import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { artifactPrefix, writeOutputs } from "../src/github.js";
import { cliAsync as cli } from "./support.js";

describe("github", () => {
  test("validates prefixes and outputs", async () => {
    assert.equal(artifactPrefix("a_b-1"), "a_b-1");
    for (const value of ["", "-a", "a b", "a/b", 1]) assert.throws(() => artifactPrefix(value), /Artifact prefix must contain only letters/u);
    const output = join(await mkdtemp(join(tmpdir(), "testlanes-github-")), "output");
    await writeFile(output, "");
    await writeOutputs({ a: 1 }, { GITHUB_OUTPUT: "" });
    await assert.rejects(writeOutputs({ a: "x\ny" }, { GITHUB_OUTPUT: output }), /Output a must be a single line\./u);
    const result = await cli(["github", "run"], { cwd: tmpdir(), env: { TESTLANES_INPUTS: '{"artifact-prefix":"bad prefix"}', RUNNER_TEMP: tmpdir(), TESTLANES_SHARD: "1" } });
    assert.match(result.stderr, /testlanes: Artifact prefix must contain only letters/u);
  });
});
