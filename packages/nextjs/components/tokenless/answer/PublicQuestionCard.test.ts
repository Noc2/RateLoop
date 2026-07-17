import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./PublicQuestionCard.tsx", import.meta.url), "utf8");

test("public rating progressively collects feedback without LREP and hides the aggregate until settlement", () => {
  assert.match(source, /Rating hidden until settlement\./);
  assert.match(source, /Add feedback/);
  assert.match(source, /Optional feedback/);
  assert.match(source, /Feedback required/);
  assert.match(source, /Feedback category/);
  assert.match(source, /Source URL/);
  assert.match(source, /feedbackEnabled = task\.question\.rationale\?\.mode !== "off"/);
  assert.match(source, /\{feedbackEnabled &&/);
  assert.doesNotMatch(source, /\bLREP\b/);
  assert.match(source, /Quality bonus up to/);
  assert.match(source, /Insight bonus up to/);
  assert.doesNotMatch(source, /RBTS up to|Surprise up to/);
});

test("an already reserved voucher retries the prepared device queue and waits for confirmation", () => {
  assert.match(source, /createIndexedDbTokenlessCommitQueue\(\)\s*\.list\(\)/);
  assert.match(source, /Retry submission/);
  assert.match(source, /\/api\/rater\/commits\/\$\{encodeURIComponent/);
  assert.match(source, /Confirmation is pending/);
  assert.match(source, /remove\(savedCommit\.queueId\)/);
  assert.match(source, /<ReviewerShell/);
  assert.match(source, /<DeadlineChip/);
  assert.match(source, /loadReviewDraft\("public"/);
  assert.match(source, /saveReviewDraft\("public"/);
  assert.match(source, /clearReviewDraft\("public"/);
  assert.match(source, /generateDeviceRecoverySecret\(\)/);
  assert.match(source, /storeDeviceRecovery\(recoveryRecord\)/);
  assert.match(source, /Download backup/);
  assert.match(source, /Submitting…/);
  assert.match(source, /Recorded/);
  assert.match(source, /Technical details/);
  assert.doesNotMatch(source, /Recovery secret/);
});

test("binary review instructions stay neutral for feedback questions", () => {
  assert.match(source, /Choose one answer, then estimate how the panel will respond/);
  assert.doesNotMatch(source, /Choose the stronger answer/);
});
