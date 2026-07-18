import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Feedback Bonus claims keep the recovery preimage in the browser", () => {
  const source = readFileSync(new URL("./FeedbackBonusClaimsClient.tsx", import.meta.url), "utf8");
  assert.match(source, /Claim a Feedback Bonus/u);
  assert.match(source, /importTokenlessRecoveryPackage/u);
  assert.match(source, /listDeviceRecoveries/u);
  assert.match(source, /parseDeviceRecoveryBackup/u);
  assert.match(source, /readBrowserSession/u);
  assert.match(source, /listDeviceRecoveries\(nextPrincipalId\)/u);
  assert.match(source, /backup\.record\.principalId !== session\.principalId/u);
  assert.match(source, /This recovery backup belongs to another RateLoop account/u);
  assert.match(source, /Recovery secret/u);
  assert.doesNotMatch(source, /LEGACY_RECOVERY_PREFIX/u);
  assert.doesNotMatch(source, /localStorage/u);
  assert.match(source, /feedback-bonus-entitlements\?roundId=/u);
  assert.match(source, /voteKey=/u);
  assert.match(source, /buildFeedbackBonusClaimAuthorization/u);
  assert.match(source, /verifyFeedbackBonusClaimEvidence/u);
  assert.match(source, /sendTransaction/u);
  assert.match(source, /Feedback Bonus evidence matches this saved review/u);
  assert.doesNotMatch(source, /body:\s*JSON\.stringify/u);
});
