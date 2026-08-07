import {
  MAX_REVIEW_PANEL_SIZE,
  MAX_REVIEW_RESPONSE_WINDOW_SECONDS,
  MIN_REVIEW_PANEL_SIZE,
  MIN_REVIEW_RESPONSE_WINDOW_SECONDS,
  buildReviewTimingRequestProfile,
  reviewTimingFormValues,
} from "./reviewTiming";
import assert from "node:assert/strict";
import test from "node:test";
import { MAXIMUM_REVIEW_PANEL_SIZE, MINIMUM_REVIEW_PANEL_SIZE } from "~~/lib/tokenless/reviewPanelPolicy";
import type { AgentSetupReviewDraft } from "~~/lib/tokenless/workspaceAgentSetup";

const profile: Omit<AgentSetupReviewDraft["requestProfile"], "configurationStatus"> = {
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
};

test("review timing resumes the exact frozen window and panel size", () => {
  assert.equal(reviewTimingFormValues(undefined).panelSize, String(MIN_REVIEW_PANEL_SIZE));
  assert.deepEqual(reviewTimingFormValues({ ...profile, configurationStatus: "ready" }), {
    responseWindowSeconds: "3600",
    panelSize: "2",
  });
});

test("private and public profiles enforce their real panel minimums", () => {
  assert.equal(
    buildReviewTimingRequestProfile(profile, { responseWindowSeconds: "7200", panelSize: "2" }).panelSize,
    MIN_REVIEW_PANEL_SIZE,
  );
  assert.throws(
    () => buildReviewTimingRequestProfile(profile, { responseWindowSeconds: "7200", panelSize: "1" }),
    /Reviewers per request must be between 2 and 100/,
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
    /Reviewers per request must be between 3 and 100/,
  );
});

test("the wizard offers exactly the panel sizes the server accepts", () => {
  // A wizard bound wider than the server's produces a form that validates and
  // then fails on save, so these must stay identical.
  assert.equal(MIN_REVIEW_PANEL_SIZE, MINIMUM_REVIEW_PANEL_SIZE);
  assert.equal(MAX_REVIEW_PANEL_SIZE, MAXIMUM_REVIEW_PANEL_SIZE);
  assert.equal(
    buildReviewTimingRequestProfile(profile, {
      responseWindowSeconds: "7200",
      panelSize: String(MAX_REVIEW_PANEL_SIZE),
    }).panelSize,
    MAX_REVIEW_PANEL_SIZE,
  );
  assert.throws(
    () =>
      buildReviewTimingRequestProfile(profile, {
        responseWindowSeconds: "7200",
        panelSize: String(MAX_REVIEW_PANEL_SIZE + 1),
      }),
    /Reviewers per request must be between 2 and 100/,
  );
});

test("response window accepts only the protocol range", () => {
  assert.equal(
    buildReviewTimingRequestProfile(profile, {
      responseWindowSeconds: String(MIN_REVIEW_RESPONSE_WINDOW_SECONDS),
      panelSize: "2",
    }).responseWindowSeconds,
    MIN_REVIEW_RESPONSE_WINDOW_SECONDS,
  );
  assert.equal(
    buildReviewTimingRequestProfile(profile, {
      responseWindowSeconds: String(MAX_REVIEW_RESPONSE_WINDOW_SECONDS),
      panelSize: "2",
    }).responseWindowSeconds,
    MAX_REVIEW_RESPONSE_WINDOW_SECONDS,
  );
  assert.throws(
    () => buildReviewTimingRequestProfile(profile, { responseWindowSeconds: "1199", panelSize: "2" }),
    /Response window must be between 1200 and 86400/,
  );
  assert.throws(
    () => buildReviewTimingRequestProfile(profile, { responseWindowSeconds: "3600.5", panelSize: "2" }),
    /whole number/,
  );
});
