import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";

const ToolInspectorTui: TuiPlugin = () => Promise.resolve();

export default {
  id: "tool-inspector",
  tui: ToolInspectorTui,
} satisfies TuiPluginModule;
