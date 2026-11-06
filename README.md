# OpenCode Tool Inspector

Browse the tools available to OpenCode agents from the TUI: each tool's description, input schema and the agents that can use it.

Requires Node **22.18+**. Built for OpenCode **1.19.x**, starting at **1.19.0**.

## Install

Add the package to `plugin` in `tui.jsonc`:

```jsonc
{ "plugin": ["@lunchbox-labs/opencode-tool-inspector"] }
```

## Browse tools

Run `/tools`, or **Browse tools** from the command palette, to list the tools OpenCode offers a model: the one the current session's latest message used, otherwise your configured `model`, otherwise the first connected provider's default. The dialog's title names the model and where it came from. If you switch models before your next prompt, the tools offered may differ.

Type to filter the list, and press Enter to see a tool's input schema and full description: each input's type, whether it's required, its allowed values, default and limits, with nested objects shown under their parent. Escape returns to the list.

The list includes built-in and plugin tools. MCP server tools aren't listed, because OpenCode only adds them when it runs a prompt; a toast says so when an MCP server is connected. The list also isn't filtered by agent: an agent's permissions can still deny a tool shown here. If OpenCode can't resolve tools for a model, the list shows tool names only.
