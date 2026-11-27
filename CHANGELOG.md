# Changelog

## 0.2.1 (Next)

- [#17](https://github.com/dblock/testlanes/pull/17): Set up Node.js before detecting the package manager, so self-hosted and other runners without Node.js work - [@dblock](https://github.com/dblock).
- [#18](https://github.com/dblock/testlanes/pull/18): Skip the Collect Timings job except on default-branch pushes, which are the only runs that publish timings - [@dblock](https://github.com/dblock).
- [#19](https://github.com/dblock/testlanes/pull/19): Run testlanes' own workflow and action steps on `actions/github-script`, so runners need no shell or preinstalled Node.js unless `install-command` or `setup` is set - [@dblock](https://github.com/dblock).
- [#21](https://github.com/dblock/testlanes/pull/21): Remove the Prepare job: each Test job plans for itself, a Shard Matrix job lists shards and finds the timing baseline once per run without checkout or install, and a Verify Shards job checks that all shards used one plan - [@dblock](https://github.com/dblock).
- [#22](https://github.com/dblock/testlanes/pull/22): Accept a JSON runner group object, such as `{"group":"ci-runners","labels":["linux"]}`, in `runs-on` - [@dblock](https://github.com/dblock).
- [#23](https://github.com/dblock/testlanes/pull/23): Fail with a clear error before spawning a test command over Windows' 32,767-character command-line limit - [@dblock](https://github.com/dblock).
- Your contribution here.

## 0.2.0 (2026/11/27)

- [#9](https://github.com/dblock/testlanes/pull/9): Remove the hard-coded `TESTLANES_VERSION` from the reusable workflow, which runs the caller's installed testlanes, so releases never edit workflow files that the release workflow's `GITHUB_TOKEN` cannot push - [@dblock](https://github.com/dblock).
- [#10](https://github.com/dblock/testlanes/pull/10): Support Windows runners, moving the reusable workflow's logic into `testlanes github` commands so every step runs the same way on Linux, macOS, and Windows - [@dblock](https://github.com/dblock).
- [#11](https://github.com/dblock/testlanes/pull/11): Add `test-wrapper` to run shards behind a command such as c8, and `artifacts` to upload paths such as coverage reports from every shard - [@dblock](https://github.com/dblock).
- [#13](https://github.com/dblock/testlanes/pull/13): Add `install-node-version` to install dependencies with a different Node.js than the one that runs tests - [@dblock](https://github.com/dblock).
- [#15](https://github.com/dblock/testlanes/pull/15): Run the standalone action through `testlanes github matrix` without a version pin, remove the `history` command and the `--expect-version` and `--matrix` options, and stop caching pnpm and Yarn stores - [@dblock](https://github.com/dblock).

## 0.1.0 (2026/11/26)

- [#2](https://github.com/dblock/testlanes/pull/2): Add Vitest and Jest timing reporters, the plan, run, collect, and history CLI, runtime-balanced partitioning, reusable `vitest.yml` and `jest.yml` workflows, and a standalone shard matrix action - [@dblock](https://github.com/dblock).
- [#3](https://github.com/dblock/testlanes/pull/3): Add a generated packed-lanes logo - [@dblock](https://github.com/dblock).
- [#4](https://github.com/dblock/testlanes/pull/4): Add node:test support with a timing reporter, default `node --test` file patterns, and a reusable `node.yml` workflow - [@dblock](https://github.com/dblock).
- [#6](https://github.com/dblock/testlanes/pull/6): Replace the per-framework `vitest.yml`, `jest.yml`, and `node.yml` workflows with a single `testlanes.yml` workflow selected by its required `framework` input - [@dblock](https://github.com/dblock).
- [#7](https://github.com/dblock/testlanes/pull/7): Fix node:test shards failing when a test file imports tests from another module - [@dblock](https://github.com/dblock).
- [#8](https://github.com/dblock/testlanes/pull/8): Release with npm-package-release 0.4.0 through npm Trusted Publishing, keeping workflow and action versions on the package version and README pins on the released version - [@dblock](https://github.com/dblock).
