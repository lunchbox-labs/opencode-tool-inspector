import type { TuiPluginModule } from "@kilocode/plugin/tui";
import { createToolInspectorTui } from "@lunchbox-labs/tool-inspector-core";
import { kiloHost } from "./host.ts";

const core = createToolInspectorTui(kiloHost);
type CoreApi = Parameters<typeof core.tui>[0];

const plugin: TuiPluginModule = {
  id: core.id,
  tui: (api, options, meta) =>
    core.tui(
      // Core is typed against OpenCode's API. Kilo's has the same shape where core reads it and
      // differs elsewhere, such as an optional `template` on configured commands.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the shapes core reads match.
      api as unknown as CoreApi,
      options,
      meta,
    ),
};

export default plugin;
