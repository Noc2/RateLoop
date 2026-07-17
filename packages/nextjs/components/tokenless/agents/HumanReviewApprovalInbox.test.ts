import { formatApprovalUsdc } from "./HumanReviewApprovalInbox";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("approval inbox formats exact atomic USDC values", () => {
  assert.equal(formatApprovalUsdc("2650000"), "2.65 USDC");
});

test("approval inbox shows frozen terms and submits optimistic approve or reject decisions", () => {
  const source = readFileSync(new URL("./HumanReviewApprovalInbox.tsx", import.meta.url), "utf8");
  for (const label of [
    "Reviewers",
    "Answer window",
    "Panel",
    "Maximum charge",
    "Compensation",
    "Fee",
    "Material",
    "Expires",
    "Frozen terms and provenance",
    "Agent-written feedback question",
    "Question commitment",
    "Source commitment",
    "Suggestion commitment",
  ]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /preparedRequestHash: approval\.preparedRequestHash/);
  assert.match(source, /derivedEconomicsHash: approval\.derivedEconomicsHash/);
  assert.match(source, /decision: ApprovalDecision/);
  assert.match(source, /method: "PUT"/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /applyOptimisticApprovalDecision/);
  assert.match(source, /confirmApprovalDecision/);
  assert.match(source, /rollbackApprovalDecision/);
  assert.doesNotMatch(source, /await load\(undefined, false\)/);
  assert.match(source, /Could not \$\{action\} the request/);
  assert.match(source, /Keys: J\/K move · A approve · D decline/);
  assert.match(source, /aria-keyshortcuts="J K A D"/);
  assert.match(source, /key === "j" \|\| key === "k"/);
});
