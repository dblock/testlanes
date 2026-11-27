<img src="assets/logo.svg" alt="Four lanes of differently sized green test blocks that all end at the same edge" width="160">

# testlanes

[![Test](https://github.com/dblock/testlanes/actions/workflows/test.yml/badge.svg)](https://github.com/dblock/testlanes/actions/workflows/test.yml) [![Lint](https://github.com/dblock/testlanes/actions/workflows/lint.yml/badge.svg)](https://github.com/dblock/testlanes/actions/workflows/lint.yml) [![Package](https://github.com/dblock/testlanes/actions/workflows/package.yml/badge.svg)](https://github.com/dblock/testlanes/actions/workflows/package.yml) [![Coverage](https://coveralls.io/repos/github/dblock/testlanes/badge.svg?branch=master)](https://coveralls.io/github/dblock/testlanes?branch=master)

Runtime-balanced Vitest, Jest, and node:test shards for GitHub Actions, with timing history collected and reused automatically. A JavaScript port of [parallel_tests-ci](https://github.com/dblock/parallel_tests-ci).

## Installation

Add testlanes as a development dependency, pinning the same version as the workflow tag:

```sh
npm install --save-dev testlanes@0.2.0
```

Requires Node.js 22.12 or newer and Vitest 3 to 5, Jest 29 or 30, or the built-in node:test runner, installed with npm, pnpm, or Yarn using a `node_modules` linker.

## Usage

Add `.github/workflows/test.yml`, setting `framework` to `vitest`, `jest`, or `node` for node:test:

```yaml
name: Test
on: [push, pull_request]

permissions:
  contents: read
  actions: read

jobs:
  test:
    name: Test
    uses: dblock/testlanes/.github/workflows/testlanes.yml@v0.2.0
    with:
      framework: vitest
      shards: 8
```

Vitest and Jest test files come from the runner's own listing (`vitest list` or `jest --listTests`), so your configuration's include and exclude settings apply. node:test cannot list files, so testlanes matches the default `node --test` patterns, such as `**/*.test.js` and `**/test/**/*.js`, outside `node_modules`; set `pattern` to select others, for example `test/**/*.test.js`. The first run groups files by size. Each successful push to the default branch records per-file timings, and later runs, including PRs, balance shards by those timings without updating them.

### Benchmarks

Four shards cut [npm-package-release](https://github.com/dblock/npm-package-release)'s slowest test worker from 199 to 90 seconds on Windows and 170 to 57.5 seconds on macOS.

<img src="assets/npm-package-release-benchmarks.png" alt="Slowest worker test time per environment in npm-package-release: unsharded 46 to 199 seconds, and the median of four runs with four shards 31 to 90 seconds." width="640">

Sources: [unsharded run](https://github.com/dblock/npm-package-release/actions/runs/45908637236), [four sharded runs](https://github.com/dblock/npm-package-release/actions/runs/46006042274) of [npm-package-release#69](https://github.com/dblock/npm-package-release/pull/69), and [the blog post](https://code.dblock.org/2026/11/26/automatic-javascript-test-sharding-on-github-actions.html).

### Coverage

Wrap each shard's tests with a coverage tool and upload its report, then send every shard's report to your coverage service from a job of your own. With [c8](https://github.com/bcoe/c8) and [Coveralls](https://coveralls.io), which merges the reports:

```yaml
jobs:
  test:
    name: Test
    uses: dblock/testlanes/.github/workflows/testlanes.yml@v0.2.0
    with:
      framework: node
      test-wrapper: '["c8","--reporter=lcov"]'
      artifacts: coverage/lcov.info

  coverage:
    name: Coverage
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7.0.1
      - uses: actions/download-artifact@v8.0.2
        with:
          pattern: testlanes-artifacts-*
          path: shards
      - id: reports
        run: echo "files=$(find shards -name lcov.info | tr '\n' ' ')" >> "$GITHUB_OUTPUT"
      - uses: coverallsapp/github-action@v2.3.8
        with:
          files: ${{ steps.reports.outputs.files }}
```

### Standalone Shard Matrix Action

If you manage your own jobs, the standalone action only assigns files to shards. Set up Node.js and install dependencies first; your workflow runs the tests and manages timing history.

```yaml
jobs:
  plan:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.plan.outputs.matrix }}
    steps:
      - uses: actions/checkout@v7.0.1
      - uses: actions/setup-node@v7.1.0
      - run: npm ci
      - id: plan
        uses: dblock/testlanes@v0.2.0
        with:
          framework: vitest
          shards: '4'

  test:
    needs: plan
    runs-on: ubuntu-latest
    strategy:
      matrix:
        entry: ${{ fromJSON(needs.plan.outputs.matrix) }}
    steps:
      - uses: actions/checkout@v7.0.1
      - uses: actions/setup-node@v7.1.0
      - run: npm ci
      - env:
          FILES: ${{ join(matrix.entry.files, ' ') }}
        run: npx vitest run $FILES
```

## Configuration

The `testlanes.yml` workflow accepts these inputs.

| Input | Default | Description |
| --- | --- | --- |
| `framework` | | Required: `vitest`, `jest`, or `node`. |
| `shards` | `4` | Number of shards, from 1 to 256, capped at the number of test files. |
| `group-by` | `auto` | `auto` uses timings when at least half the files have them, otherwise file sizes; `filesize` or `runtime` force one mode. |
| `pattern` | | Glob selecting test files relative to the working directory, instead of the runner's listing or the default node:test patterns. |
| `test-args` | `[]` | JSON array of extra runner arguments, used when listing and running tests, such as `'["--project","unit"]'` for Vitest or `'["--test-concurrency=2"]'` for node:test. |
| `test-wrapper` | `[]` | JSON array of a command and arguments that wrap each shard's test run, such as `'["c8","--reporter=lcov"]'` for coverage; an installed package's executable runs with Node.js. |
| `artifacts` | | Paths relative to the repository root uploaded from every shard, even when tests fail, as `<artifact-prefix>-artifacts-<shard>`. |
| `working-directory` | `.` | Directory containing the project's `package.json`. |
| `node-version` | | Node.js version; empty reads `.nvmrc`, `.node-version`, or `package.json` in the working directory. |
| `install-node-version` | | Node.js version for installing dependencies, planning, and collecting timings; shards switch to `node-version` before `setup` and tests. Empty uses the test Node.js for everything. |
| `install-command` | | Dependency installation command; empty runs `npm ci`, `pnpm install --frozen-lockfile`, or `yarn install` with a frozen lockfile, detected from the lockfile and `packageManager`; run with Bash, or PowerShell on Windows. |
| `setup` | | Shell commands run in each shard after installing dependencies, such as starting services; Bash on Linux and macOS, PowerShell on Windows. |
| `runs-on` | `ubuntu-latest` | Runner label, JSON array of labels such as `'["self-hosted","linux"]'`, or JSON object such as `'{"group":"ci-runners","labels":["linux"]}'` for every job, including self-hosted runners and runner groups on Linux, macOS, and Windows. testlanes' own steps need no shell or preinstalled Node.js, only network access to GitHub and the npm registry; a custom `install-command` or `setup` runs in the runner's default shell, Bash on Linux and macOS or PowerShell on Windows. |
| `timeout-minutes` | `360` | Timeout for each job. |
| `max-parallel` | `256` | Maximum concurrent shards. |
| `fail-fast` | `false` | Cancel other shards when one fails. |
| `artifact-prefix` | `testlanes` | Unique artifact prefix when calling the workflow more than once in a workflow file. |
| `artifact-retention-days` | `30` | Retention for shard results; `0` uses the repository default. |
| `timings-retention-days` | `90` | Retention for trusted timing history; `0` uses the repository default. |

The standalone action accepts `framework` (`vitest`, `jest`, or `node`), `working-directory`, `pattern`, `shards`, `group-by`, `test-args`, and `timings`, an optional testlanes timing file. It outputs `matrix`, an array of `shard` numbers and `files`, and the chosen `group-by`.

Shards run with the runner's default reporter plus the testlanes timing reporter, replacing reporters set in your configuration. Keep the `testlanes` package and workflow or action tag versions matched; planning fails when they differ.

## Contributing

See [Contributing](CONTRIBUTING.md), [Design](DESIGN.md), [Releasing](RELEASING.md), [Changelog](CHANGELOG.md), and [Automated Contributor Instructions](AGENTS.md).

## License

[MIT](LICENSE)
