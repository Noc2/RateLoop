import { hashSignal } from "@worldcoin/idkit-core";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import {
  __setWorldIdAssuranceOverridesForTests,
  __worldIdAssuranceTestUtils,
  createWorldIdAssuranceContext,
  isWorldIdAssuranceEnabled,
  verifyWorldIdAssurance,
} from "~~/lib/tokenless/worldIdAssurance";

const NOW = new Date("2026-07-13T12:00:00.000Z");
const ACCOUNT = "0x1111111111111111111111111111111111111111";
const ACCOUNT_TWO = "0x2222222222222222222222222222222222222222";
const APP_ID = "app_ratelooptest1" as const;
const RP_ID = "rp_ratelooptest1" as const;
const ACTION = "rateloop-proof-of-human";
const NULLIFIER_MIXED = `0x${"aB".repeat(32)}`;
const NULLIFIER_LOWER = NULLIFIER_MIXED.toLowerCase();
const SUBJECT_KEY_V1 = Buffer.alloc(32, 17);
const SUBJECT_KEY_V2 = Buffer.alloc(32, 19);
const EVIDENCE_KEY = Buffer.alloc(32, 23);
const KEY_VERSION = "world-test-v1";
let nonceCounter = 0;

function worldConfig(overrides: Record<string, unknown> = {}) {
  return {
    appId: APP_ID,
    rpId: RP_ID,
    signingKey: `0x${"56".repeat(32)}`,
    actionVersion: "world-poh-v1",
    action: ACTION,
    environment: "staging" as const,
    subjectHmacKeyVersion: "hmac-v1",
    subjectHmacKeys: new Map([["hmac-v1", SUBJECT_KEY_V1]]),
    evidenceKeyVersion: KEY_VERSION,
    evidenceKeys: new Map([[KEY_VERSION, EVIDENCE_KEY]]),
    credentialMinTtlSeconds: 86_400,
    ...overrides,
  };
}

async function insertRater(accountAddress = ACCOUNT, raterId = "rater_world_1") {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_rater_profiles
          (rater_id, account_address, nullifier_seed_ciphertext,
           nullifier_key_version, nullifier_key_domain, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [raterId, accountAddress.toLowerCase(), "encrypted-seed", "v1", "vote_mapping", NOW, NOW],
  });
}

function install(config = worldConfig()) {
  __setWorldIdAssuranceOverridesForTests({
    config,
    signer: () => {
      nonceCounter += 1;
      return {
        sig: `0x${"ab".repeat(65)}`,
        nonce: `0x${nonceCounter.toString(16).padStart(64, "0")}`,
        createdAt: Math.floor(NOW.getTime() / 1000) + nonceCounter,
        expiresAt: Math.floor(NOW.getTime() / 1000) + nonceCounter + 300,
      };
    },
  });
}

function initialBody(context: Awaited<ReturnType<typeof createWorldIdAssuranceContext>>, expiresAtMin?: number) {
  return JSON.stringify({
    protocol_version: "4.0",
    nonce: context.rpContext.nonce,
    action: ACTION,
    responses: [
      {
        identifier: "proof_of_human",
        signal_hash: hashSignal(context.signal).toUpperCase().replace("0X", "0x"),
        proof: ["0x1", "0x2", "0x3", "0x4", "0x5"],
        nullifier: NULLIFIER_MIXED,
        issuer_schema_id: 1,
        expires_at_min: expiresAtMin ?? context.credentialExpiresAtMin,
      },
    ],
    user_presence_completed: false,
    environment: "staging",
  });
}

function upstream() {
  return new Response(
    JSON.stringify({
      success: true,
      results: [
        {
          identifier: "proof_of_human",
          success: true,
          nullifier: NULLIFIER_LOWER,
        },
      ],
      action: ACTION,
      nullifier: NULLIFIER_LOWER,
      environment: "staging",
      created_at: NOW.toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

async function completeInitial() {
  const context = await createWorldIdAssuranceContext({ accountAddress: ACCOUNT, now: NOW });
  __setWorldIdAssuranceOverridesForTests({ fetch: (async () => upstream()) as typeof fetch });
  const result = await verifyWorldIdAssurance({ accountAddress: ACCOUNT, rawBody: initialBody(context), now: NOW });
  return { context, result };
}

beforeEach(() => {
  nonceCounter = 0;
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  install();
});

afterEach(() => {
  __setWorldIdAssuranceOverridesForTests({ config: null, signer: null, fetch: null });
  __setDatabaseResourcesForTests(null);
});

test("creates a bounded v4-only uniqueness context and supersedes the previous pending context", async () => {
  await insertRater();
  const first = await createWorldIdAssuranceContext({ accountAddress: ACCOUNT, now: NOW });
  const second = await createWorldIdAssuranceContext({ accountAddress: ACCOUNT, now: NOW });

  assert.equal(first.mode, "initial_unique");
  assert.equal(first.signal, first.requestId);
  assert.equal(first.credentialExpiresAtMin, Math.floor(NOW.getTime() / 1000) + 86_400);
  assert.equal(second.mode, "initial_unique");
  const rows = await dbClient.execute(`SELECT status FROM tokenless_world_id_requests ORDER BY created_at, request_id`);
  assert.deepEqual(rows.rows.map(row => row.status).sort(), ["pending", "superseded"]);
});

test("requires a pre-existing rater and rate-limits normal context creation", async () => {
  await assert.rejects(
    createWorldIdAssuranceContext({ accountAddress: ACCOUNT, now: NOW }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "rater_profile_required",
  );
  await insertRater();
  for (let index = 0; index < 5; index += 1) {
    await createWorldIdAssuranceContext({ accountAddress: ACCOUNT, now: NOW });
  }
  const count = await dbClient.execute(`SELECT COUNT(*) AS count FROM tokenless_world_id_requests`);
  assert.equal(Number(count.rows[0]?.count), 5);
  await assert.rejects(
    createWorldIdAssuranceContext({ accountAddress: ACCOUNT, now: NOW }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "world_id_rate_limited",
  );
});

test("canonicalizes mixed-case nullifiers before upstream comparison and HMAC persistence", async () => {
  await insertRater();
  const context = await createWorldIdAssuranceContext({ accountAddress: ACCOUNT, now: NOW });
  const rawBody = initialBody(context);
  let forwarded: BodyInit | null | undefined;
  __setWorldIdAssuranceOverridesForTests({
    fetch: (async (_url, init) => {
      forwarded = init?.body;
      return upstream();
    }) as typeof fetch,
  });
  const result = await verifyWorldIdAssurance({ accountAddress: ACCOUNT, rawBody, now: NOW });

  assert.equal(forwarded, rawBody);
  assert.equal(result.mode, "initial_unique");
  assert.equal(result.continuity, "durable_account_enrollment");
  assert.equal(result.validityModel, "durable_enrollment");
  assert.equal(result.credentialExpiresAt.toISOString(), new Date(context.credentialExpiresAtMin * 1000).toISOString());
  const stored = await dbClient.execute(
    `SELECT b.subject_reference_hash, b.subject_reference_key_version,
            a.provider_assertion_id_hash, a.capabilities_json, a.assurance_validity_model
     FROM tokenless_provider_subject_bindings b
     JOIN tokenless_assurance_assertions a ON a.binding_id = b.binding_id
     WHERE b.provider_id = 'world:poh'`,
  );
  assert.match(String(stored.rows[0]?.subject_reference_hash), /^hmac-sha256:hmac-v1:[0-9a-f]{64}$/u);
  assert.equal(stored.rows[0]?.subject_reference_key_version, "hmac-v1");
  assert.equal(stored.rows[0]?.capabilities_json, '["unique_human"]');
  assert.equal(stored.rows[0]?.assurance_validity_model, "durable_enrollment");
  assert.equal(__worldIdAssuranceTestUtils.canonicalField(NULLIFIER_MIXED), BigInt(NULLIFIER_LOWER).toString(10));
});

test("binds expires_at_min into the request and rejects a weaker credential before upstream verification", async () => {
  await insertRater();
  const context = await createWorldIdAssuranceContext({ accountAddress: ACCOUNT, now: NOW });
  let called = false;
  __setWorldIdAssuranceOverridesForTests({
    fetch: (async () => {
      called = true;
      return upstream();
    }) as typeof fetch,
  });
  await assert.rejects(
    verifyWorldIdAssurance({
      accountAddress: ACCOUNT,
      rawBody: initialBody(context, context.credentialExpiresAtMin - 1),
      now: NOW,
    }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_world_id_result",
  );
  assert.equal(called, false);
});

test("keeps one-time enrollment durable after the presented credential expires", async () => {
  await insertRater();
  const completed = await completeInitial();
  const afterExpiry = new Date(NOW.getTime() + 86_400_001);
  const assertion = await dbClient.execute(
    `SELECT assurance_validity_model, evidence_expires_at
     FROM tokenless_assurance_assertions WHERE provider_id = 'world:poh'`,
  );
  assert.equal(assertion.rows[0]?.assurance_validity_model, "durable_enrollment");
  assert.ok(new Date(String(assertion.rows[0]?.evidence_expires_at)) < afterExpiry);
  assert.equal(completed.result.assuranceRefreshed, false);
  await assert.rejects(
    createWorldIdAssuranceContext({ accountAddress: ACCOUNT, now: afterExpiry }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "world_id_already_enrolled",
  );
});

test("freezes the action and requires every registered HMAC version to remain unchanged", async () => {
  await insertRater();
  await insertRater(ACCOUNT_TWO, "rater_world_2");
  await completeInitial();
  install(
    worldConfig({
      subjectHmacKeyVersion: "hmac-v2",
      subjectHmacKeys: new Map([
        ["hmac-v1", SUBJECT_KEY_V1],
        ["hmac-v2", SUBJECT_KEY_V2],
      ]),
    }),
  );
  await createWorldIdAssuranceContext({ accountAddress: ACCOUNT_TWO, now: NOW });

  install(worldConfig({ subjectHmacKeyVersion: "hmac-v2", subjectHmacKeys: new Map([["hmac-v2", SUBJECT_KEY_V2]]) }));
  await assert.rejects(
    createWorldIdAssuranceContext({ accountAddress: ACCOUNT_TWO, now: NOW }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "world_id_hmac_key_missing",
  );

  install(worldConfig({ action: "rotated-action" }));
  await assert.rejects(
    createWorldIdAssuranceContext({ accountAddress: ACCOUNT_TWO, now: NOW }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "world_id_action_mismatch",
  );
});

test("feature flag and private-key configuration fail closed", () => {
  assert.equal(isWorldIdAssuranceEnabled({}), false);
  assert.equal(isWorldIdAssuranceEnabled({ TOKENLESS_NETWORK_PANELS_ENABLED: "true" }), true);
  assert.throws(
    () => isWorldIdAssuranceEnabled({ TOKENLESS_NETWORK_PANELS_ENABLED: "yes" }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "world_id_misconfigured",
  );
  __setWorldIdAssuranceOverridesForTests({ config: null });
  assert.throws(
    () =>
      __worldIdAssuranceTestUtils.loadConfig({
        TOKENLESS_NETWORK_PANELS_ENABLED: "true",
        NEXT_PUBLIC_WORLD_ID_RP_SIGNING_KEY: "leaked",
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "world_id_misconfigured",
  );
});
