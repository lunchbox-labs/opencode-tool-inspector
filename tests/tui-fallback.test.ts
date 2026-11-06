import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { fakeHost } from "./tui-harness.ts";
import plugin from "../src/tui.ts";

// Registered after the harness, so this redirect runs first and the viewer can't load.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === "@opentui/core" &&
      /\/detail-viewer\.(?:ts|js)$/.test(context.parentURL ?? "")
    ) {
      return {
        url: new URL("./opentui-unavailable.ts", import.meta.url).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const longDescription = Array.from(
  { length: 25 },
  (_, index) => `Line ${index + 1}`,
).join("\n");

test("without OpenTUI a tool's details show as plain text, input first and cut short", async () => {
  const host = fakeHost(
    {
      tool: {
        async list() {
          return {
            data: [
              {
                id: "read",
                description: longDescription,
                parameters: {
                  type: "object",
                  properties: { filePath: { type: "string" } },
                  required: ["filePath"],
                },
              },
            ],
          };
        },
      },
    },
    { config: { model: "openai/gpt-5" } },
  );
  await plugin.tui(host.api, undefined, {} as never);
  await host.run();
  const list = host.dialog();
  assert.equal(list?.kind, "select");
  list.props.onSelect?.(list.props.options[0]);
  await host.settle();
  const detail = host.dialog();
  assert.equal(detail?.kind, "alert");
  assert.equal(detail.title, "read");
  assert.equal(
    detail.message,
    [
      "Input",
      "filePath  string, required",
      "",
      "Description",
      ...Array.from({ length: 20 }, (_, index) => `Line ${index + 1}`),
      "…",
    ].join("\n"),
  );
  assert.match(
    host.toasts.map((toast) => toast.message).join("\n"),
    /Showing tool details as plain text: OpenTUI is not available/,
  );
  await host.escape();
  assert.equal(host.dialog()?.kind, "select");
});
