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
        TOKENLESS_KMS_KEY_RESOURCE: "projects/example/locations/us/keyRings/one",
        TOKENLESS_KMS_PROVIDER: "gcp-kms",
      } as NodeJS.ProcessEnv),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "kms_region_mismatch",
  );
  assert.deepEqual(
    validateVaultEnvironment({
      NODE_ENV: "production",
      TOKENLESS_KMS_KEY_RESOURCE: "projects/example/locations/europe-west4/keyRings/one",
      TOKENLESS_KMS_PROVIDER: "gcp-kms",
    } as NodeJS.ProcessEnv),
    {
      keyResource: "projects/example/locations/europe-west4/keyRings/one",
      mode: "managed",
      provider: "gcp-kms",
    },
  );
  assert.deepEqual(validateVaultEnvironment({ NODE_ENV: "test" } as NodeJS.ProcessEnv), { mode: "test" });
});
