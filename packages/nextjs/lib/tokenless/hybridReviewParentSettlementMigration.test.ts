import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const sql = readFileSync(resolve(process.cwd(), "drizzle/0146_hybrid_review_parent_settlement.sql"), "utf8");
const worker = readFileSync(resolve(process.cwd(), "lib/tokenless/audienceAssignments.ts"), "utf8");
const adapter = readFileSync(resolve(process.cwd(), "lib/tokenless/publicPaidHumanReviewAdapter.ts"), "utf8");
const retentionWorker = readFileSync(resolve(process.cwd(), "lib/tokenless/evidenceRetentionEnforcement.ts"), "utf8");

describe("hybrid review parent settlement migration", () => {
  it("persists exactly one invited child and one network child with distinct paid rounds", () => {
    assert.match(sql, /CREATE TABLE "tokenless_hybrid_review_operations"/u);
    assert.match(sql, /CREATE TABLE "tokenless_hybrid_review_children"/u);
    assert.match(sql, /UNIQUE \("hybrid_operation_id","cohort"\)/u);
    assert.match(sql, /UNIQUE \("hybrid_operation_id","deployment_key","chain_id","panel_address","round_id"\)/u);
    assert.match(sql, /"cohort" IN \('invited','network'\)/u);
  });

  it("freezes cohort economics, expertise, assignment, voucher, and settlement evidence", () => {
    assert.match(sql, /"economics_hash"/u);
    assert.match(sql, /"expertise_hash"/u);
    assert.match(sql, /"assignment_evidence_hash"/u);
    assert.match(sql, /"voucher_preparation_hash"/u);
    assert.match(sql, /"settlement_binding_hash"/u);
    assert.match(sql, /"settlement_evidence_hash"/u);
    assert.match(sql, /"preparation_evidence_hash"/u);
    assert.match(sql, /hybrid review child bindings are immutable after preparation/u);
  });

  it("prevents parent cancellation after either child accepts or commits", () => {
    assert.match(sql, /hybrid review children cannot cancel after acceptance or commit/u);
    assert.match(sql, /hybrid review parent cannot cancel after child acceptance or commit/u);
    assert.match(sql, /NEW.accepted_count < OLD.accepted_count/u);
    assert.match(sql, /NEW.committed_count < OLD.committed_count/u);
  });

  it("keeps transition evidence append-only and requires both terminal children", () => {
    assert.match(sql, /hybrid review receipts are append-only/u);
    assert.match(sql, /transition requires an exact receipt/u);
    assert.match(sql, /hybrid review parent cannot become terminal before both children/u);
    assert.match(sql, /"result_evidence_hash"/u);
  });

  it("stores receipt evidence as hashes and keeps invited exclusions purpose-bound to one hybrid public binding", () => {
    assert.doesNotMatch(sql, /"receipt_json"|"email"/u);
    assert.match(sql, /"evidence_hash" text NOT NULL/u);
    assert.match(sql, /"voucher_preparation_hash"/u);
    assert.match(sql, /CREATE TABLE "tokenless_hybrid_network_reviewer_exclusions"/u);
    assert.match(
      sql,
      /"hybrid_operation_id" text NOT NULL[\s\S]*REFERENCES "tokenless_hybrid_review_operations"[\s\S]*ON DELETE CASCADE/u,
    );
    assert.match(
      sql,
      /"binding_id" text NOT NULL[\s\S]*REFERENCES "tokenless_public_network_review_bindings"[\s\S]*ON DELETE CASCADE/u,
    );
    assert.match(sql, /UNIQUE \("binding_id","reviewer_principal_id"\)/u);
    assert.match(sql, /UNIQUE \("binding_id","payout_account"\)/u);
    assert.match(sql, /"exclusion_hash" text NOT NULL/u);
  });

  it("persists exclusions before spend and filters actual profiles before worker selection", () => {
    assert.match(adapter, /INSERT INTO tokenless_hybrid_network_reviewer_exclusions/u);
    assert.match(adapter, /FROM tokenless_principals[\s\S]*status='active'[\s\S]*ORDER BY principal_id FOR SHARE/u);
    assert.match(adapter, /storedExclusions[\s\S]*exactExclusions/u);
    assert.match(adapter, /excludedPrincipalIds:[\s\S]*countEligibleNetwork/u);
    assert.match(worker, /NOT EXISTS \([\s\S]*tokenless_hybrid_network_reviewer_exclusions exclusion/u);
    assert.match(worker, /exclusion\.reviewer_principal_id=profile\.principal_id/u);
    assert.match(worker, /exclusion\.payout_account=lower\(profile\.account_address\)/u);
  });

  it("freezes finite retention and permits deletion only through the legal-hold-aware erasure worker", () => {
    assert.match(sql, /"retention_until" timestamp with time zone NOT NULL/u);
    assert.match(sql, /NEW\.retention_until,NEW\.created_at/u);
    assert.match(sql, /current_setting\('rateloop\.retention_erasure',true\) = 'on'/u);
    assert.match(sql, /"hybrid_reviews_pruned" integer NOT NULL DEFAULT 0/u);
    assert.match(sql, /"hybrid_reviews_held" integer NOT NULL DEFAULT 0/u);
    assert.match(sql, /"hybrid_review_prune_digest"/u);
    assert.match(sql, /\^sha256:\[0-9a-f\]\{64\}\$/u);
    assert.match(retentionWorker, /SELECT 'reviewer_exclusion'[\s\S]*exclusion\.exclusion_hash/u);
    assert.match(
      retentionWorker,
      /DELETE FROM tokenless_hybrid_network_reviewer_exclusions WHERE hybrid_operation_id=\$1/u,
    );
  });

  it("binds every receipt to the correct parent and rejects duplicate parent revisions", () => {
    assert.match(sql, /FOREIGN KEY \("child_id","hybrid_operation_id"\)/u);
    assert.match(sql, /UNIQUE \("child_id","hybrid_operation_id"\)/u);
    assert.match(sql, /"tokenless_hybrid_review_receipts_scope_check"/u);
    assert.match(sql, /"tokenless_hybrid_review_receipts_parent_revision_unique"/u);
  });

  it("guards direct inserts and receipt-gates every lifecycle update", () => {
    assert.match(sql, /hybrid review operations must begin as preparing revision one/u);
    assert.match(sql, /hybrid review children must begin as preparing revision one/u);
    assert.match(sql, /hybrid review child transition requires an exact receipt/u);
    assert.match(sql, /hybrid review parent transition requires an exact receipt/u);
  });
});
