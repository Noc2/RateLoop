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
  assert.match(workflow, /Validate publish inputs/);
  assert.match(workflow, /for tag in latest next canary/);
  assert.match(workflow, /NPM_TAG must be one of: latest, next, canary\./);
  assert.match(workflow, /PUBLISH_DRY_RUN"\s*==\s*"true"/);
  assert.match(workflow, /GITHUB_REF"\s*==\s*"refs\/heads\/main"/);
  assert.match(workflow, /refs\/tags\/v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+/);

  const contractsIndex = workflow.indexOf("npm publish \"$RUNNER_TEMP/rateloop-npm/rateloop-contracts.tgz\"");
  const nodeUtilsIndex = workflow.indexOf("npm publish \"$RUNNER_TEMP/rateloop-npm/rateloop-node-utils.tgz\"");
  const sdkIndex = workflow.indexOf("npm publish \"$RUNNER_TEMP/rateloop-npm/rateloop-sdk.tgz\"");
  const agentsIndex = workflow.indexOf("npm publish \"$RUNNER_TEMP/rateloop-npm/rateloop-agents.tgz\"");

  assert.ok(contractsIndex > -1, "contracts tarball is published");
  assert.ok(nodeUtilsIndex > contractsIndex, "node-utils is published after contracts");
  assert.ok(sdkIndex > nodeUtilsIndex, "sdk is published after node-utils");
  assert.ok(agentsIndex > sdkIndex, "agents is published after sdk");
});

test("package-local builds refresh public workspace dependencies before compiling", () => {
  const workspaceDistLockPrefix = /^node \.\.\/\.\.\/scripts\/with-workspace-dist-lock\.mjs "/;

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
      buildWorkspaceDepsScript,
      workspaceDistLockPrefix,
      `${pkg.name} locks workspace dist while refreshing workspace dependencies`,
    );
    assert.match(
      manifest.scripts?.build ?? "",
      /^node \.\.\/\.\.\/scripts\/with-workspace-dist-lock\.mjs "yarn build:workspace-deps && /,
      `${pkg.name} build refreshes workspace dependencies under the workspace dist lock`,
    );
    assert.match(
      manifest.scripts?.["check-types"] ?? "",
      /^node \.\.\/\.\.\/scripts\/with-workspace-dist-lock\.mjs "yarn build:workspace-deps && /,
      `${pkg.name} type-check refreshes workspace dependencies under the workspace dist lock`,
    );

    for (const dependencyName of workspaceDependencies) {
      assert.match(
        buildWorkspaceDepsScript,
        new RegExp(`yarn workspace ${escapeRegExp(dependencyName)} build(?=\\s|$|:|")`),
        `${pkg.name} builds ${dependencyName} before compiling`,
      );
    }
  }
});

test("root workspace test scripts lock shared dist and include non-contract suites by default", () => {
  const manifest = readJson("package.json");

  assert.equal(manifest.scripts?.test, "yarn test:ts");
  assert.match(
    manifest.scripts?.["build:workspace-deps"] ?? "",
    /^node scripts\/with-workspace-dist-lock\.mjs "yarn workspace @rateloop\/node-utils build && /,
  );
  assert.match(
    manifest.scripts?.["test:ts"] ?? "",
    /^node scripts\/with-workspace-dist-lock\.mjs "yarn build:workspace-deps && /,
  );
  assert.match(manifest.scripts?.["test:ts"] ?? "", /yarn next:test/);
  assert.match(manifest.scripts?.["test:ts"] ?? "", /yarn workspace @rateloop\/keeper test/);
  assert.match(manifest.scripts?.["test:ts"] ?? "", /yarn promo-video:check-types/);
  assert.match(manifest.scripts?.["test:all"] ?? "", /yarn foundry:test && yarn test:ts/);
});

test("Next.js type generation pins the local target network for E2E production guards", () => {
  const manifest = readJson("packages/nextjs/package.json");
  const checkTypesScript = manifest.scripts?.["check-types"] ?? "";

  assert.match(checkTypesScript, /RATELOOP_E2E_PRODUCTION_BUILD=true/);
  assert.match(checkTypesScript, /NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD=true/);
  assert.match(checkTypesScript, /NEXT_PUBLIC_TARGET_NETWORKS=31337 next typegen/);
});
