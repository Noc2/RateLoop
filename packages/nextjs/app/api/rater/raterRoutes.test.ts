import { NextRequest } from "next/server";
import { POST as createWorldIdContext } from "./assurance/world-id/context/route";
import { GET as getWorldIdStatus } from "./assurance/world-id/status/route";
import { POST as verifyWorldId } from "./assurance/world-id/verify/route";
import { GET as getCommit } from "./commits/[commitId]/route";
import { POST as createCommit } from "./commits/route";
import { POST as providerCallback } from "./eligibility/provider/callback/route";
import { POST as startProvider } from "./eligibility/provider/start/route";
import { POST as createEligibility, GET as getEligibility } from "./eligibility/route";
import { GET as listFeedbackBonusEntitlements } from "./feedback-bonus-entitlements/route";
import { GET as listTasks } from "./tasks/route";
import { POST as createVoucher } from "./vouchers/route";
import assert from "node:assert/strict";
import test from "node:test";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";

const ORIGIN = "https://tokenless.example.test";
const commitContext = { params: Promise.resolve({ commitId: "commit_route_test" }) };

function request(path: string, method = "GET", body = "{}") {
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    ...(method === "GET" ? {} : { body, headers: { "content-type": "application/json" } }),
  });
}

test("every rater handler imports and enforces its route-level authentication or callback contract", async () => {
  const authenticatedHandlers = await Promise.all([
    createWorldIdContext(request("/api/rater/assurance/world-id/context", "POST")),
    getWorldIdStatus(request("/api/rater/assurance/world-id/status")),
    verifyWorldId(request("/api/rater/assurance/world-id/verify", "POST")),
    getCommit(request("/api/rater/commits/commit_route_test"), commitContext),
    createCommit(request("/api/rater/commits", "POST")),
    startProvider(request("/api/rater/eligibility/provider/start", "POST")),
    getEligibility(request("/api/rater/eligibility")),
    createEligibility(request("/api/rater/eligibility", "POST")),
    listFeedbackBonusEntitlements(request("/api/rater/feedback-bonus-entitlements")),
    listTasks(request("/api/rater/tasks")),
    createVoucher(request("/api/rater/vouchers", "POST")),
  ]);
  assert.deepEqual(
    authenticatedHandlers.map(response => response.status),
    [403, 401, 403, 401, 403, 403, 401, 403, 401, 401, 403],
  );
  const callback = await providerCallback(request("/api/rater/eligibility/provider/callback", "POST"));
  assert.equal(callback.status, 400);
  assert.equal((await callback.json()).code, "invalid_provider_result");
  for (const response of [...authenticatedHandlers, callback]) {
    const cacheControl = response.headers.get("cache-control");
    assert.ok(cacheControl, "each rater response must explicitly set Cache-Control");
    assert.match(cacheControl, /no-store/u);
  }
  assert.equal(authenticatedHandlers[3]?.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(authenticatedHandlers[4]?.headers.get("cache-control"), "private, no-store, max-age=0");
});

test("commit status and owned replay survive payout revocation while a new submission remains protected", async () => {
  const previousAppUrl = process.env.APP_URL;
  process.env.APP_URL = ORIGIN;
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  try {
    const identity = await resolveBetterAuthPrincipal({
      betterAuthUserId: "better_rater_commit_recovery_test",
      method: "passkey",
    });
    const session = await createAuthSession(identity);
    const now = new Date("2026-08-02T12:00:00.000Z");
    await dbClient.execute({
      sql: `INSERT INTO tokenless_rater_profiles
            (rater_id, principal_id, account_address, nullifier_seed_ciphertext, nullifier_key_version,
             nullifier_key_domain, created_at, updated_at)
            VALUES ('rater_route_replay', ?, '0x1111111111111111111111111111111111111111',
                    'ciphertext', 'v1', 'vote_mapping', ?, ?)`,
      args: [identity.principalId, now, now],
    });
    await dbClient.execute({
      sql: `INSERT INTO tokenless_paid_vouchers
            (voucher_id, rater_id, request_idempotency_key, request_hash, chain_id, panel_address,
             issuer_address, issuer_epoch, signer_address, round_id, content_id, vote_key, nullifier,
             admission_policy_hash, assurance_snapshot_hash, expires_at, payout_account_snapshot,
             voucher_json, voucher_signature, status, issued_at)
            VALUES ('voucher_route_replay', 'rater_route_replay', 'voucher:route:replay', 'voucher-hash',
                    84532, '0x2222222222222222222222222222222222222222',
                    '0x3333333333333333333333333333333333333333', 1,
                    '0x3333333333333333333333333333333333333333', 42, ?,
                    '0x1111111111111111111111111111111111111111', ?, ?, ?, ?,
                    '0x1111111111111111111111111111111111111111', '{}', '0x12', 'issued', ?)`,
      args: [
        `0x${"11".repeat(32)}`,
        `0x${"22".repeat(32)}`,
        `0x${"33".repeat(32)}`,
        `sha256:${"44".repeat(32)}`,
        new Date(now.getTime() + 60_000),
        now,
      ],
    });
    await dbClient.execute({
      sql: `INSERT INTO tokenless_rater_commits
            (commit_id, voucher_id, request_idempotency_key, request_hash, deployment_key, round_id,
             vote_key, sealed_commitment, sealed_payload_hash, payout_commitment, relay_payload_json,
             state, failure_code, created_at, updated_at)
            VALUES ('commit_route_replay', 'voucher_route_replay', 'commit:route:replay', 'request-hash',
                    'deployment-route', 42, '0x1111111111111111111111111111111111111111', ?, ?, ?, '{}',
                    'failed', 'transaction_reverted', ?, ?)`,
      args: [`0x${"55".repeat(32)}`, `0x${"66".repeat(32)}`, `0x${"77".repeat(32)}`, now, now],
    });

    const cookie = `${AUTH_SESSION_COOKIE}=${session.token}`;
    const status = await getCommit(
      new NextRequest(`${ORIGIN}/api/rater/commits/commit_route_replay`, { headers: { cookie } }),
      { params: Promise.resolve({ commitId: "commit_route_replay" }) },
    );
    assert.equal(status.status, 200);
    assert.equal((await status.json()).state, "failed");

    const commitBody = JSON.stringify({
      idempotencyKey: "commit:route:replay",
      voucherId: "voucher_route_replay",
      authorization: {},
      response: { choice: "positive" },
    });
    const ownedReplay = await createCommit(
      new NextRequest(`${ORIGIN}/api/rater/commits`, {
        method: "POST",
        body: commitBody,
        headers: { cookie, "content-type": "application/json", origin: ORIGIN },
      }),
    );
    assert.equal(ownedReplay.status, 400);
    assert.equal((await ownedReplay.json()).code, "invalid_commit_authorization");

    const newSubmission = await createCommit(
      new NextRequest(`${ORIGIN}/api/rater/commits`, {
        method: "POST",
        body: commitBody.replace("voucher_route_replay", "voucher_without_commit"),
        headers: { cookie, "content-type": "application/json", origin: ORIGIN },
      }),
    );
    assert.equal(newSubmission.status, 409);
    assert.equal((await newSubmission.json()).code, "payout_wallet_required");
  } finally {
    __setDatabaseResourcesForTests(null);
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
  }
});
