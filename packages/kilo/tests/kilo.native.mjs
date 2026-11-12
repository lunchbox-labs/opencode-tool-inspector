import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const support = JSON.parse(
  await readFile(new URL("./kilo.json", import.meta.url), "utf8"),
);
const windows = process.platform === "win32";
assert.ok(
  windows || process.platform === "linux",
  "Native TUI checks run on Linux or Windows.",
);
assert.equal(process.arch, "x64", "Native test installation requires x64.");
// Linux runs Kilo under util-linux script; Windows under a ConPTY from node-pty.
assert.ok(
  windows || spawnSync("script", ["--version"]).status === 0,
  "Install util-linux for a native pseudoterminal.",
);
const ptyVersion = "1.1.0";
const packageDirectory = fileURLToPath(new URL("../", import.meta.url));
const coreDirectory = fileURLToPath(new URL("../../core/", import.meta.url));
const cli = windows
  ? "@kilocode/cli-windows-x64-baseline"
  : "@kilocode/cli-linux-x64-baseline";
const root = await mkdtemp(join(tmpdir(), "kilo-tool-inspector-"));
const config = join(root, "config", "kilo");
const project = join(root, "project");
const runtime = join(root, "runtime");
const npm = process.env.npm_execpath;
assert.ok(npm, "Run this check through npm.");
const env = {
  PATH: process.env.PATH,
  HOME: root,
  TMPDIR: join(root, "tmp"),
  XDG_CONFIG_HOME: join(root, "config"),
  XDG_DATA_HOME: join(root, "data"),
  XDG_STATE_HOME: join(root, "state"),
  XDG_CACHE_HOME: join(root, "cache"),
  KILO_TEST_HOME: root,
  KILO_DB: join(root, "kilo.sqlite"),
  KILO_DISABLE_AUTOUPDATE: "true",
  KILO_NO_DAEMON: "1",
  KILO_TELEMETRY_LEVEL: "off",
  KILO_DISABLE_MODELS_FETCH: "true",
  KILO_DISABLE_PROJECT_CONFIG: "true",
  KILO_DISABLE_DEFAULT_PLUGINS: "true",
  KILO_DISABLE_EXTERNAL_SKILLS: "true",
  KILO_DISABLE_CLAUDE_CODE: "true",
  KILO_EXPERIMENTAL_DISABLE_FILEWATCHER: "true",
  TERM: "xterm-256color",
  COLORTERM: "truecolor",
  LANG: "C.UTF-8",
  KILO_INSPECTOR_MARKER: join(root, "result.json"),
};
if (windows) {
  Object.assign(env, {
    USERPROFILE: root,
    APPDATA: join(root, "appdata", "roaming"),
    LOCALAPPDATA: join(root, "appdata", "local"),
    TEMP: env.TMPDIR,
    TMP: env.TMPDIR,
  });
}
for (const name of [
  // Windows processes need these to start.
  "SystemRoot",
  "SystemDrive",
  "windir",
  "ComSpec",
  "PATHEXT",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "npm_config_cafile",
]) {
  if (process.env[name]) {
    env[name] = process.env[name];
  }
}
const run = (command, args, cwd = packageDirectory) => {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 180_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return result.stdout;
};
/** Kilo under util-linux script, sized as the TUI expects. */
function scriptTerminal(binary) {
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const script = spawn(
    "script",
    [
      "-q",
      "-c",
      `stty cols 120 rows 50; ${quote(binary)} --print-logs`,
      "/dev/null",
    ],
    { cwd: project, env, detached: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const exited = () => script.exitCode !== null || script.signalCode !== null;
  return {
    exited,
    onOutput(listener) {
      for (const output of [script.stdout, script.stderr]) {
        output.on("data", (chunk) => listener(chunk.toString()));
      }
    },
    async stop() {
      for (const signal of ["SIGTERM", "SIGKILL"]) {
        if (exited()) {
          return;
        }
        process.kill(-script.pid, signal);
        await Promise.race([once(script, "exit"), delay(2000)]);
      }
    },
  };
}

/** Kilo in a Windows ConPTY, from a node-pty installed beside the CLI. */
async function conpty(binary, cache) {
  run(process.execPath, [
    npm,
    "install",
    "--prefix",
    runtime,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--cache",
    cache,
    `node-pty@${ptyVersion}`,
  ]);
  const pty = createRequire(join(runtime, "package.json"))("node-pty");
  const terminal = pty.spawn(binary, ["--print-logs"], {
    name: "xterm-256color",
    cols: 120,
    rows: 50,
    cwd: project,
    env,
  });
  let done = false;
  const closed = new Promise((resolve) =>
    terminal.onExit(() => {
      done = true;
      resolve();
    }),
  );
  return {
    exited: () => done,
    onOutput(listener) {
      terminal.onData(listener);
    },
    async stop() {
      if (done) {
        return;
      }
      // node-pty's kill ends every process on the console and closes the
      // terminal, which otherwise keeps this process running. It lists the
      // console's processes first, so it runs while Kilo is still there;
      // taskkill then ends anything of Kilo's left outside the console.
      terminal.kill();
      await Promise.race([closed, delay(5000)]);
      spawnSync("taskkill", ["/PID", String(terminal.pid), "/T", "/F"], {
        timeout: 5000,
      });
    },
  };
}

let child;
let logs = "";
try {
  for (const directory of [
    config,
    project,
    runtime,
    env.TMPDIR,
    ...(windows ? [env.APPDATA, env.LOCALAPPDATA] : []),
  ]) {
    await mkdir(directory, { recursive: true });
  }
  const cache = process.env.npm_config_cache ?? join(root, "npm-cache");
  // KILO_TEST_VERSION is floor (the default), latest-compatible or an exact version.
  const wanted = process.env.KILO_TEST_VERSION ?? "floor";
  const version =
    wanted === "floor"
      ? support.floor
      : wanted === "latest-compatible"
        ? [
            JSON.parse(
              run(process.execPath, [
                npm,
                "view",
                `${cli}@${support.range}`,
                "version",
                "--json",
                "--cache",
                cache,
              ]),
            ),
          ]
            .flat()
            .at(-1)
        : wanted;
  assert.match(version, /^\d+\.\d+\.\d+$/, `Unknown Kilo version ${wanted}`);
  let binary = process.env.KILO_BIN;
  if (!binary) {
    run(process.execPath, [
      npm,
      "install",
      "--prefix",
      runtime,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      cache,
      `${cli}@${version}`,
    ]);
    binary = join(
      runtime,
      "node_modules",
      cli,
      "bin",
      windows ? "kilo.exe" : "kilo",
    );
  }
  assert.equal(run(binary, ["--version"]).trim(), version);
  // Kilo installs the plugin with its exact core dependency, which isn't on npm before a release.
  const pack = (directory) =>
    join(
      root,
      JSON.parse(
        run(
          process.execPath,
          [
            npm,
            "pack",
            "--ignore-scripts",
            "--json",
            "--pack-destination",
            root,
            "--cache",
            cache,
          ],
          directory,
        ),
      )[0].filename,
    );
  const tarballs = [pack(coreDirectory), pack(packageDirectory)];
  run(process.execPath, [
    npm,
    "install",
    "--prefix",
    runtime,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--cache",
    cache,
    ...tarballs,
  ]);
  const plugin = join(
    runtime,
    "node_modules/@lunchbox-labs/kilo-tool-inspector",
  );
  await cp(
    join(packageDirectory, "tests/kilo-tui.fixture.ts"),
    join(config, "audit.ts"),
  );
  await writeFile(
    join(config, "tui.json"),
    JSON.stringify({ plugin: [plugin, "./audit.ts"] }),
  );
  await writeFile(
    join(config, "kilo.json"),
    JSON.stringify({
      plugin: [],
      model: "openai/native-fixture",
      enabled_providers: ["openai"],
      provider: {
        openai: {
          options: {
            apiKey: "synthetic-test-key",
            baseURL: "http://127.0.0.1:1/v1",
          },
          models: {
            "native-fixture": {
              name: "Native fixture",
              limit: { context: 4096, output: 1024 },
            },
          },
        },
      },
    }),
  );
  child = windows ? await conpty(binary, cache) : scriptTerminal(binary);
  child.onOutput((chunk) => {
    logs = (logs + chunk).slice(-64 * 1024);
  });
  let result;
  for (let attempt = 0; attempt < 1200; attempt++) {
    try {
      result = JSON.parse(await readFile(env.KILO_INSPECTOR_MARKER, "utf8"));
      break;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    if (child.exited()) {
      break;
    }
    await delay(100);
  }
  assert.ok(result, `Native audit did not finish:\n${logs}`);
  assert.equal(result.error, undefined, JSON.stringify(result) + "\n" + logs);
  assert.equal(result.stages.length, 5);
  console.log(`PASS Kilo CLI ${version}: ${result.stages.join("; ")}.`);
  console.log(
    "No prompts or tool calls were sent to a model. Native smoke does not prove final call-time permission decisions.",
  );
} finally {
  await child?.stop();
  // Windows can hold an exited process's files for a moment.
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 500,
  });
}
// node-pty keeps handles open on Windows after its terminal has exited, so
// the check would never end. This is reached only once every assertion and
// the cleanup passed; a failure above ends the process with an error instead.
process.exit(0);
