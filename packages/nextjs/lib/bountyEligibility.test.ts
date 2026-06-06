import {
  BOUNTY_ELIGIBILITY_PASSPORT,
  BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG,
  BOUNTY_ELIGIBILITY_VERIFIED_HUMAN,
  buildBountyEligibility,
  getBountyEligibilityKinds,
  getBountyEligibilityLabel,
  getBountyEligibilityRequirement,
  isSupportedBountyEligibility,
} from "./bountyEligibility";
import assert from "node:assert/strict";
import test from "node:test";

test("bounty eligibility uses credential masks and supports OR scopes", () => {
  assert.equal(BOUNTY_ELIGIBILITY_PASSPORT, 4);
  assert.equal(BOUNTY_ELIGIBILITY_VERIFIED_HUMAN, 8);

  const passportOrHuman = buildBountyEligibility(
    BOUNTY_ELIGIBILITY_PASSPORT | BOUNTY_ELIGIBILITY_VERIFIED_HUMAN,
    false,
  );

  assert.equal(passportOrHuman, 12);
  assert.deepEqual(getBountyEligibilityKinds(passportOrHuman), [2, 3]);
  assert.equal(getBountyEligibilityLabel(passportOrHuman), "Passport or Proof of Human");
});

test("bounty eligibility recent recheck flag layers on credential masks", () => {
  const recentPassportOrHuman = buildBountyEligibility(
    BOUNTY_ELIGIBILITY_PASSPORT | BOUNTY_ELIGIBILITY_VERIFIED_HUMAN,
    true,
  );

  assert.equal(recentPassportOrHuman, BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG | 12);
  assert.deepEqual(getBountyEligibilityRequirement(recentPassportOrHuman), {
    credentialMask: 12,
    kinds: [2, 3],
    requiresRecentRecheck: true,
  });
  assert.equal(getBountyEligibilityLabel(recentPassportOrHuman), "Passport or Proof of Human + recent recheck");
});

test("bounty eligibility rejects unsupported bits and bare recent recheck", () => {
  assert.equal(isSupportedBountyEligibility(0), true);
  assert.equal(isSupportedBountyEligibility(1), false);
  assert.equal(isSupportedBountyEligibility(16), false);
  assert.equal(isSupportedBountyEligibility(256), false);
  assert.equal(isSupportedBountyEligibility(BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG), false);
});
