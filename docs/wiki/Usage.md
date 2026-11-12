# Usage

Tool Inspector is a TUI plugin that lists the tools the host offers a model. It requires Node 22.18+. The OpenCode package is built for OpenCode 1.19.x, starting at 1.19.0, and the Kilo package for Kilo CLI 7.8.x, starting at 7.8.27. Both behave the same apart from the differences noted on this page.

## Install

Add the package for your host to `plugin` in `tui.jsonc`. The hosts keep their global configuration in separate folders: `~/.config/opencode/` for OpenCode and `~/.config/kilo/` for Kilo.

OpenCode:

```jsonc
{ "plugin": ["@lunchbox-labs/opencode-tool-inspector"] }
```

Kilo:

```jsonc
{ "plugin": ["@lunchbox-labs/kilo-tool-inspector"] }
```

Tool Inspector reads no environment variables or settings of its own. The host's own settings, such as `model`, `permission` and `experimental.primary_tools`, decide what it shows.

## Browse tools

Run `/tools`, or **Browse tools** from the command palette, to list the tools the host offers a model: the one the current session's latest message used, otherwise your configured `model`, otherwise the first connected provider's default. The dialog's title names the model and where it came from. If you switch models before your next prompt, the tools offered may differ.

Type to filter the list, and press Enter to see a tool's input schema, the agents that can use it and its full description. Escape returns to the list.

The list includes built-in and plugin tools. MCP server tools aren't listed, because the host only adds them when it runs a prompt; a toast says so when an MCP server is connected. If the host can't resolve tools for a model, the list shows tool names only.

## Input schema

The input shows each field's type, whether it's required, its allowed values, default and limits, with nested objects shown under their parent and each option of a union listed with its own fields. A definition the schema shares between fields, or one that contains itself, is listed once, and later uses say where its fields are. A reference to a definition the schema doesn't contain shows as unresolved, and one that takes more than 64 references in a row to reach a schema shows as a reference chain too long. Long enums, tuples and unions name their first few values and count the rest, and a schema too large to show in full is cut short with a note.

## Agent access

The tool list isn't filtered by agent. Instead, a tool's detail lists each agent and whether it's allowed to use the tool, asks first, is denied, or isn't offered the tool at all, following each agent's merged `permission` rules and the rules of the current top-level session. Input patterns with different access, such as `read` asking first for `*.env` files, are listed under the agent.

Agents with mode `all` also show their access when they run as a subagent, where that differs, since the host always denies subagents any `experimental.primary_tools`, and denies `todowrite` and `task` unless the agent's own rules name them.

The host's own hidden agents, such as `compaction` and `title`, are left out. If the host's agents can't be read, details open without the agents section and a toast says why.

### In Kilo

Kilo applies more checks at call time than its configured rules show, so the Kilo package words access as configured: "allowed by configured rules", "asks first by configured rules" and "denied by configured rules". Every tool's agents section starts with a note that Kilo can still ask or deny at call time, and that saved approvals, hard limits, skill commands and sandbox escalation aren't resolved here. Tools checked as `read` or `edit` add a note that Kilo checks protected config paths, such as sensitive `.env` files, separately, and `agent_manager` adds a note that its prompt, stop, move and answer actions need exact action rules. Headless subagent restrictions aren't shown either.
