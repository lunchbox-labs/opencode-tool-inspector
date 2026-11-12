import type { TuiPluginModule } from "@opencode-ai/plugin/tui";
import { createToolInspectorTui } from "@lunchbox-labs/tool-inspector-core";
import { opencodeHost } from "./host.ts";

const plugin = createToolInspectorTui(opencodeHost) satisfies TuiPluginModule;

export default plugin;
