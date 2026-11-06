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
 * The detail view's content. Further sections, such as the agents that can use the tool,
 * are appended to `sections`.
 */
export function toolDetail(
  tool: BrowsableTool,
  modelLabel: string | undefined,
): ToolDetail {
  const detailsMissing = "OpenCode reported only this tool's name.";
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
            : schemaLines(tool.parameters),
      },
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
