import { resolveAllClaimableRewardsOptions } from "./useAllClaimableRewards";
import assert from "node:assert/strict";
import test from "node:test";

test("resolveAllClaimableRewardsOptions includes frontend rewards by default", () => {
  assert.deepEqual(resolveAllClaimableRewardsOptions(), {
    includeFrontendRewards: true,
  });
});

test("resolveAllClaimableRewardsOptions lets global surfaces skip frontend rewards", () => {
  assert.deepEqual(resolveAllClaimableRewardsOptions({ includeFrontendRewards: false }), {
    includeFrontendRewards: false,
  });
});
