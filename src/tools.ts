export interface ModelChoice {
  providerID: string;
  modelID: string;
}

/** Where the browsed model came from, since the next prompt may use another. */
export type ModelSource = "session" | "configured" | "provider default";

export interface ChosenModel extends ModelChoice {
  source: ModelSource;
}

const sourceLabels: Record<ModelSource, string> = {
  session: "this session's model",
  configured: "configured model",
  "provider default": "provider default",
};

export interface BrowsableTool {
  id: string;
  /** Undefined when OpenCode reported only the tool's id. */
  description: string | undefined;
  parameters: unknown;
}

/** OpenCode's placeholder for unknown tool calls, never offered to agents as a real tool. */
const internalToolIds = new Set(["invalid"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function modelLabel(model: ModelChoice): string {
  return `${model.providerID}/${model.modelID}`;
}

export function chosenModelLabel(model: ChosenModel): string {
  return `${modelLabel(model)} (${sourceLabels[model.source]})`;
}

/** The model of the session's latest user message, which OpenCode resolves tools for on the next prompt. */
export function sessionModel(
  messages: readonly unknown[],
): ModelChoice | undefined {
  for (const message of [...messages].reverse()) {
    if (!isRecord(message) || message.role !== "user") {
      continue;
    }
    const model = message.model;
    if (
      isRecord(model) &&
      typeof model.providerID === "string" &&
      typeof model.modelID === "string" &&
      model.providerID !== "" &&
      model.modelID !== ""
    ) {
      return { providerID: model.providerID, modelID: model.modelID };
    }
  }
  return undefined;
}

/** Parses the `provider/model` form used by the `model` setting. */
export function configuredModel(model: unknown): ModelChoice | undefined {
  if (typeof model !== "string") {
    return undefined;
  }
  const separator = model.indexOf("/");
  if (separator <= 0 || separator === model.length - 1) {
    return undefined;
  }
  return {
    providerID: model.slice(0, separator),
    modelID: model.slice(separator + 1),
  };
}

/** The first connected provider's default model, which OpenCode falls back to when none is configured. */
export function providerDefaultModel(
  connectedProviderIds: readonly string[],
  defaults: unknown,
): ModelChoice | undefined {
  if (!isRecord(defaults)) {
    return undefined;
  }
  for (const providerID of connectedProviderIds) {
    const modelID = defaults[providerID];
    if (typeof modelID === "string" && modelID !== "") {
      return { providerID, modelID };
    }
  }
  return undefined;
}

function byId(left: BrowsableTool, right: BrowsableTool): number {
  return left.id.localeCompare(right.id);
}

/** Keeps well-formed entries from OpenCode's tool list, sorted by id. */
export function toolsFromList(response: unknown): BrowsableTool[] | undefined {
  if (!Array.isArray(response)) {
    return undefined;
  }
  const tools = new Map<string, BrowsableTool>();
  for (const item of response) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      item.id === "" ||
      internalToolIds.has(item.id)
    ) {
      continue;
    }
    tools.set(item.id, {
      id: item.id,
      description:
        typeof item.description === "string" ? item.description : undefined,
      parameters: item.parameters,
    });
  }
  return [...tools.values()].sort(byId);
}

/** Tool ids without details, for when OpenCode can't resolve tools for a model. */
export function toolsFromIds(response: unknown): BrowsableTool[] | undefined {
  if (!Array.isArray(response)) {
    return undefined;
  }
  const ids = new Set(
    response.filter(
      (id): id is string =>
        typeof id === "string" && id !== "" && !internalToolIds.has(id),
    ),
  );
  return [...ids]
    .map((id) => ({ id, description: undefined, parameters: undefined }))
    .sort(byId);
}

const summaryLength = 100;

/** The first line of a description without its list marker, short enough for one list row. */
export function descriptionSummary(description: string | undefined): string {
  const firstLine =
    description
      ?.split(/\r?\n/)
      .map((line) => line.trim().replace(/^[-*•]\s+/, ""))
      .find((line) => line !== "") ?? "";
  return firstLine.length > summaryLength
    ? `${firstLine.slice(0, summaryLength - 1).trimEnd()}…`
    : firstLine;
}

/**
 * The number of top-level input properties, or undefined when the schema has none to count, such
 * as a union beside empty `properties`.
 */
export function inputCount(parameters: unknown): number | undefined {
  if (!isRecord(parameters) || !isRecord(parameters.properties)) {
    return undefined;
  }
  const count = Object.keys(parameters.properties).length;
  return count === 0 &&
    (parameters.anyOf !== undefined || parameters.oneOf !== undefined)
    ? undefined
    : count;
}
