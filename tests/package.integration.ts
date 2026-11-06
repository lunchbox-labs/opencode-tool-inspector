import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);
const npm = process.env.npm_execpath;
assert.ok(npm !== undefined, "Run package tests through npm");
const { devDependencies } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as { devDependencies: Record<string, string> };

test(
  "packed plugin installs independently and exposes only a loadable TUI entry with declarations",
  { timeout: 180_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "tool-inspector-package-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const packed = await execute(
      process.execPath,
      [npm, "pack", "--ignore-scripts", "--json", "--pack-destination", root],
      { cwd: resolve("."), timeout: 60_000, signal: t.signal },
    );
    const [{ filename, files }] = JSON.parse(packed.stdout) as {
      filename: string;
      files: { path: string }[];
    }[];
    const paths = files.map((file) => file.path);
    for (const path of [
      "dist/tui.js",
      "dist/tui.d.ts",
      "README.md",
      "LICENSE",
      "package.json",
    ]) {
      assert.ok(paths.includes(path), `Missing ${path}`);
    }
    for (const path of paths) {
      assert.ok(
        path.startsWith("dist/") ||
          ["README.md", "LICENSE", "package.json"].includes(path),
        `Unexpected packed file: ${path}`,
      );
    }
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
        `@types/node@${devDependencies["@types/node"]}`,
      ],
      { timeout: 120_000, signal: t.signal },
    );
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
    await writeFile(
      join(root, "consumer.mts"),
      `import type { TuiPluginModule } from '@opencode-ai/plugin/tui';
import tui from '@lunchbox-labs/opencode-tool-inspector/tui';
const module: TuiPluginModule = tui;
console.log(module.id);
`,
    );
    await execute(
      process.execPath,
      [
        resolve("node_modules/typescript/bin/tsc"),
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
    const manifest = JSON.parse(
      await readFile(
        join(
          root,
          "node_modules/@lunchbox-labs/opencode-tool-inspector/package.json",
        ),
        "utf8",
      ),
    ) as Record<string, Record<string, string> | undefined>;
    assert.deepEqual(manifest.dependencies ?? {}, {});
    assert.equal(Object.hasOwn(manifest.engines ?? {}, "opencode"), false);
    assert.equal(manifest.engines?.node, ">=22.18.0");
  },
);
