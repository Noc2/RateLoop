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

async function verifiedFixture() {
  const digest = await manifestDigest();
  const keys = generateKeyPairSync("ed25519");
  const env = {
    TOKENLESS_SANDBOX_MODE: "false",
    TOKENLESS_DATA_PLANE_MODE: "verified-eu",
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
    env[resource.regionEnv] = resource.region;
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

test("the checked deployment controls are valid in explicit sandbox mode", async () => {
  assert.deepEqual(await validateTokenlessEuDeployment({ sandbox: true }), []);
});

test("verified production requires EU email dispatch while disclosing the processor transfer", async () => {
  const env = await verifiedFixture();
  env.TOKENLESS_EMAIL_DELIVERY_REGION = "us-east-1";
  assert.match(
    (await validateTokenlessEuDeployment({ env, ...staticConfigs() })).join("\n"),
    /TOKENLESS_EMAIL_DELIVERY_REGION must be eu-west-1/,
  );
  assert.equal(tokenlessEuDeploymentManifest.externalProcessors.email.accountDataRegion, "us");
  assert.equal(tokenlessEuDeploymentManifest.externalProcessors.email.transferRequired, true);
});

test("verified production requires the exact regional resource bundle and signed manifest", async () => {
  const env = await verifiedFixture();
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
    /TOKENLESS_EU_BLOB_STORE_ID must identify the verified EU objectStorage resource/,
  );
  assert.match(output, /SIGNATURE must verify/i);
});

test("static configuration rejects unpinned or mixed compute regions", async () => {
  const errors = await validateTokenlessEuDeployment({
    sandbox: true,
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
  delete manifest.resources.kms;
  delete manifest.externalProcessors.email;
  manifest.publicChainExceptions[0].customerContentAllowed = true;
  const output = (
    await validateTokenlessEuDeployment({
      sandbox: true,
      manifest,
      ...staticConfigs(),
    })
  ).join("\n");
  assert.match(output, /kms region must be eu/);
  assert.match(output, /inventory the email processor/);
  assert.match(output, /exact Base Sepolia public-chain exception/);
});
