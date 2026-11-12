# Publishing

The [Release workflow](https://github.com/lunchbox-labs/opencode-tool-inspector/blob/main/.github/workflows/release.yml) runs only when started by hand on `main`. One run releases the version the two host packages share:

- `@lunchbox-labs/opencode-tool-inspector`
- `@lunchbox-labs/kilo-tool-inspector`

Core (`packages/core`) is private: each package's build bundles it in, so it is never packed or published. The run publishes the packages to npm in that order, creates the `v<version>` tag on the release commit, and publishes a GitHub release for that tag with the two package tarballs attached and notes generated from the merged pull requests. Branch pushes, pull requests and tag pushes do not publish packages.

## Publisher setup

The workflow expects these settings, configured through the respective services. This page describes the required setup, not confirmation of its current state.

- **npm trusted publishers:** one for each of the two packages, each with organization `lunchbox-labs`, repository `opencode-tool-inspector`, workflow filename `release.yml` and environment `release`. Allow direct `npm publish`, which is the command this workflow uses. `@lunchbox-labs/opencode-tool-inspector` already has one; `@lunchbox-labs/kilo-tool-inspector` needs its own before its first release, as [Bootstrap a new package](#bootstrap-a-new-package) describes. See [npm's trusted publishing guide](https://docs.npmjs.com/trusted-publishers/).
- **`release` environment:** allows deployments from `main` only. It holds no secrets or variables.
- **Actions policy:** only maintainers may start Release, and Wiki may run only on pushes to `main`. Both can write to the repository.
- **Tag rulesets:** a ruleset blocks updating and deleting `v*` tags. No ruleset blocks creating them, because Release creates the tag itself.

The publish job has `id-token: write` for OIDC and `contents: read`. It installs a trusted-publishing-capable npm version and enables provenance. The workflow does not use a long-lived npm token. Only the GitHub release job has `contents: write`, and it runs no repository code. Both jobs run in the `release` environment.

## Bootstrap a new package

npm adds a trusted publisher only to a package that already exists, and Release stops at verification while either package has never been published. `@lunchbox-labs/kilo-tool-inspector` was added in 0.3.0 and needs this once before its first Release run; `@lunchbox-labs/opencode-tool-inspector` is already on npm:

1. Publish a placeholder by hand, signed in to npm as a maintainer of the `lunchbox-labs` organization. Work in an empty directory outside this repository with only a minimal `package.json`, not the built package, so the placeholder has no code or dependencies:

   ```sh
   mkdir bootstrap && cd bootstrap
   echo '{}' > package.json
   npm pkg set name=@lunchbox-labs/kilo-tool-inspector version=0.0.0-bootstrap.0 license=MIT description="Placeholder; install a released version" repository.type=git repository.url=git+https://github.com/lunchbox-labs/opencode-tool-inspector.git repository.directory=packages/kilo
   npm publish --access public --tag bootstrap
   ```

2. Mark the placeholder as deprecated, so an install of it says what to use instead: `npm deprecate @lunchbox-labs/kilo-tool-inspector@0.0.0-bootstrap.0 "Placeholder; install a released version"`.
3. In the package's settings on npm, add the trusted publisher described above.
4. Run Release with **dry_run** to confirm verification passes, then run it for real.

npm points `latest` at a package's first version whatever tag it was published under, so `latest` names the placeholder until the first stable release moves it; a pre-release run publishes under `next` and leaves `latest` on the placeholder. `npm dist-tag ls <package>` shows where each tag points. Release refuses `0.0.0` and its pre-releases, the placeholder included, so a release can't collide with it.

The check in Verify covers only packages that are missing from npm. It can't tell whether a trusted publisher is set up, and a dry run stops before the publish job, so it doesn't exercise OIDC either. A missing or wrong trusted publisher fails Publish npm at that package, after the packages before it were published. Fix the trusted publisher, then re-run only the failed jobs within the artifact's three days: Publish npm skips the packages npm already holds with the same tarball and publishes the rest.

Core is not published. If a placeholder of `@lunchbox-labs/tool-inspector-core` was ever published while it was planned as a package, leave it deprecated; nothing installs it.

## Prepare and run a release

1. Set the same version in `packages/opencode/package.json` and `packages/kilo/package.json` (and in `packages/core/package.json` to keep them aligned; Release doesn't read core's), and run `npm install` so the package entries in `package-lock.json` match. Use a non-placeholder semantic version that has no tag and neither package has on npm yet: a stable version such as `1.2.3` for a release, or a pre-release version such as `1.2.3-beta.1` for a pre-release.
2. Complete the required checks and review, and integrate the release commit into `main` through the repository's normal process.
3. Open **Actions**, choose **Release**, and select **Run workflow** with `main` as the branch. The run releases the commit at the head of `main` when it starts, so start it once the release commit is the latest commit there. Run it once per version.

The run has two inputs:

- **dry_run:** builds and checks the release, then stops before npm, the tag and the GitHub release.
- **prerelease:** publishes under npm's `next` tag instead of `latest`, and marks the GitHub release as a pre-release. A pre-release run needs a pre-release version, and a normal run a stable one, so `latest` never moves to a pre-release.

The run's summary names the version as soon as the **Release version** job finishes, and links the release once the **GitHub release** job has published it. Don't push the tag or create the release by hand: Release refuses a version that is already tagged, and tags can't be moved or deleted.

## What the run does

**Release version** stops a run started on any other branch, reads the version from the two packages and stops unless they have the same one. **Verify** then requires the checked-out commit to match the run's commit, stops when either package has never been published (see [Bootstrap a new package](#bootstrap-a-new-package)), and stops before building when `v<version>` is already tagged or either package already has that version on npm. [validate-release.mjs](https://github.com/lunchbox-labs/opencode-tool-inspector/blob/main/scripts/validate-release.mjs) also validates each package's identity, repository, registry, access, that it doesn't list core in any dependency field, and its lockfile entry. Verify runs `npm ci` and `npm run test:package`, packs the two builds and uploads the tarballs with SHA-256 checksums.

**Check** runs the [Check workflow](https://github.com/lunchbox-labs/opencode-tool-inspector/blob/main/.github/workflows/check.yml) on the release commit as part of the run, with every job it runs on a push to `main`. Its runs inside Release are grouped apart from Check's own runs, so a push to `main` during a release doesn't cancel them.

**Publish npm** downloads the verified tarballs, checks their checksums and publishes them in order, OpenCode first, with scripts disabled. It does not rebuild the packages. **GitHub release** then creates the `v<version>` tag on the release commit and publishes a GitHub release for it with the same two tarballs attached.

If a job fails, inspect it before retrying, and re-run only the failed jobs so the verified packages are reused. Re-running Publish npm is safe: it skips each package npm already holds at this version with the same tarball, publishes the rest, and stops at a package npm holds with a different tarball. Re-running GitHub release accepts an existing tag only on the release commit, publishes a draft left for the tag with the tarballs attached, and leaves an already published release as it is. A new run, or a full re-run, stops at verification once the version is tagged or any package is on npm, so finish a partly failed release by re-running its failed jobs within the artifact's three days. After that, bump the version, merge it to `main` and run Release again. Keep release-specific investigation and validation evidence in the tracking issue.
