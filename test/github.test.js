import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { artifactPrefix, findHistory, writeOutputs } from "../src/github.js";
import { cliAsync as cli } from "./support.js";

describe("github", () => {
  /** @type {import("node:http").Server} */
  let server;
  /** @type {string} */
  let api;
  /** @type {string[]} */
  const requests = [];
  /** @type {Record<string, unknown>} */
  let routes = {};

  before(async () => {
    server = createServer((request, response) => {
      requests.push(`${request.headers.authorization} ${request.url}`);
      const body = routes[/** @type {string} */ (request.url)];
      response.writeHead(body === undefined ? 404 : 200, { "content-type": "application/json" });
      response.end(JSON.stringify(body ?? { message: "Not Found" }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
    const address = /** @type {import("node:net").AddressInfo} */ (server.address());
    api = `http://127.0.0.1:${address.port}/`;
  });

  after(() => server.close());

  async function environment() {
    const directory = await mkdtemp(join(tmpdir(), "testlanes-github-"));
    const event = join(directory, "event.json");
    await writeFile(event, JSON.stringify({ repository: { default_branch: "main" } }));
    const output = join(directory, "output");
    await writeFile(output, "");
    return { GITHUB_API_URL: api, GITHUB_REPOSITORY: "owner/repo", GITHUB_RUN_ID: "7", GITHUB_TOKEN: "token", GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output };
  }

  const trusted = { event: "push", conclusion: "success", head_branch: "main", head_repository: { full_name: "owner/repo" } };

  test("finds the newest trusted, unexpired baseline", async () => {
    routes = {
      "/repos/owner/repo/actions/runs/7": { workflow_id: 42 },
      "/repos/owner/repo/actions/workflows/42/runs?branch=main&event=push&status=success&per_page=20": {
        workflow_runs: [
          { ...trusted, id: 1, head_repository: { full_name: "fork/repo" } },
          { ...trusted, id: 2, head_branch: "feature" },
          { ...trusted, id: 3, event: "pull_request" },
          { ...trusted, id: 4, conclusion: "failure" },
          { ...trusted, id: 5 },
          { ...trusted, id: 6 },
        ],
      },
      "/repos/owner/repo/actions/runs/5/artifacts?name=lanes-timings&per_page=100": { artifacts: [{ id: 50, name: "lanes-timings", expired: true }] },
      "/repos/owner/repo/actions/runs/6/artifacts?name=lanes-timings&per_page=100": { artifacts: [{ id: 60, name: "lanes-timings", expired: false }] },
    };
    const env = await environment();
    assert.deepEqual(await findHistory({ prefix: "lanes", env }), { run: 6, artifact: 60 });
    assert.ok(requests.every((line) => line.startsWith("Bearer token ")));
    assert.ok(!requests.some((line) => /runs\/[1-4]\/artifacts/u.test(line)));

    const result = await cli(["history", "--prefix", "lanes"], { cwd: tmpdir(), env });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /Found timing history in run 6\./u);
    assert.equal(await readFile(env.GITHUB_OUTPUT, "utf8"), "history-run=6\nhistory-artifact=60\n");
  });

  test("reports no history and API failures without failing", async () => {
    routes = {
      "/repos/owner/repo/actions/runs/7": { workflow_id: 42 },
      "/repos/owner/repo/actions/workflows/42/runs?branch=main&event=push&status=success&per_page=20": { workflow_runs: [] },
    };
    const env = await environment();
    assert.equal(await findHistory({ prefix: "lanes", env }), undefined);
    const none = await cli(["history", "--prefix", "lanes"], { cwd: tmpdir(), env });
    assert.equal(none.code, 0);
    assert.match(none.stderr, /No trusted timing history was found\./u);
    routes = {};
    const failed = await cli(["history"], { cwd: tmpdir(), env });
    assert.equal(failed.code, 0);
    assert.match(failed.stderr, /Timing history unavailable: GitHub API request for repos\/owner\/repo\/actions\/runs\/7 failed with status 404\./u);
    assert.equal(await readFile(env.GITHUB_OUTPUT, "utf8"), "");
  });

  test("requires GitHub environment and event metadata", async () => {
    const env = await environment();
    await assert.rejects(findHistory({ prefix: "lanes", env: { ...env, GITHUB_REPOSITORY: "" } }), /GITHUB_REPOSITORY is not set\./u);
    await writeFile(env.GITHUB_EVENT_PATH, "{}");
    await assert.rejects(findHistory({ prefix: "lanes", env }), /does not name the default branch\./u);
  });

  test("validates prefixes and outputs", async () => {
    assert.equal(artifactPrefix("a_b-1"), "a_b-1");
    for (const value of ["", "-a", "a b", "a/b", 1]) assert.throws(() => artifactPrefix(value), /Artifact prefix must contain only letters/u);
    const env = await environment();
    await writeOutputs({ a: 1 }, { GITHUB_OUTPUT: "" });
    await assert.rejects(writeOutputs({ a: "x\ny" }, env), /Output a must be a single line\./u);
    const result = await cli(["history", "--prefix", "bad prefix"], { cwd: tmpdir(), env });
    assert.match(result.stderr, /Timing history unavailable: Artifact prefix must contain only letters/u);
  });
});
