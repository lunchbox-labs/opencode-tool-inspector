# OpenCode Tool Inspector

Browse the tools available to OpenCode agents from the TUI: each tool's description, input schema and the agents that can use it.

Requires Node **22.18+**. Built for OpenCode **1.19.x**, starting at **1.19.0**.

## Install

Add the package to `plugin` in `tui.jsonc`:

```jsonc
{ "plugin": ["@lunchbox-labs/opencode-tool-inspector"] }
```

## Browse tools

Run `/tools`, or **Browse tools** from the command palette, to list the tools OpenCode offers a model; the dialog's title names which one. Type to filter the list, press Enter to see a tool's input schema, the agents that can use it and its full description, and press Escape to return to the list.

## Documentation

The [wiki](https://github.com/lunchbox-labs/opencode-tool-inspector/wiki) has the full guides:

- [Usage](https://github.com/lunchbox-labs/opencode-tool-inspector/wiki/Usage): which model's tools are listed, what the list leaves out and how input schemas are shown.
- [Agent access](https://github.com/lunchbox-labs/opencode-tool-inspector/wiki/Usage#agent-access): how a tool's detail shows each agent's access.
- [Developer](https://github.com/lunchbox-labs/opencode-tool-inspector/wiki/Developer): development, compatibility testing and publishing.
