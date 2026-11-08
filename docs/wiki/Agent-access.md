# Agent access

The tool list isn't filtered by agent. Instead, a tool's detail lists each agent and whether it's allowed to use the tool, asks first, is denied, or isn't offered the tool at all, following each agent's merged `permission` rules and the rules of the current top-level session. Input patterns with different access, such as `read` asking first for `*.env` files, are listed under the agent.

Agents with mode `all` also show their access when they run as a subagent, where that differs, since OpenCode always denies subagents any `experimental.primary_tools`, and denies `todowrite` and `task` unless the agent's own rules name them.

OpenCode's own hidden agents, such as `compaction` and `title`, are left out. If OpenCode's agents can't be read, details open without this section and a toast says why.
