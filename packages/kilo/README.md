# Kilo Tool Inspector

Browse the tools available to Kilo agents from the TUI: each tool's description, input schema and the agents that can use it.

Requires Node **22.18+**. Built for Kilo CLI **7.8.x**, starting at **7.8.27**. For OpenCode, use [`@lunchbox-labs/opencode-tool-inspector`](https://www.npmjs.com/package/@lunchbox-labs/opencode-tool-inspector).

## Install

Add the package to `plugin` in `tui.jsonc`:

```jsonc
{ "plugin": ["@lunchbox-labs/kilo-tool-inspector"] }
```

## Browse tools

Run `/tools`, or **Browse tools** from the command palette, to list the tools Kilo offers a model; the dialog's title names which one. Type to filter the list, press Enter to see a tool's input schema, the agents that can use it and its full description, and press Escape to return to the list.

A tool's detail shows each agent's configured access. Kilo can still ask or deny at call time, for example for protected config paths or exact `agent_manager` action rules, so the detail notes where that applies.

## Documentation

The [wiki](https://github.com/lunchbox-labs/opencode-tool-inspector/wiki) has the full guides for both hosts:

- [Usage](https://github.com/lunchbox-labs/opencode-tool-inspector/wiki/Usage): which model's tools are listed, what the list leaves out and how input schemas are shown.
- [Agent access](https://github.com/lunchbox-labs/opencode-tool-inspector/wiki/Usage#agent-access): how a tool's detail shows each agent's access.
- [Developer](https://github.com/lunchbox-labs/opencode-tool-inspector/wiki/Developer): development, compatibility testing and publishing.
