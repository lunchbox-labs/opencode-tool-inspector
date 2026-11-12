// Runs the native TUI check for one host, named by NATIVE_HOST. Only Kilo has one.
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const checks = { kilo: "../packages/kilo/tests/kilo.native.mjs" };
const host = process.env.NATIVE_HOST ?? "kilo";
if (!Object.hasOwn(checks, host)) {
  console.error(
    `No native check for ${host}. Set NATIVE_HOST to one of: ${Object.keys(checks).join(", ")}.`,
  );
  process.exit(1);
}
// The check works in this directory, which is removed only once the check has
// exited, since Windows keeps a running process's loaded modules from being deleted.
const root = await mkdtemp(join(tmpdir(), `${host}-tool-inspector-`));
let result;
try {
  result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL(checks[host], import.meta.url))],
    { stdio: "inherit", env: { ...process.env, NATIVE_CHECK_ROOT: root } },
  );
} finally {
  const started = Date.now();
  // Windows can hold an exited process's files for a moment.
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 500,
  });
  console.error(`Removed the check's directory in ${Date.now() - started}ms.`);
}
if (result.error) {
  throw result.error;
}
console.error(`The ${host} native check exited with status ${result.status}.`);
process.exit(result.status ?? 1);
