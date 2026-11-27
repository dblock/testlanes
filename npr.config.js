import { HookValidator, IntrideaChangelog, ReleaseWorkflow } from "npm-package-release";

const version = String.raw`(?<version>\d+\.\d+\.\d+)`;

/**
 * README pins that callers copy always name a published version, in both commits. Neither
 * release commit changes the reusable workflow or the action, which run the caller's installed
 * testlanes and carry no version; the release workflow's `GITHUB_TOKEN` cannot push workflow files.
 */
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
