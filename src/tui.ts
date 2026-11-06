import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
} from "@opencode-ai/plugin/tui";
import { createDetailViewer } from "./detail-viewer.ts";
import { linesText } from "./schema-text.ts";
import { type ToolDetail, toolDetail } from "./tool-detail.ts";
import {
  type BrowsableTool,
  type ModelChoice,
  configuredModel,
  descriptionSummary,
  inputCount,
  modelLabel,
  providerDefaultModel,
  sessionModel,
  toolsFromIds,
  toolsFromList,
} from "./tools.ts";

const toastTitle = "Tool Inspector";

type DialogElement = ReturnType<TuiPluginApi["ui"]["DialogAlert"]>;
type DialogSize = TuiPluginApi["ui"]["dialog"]["size"];
type DetailRenderer = (detail: ToolDetail) => DialogElement;

interface ToolCatalog {
  tools: BrowsableTool[];
  model: ModelChoice | undefined;
  /** Why the list has names only, shown once as a toast. */
  notice: string | undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
): Promise<ModelChoice | undefined> {
  const sessionId = currentSessionId(api);
  const fromSession =
    sessionId === undefined
      ? undefined
      : sessionModel(api.state.session.messages(sessionId));
  const chosen = fromSession ?? configuredModel(api.state.config.model);
  if (chosen !== undefined) {
    return chosen;
  }
  const response = await api.client.config.providers(
    { directory: api.state.path.directory },
    { signal },
  );
  return response.error === undefined
    ? providerDefaultModel(
        api.state.provider.map((provider) => provider.id),
        response.data.default,
      )
    : undefined;
}

async function readCatalog(
  api: TuiPluginApi,
  signal: AbortSignal,
): Promise<ToolCatalog> {
  const directory = api.state.path.directory;
  const model = await chooseModel(api, signal).catch(() => undefined);
  let listFailure: string | undefined;
  if (model !== undefined) {
    try {
      const response = await api.client.tool.list(
        { directory, provider: model.providerID, model: model.modelID },
        { signal },
      );
      const tools =
        response.error === undefined ? toolsFromList(response.data) : undefined;
      if (tools !== undefined) {
        return { tools, model, notice: undefined };
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
      listFailure ?? "OpenCode did not return a readable tool list.",
    );
  }
  return {
    tools,
    model: undefined,
    notice:
      model === undefined
        ? "No model is selected, so this lists every registered tool without details. Pick a model to see what OpenCode offers it."
        : `OpenCode did not return tool details for ${modelLabel(model)}, so this lists tool names only.`,
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
        catalog.model === undefined ? undefined : modelLabel(catalog.model),
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
                      `${section.heading}\n${linesText(section.lines)}`,
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
                : `Tools for ${modelLabel(catalog.model)}`,
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
              if (tool !== undefined && sameView()) {
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
    // Load the viewer alongside the list so opening a tool doesn't wait for it.
    detailViewer().catch(() => undefined);
    try {
      const catalog = await readCatalog(api, controller.signal);
      if (loading !== revision || !sameView()) {
        return;
      }
      if (catalog.tools.length === 0) {
        revision++;
        showing = false;
        api.ui.dialog.clear();
        toast("info", "OpenCode reported no tools.");
        return;
      }
      if (catalog.notice !== undefined) {
        toast("warning", catalog.notice);
      }
      views.list(catalog, undefined);
    } catch (error) {
      if (loading === revision && sameView()) {
        revision++;
        showing = false;
        api.ui.dialog.clear();
        toast(
          "warning",
          `Could not read tools from OpenCode: ${errorText(error)}`,
        );
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
      revision++;
      showing = false;
      api.ui.dialog.clear();
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
