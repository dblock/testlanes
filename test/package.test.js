import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
let workspace;
let archive;

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

before(async () => {
  workspace = await mkdtemp(join(tmpdir(), "testlanes-package-"));
  // An empty PACKAGE_ARCHIVE is treated as unset and packs a fresh archive.
  const provided = process.env.PACKAGE_ARCHIVE?.trim();
  if (provided) {
    archive = resolve(provided);
  } else {
    // Pack into an empty directory and take the only archive, rather than parsing `npm pack --json`,
    // whose shape differs between npm 11 and npm 12 (the release workflow's npm).
    const destination = join(workspace, "pack");
    await mkdir(destination);
    run(npm, ["pack", "--pack-destination", destination], root);
    const archives = (await readdir(destination)).filter((name) => name.endsWith(".tgz"));
    assert.equal(archives.length, 1, `npm pack must produce one archive, found: ${archives.join(", ")}`);
    archive = join(destination, archives[0]);
  }
});

after(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

test("archive contains only the published files", () => {
  const files = run("tar", ["-tzf", archive], root).trim().split("\n").sort();
  assert.deepEqual(files, [
    "package/CHANGELOG.md",
    "package/DESIGN.md",
    "package/LICENSE",
    "package/README.md",
    "package/assets/logo.svg",
    "package/bin/testlanes.js",
    "package/package.json",
    "package/src/cli.js",
    "package/src/collect.js",
    "package/src/discover.js",
    "package/src/frameworks.js",
    "package/src/github.js",
    "package/src/index.js",
    "package/src/partition.js",
    "package/src/paths.js",
    "package/src/plan.js",
    "package/src/reporters/jest.js",
    "package/src/reporters/node.js",
    "package/src/reporters/record.js",
    "package/src/reporters/vitest.js",
    "package/src/run.js",
    "package/src/timings.js",
    "package/types/cli.d.ts",
    "package/types/collect.d.ts",
    "package/types/discover.d.ts",
    "package/types/frameworks.d.ts",
    "package/types/github.d.ts",
    "package/types/index.d.ts",
    "package/types/partition.d.ts",
    "package/types/paths.d.ts",
    "package/types/plan.d.ts",
    "package/types/reporters/jest.d.ts",
    "package/types/reporters/node.d.ts",
    "package/types/reporters/record.d.ts",
    "package/types/reporters/vitest.d.ts",
    "package/types/run.d.ts",
    "package/types/timings.d.ts",
  ]);
});

test("installed archive exposes the CLI, entry points, and types", async () => {
  const consumer = join(workspace, "consumer");
  await mkdir(consumer);
  await writeFile(join(consumer, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
  run(npm, ["install", "--no-audit", "--no-fund", archive], consumer);
  const manifest = JSON.parse(await readFile(join(consumer, "node_modules", "testlanes", "package.json"), "utf8"));
  assert.equal(run(npm, ["exec", "--no", "--", "testlanes", "--version"], consumer).trim(), manifest.version);
  const script = [
    "import { version } from 'testlanes';",
    "import Vitest from 'testlanes/vitest';",
    "import Jest from 'testlanes/jest';",
    "import node from 'testlanes/node';",
    "console.log(JSON.stringify([version, typeof Vitest.prototype.onTestModuleEnd, typeof Jest.prototype.onTestResult, typeof node]));",
  ].join("\n");
  assert.deepEqual(JSON.parse(run(process.execPath, ["--input-type=module", "-e", script], consumer)), [manifest.version, "function", "function", "function"]);
  for (const entry of [".", "./vitest", "./jest", "./node"]) {
    await access(join(consumer, "node_modules", "testlanes", manifest.exports[entry].types));
  }
});
