import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeHost } from "./tui-harness.ts";
import plugin from "../src/tui.ts";

const readTool = {
  id: "read",
  description:
    "Read a file from the local filesystem.\n\nUsage:\n- Use absolute paths.",
  parameters: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "The absolute path to read" },
      limit: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    },
    required: ["filePath"],
  },
};
const bashTool = {
  id: "bash",
  description: "- Executes a bash command.\n- Avoids interactive commands.",
  parameters: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
};

function client(overrides: Record<string, unknown> = {}) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    tool: {
      async list(input: Record<string, unknown>) {
        calls.push(input);
        return {
          data: [
            readTool,
            { id: "invalid", description: "Do not use", parameters: {} },
            bashTool,
          ],
        };
      },
      async ids() {
        return { data: ["read", "bash", "invalid", "websearch"] };
      },
      ...overrides,
    },
    config: {
      async providers() {
        return {
          data: { providers: [], default: { anthropic: "claude-sonnet" } },
        };
      },
    },
  };
}

async function start(sdk: unknown, options?: Parameters<typeof fakeHost>[1]) {
  const host = fakeHost(sdk, options);
  await plugin.tui(host.api, undefined, {} as never);
  return host;
}

test("/tools lists the tools OpenCode offers the configured model, without the internal placeholder", async () => {
  const sdk = client();
  const host = await start(sdk, { config: { model: "openai/gpt-5" } });
  assert.deepEqual(
    host.commands.map(({ name, slashName, title }) => ({
      name,
      slashName,
      title,
    })),
    [
      {
        name: "tool-inspector.browse",
        slashName: "tools",
        title: "Browse tools",
      },
    ],
  );
  await host.run();
  assert.deepEqual(sdk.calls, [
    { directory: "/project", provider: "openai", model: "gpt-5" },
  ]);
  const dialog = host.dialog();
  assert.equal(dialog?.kind, "select");
  assert.equal(dialog.props.title, "Tools for openai/gpt-5 (configured model)");
  assert.deepEqual(
    dialog.props.options.map(({ title, description, footer }) => ({
      title,
      description,
      footer,
    })),
    [
      {
        title: "bash",
        description: "Executes a bash command.",
        footer: "1 input",
      },
      {
        title: "read",
        description: "Read a file from the local filesystem.",
        footer: "2 inputs",
      },
    ],
  );
  assert.deepEqual(host.toasts, []);
});

test("the session's latest model wins over the configured one", async () => {
  const sdk = client();
  const host = await start(sdk, {
    config: { model: "openai/gpt-5" },
    route: { name: "session", params: { sessionID: "ses_1" } },
    messages: {
      ses_1: [
        { role: "user", model: { providerID: "openai", modelID: "gpt-5" } },
        {
          role: "user",
          model: { providerID: "anthropic", modelID: "claude-opus" },
        },
        { role: "assistant", providerID: "openai", modelID: "gpt-5" },
      ],
    },
  });
  await host.run();
  assert.deepEqual(sdk.calls, [
    { directory: "/project", provider: "anthropic", model: "claude-opus" },
  ]);
});

test("without a configured model the first connected provider's default is used", async () => {
  const sdk = client();
  const host = await start(sdk, { providers: [{ id: "anthropic" }] });
  await host.run();
  assert.deepEqual(sdk.calls, [
    { directory: "/project", provider: "anthropic", model: "claude-sonnet" },
  ]);
});

test("choosing a tool shows its description and input, and Escape returns to it in the list", async () => {
  const host = await start(client(), { config: { model: "openai/gpt-5" } });
  await host.run();
  const list = host.dialog();
  assert.equal(list?.kind, "select");
  list.props.onSelect?.(list.props.options[1]);
  await host.settle();
  const detail = host.dialog();
  assert.equal(detail?.kind, "detail");
  assert.equal(detail.title, "read");
  assert.equal(
    detail.text,
    [
      "As offered to openai/gpt-5 (configured model)",
      "Input",
      "filePath  string, required\n  The absolute path to read\nlimit  integer, ≥ 0",
      "Description",
      "Read a file from the local filesystem.\n\nUsage:\n- Use absolute paths.",
      "↑/↓ scroll · pgup/pgdn page · home/end · esc back",
    ].join("\n"),
  );
  await host.escape();
  const restored = host.dialog();
  assert.equal(restored?.kind, "select");
  assert.equal(restored.props.current, "read");
  await host.escape();
  assert.equal(host.dialog(), undefined);
});

test("when tool details are unavailable the list falls back to names with a warning", async () => {
  const host = await start(
    client({
      async list() {
        return { error: { name: "BadRequest" } };
      },
    }),
    { config: { model: "openai/gpt-5" } },
  );
  await host.run();
  const list = host.dialog();
  assert.equal(list?.kind, "select");
  assert.equal(list.props.title, "Tools");
  assert.deepEqual(
    list.props.options.map((option) => option.title),
    ["bash", "read", "websearch"],
  );
  assert.deepEqual(
    host.toasts.map((toast) => toast.variant),
    ["warning"],
  );
  assert.match(host.toasts[0].message, /openai\/gpt-5.*names only/);
  list.props.onSelect?.(list.props.options[0]);
  await host.settle();
  const detail = host.dialog();
  assert.equal(detail?.kind, "detail");
  assert.match(detail.text, /OpenCode reported only this tool's name/);
});

test("with no model at all the registered tool names are listed", async () => {
  const sdk = client();
  const host = await start(sdk);
  await host.run();
  assert.deepEqual(sdk.calls, []);
  const list = host.dialog();
  assert.equal(list?.kind, "select");
  assert.equal(list.props.options.length, 3);
  assert.match(host.toasts[0]?.message ?? "", /No model is selected/);
});

test("a failed read closes the loading dialog with a toast instead of throwing", async () => {
  const host = await start(
    client({
      async list() {
        throw new Error("connection refused");
      },
      async ids() {
        throw new Error("connection refused");
      },
    }),
    { config: { model: "openai/gpt-5" } },
  );
  await host.run();
  assert.equal(host.dialog(), undefined);
  assert.deepEqual(host.toasts, [
    {
      variant: "warning",
      title: "Tool Inspector",
      message: "Could not read tools from OpenCode: connection refused",
      duration: 10_000,
    },
  ]);
});

test("closing the loading dialog aborts the read and discards a late tool list", async () => {
  let finish: (value: unknown) => void = () => {};
  let signal: AbortSignal | undefined;
  const host = await start(
    client({
      list: (_input: unknown, options: { signal: AbortSignal }) => {
        signal = options.signal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    }),
    { config: { model: "openai/gpt-5" } },
  );
  const running = host.run();
  await host.settle();
  assert.equal(host.dialog()?.kind, "alert");
  await host.escape();
  assert.equal(signal?.aborted, true);
  finish({ data: [readTool] });
  await running;
  await host.settle();
  assert.equal(host.dialog(), undefined);
  assert.deepEqual(host.toasts, []);
});

test("running /tools again aborts the first read and shows only the second list", async () => {
  const signals: AbortSignal[] = [];
  const finishes: ((value: unknown) => void)[] = [];
  const host = await start(
    client({
      list: (_input: unknown, options: { signal: AbortSignal }) => {
        signals.push(options.signal);
        return new Promise((resolve) => {
          finishes.push(resolve);
        });
      },
    }),
    { config: { model: "openai/gpt-5" } },
  );
  const first = host.run();
  await host.settle();
  const second = host.run();
  await host.settle();
  assert.equal(signals.length, 2);
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  finishes[1]({ data: [bashTool] });
  finishes[0]({ data: [readTool] });
  await Promise.all([first, second]);
  await host.settle();
  const list = host.dialog();
  assert.equal(list?.kind, "select");
  assert.deepEqual(
    list.props.options.map((option) => option.title),
    ["bash"],
  );
});

test("leaving the session while tools load closes the loading dialog", async () => {
  let finish: (value: unknown) => void = () => {};
  const host = await start(
    client({
      list: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    }),
    { config: { model: "openai/gpt-5" } },
  );
  const running = host.run();
  await host.settle();
  assert.equal(host.dialog()?.kind, "alert");
  host.route.name = "session";
  host.route.params = { sessionID: "ses_2" };
  finish({ data: [readTool] });
  await running;
  await host.settle();
  assert.equal(host.dialog(), undefined);
});

test("choosing a tool after leaving the session closes the list with a hint", async () => {
  const host = await start(client(), { config: { model: "openai/gpt-5" } });
  await host.run();
  const list = host.dialog();
  assert.equal(list?.kind, "select");
  host.route.name = "session";
  host.route.params = { sessionID: "ses_2" };
  list.props.onSelect?.(list.props.options[0]);
  await host.settle();
  assert.equal(host.dialog(), undefined);
  assert.match(host.toasts.at(-1)?.message ?? "", /run \/tools again/);
});

test("a configured model whose provider isn't connected gives way to the provider default", async () => {
  const sdk = client();
  const host = await start(sdk, {
    config: { model: "openai/gpt-5" },
    providers: [{ id: "anthropic" }],
  });
  await host.run();
  assert.deepEqual(sdk.calls, [
    { directory: "/project", provider: "anthropic", model: "claude-sonnet" },
  ]);
  const list = host.dialog();
  assert.equal(list?.kind, "select");
  assert.equal(
    list.props.title,
    "Tools for anthropic/claude-sonnet (provider default)",
  );
});

test("the names-only warning keeps OpenCode's reason", async () => {
  const host = await start(
    client({
      async list() {
        return { error: { data: { message: "Model not found: gpt-9" } } };
      },
    }),
    { config: { model: "openai/gpt-9" } },
  );
  await host.run();
  assert.match(host.toasts[0]?.message ?? "", /Model not found: gpt-9/);
});

test("a failure working out the model is reported rather than called no model", async () => {
  const sdk = client();
  sdk.config.providers = async () => {
    throw new Error("server unavailable");
  };
  const host = await start(sdk);
  await host.run();
  assert.equal(host.dialog()?.kind, "select");
  assert.match(
    host.toasts[0]?.message ?? "",
    /Could not work out the current model \(server unavailable\)/,
  );
});

test("connected MCP servers get a note that their tools aren't listed", async () => {
  const host = await start(client(), {
    config: { model: "openai/gpt-5" },
    mcp: [
      { name: "github", status: "connected" },
      { name: "broken", status: "failed" },
    ],
  });
  await host.run();
  assert.equal(host.dialog()?.kind, "select");
  assert.deepEqual(
    host.toasts.map((toast) => [toast.variant, toast.message]),
    [
      [
        "info",
        "Tools from MCP servers (github) aren't listed, because OpenCode only adds them when it runs a prompt.",
      ],
    ],
  );
});

test("navigating to another session while a tool is open doesn't reopen the list", async () => {
  const host = await start(client(), { config: { model: "openai/gpt-5" } });
  await host.run();
  const list = host.dialog();
  assert.equal(list?.kind, "select");
  list.props.onSelect?.(list.props.options[0]);
  await host.settle();
  host.route.name = "session";
  host.route.params = { sessionID: "ses_2" };
  await host.escape();
  assert.equal(host.dialog(), undefined);
});

test("reloading the project closes an open browser", async () => {
  const host = await start(client(), { config: { model: "openai/gpt-5" } });
  await host.run();
  assert.equal(host.dialog()?.kind, "select");
  host.emit("server.instance.disposed", {
    properties: { directory: "/other" },
  });
  assert.equal(host.dialog()?.kind, "select");
  host.emit("server.instance.disposed", {
    properties: { directory: "/project" },
  });
  assert.equal(host.dialog(), undefined);
});
