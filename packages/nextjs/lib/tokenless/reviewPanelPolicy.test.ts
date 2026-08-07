import { MAX_REVIEW_PANEL_SIZE, MIN_REVIEW_PANEL_SIZE, TOKENLESS_RESULT_JSON_SCHEMA } from "@rateloop/sdk";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  MAXIMUM_REVIEW_PANEL_SIZE,
  MINIMUM_REVIEW_PANEL_SIZE,
  minimumReviewPanelSizeForAudience,
} from "~~/lib/tokenless/reviewPanelPolicy";

const LIB = fileURLToPath(new URL(".", import.meta.url));

function panelSchema(index: number) {
  const economics = TOKENLESS_RESULT_JSON_SCHEMA.properties.reviewEconomics.anyOf[index] as {
    properties: { panelSize: { maximum: number; minimum: number } };
  };
  return economics.properties.panelSize;
}

test("the panel-size bounds the server enforces are the bounds every layer states", () => {
  // The server bound is canonical: a profile outside it is rejected on save.
  assert.equal(MINIMUM_REVIEW_PANEL_SIZE, 2);
  assert.equal(MAXIMUM_REVIEW_PANEL_SIZE, 100);
  assert.equal(minimumReviewPanelSizeForAudience("private_invited"), MINIMUM_REVIEW_PANEL_SIZE);
  assert.equal(minimumReviewPanelSizeForAudience("public_network"), 3);
  assert.equal(minimumReviewPanelSizeForAudience("hybrid"), 3);

  // The published SDK is the only bound an integrator can read.
  assert.equal(MIN_REVIEW_PANEL_SIZE, MINIMUM_REVIEW_PANEL_SIZE);
  assert.equal(MAX_REVIEW_PANEL_SIZE, MAXIMUM_REVIEW_PANEL_SIZE);
  for (const index of [1, 2]) {
    assert.deepEqual(panelSchema(index), {
      maximum: MAXIMUM_REVIEW_PANEL_SIZE,
      minimum: MINIMUM_REVIEW_PANEL_SIZE,
      type: "integer",
    });
  }
});

test("server modules read the shared bounds instead of restating them", () => {
  // Six layers disagreed because each wrote its own literal. Whichever layer
  // regresses, it regresses by hardcoding a number here again.
  for (const file of [
    "reviewRequestProfiles.ts",
    "effectiveAgentReviewContext.ts",
    "workspaceAgentSetup.ts",
    "humanReviewApprovals.ts",
    "humanReviewRequestPreparation.ts",
    "paidReviewVoucherReceipts.ts",
  ]) {
    const source = readFileSync(`${LIB}${file}`, "utf8");
    assert.match(source, /from "~~\/lib\/tokenless\/reviewPanelPolicy"/u, `${file} must import the shared bounds`);
    assert.doesNotMatch(source, /panelSize[^\n]*\b(?:500|100)\b/u, `${file} must not restate a panel-size literal`);
  }
});
