# Usage

Tool Inspector is a TUI plugin that lists the tools OpenCode offers a model. It requires Node 22.18+ and is built for OpenCode 1.19.x, starting at 1.19.0.

## Install

Add the package to `plugin` in `tui.jsonc`:

```jsonc
{ "plugin": ["@lunchbox-labs/opencode-tool-inspector"] }
```

## Browse tools

Run `/tools`, or **Browse tools** from the command palette, to list the tools OpenCode offers a model: the one the current session's latest message used, otherwise your configured `model`, otherwise the first connected provider's default. The dialog's title names the model and where it came from. If you switch models before your next prompt, the tools offered may differ.

Type to filter the list, and press Enter to see a tool's input schema, the agents that can use it and its full description. Escape returns to the list.

The list includes built-in and plugin tools. MCP server tools aren't listed, because OpenCode only adds them when it runs a prompt; a toast says so when an MCP server is connected. If OpenCode can't resolve tools for a model, the list shows tool names only.

## Input schema

The input shows each field's type, whether it's required, its allowed values, default and limits, with nested objects shown under their parent and each option of a union listed with its own fields. A definition the schema shares between fields, or one that contains itself, is listed once, and later uses say where its fields are. A reference to a definition the schema doesn't contain shows as unresolved, and one that takes more than 64 references in a row to reach a schema shows as a reference chain too long. Long enums, tuples and unions name their first few values and count the rest, and a schema too large to show in full is cut short with a note.

[Agent access](Agent-access) describes the agents section of a tool's detail.
