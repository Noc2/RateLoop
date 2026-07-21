import {
  reviewRoutingAuthorityDescription,
  reviewRoutingModeDescription,
  reviewRoutingStateForMode,
} from "./ReviewRoutingFields";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ReviewRoutingFields.tsx", import.meta.url), "utf8");

test("review routing keeps selection and authority together with accessible explanations", () => {
  assert.match(source, /Review routing/);
  assert.match(source, /export function ReviewFrequencyFields/);
  assert.match(source, /export function ReviewAuthorityFields/);
  assert.match(source, /<ReviewFrequencyFields/);
  assert.match(source, /<ReviewAuthorityFields/);
  assert.match(source, /When should RateLoop require human review\?/);
  assert.match(source, /If review is required, what may the agent do\?/);
  assert.match(source, /Adaptive — Recommended/);
  assert.match(source, /aria-describedby=\{frequencyDescriptionId\}/);
  assert.match(source, /type="radio"/);
  assert.match(source, /aria-describedby=\{describedBy\}/);
  assert.match(source, /Decides when an eligible output requires human review/);
  assert.match(source, /does not authorize sending or funding a\s+request/);
  assert.match(source, /Applies only after review is required/);
  assert.match(source, /controls whether the agent checks, prepares, or sends a\s+request/);
});

test("manual handoff has exact copy and hides the authority field", () => {
  assert.equal(reviewRoutingModeDescription("manual"), "Never requires review automatically. You start each handoff.");
  assert.match(source, /mode !== "manual"/);
  assert.match(source, /Manual handoff only/);
  assert.deepEqual(reviewRoutingStateForMode("manual", "ask_automatically"), {
    mode: "manual",
    authority: "check_only",
  });
  assert.deepEqual(reviewRoutingStateForMode("always", "check_only"), {
    mode: "always",
    authority: "check_only",
  });
});

test("automatic request consequences distinguish unpaid private review from funded review", () => {
  assert.equal(
    reviewRoutingAuthorityDescription("ask_automatically", false),
    "After an explicit eligibility check, send required requests within the saved limits. This does not run the check. An owner-approved publishing grant is required; funding permission is not.",
  );
  assert.equal(
    reviewRoutingAuthorityDescription("ask_automatically", true),
    "After an explicit eligibility check, send required requests within the saved limits. This does not run the check. Owner-approved publishing and funding permission are required.",
  );
  assert.equal(
    reviewRoutingAuthorityDescription("prepare_for_approval", false),
    "Create a draft request, then wait for a workspace owner to approve and send it.",
  );
  assert.equal(
    reviewRoutingAuthorityDescription("check_only", false),
    "Report that review is required without creating or sending a request.",
  );
  assert.match(source, /disabled=\{automaticUnavailable\}/);
  assert.match(source, /aria-describedby=\{automaticAvailable \? undefined : authorityUnavailableId\}/);
  assert.match(source, /\{automaticUnavailableReason\}/);
  assert.doesNotMatch(source, /Unavailable: \{automaticUnavailableReason\}/);
  assert.match(source, /Send automatically/);
});
