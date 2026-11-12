// Resolves the core package to its TypeScript source, so `npm test` runs the
// host packages against the workspace's core without a build. The published
// core package resolves to its built dist/ only.
import { registerHooks } from "node:module";

const source = new URL("../packages/core/src/index.ts", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === "@lunchbox-labs/tool-inspector-core"
      ? { url: source, shortCircuit: true }
      : nextResolve(specifier, context);
  },
});
