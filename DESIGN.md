# Design

## Scope

testlanes splits a Vitest, Jest, or node:test suite into shards whose measured runtimes are balanced, runs them as GitHub Actions jobs, and keeps per-file timing history in GitHub Actions artifacts. It ports the design of [parallel_tests-ci](https://github.com/dblock/parallel_tests-ci) to JavaScript.

It supports Vitest 3 through 5, Jest 29 and 30, and node:test on Node.js 22.12 or newer on GitHub Actions Linux, macOS, and Windows runners. Non-goals are a hosted service, other CI providers, dynamic queue mode, automatic shard sizing, splitting tests within a file, Yarn Plug'n'Play, and browser end-to-end runners such as Playwright or Cypress. Worker-name templates, environment and secret inputs, and extra artifact paths are planned follow-ups.

The source is ESM JavaScript with JSDoc types. `tsc --checkJs` checks types during linting, and generated declarations ship in `types/` without a build step for runtime code. The only runtime dependency is [tinyglobby](https://github.com/SuperchupuDev/tinyglobby), for the optional `pattern`.

## Components

| Component | Behavior |
| --- | --- |
| `testlanes/vitest` reporter | Records each module's environment, preparation, collection, setup, and test time from `onTestModuleEnd` and writes it on `onTestRunEnd`. |
| `testlanes/jest` reporter | Records each file's `perfStats.runtime` from `onTestResult` and writes it on `onRunComplete`. |
| `testlanes/node` reporter | Records each file's duration from the top-level `test:complete` event that `node --test` emits per file, ignoring tests defined in imported modules, which report the imported module's path; without per-file events, it sums each file's top-level tests. |
| `testlanes plan` | Selects files, chooses a grouping, partitions them, writes `plan.json`, and outputs a matrix. |
| `testlanes run` | Verifies the plan and runs one shard, writing `timings.json` and a `result.json` marker only on success. |
| `testlanes collect` | Validates every shard's newest report and merges their timings into a baseline. |
| `testlanes.yml` | Reusable workflow running Prepare, Test, and Collect jobs for the framework selected by its required `framework` input. |
| `testlanes github` | Runs the reusable workflow's history, prepare, run, and collect steps and the action's matrix step from `TESTLANES_INPUTS`. |
| `action.yml` | Standalone composite action that runs `testlanes github matrix` and outputs a file matrix. |

Reporters record nothing unless `TESTLANES_TIMINGS` names an output file, which `testlanes run` sets for the runner process. The CLI is installed from the caller's `testlanes` development dependency and run with `npx --no-install`, so workflows never download packages at run time. The reusable workflow and the action carry no version: callers pin their tag and install the matching `testlanes`, and they run the installed version, so keeping the two matched is the caller's responsibility. Releases never edit `.github/workflows/`, which the release workflow's `GITHUB_TOKEN` cannot push, or `action.yml`.

## File Selection

Without `pattern`, files come from `vitest list --filesOnly --json` or `jest --listTests --json` with `test-args`, so the runner's configuration, projects, and filters apply. A `pattern` is a glob relative to the working directory. Selected paths must be normalized, relative, and inside the working directory; the plan records each file's size in bytes.

node:test has no listing command, so without `pattern` testlanes globs the default `node --test` patterns outside `node_modules`, adding TypeScript extensions when `process.features.typescript` shows the running Node.js can strip types. Shards run `node --test` with the spec reporter on standard output and the testlanes reporter, whose destination stays empty because it writes its own file. The runner's environment omits `NODE_TEST_CONTEXT`, because a nested `node --test` that inherits it skips its files.

Vitest and Jest are located by walking up from the working directory to `node_modules/<runner>/package.json` and running its declared executable with the current Node.js. Vitest treats file arguments as substring filters and ignores those after `--`, so `run` passes absolute paths before any options. Jest's `--reporters` accepts several values, so files follow `--runTestsByPath --`. Both runners use their default reporter plus the testlanes reporter.

## Partitioning

No maintained npm library implements runtime-weighted multiway partitioning, so testlanes uses a deterministic longest-processing-time greedy split: files are sorted by weight, heaviest first with ties broken by path, and each goes to the lightest shard, preferring shards with fewer files and then lower numbers on ties. Runtime grouping drops stale paths, estimates files without history at the mean known duration, and requires timings for at least half the selected files; below that, `auto` falls back to file sizes and `runtime` fails. The shard count is capped at the file count, so no shard is empty.

## Workflow

| Job | Behavior |
| --- | --- |
| Prepare | Find a timing baseline, write the immutable plan, and emit the `matrix.entry` list of shard numbers and names. |
| Test | Run each planned shard and upload its measurements only if it passes. |
| Collect | On default-branch pushes only, validate and combine all shards' timings and publish a baseline; other runs skip this job. |

Every job checks out the code without persisting credentials, detects npm, pnpm, or Yarn from the lockfile and `packageManager` field, sets up Node.js from `node-version` or the working directory's version file, and installs dependencies with `install-command` or the detected command. pnpm and Yarn are enabled through a pinned Corepack; only the npm download cache is restored, because `actions/setup-node` cannot locate their stores before Corepack installs them. Third-party actions are pinned by commit.

### Install and Test Node.js

Without `install-node-version`, every job uses `node-version` or the working directory's version file. With it, every job installs dependencies, plans, and collects on `install-node-version`, and Test jobs then set up `node-version` without a package cache before `setup` and the shard run, so projects can install with a newer npm while testing older Node.js releases.

### Plans and Retries

`plan.json` records the testlanes version, framework, pattern, test arguments, grouping, selected file sizes, and each shard's files. Its SHA256 is the plan fingerprint. Workers reject plans from another testlanes version, shards outside the plan, and file selections or sizes that changed after preparation. After a successful run, the files the reporter measured must equal the shard's assigned files.

| Case | Rule |
| --- | --- |
| Failed shard | The runner's exit code is returned; no timings or success marker are written or uploaded. |
| Failed-job retry | Reuse the prepared plan; collection selects the newest attempt for each shard. |
| Duplicate latest attempt | Collection fails rather than choosing arbitrarily. |
| Other plans | Reports with another fingerprint are ignored. |
| Unassigned timing | Collection fails when a shard reports a file assigned elsewhere. |
| Missing timings | Allowed per shard, but collection requires at least one timing overall. |

Artifacts are named `<prefix>-plan-<attempt>`, `<prefix>-shard-<shard>-<attempt>`, and `<prefix>-timings`. Prefixes contain only letters, numbers, underscores, and hyphens.

### Wrappers and Artifacts

`test-wrapper` is stored in the plan, like `test-args`, and prefixes only shard runs, not file listing. When its command names an executable declared by an installed package, such as `c8`, testlanes runs that file with Node.js, which also avoids `.cmd` shims on Windows; other commands run as given. `artifacts` uploads paths from every shard with `if: always()` as `<prefix>-artifacts-<shard>`, overwriting earlier attempts, so a download after retries holds exactly one current set per shard. testlanes does not merge or interpret them; callers send them to coverage or reporting services.

### Workflow Steps

Every step in `testlanes.yml` runs the same way on Linux, macOS, and Windows. testlanes' own steps use [`actions/github-script`](https://github.com/actions/github-script), which runs JavaScript on the Node.js bundled with the Actions runner, so they need no shell and no Node.js on the runner. The testlanes steps run `npx --no-install testlanes github history|prepare|run|collect` with `exec.exec`, and the action's runs `testlanes github matrix`; they read the `toJSON(inputs)` from `TESTLANES_INPUTS` and the shard from `TESTLANES_SHARD`, keep files under `RUNNER_TEMP/testlanes`, validate the artifact prefix, and write step outputs, including artifact names, to `GITHUB_OUTPUT`. Keeping the logic in the CLI avoids duplicating shell code per OS and passing JSON or empty arguments through `npx`, which is a batch shim on Windows. Script files in this repository are not available in a caller's job, so the logic lives in the caller's installed package, as parallel_tests-ci does with `PTCI_INPUTS`.

Package manager detection runs first, before Node.js is set up, as a short `actions/github-script` step that also chooses the version file (`.nvmrc`, `.node-version`, or `package.json`) and lockfile for Set Up Node. Corepack is enabled and the detected install command runs with `exec.exec`. Detection runs once, in Prepare, and passes its results to the Test and Collect jobs as job outputs; every job reads them as `TESTLANES_*` environment variables, so the checkout, Node.js, Corepack, and install steps are defined once with YAML anchors and reused with aliases. `install-command` and `setup` are the caller's own scripts and run as the step body with the runner's default shell, Bash on Linux and macOS and PowerShell on Windows; they are the only steps that need a shell. The CLI resolves its working directory with `realpathSync.native`, because Windows temporary paths may use short names while test runners report long ones; it passes the node:test reporter as a file URL and Vitest forward-slash absolute paths.

## Trust

PRs, including forks, read history but never supply baselines. `testlanes github history` looks through the current workflow's latest 20 successful default-branch push runs, keeps only same-repository push runs, and picks the newest unexpired `<prefix>-timings` artifact; lookup failures are warnings, not errors. Only Collect jobs of default-branch pushes publish baselines. Workflows use `contents: read` and `actions: read`, never execute artifacts, and never use `pull_request_target`. Unusable history is ignored with a warning.

## Artwork

The logo is original, AI-assisted, MIT-licensed artwork without third-party elements: four lanes of differently sized test blocks that all end at the same edge, like shards balanced by runtime. Its greens come from the Test badge, `#28A745` and `#34D058`, with a lighter `#85E89D` and a pale `#F3FBF5` background. `scripts/logo.js` generates `assets/logo.svg` from the lane definitions; edit the script, regenerate the asset with `npm run logo`, and commit both. `test/logo.test.js` checks that the committed asset matches the script and that every lane ends at the same edge. `.gitattributes` keeps SVG line endings stable across platforms.
