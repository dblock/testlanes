import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
    const [packed] = JSON.parse(run(npm, ["pack", "--json", "--pack-destination", workspace], root));
    archive = join(workspace, packed.filename);
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
    "package/package.json",
    "package/src/index.js",
    "package/types/index.d.ts",
  ]);
});

test("installed archive exposes the public entry point and types", async () => {
  const consumer = join(workspace, "consumer");
  run("mkdir", ["-p", consumer], root);
  await writeFile(join(consumer, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
  run(npm, ["install", "--no-audit", "--no-fund", archive], consumer);
  const output = run(process.execPath, ["--input-type=module", "-e", "import { version } from 'testlanes'; console.log(version);"], consumer);
  const manifest = JSON.parse(run(process.execPath, ["-p", "JSON.stringify(require('testlanes/package.json'))"], consumer));
  assert.equal(output.trim(), manifest.version);
  assert.equal(manifest.types, "./types/index.d.ts");
  run(process.execPath, ["-e", "require('node:fs').accessSync(require.resolve('testlanes/package.json').replace('package.json', 'types/index.d.ts'))"], consumer);
});
