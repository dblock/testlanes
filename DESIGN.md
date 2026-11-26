# Design

## Scope

testlanes splits a Vitest or Jest suite into shards whose measured runtimes are balanced, runs them as GitHub Actions jobs, and keeps per-file timing history in GitHub Actions artifacts. It ports the design of [parallel_tests-ci](https://github.com/dblock/parallel_tests-ci) to JavaScript.

The first version supports Vitest 3 through 5 and Jest 29 and 30 on GitHub Actions Linux and macOS runners. Non-goals are a hosted service, other CI providers, Windows runners, dynamic queue mode, automatic shard sizing, splitting tests within a file, and browser end-to-end runners such as Playwright or Cypress. Worker-name templates, environment and secret inputs, extra artifact paths, and node:test support are planned follow-ups.

The source is ESM JavaScript with JSDoc types. `tsc --checkJs` checks types during linting, and generated declarations ship in `types/` without a build step for runtime code.

## Components

| Component | Behavior |
| --- | --- |
| `testlanes/vitest` reporter | Records per-file durations from `onTestModuleEnd` when `TESTLANES_TIMINGS` is set. |
| `testlanes/jest` reporter | Records per-file durations from `onTestResult` performance statistics when `TESTLANES_TIMINGS` is set. |
| `testlanes plan` | Discovers files with the runner (`vitest list --filesOnly --json` or `jest --listTests --json`), or with `pattern` when set, and writes the shard plan. |
| `testlanes run` | Verifies the plan and runs one shard's files with `vitest run <files>` or `jest --runTestsByPath <files>`. |
| `testlanes collect` | Validates every shard's timings and merges them into a new baseline. |
| `vitest.yml`, `jest.yml` | Reusable workflows that pass their framework to the shared `lanes.yml`. |
| `action.yml` | Standalone action that plans shards and outputs a matrix without running tests. |

The reporters and CLI come from the caller's `testlanes` development dependency, so the package and workflow tag versions must match; planning fails when they differ.

## Partitioning

No maintained npm library implements runtime-weighted multiway partitioning, so testlanes uses a deterministic longest-processing-time greedy split: files are sorted by weight, heaviest first with ties broken by path, and each goes to the currently lightest shard. Files without history are estimated at the mean known duration. Runtime grouping requires timings for at least half the selected files; below that, `auto` falls back to file sizes and `runtime` fails. The shard count is capped at the number of files, and empty shards are omitted.

## Workflow

| Job | Behavior |
| --- | --- |
| Prepare | Find a timing baseline and emit the `matrix.entry` plan. |
| Test | Run each planned shard and mark it successful only if it passes. |
| Collect | Validate and combine all shards' timings into a baseline. |

The workflows install dependencies with the package manager selected by the lockfile and `packageManager` field, unless `install-command` overrides it, and read the Node.js version from `.nvmrc`, `.node-version`, or `package.json` unless `node-version` is set.

## Trust

PRs, including forks, read history but never supply baselines. Only successful same-repository, same-workflow default-branch push runs are trusted. A SHA256 fingerprint of the plan and the history ties shards together across retries; collection uses each shard's newest successful attempt, and full reruns create a new plan. Workflows use `contents: read` and `actions: read`, never persist checkout credentials, never execute artifacts, and never use `pull_request_target`.
