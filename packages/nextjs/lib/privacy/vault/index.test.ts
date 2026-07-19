import tokenlessEuDeploymentManifest from "../../../../../config/tokenless-eu-deployment.json";
import { EnvelopeVault, createLocalKeyWrappingProvider, validateVaultEnvironment } from "./index";
import assert from "node:assert/strict";
import test from "node:test";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const context = {
  homeRegion: "eu" as const,
  purpose: "paid_eligibility",
  recordId: "eligibility_123",
  tenantId: "workspace_123",
};

test("envelope vault uses per-record keys, tenant/region AAD, and supports key rewrap", async () => {
  const firstProvider = createLocalKeyWrappingProvider({ key: Buffer.alloc(32, 1), keyVersion: "local-v1" });
  const secondProvider = createLocalKeyWrappingProvider({ key: Buffer.alloc(32, 2), keyVersion: "local-v2" });
  const firstVault = new EnvelopeVault(firstProvider);
  const envelope = await firstVault.seal(new TextEncoder().encode("sensitive record"), context);

  assert.doesNotMatch(envelope.ciphertext, /sensitive record/);
  assert.equal(new TextDecoder().decode(await firstVault.open(envelope, context)), "sensitive record");
  await assert.rejects(
    () => firstVault.open(envelope, { ...context, tenantId: "other_workspace" }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "vault_context_mismatch",
  );

  const rotated = await firstVault.rewrap(envelope, secondProvider);
  assert.equal(rotated.ciphertext, envelope.ciphertext);
  assert.notEqual(rotated.wrappedDataKey.ciphertext, envelope.wrappedDataKey.ciphertext);
  assert.equal(rotated.wrappedDataKey.keyVersion, "local-v2");
  assert.equal(
    new TextDecoder().decode(await new EnvelopeVault(secondProvider).open(rotated, context)),
    "sensitive record",
  );
});

test("vault environment rejects public keys, local production keys, missing KMS, and non-EU resources", () => {
  assert.throws(
    () => validateVaultEnvironment({ NEXT_PUBLIC_TOKENLESS_KMS_KEY_RESOURCE: "leak" } as unknown as NodeJS.ProcessEnv),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "public_vault_key_forbidden",
  );
  assert.throws(
    () => validateVaultEnvironment({ NEXT_PUBLIC_TOKENLESS_PSEUDONYM_KEY: "leak" } as unknown as NodeJS.ProcessEnv),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "public_vault_key_forbidden",
  );
  assert.throws(
    () =>
      validateVaultEnvironment({
        NODE_ENV: "production",
        TOKENLESS_ARTIFACT_MASTER_KEY: "local",
      } as NodeJS.ProcessEnv),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "local_production_vault_forbidden",
  );
  assert.throws(
    () => validateVaultEnvironment({ NODE_ENV: "production" } as NodeJS.ProcessEnv),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "managed_kms_required",
  );
  assert.throws(
    () =>
      validateVaultEnvironment({
        NODE_ENV: "production",
        TOKENLESS_KMS_KEY_RESOURCE: "projects/eu-tenant/locations/us/keyRings/one",
        TOKENLESS_KMS_PROVIDER: "gcp-kms",
        TOKENLESS_KMS_REGION: "us",
      } as NodeJS.ProcessEnv),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "kms_region_mismatch",
  );
  assert.throws(
    () =>
      validateVaultEnvironment({
        NODE_ENV: "production",
        TOKENLESS_KMS_KEY_RESOURCE: "projects/example/locations/europe-west4/keyRings/one",
        TOKENLESS_KMS_PROVIDER: "local",
        TOKENLESS_KMS_REGION: "eu",
      } as NodeJS.ProcessEnv),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_managed_kms",
  );
  assert.deepEqual(
    validateVaultEnvironment({
      NODE_ENV: "production",
      TOKENLESS_KMS_KEY_RESOURCE: "projects/example/locations/europe-west4/keyRings/one",
      TOKENLESS_KMS_PROVIDER: "gcp-kms",
      TOKENLESS_KMS_REGION: "eu",
    } as NodeJS.ProcessEnv),
    {
      keyResource: "projects/example/locations/europe-west4/keyRings/one",
      mode: "managed",
      provider: "gcp-kms",
    },
  );
  assert.deepEqual(validateVaultEnvironment({ NODE_ENV: "test" } as NodeJS.ProcessEnv), { mode: "test" });
});

test("vault provider and region checks match the signed EU manifest inventory", () => {
  const kms = tokenlessEuDeploymentManifest.resources.kms;
  const keyResource = "projects/rateloop-tokenless/locations/europe-west4/keyRings/tokenless";
  for (const provider of kms.allowedProviders) {
    assert.deepEqual(
      validateVaultEnvironment({
        NODE_ENV: "production",
        [kms.providerEnv]: provider,
        [kms.regionEnv]: kms.region,
        [kms.resourceIdEnv]: keyResource,
      } as NodeJS.ProcessEnv),
      { keyResource, mode: "managed", provider },
    );
  }
  assert.throws(
    () =>
      validateVaultEnvironment({
        NODE_ENV: "production",
        [kms.providerEnv]: kms.allowedProviders[0],
        [kms.regionEnv]: "us",
        [kms.resourceIdEnv]: "projects/eu-tenant/locations/us/keyRings/tokenless",
      } as NodeJS.ProcessEnv),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "kms_region_mismatch",
  );
});
