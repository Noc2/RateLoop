import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  manifestDigest,
  tokenlessEuDeploymentManifest,
  validateTokenlessEuDeployment,
} from "./validate-tokenless-eu-deployment.mjs";

function staticConfigs() {
  return {
    vercelConfig: { regions: ["fra1"] },
    railwayConfigs: [
      '[deploy.multiRegionConfig]\n"europe-west4-drams3a" = { numReplicas = 1 }\n',
      '[deploy.multiRegionConfig]\n"europe-west4-drams3a" = { numReplicas = 1 }\n',
    ],
  };
}

async function processingRegionFixture() {
  const digest = await manifestDigest();
  const keys = generateKeyPairSync("ed25519");
  const env = {
    TOKENLESS_DATA_PLANE_MODE: "eu-processing-region",
    TOKENLESS_HOME_REGION: "eu",
    TOKENLESS_EU_MANIFEST_SHA256: digest,
    TOKENLESS_EU_MANIFEST_SIGNING_PUBLIC_KEY: keys.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64url"),
    TOKENLESS_EU_MANIFEST_SIGNATURE: sign(
      null,
      Buffer.from(digest, "hex"),
      keys.privateKey,
    ).toString("base64url"),
  };
  for (const [name, resource] of Object.entries(
    tokenlessEuDeploymentManifest.resources,
  )) {
    env[resource.resourceIdEnv] =
      resource.expectedResourceId ?? `eu-${name}-resource`;
    if (resource.regionEnv) env[resource.regionEnv] = resource.region;
    if (resource.accessEnv) env[resource.accessEnv] = resource.expectedAccess;
    if (resource.providerEnv)
      env[resource.providerEnv] = resource.allowedProviders[0];
  }
  for (const [name, processor] of Object.entries(
    tokenlessEuDeploymentManifest.externalProcessors,
  )) {
    env[processor.evidenceEnv] = `approved-${name}-evidence`;
    if (processor.deliveryRegionEnv)
      env[processor.deliveryRegionEnv] = processor.deliveryRegion;
  }
  return env;
}

test("the signed processing-region configuration is valid within its disclosed boundary", async () => {
  assert.deepEqual(
    await validateTokenlessEuDeployment({
      env: await processingRegionFixture(),
      ...staticConfigs(),
    }),
    [],
  );
});

test("processing-region configuration requires EU email dispatch while disclosing the processor transfer", async () => {
  const env = await processingRegionFixture();
  env.TOKENLESS_EMAIL_DELIVERY_REGION = "us-east-1";
  assert.match(
    (await validateTokenlessEuDeployment({ env, ...staticConfigs() })).join(
      "\n",
    ),
    /TOKENLESS_EMAIL_DELIVERY_REGION must be eu-west-1/,
  );
  assert.equal(
    tokenlessEuDeploymentManifest.externalProcessors.email.accountDataRegion,
    "us",
  );
  assert.equal(
    tokenlessEuDeploymentManifest.externalProcessors.email.transferRequired,
    true,
  );
});

test("processing-region configuration requires the exact resource bundle and signed manifest", async () => {
  const env = await processingRegionFixture();
  assert.deepEqual(
    await validateTokenlessEuDeployment({ env, ...staticConfigs() }),
    [],
  );

  env.TOKENLESS_POSTGRES_REGION = "us-east4-eqdc4a";
  env.TOKENLESS_EU_BLOB_STORE_ID = "legacy-blob";
  env.TOKENLESS_EU_MANIFEST_SIGNATURE = "invalid";
  const output = (
    await validateTokenlessEuDeployment({ env, ...staticConfigs() })
  ).join("\n");
  assert.match(
    output,
    /TOKENLESS_POSTGRES_REGION must be europe-west4-drams3a/,
  );
  assert.match(
    output,
    /TOKENLESS_EU_BLOB_STORE_ID must identify the configured objectStorage resource/,
  );
  assert.match(output, /SIGNATURE must verify/i);
});

test("static configuration rejects unpinned or mixed compute regions", async () => {
  const errors = await validateTokenlessEuDeployment({
    env: await processingRegionFixture(),
    vercelConfig: {},
    railwayConfigs: [
      '[deploy.multiRegionConfig]\n"us-east4-eqdc4a" = { numReplicas = 1 }\n',
      '[deploy.multiRegionConfig]\n"europe-west4-drams3a" = { numReplicas = 1 }\n"us-west2" = { numReplicas = 1 }\n',
    ],
  });
  assert.match(
    errors.join("\n"),
    /Vercel functions must be pinned only to fra1/,
  );
  assert.equal(
    errors.filter((error) => /Railway service/.test(error)).length,
    2,
  );
});

test("the manifest cannot omit governed resources, processors, or public-chain limits", async () => {
  const manifest = structuredClone(tokenlessEuDeploymentManifest);
  delete manifest.resources.platformSecrets;
  delete manifest.externalProcessors.email;
  manifest.publicChainExceptions[0].customerContentAllowed = true;
  const output = (
    await validateTokenlessEuDeployment({
      env: await processingRegionFixture(),
      manifest,
      ...staticConfigs(),
    })
  ).join("\n");
  assert.match(output, /inventory the platformSecrets resource/);
  assert.match(output, /inventory the email processor/);
  assert.match(output, /exact Base Sepolia public-chain exception/);
});

test("the manifest excludes control planes and backups from the region claim and inventories only used processors", () => {
  assert.equal(tokenlessEuDeploymentManifest.claimBoundary.providerStateQueried, false);
  assert.equal(tokenlessEuDeploymentManifest.claimBoundary.transferSafeguard, "standard-contractual-clauses");
  assert.match(tokenlessEuDeploymentManifest.claimBoundary.excluded.join(" "), /control-plane/);
  assert.match(tokenlessEuDeploymentManifest.claimBoundary.excluded.join(" "), /backups/);
  assert.equal(tokenlessEuDeploymentManifest.resources.supportAccess, undefined);
  assert.equal(tokenlessEuDeploymentManifest.externalProcessors.analytics, undefined);
});
