/**
 * Works out which agents may use each tool, following the permission rules
 * OpenCode 1.19 applies when it offers tools to a model and when a tool asks
 * for permission.
 *
 * Pass the agents from `client.app.agents()` and either the items of
 * `client.tool.list({ provider, model })` or the ids from `client.tool.ids()`.
 * Each agent's `permission` ruleset already combines OpenCode's defaults, the
 * global `permission` and legacy `tools` settings and the agent's own rules,
 * and disabled agents are already left out. Only permissions are applied here:
 * OpenCode also withholds some tools depending on the model, such as
 * `websearch` without a search provider, and `tool.list` already leaves those
 * out for the model it is given.
 */

export type PermissionAction = "allow" | "ask" | "deny";

export type ToolAccess = PermissionAction | "unknown";

export type AgentMode = "primary" | "subagent" | "all" | "unknown";

export interface PermissionRuleInput {
  readonly permission: string;
  readonly pattern: string;
  readonly action: PermissionAction;
}

export interface AgentInput {
  readonly name: string;
  readonly mode?: string;
  readonly hidden?: boolean;
  readonly native?: boolean;
  readonly permission?: unknown;
}

export type ToolInput = string | { readonly id: string };

export interface ToolAgentAccessOptions {
  /** `experimental.primary_tools` from the OpenCode config: tools denied to agents running as subagents. */
  readonly primaryTools?: readonly string[];
  /** The current session's own permission ruleset, which OpenCode applies after the agent's rules. */
  readonly sessionPermission?: unknown;
}

/** An input pattern whose access differs from the tool's general access. */
export interface PatternAccess {
  readonly pattern: string;
  readonly access: PermissionAction;
}

export interface AccessDecision {
  /** Access for inputs that no pattern in `exceptions` matches. */
  readonly access: ToolAccess;
  /** Pattern-specific access in OpenCode's precedence order: a later entry wins over an earlier one when both match. */
  readonly exceptions: readonly PatternAccess[];
}

export interface AgentToolAccess extends AccessDecision {
  readonly agent: string;
  readonly mode: AgentMode;
  readonly hidden: boolean;
  readonly native: boolean;
  /** For agents with mode `all`: access when the agent runs as a subagent, present only when it differs. */
  readonly whenSubagent?: AccessDecision;
}

export interface ToolAgentAccess {
  readonly tool: string;
  /** The permission name OpenCode checks for this tool, such as `edit` for `write`. */
  readonly permission: string;
  readonly agents: readonly AgentToolAccess[];
}

const editTools = new Set(["edit", "write", "apply_patch"]);
const mcpResourceReadTools = new Set([
  "list_mcp_resources",
  "list_mcp_resource_templates",
  "read_mcp_resource",
]);
const unknownDecision: AccessDecision = { access: "unknown", exceptions: [] };

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? (Reflect.get(value, key) as unknown)
    : undefined;
}

function isPermissionAction(value: unknown): value is PermissionAction {
  return value === "allow" || value === "ask" || value === "deny";
}

function readRule(value: unknown): PermissionRuleInput | undefined {
  const permission = field(value, "permission");
  const pattern = field(value, "pattern");
  const action = field(value, "action");
  if (
    typeof permission !== "string" ||
    typeof pattern !== "string" ||
    !isPermissionAction(action)
  ) {
    return undefined;
  }
  return { permission, pattern, action };
}

function readRuleset(value: unknown): PermissionRuleInput[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const rules: PermissionRuleInput[] = [];
  for (const item of value as unknown[]) {
    const rule = readRule(item);
    if (rule === undefined) {
      return undefined;
    }
    rules.push(rule);
  }
  return rules;
}

function readStringList(value: unknown): string[] | undefined {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings: string[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== "string") {
      return undefined;
    }
    strings.push(item);
  }
  return strings;
}

function readItems(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

function readAgent(value: unknown): AgentInput | undefined {
  const name = field(value, "name");
  if (typeof name !== "string") {
    return undefined;
  }
  const mode = field(value, "mode");
  return {
    name,
    mode: typeof mode === "string" ? mode : undefined,
    hidden: field(value, "hidden") === true,
    native: field(value, "native") === true,
    permission: field(value, "permission"),
  };
}

function readToolId(value: unknown): string | undefined {
  const id = typeof value === "string" ? value : field(value, "id");
  return typeof id === "string" ? id : undefined;
}

function readMode(mode: unknown): AgentMode {
  return mode === "primary" || mode === "subagent" || mode === "all"
    ? mode
    : "unknown";
}

function runsOnWindows(): boolean {
  return typeof process !== "undefined" && process.platform === "win32";
}

// Same matching as OpenCode's wildcard helper, including its trailing " *"
// special case, slash normalization and case-insensitive matching on Windows.
function matchesWildcard(input: string, pattern: string): boolean {
  let expression = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  if (expression.endsWith(" .*")) {
    expression = `${expression.slice(0, -3)}( .*)?`;
  }
  const flags = runsOnWindows() ? "si" : "s";
  return new RegExp(`^${expression}$`, flags).test(input.replaceAll("\\", "/"));
}

function isCatchAllPattern(pattern: string): boolean {
  return /^\*+$/.test(pattern);
}

function decide(
  permission: string,
  rules: readonly PermissionRuleInput[],
): AccessDecision {
  const matching = rules.filter((rule) =>
    matchesWildcard(permission, rule.permission),
  );
  const lastCatchAll = matching.findLastIndex((rule) =>
    isCatchAllPattern(rule.pattern),
  );
  const access = matching[lastCatchAll]?.action ?? "ask";
  const exceptions: PatternAccess[] = [];
  for (const rule of matching.slice(lastCatchAll + 1)) {
    const earlier = exceptions.findIndex(
      (exception) => exception.pattern === rule.pattern,
    );
    if (earlier !== -1) {
      exceptions.splice(earlier, 1);
    }
    if (exceptions.length === 0 && rule.action === access) {
      continue;
    }
    exceptions.push({ pattern: rule.pattern, access: rule.action });
  }
  return { access, exceptions };
}

function sameDecision(first: AccessDecision, second: AccessDecision): boolean {
  return (
    first.access === second.access &&
    first.exceptions.length === second.exceptions.length &&
    first.exceptions.every(
      (exception, index) =>
        exception.pattern === second.exceptions[index]?.pattern &&
        exception.access === second.exceptions[index].access,
    )
  );
}

function denyAll(permission: string): PermissionRuleInput {
  return { permission, pattern: "*", action: "deny" };
}

// Mirrors the rules OpenCode's task tool adds to a subagent's session. The
// parent session's own deny rules are left out because they depend on which
// session spawns the subagent.
function subagentSessionRules(
  agentRules: readonly PermissionRuleInput[],
  primaryTools: readonly string[],
): PermissionRuleInput[] {
  const namesPermission = (permission: string) =>
    agentRules.some((rule) => rule.permission === permission);
  return [
    ...["todowrite", "task"]
      .filter((permission) => !namesPermission(permission))
      .map(denyAll),
    ...primaryTools.map(denyAll),
  ];
}

function agentAccess(
  agent: AgentInput,
  permission: string,
  sessionRules: readonly PermissionRuleInput[] | undefined,
  primaryTools: readonly string[] | undefined,
): AgentToolAccess {
  const mode = readMode(agent.mode);
  const summary = {
    agent: agent.name,
    mode,
    hidden: agent.hidden === true,
    native: agent.native === true,
  };
  const agentRules = readRuleset(agent.permission);
  if (agentRules === undefined) {
    return { ...summary, ...unknownDecision };
  }
  const primaryDecision = () =>
    sessionRules === undefined
      ? unknownDecision
      : decide(permission, [...agentRules, ...sessionRules]);
  const subagentDecision = () =>
    primaryTools === undefined
      ? unknownDecision
      : decide(permission, [
          ...agentRules,
          ...subagentSessionRules(agentRules, primaryTools),
        ]);
  switch (mode) {
    case "subagent":
      return { ...summary, ...subagentDecision() };
    case "all": {
      const asPrimary = primaryDecision();
      const asSubagent = subagentDecision();
      return sameDecision(asPrimary, asSubagent)
        ? { ...summary, ...asPrimary }
        : { ...summary, ...asPrimary, whenSubagent: asSubagent };
    }
    case "primary":
    case "unknown":
      return { ...summary, ...primaryDecision() };
  }
}

export function permissionForTool(toolId: string): string {
  if (editTools.has(toolId)) {
    return "edit";
  }
  if (mcpResourceReadTools.has(toolId)) {
    return "read";
  }
  return toolId;
}

export function resolveToolAgentAccess(
  tools: readonly ToolInput[],
  agents: readonly AgentInput[],
  options: ToolAgentAccessOptions = {},
): ToolAgentAccess[] {
  const sessionRules = readRuleset(options.sessionPermission ?? []);
  const primaryTools = readStringList(options.primaryTools);
  const readableAgents = readItems(agents)
    .map(readAgent)
    .filter((agent) => agent !== undefined);
  return readItems(tools)
    .map(readToolId)
    .filter((tool) => tool !== undefined)
    .map((tool) => {
      const permission = permissionForTool(tool);
      return {
        tool,
        permission,
        agents: readableAgents.map((agent) =>
          agentAccess(agent, permission, sessionRules, primaryTools),
        ),
      };
    });
}
