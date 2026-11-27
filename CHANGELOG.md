# Changelog

## 0.2.0 (Next)

- [#9](https://github.com/dblock/testlanes/pull/9): Remove the hard-coded `TESTLANES_VERSION` from the reusable workflow, which runs the caller's installed testlanes, so releases never edit workflow files that the release workflow's `GITHUB_TOKEN` cannot push - [@dblock](https://github.com/dblock).
- [#10](https://github.com/dblock/testlanes/pull/10): Support Windows runners, moving the reusable workflow's logic into `testlanes github` commands so every step runs the same way on Linux, macOS, and Windows - [@dblock](https://github.com/dblock).
- [#11](https://github.com/dblock/testlanes/pull/11): Add `test-wrapper` to run shards behind a command such as c8, and `artifacts` to upload paths such as coverage reports from every shard - [@dblock](https://github.com/dblock).
- Your contribution here.

## 0.1.0 (2026/11/26)

- [#2](https://github.com/dblock/testlanes/pull/2): Add Vitest and Jest timing reporters, the plan, run, collect, and history CLI, runtime-balanced partitioning, reusable `vitest.yml` and `jest.yml` workflows, and a standalone shard matrix action - [@dblock](https://github.com/dblock).
- [#3](https://github.com/dblock/testlanes/pull/3): Add a generated packed-lanes logo - [@dblock](https://github.com/dblock).
- [#4](https://github.com/dblock/testlanes/pull/4): Add node:test support with a timing reporter, default `node --test` file patterns, and a reusable `node.yml` workflow - [@dblock](https://github.com/dblock).
- [#6](https://github.com/dblock/testlanes/pull/6): Replace the per-framework `vitest.yml`, `jest.yml`, and `node.yml` workflows with a single `testlanes.yml` workflow selected by its required `framework` input - [@dblock](https://github.com/dblock).
- [#7](https://github.com/dblock/testlanes/pull/7): Fix node:test shards failing when a test file imports tests from another module - [@dblock](https://github.com/dblock).
- [#8](https://github.com/dblock/testlanes/pull/8): Release with npm-package-release 0.4.0 through npm Trusted Publishing, keeping workflow and action versions on the package version and README pins on the released version - [@dblock](https://github.com/dblock).
