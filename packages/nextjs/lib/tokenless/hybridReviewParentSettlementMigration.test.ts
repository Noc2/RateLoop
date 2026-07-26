import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const sql = readFileSync(resolve(process.cwd(), "drizzle/0146_hybrid_review_parent_settlement.sql"), "utf8");

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

  it("stores only purpose-bound hashes rather than reviewer identities or raw receipt payloads", () => {
    assert.doesNotMatch(sql, /"receipt_json"|"principal_id"|"reviewer_account"|"payout_account"|"email"/u);
    assert.match(sql, /"evidence_hash" text NOT NULL/u);
    assert.match(sql, /"voucher_preparation_hash"/u);
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
