# Contributing

Read [Design](DESIGN.md) and [Automated Contributor Instructions](AGENTS.md) before changing code.

## Setup and Validation

Use Node.js `26.13.1` from `.nvmrc` and npm for development. The package supports Node.js 22.12 or newer. Documentation spelling tools require Node.js 22.18 or newer, so run lint on the development version. Verify and prefer current stable releases when selecting or updating dependencies, tools, and GitHub Actions, while keeping the package runtime floor separate from development tool requirements.

```sh
npm ci
npm test
npm run lint
npm run test:coverage
npm run package:check
```

Run `npm test` and `npm run lint` before every push, including PR updates. Run final checks once before committing and reuse their results for the push when the tested content and configuration have not changed. `npm test` already includes the packed-consumer suite; `npm run package:check` runs that suite alone.

`npm run lint` runs three checks. `npm run lint:code` lints source and JavaScript examples in Markdown with ESLint. `npm run lint:types` type-checks the source and its JSDoc annotations with `tsc --checkJs`. `npm run lint:markdown` checks Markdown structure, title-case headings, single-line paragraphs, and spelling with `@eslint/markdown`, `eslint-plugin-markdown-preferences`, `eslint-plugin-markdown-preferences-paragraph`, and `eslint-plugin-prose-spellcheck`, using US English, software terms, and the reviewed `.spellcheck.txt`. Fix typos rather than adding them to the vocabulary.

Keep Markdown paragraphs on one source line. Use title case for Markdown headings and for YAML workflow, job, and step display names, preserving proper names, acronyms, identifiers, and expressions; YAML display names are a convention without a dedicated checker.

Test, Lint, and Package are separate GitHub Actions workflows with least-privilege permissions and npm caching. The Test matrix uses one `matrix.entry` array of explicit inline combinations, without `include` or `exclude`, and covers the supported Node.js floor and current releases; a coverage job reports to Coveralls. Package validates the packed consumer on Linux and macOS. The packed-consumer test lists the archive with `tar` instead of parsing `npm pack --json`, whose output differs between npm 11 and 12, so it also passes under the release workflow's npm. No Danger checks are configured.

## Tests

Tests live in `test/` and use `node --test`.

- `test/core.test.js` covers paths, timings, partitioning, plans, and runner adapters.
- `test/cli.test.js` runs the real CLI as a subprocess against temporary copies of `fixtures/vitest`, `fixtures/jest`, and `fixtures/node`, which resolve the repository's installed Vitest and Jest, covering the full plan, run, and collect lifecycle, failing tests, changed files, Vitest's substring file filters, and error messages.
- `test/collect.test.js` covers retries, duplicate and unassigned reports, and fingerprints.
- `test/github.test.js` serves the GitHub REST API from a local HTTP server.
- `test/reporters.test.js` and `test/workflows.test.js` cover the reporters, the version-free reusable workflow, action, and release references, and the workflow's required and default inputs.
- `test/release.test.js` runs the real release configuration with npm-package-release's simulated registry and GitHub Release host in a temporary repository, checking the published archive, the dated changelog, the next development version, and the version pins in both commits. It is skipped below Node.js 22.14, the release tool's minimum.
- `test/package.test.js` packs the real archive with `npm pack`, checks its exact file list, installs it in a temporary consumer, and runs its CLI and entry points. Set `PACKAGE_ARCHIVE` to validate an existing archive instead; an empty value packs a fresh one.

Vitest and Jest fixture specs use `.spec.js` names, and all fixtures live outside `test/`, so the repository's own `node --test "test/**/*.test.js"` does not run them. CI selects Vitest and Jest versions per Node.js version with `npm install --no-save`, covering Vitest 3, 4, and 5 and Jest 29 and 30. The Test Workflow Integration workflow calls the reusable workflow and standalone action from this repository against the fixtures on Linux, macOS, and Windows; they install the repository with `npm ci --prefix ../..` because the fixtures depend on it through `file:../..`. `fixtures/pnpm` instead uses the reusable workflow's default install, so it exercises package manager detection, Corepack, and `pnpm install --frozen-lockfile`; pnpm installs testlanes and its dependencies from `file:../..` itself. When testlanes' runtime dependencies change, regenerate its lockfile with `npx pnpm@<packageManager version> install --lockfile-only` in `fixtures/pnpm`. Check workflows locally with [actionlint](https://github.com/rhysd/actionlint).

Add focused behavioral tests for new or fixed behavior, including errors and edge cases, and prefer real Vitest and Jest subprocesses and installed-consumer fixtures over mocks. Aim for coverage close to 100% of runtime code, inspect line and branch coverage with `npm run test:coverage`, and report gaps rather than adding trivial assertions or excluding real code.

## Pull Requests

For artwork changes, follow [Artwork](DESIGN.md#artwork): edit `scripts/logo.js`, run `npm run logo`, and check the full-size SVG and the 160-pixel README rendering.

Work on a `<username>/<topic>` topic branch, such as `dblock/implementation`, in the main checkout; use a sibling worktree such as `../implementation` only for work that runs in parallel. Split multiple changes into small stacked PRs, each targeting the branch below it, and register stacks with `gh stack link`. Keep each PR to one coherent commit relative to its base, amend and update task-owned branches with `--force-with-lease`, and never force-push `master`. PRs are merged with rebase merges only; do not merge without approval.

Update affected documentation. Add a CHANGELOG entry for features, improvements, and fixes, but not minor typos, as `- [#123](https://github.com/dblock/testlanes/pull/123): Description - [@username](https://github.com/username).`, above `- Your contribution here.` in the Next section, oldest first. Verify the PR number after opening and correct the entry if needed.

Features increment the minor version in the same PR, resetting patch while in `0.x`; keep an unreleased version unchanged. Synchronize `package.json` and `package-lock.json`. The README pins stay on the latest released version, and releases update all of them; see [Version Pins](RELEASING.md#version-pins). Use closing issue references, include an AI co-author trailer in AI-assisted commits, and disclose AI authorship in AI-written PR descriptions and comments. See [Releasing](RELEASING.md).
