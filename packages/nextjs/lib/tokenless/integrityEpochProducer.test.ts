import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient, dbPool } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { persistIntegrityEpochSnapshot } from "~~/lib/tokenless/integrityEpochPersistence";
import {
  eraseIntegrityEpochReviewerMemberships,
  integrityEpochRuntime,
  integrityObservationFromRow,
  purgeExpiredIntegrityEpochPrivateFeatures,
} from "~~/lib/tokenless/integrityEpochProducer";
import { buildIntegrityEpoch, hashIntegrityValue } from "~~/lib/tokenless/integrityEpochs";

const NOW = new Date("2026-07-26T12:00:00.000Z");

function runtimeEnv(): NodeJS.ProcessEnv {
  const signing = generateKeyPairSync("ed25519").privateKey.export({
    format: "der",
    type: "pkcs8",
  });
  return {
    NODE_ENV: "test",
    TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY: randomBytes(32).toString("base64url"),
    TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY_VERSION: "lookup-1",
    TOKENLESS_INTEGRITY_PSEUDONYM_KEY: randomBytes(32).toString("base64url"),
    TOKENLESS_INTEGRITY_PSEUDONYM_KEY_VERSION: "pseudonym-1",
    TOKENLESS_INTEGRITY_VAULT_KEY: randomBytes(32).toString("base64url"),
    TOKENLESS_INTEGRITY_VAULT_KEY_VERSION: "vault-1",
    TOKENLESS_INTEGRITY_SIGNING_PRIVATE_KEY: signing.toString("base64url"),
    TOKENLESS_INTEGRITY_PRIVATE_FEATURE_RETENTION_DAYS: "14",
  };
}

test("integrity epoch runtime requires independent private keys and bounded retention", () => {
  const env = runtimeEnv();
  const runtime = integrityEpochRuntime(env);
  assert.equal(runtime.keys.lookupKeyVersion, "lookup-1");
  assert.equal(runtime.keys.pseudonymKeyVersion, "pseudonym-1");
  assert.equal(runtime.keys.vaultKeyVersion, "vault-1");
  assert.equal(runtime.keys.signingPrivateKey.asymmetricKeyType, "ed25519");
  assert.equal(runtime.privateFeatureRetentionDays, 14);

  assert.throws(
    () => integrityEpochRuntime({ ...env, TOKENLESS_INTEGRITY_PRIVATE_FEATURE_RETENTION_DAYS: "366" }),
    /1 to 365/u,
  );
  assert.throws(
    () =>
      integrityEpochRuntime({
        ...env,
        TOKENLESS_INTEGRITY_PSEUDONYM_KEY: "",
        NEXT_PUBLIC_TOKENLESS_INTEGRITY_PSEUDONYM_KEY: "leaked",
      }),
    /must never use a NEXT_PUBLIC_/u,
  );
});

test("integrity source projection minimizes identifiers and fails closed on unique-human expiry", () => {
  const payout = "0x1111111111111111111111111111111111111111";
  const providerSubject = "hmac-sha256:provider-sensitive-reference";
  const pseudonymKey = randomBytes(32);
  const observation = integrityObservationFromRow(
    {
      rater_id: "rtr_internal_random",
      account_address: payout,
      profile_updated_at: "2026-07-26T10:00:00.000Z",
      deleted_at: null,
      scope_id: "scope_network",
      scope_status: "eligible",
      scope_valid_until: "2026-08-01T00:00:00.000Z",
      scope_updated_at: "2026-07-26T10:00:00.000Z",
      payout_account: payout,
      unique_human_assertion_id: "assert_world",
      assertion_expires_at: "2026-07-26T11:59:59.000Z",
      assurance_validity_model: "expiring_assertion",
      assertion_updated_at: "2026-07-26T10:00:00.000Z",
      provider_subject_hashes_json: JSON.stringify([providerSubject]),
    },
    { observedAt: NOW, pseudonymKey },
  );

  assert.equal(observation.eligible, false);
  assert.ok(observation.exclusionReasonCodes?.includes("unique_human_expired"));
  assert.equal(observation.behavioralRiskBps, 0);
  const persistedFeatureInput = JSON.stringify({
    sourceRecordCommitments: observation.sourceRecordCommitments,
    hardLinks: observation.hardLinks,
  });
  assert.doesNotMatch(persistedFeatureInput, new RegExp(payout, "u"));
  assert.doesNotMatch(persistedFeatureInput, new RegExp(providerSubject, "u"));
  assert.match(observation.hardLinks?.[0]?.valueCommitment ?? "", /^hmac-sha256:[0-9a-f]{64}$/u);
});

test("expired encrypted integrity features are deleted while the aggregate signed manifest remains", async () => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  try {
    const env = runtimeEnv();
    const runtime = integrityEpochRuntime(env);
    const snapshot = buildIntegrityEpoch({
      epochId: "integrity:retention-test",
      cutoffAt: "2026-07-20T00:00:00.000Z",
      sourceWindowStartedAt: "2026-07-19T00:00:00.000Z",
      privateFeaturesExpireAt: "2026-07-21T00:00:00.000Z",
      createdAt: "2026-07-20T00:00:00.000Z",
      scorerBuildHash: hashIntegrityValue({ build: "retention-test" }),
      observations: [
        {
          reviewerId: "0x1111111111111111111111111111111111111111",
          observedAt: "2026-07-20T00:00:00.000Z",
          sourceRecordCommitments: [hashIntegrityValue({ source: "test" })],
          eligible: true,
        },
      ],
      keys: runtime.keys,
    });
    await persistIntegrityEpochSnapshot(snapshot);
    assert.deepEqual(await purgeExpiredIntegrityEpochPrivateFeatures({ now: NOW }), { purged: 1 });
    const [epoch, members] = await Promise.all([
      dbClient.execute({
        sql: "SELECT manifest_hash FROM tokenless_integrity_epochs WHERE epoch_id=?",
        args: [snapshot.manifest.epochId],
      }),
      dbClient.execute({
        sql: "SELECT reviewer_lookup FROM tokenless_integrity_epoch_members WHERE epoch_id=?",
        args: [snapshot.manifest.epochId],
      }),
    ]);
    assert.equal(epoch.rowCount, 1);
    assert.equal(members.rowCount, 0);

    const live = buildIntegrityEpoch({
      epochId: "integrity:erasure-test",
      cutoffAt: "2026-07-25T00:00:00.000Z",
      sourceWindowStartedAt: "2026-07-24T00:00:00.000Z",
      privateFeaturesExpireAt: "2026-08-25T00:00:00.000Z",
      createdAt: "2026-07-25T00:00:00.000Z",
      scorerBuildHash: hashIntegrityValue({ build: "erasure-test" }),
      observations: [
        {
          reviewerId: "0x1111111111111111111111111111111111111111",
          observedAt: "2026-07-25T00:00:00.000Z",
          sourceRecordCommitments: [hashIntegrityValue({ source: "live-test" })],
          eligible: true,
        },
      ],
      keys: runtime.keys,
    });
    await persistIntegrityEpochSnapshot(live);
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      assert.deepEqual(
        await eraseIntegrityEpochReviewerMemberships(client, {
          reviewerId: "0x1111111111111111111111111111111111111111",
          env,
        }),
        { erased: 1, remaining: 0 },
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    __setDatabaseResourcesForTests(null);
  }
});
