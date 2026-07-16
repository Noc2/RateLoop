import {
  MAX_REVIEW_RESPONSE_WINDOW_SECONDS,
  MIN_REVIEW_RESPONSE_WINDOW_SECONDS,
  buildReviewTimingRequestProfile,
  reviewTimingFormValues,
} from "./reviewTiming";
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
  panelSize: 1,
  compensationMode: "unpaid",
  bountyPerSeatAtomic: null,
};

test("review timing resumes the exact frozen window and panel size", () => {
  assert.deepEqual(reviewTimingFormValues({ ...profile, configurationStatus: "ready" }), {
    responseWindowSeconds: "3600",
    panelSize: "1",
  });
});

test("private and public profiles enforce their real panel minimums", () => {
  assert.equal(
    buildReviewTimingRequestProfile(profile, { responseWindowSeconds: "7200", panelSize: "1" }).panelSize,
    1,
  );
  assert.equal(
    buildReviewTimingRequestProfile(
      { ...profile, audience: "public_network", contentBoundary: "public_or_test", privateSensitivity: null },
      { responseWindowSeconds: "7200", panelSize: "3" },
    ).panelSize,
    3,
  );
  assert.throws(
    () =>
      buildReviewTimingRequestProfile(
        { ...profile, audience: "hybrid", contentBoundary: "public_or_test", privateSensitivity: null },
        { responseWindowSeconds: "7200", panelSize: "2" },
      ),
    /Reviewer count must be between 3 and 500/,
  );
});

test("response window accepts only the protocol range", () => {
  assert.equal(
    buildReviewTimingRequestProfile(profile, {
      responseWindowSeconds: String(MIN_REVIEW_RESPONSE_WINDOW_SECONDS),
      panelSize: "1",
    }).responseWindowSeconds,
    MIN_REVIEW_RESPONSE_WINDOW_SECONDS,
  );
  assert.equal(
    buildReviewTimingRequestProfile(profile, {
      responseWindowSeconds: String(MAX_REVIEW_RESPONSE_WINDOW_SECONDS),
      panelSize: "1",
    }).responseWindowSeconds,
    MAX_REVIEW_RESPONSE_WINDOW_SECONDS,
  );
  assert.throws(
    () => buildReviewTimingRequestProfile(profile, { responseWindowSeconds: "1199", panelSize: "1" }),
    /Response window must be between 1200 and 86400/,
  );
  assert.throws(
    () => buildReviewTimingRequestProfile(profile, { responseWindowSeconds: "3600.5", panelSize: "1" }),
    /whole number/,
  );
});
