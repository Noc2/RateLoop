import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const releasePackages = [
  {
    name: "@rateloop/contracts",
    path: "packages/contracts/package.json",
    internalDependencies: {},
  },
  {
    name: "@rateloop/node-utils",
    path: "packages/node-utils/package.json",
    internalDependencies: {},
  },
  {
    name: "@rateloop/sdk",
    path: "packages/sdk/package.json",
    internalDependencies: {
      "@rateloop/contracts": "workspace:*",
    },
  },
  {
    name: "@rateloop/agents",
    path: "packages/agents/package.json",
    internalDependencies: {
      "@rateloop/contracts": "workspace:*",
      "@rateloop/node-utils": "workspace:*",
      "@rateloop/sdk": "workspace:*",
    },
  },
];
const releasePackageNames = new Set(releasePackages.map(pkg => pkg.name));

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("public npm packages are ready for the 0.1.0 provenance publish gate", () => {
  for (const pkg of releasePackages) {
    const manifest = readJson(pkg.path);

    assert.equal(manifest.name, pkg.name);
    assert.equal(manifest.version, "0.1.0", `${pkg.name} version`);
    assert.notEqual(manifest.private, true, `${pkg.name} must be publishable`);
    assert.equal(manifest.license, "MIT", `${pkg.name} license`);
    assert.equal(manifest.publishConfig?.access, "public", `${pkg.name} access`);
    assert.equal(manifest.publishConfig?.provenance, true, `${pkg.name} provenance`);
    assert.equal(manifest.repository?.type, "git", `${pkg.name} repository type`);
    assert.equal(
      manifest.repository?.url,
      "git+https://github.com/Noc2/RateLoop.git",
      `${pkg.name} repository URL`,
    );
    assert.equal(
      manifest.repository?.directory,
      pkg.path.replace(/\/package\.json$/, ""),
      `${pkg.name} repository directory`,
    );
    assert.match(
      manifest.homepage ?? "",
      /^https:\/\/github\.com\/Noc2\/RateLoop\/tree\/main\/packages\//,
      `${pkg.name} homepage`,
    );
    assert.ok(Array.isArray(manifest.files), `${pkg.name} files list`);
    assert.ok(manifest.files.includes("dist"), `${pkg.name} publishes dist`);
    assert.ok(manifest.exports?.["."], `${pkg.name} root export`);
    assert.ok(manifest.scripts?.build, `${pkg.name} build script`);
    assert.ok(manifest.scripts?.prepack, `${pkg.name} prepack script`);

    for (const [dependencyName, expectedRange] of Object.entries(pkg.internalDependencies)) {
      assert.equal(
        manifest.dependencies?.[dependencyName],
        expectedRange,
        `${pkg.name} depends on ${dependencyName} through the workspace protocol`,
      );
    }

    for (const [dependencyName, dependencyRange] of Object.entries(manifest.dependencies ?? {})) {
      if (!String(dependencyRange).startsWith("workspace:")) continue;

      assert.ok(
        releasePackageNames.has(dependencyName),
        `${pkg.name} has public workspace dependency ${dependencyName}; add it to releasePackages or remove it from the public package`,
      );
      const dependencyPackage = releasePackages.find(candidate => candidate.name === dependencyName);
      assert.ok(dependencyPackage, `${dependencyName} release metadata is present`);
      assert.notEqual(
        readJson(dependencyPackage.path).private,
        true,
        `${pkg.name} public dependency ${dependencyName} must be publishable`,
      );
    }
  }
});

test("npm publish workflow uses GitHub OIDC provenance and publishes in dependency order", () => {
  const workflow = readFileSync(".github/workflows/publish-npm.yaml", "utf8");

  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /NPM_CONFIG_PROVENANCE:\s*"true"/);
  assert.match(workflow, /publish_args=\(--provenance/);
  assert.match(workflow, /npm publish/);
  assert.match(workflow, /--dry-run/);

  const contractsIndex = workflow.indexOf("rateloop-contracts.tgz");
  const sdkIndex = workflow.indexOf("rateloop-sdk.tgz");
  const agentsIndex = workflow.indexOf("rateloop-agents.tgz");

  assert.ok(contractsIndex > -1, "contracts tarball is published");
  assert.ok(sdkIndex > contractsIndex, "sdk is published after contracts");
  assert.ok(agentsIndex > sdkIndex, "agents is published after sdk");
});

test("package-local builds refresh public workspace dependencies before compiling", () => {
  for (const pkg of releasePackages) {
    const manifest = readJson(pkg.path);
    const workspaceDependencies = Object.entries(manifest.dependencies ?? {})
      .filter(([, range]) => String(range).startsWith("workspace:"))
      .map(([name]) => name);

    if (workspaceDependencies.length === 0) continue;

    const buildWorkspaceDepsScript = manifest.scripts?.["build:workspace-deps"] ?? "";
    assert.ok(
      buildWorkspaceDepsScript,
      `${pkg.name} declares build:workspace-deps for public workspace dependencies`,
    );
    assert.match(
      manifest.scripts?.build ?? "",
      /^yarn build:workspace-deps && /,
      `${pkg.name} build refreshes workspace dependencies first`,
    );
    assert.match(
      manifest.scripts?.["check-types"] ?? "",
      /^yarn build:workspace-deps && /,
      `${pkg.name} type-check refreshes workspace dependencies first`,
    );

    for (const dependencyName of workspaceDependencies) {
      assert.match(
        buildWorkspaceDepsScript,
        new RegExp(`yarn workspace ${escapeRegExp(dependencyName)} build(?=\\s|$|:)`),
        `${pkg.name} builds ${dependencyName} before compiling`,
      );
    }
  }
});
