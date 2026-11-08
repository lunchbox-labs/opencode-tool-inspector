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

Type to filter the list, and press Enter to see a tool's input schema, the agents that can use it and its full description. The input shows each field's type, whether it's required, its allowed values, default and limits, with nested objects shown under their parent and each option of a union listed with its own fields. A definition the schema shares between fields, or one that contains itself, is listed once, and later uses say where its fields are. A reference to a definition the schema doesn't contain shows as unresolved, and one that takes more than 64 references in a row to reach a schema shows as a reference chain too long. Long enums, tuples and unions name their first few values and count the rest, and a schema too large to show in full is cut short with a note. Escape returns to the list.

The list includes built-in and plugin tools. MCP server tools aren't listed, because OpenCode only adds them when it runs a prompt; a toast says so when an MCP server is connected. If OpenCode can't resolve tools for a model, the list shows tool names only.

## Agent access

The list isn't filtered by agent. Instead, a tool's detail lists each agent and whether it's allowed to use the tool, asks first, is denied, or isn't offered the tool at all, following each agent's merged `permission` rules and the rules of the current top-level session. Input patterns with different access, such as `read` asking first for `*.env` files, are listed under the agent. Agents with mode `all` also show their access when they run as a subagent, where that differs, since OpenCode always denies subagents any `experimental.primary_tools`, and denies `todowrite` and `task` unless the agent's own rules name them.

OpenCode's own hidden agents, such as `compaction` and `title`, are left out. If OpenCode's agents can't be read, details open without this section and a toast says why.
