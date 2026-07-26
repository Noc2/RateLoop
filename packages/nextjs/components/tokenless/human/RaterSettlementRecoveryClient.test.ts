import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./RaterSettlementRecoveryClient.tsx", import.meta.url), "utf8");

test("paid settlement recovery keeps all private material in the browser", () => {
  assert.match(source, /Reveal and claim paid reviews/u);
  assert.match(source, /importTokenlessRecoveryPackage/u);
  assert.match(source, /listDeviceRecoveries/u);
  assert.match(source, /backup\.record\.principalId !== session\.principalId/u);
  assert.match(source, /buildRaterRevealAuthorization/u);
  assert.match(source, /buildRaterClaimAuthorization/u);
  assert.match(source, /verifyRaterSettlementEvidence/u);
  assert.match(source, /sendTransaction/u);
  assert.match(source, /\/api\/rater\/\$\{path\}\?roundId=/u);
  assert.doesNotMatch(source, /body:\s*JSON\.stringify/u);
  assert.doesNotMatch(source, /votePrivateKey\s*:/u);
});

test("the claim deadline, outcome, amount, and permissionless relay are visible", () => {
  assert.match(source, /Claim deadline/u);
  assert.match(source, /Review outcome/u);
  assert.match(source, /Earned/u);
  assert.match(source, /Any wallet may relay/u);
  assert.match(source, /Funds still go only to the saved payout address/u);
  assert.match(source, /View confirmed transaction/u);
});
