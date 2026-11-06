import assert from "node:assert/strict";
import { test } from "node:test";
import { agentAccessLines } from "../src/agent-text.ts";
import { resolveToolAgentAccess } from "../src/agents.ts";
import { linesText } from "../src/schema-text.ts";

const allowAll = { permission: "*", pattern: "*", action: "allow" } as const;

function render(
  tool: string,
  agents: Parameters<typeof resolveToolAgentAccess>[1],
  options?: Parameters<typeof resolveToolAgentAccess>[2],
) {
  const [access] = resolveToolAgentAccess([tool], agents, options);
  return linesText(agentAccessLines(access));
}

test("tools sharing a permission name it, and subagent access is shown where it differs", () => {
  assert.equal(
    render(
      "write",
      [
        { name: "docs", mode: "subagent", permission: [allowAll] },
        {
          name: "build",
          mode: "all",
          permission: [
            allowAll,
            { permission: "edit", pattern: "*.lock", action: "deny" },
          ],
        },
      ],
      { primaryTools: ["edit"] },
    ),
    [
      "Checked as the edit permission.",
      "build  primary or subagent: allowed",
      "  denied for *.lock",
      "  as a subagent: not offered to the model",
      "docs  subagent: not offered to the model",
      "Patterns match the call's input, such as a command or path; a later line wins.",
    ].join("\n"),
  );
});

test("hidden custom agents are labelled, OpenCode's hidden agents are left out, and unreadable rules say so", () => {
  assert.equal(
    render("read", [
      { name: "title", mode: "primary", native: true, hidden: true },
      {
        name: "reviewer",
        mode: "subagent",
        hidden: true,
        permission: [allowAll],
      },
      { name: "broken", mode: "primary", permission: "nope" },
    ]),
    [
      "broken  primary: unknown, permissions couldn't be read",
      "reviewer  subagent, hidden: allowed",
    ].join("\n"),
  );
});

test("a tool no listed agent can run says so instead of rendering nothing", () => {
  assert.equal(
    render("read", [
      { name: "title", mode: "primary", native: true, hidden: true },
    ]),
    "OpenCode reported no agents that use tools.",
  );
});
