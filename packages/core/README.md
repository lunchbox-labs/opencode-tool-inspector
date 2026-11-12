# Tool Inspector core

The shared code behind [Tool Inspector](https://github.com/lunchbox-labs/opencode-tool-inspector) for the OpenCode and Kilo TUIs. Install the package for your host instead:

- OpenCode: [`@lunchbox-labs/opencode-tool-inspector`](https://www.npmjs.com/package/@lunchbox-labs/opencode-tool-inspector)
- Kilo: [`@lunchbox-labs/kilo-tool-inspector`](https://www.npmjs.com/package/@lunchbox-labs/kilo-tool-inspector)

Each host package builds the plugin from this package with its own host profile. The [wiki](https://github.com/lunchbox-labs/opencode-tool-inspector/wiki/Developer) describes the layout.

This package is internal to the host packages. Its API isn't stable and can change in any release. Its TUI declarations reference types from `@opencode-ai/plugin`, which it doesn't install.
