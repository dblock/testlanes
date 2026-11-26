# Design

## Scope

testlanes splits a Vitest or Jest suite into shards whose measured runtimes are balanced, runs them as GitHub Actions jobs, and keeps per-file timing history in GitHub Actions artifacts. It ports the design of [parallel_tests-ci](https://github.com/dblock/parallel_tests-ci) to JavaScript.

It supports Vitest 3 through 5 and Jest 29 and 30 on GitHub Actions Linux and macOS runners. Non-goals are a hosted service, other CI providers, Windows runners, dynamic queue mode, automatic shard sizing, splitting tests within a file, Yarn Plug'n'Play, and browser end-to-end runners such as Playwright or Cypress. Worker-name templates, environment and secret inputs, extra artifact paths, and node:test support are planned follow-ups.

The source is ESM JavaScript with JSDoc types. `tsc --checkJs` checks types during linting, and generated declarations ship in `types/` without a build step for runtime code. The only runtime dependency is [tinyglobby](https://github.com/SuperchupuDev/tinyglobby), for the optional `pattern`.

## Components

| Component | Behavior |
| --- | --- |
| `testlanes/vitest` reporter | Records each module's environment, preparation, collection, setup, and test time from `onTestModuleEnd` and writes it on `onTestRunEnd`. |
| `testlanes/jest` reporter | Records each file's `perfStats.runtime` from `onTestResult` and writes it on `onRunComplete`. |
| `testlanes plan` | Selects files, chooses a grouping, partitions them, writes `plan.json`, and outputs a matrix. |
| `testlanes run` | Verifies the plan and runs one shard, writing `timings.json` and a `result.json` marker only on success. |
| `testlanes collect` | Validates every shard's newest report and merges their timings into a baseline. |
| `testlanes history` | Finds the newest trusted baseline artifact through the GitHub REST API. |
| `lanes.yml` | Shared reusable workflow running Prepare, Test, and Collect jobs. |
| `vitest.yml`, `jest.yml` | Reusable workflows that select their framework and forward every other input to `lanes.yml`. |
| `action.yml` | Standalone composite action that runs `testlanes plan` and outputs a file matrix. |

Reporters record nothing unless `TESTLANES_TIMINGS` names an output file, which `testlanes run` sets for the runner process. The CLI is installed from the caller's `testlanes` development dependency and run with `npx --no-install`, so workflows never download packages at run time. `lanes.yml` and `action.yml` declare `TESTLANES_VERSION`, and planning fails when it differs from the installed package version.

## File Selection

Without `pattern`, files come from `vitest list --filesOnly --json` or `jest --listTests --json` with `test-args`, so the runner's configuration, projects, and filters apply. A `pattern` is a glob relative to the working directory. Selected paths must be normalized, relative, and inside the working directory; the plan records each file's size in bytes.

Runners are located by walking up from the working directory to `node_modules/<runner>/package.json` and running its declared executable with the current Node.js. Vitest treats file arguments as substring filters and ignores those after `--`, so `run` passes absolute paths before any options. Jest's `--reporters` accepts several values, so files follow `--runTestsByPath --`. Both runners use their default reporter plus the testlanes reporter.

## Partitioning

No maintained npm library implements runtime-weighted multiway partitioning, so testlanes uses a deterministic longest-processing-time greedy split: files are sorted by weight, heaviest first with ties broken by path, and each goes to the lightest shard, preferring shards with fewer files and then lower numbers on ties. Runtime grouping drops stale paths, estimates files without history at the mean known duration, and requires timings for at least half the selected files; below that, `auto` falls back to file sizes and `runtime` fails. The shard count is capped at the file count, so no shard is empty.

## Workflow

| Job | Behavior |
| --- | --- |
| Prepare | Find a timing baseline, write the immutable plan, and emit the `matrix.entry` list of shard numbers and names. |
| Test | Run each planned shard and upload its measurements only if it passes. |
| Collect | Validate and combine all shards' timings, publishing a baseline on default-branch pushes. |

Every job checks out the code without persisting credentials, detects npm, pnpm, or Yarn from the lockfile and `packageManager` field, sets up Node.js from `node-version` or the working directory's version file, and installs dependencies with `install-command` or the detected command. pnpm and Yarn are enabled through a pinned Corepack, and a second `actions/setup-node` call caches their stores once they are available. Third-party actions are pinned by commit.

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

## Trust

PRs, including forks, read history but never supply baselines. `testlanes history` looks through the current workflow's latest 20 successful default-branch push runs, keeps only same-repository push runs, and picks the newest unexpired `<prefix>-timings` artifact; lookup failures are warnings, not errors. Only Collect jobs of default-branch pushes publish baselines. Workflows use `contents: read` and `actions: read`, never execute artifacts, and never use `pull_request_target`. Unusable history is ignored with a warning.

## Artwork

The logo is original, AI-assisted, MIT-licensed artwork without third-party elements: four lanes of differently sized test blocks that all end at the same edge, like shards balanced by runtime. Its greens come from the Test badge, `#28A745` and `#34D058`, with a lighter `#85E89D` and a pale `#F3FBF5` background. `scripts/logo.js` generates `assets/logo.svg` from the lane definitions; edit the script, regenerate the asset with `npm run logo`, and commit both. `test/logo.test.js` checks that the committed asset matches the script and that every lane ends at the same edge. `.gitattributes` keeps SVG line endings stable across platforms.
