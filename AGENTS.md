# Agent instructions

Read the applicable shared Lunchbox Labs standards before editing this repository:

- [Common agent guidance](https://github.com/lunchbox-labs/.github/blob/main/agent-guidance/common.md)
- [Workflow conventions](https://github.com/lunchbox-labs/.github/blob/main/agent-guidance/workflows.md)
- [npm package conventions](https://github.com/lunchbox-labs/.github/blob/main/agent-guidance/npm-packages.md)
- [Agent tooling conventions](https://github.com/lunchbox-labs/.github/blob/main/agent-guidance/agent-tooling.md)
- [State machine conventions](https://github.com/lunchbox-labs/.github/blob/main/agent-guidance/state-machines.md)

These documents must be read explicitly; GitHub does not automatically inherit them here.

`npm run check` includes static checks and unit tests. Run `npm run test:package` separately for packed-package validation.

This is a TUI-only plugin: the package exports `./tui` and no root or `./server` entry, because OpenCode loads a package's root export as a server plugin.

The `@opentui/*` and `solid-js` dev dependencies must stay on the versions the supported OpenCode host bundles; `tests/opencode-baseline.test.mjs` enforces this. Update them only together with the supported host range in `tests/opencode.json`.

The GitHub wiki is published from `docs/wiki/`: the Wiki workflow replaces the wiki with that folder on every push to `main` that changes it, so edit pages there, never in the wiki itself. Each file is one page named after its filename, with `_Sidebar.md` as the sidebar; link pages by name, as in `[Usage](Usage)`. Keep in-depth user and developer guides in the wiki and the README to a short introduction that links to them.

Write documentation for knowledgeable OpenCode users: explain plugin-specific concepts without host or package-install basics or unnecessary cautions. Keep installation examples simple and unversioned. Keep maintainer publishing and release-process walkthroughs out of the README and user pages; the wiki's Developer pages hold them, and release notes are still appropriate.

The plugin's state machines are documented in [docs/state-machines.md](docs/state-machines.md). Update it in the same PR as any change to their states, triggers or exits, with tests for each transition and failure path the change adds or alters.

## Contributor workflows

Request an independent `opencode-user-review` for changes to tool listing, tool details, input editing, tool calls, diagnostics or user-facing documentation; unrelated changes do not need it. Give the reviewer the diff/base and relevant test or runtime evidence.

Use `.agents/skills/native-package-verification/SKILL.md` to select applicable package and host checks; it is not an additional review role. The [agent tooling conventions](https://github.com/lunchbox-labs/.github/blob/main/agent-guidance/agent-tooling.md) cover the file layout, invocation in each tool and reviewer permissions.
