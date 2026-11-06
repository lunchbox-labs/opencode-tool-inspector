import type {
  AccessDecision,
  AgentMode,
  AgentToolAccess,
  PermissionAction,
  ToolAgentAccess,
} from "./agents.ts";
import type { TextLine, TextSegment } from "./schema-text.ts";

const actionLabels: Record<PermissionAction, string> = {
  allow: "allowed",
  ask: "asks first",
  deny: "denied",
};

const modeLabels: Record<AgentMode, string | undefined> = {
  primary: "primary",
  subagent: "subagent",
  all: "primary or subagent",
  unknown: undefined,
};

function muted(text: string): TextSegment {
  return { text, tone: "muted" };
}

function plain(text: string): TextSegment {
  return { text, tone: "plain" };
}

function indent(depth: number): string {
  return "  ".repeat(depth);
}

function decisionSummary(decision: AccessDecision): string {
  if (decision.access === "unknown") {
    return "unknown, permissions couldn't be read";
  }
  if (decision.offeredToModel === false) {
    return "not offered to the model";
  }
  return actionLabels[decision.access];
}

function exceptionLines(decision: AccessDecision, depth: number): TextLine[] {
  if (decision.offeredToModel === false) {
    return [];
  }
  return decision.exceptions.map((exception) => [
    plain(`${indent(depth)}${actionLabels[exception.access]} for `),
    { text: exception.pattern, tone: "name" },
  ]);
}

function agentLines(agent: AgentToolAccess): TextLine[] {
  const notes = [
    modeLabels[agent.mode],
    ...(agent.hidden ? ["hidden"] : []),
  ].filter((note) => note !== undefined);
  const lines: TextLine[] = [
    [
      { text: agent.agent, tone: "name" },
      muted(
        `  ${notes.length === 0 ? "" : `${notes.join(", ")}: `}${decisionSummary(agent)}`,
      ),
    ],
    ...exceptionLines(agent, 1),
  ];
  if (agent.whenSubagent !== undefined) {
    lines.push(
      [
        plain(
          `${indent(1)}as a subagent: ${decisionSummary(agent.whenSubagent)}`,
        ),
      ],
      ...exceptionLines(agent.whenSubagent, 2),
    );
  }
  return lines;
}

/** OpenCode's own hidden agents, such as `compaction` and `title`, never take tool calls. */
function listed(agent: AgentToolAccess): boolean {
  return !(agent.native && agent.hidden);
}

function primaryFirst(left: AgentToolAccess, right: AgentToolAccess): number {
  const rank = (agent: AgentToolAccess) => (agent.mode === "subagent" ? 1 : 0);
  return rank(left) - rank(right);
}

/** Renders which agents can use a tool, primary agents first. */
export function agentAccessLines(access: ToolAgentAccess): TextLine[] {
  const agents = access.agents.filter(listed).sort(primaryFirst);
  if (agents.length === 0) {
    return [[muted("OpenCode reported no agents that use tools.")]];
  }
  const permissionNote: TextLine[] =
    access.permission === access.tool
      ? []
      : [[muted(`Checked as the ${access.permission} permission.`)]];
  const patternNote: TextLine[] = agents.some(
    (agent) =>
      exceptionLines(agent, 1).length > 0 ||
      (agent.whenSubagent !== undefined &&
        exceptionLines(agent.whenSubagent, 2).length > 0),
  )
    ? [
        [
          muted(
            "Patterns match the call's input, such as a command or path; a later line wins.",
          ),
        ],
      ]
    : [];
  return [...permissionNote, ...agents.flatMap(agentLines), ...patternNote];
}
