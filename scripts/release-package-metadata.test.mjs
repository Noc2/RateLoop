import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateNpmReleaseVersions } from "./validate-npm-release.mjs";

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
    internalDependencies: {},
  },
  {
    name: "@rateloop/agents",
    path: "packages/agents/package.json",
    internalDependencies: { "@rateloop/sdk": "workspace:*" },
  },
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("tokenless npm packages expose valid independent release metadata", () => {
  const versions = [];
  for (const pkg of releasePackages) {
    const manifest = readJson(pkg.path);
    assert.equal(manifest.name, pkg.name);
    assert.notEqual(manifest.private, true);
    assert.equal(manifest.license, "MIT");
    assert.equal(manifest.publishConfig?.access, "public");
    assert.equal(manifest.publishConfig?.provenance, true);
    assert.equal(manifest.repository?.directory, pkg.path.replace(/\/package\.json$/, ""));
    assert.match(manifest.homepage ?? "", /\/tree\/main\/packages\//);
    assert.ok(manifest.files?.includes("dist"));
    assert.ok(manifest.exports?.["."]);
    assert.ok(manifest.scripts?.build);
    assert.ok(manifest.scripts?.prepack);
    for (const [name, range] of Object.entries(pkg.internalDependencies)) {
      assert.equal(manifest.dependencies?.[name], range);
    }
    versions.push({ name: manifest.name, version: manifest.version });
  }

  assert.deepEqual(validateNpmReleaseVersions(versions), versions);
});

test("release validation supports independent versions and checks release tags", () => {
  const packages = [
    { name: "@rateloop/sdk", version: "0.1.0" },
    { name: "@rateloop/agents", version: "0.2.0" },
  ];
  assert.deepEqual(validateNpmReleaseVersions(packages, "v0.2.0"), packages);
  assert.throws(
    () => validateNpmReleaseVersions(packages, "v9.9.9"),
    /does not match any public package version/,
  );
  assert.throws(
    () =>
      validateNpmReleaseVersions([
        { name: "@rateloop/sdk", version: "not-semver" },
      ]),
    /valid semver/,
  );
});

test("npm workflow publishes tokenless packages in dependency order", () => {
  const workflow = readFileSync(".github/workflows/publish-npm.yaml", "utf8");
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /NPM_CONFIG_PROVENANCE:\s*"true"/);
  assert.match(workflow, /--dry-run/);
  assert.match(workflow, /validate-npm-release\.mjs/);

  const contracts = workflow.indexOf('publish_if_missing "@rateloop/contracts"');
  const nodeUtils = workflow.indexOf('publish_if_missing "@rateloop/node-utils"');
  const sdk = workflow.indexOf('publish_if_missing "@rateloop/sdk"');
  const agents = workflow.indexOf('publish_if_missing "@rateloop/agents"');
  assert.ok(contracts > -1);
  assert.ok(nodeUtils > contracts);
  assert.ok(sdk > nodeUtils);
  assert.ok(agents > sdk);
});

test("root scripts expose only surviving tokenless commands", () => {
  const scripts = readJson("package.json").scripts;
  for (const name of [
    "account",
    "foundry:test",
    "foundry:test:tooling",
    "contracts:test",
    "sdk:test",
    "agents:test",
    "keeper:test",
    "ponder:test",
    "promo-video:test",
    "next:test",
  ]) {
    assert.equal(typeof scripts[name], "string", name);
  }
  for (const removed of [
    "chain",
    "deploy",
    "dev:stack",
    "world-id:test",
    "base-mainnet:check",
    "agents:handoff",
    "agents:sandbox",
    "e2e",
  ]) {
    assert.equal(scripts[removed], undefined, removed);
  }
  assert.match(scripts["foundry:deploy:tokenless"], /foundry deploy/);
});
