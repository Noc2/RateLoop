import {
  buildReviewCompensationConfiguration,
  reviewCompensationFormValues,
  usdcAtomicToDecimal,
} from "./reviewCompensation";
import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSetupReviewDraft } from "~~/lib/tokenless/workspaceAgentSetup";

const profile: Omit<AgentSetupReviewDraft["requestProfile"], "configurationStatus"> = {
  criterion: "Is this response safe and correct?",
  positiveLabel: "Approve",
  negativeLabel: "Reject",
  rationaleMode: "required",
  audience: "private_invited",
  contentBoundary: "private_workspace",
  privateSensitivity: "confidential",
  privateGroupId: "pgrp_reviewers",
  responseWindowSeconds: 3_600,
  panelSize: 2,
  compensationMode: "unpaid",
  bountyPerSeatAtomic: null,
};

test("compensation form resumes exact paid USDC and authority values", () => {
  assert.deepEqual(
    reviewCompensationFormValues(
      { ...profile, compensationMode: "usdc", bountyPerSeatAtomic: "2500000", configurationStatus: "ready" },
      "prepare_for_approval",
    ),
    { compensationMode: "usdc", usdcPerReviewer: "2.5", authority: "prepare_for_approval" },
  );
});

test("unpaid invited review clears the base bounty", () => {
  const result = buildReviewCompensationConfiguration(profile, {
    compensationMode: "unpaid",
    usdcPerReviewer: "9.75",
    authority: "check_only",
  });
  assert.equal(result.requestProfile.compensationMode, "unpaid");
  assert.equal(result.requestProfile.bountyPerSeatAtomic, null);
  assert.equal(result.authority, "check_only");
});

test("paid invited review converts up to six decimals exactly", () => {
  const minimum = buildReviewCompensationConfiguration(profile, {
    compensationMode: "usdc",
    usdcPerReviewer: "0.000001",
    authority: "prepare_for_approval",
  });
  const fractional = buildReviewCompensationConfiguration(profile, {
    compensationMode: "usdc",
    usdcPerReviewer: "001.234567",
    authority: "ask_automatically",
  });
  assert.equal(minimum.requestProfile.bountyPerSeatAtomic, "1");
  assert.equal(fractional.requestProfile.bountyPerSeatAtomic, "1234567");
  assert.equal(fractional.authority, "ask_automatically");
});

test("public and hybrid audiences force paid USDC", () => {
  for (const audience of ["public_network", "hybrid"] as const) {
    const result = buildReviewCompensationConfiguration(
      { ...profile, audience, contentBoundary: "public_or_test", privateSensitivity: null, panelSize: 3 },
      { compensationMode: "unpaid", usdcPerReviewer: "1", authority: "check_only" },
    );
    assert.equal(result.requestProfile.compensationMode, "usdc");
    assert.equal(result.requestProfile.bountyPerSeatAtomic, "1000000");
  }
});

test("USDC conversion rejects zero, unsupported precision, and non-decimal notation", () => {
  for (const usdcPerReviewer of ["", "0", "0.000000", "0.0000001", "-1", "1e-6"]) {
    assert.throws(
      () =>
        buildReviewCompensationConfiguration(profile, {
          compensationMode: "usdc",
          usdcPerReviewer,
          authority: "check_only",
        }),
      /USDC per reviewer/,
    );
  }
});

test("USDC conversion preserves atomic values without floating point", () => {
  assert.equal(usdcAtomicToDecimal("1"), "0.000001");
  assert.equal(usdcAtomicToDecimal("1234567"), "1.234567");
  assert.equal(usdcAtomicToDecimal("1000000"), "1");
});

test("compensation composition rejects an unknown authority", () => {
  assert.throws(
    () =>
      buildReviewCompensationConfiguration(profile, {
        compensationMode: "unpaid",
        usdcPerReviewer: "1",
        authority: "unknown" as AgentSetupReviewDraft["authority"],
      }),
    /valid agent authority/,
  );
});
