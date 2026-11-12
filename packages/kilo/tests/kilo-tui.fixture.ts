import assert from "node:assert/strict";
import { renameSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import type { TuiPluginModule } from "@kilocode/plugin/tui";
import {
  type Renderable,
  ScrollBoxRenderable,
  TextRenderable,
  parseKeypress,
} from "@opentui/core";

export default {
  id: "tool-inspector-native-audit",
  tui: async (api) => {
    const marker = process.env.KILO_INSPECTOR_MARKER;
    assert.ok(marker !== undefined);
    const stages: string[] = [];
    const waitFor = async (ready: () => boolean, message: string) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (ready()) {
          return;
        }
        await delay(50);
      }
      throw new Error(message);
    };
    const text = () => {
      const lines: string[] = [];
      const visit = (node: Renderable) => {
        if (node instanceof TextRenderable) {
          lines.push(node.plainText);
        }
        node.getChildren().forEach(visit);
      };
      visit(api.renderer.root);
      return lines.join("\n");
    };
    const key = async (sequence: string) => {
      const parsed = parseKeypress(sequence);
      assert.ok(parsed !== null);
      api.renderer.keyInput.processParsedKey(parsed);
      await delay(100);
    };
    try {
      await waitFor(() => api.state.ready, "Kilo state did not become ready");
      await waitFor(
        () =>
          api.plugins
            .list()
            .some((plugin) => plugin.id === "tool-inspector" && plugin.active),
        "Packed Tool Inspector did not activate",
      );
      stages.push("packed TUI plugin loaded");
      const agents = await api.client.app.agents({
        directory: api.state.path.directory,
      });
      assert.equal(agents.error, undefined);
      assert.ok(agents.data.length > 0, "Kilo returned no agents");
      const tools = await api.client.tool.list({
        directory: api.state.path.directory,
        provider: "openai",
        model: "native-fixture",
      });
      assert.equal(tools.error, undefined);
      assert.ok(
        tools.data.some(
          (tool) => tool.id === "read" && tool.parameters !== undefined,
        ),
      );
      stages.push("live agent and tool APIs");
      api.keymap.dispatchCommand("tool-inspector.browse");
      await waitFor(
        () => text().includes("Tools for openai/native-fixture"),
        "Tool list did not render",
      );
      for (const character of "read") {
        await key(character);
      }
      await key("\r");
      await waitFor(
        () => text().includes("Configured rules only."),
        "Tool details did not render",
      );
      assert.match(text(), /filePath/);
      assert.match(text(), /\.env/);
      assert.match(text(), /Description/);
      stages.push("filter and read detail rendered");
      const scrollBoxes: ScrollBoxRenderable[] = [];
      const collectScroll = (node: Renderable) => {
        if (node instanceof ScrollBoxRenderable) {
          scrollBoxes.push(node);
        }
        node.getChildren().forEach(collectScroll);
      };
      collectScroll(api.renderer.root);
      assert.equal(scrollBoxes.length, 1);
      const scroll = scrollBoxes[0];
      await key("\u001b[F");
      assert.ok(scroll.scrollTop > 0, "End did not scroll long tool details");
      await key("\u001b[H");
      assert.equal(scroll.scrollTop, 0, "Home did not return to the start");
      for (const sequence of [
        "\u001b[F",
        "\u001b[5~",
        "\u001b[H",
        "\u001b[6~",
      ]) {
        await key(sequence);
        assert.ok(api.ui.dialog.open, "Scrolling closed the detail dialog");
      }
      stages.push("native paging keys preserve detail");
      await key("\u001b");
      await waitFor(
        () => text().includes("Tools for openai/native-fixture"),
        "Escape did not restore the tool list",
      );
      await key("\u001b");
      await waitFor(() => !api.ui.dialog.open, "Escape did not close the list");
      api.keymap.dispatchCommand("tool-inspector.browse");
      api.keymap.dispatchCommand("tool-inspector.browse");
      await waitFor(
        () => text().includes("Tools for openai/native-fixture"),
        "Repeated open did not settle on a list",
      );
      await key("\u001b");
      await waitFor(() => !api.ui.dialog.open, "Reopened list did not close");
      await delay(150);
      assert.equal(api.ui.dialog.open, false);
      stages.push("escape, repeated open and final close");
      writeFileSync(`${marker}.tmp`, JSON.stringify({ stages }));
    } catch (error) {
      writeFileSync(
        `${marker}.tmp`,
        JSON.stringify({ stages, error: String(error), text: text() }),
      );
    }
    renameSync(`${marker}.tmp`, marker);
  },
} satisfies TuiPluginModule;
