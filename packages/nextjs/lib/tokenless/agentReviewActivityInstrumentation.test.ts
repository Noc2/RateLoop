import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function source(name: string) {
  return readFileSync(join(process.cwd(), "lib", "tokenless", name), "utf8");
}

test("review activity timestamps advance only on new lifecycle transitions", () => {
  const decision = source("adaptiveReviewService.ts");
  const request = source("adaptiveReviewOrchestration.ts");
  const result = source("adaptiveReviewEvidence.ts");

  const newOpportunity = decision.slice(
    decision.indexOf("if (!opportunity)"),
    decision.indexOf("const state = await assuranceState"),
  );
  assert.match(newOpportunity, /SET last_decision_at = CASE/);
  assert.match(newOpportunity, /human_review_binding_id = \$6 AND human_review_binding_version = \$7/);

  assert.match(request, /if \(status === "decided"\) \{[\s\S]*SET last_request_at = CASE/);
  assert.match(result, /rowString\(row, "status"\) === "review_requested"[\s\S]*SET last_result_at = CASE/);

  for (const text of [newOpportunity, request, result]) {
    assert.match(text, /IS NULL OR last_(?:decision|request|result)_at < \$1 THEN \$1/);
  }
});
