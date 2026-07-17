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
  assert.match(source, /When should RateLoop require human review\?/);
  assert.match(source, /If review is required, what may the agent do\?/);
  assert.match(source, /Adaptive — Recommended/);
  assert.match(source, /aria-describedby=\{frequencyDescriptionId\}/);
  assert.match(source, /aria-describedby=\{authorityDescriptionId\}/);
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
    "Send requests within the saved limits. Requires a separate owner-approved publishing grant. No funding permission is needed.",
  );
  assert.equal(
    reviewRoutingAuthorityDescription("ask_automatically", true),
    "Send requests within the saved limits. Requires owner-approved publishing and funding permission.",
  );
  assert.match(source, /disabled=\{value === "ask_automatically" && !automaticAvailable\}/);
  assert.match(source, /Ask automatically is unavailable/);
});
