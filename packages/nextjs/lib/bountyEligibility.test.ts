import {
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

test("bounty eligibility supports the v3 Proof of Human mask", () => {
  assert.equal(BOUNTY_ELIGIBILITY_VERIFIED_HUMAN, 8);

  const verifiedHuman = buildBountyEligibility(BOUNTY_ELIGIBILITY_VERIFIED_HUMAN, false);

  assert.equal(verifiedHuman, 8);
  assert.deepEqual(getBountyEligibilityKinds(verifiedHuman), [3]);
  assert.equal(getBountyEligibilityLabel(verifiedHuman), "Proof of Human");
});

test("bounty eligibility ignores v4-only recent recheck for v3 launch submissions", () => {
  const verifiedHuman = buildBountyEligibility(BOUNTY_ELIGIBILITY_VERIFIED_HUMAN, true);

  assert.equal(verifiedHuman, BOUNTY_ELIGIBILITY_VERIFIED_HUMAN);
  assert.deepEqual(getBountyEligibilityRequirement(verifiedHuman), {
    credentialMask: BOUNTY_ELIGIBILITY_VERIFIED_HUMAN,
    kinds: [3],
    requiresRecentRecheck: false,
  });
  assert.equal(getBountyEligibilityLabel(verifiedHuman), "Proof of Human");
});

test("bounty eligibility rejects unsupported v4-only bits and bare recent recheck", () => {
  assert.equal(isSupportedBountyEligibility(0), true);
  assert.equal(isSupportedBountyEligibility(8), true);
  assert.equal(isSupportedBountyEligibility(1), false);
  assert.equal(isSupportedBountyEligibility(4), false);
  assert.equal(isSupportedBountyEligibility(12), false);
  assert.equal(isSupportedBountyEligibility(16), false);
  assert.equal(isSupportedBountyEligibility(256), false);
  assert.equal(isSupportedBountyEligibility(BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG), false);
});
