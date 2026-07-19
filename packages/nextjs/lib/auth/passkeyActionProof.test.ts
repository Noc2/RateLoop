import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { consumePasskeyAddProof, issuePasskeyAddProof } from "~~/lib/auth/passkeyActionProof";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const now = new Date("2026-07-19T10:00:00.000Z");

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function identity(userId: string, email: string) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_better_auth_users
          (id,name,email,email_verified,created_at,updated_at)
          VALUES (?,'Passkey proof test',?,true,?,?)`,
    args: [userId, email, now, now],
  });
  return resolveBetterAuthPrincipal({ betterAuthUserId: userId, now });
}

test("passkey add proof is hashed, account-bound, exact-action, and one-use", async () => {
  const first = await identity("better-proof-first", "first-proof@example.test");
  await identity("better-proof-second", "second-proof@example.test");
  const issued = await issuePasskeyAddProof({
    authenticationMethod: "passkey",
    betterAuthUserId: "better-proof-first",
    now,
    principalId: first.principalId,
  });
  const stored = await dbClient.execute({
    sql: `SELECT proof_hash,action,consumed_at FROM tokenless_passkey_action_proofs WHERE principal_id = ?`,
    args: [first.principalId],
  });
  assert.equal(JSON.stringify(stored.rows).includes(issued.proof), false);
  assert.equal(stored.rows[0]?.action, "passkey_add");
  assert.equal(stored.rows[0]?.consumed_at, null);

  await assert.rejects(
    () => consumePasskeyAddProof({ betterAuthUserId: "better-proof-second", now, proof: issued.proof }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "passkey_action_proof_required",
  );
  assert.deepEqual(await consumePasskeyAddProof({ betterAuthUserId: "better-proof-first", now, proof: issued.proof }), {
    principalId: first.principalId,
  });
  await assert.rejects(
    () => consumePasskeyAddProof({ betterAuthUserId: "better-proof-first", now, proof: issued.proof }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "passkey_action_proof_required",
  );
});

test("passkey add proof issuance replaces prior active and consumed grants", async () => {
  const resolved = await identity("better-passkey-cleanup", "passkey-cleanup@example.test");
  const first = await issuePasskeyAddProof({
    betterAuthUserId: "better-passkey-cleanup",
    now,
    principalId: resolved.principalId,
  });
  const secondNow = new Date(now.getTime() + 1_000);
  const second = await issuePasskeyAddProof({
    betterAuthUserId: "better-passkey-cleanup",
    now: secondNow,
    principalId: resolved.principalId,
  });
  assert.notEqual(second.proof, first.proof);
  await assert.rejects(
    () => consumePasskeyAddProof({ betterAuthUserId: "better-passkey-cleanup", now, proof: first.proof }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "passkey_action_proof_required",
  );
  await consumePasskeyAddProof({ betterAuthUserId: "better-passkey-cleanup", now: secondNow, proof: second.proof });

  const third = await issuePasskeyAddProof({
    betterAuthUserId: "better-passkey-cleanup",
    now: new Date(now.getTime() + 2_000),
    principalId: resolved.principalId,
  });
  const stored = await dbClient.execute({
    sql: `SELECT proof_hash,consumed_at FROM tokenless_passkey_action_proofs WHERE principal_id = ?`,
    args: [resolved.principalId],
  });
  assert.deepEqual(stored.rows, [
    { consumed_at: null, proof_hash: `sha256:${createHash("sha256").update(third.proof).digest("hex")}` },
  ]);
  const proofAudits = await dbClient.execute({
    sql: `SELECT action FROM tokenless_security_audit_events
          WHERE scope_kind = 'identity' AND scope_id = ? ORDER BY sequence`,
    args: [resolved.principalId],
  });
  assert.deepEqual(proofAudits.rows, [{ action: "account.passkey_add_authorization_consumed" }]);
});
