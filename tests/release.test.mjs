import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse as parseYaml } from "yaml";
import { validateRelease as validate } from "../scripts/validate-release.mjs";

const repository = {
  url: "git+https://github.com/lunchbox-labs/opencode-tool-inspector.git",
};
const coreName = "@lunchbox-labs/tool-inspector-core";
const packages = {
  "packages/core": { name: coreName, version: "1.2.3" },
  "packages/opencode": {
    name: "@lunchbox-labs/opencode-tool-inspector",
    version: "1.2.3",
    dependencies: { [coreName]: "1.2.3" },
  },
  "packages/kilo": {
    name: "@lunchbox-labs/kilo-tool-inspector",
    version: "1.2.3",
    dependencies: { [coreName]: "1.2.3" },
  },
};
const names = Object.values(packages).map(({ name }) => name);

/** Every package's manifest at one version, with `change` applied to the one in `directory`. */
function manifests({ version = "1.2.3", directory, change = {} } = {}) {
  return Object.fromEntries(
    Object.entries(packages).map(([path, { dependencies, ...manifest }]) => [
      path,
      {
        ...manifest,
        version,
        ...(dependencies === undefined
          ? {}
          : { dependencies: { [coreName]: version } }),
        repository: { ...repository, directory: path },
        publishConfig: { access: "public" },
        ...(path === directory ? change : {}),
      },
    ]),
  );
}

function lockFor(version = "1.2.3") {
  return {
    packages: {
      "": { name: "tool-inspector-workspace" },
      ...Object.fromEntries(
        Object.entries(packages).map(([path, { name }]) => [
          path,
          { name, version },
        ]),
      ),
    },
  };
}
const lock = lockFor();
const validateRelease = (released, tag, options) =>
  validate(released, tag, lock, options);

test("release validation rejects stale or missing lockfile versions", () => {
  for (const directory of Object.keys(packages)) {
    const stale = lockFor();
    stale.packages[directory].version = "1.2.2";
    assert.throws(
      () => validate(manifests(), "v1.2.3", stale),
      /lockfile/,
      directory,
    );
  }
  assert.throws(() => validate(manifests(), "v1.2.3", undefined), /lockfile/);
});

test("release validation accepts explicit public and scoped restricted stable releases of all three packages", () => {
  assert.deepEqual(validateRelease(manifests(), "v1.2.3"), {
    names,
    version: "1.2.3",
    access: "public",
  });
  const restricted = manifests();
  for (const manifest of Object.values(restricted)) {
    manifest.publishConfig = { access: "restricted" };
  }
  assert.equal(validateRelease(restricted, "v1.2.3").access, "restricted");
});

test("release validation publishes core first, then the OpenCode and Kilo packages", () => {
  assert.deepEqual(names, [
    coreName,
    "@lunchbox-labs/opencode-tool-inspector",
    "@lunchbox-labs/kilo-tool-inspector",
  ]);
});

test("release validation takes a pre-release version only in a pre-release run", () => {
  const beta = manifests({ version: "1.2.3-beta.1" });
  const betaLock = lockFor("1.2.3-beta.1");
  assert.equal(
    validate(beta, "v1.2.3-beta.1", betaLock, { prerelease: true }).version,
    "1.2.3-beta.1",
  );
  assert.throws(
    () => validate(beta, "v1.2.3-beta.1", betaLock),
    /stable semantic version/,
  );
  assert.throws(
    () => validateRelease(manifests(), "v1.2.3", { prerelease: true }),
    /pre-release semantic version/,
  );
  for (const version of [
    "1.2.3-",
    "1.2.3-beta..1",
    "1.2.3-beta+1",
    "01.2.3-beta",
  ]) {
    assert.throws(
      () =>
        validate(manifests({ version }), `v${version}`, lockFor(version), {
          prerelease: true,
        }),
      version,
    );
  }
});

test("release validation rejects private, provisional, mismatched, prerelease, and misrouted packages", () => {
  for (const directory of Object.keys(packages)) {
    for (const change of [
      { private: true },
      { private: "false" },
      { name: "package-name-tbd" },
      { name: "invalid name" },
      { name: "opencode-tool-inspector" },
      { name: "@other/opencode-tool-inspector" },
      { version: "0.0.0" },
      { version: "1.2.3-beta.1" },
      { version: "01.2.3" },
      { version: "1.2.4" },
      { publishConfig: undefined },
      { publishConfig: { access: "other" } },
      { publishConfig: { access: "restricted" } },
      { name: "unscoped", publishConfig: { access: "restricted" } },
      {
        publishConfig: {
          access: "public",
          registry: "https://example.invalid",
        },
      },
      { repository: { url: "git+https://github.com/example/other.git" } },
      { repository: { ...repository, directory: "packages/other" } },
    ]) {
      assert.throws(
        () => validateRelease(manifests({ directory, change }), "v1.2.3"),
        undefined,
        `${directory} ${JSON.stringify(change)}`,
      );
    }
  }
  for (const directory of ["packages/opencode", "packages/kilo"]) {
    for (const dependencies of [undefined, {}, { [coreName]: "^1.2.3" }]) {
      assert.throws(
        () =>
          validateRelease(
            manifests({ directory, change: { dependencies } }),
            "v1.2.3",
          ),
        /exactly its own version/,
      );
    }
  }
  const missing = manifests();
  delete missing["packages/kilo"];
  assert.throws(() => validateRelease(missing, "v1.2.3"), /missing/);
  for (const tag of [
    undefined,
    "1.2.3",
    "v1.2.4",
    "main",
    "v1.2.3;echo unexpected",
  ]) {
    assert.throws(() => validateRelease(manifests(), tag), /release tag/);
  }
});

async function workflowFile(name) {
  const source = await readFile(
    new URL(`../.github/workflows/${name}`, import.meta.url),
    "utf8",
  );
  return { source, workflow: parseYaml(source) };
}

const repositoryGuard =
  "github.repository == 'lunchbox-labs/opencode-tool-inspector' && github.event_name == 'workflow_dispatch'";

test("a manual run on main verifies the packages' shared version, runs Check, publishes to npm and releases", async () => {
  const { workflow } = await workflowFile("release.yml");
  assert.equal(workflow.name, "Release");
  assert.equal(workflow["run-name"], undefined);
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  const { inputs } = workflow.on.workflow_dispatch;
  assert.deepEqual(Object.keys(inputs), ["dry_run", "prerelease"]);
  for (const input of Object.values(inputs)) {
    assert.equal(input.type, "boolean");
    assert.equal(input.default, false);
  }
  assert.doesNotMatch(
    JSON.stringify(workflow),
    /github\.event\.|github\.ref_name/,
  );
  assert.deepEqual(workflow.concurrency, {
    group: "release",
    "cancel-in-progress": false,
  });
  assert.deepEqual(Object.keys(workflow.jobs), [
    "version",
    "verify",
    "check",
    "publish",
    "release",
  ]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const {
    version: versionJob,
    verify,
    check,
    publish,
    release,
  } = workflow.jobs;
  assert.equal(versionJob.name, "Release version");
  assert.equal(verify.name, "Verify");
  assert.equal(check.name, "Check");
  assert.equal(publish.name, "Publish npm");
  assert.equal(release.name, "GitHub release");
  assert.equal(versionJob.needs, undefined);
  assert.deepEqual(verify.needs, ["version"]);
  assert.deepEqual(check.needs, ["verify"]);
  assert.deepEqual(publish.needs, ["verify", "check"]);
  assert.deepEqual(release.needs, ["verify", "publish"]);
  for (const job of [versionJob, verify, check]) {
    assert.equal(job.if.replace(/\s+/g, " ").trim(), repositoryGuard);
  }
  // A dry run skips npm, and the release job, which needs the npm job, with it.
  assert.equal(publish.if, "${{ !inputs.dry_run }}");
  assert.equal(release.if, undefined);

  assert.equal(check.uses, "./.github/workflows/check.yml");
  assert.deepEqual(check.permissions, { contents: "read" });
  assert.equal(check.secrets, undefined);

  assert.equal(versionJob.steps[0].name, "Require a run on main");
  assert.deepEqual(versionJob.steps[0].env, { RUN_REF: "${{ github.ref }}" });
  assert.deepEqual(versionJob.outputs, {
    tag: "${{ steps.version.outputs.tag }}",
  });
  const version = versionJob.steps.find((step) => step.id === "version");
  assert.deepEqual(version.env, {
    DRY_RUN: "${{ inputs.dry_run }}",
    PRERELEASE: "${{ inputs.prerelease }}",
    RELEASE_COMMIT: "${{ github.sha }}",
  });
  assert.deepEqual(verify.outputs, {
    access: "${{ steps.release.outputs.access }}",
    names: "${{ steps.release.outputs.names }}",
    tag: "${{ needs.version.outputs.tag }}",
    version: "${{ steps.release.outputs.version }}",
  });
  for (const job of [versionJob, verify]) {
    const checkout = job.steps.find((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    assert.equal(checkout.with.ref, "${{ github.sha }}");
    assert.equal(checkout.with["persist-credentials"], false);
  }
  assert.ok(
    verify.steps.some(
      (step) =>
        step.env?.WORKFLOW_COMMIT === "${{ github.sha }}" &&
        step.run.includes("git rev-parse HEAD"),
    ),
  );
  const validateStep = verify.steps.findIndex(
    (step) => step.run === "node scripts/validate-release.mjs",
  );
  const refuse = verify.steps.findIndex(
    (step) => step.name === "Refuse a version that is already released",
  );
  const exist = verify.steps.findIndex(
    (step) => step.name === "Require every package to exist on npm",
  );
  assert.ok(validateStep >= 0 && exist > validateStep && refuse > exist);
  assert.deepEqual(verify.steps[exist].env, {
    NPM_PACKAGES: "${{ steps.release.outputs.names }}",
  });
  assert.equal(
    workflow.jobs.publish["timeout-minutes"],
    15,
    "publishing three packages with provenance needs more than five minutes",
  );
  assert.deepEqual(verify.steps[validateStep].env, {
    RELEASE_PRERELEASE: "${{ inputs.prerelease }}",
    RELEASE_TAG: "${{ needs.version.outputs.tag }}",
  });
  let previous = refuse;
  for (const command of ["npm ci", "npm run test:package"]) {
    const index = verify.steps.findIndex((step) => step.run === command);
    assert.ok(index > previous, command);
    previous = index;
  }
  const pack = verify.steps.findIndex((step) =>
    step.run?.includes(
      "npm pack --workspaces --ignore-scripts --pack-destination release",
    ),
  );
  assert.ok(pack > previous);
  assert.match(verify.steps[pack].run, /sha256sum/);
  const upload = verify.steps.findIndex((step) =>
    step.uses?.startsWith("actions/upload-artifact@"),
  );
  assert.ok(upload > pack);
  assert.equal(verify.steps[upload].with.path, "release/");
  for (const job of [publish, release]) {
    const download = job.steps.find((step) =>
      step.uses?.startsWith("actions/download-artifact@"),
    );
    assert.equal(download.with.name, verify.steps[upload].with.name);
    assert.equal(download.with.path, "release");
  }

  const npm = publish.steps.find((step) => step.run?.includes("npm publish"));
  assert.equal(npm["working-directory"], "release");
  assert.deepEqual(npm.env, {
    NPM_ACCESS: "${{ needs.verify.outputs.access }}",
    NPM_PACKAGES: "${{ needs.verify.outputs.names }}",
    NPM_TAG: "${{ inputs.prerelease && 'next' || 'latest' }}",
    NPM_VERSION: "${{ needs.verify.outputs.version }}",
    NPM_CONFIG_PROVENANCE: "true",
  });
  const order = [
    "sha256sum --check SHA256SUMS",
    'npm view "$package@$NPM_VERSION" dist.integrity',
    "npm publish",
  ].map((text) => npm.run.indexOf(text));
  assert.ok(
    order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1])),
  );
  assert.match(
    npm.run,
    /npm publish "\$file" --ignore-scripts --access "\$NPM_ACCESS" --tag "\$NPM_TAG"/,
  );

  const create = release.steps.find(
    (step) => step.name === "Create the tag and the GitHub release",
  );
  assert.equal(create.id, "release");
  assert.equal(create["working-directory"], "release");
  assert.deepEqual(create.env, {
    GH_TOKEN: "${{ github.token }}",
    GH_REPO: "${{ github.repository }}",
    PRERELEASE: "${{ inputs.prerelease }}",
    RELEASE_COMMIT: "${{ github.sha }}",
    RELEASE_TAG: "${{ needs.verify.outputs.tag }}",
  });
  assert.ok(
    create.run.indexOf("sha256sum --check SHA256SUMS") <
      create.run.indexOf("gh release create"),
  );
  assert.doesNotMatch(
    create.run,
    /--draft(?!=false)|gh release delete|git (tag|push)/,
  );
  const summary = release.steps.find(
    (step) => step.name === "Link the release in the run summary",
  );
  assert.ok(release.steps.indexOf(summary) > release.steps.indexOf(create));
  assert.equal(summary.if, "steps.release.outputs.url != ''");
  assert.equal(summary["continue-on-error"], true);
  assert.deepEqual(summary.env, {
    RELEASE_ATTACHED: "${{ steps.release.outputs.attached }}",
    RELEASE_TAG: "${{ needs.verify.outputs.tag }}",
    RELEASE_URL: "${{ steps.release.outputs.url }}",
  });
  assert.doesNotMatch(summary.run, /\bgh\b|git /);
  assert.ok(
    !release.steps.some((step) => step.uses?.startsWith("actions/checkout@")),
    "the job that can write to the repository runs no repository code",
  );
});

test("Release grants OIDC only to npm publication and repository writes only to the GitHub release job", async () => {
  const { source, workflow } = await workflowFile("release.yml");
  assert.doesNotMatch(source, /secrets\.|vars\./);
  const allowed = new Set([
    "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09",
    "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
    "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9",
    "actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333",
  ]);
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    assert.equal(
      job.environment,
      ["publish", "release"].includes(jobName) ? "release" : undefined,
      jobName,
    );
    assert.equal(
      job.permissions?.contents ?? workflow.permissions.contents,
      jobName === "release" ? "write" : "read",
      jobName,
    );
    assert.equal(
      job.permissions?.["id-token"],
      jobName === "publish" ? "write" : undefined,
      jobName,
    );
    assert.deepEqual(
      Object.keys(job.permissions ?? {}).filter(
        (scope) => !["contents", "id-token"].includes(scope),
      ),
      [],
      jobName,
    );
    assert.doesNotMatch(
      JSON.stringify(job.outputs ?? {}),
      /token|secrets\.|vars\./,
    );
    for (const step of job.steps ?? []) {
      if (step.uses) {
        assert.ok(allowed.has(step.uses), step.uses);
      }
    }
  }
});

test("Check runs on pushes to main and as Release's called workflow in a group of its own", async () => {
  const { workflow } = await workflowFile("check.yml");
  assert.equal(workflow.name, "Check");
  assert.ok(workflow.on.push.branches.includes("main"));
  for (const filter of ["branches-ignore", "paths", "paths-ignore"]) {
    assert.equal(workflow.on.push[filter], undefined, filter);
  }
  assert.equal(workflow.on.workflow_call, null);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  // A called workflow sees the caller's github context, so the group starts with
  // Release, not Check, and a push to main can't cancel or replace Release's checks.
  assert.equal(
    workflow.concurrency.group,
    "${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}",
  );
  assert.equal(
    workflow.concurrency["cancel-in-progress"],
    "${{ github.event_name == 'pull_request' }}",
  );
  const { source } = await workflowFile("check.yml");
  assert.doesNotMatch(source, /secrets\.|github\.token|contents: write/);
});

// Where the workflow mentions the GitHub token: the workflow, a job or a step.
function tokenLocations(workflow) {
  const holds = (value) =>
    /github\.token|\bGITHUB_TOKEN\b|\bGH_TOKEN\b/.test(JSON.stringify(value));
  const { jobs, ...top } = workflow;
  const locations = holds(top) ? ["workflow"] : [];
  for (const [id, { steps = [], ...job }] of Object.entries(jobs)) {
    if (holds(job)) {
      locations.push(id);
    }
    steps.forEach((step, index) => {
      if (holds(step)) {
        locations.push(`${id}.steps.${index}`);
      }
    });
  }
  return locations;
}

test("only the GitHub release step receives the GitHub token", async () => {
  const { source, workflow } = await workflowFile("release.yml");
  const create = workflow.jobs.release.steps.findIndex(
    (step) => step.name === "Create the tag and the GitHub release",
  );
  assert.ok(create >= 0);
  assert.deepEqual(tokenLocations(workflow), [`release.steps.${create}`]);
  assert.equal(source.match(/github\.token/g)?.length, 1);
});

const digest = (algorithm, content, encoding) =>
  createHash(algorithm).update(content).digest(encoding);
/** The packed tarballs by file name, as npm pack names them, each with its package name as content. */
const tarballs = Object.fromEntries(
  names.map((name) => [`${name.slice(1).replace("/", "-")}-1.2.3.tgz`, name]),
);
const tarballFiles = Object.keys(tarballs);
const fileOf = (name) => tarballFiles.find((file) => tarballs[file] === name);
const integrityOf = (name) => `sha512-${digest("sha512", name, "base64")}`;
// In the glob order the release step attaches them.
const attachedFiles = [...tarballFiles]
  .sort()
  .map((file) => `./${file}`)
  .join(" ");

// Runs a step's shell script as GitHub runs it on Linux, with stub commands
// that record their arguments and answer from environment variables.
async function runStep(job, stubs, env, name) {
  const { execFile } = await import("node:child_process");
  const { mkdtemp, mkdir, writeFile, chmod, rm, readFile } =
    await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { workflow } = await workflowFile("release.yml");
  const steps = workflow.jobs[job].steps;
  const step =
    name === undefined ? steps.at(-1) : steps.find((s) => s.name === name);
  const root = await mkdtemp(join(tmpdir(), "release-step-"));
  try {
    const bin = join(root, "bin");
    const release = join(root, "release");
    await mkdir(bin);
    await mkdir(release);
    for (const [file, content] of Object.entries(tarballs)) {
      await writeFile(join(release, file), content);
    }
    await writeFile(
      join(release, "SHA256SUMS"),
      Object.entries(tarballs)
        .map(
          ([file, content]) =>
            `${digest("sha256", content, "hex")}  ./${file}\n`,
        )
        .join(""),
    );
    for (const [name, body] of Object.entries(stubs)) {
      const file = join(bin, name);
      await writeFile(
        file,
        `#!/usr/bin/env bash\necho "${name} $*" >> "$CALLS"\n${body}\n`,
      );
      await chmod(file, 0o755);
    }
    const calls = join(root, "calls.log");
    const output = join(root, "output");
    const summary = join(root, "summary.md");
    await writeFile(calls, "");
    await writeFile(output, "");
    await writeFile(summary, "");
    const result = await new Promise((resolve) => {
      execFile(
        "bash",
        ["-e", "-o", "pipefail", "-c", step.run],
        {
          cwd: release,
          env: {
            ...process.env,
            ...env,
            PATH: `${bin}:${process.env.PATH}`,
            CALLS: calls,
            GITHUB_OUTPUT: output,
            GITHUB_STEP_SUMMARY: summary,
            RUNNER_TEMP: root,
          },
        },
        (error, stdout, stderr) =>
          resolve({ code: error ? error.code : 0, stdout, stderr }),
      );
    });
    return {
      ...result,
      calls: (await readFile(calls, "utf8")).trim().split("\n"),
      output: await readFile(output, "utf8"),
      summary: await readFile(summary, "utf8"),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const linuxOnly = {
  skip:
    process.platform !== "linux" &&
    "the release steps run only on ubuntu-latest and use GNU tools",
};

test(
  "the npm step publishes core, then OpenCode, then Kilo under the tag, skipping each same tarball and stopping on another",
  linuxOnly,
  async () => {
    // views maps a package name to what npm view answers for it.
    const answers = {
      missing: `echo "npm error code E404" >&2; exit 1`,
      same: (name) => `echo "${integrityOf(name)}"; exit 0`,
      other: () => `echo "sha512-other"; exit 0`,
      offline: `echo "npm error code ECONNRESET" >&2; exit 1`,
    };
    const run = (views = {}, tag = "latest") =>
      runStep(
        "publish",
        {
          npm: [
            `if [ "$1" = view ]; then`,
            `  case "$2" in`,
            ...names.map((name) => {
              const view = views[name] ?? "missing";
              const answer = answers[view];
              return `    "${name}@1.2.3") ${typeof answer === "function" ? answer(name) : answer} ;;`;
            }),
            `  esac`,
            `fi`,
          ].join("\n"),
        },
        {
          NPM_ACCESS: "public",
          NPM_PACKAGES: names.join(" "),
          NPM_TAG: tag,
          NPM_VERSION: "1.2.3",
        },
      );
    const publishes = (result) =>
      result.calls.filter((call) => call.startsWith("npm publish"));
    const publish = (name, tag = "latest") =>
      `npm publish ./${fileOf(name)} --ignore-scripts --access public --tag ${tag}`;
    const fresh = await run();
    assert.equal(fresh.code, 0, fresh.stderr);
    assert.deepEqual(
      publishes(fresh),
      names.map((name) => publish(name)),
    );
    const next = await run({}, "next");
    assert.equal(next.code, 0, next.stderr);
    assert.deepEqual(
      publishes(next),
      names.map((name) => publish(name, "next")),
    );
    const partial = await run({ [names[0]]: "same" });
    assert.equal(partial.code, 0, partial.stderr);
    assert.deepEqual(
      publishes(partial),
      names.slice(1).map((name) => publish(name)),
    );
    assert.match(
      partial.stdout,
      /tool-inspector-core@1\.2\.3 is already on npm with this tarball/,
    );
    const done = await run(
      Object.fromEntries(names.map((name) => [name, "same"])),
    );
    assert.equal(done.code, 0, done.stderr);
    assert.deepEqual(publishes(done), []);
    const other = await run({ [names[1]]: "other" });
    assert.equal(other.code, 1);
    assert.deepEqual(publishes(other), [publish(names[0])]);
    assert.match(
      other.stdout,
      /opencode-tool-inspector@1\.2\.3 is already on npm with a different tarball/,
    );
    const offline = await run({ [names[0]]: "offline" });
    assert.equal(offline.code, 1);
    assert.deepEqual(publishes(offline), []);
    assert.match(offline.stderr, /ECONNRESET/);
  },
);

const commit = "0123456789abcdef0123456789abcdef01234567";
const releasePage =
  "https://github.com/lunchbox-labs/example/releases/tag/v1.2.3";

// Runs the release step against a stub gh. tag is the commit the tag points
// at, or undefined when the tag is missing; releases is the releases API list.
// releasesError and createError make those gh calls fail.
const runRelease = ({
  tag,
  tagError,
  releases = [],
  releasesError,
  createError,
  prerelease = false,
}) =>
  runStep(
    "release",
    {
      gh: [
        `if [ "$1 $2" = "api repos/lunchbox-labs/example/git/ref/tags/v1.2.3" ]; then`,
        tagError
          ? `  echo "${tagError}" >&2; exit 1`
          : tag === undefined
            ? `  echo "gh: Not Found (HTTP 404)" >&2; exit 1`
            : `  echo "${tag}"; exit 0`,
        `fi`,
        `if [ "$1" = api ]; then`,
        releasesError ? `  echo "${releasesError}" >&2; exit 1` : `  :`,
        // The filter is the argument after --jq.
        `  while [ "$#" -gt 0 ] && [ "$1" != --jq ]; do shift; done`,
        `  jq -r "$2" <<'JSON'\n${JSON.stringify(releases)}\nJSON\n  exit 0`,
        `fi`,
        createError
          ? `if [ "$1 $2" = "release create" ]; then echo "${createError}" >&2; exit 1; fi`
          : ``,
        `if [ "$1 $2" = "release view" ]; then echo "${releasePage}"; fi`,
      ].join("\n"),
    },
    {
      GH_REPO: "lunchbox-labs/example",
      PRERELEASE: String(prerelease),
      RELEASE_COMMIT: commit,
      RELEASE_TAG: "v1.2.3",
    },
    "Create the tag and the GitHub release",
  );

test(
  "the release step creates the tag and a published release with the package",
  linuxOnly,
  async () => {
    const created = await runRelease({
      releases: [
        { tag_name: "v1.2.30", draft: false, html_url: "x", assets: [] },
      ],
    });
    assert.equal(created.code, 0, created.stderr);
    assert.ok(
      created.calls.includes(
        `gh release create v1.2.3 ${attachedFiles} --target ${commit} --generate-notes --title v1.2.3 --prerelease=false`,
      ),
      created.calls.join("\n"),
    );
    assert.equal(created.output, `attached=true\nurl=${releasePage}\n`);
    const pre = await runRelease({ prerelease: true });
    assert.equal(pre.code, 0, pre.stderr);
    assert.ok(
      pre.calls.includes(
        `gh release create v1.2.3 ${attachedFiles} --target ${commit} --generate-notes --title v1.2.3 --prerelease=true`,
      ),
      pre.calls.join("\n"),
    );
  },
);

test(
  "a re-run accepts the tag on the release commit, publishes a draft and leaves a published release",
  linuxOnly,
  async () => {
    const tagged = await runRelease({ tag: commit });
    assert.equal(tagged.code, 0, tagged.stderr);
    assert.ok(
      tagged.calls.some((call) => call.startsWith("gh release create")),
    );

    const draft = await runRelease({
      releases: [
        { tag_name: "v1.2.3", draft: true, html_url: "draft", assets: [] },
      ],
    });
    assert.equal(draft.code, 0, draft.stderr);
    assert.ok(
      !draft.calls.some((call) => call.startsWith("gh release create")),
    );
    const upload = draft.calls.indexOf(
      `gh release upload v1.2.3 ${attachedFiles} --clobber`,
    );
    const edit = draft.calls.indexOf(
      `gh release edit v1.2.3 --draft=false --target ${commit} --title v1.2.3 --prerelease=false`,
    );
    assert.ok(upload >= 0 && edit > upload, draft.calls.join("\n"));
    assert.equal(draft.output, `attached=true\nurl=${releasePage}\n`);

    const published = await runRelease({
      tag: commit,
      releases: [
        {
          tag_name: "v1.2.3",
          draft: false,
          html_url: releasePage,
          assets: tarballFiles.map((file) => ({ name: file })),
        },
      ],
    });
    assert.equal(published.code, 0, published.stderr);
    assert.ok(
      !published.calls.some((call) =>
        /gh release (?:create|upload|edit)/.test(call),
      ),
    );
    assert.equal(published.output, `attached=true\nurl=${releasePage}\n`);

    const bare = await runRelease({
      tag: commit,
      releases: [
        { tag_name: "v1.2.3", draft: false, html_url: releasePage, assets: [] },
      ],
    });
    assert.equal(bare.code, 0, bare.stderr);
    assert.match(
      bare.stdout,
      new RegExp(`::warning::.*without ${[...tarballFiles].sort().join(" ")}`),
    );
    assert.equal(bare.output, `attached=false\nurl=${releasePage}\n`);

    const partial = await runRelease({
      tag: commit,
      releases: [
        {
          tag_name: "v1.2.3",
          draft: false,
          html_url: releasePage,
          assets: tarballFiles
            .filter((file) => file !== fileOf(names[2]))
            .map((file) => ({ name: file })),
        },
      ],
    });
    assert.equal(partial.code, 0, partial.stderr);
    assert.match(
      partial.stdout,
      /::warning::.*without lunchbox-labs-kilo-tool-inspector-1\.2\.3\.tgz,/,
    );
    assert.equal(partial.output, `attached=false\nurl=${releasePage}\n`);
  },
);

test(
  "the release step stops when the tag points elsewhere or can't be read",
  linuxOnly,
  async () => {
    const moved = await runRelease({
      tag: "fedcba9876543210fedcba9876543210fedcba98",
    });
    assert.equal(moved.code, 1);
    assert.match(moved.stdout, /::error::Tag v1\.2\.3 points at fedcba98/);
    assert.ok(!moved.calls.some((call) => call.startsWith("gh release")));
    const unreachable = await runRelease({
      tagError: "gh: Bad credentials (HTTP 401)",
    });
    assert.equal(unreachable.code, 1);
    assert.match(unreachable.stderr, /HTTP 401/);
    assert.ok(!unreachable.calls.some((call) => call.startsWith("gh release")));
  },
);

test(
  "a pre-release re-run publishes a draft as a pre-release",
  linuxOnly,
  async () => {
    const draft = await runRelease({
      prerelease: true,
      releases: [
        { tag_name: "v1.2.3", draft: true, html_url: "draft", assets: [] },
      ],
    });
    assert.equal(draft.code, 0, draft.stderr);
    assert.ok(
      draft.calls.includes(
        `gh release edit v1.2.3 --draft=false --target ${commit} --title v1.2.3 --prerelease=true`,
      ),
      draft.calls.join("\n"),
    );
  },
);

test(
  "the release step fails without a release link when GitHub refuses the release or the listing",
  linuxOnly,
  async () => {
    const refused = await runRelease({
      createError: "HTTP 422: Repository rule violations found",
    });
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /HTTP 422/);
    assert.equal(refused.output, "");
    const unlisted = await runRelease({
      releasesError: "gh: Server Error (HTTP 502)",
    });
    assert.equal(unlisted.code, 1);
    assert.ok(
      !unlisted.calls.some((call) => call.startsWith("gh release")),
      unlisted.calls.join("\n"),
    );
    assert.equal(unlisted.output, "");
  },
);

test("the run summary links the release", linuxOnly, async () => {
  const run = (attached) =>
    runStep(
      "release",
      {},
      {
        RELEASE_ATTACHED: attached,
        RELEASE_TAG: "v1.2.3",
        RELEASE_URL: releasePage,
      },
      "Link the release in the run summary",
    );
  const attached = await run("true");
  assert.equal(attached.code, 0, attached.stderr);
  assert.match(attached.summary, /^### Released v1\.2\.3$/m);
  assert.ok(
    attached.summary.includes(
      `[The v1.2.3 release](${releasePage}) is published`,
    ),
  );
  const bare = await run("false");
  assert.equal(bare.code, 0, bare.stderr);
  assert.match(bare.summary, /without some packages/);
});

test(
  "a run refuses a version that already has a tag or an npm release",
  linuxOnly,
  async () => {
    // view answers npm view for every package; published names the one already on npm.
    const run = (lsRemote, view, published) =>
      runStep(
        "verify",
        {
          git: `if [ "$1" = ls-remote ]; then ${lsRemote}; fi`,
          npm: [
            `if [ "$1" = view ]; then`,
            published === undefined
              ? ""
              : `  if [ "$2" = "${published}@1.2.3" ]; then echo "1.2.3"; exit 0; fi`,
            `  ${view}`,
            `fi`,
          ].join("\n"),
        },
        {
          NPM_PACKAGES: names.join(" "),
          NPM_VERSION: "1.2.3",
          RELEASE_TAG: "v1.2.3",
        },
        "Refuse a version that is already released",
      );
    const missingTag = "exit 2";
    const missingVersion = `echo "npm error code E404" >&2; exit 1`;
    const fresh = await run(missingTag, missingVersion);
    assert.equal(fresh.code, 0, fresh.stderr);
    assert.deepEqual(fresh.calls, [
      "git ls-remote --exit-code --tags origin refs/tags/v1.2.3",
      ...names.map((name) => `npm view ${name}@1.2.3 version`),
    ]);
    for (const name of names) {
      const one = await run(missingTag, missingVersion, name);
      assert.equal(one.code, 1, name);
      assert.ok(
        one.stdout.includes(`::error::${name}@1.2.3 is already on npm`),
        one.stdout,
      );
    }
    const tagged = await run(
      `echo "abc refs/tags/v1.2.3"; exit 0`,
      missingVersion,
    );
    assert.equal(tagged.code, 1);
    assert.match(tagged.stdout, /::error::Tag v1\.2\.3 already exists/);
    assert.ok(!tagged.calls.some((call) => call.startsWith("npm ")));
    const unreachable = await run("exit 128", missingVersion);
    assert.equal(unreachable.code, 1);
    assert.match(unreachable.stdout, /Could not check whether tag v1\.2\.3/);
    const offline = await run(
      missingTag,
      `echo "npm error code ECONNRESET" >&2; exit 1`,
    );
    assert.equal(offline.code, 1);
    assert.match(offline.stderr, /ECONNRESET/);
  },
);

test(
  "a run stops before building unless every package already exists on npm",
  linuxOnly,
  async () => {
    // absent names the packages npm answers E404 for.
    const run = (absent, failure = `echo "npm error code E404" >&2; exit 1`) =>
      runStep(
        "verify",
        {
          npm: [
            `if [ "$1" = view ] && [ "$3" = name ]; then`,
            ...absent.map(
              (name) => `  if [ "$2" = "${name}" ]; then ${failure}; fi`,
            ),
            `  echo "$2"`,
            `fi`,
          ].join("\n"),
        },
        { NPM_PACKAGES: names.join(" ") },
        "Require every package to exist on npm",
      );
    const all = await run([]);
    assert.equal(all.code, 0, all.stderr);
    assert.deepEqual(
      all.calls,
      names.map((name) => `npm view ${name} name`),
    );
    const fresh = await run(names.slice(0, 1).concat(names.slice(2)));
    assert.equal(fresh.code, 1);
    assert.ok(
      fresh.stdout.includes(
        `::error::These packages are not on npm yet: ${names[0]} ${names[2]}.`,
      ),
      fresh.stdout,
    );
    const offline = await run(
      names.slice(1, 2),
      `echo "npm error code ECONNRESET" >&2; exit 1`,
    );
    assert.equal(offline.code, 1);
    assert.match(offline.stderr, /ECONNRESET/);
  },
);

test("a run started on another branch fails at once", linuxOnly, async () => {
  const run = (ref) =>
    runStep("version", {}, { RUN_REF: ref }, "Require a run on main");
  const main = await run("refs/heads/main");
  assert.equal(main.code, 0, main.stderr);
  const branch = await run("refs/heads/feature");
  assert.equal(branch.code, 1);
  assert.match(
    branch.stdout,
    /::error::Run Release on main\. This run was started on refs\/heads\/feature\./,
  );
});

test(
  "the Release version job names the release in the run summary",
  linuxOnly,
  async () => {
    const { mkdtemp, mkdir, writeFile, readFile, rm } =
      await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { execFile } = await import("node:child_process");
    const { workflow } = await workflowFile("release.yml");
    const step = workflow.jobs.version.steps.find(
      (candidate) => candidate.id === "version",
    );
    // version is every package's version, or a list of one per package.
    const run = async (
      version,
      { dryRun = false, prerelease = false } = {},
    ) => {
      const root = await mkdtemp(join(tmpdir(), "release-version-"));
      try {
        const versions = Array.isArray(version)
          ? version
          : Object.keys(packages).map(() => version);
        for (const [index, directory] of Object.keys(packages).entries()) {
          await mkdir(join(root, directory), { recursive: true });
          await writeFile(
            join(root, directory, "package.json"),
            JSON.stringify({ version: versions[index] }),
          );
        }
        const output = join(root, "output");
        const summary = join(root, "summary");
        await writeFile(output, "");
        await writeFile(summary, "");
        const { code, stdout } = await new Promise((resolve) => {
          execFile(
            "bash",
            ["-e", "-c", step.run],
            {
              cwd: root,
              env: {
                ...process.env,
                DRY_RUN: String(dryRun),
                GITHUB_OUTPUT: output,
                GITHUB_STEP_SUMMARY: summary,
                PRERELEASE: String(prerelease),
                RELEASE_COMMIT: commit,
              },
            },
            (error, stdout) =>
              resolve({ code: error ? error.code : 0, stdout }),
          );
        });
        return {
          code,
          stdout,
          output: await readFile(output, "utf8"),
          summary: await readFile(summary, "utf8"),
        };
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    };
    const stable = await run("1.2.3");
    assert.equal(stable.code, 0);
    assert.equal(stable.output, "tag=v1.2.3\n");
    assert.match(
      stable.stdout,
      /::notice::Releasing v1\.2\.3 from 0123456789abcdef/,
    );
    assert.match(stable.summary, /^### Release v1\.2\.3$/m);
    assert.match(stable.summary, new RegExp(commit));
    assert.match(stable.summary, /as a release\./);
    assert.doesNotMatch(stable.summary, /Dry run/);
    const dry = await run("1.2.3", { dryRun: true });
    assert.equal(dry.code, 0);
    assert.match(dry.summary, /^Dry run: /m);
    const beta = await run("1.2.3-beta.1", { prerelease: true });
    assert.equal(beta.code, 0);
    assert.equal(beta.output, "tag=v1.2.3-beta.1\n");
    assert.match(beta.summary, /as a pre-release\./);
    for (const [version, prerelease] of [
      ["1.2.3-beta.1", false],
      ["1.2.3", true],
      ["1.2", false],
      ["1.2.3\nname=x", false],
      ["1.2.3-beta\nname=x", true],
      [["1.2.3", "1.2.3", "1.2.4"], false],
      [["1.2.3-beta.1", "1.2.3-beta.2", "1.2.3-beta.1"], true],
    ]) {
      const refused = await run(version, { prerelease });
      assert.equal(refused.code, 1, version);
      assert.equal(refused.output, "", version);
      assert.equal(refused.summary, "", version);
    }
  },
);
