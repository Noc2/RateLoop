import {
  REVIEWER_LIFECYCLE_NOTIFICATION_HREFS,
  canonicalReviewerNotificationHref,
  isReviewerDeadlineOrMoneyNotification,
} from "./reviewerInbox";
import assert from "node:assert/strict";
import test from "node:test";

test("reviewer lifecycle destinations follow the next user action and repair persisted legacy links", () => {
  assert.deepEqual(REVIEWER_LIFECYCLE_NOTIFICATION_HREFS, {
    "assignment.available": "/human/review",
    // A reminder sends the reviewer to the same queue as the original notice:
    // the next action is identical, only the urgency differs.
    "assignment.deadline_approaching": "/human/review",
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

test("a deadline reminder counts as a deadline notification, not ordinary availability", () => {
  // The inbox surfaces this class more prominently, so a reminder that fell into
  // the ordinary bucket would be delivered but not stand out -- which is the
  // whole point of sending it.
  assert.equal(isReviewerDeadlineOrMoneyNotification({ sourceType: "assignment.deadline_approaching" }), true);
  assert.equal(isReviewerDeadlineOrMoneyNotification({ sourceType: "settlement.reveal_required" }), true);
  assert.equal(isReviewerDeadlineOrMoneyNotification({ sourceType: "settlement.claim_expiring" }), true);
  assert.equal(isReviewerDeadlineOrMoneyNotification({ sourceType: "assignment.available" }), false);
  assert.equal(isReviewerDeadlineOrMoneyNotification({ sourceType: "assignment.completed" }), false);
});
