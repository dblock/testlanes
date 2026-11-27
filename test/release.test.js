import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

// npm-package-release requires Node.js ^22.14.0 || ^24 || >=26; testlanes itself supports 22.12.
const [major, minor] = process.versions.node.split(".").map(Number);
const supportsRelease = (major === 22 && minor >= 14) || major === 24 || major >= 26;

test("the release configuration publishes the validated archive and keeps pins on released versions", {
  skip: !supportsRelease,
  timeout: 300_000,
}, async (t) => {
  const { ReleaseTestProject } = await import("npm-package-release/testing");
  const { createReleaseWorkflow } = await import("../npr.config.js");
  const project = await ReleaseTestProject.create();
  t.after(() => project.dispose());
  const root = fileURLToPath(new URL("../", import.meta.url));
  await project.copyFiles(root, [
    ".gitignore", "README.md", "LICENSE", "DESIGN.md", "tsconfig.json", "action.yml",
    ".github/workflows/testlanes.yml", "assets/logo.svg", "test/package.test.js",
  ]);
  await project.copyFiles(root, "{bin,src}/**/*.js");
  await project.write("CHANGELOG.md", [
    "# Changelog", "", "## 0.1.0 (Next)", "",
    "- Exercise the release workflow.", "- Your contribution here.", "",
  ].join("\n"));
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const { typescript, "@types/node": types } = manifest.devDependencies;
  await project.write("package.json", JSON.stringify({
    ...manifest,
    version: "0.1.0",
    scripts: {
      test: "node --check src/index.js",
      lint: "node --check src/cli.js",
      types: manifest.scripts.types,
      prepack: manifest.scripts.prepack,
      "package:check": manifest.scripts["package:check"],
    },
    devDependencies: { typescript, "@types/node": types },
  }));
  await project.run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"]);
  await project.commit();
  const released = "0.1.0";
  const workflow = createReleaseWorkflow(project.services);
  const prepared = await workflow.prepare({ ...project.options, version: released });
  assert.equal(await project.publisher.view(manifest.name, released), null);
  const result = await workflow.run({ ...project.options, version: released, env: prepared.runtime.env });
  assert.equal(result.verification, "verified");

  const tag = `v${released}`;
  const releaseNotes = await project.remoteFile(tag, "CHANGELOG.md");
  assert.match(releaseNotes, /^## 0\.1\.0 \(\d{4}\/\d{2}\/\d{2}\)$/mu);
  assert.doesNotMatch(releaseNotes, /Your contribution here/u);
  assert.equal(JSON.parse(await project.remoteFile(tag, "package.json")).version, released);
  assert.equal(JSON.parse(await project.remoteFile("master", "package.json")).version, "0.1.1");
  assert.match(await project.remoteFile("master", "CHANGELOG.md"),
    /^## 0\.1\.1 \(Next\)\n\n- Your contribution here\./mu);

  // GITHUB_TOKEN cannot push workflow files, so neither release commit may change one.
  const changed = (await project.git("diff", "--name-only", result.initialCommit, "master")).trim().split(/\r?\n/u);
  assert.ok(changed.length > 0);
  assert.deepEqual(changed.filter((path) => path.startsWith(".github/workflows/") || path === "action.yml"), []);
  // README pins that callers copy always name the published version.
  for (const ref of [tag, "master"]) {
    const readme = await project.remoteFile(ref, "README.md");
    assert.match(readme, /npm install --save-dev testlanes@0\.1\.0\n/u, ref);
    assert.match(readme, /dblock\/testlanes\/\.github\/workflows\/testlanes\.yml@v0\.1\.0\n/u, ref);
    assert.match(readme, /dblock\/testlanes@v0\.1\.0\n/u, ref);
  }

  const archive = await readFile(project.publisher.archive(manifest.name, released));
  assert.deepEqual(archive, await readFile(project.host.archive(manifest.name, released)));
  assert.deepEqual(archive, await readFile(join(project.artifacts, result.artifact.filename)));
  assert.equal(await project.git("status", "--porcelain"), "");
});
