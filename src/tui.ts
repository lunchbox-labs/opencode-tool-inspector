import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
} from "@opencode-ai/plugin/tui";
import {
  type AgentInput,
  type ToolAgentAccess,
  resolveToolAgentAccess,
} from "./agents.ts";
import { createDetailViewer } from "./detail-viewer.ts";
import { linesText } from "./schema-text.ts";
import { type ToolDetail, toolDetail } from "./tool-detail.ts";
import {
  type BrowsableTool,
  type ChosenModel,
  chosenModelLabel,
  configuredModel,
  descriptionSummary,
  inputCount,
  providerDefaultModel,
  sessionModel,
  toolsFromIds,
  toolsFromList,
} from "./tools.ts";

const toastTitle = "Tool Inspector";
/** The plain-text fallback can't scroll, so long sections are cut short. */
const plainTextSectionLines = 20;

type DialogElement = ReturnType<TuiPluginApi["ui"]["DialogAlert"]>;
type DialogSize = TuiPluginApi["ui"]["dialog"]["size"];
type DetailRenderer = (detail: ToolDetail) => DialogElement;

interface ToolCatalog {
  tools: BrowsableTool[];
  model: ChosenModel | undefined;
  /** Why the list has names only, shown once as a toast. */
  notice: string | undefined;
  /** Each tool's access per agent, undefined when OpenCode's agents couldn't be read. */
  access: ReadonlyMap<string, ToolAgentAccess> | undefined;
  /** Why tool details leave out agents, shown once as a toast. */
  agentsNotice: string | undefined;
}

type ToolList = Pick<ToolCatalog, "tools" | "model" | "notice">;

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null) {
    const record = error as { message?: unknown; data?: { message?: unknown } };
    if (typeof record.message === "string") {
      return record.message;
    }
    if (typeof record.data?.message === "string") {
      return record.data.message;
    }
    return JSON.stringify(error);
  }
  return String(error);
}

/** Names of connected MCP servers, whose tools OpenCode's tool list leaves out. */
function connectedMcpServers(api: TuiPluginApi): string[] {
  try {
    return api.state
      .mcp()
      .filter((server) => server.status === "connected")
      .map((server) => server.name);
  } catch {
    return [];
  }
}

function mcpNotice(servers: readonly string[]): string | undefined {
  if (servers.length === 0) {
    return undefined;
  }
  const names = servers.join(", ");
  return `Tools from MCP servers (${names}) aren't listed, because OpenCode only adds them when it runs a prompt.`;
}

function currentSessionId(api: TuiPluginApi): string | undefined {
  const route = api.route.current;
  return route.name === "session" && typeof route.params?.sessionID === "string"
    ? route.params.sessionID
    : undefined;
}

async function chooseModel(
  api: TuiPluginApi,
  signal: AbortSignal,
): Promise<ChosenModel | undefined> {
  const sessionId = currentSessionId(api);
  const fromSession =
    sessionId === undefined
      ? undefined
      : sessionModel(api.state.session.messages(sessionId));
  if (fromSession !== undefined) {
    return { ...fromSession, source: "session" };
  }
  const connectedProviderIds = api.state.provider.map(
    (provider) => provider.id,
  );
  const configured = configuredModel(api.state.config.model);
  // OpenCode skips a configured model whose provider isn't connected.
  if (
    configured !== undefined &&
    (connectedProviderIds.length === 0 ||
      connectedProviderIds.includes(configured.providerID))
  ) {
    return { ...configured, source: "configured" };
  }
  const response = await api.client.config.providers(
    { directory: api.state.path.directory },
    { signal },
  );
  if (response.error !== undefined) {
    throw new Error(errorText(response.error));
  }
  const fallback = providerDefaultModel(
    connectedProviderIds,
    response.data.default,
  );
  return fallback === undefined
    ? undefined
    : { ...fallback, source: "provider default" };
}

async function readAgents(
  api: TuiPluginApi,
  signal: AbortSignal,
): Promise<AgentInput[]> {
  // Guards hosts whose client predates the agents route.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the host supplies the client at runtime.
  if (typeof api.client.app?.agents !== "function") {
    throw new Error("this OpenCode doesn't list agents");
  }
  const response = await api.client.app.agents(
    { directory: api.state.path.directory },
    { signal },
  );
  if (response.error !== undefined) {
    throw new Error(errorText(response.error));
  }
  const agents: unknown = response.data;
  if (!Array.isArray(agents)) {
    throw new Error("the response wasn't an agent list");
  }
  // resolveToolAgentAccess skips entries it can't read.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- entries are validated field by field downstream.
  return agents as AgentInput[];
}

/**
 * The permission rules of the current session's top-level session, which OpenCode applies after
 * each agent's own rules. Sessions usually have none. When a parent isn't loaded, the topmost
 * session found is used, since a child session carries copies of its parent's deny rules.
 */
function sessionPermission(api: TuiPluginApi): unknown {
  const sessionId = currentSessionId(api);
  if (sessionId === undefined) {
    return [];
  }
  try {
    let session = api.state.session.get(sessionId);
    const seen = new Set<string>();
    while (session?.parentID !== undefined && !seen.has(session.id)) {
      seen.add(session.id);
      const parent = api.state.session.get(session.parentID);
      if (parent === undefined) {
        break;
      }
      session = parent;
    }
    return session?.permission ?? [];
  } catch {
    return [];
  }
}

function primaryTools(api: TuiPluginApi): unknown {
  try {
    return api.state.config.experimental?.primary_tools;
  } catch {
    return undefined;
  }
}

function accessByTool(
  api: TuiPluginApi,
  tools: readonly BrowsableTool[],
  agents: readonly AgentInput[],
): Map<string, ToolAgentAccess> {
  const resolved = resolveToolAgentAccess(
    tools.map((tool) => tool.id),
    agents,
    {
      // The module reads both options defensively and reports unreadable ones as unknown.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated in resolveToolAgentAccess.
      primaryTools: primaryTools(api) as readonly string[] | undefined,
      sessionPermission: sessionPermission(api),
    },
  );
  return new Map(resolved.map((access) => [access.tool, access]));
}

async function readToolList(
  api: TuiPluginApi,
  signal: AbortSignal,
): Promise<ToolList> {
  const directory = api.state.path.directory;
  let modelFailure: string | undefined;
  const model = await chooseModel(api, signal).catch((error: unknown) => {
    modelFailure = errorText(error);
    return undefined;
  });
  let listFailure: string | undefined;
  if (model !== undefined) {
    try {
      const response = await api.client.tool.list(
        { directory, provider: model.providerID, model: model.modelID },
        { signal },
      );
      if (response.error === undefined) {
        const tools = toolsFromList(response.data);
        if (tools !== undefined) {
          return { tools, model, notice: undefined };
        }
        listFailure = "the response wasn't a tool list";
      } else {
        listFailure = errorText(response.error);
      }
    } catch (error) {
      listFailure = errorText(error);
    }
  }
  const response = await api.client.tool.ids({ directory }, { signal });
  const tools =
    response.error === undefined ? toolsFromIds(response.data) : undefined;
  if (tools === undefined) {
    throw new Error(
      listFailure ??
        modelFailure ??
        (response.error === undefined
          ? "OpenCode did not return a readable tool list."
          : errorText(response.error)),
    );
  }
  const namesOnly =
    model === undefined
      ? modelFailure === undefined
        ? "No model is selected, so this lists every registered tool without details. Pick a model to see what OpenCode offers it."
        : `Could not work out the current model (${modelFailure}), so this lists tool names only.`
      : `OpenCode did not return tool details for ${chosenModelLabel(model)} (${listFailure ?? "no reason given"}), so this lists tool names only.`;
  return { tools, model: undefined, notice: namesOnly };
}

async function readCatalog(
  api: TuiPluginApi,
  signal: AbortSignal,
): Promise<ToolCatalog> {
  let agentsFailure: string | undefined;
  const agentsRead = readAgents(api, signal).catch((error: unknown) => {
    agentsFailure = errorText(error);
    return undefined;
  });
  const list = await readToolList(api, signal);
  const agents = await agentsRead;
  let access: Map<string, ToolAgentAccess> | undefined;
  if (agents !== undefined) {
    try {
      access = accessByTool(api, list.tools, agents);
    } catch (error) {
      agentsFailure = errorText(error);
    }
  }
  return {
    ...list,
    access,
    agentsNotice:
      access === undefined
        ? `Could not read OpenCode's agents (${agentsFailure ?? "no reason given"}), so tool details don't show which agents can use each tool.`
        : undefined,
  };
}

function inputCountLabel(tool: BrowsableTool): string | undefined {
  const count = inputCount(tool.parameters);
  if (count === undefined) {
    return undefined;
  }
  return count === 1 ? "1 input" : `${count} inputs`;
}

function registerToolBrowser(api: TuiPluginApi): void {
  const toast = (variant: "info" | "warning", message: string) => {
    api.ui.toast({
      variant,
      title: toastTitle,
      message,
      duration: variant === "warning" ? 10_000 : 5_000,
    });
  };

  let viewer: Promise<DetailRenderer | undefined> | undefined;
  const detailViewer = () => {
    viewer ??= createDetailViewer(api).catch((error: unknown) => {
      toast(
        "warning",
        `Showing tool details as plain text: ${errorText(error)}`,
      );
      return undefined;
    });
    return viewer;
  };

  /** Each displayed dialog gets a revision, so stale close callbacks and late reads are ignored. */
  let revision = 0;
  let showing = false;
  /** The read behind the loading dialog, aborted once anything replaces that dialog. */
  let activeRead: AbortController | undefined;

  const close = () => {
    revision++;
    showing = false;
    activeRead?.abort();
    activeRead = undefined;
    api.ui.dialog.clear();
  };

  const viewContext = () => {
    const directory = api.state.path.directory;
    const sessionId = currentSessionId(api);
    const routeName = api.route.current.name;
    return () =>
      !api.lifecycle.signal.aborted &&
      directory === api.state.path.directory &&
      routeName === api.route.current.name &&
      sessionId === currentSessionId(api);
  };

  const display = (
    render: () => DialogElement,
    size: DialogSize,
    onClosed?: () => void,
  ): number => {
    const active = ++revision;
    showing = true;
    activeRead?.abort();
    activeRead = undefined;
    api.ui.dialog.replace(render, () => {
      if (active !== revision) {
        return;
      }
      revision++;
      showing = false;
      onClosed?.();
    });
    api.ui.dialog.setSize(size);
    return active;
  };

  const views = {
    async detail(catalog: ToolCatalog, tool: BrowsableTool) {
      const listRevision = revision;
      const sameView = viewContext();
      const detail = toolDetail(
        tool,
        catalog.model === undefined
          ? undefined
          : chosenModelLabel(catalog.model),
        catalog.access?.get(tool.id),
      );
      const render = await detailViewer();
      if (listRevision !== revision || !sameView()) {
        return;
      }
      display(
        render === undefined
          ? () =>
              api.ui.DialogAlert({
                title: detail.title,
                message: detail.sections
                  .map(
                    (section) =>
                      `${section.heading}\n${linesText(section.lines.slice(0, plainTextSectionLines))}${section.lines.length > plainTextSectionLines ? "\n…" : ""}`,
                  )
                  .join("\n\n"),
              })
          : () => render(detail),
        "xlarge",
        () => {
          const closedRevision = revision;
          // The host clears the dialog after this callback; return to the list afterwards.
          queueMicrotask(() => {
            if (
              closedRevision === revision &&
              !api.ui.dialog.open &&
              sameView()
            ) {
              views.list(catalog, tool.id);
            }
          });
        },
      );
    },

    list(catalog: ToolCatalog, current: string | undefined) {
      const sameView = viewContext();
      display(
        () =>
          api.ui.DialogSelect({
            title:
              catalog.model === undefined
                ? "Tools"
                : `Tools for ${chosenModelLabel(catalog.model)}`,
            placeholder: "Search tools",
            current,
            options: catalog.tools.map((tool) => {
              const summary = descriptionSummary(tool.description);
              const footer = inputCountLabel(tool);
              return {
                title: tool.id,
                value: tool.id,
                ...(summary === "" ? {} : { description: summary }),
                ...(footer === undefined ? {} : { footer }),
              };
            }),
            onSelect: (option) => {
              const tool = catalog.tools.find(
                (item) => item.id === option.value,
              );
              if (!sameView()) {
                close();
                toast("info", "The session changed, so run /tools again.");
                return;
              }
              if (tool !== undefined) {
                views.detail(catalog, tool).catch((error: unknown) => {
                  toast(
                    "warning",
                    `Could not show ${tool.id}: ${errorText(error)}`,
                  );
                });
              }
            },
          }),
        "large",
      );
    },
  };

  const open = async () => {
    const sameView = viewContext();
    const controller = new AbortController();
    const abort = () => controller.abort();
    api.lifecycle.signal.addEventListener("abort", abort, { once: true });
    const loading = display(
      () =>
        api.ui.DialogAlert({
          title: "Loading tools",
          message: "Reading the tools OpenCode offers…",
        }),
      "medium",
      abort,
    );
    activeRead = controller;
    // Load the viewer alongside the list so opening a tool doesn't wait for it.
    detailViewer().catch(() => undefined);
    try {
      const catalog = await readCatalog(api, controller.signal);
      if (loading !== revision) {
        return;
      }
      if (!sameView()) {
        close();
        return;
      }
      if (catalog.tools.length === 0) {
        close();
        toast("info", "OpenCode reported no tools.");
        return;
      }
      const notices = [
        catalog.notice,
        catalog.agentsNotice,
        mcpNotice(connectedMcpServers(api)),
      ].filter((notice) => notice !== undefined);
      if (notices.length > 0) {
        toast(
          catalog.notice === undefined && catalog.agentsNotice === undefined
            ? "info"
            : "warning",
          notices.join(" "),
        );
      }
      views.list(catalog, undefined);
    } catch (error) {
      if (loading === revision) {
        close();
        if (sameView()) {
          toast(
            "warning",
            `Could not read tools from OpenCode: ${errorText(error)}`,
          );
        }
      }
    } finally {
      api.lifecycle.signal.removeEventListener("abort", abort);
    }
  };

  const unregister = api.keymap.registerLayer({
    commands: [
      {
        name: "tool-inspector.browse",
        title: "Browse tools",
        category: "Tools",
        namespace: "palette",
        slashName: "tools",
        // Native command dispatch clears its picker after invoking the handler.
        run: () =>
          Promise.resolve()
            .then(open)
            .catch((error: unknown) => {
              toast("warning", `Could not open tools: ${errorText(error)}`);
            }),
      },
    ],
  });
  const stopWatching = api.event.on("server.instance.disposed", (event) => {
    if (event.properties.directory === api.state.path.directory && showing) {
      close();
    }
  });
  api.lifecycle.onDispose(() => {
    unregister();
    stopWatching();
  });
}

const ToolInspectorTui: TuiPlugin = (api) => {
  registerToolBrowser(api);
  return Promise.resolve();
};

export default {
  id: "tool-inspector",
  tui: ToolInspectorTui,
} satisfies TuiPluginModule;
