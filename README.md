<img src="assets/logo.svg" alt="Four lanes of differently sized green test blocks that all end at the same edge" width="160">

# testlanes

[![Test](https://github.com/dblock/testlanes/actions/workflows/test.yml/badge.svg)](https://github.com/dblock/testlanes/actions/workflows/test.yml) [![Lint](https://github.com/dblock/testlanes/actions/workflows/lint.yml/badge.svg)](https://github.com/dblock/testlanes/actions/workflows/lint.yml) [![Package](https://github.com/dblock/testlanes/actions/workflows/package.yml/badge.svg)](https://github.com/dblock/testlanes/actions/workflows/package.yml) [![Coverage](https://coveralls.io/repos/github/dblock/testlanes/badge.svg?branch=master)](https://coveralls.io/github/dblock/testlanes?branch=master)

Runtime-balanced Vitest and Jest shards for GitHub Actions, with timing history collected and reused automatically. A JavaScript port of [parallel_tests-ci](https://github.com/dblock/parallel_tests-ci).

## Installation

testlanes has not been published yet. Once released, add it as a development dependency, pinning the same version as the workflow tag:

```sh
npm install --save-dev testlanes@0.1.0
```

Requires Node.js 22.12 or newer and Vitest 3 to 5 or Jest 29 or 30, installed with npm, pnpm, or Yarn using a `node_modules` linker.

## Usage

### Vitest

Add `.github/workflows/test.yml`:

```yaml
name: Test
on: [push, pull_request]

permissions:
  contents: read
  actions: read

jobs:
  test:
    name: Test
    uses: dblock/testlanes/.github/workflows/vitest.yml@v0.1.0
    with:
      shards: 8
```

### Jest

Use the Jest workflow instead:

```yaml
jobs:
  test:
    name: Test
    uses: dblock/testlanes/.github/workflows/jest.yml@v0.1.0
    with:
      shards: 8
```

Test files come from the runner's own listing (`vitest list` or `jest --listTests`), so your configuration's include and exclude settings apply. The first run groups files by size. Each successful push to the default branch records per-file timings, and later runs, including PRs, balance shards by those timings without updating them.

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
        uses: dblock/testlanes@v0.1.0
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

The `vitest.yml` and `jest.yml` workflows accept these inputs.

| Input | Default | Description |
| --- | --- | --- |
| `shards` | `4` | Number of shards, from 1 to 256, capped at the number of test files. |
| `group-by` | `auto` | `auto` uses timings when at least half the files have them, otherwise file sizes; `filesize` or `runtime` force one mode. |
| `pattern` | | Glob selecting test files relative to the working directory, instead of the runner's listing. |
| `test-args` | `[]` | JSON array of extra runner arguments, used when listing and running tests, such as `'["--project","unit"]'`. |
| `working-directory` | `.` | Directory containing the project's `package.json`. |
| `node-version` | | Node.js version; empty reads `.nvmrc`, `.node-version`, or `package.json` in the working directory. |
| `install-command` | | Dependency installation command; empty runs `npm ci`, `pnpm install --frozen-lockfile`, or `yarn install` with a frozen lockfile, detected from the lockfile and `packageManager`. |
| `setup` | | Shell commands run in each shard after installing dependencies, such as starting services. |
| `runs-on` | `ubuntu-latest` | Runner label or JSON array of labels for every job; Linux and macOS are supported. |
| `timeout-minutes` | `360` | Timeout for each job. |
| `max-parallel` | `256` | Maximum concurrent shards. |
| `fail-fast` | `false` | Cancel other shards when one fails. |
| `artifact-prefix` | `testlanes` | Unique artifact prefix when calling the workflow more than once in a workflow file. |
| `artifact-retention-days` | `30` | Retention for plans and shard results; `0` uses the repository default. |
| `timings-retention-days` | `90` | Retention for trusted timing history; `0` uses the repository default. |

The standalone action accepts `framework` (`vitest` or `jest`), `working-directory`, `pattern`, `shards`, `group-by`, `test-args`, and `timings`, an optional testlanes timing file. It outputs `matrix`, an array of `shard` numbers and `files`, and the chosen `group-by`.

Shards run with the runner's default reporter plus the testlanes timing reporter, replacing reporters set in your configuration. Keep the `testlanes` package and workflow or action tag versions matched; planning fails when they differ.

## Contributing

See [Contributing](CONTRIBUTING.md), [Design](DESIGN.md), [Releasing](RELEASING.md), [Changelog](CHANGELOG.md), and [Automated Contributor Instructions](AGENTS.md).

## License

[MIT](LICENSE)
