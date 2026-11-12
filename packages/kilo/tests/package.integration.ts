import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const npm = process.env.npm_execpath ?? "";
assert.ok(npm !== "", "Run package tests through npm");
const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const coreDirectory = fileURLToPath(new URL("../../core", import.meta.url));
const tsc = fileURLToPath(
  new URL("../../../node_modules/typescript/bin/tsc", import.meta.url),
);
const { devDependencies, dependencies, version } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as {
  devDependencies: Record<string, string>;
  dependencies: Record<string, string>;
  version: string;
};
const rootManifest = JSON.parse(
  await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
) as { devDependencies: Record<string, string> };
const core = JSON.parse(
  await readFile(new URL("../../core/package.json", import.meta.url), "utf8"),
) as { name: string; version: string };

interface Packed {
  filename: string;
  files: { path: string }[];
}

async function pack(
  directory: string,
  destination: string,
  signal: AbortSignal,
): Promise<Packed> {
  const packed = await execute(
    process.execPath,
    [
      npm,
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      destination,
    ],
    { cwd: directory, timeout: 60_000, signal },
  );
  const [result] = JSON.parse(packed.stdout) as Packed[];
  return result;
}

function assertPackedFiles(packed: Packed, required: readonly string[]) {
  const paths = packed.files.map((file) => file.path);
  for (const path of [...required, "README.md", "LICENSE", "package.json"]) {
    assert.ok(paths.includes(path), `Missing ${path} in ${packed.filename}`);
  }
  for (const path of paths) {
    assert.ok(
      path.startsWith("dist/") ||
        ["README.md", "LICENSE", "package.json"].includes(path),
      `Unexpected packed file: ${path} in ${packed.filename}`,
    );
  }
}

test(
  "packed plugin installs with packed core and exposes only a loadable TUI entry with declarations",
  { timeout: 180_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "tool-inspector-package-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    // The adapter depends on core at its exact version, which npm takes from core's tarball.
    assert.deepEqual(dependencies, { [core.name]: version });
    assert.equal(core.version, version);
    const corePacked = await pack(coreDirectory, root, t.signal);
    assertPackedFiles(corePacked, ["dist/index.js", "dist/index.d.ts"]);
    const packed = await pack(packageDirectory, root, t.signal);
    assertPackedFiles(packed, ["dist/tui.js", "dist/tui.d.ts"]);
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
        join(root, corePacked.filename),
        join(root, packed.filename),
        `@kilocode/plugin@${devDependencies["@kilocode/plugin"]}`,
        `@types/node@${rootManifest.devDependencies["@types/node"]}`,
      ],
      { timeout: 120_000, signal: t.signal },
    );
    // Kilo resolves a package's server entry from ./server or its root export, so a
    // TUI-only package must export neither.
    await writeFile(
      join(root, "consumer.mjs"),
      `import assert from 'node:assert/strict';
import tui from '@lunchbox-labs/kilo-tool-inspector/tui';
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
for (const specifier of ['@lunchbox-labs/kilo-tool-inspector', '@lunchbox-labs/kilo-tool-inspector/server']) {
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
      `import type { TuiPluginModule } from '@kilocode/plugin/tui';
import tui from '@lunchbox-labs/kilo-tool-inspector/tui';
const module: TuiPluginModule = tui;
console.log(module.id);
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
    const manifest = JSON.parse(
      await readFile(
        join(
          root,
          "node_modules/@lunchbox-labs/kilo-tool-inspector/package.json",
        ),
        "utf8",
      ),
    ) as Record<string, Record<string, string> | undefined>;
    assert.deepEqual(manifest.dependencies, { [core.name]: version });
    assert.equal(Object.hasOwn(manifest.engines ?? {}, "opencode"), false);
    assert.equal(Object.hasOwn(manifest.engines ?? {}, "kilo"), false);
    assert.equal(manifest.engines?.node, ">=22.18.0");
    const installedCore = JSON.parse(
      await readFile(
        join(
          root,
          "node_modules/@lunchbox-labs/tool-inspector-core/package.json",
        ),
        "utf8",
      ),
    ) as Record<string, Record<string, string> | string | undefined>;
    assert.equal(installedCore.version, version);
    // Every export target is a file in the package.
    assert.deepEqual(installedCore.exports, {
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
    });
    // Core has no runtime dependency on either host's packages, and its peer on
    // OpenCode's plugin, for its declarations' types, is optional and not installed.
    assert.deepEqual(installedCore.dependencies ?? {}, {});
    assert.deepEqual(installedCore.peerDependenciesMeta, {
      "@opencode-ai/plugin": { optional: true },
    });
    await assert.rejects(
      readFile(join(root, "node_modules/@opencode-ai/plugin/package.json")),
      { code: "ENOENT" },
    );
    assert.equal(
      (installedCore.engines as Record<string, string> | undefined)?.node,
      ">=22.18.0",
    );
  },
);
