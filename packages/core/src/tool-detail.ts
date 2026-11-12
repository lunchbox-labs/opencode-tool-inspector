import { agentAccessLines } from "./agent-text.ts";
import type { ToolAgentAccess } from "./agents.ts";
import type { Host } from "./host.ts";
import { type TextLine, schemaLines } from "./schema-text.ts";
import type { BrowsableTool } from "./tools.ts";

export interface DetailSection {
  heading: string;
  lines: TextLine[];
}

export interface ToolDetail {
  title: string;
  subtitle: string | undefined;
  sections: DetailSection[];
}

function muted(text: string): TextLine[] {
  return [[{ text, tone: "muted" }]];
}

function textLines(text: string): TextLine[] {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => [{ text: line, tone: "plain" }]);
}

/**
 * The detail view's content. The Agents section is left out when the host's agents couldn't be
 * read.
 */
export function toolDetail(
  host: Host,
  tool: BrowsableTool,
  modelLabel: string | undefined,
  access?: ToolAgentAccess,
): ToolDetail {
  const detailsMissing = `${host.name} reported only this tool's name.`;
  return {
    title: tool.id,
    subtitle:
      modelLabel === undefined ? undefined : `As offered to ${modelLabel}`,
    sections: [
      {
        heading: "Input",
        lines:
          tool.description === undefined && tool.parameters === undefined
            ? muted(detailsMissing)
            : schemaLines(tool.parameters, host.name),
      },
      ...(access === undefined
        ? []
        : [{ heading: "Agents", lines: agentAccessLines(access, host) }]),
      {
        heading: "Description",
        lines:
          tool.description === undefined
            ? muted(detailsMissing)
            : tool.description.trim() === ""
              ? muted("No description.")
              : textLines(tool.description),
      },
    ],
  };
}
