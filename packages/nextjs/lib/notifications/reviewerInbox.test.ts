import { REVIEWER_LIFECYCLE_NOTIFICATION_HREFS, canonicalReviewerNotificationHref } from "./reviewerInbox";
import assert from "node:assert/strict";
import test from "node:test";

test("reviewer lifecycle destinations follow the next user action and repair persisted legacy links", () => {
  assert.deepEqual(REVIEWER_LIFECYCLE_NOTIFICATION_HREFS, {
    "assignment.available": "/human/review",
    "assignment.completed": "/human/history",
    "settlement.reveal_required": "/human/profile?section=paid-settlement",
    "settlement.claim_expiring": "/human/profile?section=paid-settlement",
  });

  for (const [sourceType, href] of Object.entries(REVIEWER_LIFECYCLE_NOTIFICATION_HREFS)) {
    assert.equal(canonicalReviewerNotificationHref({ href: "/human?tab=discover", sourceType }), href);
  }
  assert.equal(
    canonicalReviewerNotificationHref({ href: "/agents/results", sourceType: "ask.result" }),
    "/agents/results",
  );
  assert.equal(canonicalReviewerNotificationHref({ sourceType: "ask.result" }), null);
});
