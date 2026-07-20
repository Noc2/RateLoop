import { reconcileSetupAutomaticAuthority, setupAutomaticSendingEligibility } from "./reviewAutomaticSending";
import assert from "node:assert/strict";
import test from "node:test";

const ELIGIBLE = {
  audience: "private_invited" as const,
  compensationMode: "unpaid" as const,
  feedbackBonusEnabled: false,
  grantAvailable: true,
};

test("setup automatic sending explains the first unmet prerequisite", () => {
  assert.deepEqual(setupAutomaticSendingEligibility({ ...ELIGIBLE, audience: "public_network" }), {
    available: false,
    reason: "Choose Invited reviewers to enable automatic sending during setup.",
  });
  assert.deepEqual(
    setupAutomaticSendingEligibility({
      ...ELIGIBLE,
      audience: "hybrid",
      compensationMode: "usdc",
      feedbackBonusEnabled: true,
    }),
    {
      available: false,
      reason: "Choose Invited reviewers to enable automatic sending during setup.",
    },
  );
  assert.deepEqual(setupAutomaticSendingEligibility({ ...ELIGIBLE, compensationMode: "usdc" }), {
    available: false,
    reason: "Choose No bounty to enable automatic sending during setup.",
  });
  assert.deepEqual(setupAutomaticSendingEligibility({ ...ELIGIBLE, feedbackBonusEnabled: true }), {
    available: false,
    reason: "Choose No bonus to enable automatic sending during setup.",
  });
});

test("setup automatic sending surfaces connection capability only after prerequisites match", () => {
  assert.deepEqual(setupAutomaticSendingEligibility({ ...ELIGIBLE, grantAvailable: false }), {
    available: false,
    reason: "Automatic sending isn’t available for this connection.",
  });
  assert.deepEqual(setupAutomaticSendingEligibility(ELIGIBLE), { available: true, reason: null });
});

test("incompatible automatic authority falls back without changing safer selections", () => {
  const unavailable = setupAutomaticSendingEligibility({ ...ELIGIBLE, compensationMode: "usdc" });
  assert.deepEqual(reconcileSetupAutomaticAuthority("ask_automatically", unavailable), {
    authority: "prepare_for_approval",
    changed: true,
  });
  assert.deepEqual(reconcileSetupAutomaticAuthority("prepare_for_approval", unavailable), {
    authority: "prepare_for_approval",
    changed: false,
  });
  assert.deepEqual(reconcileSetupAutomaticAuthority("check_only", unavailable), {
    authority: "check_only",
    changed: false,
  });
  assert.deepEqual(reconcileSetupAutomaticAuthority("ask_automatically", setupAutomaticSendingEligibility(ELIGIBLE)), {
    authority: "ask_automatically",
    changed: false,
  });
});
