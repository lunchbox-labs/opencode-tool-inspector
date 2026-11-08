# Development and testing

## Build a local package

Use the committed npm lockfile. CI uses Node 24; the package requires Node 22.18 or later.

```sh
npm ci
npm run build
npm pack
```

Install the generated tarball into a separate directory and register that installed package's absolute directory in `tui.jsonc`. This exercises a local candidate without publishing it.

## Package shape

This is a TUI-only plugin. The package exports `./tui` and no root or `./server` entry, because OpenCode loads a package's root export as a server plugin.

## Checks

| Command | Coverage |
| --- | --- |
| `npm run check` | Typechecking, lint, formatting and unit tests |
| `npm run test:package` | Built tarball installation, the TUI export and declarations |

Tests should protect observable behavior, safety boundaries and host contracts. The [shared standards](https://github.com/lunchbox-labs/.github/blob/main/agent-guidance/common.md#meaningful-tests) define the testing policy.

## Host compatibility

The supported OpenCode range and floor live in [tests/opencode.json](https://github.com/lunchbox-labs/opencode-tool-inspector/blob/main/tests/opencode.json). The `@opencode-ai/plugin` and `@opencode-ai/sdk` dev dependencies share one exact version inside that range. The `@opentui/*` and `solid-js` dev dependencies stay on the versions the supported host bundles, because OpenCode maps a plugin's imports of them to its own copies. [tests/opencode-baseline.test.mjs](https://github.com/lunchbox-labs/opencode-tool-inspector/blob/main/tests/opencode-baseline.test.mjs) enforces both, so update them only together with the supported range. No OpenCode runtime engine restriction is declared.

[Check CI](https://github.com/lunchbox-labs/opencode-tool-inspector/blob/main/.github/workflows/check.yml) runs the unit and package tests on Linux and Windows for every pull request and push to `main`, and the static checks on Linux.
