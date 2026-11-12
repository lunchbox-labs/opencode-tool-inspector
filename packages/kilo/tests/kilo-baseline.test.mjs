import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const lock = JSON.parse(
  await readFile(
    new URL("../../../package-lock.json", import.meta.url),
    "utf8",
  ),
);
const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

/** The lockfile entry this package resolves for a dependency: its own copy, else the hoisted one. */
function resolved(name) {
  return (
    lock.packages[`packages/kilo/node_modules/${name}`] ??
    lock.packages[`node_modules/${name}`]
  );
}

test("published package has no Kilo engine gate and retains the Node requirement", () => {
  assert.equal(Object.hasOwn(manifest.engines, "opencode"), false);
  assert.equal(Object.hasOwn(manifest.engines, "kilo"), false);
  assert.equal(manifest.engines.node, ">=22.18.0");
  const entry = lock.packages["packages/kilo"];
  assert.equal(Object.hasOwn(entry.engines, "opencode"), false);
  assert.equal(Object.hasOwn(entry.engines, "kilo"), false);
  assert.equal(entry.engines.node, manifest.engines.node);
});

test("SDK and plugin build dependencies share one exact version within the supported host range", async () => {
  const support = JSON.parse(
    await readFile(new URL("./kilo.json", import.meta.url), "utf8"),
  );
  const plugin = manifest.devDependencies["@kilocode/plugin"];
  assert.equal(manifest.devDependencies["@kilocode/sdk"], plugin);
  assert.match(plugin, /^\d+\.\d+\.\d+$/);
  const [major, minor, patch] = plugin.split(".").map(Number);
  const [floorMajor, floorMinor, floorPatch] = support.floor
    .split(".")
    .map(Number);
  assert.equal(support.range, `>=${support.floor} <${major}.${minor + 1}.0`);
  assert.ok(
    major === floorMajor && minor === floorMinor && patch >= floorPatch,
    `${plugin} is below the supported floor ${support.floor}`,
  );
  for (const name of ["@kilocode/plugin", "@kilocode/sdk"]) {
    assert.equal(resolved(name).version, plugin, name);
  }
});

test("TUI dev dependencies match the copies every supported Kilo host loads", () => {
  // Kilo 7.8 maps a plugin's @opentui/* and solid-js imports to its own
  // bundled copies (@opentui 0.5.11 and solid-js 1.9.12). Building
  // against newer releases would let code use APIs no supported host provides.
  // solid-js stays at 1.9.12, the exact peer of @opentui 0.5.11.
  for (const name of ["@opentui/core", "@opentui/keymap", "@opentui/solid"]) {
    assert.equal(manifest.devDependencies[name], "0.5.11", name);
    assert.equal(resolved(name).version, "0.5.11", name);
  }
  assert.equal(manifest.devDependencies["solid-js"], "1.9.12");
  assert.equal(resolved("solid-js").version, "1.9.12");
});
