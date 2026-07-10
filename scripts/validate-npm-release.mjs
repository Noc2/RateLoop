import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const RELEASE_PACKAGE_PATHS = [
  "packages/contracts/package.json",
  "packages/node-utils/package.json",
  "packages/sdk/package.json",
  "packages/agents/package.json",
];

export function resolveNpmReleaseVersion(packages, releaseTag = "") {
  if (packages.length === 0) {
    throw new Error("No npm release packages were provided.");
  }

  const versions = new Set(packages.map(pkg => pkg.version));
  if (versions.size !== 1) {
    throw new Error(
      `Public npm package versions must match: ${packages
        .map(pkg => `${pkg.name}@${pkg.version}`)
        .join(", ")}`,
    );
  }

  const [version] = versions;
  if (typeof version !== "string" || !SEMVER_PATTERN.test(version)) {
    throw new Error(`Public npm package version must be valid semver: ${version}`);
  }

  if (releaseTag && releaseTag !== `v${version}`) {
    throw new Error(
      `Release tag ${releaseTag} does not match public npm package version ${version}.`,
    );
  }

  return version;
}

function readReleasePackages() {
  return RELEASE_PACKAGE_PATHS.map(path => {
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    return { name: manifest.name, version: manifest.version };
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(resolveNpmReleaseVersion(readReleasePackages(), process.argv[2] ?? ""));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
