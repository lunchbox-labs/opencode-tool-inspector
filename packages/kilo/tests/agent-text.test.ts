import assert from "node:assert/strict";
import { test } from "node:test";
import { agentAccessLines } from "../../core/src/agent-text.ts";
import { resolveToolAgentAccess } from "../../core/src/agents.ts";
import { linesText } from "../../core/src/schema-text.ts";
import { kiloHost } from "../src/host.ts";

const allowAll = { permission: "*", pattern: "*", action: "allow" } as const;

function render(
  tool: string,
  agents: Parameters<typeof resolveToolAgentAccess>[1],
  options?: Parameters<typeof resolveToolAgentAccess>[2],
) {
  const [access] = resolveToolAgentAccess([tool], agents, options);
  return linesText(agentAccessLines(access, kiloHost));
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
      "Configured rules only. Kilo can still ask or deny at call time; saved approvals, hard limits, skill commands and sandbox escalation are not resolved here.",
      "Kilo checks protected config paths separately; broad read grants do not automatically authorize sensitive .env files.",
      "build  primary or subagent: allowed by configured rules",
      "  denied by configured rules for *.lock",
      "  as a subagent: not offered to the model",
      "docs  subagent: not offered to the model",
      "Patterns match the call's input, such as a command or path; a later line wins.",
    ].join("\n"),
  );
});

test("hidden custom agents are labelled, Kilo's hidden agents are left out, and unreadable rules say so", () => {
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
      "Configured rules only. Kilo can still ask or deny at call time; saved approvals, hard limits, skill commands and sandbox escalation are not resolved here.",
      "Kilo checks protected config paths separately; broad read grants do not automatically authorize sensitive .env files.",
      "broken  primary: unknown, permissions couldn't be read",
      "reviewer  subagent, hidden: allowed by configured rules",
    ].join("\n"),
  );
});

test("a tool no listed agent can run says so instead of rendering nothing", () => {
  assert.equal(
    render("read", [
      { name: "title", mode: "primary", native: true, hidden: true },
    ]),
    "Kilo reported no agents that use tools.",
  );
});

test("agent access distinguishes configuration from Kilo runtime authorization", () => {
  const text = render("bash", [
    { name: "build", mode: "primary", permission: [allowAll] },
  ]);
  assert.match(text, /allowed by configured rules/);
  assert.match(text, /Kilo can still ask or deny at call time/);
  assert.match(text, /saved approvals/);
});

test("read summaries explain Kilo's protected input checks", () => {
  const text = render("read", [
    { name: "build", mode: "primary", permission: [allowAll] },
  ]);
  assert.match(text, /\.env/);
  assert.match(text, /protected config/);
});

test("agent manager summaries explain exact action approval requirements", () => {
  const text = render("agent_manager", [
    { name: "build", mode: "primary", permission: [allowAll] },
  ]);
  assert.match(text, /prompt, stop, move and answer/);
  assert.match(text, /exact/);
});
