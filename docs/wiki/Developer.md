# Developer documentation

For contributors and maintainers working on Tool Inspector:

- [Workspace layout](#workspace-layout): the core and host packages.
- [Local builds and checks](#build-local-packages): local builds, the TUI-only package shape and compatibility checks for each host.
- [Publishing](Publishing): trusted publisher setup and the release workflow.

The plugin's state machines are documented in [docs/state-machines.md](https://github.com/lunchbox-labs/opencode-tool-inspector/blob/main/docs/state-machines.md). These wiki pages are published from [docs/wiki](https://github.com/lunchbox-labs/opencode-tool-inspector/tree/main/docs/wiki) on every push to `main` that changes them; change them there.

The repository's [AGENTS.md](https://github.com/lunchbox-labs/opencode-tool-inspector/blob/main/AGENTS.md) and linked shared standards remain the authoritative machine instructions. [User documentation](Home#user-documentation) covers installation and everyday use.

## Workspace layout

The repository is an npm workspace with one lockfile. Its three packages share one version and are released together:

| Directory | Package | Contents |
| --- | --- | --- |
| `packages/core` | `@lunchbox-labs/tool-inspector-core` | All shared logic, and the `Host` profile type |
| `packages/opencode` | `@lunchbox-labs/opencode-tool-inspector` | OpenCode's `Host` profile and `./tui` entry |
| `packages/kilo` | `@lunchbox-labs/kilo-tool-inspector` | Kilo's `Host` profile and `./tui` entry |

A `Host` profile holds what differs between hosts: the host's name in messages, how access is labelled, and notes shown above a tool's agents. Core builds the plugin from it with `createToolInspectorTui`. Core has no runtime dependency on either host; its sources are typed against `@opencode-ai/plugin`, and the Kilo package adapts Kilo's API type to them. Each host package depends on core at exactly the shared version.

Shared tooling (TypeScript, ESLint, Prettier and the test runner) lives at the root. Tests live with the package they test: core's shared logic in `packages/core/tests`, and each host's output, baseline and packed-package tests in its own `tests` folder. The release workflow tests are in the root `tests` folder.

When working from source, the root scripts resolve core through its `tool-inspector-source` export condition, so unit tests and typechecking don't need a build. The build compiles core first, then the host packages against core's declarations.

## Build local packages

Use the committed npm lockfile and run commands from the repository root. CI uses Node 24; the packages require Node 22.18 or later.

```sh
npm ci
npm run build
npm pack --workspaces
```

`npm pack --workspaces` writes a tarball for core and each host package. Install the host's tarball together with core's into a separate directory, since core's version may not be on npm yet, and register that installed package's absolute directory in the host's `tui.jsonc`. This exercises a local candidate without publishing it.

## Package shape

Both host packages are TUI-only. They export `./tui` and no root or `./server` entry, because OpenCode and Kilo load a package's root export as a server plugin. Core exports only its root entry.

## Checks

| Command | Coverage |
| --- | --- |
| `npm run check` | Typechecking, lint, formatting and unit tests for every package |
| `npm run test:package` | Each host package's tarball installed with core's, the TUI export and declarations |
| `npm run test:native` | The packed Kilo package in a real Kilo CLI TUI: live APIs, filtering, details, paging, Escape and repeated opens |

`npm run test:native` runs the native check for the host in `NATIVE_HOST`, which defaults to `kilo`; OpenCode has no native check. `KILO_TEST_VERSION` picks the Kilo CLI version: `floor` (the default), `latest-compatible` (the newest in the supported range) or an exact version. Set `KILO_BIN` to reuse an existing binary; its version is checked. The check installs the CLI and the packed packages in temporary state and uses a loopback-only model fixture without sending prompts or running tools. It runs on Linux x64, under `script` from util-linux, and Windows x64, under a ConPTY from `node-pty`, which it installs beside the CLI.

Tests should protect observable behavior, safety boundaries and host contracts. The [shared standards](https://github.com/lunchbox-labs/.github/blob/main/agent-guidance/common.md#meaningful-tests) define the testing policy.

## Host compatibility

Each host package keeps its supported range and floor in its tests folder: [packages/opencode/tests/opencode.json](https://github.com/lunchbox-labs/opencode-tool-inspector/blob/main/packages/opencode/tests/opencode.json) and [packages/kilo/tests/kilo.json](https://github.com/lunchbox-labs/opencode-tool-inspector/blob/main/packages/kilo/tests/kilo.json).

| Host | Plugin and SDK dev dependencies | `@opentui/*` | `solid-js` |
| --- | --- | --- | --- |
| OpenCode 1.19.x | `@opencode-ai/plugin`, `@opencode-ai/sdk` 1.19.5 | 0.4.5 | 1.9.12 |
| Kilo CLI 7.8.x | `@kilocode/plugin`, `@kilocode/sdk` 7.8.27 | 0.5.11 | 1.9.12 |

Each host's plugin and SDK dev dependencies share one exact version inside its range. Its `@opentui/*` and `solid-js` dev dependencies stay on the versions the host bundles, because the host maps a plugin's imports of them to its own copies. npm installs Kilo's OpenTUI copies under `packages/kilo/node_modules`, and Kilo's typecheck pins them with `paths` in `packages/kilo/tsconfig.json`. Core is typed against OpenCode's plugin types, so `npm run typecheck` also checks core's source against Kilo's through `packages/kilo/tsconfig.core.json`, which maps `@opencode-ai/plugin` to `@kilocode/plugin` and OpenTUI to Kilo's copies. Each package's baseline test enforces its pins against the lockfile, so update them only together with the supported range. Core's host dev dependencies match the OpenCode package's. No host runtime engine restriction is declared.

[Check CI](https://github.com/lunchbox-labs/opencode-tool-inspector/blob/main/.github/workflows/check.yml) runs the unit and package tests on Linux and Windows for every pull request and push to `main`, and the static checks on Linux. Its native matrix runs the Kilo check on Linux and Windows, against the floor and the latest compatible Kilo CLI.
