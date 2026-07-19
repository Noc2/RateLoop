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
  assert.match(source, /paid commit(?:&apos;|')s\s+public tlock ciphertext becomes decryptable/u);
  assert.match(source, /vote, prediction, response hash, payout address, and salt/u);
  assert.match(source, /even\s+without a reveal or claim/u);
  assert.match(
    source,
    /public tlock ciphertext becomes decryptable after the\s+commit deadline with no post-commit abort/u,
  );
  assert.doesNotMatch(source, /body:\s*JSON\.stringify/u);
});

test("recovery and public-chain consequences remain visible before claim", () => {
  const source = readFileSync(new URL("./FeedbackBonusClaimsClient.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /<details/u);
  assert.match(source, /needsRecoverySecret \? \([\s\S]*<div[\s\S]*Recovery secret[\s\S]*type="password"/u);
  assert.match(source, /Claiming later submits\s+the payout address and salt on-chain/u);
  assert.ok(source.indexOf("public tlock ciphertext becomes decryptable") < source.indexOf('"Claim bonus"'));
});
