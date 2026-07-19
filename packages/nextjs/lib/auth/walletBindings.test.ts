import assert from "node:assert/strict";
import { type JsonWebKey, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import {
  __setThirdwebWalletJwtConfigurationForTests,
  issueThirdwebWalletJwt,
  thirdwebWalletJwks,
} from "~~/lib/auth/thirdwebWalletJwt";
import {
  __setWalletSignatureVerifierForTests,
  completeWalletBinding,
  createWalletBindingChallenge,
  listWalletBindings,
  revokeWalletBinding,
} from "~~/lib/auth/walletBindings";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";

const principalId = "rlp_wallet_binding_test_principal";
const address = "0x1111111111111111111111111111111111111111";
const rotatedAddress = "0x2222222222222222222222222222222222222222";
const otherPrincipalId = "rlp_wallet_binding_other_principal";
const now = new Date("2026-07-15T10:00:00.000Z");

beforeEach(async () => {
  process.env.APP_URL = "https://rateloop-tokenless.vercel.app";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  await dbClient.execute({
    sql: `INSERT INTO tokenless_principals (principal_id, status, created_at, updated_at)
          VALUES (?, 'active', ?, ?)`,
    args: [principalId, now, now],
  });
  const { privateKey } = generateKeyPairSync("ed25519");
  __setThirdwebWalletJwtConfigurationForTests({
    audience: "thirdweb-project-test",
    issuer: "https://rateloop-tokenless.vercel.app",
    keyId: "wallet-key-v1",
    privateJwk: privateKey.export({ format: "jwk" }) as JsonWebKey,
  });
  __setWalletSignatureVerifierForTests(async () => true);
});

afterEach(() => {
  delete process.env.APP_URL;
  __setWalletSignatureVerifierForTests(null);
  __setThirdwebWalletJwtConfigurationForTests(null);
  __setDatabaseResourcesForTests(null);
});

test("thirdweb wallet JWTs are short-lived, audience-bound, PII-free, and publish an Ed25519 JWKS", async () => {
  const issued = await issueThirdwebWalletJwt(principalId, now);
  const payload = JSON.parse(Buffer.from(issued.jwt.split(".")[1]!, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
  assert.equal(payload.sub, principalId);
  assert.equal(payload.aud, "thirdweb-project-test");
  assert.equal(Number(payload.exp) - Number(payload.iat), 300);
  assert.equal("email" in payload, false);
  assert.equal("name" in payload, false);
  assert.deepEqual(
    thirdwebWalletJwks().keys.map(key => ({ alg: key.alg, kid: key.kid, use: key.use })),
    [{ alg: "EdDSA", kid: "wallet-key-v1", use: "sig" }],
  );
});

test("wallet proof is purpose-bound, single-use, revocable, and independent of account authorization", async () => {
  const issued = await issueThirdwebWalletJwt(principalId, now);
  const challenge = await createWalletBindingChallenge({
    address,
    principalId,
    purpose: "payout",
    source: "thirdweb",
    thirdwebJti: issued.jti,
    now,
  });
  assert.match(challenge.message, new RegExp(`Principal ID: ${principalId}`));
  assert.match(challenge.message, /Purpose: payout/);
  assert.match(challenge.message, /Chain ID: 84532/);
  assert.match(challenge.message, /does not authorize general RateLoop account access/);

  const binding = await completeWalletBinding({
    challengeId: challenge.challengeId,
    message: challenge.message,
    principalId,
    signature: "0x11",
    now: new Date(now.getTime() + 1_000),
  });
  assert.equal(binding.purpose, "payout");
  assert.equal((await listWalletBindings(principalId))[0]?.walletAddress, address);
  await assert.rejects(
    () =>
      completeWalletBinding({
        challengeId: challenge.challengeId,
        message: challenge.message,
        principalId,
        signature: "0x11",
        now: new Date(now.getTime() + 2_000),
      }),
    /expired|already used|does not match/i,
  );
  await revokeWalletBinding({ bindingId: binding.bindingId, principalId, now: new Date(now.getTime() + 3_000) });
  assert.deepEqual(await listWalletBindings(principalId), []);

  const audit = await dbClient.execute({
    sql: `SELECT action, actor_reference, target_id, metadata_json
          FROM tokenless_security_audit_events
          WHERE scope_kind = 'identity' AND scope_id = ?
          ORDER BY sequence ASC`,
    args: [principalId],
  });
  assert.deepEqual(
    audit.rows.map(row => row.action),
    [
      "wallet.thirdweb_exchange_issued",
      "wallet.binding_challenge_created",
      "wallet.binding_created",
      "wallet.binding_revoked",
    ],
  );
  const serializedAudit = JSON.stringify(audit.rows);
  assert.equal(serializedAudit.includes(address), false);
  assert.equal(serializedAudit.includes("0x11"), false);
  assert.equal(serializedAudit.includes(issued.jwt), false);
  assert.equal(serializedAudit.includes(issued.jti), false);
});

test("a thirdweb JWT exchange cannot be replayed for a second wallet challenge", async () => {
  const issued = await issueThirdwebWalletJwt(principalId, now);
  await createWalletBindingChallenge({
    address,
    principalId,
    purpose: "funding",
    source: "thirdweb",
    thirdwebJti: issued.jti,
    now,
  });
  await assert.rejects(
    () =>
      createWalletBindingChallenge({
        address,
        principalId,
        purpose: "recovery",
        source: "thirdweb",
        thirdwebJti: issued.jti,
        now: new Date(now.getTime() + 1_000),
      }),
    /already used|expired/i,
  );
});

test("payout rotation preserves the rater while changing only future payout state and rejects cross-principal relink", async () => {
  const first = await createWalletBindingChallenge({
    address,
    principalId,
    purpose: "payout",
    source: "self_custodial",
    now,
  });
  await completeWalletBinding({
    challengeId: first.challengeId,
    message: first.message,
    principalId,
    signature: "0x11",
    now: new Date(now.getTime() + 1_000),
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_rater_profiles
          (rater_id, principal_id, account_address, nullifier_seed_ciphertext,
           nullifier_key_version, nullifier_key_domain, created_at, updated_at)
          VALUES ('rater_rotation', ?, ?, 'seed-ciphertext', 'vote-v1', 'vote_mapping', ?, ?)`,
    args: [principalId, address, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_payout_eligibility
          (rater_id, payout_account, payout_ownership_method, payout_verified_at,
           payout_expires_at, eligibility_status, blocked_reason, created_at, updated_at)
          VALUES ('rater_rotation', ?, 'siwe_base_account_session', ?, NULL, 'ready', NULL, ?, ?)`,
    args: [address, now, now, now],
  });

  const rotation = await createWalletBindingChallenge({
    address: rotatedAddress,
    principalId,
    purpose: "payout",
    source: "self_custodial",
    now: new Date(now.getTime() + 2_000),
  });
  await completeWalletBinding({
    challengeId: rotation.challengeId,
    message: rotation.message,
    principalId,
    signature: "0x22",
    now: new Date(now.getTime() + 3_000),
  });

  const rater = await dbClient.execute({
    sql: `SELECT rater_id, principal_id, account_address FROM tokenless_rater_profiles
          WHERE principal_id = ?`,
    args: [principalId],
  });
  assert.deepEqual(rater.rows[0], {
    rater_id: "rater_rotation",
    principal_id: principalId,
    account_address: rotatedAddress,
  });
  const payout = await dbClient.execute({
    sql: `SELECT payout_account, eligibility_status FROM tokenless_payout_eligibility
          WHERE rater_id = 'rater_rotation'`,
  });
  assert.deepEqual(payout.rows[0], { payout_account: rotatedAddress, eligibility_status: "ready" });
  const history = await dbClient.execute({
    sql: `SELECT wallet_address, principal_id FROM tokenless_payout_wallet_ownership
          WHERE principal_id = ? ORDER BY first_bound_at`,
    args: [principalId],
  });
  assert.deepEqual(
    history.rows.map(row => row.wallet_address),
    [address, rotatedAddress],
  );

  await dbClient.execute({
    sql: `INSERT INTO tokenless_principals (principal_id, status, created_at, updated_at)
          VALUES (?, 'active', ?, ?)`,
    args: [otherPrincipalId, now, now],
  });
  const relink = await createWalletBindingChallenge({
    address,
    principalId: otherPrincipalId,
    purpose: "payout",
    source: "self_custodial",
    now: new Date(now.getTime() + 4_000),
  });
  await assert.rejects(
    completeWalletBinding({
      challengeId: relink.challengeId,
      message: relink.message,
      principalId: otherPrincipalId,
      signature: "0x33",
      now: new Date(now.getTime() + 5_000),
    }),
    /belongs to another RateLoop account/u,
  );
});
