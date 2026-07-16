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
});

test("an already reserved voucher retries the prepared device queue and waits for confirmation", () => {
  assert.match(source, /createIndexedDbTokenlessCommitQueue\(\)\s*\.list\(\)/);
  assert.match(source, /Retry saved submission/);
  assert.match(source, /\/api\/rater\/commits\/\$\{encodeURIComponent/);
  assert.match(source, /confirmation is still pending/i);
  assert.match(source, /remove\(savedCommit\.queueId\)/);
});
