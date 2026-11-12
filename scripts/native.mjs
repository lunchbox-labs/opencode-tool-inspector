// Runs the native TUI check for one host, named by NATIVE_HOST. Only Kilo has one.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const checks = { kilo: "../packages/kilo/tests/kilo.native.mjs" };
const host = process.env.NATIVE_HOST ?? "kilo";
if (!Object.hasOwn(checks, host)) {
  console.error(
    `No native check for ${host}. Set NATIVE_HOST to one of: ${Object.keys(checks).join(", ")}.`,
  );
  process.exit(1);
}
const { status, error } = spawnSync(
  process.execPath,
  [fileURLToPath(new URL(checks[host], import.meta.url))],
  { stdio: "inherit" },
);
if (error) {
  throw error;
}
console.error(`The ${host} native check exited with status ${status}.`);
process.exit(status ?? 1);
