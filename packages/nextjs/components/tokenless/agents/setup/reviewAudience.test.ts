import {
  DEFAULT_PUBLIC_BOUNTY_PER_SEAT_ATOMIC,
  buildReviewAudienceRequestProfile,
  privateClassificationsThrough,
  reviewAudienceFormValues,
} from "./reviewAudience";
import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSetupReviewDraft } from "~~/lib/tokenless/workspaceAgentSetup";

const baseProfile: AgentSetupReviewDraft["requestProfile"] = {
  questionAuthority: "owner_fixed",
  resultSemantics: "assurance",
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
  configurationStatus: "ready",
};

test("audience form resumes the saved audience and private sensitivity", () => {
  assert.deepEqual(reviewAudienceFormValues(baseProfile), {
    audience: "private_invited",
    privateSensitivity: "confidential",
  });
  assert.deepEqual(reviewAudienceFormValues(undefined), {
    audience: "private_invited",
    privateSensitivity: "confidential",
  });
});

test("private invited review forces private material while preserving compensation", () => {
  const paidProfile = { ...baseProfile, compensationMode: "usdc" as const, bountyPerSeatAtomic: "2500000" };
  const result = buildReviewAudienceRequestProfile(paidProfile, {
    audience: "private_invited",
    privateSensitivity: "regulated",
  });

  assert.equal(result.contentBoundary, "private_workspace");
  assert.equal(result.privateSensitivity, "regulated");
  assert.equal(result.privateGroupId, "pgrp_reviewers");
  assert.equal(result.compensationMode, "usdc");
  assert.equal(result.bountyPerSeatAtomic, "2500000");
  assert.equal(result.panelSize, 2);
});

test("public network review forces public-safe paid invariants and clears the private group", () => {
  const result = buildReviewAudienceRequestProfile(baseProfile, {
    audience: "public_network",
    privateSensitivity: "confidential",
  });

  assert.equal(result.contentBoundary, "public_or_test");
  assert.equal(result.privateSensitivity, null);
  assert.equal(result.privateGroupId, null);
  assert.equal(result.compensationMode, "usdc");
  assert.equal(result.bountyPerSeatAtomic, DEFAULT_PUBLIC_BOUNTY_PER_SEAT_ATOMIC);
  assert.equal(result.panelSize, 3);
  assert.equal("configurationStatus" in result, false);
});

test("hybrid review preserves its invited group and an existing paid amount", () => {
  const result = buildReviewAudienceRequestProfile(
    { ...baseProfile, panelSize: 5, compensationMode: "usdc", bountyPerSeatAtomic: "7500000" },
    { audience: "hybrid", privateSensitivity: "restricted" },
  );

  assert.equal(result.contentBoundary, "public_or_test");
  assert.equal(result.privateSensitivity, null);
  assert.equal(result.privateGroupId, "pgrp_reviewers");
  assert.equal(result.compensationMode, "usdc");
  assert.equal(result.bountyPerSeatAtomic, "7500000");
  assert.equal(result.panelSize, 5);
});

test("private-group classifications stop at the selected sensitivity", () => {
  assert.deepEqual(privateClassificationsThrough("internal"), ["internal"]);
  assert.deepEqual(privateClassificationsThrough("confidential"), ["internal", "confidential"]);
  assert.deepEqual(privateClassificationsThrough("restricted"), ["internal", "confidential", "restricted"]);
  assert.deepEqual(privateClassificationsThrough("regulated"), ["internal", "confidential", "restricted", "regulated"]);
});
