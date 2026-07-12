import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const RELEASE_PACKAGE_PATHS = [
  "packages/contracts/package.json",
  "packages/node-utils/package.json",
  "packages/sdk/package.json",
  "packages/agents/package.json",
];

export function validateNpmReleaseVersions(packages, releaseTag = "") {
  if (packages.length === 0) {
    throw new Error("No npm release packages were provided.");
  }

  const names = new Set();
  for (const pkg of packages) {
    if (typeof pkg.name !== "string" || !pkg.name.startsWith("@rateloop/")) {
      throw new Error(`Invalid public package name: ${String(pkg.name)}`);
    }
    if (names.has(pkg.name)) {
      throw new Error(`Duplicate public package: ${pkg.name}`);
    }
    names.add(pkg.name);
    if (typeof pkg.version !== "string" || !SEMVER_PATTERN.test(pkg.version)) {
      throw new Error(
        `Public npm package version must be valid semver: ${pkg.name}@${String(pkg.version)}`,
      );
    }
  }

  if (releaseTag) {
    const taggedVersion = releaseTag.startsWith("v")
      ? releaseTag.slice(1)
      : releaseTag;
    if (!packages.some((pkg) => pkg.version === taggedVersion)) {
      throw new Error(
        `Release tag ${releaseTag} does not match any public package version.`,
      );
    }
  }

  return packages.map(({ name, version }) => ({ name, version }));
}

function readReleasePackages() {
  return RELEASE_PACKAGE_PATHS.map((path) => {
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    return { name: manifest.name, version: manifest.version };
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(
      JSON.stringify(
        validateNpmReleaseVersions(
          readReleasePackages(),
          process.argv[2] ?? "",
        ),
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
