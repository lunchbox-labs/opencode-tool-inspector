import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const core = String.raw`(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)`;
const stableVersion = new RegExp(`^${core}$`);
const prereleaseVersion = new RegExp(
  String.raw`^${core}-[0-9a-z-]+(?:\.[0-9a-z-]+)*$`,
  "i",
);

/** The released packages in publication order. */
export const releasePackages = [
  {
    directory: "packages/opencode",
    name: "@lunchbox-labs/opencode-tool-inspector",
  },
  { directory: "packages/kilo", name: "@lunchbox-labs/kilo-tool-inspector" },
];
/** Private source that the build bundles into each released package; never on npm. */
const coreName = "@lunchbox-labs/tool-inspector-core";
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const repositoryUrl =
  "git+https://github.com/lunchbox-labs/tool-inspector-plugin.git";

function validatePackage(
  { directory, name },
  manifest,
  tag,
  lock,
  { prerelease },
) {
  if (manifest === undefined) {
    throw new Error(`${directory}/package.json is missing.`);
  }
  if (manifest.private !== undefined && manifest.private !== false) {
    throw new Error(
      `Remove the private publication guard from ${name} only after release setup is approved.`,
    );
  }
  if (manifest.name !== name) {
    throw new Error(`The npm package name in ${directory} must be ${name}.`);
  }
  // 0.0.0 and its pre-releases, such as the 0.0.0-bootstrap.0 placeholder
  // published by hand to set up trusted publishing, are never released.
  if (
    typeof manifest.version !== "string" ||
    /^0\.0\.0(?:-|$)/.test(manifest.version)
  ) {
    throw new Error("Publishing requires a non-placeholder semantic version.");
  }
  if (prerelease && !prereleaseVersion.test(manifest.version)) {
    throw new Error(
      "A pre-release requires a pre-release semantic version, such as 1.2.3-beta.1.",
    );
  }
  if (!prerelease && !stableVersion.test(manifest.version)) {
    throw new Error(
      "A release requires a stable semantic version; publish pre-release versions as a pre-release.",
    );
  }
  if (tag !== `v${manifest.version}`) {
    throw new Error(
      "The release tag must equal v followed by the package version.",
    );
  }
  const access = manifest.publishConfig?.access;
  if (
    !["public", "restricted"].includes(access) ||
    (access === "restricted" && !manifest.name.startsWith("@"))
  ) {
    throw new Error(
      "Set an approved publishConfig.access; restricted packages require a scope.",
    );
  }
  if (manifest.repository?.url !== repositoryUrl) {
    throw new Error(
      "The package repository must match the trusted publisher repository.",
    );
  }
  if (manifest.repository.directory !== directory) {
    throw new Error(
      `The repository directory of ${name} must be ${directory}.`,
    );
  }
  if (
    manifest.publishConfig?.registry !== undefined &&
    manifest.publishConfig.registry !== "https://registry.npmjs.org"
  ) {
    throw new Error(
      "This workflow publishes only to https://registry.npmjs.org.",
    );
  }
  // Core isn't on npm, so a package that names it in any dependency field
  // can't be installed from the registry.
  for (const field of dependencyFields) {
    if (Object.hasOwn(manifest[field] ?? {}, coreName)) {
      throw new Error(
        `${name} must not list ${coreName} in ${field}; the build bundles it.`,
      );
    }
  }
  const locked = lock?.packages?.[directory];
  if (locked?.name !== manifest.name || locked.version !== manifest.version) {
    throw new Error(
      "The lockfile package name and version must match the release manifest.",
    );
  }
  return access;
}

// A pre-release run publishes a pre-release version only, and a normal run a
// stable version only, so npm's latest tag never moves to a pre-release. The
// packages are released together, so every one must have the same version and
// access.
export function validateRelease(
  manifests,
  tag,
  lock,
  { prerelease = false } = {},
) {
  const accesses = releasePackages.map((release) =>
    validatePackage(release, manifests[release.directory], tag, lock, {
      prerelease,
    }),
  );
  const versions = new Set(
    releasePackages.map(({ directory }) => manifests[directory].version),
  );
  if (versions.size !== 1) {
    throw new Error("Every released package must have the same version.");
  }
  if (new Set(accesses).size !== 1) {
    throw new Error("Every released package must have the same access.");
  }
  return {
    names: releasePackages.map(({ name }) => name),
    version: [...versions][0],
    access: accesses[0],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const read = (path) =>
    JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
  const manifests = Object.fromEntries(
    releasePackages.map(({ directory }) => [
      directory,
      read(`${directory}/package.json`),
    ]),
  );
  const result = validateRelease(
    manifests,
    process.env.RELEASE_TAG,
    read("package-lock.json"),
    { prerelease: process.env.RELEASE_PRERELEASE === "true" },
  );
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `access=${result.access}\nnames=${result.names.join(" ")}\nversion=${result.version}\n`,
    );
  }
  console.log(
    `Validated ${result.names.map((name) => `${name}@${result.version}`).join(", ")} for ${result.access} publication.`,
  );
}
