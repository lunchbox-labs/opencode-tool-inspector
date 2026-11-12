# Agent instructions

Read the applicable shared Lunchbox Labs standards before editing this repository:

- [Common agent guidance](https://github.com/lunchbox-labs/.github/blob/main/agent-guidance/common.md)
- [Workflow conventions](https://github.com/lunchbox-labs/.github/blob/main/agent-guidance/workflows.md)
- [npm package conventions](https://github.com/lunchbox-labs/.github/blob/main/agent-guidance/npm-packages.md)
- [Agent tooling conventions](https://github.com/lunchbox-labs/.github/blob/main/agent-guidance/agent-tooling.md)
- [State machine conventions](https://github.com/lunchbox-labs/.github/blob/main/agent-guidance/state-machines.md)

These documents must be read explicitly; GitHub does not automatically inherit them here.

This repository is an npm workspace with two published packages, released together at one version, and their private shared source:

- `packages/core`: `@lunchbox-labs/tool-inspector-core`, private and never published. All shared logic, built for a host from a `Host` profile (the host's name in messages, access labels and access notes).
- `packages/opencode`: `@lunchbox-labs/opencode-tool-inspector`, the OpenCode adapter.
- `packages/kilo`: `@lunchbox-labs/kilo-tool-inspector`, the Kilo adapter.

Put behaviour in core and keep the adapters to their `Host` profile and entry point. Express host differences as profile data where you can. Core has no runtime dependency on any host package; it is typed against `@opencode-ai/plugin`, and the Kilo adapter adapts Kilo's API type to it. Each adapter's build (tsdown, `tsdown.config.ts` in the package) bundles core's source into one `dist/tui.js` and `dist/tui.d.ts` and keeps every other import external; it fails if anything from `node_modules` would be inlined. No adapter lists core in any dependency field. A runtime dependency added to core must also go into each adapter's `dependencies`. Core resolves to its TypeScript source through the workspace link, so tests and typechecking need no build.

Run commands from the repository root. `npm run check` includes static checks and unit tests for every package. Run `npm run test:package` separately for packed-package validation, and `npm run test:native` (with `NATIVE_HOST=kilo` and `KILO_TEST_VERSION=floor` or `latest-compatible`) for the native Kilo TUI check.

Both host packages are TUI-only: they export `./tui` and no root or `./server` entry, because OpenCode and Kilo load a package's root export as a server plugin.

Each host package's `@opentui/*` and `solid-js` dev dependencies must stay on the versions its supported host bundles; `packages/opencode/tests/opencode-baseline.test.mjs` and `packages/kilo/tests/kilo-baseline.test.mjs` enforce this. Update them only together with the supported host range in that package's `tests/opencode.json` or `tests/kilo.json`. Core's host dev dependencies match the OpenCode package's.

The GitHub wiki is published from `docs/wiki/`: the Wiki workflow replaces the wiki with that folder on every push to `main` that changes it, so edit pages there, never in the wiki itself. Each file is one page named after its filename, with `_Sidebar.md` as the sidebar; link pages by name, as in `[Usage](Usage)`. Keep in-depth user and developer guides in the wiki and the README to a short introduction that links to them.

Write documentation for knowledgeable OpenCode and Kilo users: explain plugin-specific concepts without host or package-install basics or unnecessary cautions. Keep installation examples simple and unversioned. Keep maintainer publishing and release-process walkthroughs out of the README and user pages; the wiki's Developer pages hold them, and release notes are still appropriate.

The plugin's state machines are documented in [docs/state-machines.md](docs/state-machines.md). Update it in the same PR as any change to their states, triggers or exits, with tests for each transition and failure path the change adds or alters.

## Contributor workflows

Request an independent `opencode-user-review` for changes to tool listing, tool details, input editing, tool calls, diagnostics or user-facing documentation that OpenCode users see, and a `kilo-user-review` for those that Kilo users see; a change to core usually needs both. Unrelated changes do not need them. Give the reviewer the diff/base and relevant test or runtime evidence.

Use `.agents/skills/native-package-verification/SKILL.md` to select applicable package and host checks; it is not an additional review role. The [agent tooling conventions](https://github.com/lunchbox-labs/.github/blob/main/agent-guidance/agent-tooling.md) cover the file layout, invocation in each tool and reviewer permissions.
