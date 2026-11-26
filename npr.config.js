import { HookValidator, IntrideaChangelog, ReleaseWorkflow } from "npm-package-release";

const version = String.raw`(?<version>\d+\.\d+\.\d+)`;
const testlanesVersion = new RegExp(String.raw`TESTLANES_VERSION: ${version}\n`, "u");

/**
 * The workflow and action pass `TESTLANES_VERSION` to `--expect-version`, and this repository's
 * integration workflows run them against its own package, so it follows the package version: the
 * release tag names the released version and the next-development commit names the next one.
 */
export const versionReferences = Object.freeze({
  ".github/workflows/testlanes.yml": [testlanesVersion],
  "action.yml": [testlanesVersion],
});

/** README pins that callers copy always name a published version, in both commits. */
export const releaseReferences = Object.freeze({
  "README.md": [
    new RegExp(String.raw`npm install --save-dev testlanes@${version}(?![\w.+-])`, "u"),
    new RegExp(String.raw`dblock/testlanes/\.github/workflows/testlanes\.yml@v${version}(?![\w.+-])`, "u"),
    new RegExp(String.raw`dblock/testlanes@v${version}(?![\w.+-])`, "u"),
  ],
});

/**
 * Creates the release workflow. Tests pass simulated services; releases use the defaults.
 * @param {object} [services] Replacement services for simulated releases.
 * @returns {ReleaseWorkflow} The configured workflow.
 */
export function createReleaseWorkflow(services = {}) {
  return new ReleaseWorkflow({
    changelog: new IntrideaChangelog("CHANGELOG.md"),
    versionReferences,
    releaseReferences,
    validator: new HookValidator({
      async validateArtifact({ archive, run }) {
        await run("npm", ["run", "package:check"], {
          env: { PACKAGE_ARCHIVE: archive },
        });
      },
    }),
    ...services,
  });
}

export default createReleaseWorkflow();
