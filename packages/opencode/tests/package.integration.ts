import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const npm = process.env.npm_execpath ?? "";
assert.ok(npm !== "", "Run package tests through npm");
const workspace = fileURLToPath(new URL("../../..", import.meta.url));
const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const tsc = join(workspace, "node_modules/typescript/bin/tsc");
const { devDependencies, name } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as { devDependencies: Record<string, string>; name: string };
// The packed install has no lockfile, so it takes the locked @types/node
// version rather than the root manifest's range.
const nodeTypes = (
  JSON.parse(
    await readFile(
      new URL("../../../package-lock.json", import.meta.url),
      "utf8",
    ),
  ) as { packages: Record<string, { version: string }> }
).packages["node_modules/@types/node"].version;
const core = JSON.parse(
  await readFile(new URL("../../core/package.json", import.meta.url), "utf8"),
) as { name: string };
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "peerDependenciesMeta",
  "optionalDependencies",
  "bundleDependencies",
  "bundledDependencies",
];

/** The packages a built file imports, statically or dynamically. */
function importedPackages(code: string): string[] {
  const specifiers = [
    ...code.matchAll(/\bfrom\s*"([^"]+)"/g),
    ...code.matchAll(/\bimport\s*\(\s*"([^"]+)"\s*\)/g),
    ...code.matchAll(/^\s*import\s*"([^"]+)"/gm),
  ].map((match) => match[1]);
  return [...new Set(specifiers)].filter(
    (specifier) => !specifier.startsWith("."),
  );
}

test(
  "packed plugin installs on its own with core bundled in and exposes only a loadable TUI entry with declarations",
  { timeout: 180_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "tool-inspector-package-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    // The consumer is outside the workspace, so nothing resolves through its links.
    const outside = relative(workspace, root);
    assert.ok(outside.startsWith("..") || isAbsolute(outside), root);
    const packed = await execute(
      process.execPath,
      [npm, "pack", "--ignore-scripts", "--json", "--pack-destination", root],
      { cwd: packageDirectory, timeout: 60_000, signal: t.signal },
    );
    const [{ filename, files }] = JSON.parse(packed.stdout) as {
      filename: string;
      files: { path: string }[];
    }[];
    // One bundled file per export, with no shared chunks or source maps.
    assert.deepEqual(files.map((file) => file.path).sort(), [
      "LICENSE",
      "README.md",
      "dist/tui.d.ts",
      "dist/tui.js",
      "package.json",
    ]);
    await execute(
      process.execPath,
      [
        npm,
        "install",
        "--prefix",
        root,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        join(root, filename),
        `@opencode-ai/plugin@${devDependencies["@opencode-ai/plugin"]}`,
        `@types/node@${nodeTypes}`,
      ],
      { timeout: 120_000, signal: t.signal },
    );
    const installed = join(root, "node_modules", name);
    const manifest = JSON.parse(
      await readFile(join(installed, "package.json"), "utf8"),
    ) as Record<string, Record<string, string> | undefined>;
    for (const field of dependencyFields) {
      assert.equal(
        Object.hasOwn(manifest[field] ?? {}, core.name),
        false,
        `${field} names ${core.name}`,
      );
    }
    // OpenCode supplies OpenTUI and the plugin types, so the package installs nothing else.
    assert.equal(manifest.dependencies, undefined);
    assert.equal(manifest.peerDependencies, undefined);
    assert.equal(Object.hasOwn(manifest.engines ?? {}, "opencode"), false);
    assert.equal(manifest.engines?.node, ">=22.18.0");
    await assert.rejects(access(join(root, "node_modules", core.name)), {
      code: "ENOENT",
    });
    // Core is inlined and every other import stays external: OpenTUI, which OpenCode maps
    // to its own copy, and in the declarations OpenCode's plugin types.
    const code = await readFile(join(installed, "dist/tui.js"), "utf8");
    const declarations = await readFile(
      join(installed, "dist/tui.d.ts"),
      "utf8",
    );
    for (const text of [code, declarations]) {
      assert.equal(text.includes(core.name), false);
      assert.equal(text.includes("node_modules"), false);
    }
    assert.deepEqual(importedPackages(code), ["@opentui/core"]);
    assert.deepEqual(importedPackages(declarations), [
      "@opencode-ai/plugin/tui",
    ]);
    // OpenCode resolves a package's server entry from ./server or its root export, so a
    // TUI-only package must export neither.
    await writeFile(
      join(root, "consumer.mjs"),
      `import assert from 'node:assert/strict';
import tui from '@lunchbox-labs/opencode-tool-inspector/tui';
assert.equal(tui.id, 'tool-inspector');
assert.equal(typeof tui.tui, 'function');
assert.equal(Object.hasOwn(tui, 'server'), false);
const commands = [];
await tui.tui({
  keymap: { registerLayer(layer) { commands.push(...(layer.commands ?? [])); return () => {}; } },
  event: { on() { return () => {}; } },
  lifecycle: { signal: new AbortController().signal, onDispose() { return () => {}; } },
}, undefined, {});
assert.deepEqual(commands.map((command) => command.slashName), ['tools']);
for (const specifier of ['@lunchbox-labs/opencode-tool-inspector', '@lunchbox-labs/opencode-tool-inspector/server']) {
  await assert.rejects(import(specifier), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }, specifier);
}
`,
    );
    await execute(process.execPath, [join(root, "consumer.mjs")], {
      cwd: root,
      timeout: 60_000,
      signal: t.signal,
    });
    // The export keeps the type it had before the workspace: exactly { id, tui }.
    await writeFile(
      join(root, "consumer.mts"),
      `import type { TuiPlugin, TuiPluginModule } from '@opencode-ai/plugin/tui';
import tui from '@lunchbox-labs/opencode-tool-inspector/tui';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const exact: Equal<typeof tui, { id: string; tui: TuiPlugin }> = true;
const module: TuiPluginModule = tui;
console.log(module.id, exact);
`,
    );
    await execute(
      process.execPath,
      [
        tsc,
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--module",
        "NodeNext",
        "--target",
        "ES2023",
        join(root, "consumer.mts"),
      ],
      { cwd: root, timeout: 60_000, signal: t.signal },
    );
  },
);
