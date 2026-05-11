import {
  getLaunchReferralInputState,
  normalizeLaunchReferralAddress,
  resolveLaunchClaimReferrer,
} from "./launchReferral";
import assert from "node:assert/strict";
import test from "node:test";
import { getAddress, zeroAddress } from "viem";

const CONNECTED = "0x63cada40e8acf7a1d47229af5be35b78b16035fa";
const REFERRER = "0xc1cd80c7cd37b5499560c362b164cba1cff71b44";

test("normalizes valid launch referral addresses", () => {
  assert.equal(normalizeLaunchReferralAddress(REFERRER.toUpperCase()), getAddress(REFERRER));
});

test("rejects invalid and zero launch referral addresses", () => {
  assert.equal(normalizeLaunchReferralAddress("not-an-address"), null);
  assert.equal(normalizeLaunchReferralAddress(zeroAddress), null);
});

test("launch referral input permits a different valid referrer", () => {
  const state = getLaunchReferralInputState({
    connectedAddress: CONNECTED,
    inputValue: REFERRER.toUpperCase(),
  });

  assert.equal(state.status, "valid");
  assert.equal(state.canUseReferrer, true);
  assert.equal(state.normalizedReferrer, getAddress(REFERRER));
});

test("launch referral input rejects self-referrals", () => {
  const state = getLaunchReferralInputState({
    connectedAddress: CONNECTED.toUpperCase(),
    inputValue: CONNECTED,
  });

  assert.equal(state.status, "self");
  assert.equal(state.canUseReferrer, false);
  assert.equal(state.message, "You cannot refer yourself.");
});

test("launch referral input resolves invalid referrals to zero address for claims", () => {
  assert.equal(
    resolveLaunchClaimReferrer({
      connectedAddress: CONNECTED,
      inputValue: "not-an-address",
    }),
    zeroAddress,
  );
});
