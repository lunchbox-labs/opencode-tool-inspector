import { EventEmitter } from "node:events";
import { registerHooks } from "node:module";
import type {
  TuiDialogSelectProps,
  TuiPluginApi,
} from "@opencode-ai/plugin/tui";
import { BoxRenderable, TextRenderable } from "./opentui-double.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === "@opentui/core" &&
      /\/detail-viewer\.(?:ts|js)$/.test(context.parentURL ?? "")
    ) {
      return {
        url: new URL("./opentui-double.ts", import.meta.url).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

export type Dialog =
  | { kind: "select"; props: TuiDialogSelectProps<string> }
  | { kind: "alert"; title: string; message: string }
  | { kind: "detail"; title: string; text: string; element: BoxRenderable };

/** The title and every line of text a detail view shows, below its title. */
export function detailText(element: BoxRenderable): {
  title: string;
  text: string;
} {
  const texts: string[] = [];
  const walk = (node: BoxRenderable) => {
    if (node instanceof TextRenderable) {
      texts.push(node.plainText);
    }
    node.getChildren().forEach(walk);
  };
  walk(element);
  const [title = "", ...rest] = texts;
  return { title, text: rest.join("\n") };
}

interface RegisteredCommand {
  name: string;
  slashName?: string;
  title: string;
  run: () => unknown;
}

export interface FakeHost {
  api: TuiPluginApi;
  /** The command the plugin registered, as the palette and slash menu would run it. */
  run: () => Promise<void>;
  commands: RegisteredCommand[];
  dialog: () => Dialog | undefined;
  /** Closes the current dialog as Escape does: the host runs onClose, then clears. */
  escape: () => Promise<void>;
  toasts: { variant?: string; message: string }[];
  route: { name: string; params?: Record<string, unknown> };
  emit: (type: string, event: unknown) => void;
  abort: () => void;
  settle: () => Promise<void>;
}

export function fakeHost(
  client: unknown,
  options: {
    config?: Record<string, unknown>;
    providers?: { id: string }[];
    messages?: Record<string, unknown[]>;
    route?: { name: string; params?: Record<string, unknown> };
    mcp?: { name: string; status: string }[];
    sessions?: Record<string, Record<string, unknown>>;
  } = {},
): FakeHost {
  const controller = new AbortController();
  const renderer = Object.assign(new EventEmitter(), { height: 40 });
  let current: { render: () => unknown; onClose?: () => void } | undefined;
  const commands: RegisteredCommand[] = [];
  const toasts: FakeHost["toasts"] = [];
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const route = options.route ?? { name: "home" };
  const settle = async () => {
    for (let round = 0; round < 10; round++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  const api = {
    renderer,
    theme: {
      current: {
        text: "text",
        textMuted: "muted",
        accent: "accent",
        border: "border",
        backgroundElement: "element",
      },
    },
    route: {
      get current() {
        return route;
      },
    },
    state: {
      config: options.config ?? {},
      provider: options.providers ?? [],
      path: { directory: "/project", worktree: "/project" },
      session: {
        messages: (sessionID: string) => options.messages?.[sessionID] ?? [],
        get: (sessionID: string) => options.sessions?.[sessionID],
      },
      mcp: () => options.mcp ?? [],
    },
    client,
    lifecycle: {
      signal: controller.signal,
      onDispose: () => () => {},
    },
    keymap: {
      registerLayer(layer: { commands?: RegisteredCommand[] }) {
        commands.push(...(layer.commands ?? []));
        return () => {};
      },
    },
    event: {
      on(type: string, handler: (event: unknown) => void) {
        listeners.set(type, [...(listeners.get(type) ?? []), handler]);
        return () => {};
      },
    },
    ui: {
      toast: (toast: FakeHost["toasts"][number]) => toasts.push(toast),
      DialogSelect: (props: TuiDialogSelectProps<string>) => ({
        kind: "select",
        props,
      }),
      DialogAlert: (props: { title: string; message: string }) => ({
        kind: "alert",
        ...props,
      }),
      dialog: {
        replace(render: () => unknown, onClose?: () => void) {
          const previous = current;
          current = { render, onClose };
          previous?.onClose?.();
        },
        clear() {
          const previous = current;
          current = undefined;
          previous?.onClose?.();
        },
        setSize() {},
        get open() {
          return current !== undefined;
        },
      },
    },
  } as unknown as TuiPluginApi;
  return {
    api,
    commands,
    toasts,
    route,
    async run() {
      const command = commands.find(
        (item) => item.name === "tool-inspector.browse",
      );
      await command?.run();
      await settle();
    },
    dialog() {
      const element = current?.render() as Dialog | BoxRenderable | undefined;
      if (element instanceof BoxRenderable) {
        return { kind: "detail", element, ...detailText(element) };
      }
      return element;
    },
    async escape() {
      const closing = current;
      closing?.onClose?.();
      if (current === closing) {
        current = undefined;
      }
      await settle();
    },
    emit(type, event) {
      for (const handler of listeners.get(type) ?? []) {
        handler(event);
      }
    },
    abort: () => controller.abort(),
    settle,
  };
}
