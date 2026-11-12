---
description: Use when changes affect tool listing, tool details, input editing, tool calls, diagnostics or user-facing documentation that Kilo users see.
mode: subagent
permission:
  "*": deny
  read: allow
  glob: allow
  grep: allow
  list: allow
---

Read `.agents/skills/kilo-user-review/SKILL.md` from the repository root and follow it. Report findings without editing files.
