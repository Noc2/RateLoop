import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  decideExpertiseVerificationRequest,
  revokeExpertiseVerificationRequest,
  submitExpertiseVerificationRequest,
} from "~~/lib/tokenless/expertiseVerification";

const OPERATOR = "0x1111111111111111111111111111111111111111";
const REVIEWER = "0x2222222222222222222222222222222222222222";
const originalOperators = process.env.TOKENLESS_EXPERTISE_OPERATOR_ACCOUNTS;
const originalPublicOperators = process.env.NEXT_PUBLIC_TOKENLESS_EXPERTISE_OPERATOR_ACCOUNTS;

beforeEach(async () => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  process.env.TOKENLESS_EXPERTISE_OPERATOR_ACCOUNTS = OPERATOR;
  delete process.env.NEXT_PUBLIC_TOKENLESS_EXPERTISE_OPERATOR_ACCOUNTS;
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_browser_identities
          (principal_address,thirdweb_user_id,auth_provider,primary_email,email_verified,email_domain,
           display_name,created_at,updated_at,last_login_at)
          VALUES (?,?,'email','reviewer@example.test',true,'example.test','Reviewer',?,?,?)`,
    args: [REVIEWER, "expertise-verification-reviewer", now, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_principals (principal_id,status,created_at,updated_at)
          VALUES (?,'active',?,?);
          INSERT INTO tokenless_wallet_bindings
          (binding_id,principal_id,purpose,wallet_address,wallet_source,chain_id,proof_message_hash,created_at,last_used_at)
          VALUES ('binding_expertise_verification',?,'payout',?,'self_custodial',84532,'fixture',?,?);
          INSERT INTO tokenless_payout_wallet_ownership
          (wallet_address,principal_id,first_binding_id,first_bound_at)
          VALUES (?,?,'binding_expertise_verification',?)`,
    args: [REVIEWER, now, now, REVIEWER, REVIEWER, now, now, REVIEWER, REVIEWER, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_rater_profiles
          (rater_id,principal_id,account_address,nullifier_seed_ciphertext,nullifier_key_version,nullifier_key_domain,
           created_at,updated_at)
          VALUES ('rater_expertise_verification',?,?,'ciphertext','v1','vote_mapping',?,?)`,
    args: [REVIEWER, REVIEWER, now, now],
  });
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalOperators === undefined) delete process.env.TOKENLESS_EXPERTISE_OPERATOR_ACCOUNTS;
  else process.env.TOKENLESS_EXPERTISE_OPERATOR_ACCOUNTS = originalOperators;
  if (originalPublicOperators === undefined) delete process.env.NEXT_PUBLIC_TOKENLESS_EXPERTISE_OPERATOR_ACCOUNTS;
  else process.env.NEXT_PUBLIC_TOKENLESS_EXPERTISE_OPERATOR_ACCOUNTS = originalPublicOperators;
});

test("network verification materializes and revokes legacy and exact specialist credentials together", async () => {
  const now = new Date();
  const submitted = await submitExpertiseVerificationRequest({
    principalId: REVIEWER,
    expertiseKeys: ["code-review:typescript"],
    evidenceReferenceHash: `sha256:${"a".repeat(64)}`,
    now,
  });
  await decideExpertiseVerificationRequest({
    accountAddress: OPERATOR,
    requestId: submitted.requestId,
    decision: "verified",
    reason: "Credential evidence matches the documented review experience.",
    expiresAt: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
    now,
  });
  const active = await dbClient.execute({
    sql: `SELECT expertise_record_schema_version,expertise_definition_id,status,revoked_by
          FROM tokenless_reviewer_qualifications
          WHERE rater_id='rater_expertise_verification'
          ORDER BY expertise_record_schema_version`,
  });
  assert.deepEqual(
    active.rows.map(row => ({
      schema: Number(row.expertise_record_schema_version),
      definitionId: row.expertise_definition_id,
      status: row.status,
      revokedBy: row.revoked_by,
    })),
    [
      { schema: 1, definitionId: null, status: "active", revokedBy: null },
      { schema: 2, definitionId: "expd_code_review_typescript", status: "active", revokedBy: null },
    ],
  );

  await revokeExpertiseVerificationRequest({
    accountAddress: OPERATOR,
    requestId: submitted.requestId,
    reason: "The credential evidence was withdrawn.",
    now: new Date(now.getTime() + 60_000),
  });
  const revoked = await dbClient.execute({
    sql: `SELECT expertise_record_schema_version,status,revoked_by
          FROM tokenless_reviewer_qualifications
          WHERE rater_id='rater_expertise_verification'
          ORDER BY expertise_record_schema_version`,
  });
  assert.deepEqual(
    revoked.rows.map(row => ({
      schema: Number(row.expertise_record_schema_version),
      status: row.status,
      revokedBy: row.revoked_by,
    })),
    [
      { schema: 1, status: "revoked", revokedBy: null },
      { schema: 2, status: "revoked", revokedBy: OPERATOR },
    ],
  );
});
