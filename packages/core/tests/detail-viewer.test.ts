import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { detailText } from "./tui-harness.ts";
import { BoxRenderable, ScrollBoxRenderable } from "./opentui-double.ts";
import { createDetailViewer } from "../src/detail-viewer.ts";

function viewerApi(signal = new AbortController().signal) {
  const renderer = Object.assign(new EventEmitter(), { height: 40 });
  const layers = new Set<{ target?: unknown }>();
  const api = {
    renderer,
    theme: { current: {} },
    lifecycle: { signal },
    keymap: {
      registerLayer(layer: { target?: unknown }) {
        layers.add(layer);
        return () => layers.delete(layer);
      },
    },
  } as unknown as TuiPluginApi;
  return { api, renderer, layers };
}

const detail = {
  title: "read",
  subtitle: undefined,
  sections: [
    {
      heading: "Description",
      lines: [[{ text: "Reads a file.", tone: "plain" as const }]],
    },
  ],
};

function scrollOf(element: unknown) {
  assert.ok(element instanceof BoxRenderable);
  const scroll = element
    .getChildren()
    .find((child) => child instanceof ScrollBoxRenderable);
  const body = scroll?.getChildren()[0];
  assert.ok(scroll !== undefined && body !== undefined);
  return { scroll, body };
}

test("the viewer fits short details and keeps long ones within the terminal", async () => {
  const { api, renderer, layers } = viewerApi();
  const element = (await createDetailViewer(api))(detail);
  assert.ok(element instanceof BoxRenderable);
  assert.deepEqual(detailText(element), {
    title: "read",
    text: "Description\nReads a file.\n↑/↓ scroll · pgup/pgdn page · home/end · esc back",
  });
  const { scroll, body } = scrollOf(element);
  assert.deepEqual(
    [...layers].map((layer) => layer.target),
    [scroll],
  );
  const layout = (rows: number) => {
    body.height = rows;
    body.onSizeChange?.();
    return scroll.height;
  };
  assert.equal(layout(3), 3);
  const tall = layout(500);
  assert.ok(tall > 3 && tall < 30);
  renderer.height = 20;
  renderer.emit("resize", 120, 20);
  assert.ok(scroll.height >= 1 && scroll.height < tall);
  element.destroyRecursively();
  assert.equal(renderer.listenerCount("resize"), 0);
  assert.equal(layers.size, 0);
});

test("closing OpenCode tears down an open viewer", async () => {
  const controller = new AbortController();
  const { api, renderer, layers } = viewerApi(controller.signal);
  const element = (await createDetailViewer(api))(detail);
  controller.abort();
  assert.ok(element instanceof BoxRenderable);
  assert.equal(element.isDestroyed, true);
  assert.equal(renderer.listenerCount("resize"), 0);
  assert.equal(layers.size, 0);
});
