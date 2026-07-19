import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import {
  __recentAccountActionProofInternals,
  consumeAccountDeletionProof,
  issueAccountDeletionProof,
} from "~~/lib/auth/recentAccountActionProof";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const now = new Date("2026-07-19T10:00:00.000Z");

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function identity(id: string, email: string) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_better_auth_users
          (id, name, email, email_verified, created_at, updated_at)
          VALUES (?, 'Recent auth test', ?, true, ?, ?)`,
    args: [id, email, now, now],
  });
  return resolveBetterAuthPrincipal({ betterAuthUserId: id, now });
}

test("account deletion proofs are action-bound, short-lived, hashed, and one-use", async () => {
  const resolved = await identity("better-recent", "recent@example.test");
  const issued = await issueAccountDeletionProof({
    authenticatedAt: new Date(now.getTime() - 1_000),
    authenticationMethod: "passkey",
    betterAuthUserId: "better-recent",
    now,
    principalId: resolved.principalId,
  });
  assert.match(issued.proof, /^rap_[A-Za-z0-9_-]{43}$/);
  assert.equal(issued.expiresAt.getTime() - now.getTime(), __recentAccountActionProofInternals.PROOF_TTL_MS);

  const stored = await dbClient.execute({
    sql: `SELECT proof_hash, action, consumed_at FROM tokenless_recent_account_action_proofs
          WHERE principal_id = ?`,
    args: [resolved.principalId],
  });
  assert.deepEqual(stored.rows, [
    {
      action: "account_deletion",
      consumed_at: null,
      proof_hash: __recentAccountActionProofInternals.proofHash(issued.proof),
    },
  ]);
  assert.equal(JSON.stringify(stored.rows).includes(issued.proof), false);

  assert.deepEqual(
    await consumeAccountDeletionProof({
      now: new Date(now.getTime() + 1_000),
      principalId: resolved.principalId,
      proof: issued.proof,
    }),
    { betterAuthUserId: "better-recent" },
  );
  await assert.rejects(
    () =>
      consumeAccountDeletionProof({
        now: new Date(now.getTime() + 2_000),
        principalId: resolved.principalId,
        proof: issued.proof,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "recent_authentication_required",
  );
});

test("account deletion proof issuance rejects stale authentication and a different bound principal", async () => {
  const first = await identity("better-first", "first@example.test");
  const second = await identity("better-second", "second@example.test");
  await assert.rejects(
    () =>
      issueAccountDeletionProof({
        authenticatedAt: new Date(now.getTime() - __recentAccountActionProofInternals.AUTH_MAX_AGE_MS - 1),
        betterAuthUserId: "better-first",
        now,
        principalId: first.principalId,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "recent_authentication_required",
  );
  await assert.rejects(
    () =>
      issueAccountDeletionProof({
        authenticatedAt: now,
        betterAuthUserId: "better-first",
        now,
        principalId: second.principalId,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "recent_authentication_required",
  );
});

test("account deletion proof issuance replaces prior active and consumed grants", async () => {
  const resolved = await identity("better-proof-cleanup", "proof-cleanup@example.test");
  const first = await issueAccountDeletionProof({
    authenticatedAt: now,
    betterAuthUserId: "better-proof-cleanup",
    now,
    principalId: resolved.principalId,
  });
  const secondNow = new Date(now.getTime() + 1_000);
  const second = await issueAccountDeletionProof({
    authenticatedAt: secondNow,
    betterAuthUserId: "better-proof-cleanup",
    now: secondNow,
    principalId: resolved.principalId,
  });
  assert.notEqual(second.proof, first.proof);
  await assert.rejects(
    () => consumeAccountDeletionProof({ now: secondNow, principalId: resolved.principalId, proof: first.proof }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "recent_authentication_required",
  );
  await consumeAccountDeletionProof({ now: secondNow, principalId: resolved.principalId, proof: second.proof });

  const thirdNow = new Date(now.getTime() + 2_000);
  const third = await issueAccountDeletionProof({
    authenticatedAt: thirdNow,
    betterAuthUserId: "better-proof-cleanup",
    now: thirdNow,
    principalId: resolved.principalId,
  });
  const stored = await dbClient.execute({
    sql: `SELECT proof_hash,consumed_at FROM tokenless_recent_account_action_proofs WHERE principal_id = ?`,
    args: [resolved.principalId],
  });
  assert.deepEqual(stored.rows, [
    { consumed_at: null, proof_hash: __recentAccountActionProofInternals.proofHash(third.proof) },
  ]);
  const proofAudits = await dbClient.execute({
    sql: `SELECT action FROM tokenless_security_audit_events
          WHERE scope_kind = 'identity' AND scope_id = ? ORDER BY sequence`,
    args: [resolved.principalId],
  });
  assert.deepEqual(proofAudits.rows, [{ action: "account.deletion_recent_auth_consumed" }]);
});

test("the issuance route binds a fresh Better Auth session to the existing browser principal", () => {
  const source = readFileSync(new URL("../../app/api/account/deletion/recent-auth/route.ts", import.meta.url), "utf8");
  assert.match(source, /requireBrowserSession\(request, \{ mutation: true \}\)/);
  assert.match(source, /getBetterAuth\(\)\.api\.getSession/);
  assert.match(source, /authenticatedAt/);
  assert.match(source, /betterAuthUserId: betterSession\.user\.id/);
  assert.match(source, /principalId: session\.principalId/);
  assert.match(source, /private, no-store, max-age=0/);
});
