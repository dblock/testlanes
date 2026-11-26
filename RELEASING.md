# Releasing

Releases run through the manually dispatched [`release.yml`](.github/workflows/release.yml) workflow, which calls [npm-package-release](https://github.com/dblock/npm-package-release)'s reusable workflow with npm Trusted Publishing through OIDC. No npm token is stored. Releasing, tagging, authentication, trusted-publisher setup, and changes to repository rules each require explicit maintainer authorization; this document does not grant it.

## Version Pins

Callers reference the reusable workflow and standalone action by release tag, and those install the CLI version named by `TESTLANES_VERSION`, which `testlanes plan` checks with `--expect-version`. [`npr.config.js`](npr.config.js) keeps these in step:

- `TESTLANES_VERSION` in `.github/workflows/testlanes.yml` and `action.yml` follows the package version: the release commit and tag name the released version, and the next-development commit names the next version, because this repository's integration workflows run them against its own package.
- The install command, workflow pin, and action pin in the README always name the latest released version, in both commits.

`test/workflows.test.js` checks that `TESTLANES_VERSION` equals the package version and that the README pins agree and are not ahead of it, and `test/release.test.js` runs the real release configuration against simulated publication to check both commits.

## Setup Once

From this repository's checkout, with Node.js 26 and npm 12:

1. Let the workflow push the release and next-development commits and the release tag to `master`. Remove the pull request requirement from the ruleset but keep its force-push and deletion protections, with no bypass actors. This lets every writer push directly to `master`; ordinary development still goes through pull requests.

   ```sh
   id="$(gh api "repos/{owner}/{repo}/rulesets" --jq '.[] | select(.name == "Protect master") | .id')"
   gh api -X PUT "repos/{owner}/{repo}/rulesets/$id" --input - <<'JSON'
   {"rules":[{"type":"non_fast_forward"},{"type":"deletion"}]}
   JSON
   gh api "repos/{owner}/{repo}/rulesets/$id" --jq '"\(.enforcement) bypass=\(.bypass_actors|length) rules=\([.rules[].type])"'
   ```

2. Optionally restrict the `release` environment, which GitHub otherwise creates without restrictions on the first run, so that only `master` can publish:

   ```sh
   branch="$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)"
   gh api -X PUT "repos/{owner}/{repo}/environments/release" -F "deployment_branch_policy[protected_branches]=false" -F "deployment_branch_policy[custom_branch_policies]=true"
   gh api -X POST "repos/{owner}/{repo}/environments/release/deployment-branch-policies" -f name="$branch" -f type=branch
   ```

3. In your own terminal, so npm can complete 2FA in the browser, reserve the name with a `0.0.0` placeholder and configure the trusted publisher. Preview first:

   ```sh
   npm ci
   npm exec --offline -- npr bootstrap --dry-run
   npm login --registry=https://registry.npmjs.org
   npm exec --offline -- npr bootstrap
   ```

   Check that the `npm trust list` output shows repository `dblock/testlanes`, file `release.yml`, environment `release`, and publish permission. A new trusted publisher must publish within two days, so configure it when ready to release. If `npr trust` fails after the placeholder is published, rerun `npm exec --offline -- npr trust`, not `bootstrap`.

## Release

1. Give the CHANGELOG `(Next)` section real notes, keep `package.json`, `package-lock.json`, and `TESTLANES_VERSION` at the unpublished version, merge, and confirm CI passes on `master`.
2. Dispatch the workflow:

   ```sh
   branch="$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)"
   gh workflow run release.yml --ref "$branch"
   gh run list --workflow release.yml --limit 1
   ```

3. Verify the run summary, then the registry version, tag, GitHub Release, and the next-development commit:

   ```sh
   npm view testlanes@0.1.0 version dist.integrity dist.shasum --json --registry=https://registry.npmjs.org
   gh release view v0.1.0 --json tagName,assets
   git fetch --tags origin && git show v0.1.0:.github/workflows/testlanes.yml | grep TESTLANES_VERSION
   ```

   Compare the registry `dist.shasum` and `dist.integrity` with the GitHub Release asset and the archive retained in the run's artifacts; they must be identical. `master` should be at the next patch version with a new `(Next)` section, `TESTLANES_VERSION` at that version, and the README pins at the released version.

4. After the first release, deprecate the placeholder if `npr bootstrap` could not, which happens while npm is still processing the new package:

   ```sh
   npm view testlanes@0.0.0 deprecated --registry=https://registry.npmjs.org
   npm deprecate testlanes@0.0.0 "Placeholder reserving this name. Install a later version." --registry=https://registry.npmjs.org
   ```

## Recovery

A dispatch is not proof of publication. Before retrying a failed or ambiguous run, inspect the registry, the remote tag and `master`, the GitHub Release, and the run's retained artifacts, and complete only what is missing; see npm-package-release's [recovery guide](https://github.com/dblock/npm-package-release/blob/v0.4.0/docs/recovery.md). Never republish a version or move a release tag.
