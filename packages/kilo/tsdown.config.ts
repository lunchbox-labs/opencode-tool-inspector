import { defineConfig } from "tsdown";

// Bundles the workspace's private core into this package and keeps every other import external:
// Kilo maps a plugin's OpenTUI imports to its own copies, and the types refer to Kilo's.
export default defineConfig({
  entry: { tui: "src/tui.ts" },
  tsconfig: "tsconfig.json",
  format: "esm",
  platform: "node",
  target: "node22.18",
  dts: true,
  minify: false,
  fixedExtension: false,
  deps: {
    neverBundle: true,
    alwaysBundle: ["@lunchbox-labs/tool-inspector-core"],
    // Fails the build if any package from node_modules is inlined.
    onlyBundle: [],
    onlyImport: ["@kilocode/plugin", "@opentui/core"],
  },
});
