import type { TuiPluginModule } from "@opencode-ai/plugin/tui";
import { createToolInspectorTui } from "@lunchbox-labs/tool-inspector-core";
import { opencodeHost } from "./host.ts";

const plugin: TuiPluginModule = createToolInspectorTui(opencodeHost);

export default plugin;
