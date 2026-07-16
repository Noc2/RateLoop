import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Feedback Bonus claims keep the recovery preimage in the browser", () => {
  const source = readFileSync(new URL("./FeedbackBonusClaimsClient.tsx", import.meta.url), "utf8");
  assert.match(source, /Claim a Feedback Bonus/u);
  assert.match(source, /importTokenlessRecoveryPackage/u);
  assert.match(source, /rateloop:rater-recovery:/u);
  assert.match(source, /feedback-bonus-entitlements\?roundId=/u);
  assert.match(source, /voteKey=/u);
  assert.match(source, /buildFeedbackBonusClaimAuthorization/u);
  assert.match(source, /verifyFeedbackBonusClaimEvidence/u);
  assert.match(source, /sendTransaction/u);
  assert.match(source, /Feedback Bonus evidence matches this local recovery package/u);
  assert.doesNotMatch(source, /body:\s*JSON\.stringify/u);
});
