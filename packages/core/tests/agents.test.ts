import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type AgentInput,
  type AgentToolAccess,
  type PermissionAction,
  type PermissionRuleInput,
  resolveToolAgentAccess,
} from "../src/agents.ts";

const rule = (
  permission: string,
  action: PermissionAction,
  pattern = "*",
): PermissionRuleInput => ({ permission, pattern, action });

// A subset of OpenCode 1.19.5's starting rules for every agent.
const defaults = [
  rule("*", "allow"),
  rule("doom_loop", "ask"),
  rule("question", "deny"),
  rule("read", "allow"),
  rule("read", "ask", "*.env"),
  rule("read", "ask", "*.env.*"),
  rule("read", "allow", "*.env.example"),
];

function accessFor(
  tool: string,
  agents: AgentInput[],
  options?: Parameters<typeof resolveToolAgentAccess>[2],
): Record<string, AgentToolAccess> {
  const entry = resolveToolAgentAccess([tool], agents, options).at(0);
  assert.ok(entry !== undefined);
  return Object.fromEntries(entry.agents.map((agent) => [agent.agent, agent]));
}

test("the last matching rule wins, including rules named with wildcards", () => {
  const agents = [
    {
      name: "readonly",
      mode: "primary",
      permission: [...defaults, rule("*", "deny"), rule("read", "allow")],
    },
    {
      name: "no-mcp",
      mode: "primary",
      permission: [...defaults, rule("github_*", "deny")],
    },
  ];
  const result = resolveToolAgentAccess(
    ["read", "bash", "github_create_issue", "question"],
    agents,
  );
  const table = Object.fromEntries(
    result.map((entry) => [
      entry.tool,
      Object.fromEntries(
        entry.agents.map((agent) => [agent.agent, agent.access]),
      ),
    ]),
  );
  assert.deepEqual(table, {
    read: { readonly: "allow", "no-mcp": "allow" },
    bash: { readonly: "deny", "no-mcp": "allow" },
    github_create_issue: { readonly: "deny", "no-mcp": "deny" },
    question: { readonly: "deny", "no-mcp": "deny" },
  });
});

test("tools that share a permission are decided by that permission", () => {
  const agents = [
    {
      name: "careful",
      mode: "primary",
      permission: [...defaults, rule("edit", "ask"), rule("read", "deny")],
    },
  ];
  const result = resolveToolAgentAccess(
    ["write", "apply_patch", "edit", "read_mcp_resource", "list_mcp_resources"],
    agents,
  );
  assert.deepEqual(
    result.map((entry) => [
      entry.tool,
      entry.permission,
      entry.agents[0].access,
    ]),
    [
      ["write", "edit", "ask"],
      ["apply_patch", "edit", "ask"],
      ["edit", "edit", "ask"],
      ["read_mcp_resource", "read", "deny"],
      ["list_mcp_resources", "read", "deny"],
    ],
  );
});

test("rules for particular inputs are reported as exceptions until a later rule covers every input", () => {
  const { stock, overridden } = accessFor("read", [
    { name: "stock", mode: "primary", permission: defaults },
    {
      name: "overridden",
      mode: "primary",
      permission: [...defaults, rule("read", "allow")],
    },
  ]);
  assert.equal(stock.access, "allow");
  assert.deepEqual(stock.exceptions, [
    { pattern: "*.env", access: "ask" },
    { pattern: "*.env.*", access: "ask" },
    { pattern: "*.env.example", access: "allow" },
  ]);
  assert.equal(overridden.access, "allow");
  assert.deepEqual(overridden.exceptions, []);
});

test("a tool denied in general can still be allowed for some inputs", () => {
  const { plan } = accessFor("write", [
    {
      name: "plan",
      mode: "primary",
      permission: [
        ...defaults,
        rule("edit", "deny"),
        rule("edit", "allow", ".opencode/plans/*.md"),
      ],
    },
  ]);
  assert.equal(plan.access, "deny");
  assert.deepEqual(plan.exceptions, [
    { pattern: ".opencode/plans/*.md", access: "allow" },
  ]);
});

test("a repeated pattern keeps only its latest action, and only rules that change the answer are listed", () => {
  const { agent } = accessFor("bash", [
    {
      name: "agent",
      mode: "primary",
      permission: [
        rule("bash", "ask"),
        rule("bash", "ask", "ls *"),
        rule("bash", "allow", "git *"),
        rule("bash", "deny", "rm *"),
        rule("bash", "ask", "git *"),
      ],
    },
  ]);
  assert.equal(agent.access, "ask");
  assert.deepEqual(agent.exceptions, [
    { pattern: "rm *", access: "deny" },
    { pattern: "git *", access: "ask" },
  ]);
});

test("a tool no rule mentions asks first", () => {
  const { bare } = accessFor("webfetch", [
    { name: "bare", mode: "primary", permission: [] },
  ]);
  assert.equal(bare.access, "ask");
});

test("subagents lose todowrite, task and primary tools unless they allow them themselves", () => {
  const agents = [
    { name: "reviewer", mode: "subagent", permission: defaults },
    {
      name: "planner",
      mode: "subagent",
      permission: [
        ...defaults,
        rule("todowrite", "allow"),
        rule("task", "ask"),
      ],
    },
  ];
  const result = resolveToolAgentAccess(
    ["todowrite", "task", "skill", "read"],
    agents,
    { primaryTools: ["skill"] },
  );
  assert.deepEqual(
    result.map((entry) => [
      entry.tool,
      entry.agents.map((agent) => `${agent.agent}:${agent.access}`),
    ]),
    [
      ["todowrite", ["reviewer:deny", "planner:allow"]],
      ["task", ["reviewer:deny", "planner:ask"]],
      ["skill", ["reviewer:deny", "planner:deny"]],
      ["read", ["reviewer:allow", "planner:allow"]],
    ],
  );
});

test("agents that run both ways report subagent access only where it differs", () => {
  const agents = [{ name: "helper", mode: "all", permission: defaults }];
  const { helper: todo } = accessFor("todowrite", agents);
  assert.equal(todo.access, "allow");
  assert.deepEqual(todo.whenSubagent, {
    access: "deny",
    exceptions: [],
    offeredToModel: false,
  });
  const { helper: read } = accessFor("read", agents);
  assert.equal(read.whenSubagent, undefined);
});

test("the session's rules apply after the agent's own, and subagents keep only its denies", () => {
  const sessionPermission = [
    rule("bash", "deny"),
    rule("bash", "allow", "git *"),
    rule("todowrite", "ask"),
  ];
  const agents = [
    { name: "build", mode: "primary", permission: defaults },
    { name: "reviewer", mode: "subagent", permission: defaults },
    { name: "helper", mode: "all", permission: defaults },
  ];
  const bash = accessFor("bash", agents, { sessionPermission });
  assert.deepEqual(
    [bash.build.access, bash.build.exceptions],
    ["deny", [{ pattern: "git *", access: "allow" }]],
  );
  assert.deepEqual(
    [bash.reviewer.access, bash.reviewer.exceptions],
    ["deny", []],
  );
  assert.deepEqual(bash.helper.whenSubagent, {
    access: "deny",
    exceptions: [],
    offeredToModel: false,
  });
  const todo = accessFor("todowrite", agents, {
    sessionPermission,
    primaryTools: [],
  });
  assert.equal(todo.helper.access, "ask");
  assert.equal(todo.helper.whenSubagent?.access, "deny");
});

test("a subagent's primary tool deny isn't repeated when the session already has it", () => {
  const { reviewer } = accessFor(
    "bash",
    [{ name: "reviewer", mode: "subagent", permission: [rule("*", "allow")] }],
    {
      sessionPermission: [rule("bash", "deny"), rule("bash", "deny", "rm *")],
      primaryTools: ["bash"],
    },
  );
  assert.deepEqual([reviewer.access, reviewer.offeredToModel], ["deny", true]);
});

test("a tool stays offered to the model unless its last rule denies every input", () => {
  const { lastDenies, narrowerDenyAfter, onlyPatterns } = accessFor("bash", [
    {
      name: "lastDenies",
      mode: "primary",
      permission: [rule("bash", "allow", "git *"), rule("bash", "deny")],
    },
    {
      name: "narrowerDenyAfter",
      mode: "primary",
      permission: [rule("bash", "deny"), rule("bash", "deny", "rm *")],
    },
    {
      name: "onlyPatterns",
      mode: "primary",
      permission: [rule("bash", "allow", "git *")],
    },
  ]);
  assert.deepEqual(
    [lastDenies.access, lastDenies.exceptions, lastDenies.offeredToModel],
    ["deny", [], false],
  );
  assert.deepEqual(
    [
      narrowerDenyAfter.access,
      narrowerDenyAfter.exceptions,
      narrowerDenyAfter.offeredToModel,
    ],
    ["deny", [], true],
  );
  assert.deepEqual(
    [onlyPatterns.access, onlyPatterns.exceptions, onlyPatterns.offeredToModel],
    ["ask", [{ pattern: "git *", access: "allow" }], true],
  );
});

test("patterns that cover every input reset the general access", () => {
  const { agent } = accessFor("bash", [
    {
      name: "agent",
      mode: "primary",
      permission: [
        rule("bash", "allow"),
        rule("bash", "ask", "git *"),
        rule("bash", "deny", "* *"),
      ],
    },
  ]);
  assert.deepEqual([agent.access, agent.exceptions], ["deny", []]);
});

test("exceptions that no longer change the answer are dropped", () => {
  const { agent } = accessFor("read", [
    {
      name: "agent",
      mode: "primary",
      permission: [
        rule("read", "allow"),
        rule("read", "ask", "b"),
        rule("read", "allow", "a"),
        rule("read", "allow", "b"),
      ],
    },
  ]);
  assert.deepEqual(agent.exceptions, []);
});

test("permission names written with backslashes match like OpenCode's", () => {
  const { agent } = accessFor("mcp/fetch", [
    {
      name: "agent",
      mode: "primary",
      permission: [rule("mcp\\*", "deny")],
    },
  ]);
  assert.equal(agent.access, "deny");
});

test("agent details are passed through for the browser to group and filter", () => {
  const { title } = accessFor("read", [
    {
      name: "title",
      mode: "primary",
      hidden: true,
      native: true,
      permission: [...defaults, rule("*", "deny")],
    },
  ]);
  assert.deepEqual(
    { mode: title.mode, hidden: title.hidden, native: title.native },
    { mode: "primary", hidden: true, native: true },
  );
});

test("unreadable rules or settings report unknown instead of throwing", () => {
  const agents = [
    { name: "missing", mode: "primary" },
    {
      name: "malformed",
      mode: "primary",
      permission: [{ permission: "read" }],
    },
    { name: "odd-mode", mode: "sideways", permission: defaults },
    { name: "sub", mode: "subagent", permission: defaults },
  ] as AgentInput[];
  const access = accessFor("read", agents, {
    primaryTools: "skill" as unknown as string[],
  });
  assert.equal(access.missing.access, "unknown");
  assert.equal(access.malformed.access, "unknown");
  assert.deepEqual(
    [access["odd-mode"].mode, access["odd-mode"].access],
    ["unknown", "allow"],
  );
  assert.equal(access.sub.access, "unknown");

  const { primary } = accessFor(
    "read",
    [{ name: "primary", mode: "primary", permission: defaults }],
    { sessionPermission: { read: "deny" } },
  );
  assert.equal(primary.access, "unknown");
  assert.equal(primary.offeredToModel, undefined);

  const [withNullOptions] = resolveToolAgentAccess(
    ["read"],
    [{ name: "build", mode: "primary", permission: defaults }],
    null as unknown as undefined,
  );
  assert.equal(withNullOptions.agents.at(0)?.access, "allow");
});

test("unusable tool and agent entries are skipped", () => {
  const result = resolveToolAgentAccess(
    ["read", { id: "bash" }, { name: "glob" }, 7] as unknown as string[],
    [
      { name: "build", mode: "primary", permission: defaults },
      { mode: "primary", permission: defaults },
      null,
    ] as unknown as AgentInput[],
  );
  assert.deepEqual(
    result.map((entry) => [
      entry.tool,
      entry.agents.map((agent) => agent.agent),
    ]),
    [
      ["read", ["build"]],
      ["bash", ["build"]],
    ],
  );
  assert.deepEqual(
    resolveToolAgentAccess(
      undefined as unknown as string[],
      undefined as unknown as AgentInput[],
    ),
    [],
  );
});

test("permission names ignore case on Windows, as OpenCode does", (t) => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  assert.ok(platform !== undefined);
  t.after(() => {
    Object.defineProperty(process, "platform", platform);
  });
  const agents = [
    { name: "agent", mode: "primary", permission: [rule("Bash", "deny")] },
  ];
  Object.defineProperty(process, "platform", { value: "linux" });
  assert.equal(accessFor("bash", agents).agent.access, "ask");
  Object.defineProperty(process, "platform", { value: "win32" });
  assert.equal(accessFor("bash", agents).agent.access, "deny");
});
