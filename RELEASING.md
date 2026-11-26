# Releasing

Release automation is not set up yet; these steps are provisional. Releasing, tagging, authentication, and trusted-publisher setup each require explicit maintainer authorization.

## First Release

The first `0.1.0` release is published manually by a maintainer.

1. Confirm the version in `package.json`, `package-lock.json`, `TESTLANES_VERSION` in `.github/workflows/lanes.yml` and `action.yml`, the README pins, and the CHANGELOG Next heading, and that `0.1.0` has not been published with `npm view testlanes versions`.
2. Run `npm ci`, `npm test`, and `npm run lint`.
3. Run `npm pack`, inspect the archive, and validate it with `PACKAGE_ARCHIVE=testlanes-0.1.0.tgz npm run package:check`.
4. Publish that exact archive with `npm publish testlanes-0.1.0.tgz`, completing npm authentication interactively.
5. Verify the registry version with `npm view testlanes@0.1.0 version`, then create and push the `v0.1.0` tag and GitHub Release. Callers reference the reusable workflows and action by this tag.

## Later Releases

After the package exists on npm, later releases will use a manually dispatched GitHub Actions workflow with npm Trusted Publishing through OIDC and a `release` environment restricted to `master`, without stored npm tokens. That workflow and its verification and recovery steps will be documented here when they are added.
