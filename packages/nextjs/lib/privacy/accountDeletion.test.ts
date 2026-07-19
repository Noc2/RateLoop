import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { BETTER_AUTH_SESSION_COOKIE_NAMES } from "~~/lib/auth/betterAuthCookies";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { issueAccountDeletionProof } from "~~/lib/auth/recentAccountActionProof";
import { createAuthSession, findAuthSession } from "~~/lib/auth/session";
import { revokeWalletBinding } from "~~/lib/auth/walletBindings";
import { __setDatabaseResourcesForTests, dbClient, dbPool } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { deleteAccount, getAccountDeletionPreview } from "~~/lib/privacy/accountDeletion";
import { __setPaidEligibilityOverridesForTests, ensureAssuranceRaterProfile } from "~~/lib/tokenless/paidEligibility";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

let databaseResources: ReturnType<typeof createMemoryDatabaseResources>;

beforeEach(() => {
  databaseResources = createMemoryDatabaseResources();
  __setDatabaseResourcesForTests(databaseResources);
  __setPaidEligibilityOverridesForTests({
    vault: {
      provider_evidence: { currentVersion: "test-v1", keys: new Map([["test-v1", Buffer.alloc(32, 11)]]) },
      tax_records: { currentVersion: "test-v1", keys: new Map([["test-v1", Buffer.alloc(32, 13)]]) },
      vote_mapping: { currentVersion: "test-v1", keys: new Map([["test-v1", Buffer.alloc(32, 17)]]) },
    },
  });
});
afterEach(() => {
  __setPaidEligibilityOverridesForTests({});
  __setDatabaseResourcesForTests(null);
});

async function seedBetterAuthUser(id: string, email = "delete@example.test") {
  const now = new Date("2026-07-16T08:00:00.000Z");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_better_auth_users
          (id, name, email, email_verified, created_at, updated_at)
          VALUES (?, 'Delete me', ?, true, ?, ?)`,
    args: [id, email, now, now],
  });
}

async function deletionProof(betterAuthUserId: string, principalId: string, now: Date) {
  return (
    await issueAccountDeletionProof({
      authenticatedAt: now,
      authenticationMethod: "passkey",
      betterAuthUserId,
      now,
      principalId,
    })
  ).proof;
}

test("account deletion revokes authentication, removes shared access, and permits a genuinely fresh signup", async () => {
  const now = new Date("2026-07-16T08:04:45.000Z");
  await seedBetterAuthUser("better-old");
  const oldIdentity = await resolveBetterAuthPrincipal({ betterAuthUserId: "better-old" });
  const oldSession = await createAuthSession(oldIdentity, now);
  const shared = await createWorkspace({
    name: "Shared",
    ownerAddress: "0x1111111111111111111111111111111111111111",
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
          VALUES (?, ?, 'member', ?)`,
    args: [shared.workspaceId, oldIdentity.principalId, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_wallet_bindings
          (binding_id, principal_id, purpose, wallet_address, wallet_source, chain_id,
           proof_message_hash, created_at, last_used_at)
          VALUES ('wb_self', ?, 'payout', '0x2222222222222222222222222222222222222222',
                  'self_custodial', 8453, 'proof', ?, ?)`,
    args: [oldIdentity.principalId, now, now],
  });
  for (const type of ["email-verification", "sign-in", "forget-password", "change-email"]) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_better_auth_verifications
            (id, identifier, value, expires_at, created_at, updated_at)
            VALUES (?, ?, 'otp', ?, ?, ?)`,
      args: [`verification-${type}`, `${type}-otp-delete@example.test`, new Date(now.getTime() + 60_000), now, now],
    });
  }

  const preview = await getAccountDeletionPreview(oldIdentity.principalId);
  assert.equal(preview.impact.sharedWorkspaces, 1);
  assert.deepEqual(preview.blockers, []);

  const deleted = await deleteAccount({
    confirmation: "DELETE",
    principalId: oldIdentity.principalId,
    recentAuthProof: await deletionProof("better-old", oldIdentity.principalId, now),
    now,
  });
  assert.match(deleted.receiptDigest, /^[0-9a-f]{64}$/);
  assert.equal(await findAuthSession(oldSession.token, now), null);

  const stored = await dbClient.execute({
    sql: `SELECT
            (SELECT status FROM tokenless_principals WHERE principal_id = ?) AS principal_status,
            (SELECT status FROM tokenless_identity_bindings WHERE principal_id = ?) AS binding_status,
            (SELECT COUNT(*) FROM tokenless_better_auth_users WHERE id = 'better-old') AS better_users,
            (SELECT COUNT(*) FROM tokenless_better_auth_verifications) AS verifications,
            (SELECT COUNT(*) FROM tokenless_browser_identities WHERE principal_address = ?) AS browser_identities,
            (SELECT COUNT(*) FROM tokenless_workspace_members WHERE account_address = ?) AS memberships,
            (SELECT COUNT(*) FROM tokenless_wallet_bindings WHERE principal_id = ?) AS wallet_bindings,
            (SELECT COUNT(*) FROM tokenless_deletion_job_categories WHERE job_id = ?) AS categories`,
    args: [
      oldIdentity.principalId,
      oldIdentity.principalId,
      oldIdentity.principalId,
      oldIdentity.principalId,
      oldIdentity.principalId,
      deleted.jobId,
    ],
  });
  const storedRow = Object.fromEntries(
    Object.entries(stored.rows[0] ?? {}).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  assert.deepEqual(storedRow, {
    principal_status: "deleted",
    binding_status: "revoked",
    better_users: 0,
    verifications: 0,
    browser_identities: 0,
    memberships: 0,
    wallet_bindings: 0,
    categories: 10,
  });

  await assert.rejects(
    () => resolveBetterAuthPrincipal({ betterAuthUserId: "better-old" }),
    /Unable to create the RateLoop principal binding/,
  );
  await assert.rejects(
    () => createWorkspace({ name: "Orphan", ownerAddress: oldIdentity.principalId }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "principal_inactive",
  );

  await seedBetterAuthUser("better-new");
  const freshIdentity = await resolveBetterAuthPrincipal({ betterAuthUserId: "better-new" });
  assert.notEqual(freshIdentity.principalId, oldIdentity.principalId);
  assert.equal((await getAccountDeletionPreview(freshIdentity.principalId)).impact.ownedWorkspaces, 0);
});

test("account deletion deletes unused private quotes and anonymizes retained quote ownership", async () => {
  const now = new Date("2026-07-16T08:30:00.000Z");
  await seedBetterAuthUser("better-private-quotes", "private-quotes@example.test");
  const identity = await resolveBetterAuthPrincipal({ betterAuthUserId: "better-private-quotes" });
  for (const [quoteId, prompt] of [
    ["quote_account_unused", "Unused account-private prompt"],
    ["quote_account_retained", "Retained account-private prompt"],
  ] as const) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_quotes
            (quote_id, request_hash, request_json, response_json, owner_principal_id, expires_at, created_at)
            VALUES (?, ?, ?, '{}', ?, ?, ?)`,
      args: [
        quoteId,
        `hash-${quoteId}`,
        JSON.stringify({ question: { prompt }, visibility: "private" }),
        identity.principalId,
        new Date(now.getTime() + 60_000),
        now,
      ],
    });
  }
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_asks
          (operation_key, idempotency_key, request_hash, quote_id, request_json, economics_json,
           status, created_at, updated_at)
          VALUES ('operation_account_retained', 'account-retained', 'request-hash',
                  'quote_account_retained', '{}', '{}', 'completed', ?, ?)`,
    args: [now, now],
  });
  assert.match(
    (await getAccountDeletionPreview(identity.principalId)).impact.retainedRecords.join(" "),
    /owner link anonymized/iu,
  );

  const deleted = await deleteAccount({
    confirmation: "DELETE",
    principalId: identity.principalId,
    recentAuthProof: await deletionProof("better-private-quotes", identity.principalId, now),
    now,
  });
  const quotes = await dbClient.execute({
    sql: `SELECT quote_id, request_json, owner_principal_id, owner_workspace_id, owner_api_key_id
          FROM tokenless_agent_quotes
          WHERE quote_id IN ('quote_account_unused', 'quote_account_retained')
          ORDER BY quote_id`,
  });
  assert.equal(quotes.rowCount, 1);
  assert.equal(quotes.rows[0]?.quote_id, "quote_account_retained");
  assert.doesNotMatch(String(quotes.rows[0]?.request_json), /Retained account-private prompt/u);
  assert.match(String(quotes.rows[0]?.request_json), /rateloop\.erased-private-quote\.v1/u);
  assert.match(String(quotes.rows[0]?.owner_principal_id), /^deleted-quote:[0-9a-f]{64}$/u);
  assert.equal(quotes.rows[0]?.owner_workspace_id, null);
  assert.equal(quotes.rows[0]?.owner_api_key_id, null);

  const completion = await dbClient.execute({
    sql: `SELECT evidence_json FROM tokenless_subject_request_completions WHERE request_id = ?`,
    args: [deleted.requestId],
  });
  const evidence = JSON.parse(String(completion.rows[0]?.evidence_json)) as {
    categoryEvidence: Record<string, Record<string, unknown>>;
  };
  assert.deepEqual(evidence.categoryEvidence.private_quote_plaintext_payloads, {
    deletedUnreferenced: 1,
    erasedReferencedContent: 0,
  });
  assert.deepEqual(evidence.categoryEvidence.referenced_private_quote_commitments, {
    ownerTombstone: quotes.rows[0]?.owner_principal_id,
    retainedReferencedCommitmentOnly: 1,
  });
  assert.equal(evidence.categoryEvidence.settlement_legal_security?.retainedPrivateQuoteCommitments, 1);
  assert.equal(
    evidence.categoryEvidence.settlement_legal_security?.privateQuoteOwnerTombstone,
    quotes.rows[0]?.owner_principal_id,
  );
});

test("account deletion receipts the rater identity, erases World ID state, and permits fresh enrollment", async () => {
  const now = new Date("2026-07-16T09:00:00.000Z");
  const payoutAccount = "0x2222222222222222222222222222222222222222";
  await seedBetterAuthUser("better-rater", "rater-delete@example.test");
  const oldIdentity = await resolveBetterAuthPrincipal({ betterAuthUserId: "better-rater" });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_wallet_bindings
          (binding_id,principal_id,purpose,wallet_address,wallet_source,chain_id,
           proof_message_hash,created_at,last_used_at)
          VALUES ('wb_rater_old',?,'payout',?,'self_custodial',8453,'proof-old',?,?)`,
    args: [oldIdentity.principalId, payoutAccount, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_payout_wallet_ownership
          (wallet_address,principal_id,first_binding_id,first_bound_at)
          VALUES (?,?,'wb_rater_old',?)`,
    args: [payoutAccount, oldIdentity.principalId, now],
  });
  const oldClient = await dbPool.connect();
  let oldRaterId: string;
  try {
    oldRaterId = await ensureAssuranceRaterProfile(
      oldClient,
      { principalId: oldIdentity.principalId, payoutAccount },
      now,
    );
  } finally {
    oldClient.release();
  }
  await dbClient.execute({
    sql: `INSERT INTO tokenless_paid_vouchers
          (voucher_id,rater_id,request_idempotency_key,request_hash,chain_id,panel_address,
           issuer_address,issuer_epoch,signer_address,round_id,content_id,vote_key,nullifier,
           admission_policy_hash,assurance_snapshot_hash,expires_at,payout_account_snapshot,
           voucher_json,voucher_signature,status,issued_at)
          VALUES ('voucher_delete',?,'voucher:delete:1','request-delete',84532,
                  '0x3333333333333333333333333333333333333333',
                  '0x4444444444444444444444444444444444444444',1,
                  '0x4444444444444444444444444444444444444444',42,?,?,?,?,'sha256:${"5".repeat(64)}',
                  ?,?,'{}','0x12','issued',?)`,
    args: [
      oldRaterId,
      `0x${"1".repeat(64)}`,
      "0x5555555555555555555555555555555555555555",
      `0x${"2".repeat(64)}`,
      `0x${"3".repeat(64)}`,
      new Date(now.getTime() + 3_600_000),
      payoutAccount,
      now,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_world_id_context_limits
          (rater_id,window_started_at,request_count,updated_at) VALUES (?, ?, 1, ?)`,
    args: [oldRaterId, now, now],
  });
  const worldSubjectReferenceHash = `hmac-sha256:test-v1:${"6".repeat(64)}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_provider_subject_bindings
          (binding_id,rater_id,provider_id,provider_namespace,subject_reference_hash,
           subject_reference_scheme,subject_reference_key_version,status,bound_at,last_verified_at,
           created_at,updated_at)
          VALUES ('bind_world_delete',?,'world:poh','rp_delete',?,'hmac-sha256-v1','test-v1',
                  'active',?,?,?,?)`,
    args: [oldRaterId, worldSubjectReferenceHash, now, now, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_assertions
          (assertion_id,rater_id,binding_id,provider_id,provider_namespace,provider_assertion_hash,
           provider_assertion_id_hash,provider_assertion_reference_scheme,provider_assertion_key_version,
           capabilities_json,provider_evidence_ciphertext,provider_evidence_key_version,
           provider_evidence_key_domain,evidence_verified_at,evidence_expires_at,status,created_at,updated_at)
          VALUES ('assert_world_delete',?,'bind_world_delete','world:poh','rp_delete',?,?,'hmac-sha256-v1',
                  'test-v1','["unique_human"]','ciphertext','test-v1','provider_evidence',?,?,'active',?,?)`,
    args: [
      oldRaterId,
      `hmac-sha256:test-v1:${"7".repeat(64)}`,
      `hmac-sha256:test-v1:${"8".repeat(64)}`,
      now,
      new Date(now.getTime() + 86_400_000),
      now,
      now,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_world_id_requests
          (request_id,rater_id,principal_id,account_address,provider_id,rp_id,app_id,action_version,
           action,environment,mode,assurance_effect,nonce,credential_expires_at_min,status,created_at,expires_at)
          VALUES ('wrq_delete',?,?,?,'world:poh','rp_delete','app_delete','v1','delete-test','staging',
                  'initial_unique','bind_durable_unique_human','nonce-delete',?,'pending',?,?)`,
    args: [
      oldRaterId,
      oldIdentity.principalId,
      payoutAccount,
      new Date(now.getTime() + 86_400_000),
      now,
      new Date(now.getTime() + 300_000),
    ],
  });

  const deleted = await deleteAccount({
    confirmation: "DELETE",
    principalId: oldIdentity.principalId,
    recentAuthProof: await deletionProof("better-rater", oldIdentity.principalId, now),
    now,
  });
  const receiptAccount = `0x${createHash("sha256")
    .update(`deleted-rater-payout:${deleted.receiptDigest}`)
    .digest("hex")
    .slice(0, 40)}`;
  const erased = await dbClient.execute({
    sql: `SELECT principal_id,account_address,nullifier_seed_ciphertext,deletion_receipt_hash,deleted_at
          FROM tokenless_rater_profiles WHERE rater_id = ?`,
    args: [oldRaterId],
  });
  assert.equal(erased.rowCount, 1);
  assert.deepEqual(erased.rows[0], {
    principal_id: null,
    account_address: receiptAccount,
    nullifier_seed_ciphertext: `deleted:${deleted.receiptDigest}`,
    deletion_receipt_hash: `sha256:${deleted.receiptDigest}`,
    deleted_at: now,
  });
  const erasedState = await dbClient.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM tokenless_world_id_requests WHERE rater_id = ?) AS world_requests,
            (SELECT COUNT(*) FROM tokenless_world_id_context_limits WHERE rater_id = ?) AS world_limits,
            (SELECT COUNT(*) FROM tokenless_provider_subject_bindings WHERE rater_id = ?) AS subject_bindings,
            (SELECT COUNT(*) FROM tokenless_assurance_assertions WHERE rater_id = ?) AS assertions,
            (SELECT COUNT(*) FROM tokenless_payout_wallet_ownership WHERE principal_id = ?) AS ownership,
            (SELECT COUNT(*) FROM tokenless_paid_vouchers WHERE rater_id = ?) AS retained_vouchers`,
    args: [oldRaterId, oldRaterId, oldRaterId, oldRaterId, oldIdentity.principalId, oldRaterId],
  });
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(erasedState.rows[0] ?? {}).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
    ),
    { world_requests: 0, world_limits: 0, subject_bindings: 0, assertions: 0, ownership: 0, retained_vouchers: 1 },
  );

  const receipt = await dbClient.execute({
    sql: `SELECT category,disposition,status,basis_code,retention_deadline,evidence_digest,
                 created_at,completed_at
          FROM tokenless_deletion_job_categories
          WHERE job_id = ? AND category = 'world_id_and_rater_linkage'`,
    args: [deleted.jobId],
  });
  assert.equal(receipt.rowCount, 1);
  assert.equal(receipt.rows[0]?.disposition, "erase");
  assert.equal(receipt.rows[0]?.status, "completed");
  assert.equal(receipt.rows[0]?.basis_code, null);
  assert.equal(receipt.rows[0]?.retention_deadline, null);
  assert.match(String(receipt.rows[0]?.evidence_digest), /^[0-9a-f]{64}$/);
  assert.ok(new Date(String(receipt.rows[0]?.completed_at)) >= new Date(String(receipt.rows[0]?.created_at)));
  const retainedReceipt = await dbClient.execute({
    sql: `SELECT disposition,status,basis_code,retention_deadline,evidence_digest
          FROM tokenless_deletion_job_categories
          WHERE job_id = ? AND category = 'settlement_legal_security'`,
    args: [deleted.jobId],
  });
  assert.deepEqual(
    {
      basis: retainedReceipt.rows[0]?.basis_code,
      disposition: retainedReceipt.rows[0]?.disposition,
      status: retainedReceipt.rows[0]?.status,
    },
    { basis: "legal_settlement_security", disposition: "retain", status: "retained" },
  );
  assert.equal(
    new Date(String(retainedReceipt.rows[0]?.retention_deadline)).toISOString(),
    new Date(now.getTime() + 3_650 * 86_400_000).toISOString(),
  );
  assert.match(String(retainedReceipt.rows[0]?.evidence_digest), /^[0-9a-f]{64}$/);
  const completion = await dbClient.execute({
    sql: `SELECT evidence_json FROM tokenless_subject_request_completions WHERE request_id = ?`,
    args: [deleted.requestId],
  });
  const completionEvidence = JSON.parse(String(completion.rows[0]?.evidence_json)) as {
    categoryDigests: Record<string, string>;
    categoryEvidence: Record<string, Record<string, unknown>>;
  };
  assert.equal(completionEvidence.categoryDigests.world_id_and_rater_linkage, receipt.rows[0]?.evidence_digest);
  assert.deepEqual(completionEvidence.categoryEvidence.world_id_and_rater_linkage, {
    deletedRows: {
      assuranceAssertions: 1,
      payoutEligibility: 0,
      providerSubjectBindings: 1,
      worldIdContextLimits: 1,
      worldIdRequests: 1,
    },
    paidAssignmentSeatDirectIdentitiesErased: 0,
    profileFound: true,
    remainingPaidAssignmentSeatDirectIdentities: 0,
    remainingRows: {
      assuranceAssertions: 0,
      payoutEligibility: 0,
      principalProfileLinks: 0,
      providerSubjectBindings: 0,
      worldIdContextLimits: 0,
      worldIdRequests: 0,
    },
    tombstoneWritten: true,
  });
  assert.deepEqual(completionEvidence.categoryEvidence.settlement_legal_security, {
    paidAssignmentSeatErasureReceiptHashes: [],
    paidAssignmentSeatIdentityCommitmentsRetained: 0,
    privateQuoteOwnerTombstone: null,
    raterTombstoneRetained: true,
    retainedPrivateQuoteCommitments: 0,
    retainedPaidVouchers: 1,
    tombstoneReceiptHash: `sha256:${deleted.receiptDigest}`,
  });
  const events = await dbClient.execute({
    sql: `SELECT from_status,to_status,actor_reference,reason,created_at
          FROM tokenless_subject_request_events WHERE request_id = ?`,
    args: [deleted.requestId],
  });
  assert.equal(events.rowCount, 1);
  assert.deepEqual(
    {
      actor: events.rows[0]?.actor_reference,
      from: events.rows[0]?.from_status,
      reason: events.rows[0]?.reason,
      to: events.rows[0]?.to_status,
    },
    {
      actor: "system:account_deletion",
      from: null,
      reason: "atomic_account_erasure_completed",
      to: "completed",
    },
  );

  await seedBetterAuthUser("better-rater-fresh", "rater-delete@example.test");
  const freshIdentity = await resolveBetterAuthPrincipal({ betterAuthUserId: "better-rater-fresh" });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_wallet_bindings
          (binding_id,principal_id,purpose,wallet_address,wallet_source,chain_id,
           proof_message_hash,created_at,last_used_at)
          VALUES ('wb_rater_fresh',?,'payout',?,'self_custodial',8453,'proof-fresh',?,?)`,
    args: [freshIdentity.principalId, payoutAccount, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_payout_wallet_ownership
          (wallet_address,principal_id,first_binding_id,first_bound_at)
          VALUES (?,?,'wb_rater_fresh',?)`,
    args: [payoutAccount, freshIdentity.principalId, now],
  });
  const freshClient = await dbPool.connect();
  let freshRaterId: string;
  try {
    freshRaterId = await ensureAssuranceRaterProfile(
      freshClient,
      { principalId: freshIdentity.principalId, payoutAccount },
      now,
    );
  } finally {
    freshClient.release();
  }
  assert.notEqual(freshRaterId, oldRaterId);
  const fresh = await dbClient.execute({
    sql: `SELECT principal_id,account_address,deletion_receipt_hash
          FROM tokenless_rater_profiles WHERE rater_id = ?`,
    args: [freshRaterId],
  });
  assert.deepEqual(fresh.rows[0], {
    principal_id: freshIdentity.principalId,
    account_address: payoutAccount,
    deletion_receipt_hash: null,
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_provider_subject_bindings
          (binding_id,rater_id,provider_id,provider_namespace,subject_reference_hash,
           subject_reference_scheme,subject_reference_key_version,status,bound_at,last_verified_at,
           created_at,updated_at)
          VALUES ('bind_world_fresh',?,'world:poh','rp_delete',?,'hmac-sha256-v1','test-v1',
                  'active',?,?,?,?)`,
    args: [freshRaterId, worldSubjectReferenceHash, now, now, now, now],
  });
  const rebound = await dbClient.execute({
    sql: `SELECT rater_id FROM tokenless_provider_subject_bindings
          WHERE subject_reference_hash = ?`,
    args: [worldSubjectReferenceHash],
  });
  assert.deepEqual(rebound.rows, [{ rater_id: freshRaterId }]);
});

test("account deletion blocks active managed wallets until they are disconnected", async () => {
  const now = new Date("2026-07-16T08:04:45.000Z");
  await seedBetterAuthUser("better-blocked", "blocked@example.test");
  const identity = await resolveBetterAuthPrincipal({ betterAuthUserId: "better-blocked" });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_wallet_bindings
          (binding_id, principal_id, purpose, wallet_address, wallet_source, chain_id,
           proof_message_hash, created_at, last_used_at)
          VALUES ('wb_managed', ?, 'recovery', '0x3333333333333333333333333333333333333333',
                  'thirdweb', 8453, 'proof', ?, ?)`,
    args: [identity.principalId, now, now],
  });
  const preview = await getAccountDeletionPreview(identity.principalId);
  assert.deepEqual(
    preview.blockers.map(blocker => blocker.code),
    ["managed_wallet_recovery_required"],
  );
  assert.equal(preview.impact.managedWallets, 1);
  const recentAuthProof = await deletionProof("better-blocked", identity.principalId, now);
  await assert.rejects(
    () =>
      deleteAccount({
        confirmation: "DELETE",
        principalId: identity.principalId,
        recentAuthProof,
        now,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "managed_wallet_recovery_required",
  );
  await revokeWalletBinding({ bindingId: "wb_managed", principalId: identity.principalId, now });
  const disconnectedPreview = await getAccountDeletionPreview(identity.principalId);
  assert.deepEqual(disconnectedPreview.blockers, []);
  assert.equal(disconnectedPreview.impact.managedWallets, 0);
});

test("account deletion fails closed before receipting an incomplete erasure", async () => {
  const now = new Date("2026-07-16T10:00:00.000Z");
  await seedBetterAuthUser("better-incomplete", "incomplete@example.test");
  const identity = await resolveBetterAuthPrincipal({ betterAuthUserId: "better-incomplete" });
  const recentAuthProof = await deletionProof("better-incomplete", identity.principalId, now);
  const originalConnect = databaseResources.pool.connect.bind(databaseResources.pool);
  databaseResources.pool.connect = (async () => {
    const client = await originalConnect();
    const originalQuery = client.query.bind(client);
    client.query = (async (queryText: string, queryValues?: unknown[]) => {
      const result = await originalQuery(queryText, queryValues);
      if (typeof queryText === "string" && queryText.includes("AS browser_identities") && result.rows[0]) {
        result.rows[0].browser_identities = 1;
      }
      return result;
    }) as typeof client.query;
    return client;
  }) as typeof databaseResources.pool.connect;

  await assert.rejects(
    () =>
      deleteAccount({
        confirmation: "DELETE",
        principalId: identity.principalId,
        recentAuthProof,
        now,
      }),
    /Account deletion postcondition failed: browserIdentities/,
  );
  databaseResources.pool.connect = originalConnect as typeof databaseResources.pool.connect;
  const receipts = await dbClient.execute({
    sql: `SELECT COUNT(*) AS count FROM tokenless_deletion_jobs WHERE scope_id = ?`,
    args: [identity.principalId],
  });
  const receiptCount = receipts.rows[0]?.count;
  assert.equal(Number(Array.isArray(receiptCount) ? receiptCount[0] : receiptCount), 0);
});

test("account deletion rolls back proof consumption and its audit when the bound identity changed", async () => {
  const now = new Date("2026-07-16T10:05:00.000Z");
  await seedBetterAuthUser("better-proof-rollback", "proof-rollback@example.test");
  const identity = await resolveBetterAuthPrincipal({ betterAuthUserId: "better-proof-rollback" });
  const recentAuthProof = await deletionProof("better-proof-rollback", identity.principalId, now);
  await dbClient.execute({
    sql: `UPDATE tokenless_identity_bindings SET status = 'revoked', revoked_at = ?
          WHERE principal_id = ? AND provider = 'better_auth'`,
    args: [now, identity.principalId],
  });

  await assert.rejects(
    () =>
      deleteAccount({
        confirmation: "DELETE",
        principalId: identity.principalId,
        recentAuthProof,
        now,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "recent_authentication_required",
  );
  const proofState = await dbClient.execute({
    sql: `SELECT consumed_at FROM tokenless_recent_account_action_proofs WHERE principal_id = ?`,
    args: [identity.principalId],
  });
  assert.deepEqual(proofState.rows, [{ consumed_at: null }]);
  const auditActions = await dbClient.execute({
    sql: `SELECT action FROM tokenless_security_audit_events
          WHERE scope_kind = 'identity' AND scope_id = ? ORDER BY sequence`,
    args: [identity.principalId],
  });
  assert.equal(
    auditActions.rows.some(row => row.action === "account.deletion_recent_auth_consumed"),
    false,
  );
});

test("the account deletion route requires the product session and a one-use recent-auth proof", () => {
  const source = readFileSync(join(process.cwd(), "app/api/account/deletion/route.ts"), "utf8");
  assert.match(source, /requireBrowserSession\(request\)/);
  assert.match(source, /requireBrowserSession\(request, \{ mutation: true \}\)/);
  assert.match(source, /recentAuthProof/);
  assert.doesNotMatch(source, /consumeAccountDeletionProof/);
  const service = readFileSync(join(process.cwd(), "lib/privacy/accountDeletion.ts"), "utf8");
  assert.match(service, /lockAccountDeletionProof[\s\S]+client/);
  assert.match(service, /consumeLockedAccountDeletionProof[\s\S]+client/);
  assert.match(source, /response\.cookies\.delete\(AUTH_SESSION_COOKIE\)/);
  assert.match(source, /BETTER_AUTH_SESSION_COOKIE_NAMES/);
  assert.deepEqual(BETTER_AUTH_SESSION_COOKIE_NAMES, [
    "rateloop-identity.session_token",
    "__Secure-rateloop-identity.session_token",
  ]);
  assert.doesNotMatch(source, /better-auth\.session_token/);
});
