import {
  buildClaimRewardsButtonLabel,
  buildClaimRewardsButtonParts,
  shouldShowClaimPreparationLabel,
  shouldShowClaimRewardsUnavailableStatus,
  shouldShowFrontendWithdrawalPausedStatus,
} from "./ClaimRewardsButton";
import assert from "node:assert/strict";
import test from "node:test";

test("buildClaimRewardsButtonLabel hides rewards that would display as zero", () => {
  assert.equal(
    buildClaimRewardsButtonLabel({
      showTokenSymbol: false,
      totalLrepClaimable: 49_999n,
      totalUsdcClaimable: 4_999n,
    }),
    null,
  );
});

test("buildClaimRewardsButtonLabel renders the smallest visible claim amounts", () => {
  assert.equal(
    buildClaimRewardsButtonLabel({
      showTokenSymbol: false,
      totalLrepClaimable: 50_000n,
      totalUsdcClaimable: 0n,
    }),
    "Claim 0.1",
  );
  assert.equal(
    buildClaimRewardsButtonLabel({
      showTokenSymbol: true,
      totalLrepClaimable: 0n,
      totalUsdcClaimable: 5_000n,
    }),
    "Claim $0.01",
  );
});

test("buildClaimRewardsButtonLabel omits hidden dust when another asset is claimable", () => {
  assert.equal(
    buildClaimRewardsButtonLabel({
      showTokenSymbol: true,
      totalLrepClaimable: 49_999n,
      totalUsdcClaimable: 1_000_000n,
    }),
    "Claim $1",
  );
});

test("buildClaimRewardsButtonLabel includes both visible asset amounts", () => {
  assert.equal(
    buildClaimRewardsButtonLabel({
      showTokenSymbol: true,
      totalLrepClaimable: 1_000_000n,
      totalUsdcClaimable: 1_000_000n,
    }),
    "Claim 1 LREP + $1",
  );
});

test("buildClaimRewardsButtonParts returns compact sidebar amount parts", () => {
  assert.deepEqual(
    buildClaimRewardsButtonParts({
      showTokenSymbol: false,
      totalLrepClaimable: 13_400_000n,
      totalUsdcClaimable: 1_670_000n,
    }),
    ["13.4", "$1.67"],
  );
});

test("shouldShowClaimPreparationLabel only reflects an active claim attempt", () => {
  assert.equal(
    shouldShowClaimPreparationLabel({
      isClaimAttemptInFlight: false,
      isClaiming: false,
      isPreparingClaim: true,
    }),
    false,
  );
  assert.equal(
    shouldShowClaimPreparationLabel({
      isClaimAttemptInFlight: true,
      isClaiming: false,
      isPreparingClaim: true,
    }),
    true,
  );
  assert.equal(
    shouldShowClaimPreparationLabel({
      isClaimAttemptInFlight: true,
      isClaiming: true,
      isPreparingClaim: true,
    }),
    false,
  );
});

test("shouldShowClaimRewardsUnavailableStatus can be hidden on global wallet surfaces", () => {
  const unavailableState = {
    claimablesLoading: false,
    isClaiming: false,
    isPreparingActiveClaim: false,
    ponderUnavailable: true,
    visibleClaimableItemsCount: 0,
  };

  assert.equal(
    shouldShowClaimRewardsUnavailableStatus({
      ...unavailableState,
      showUnavailableStatus: true,
    }),
    true,
  );
  assert.equal(
    shouldShowClaimRewardsUnavailableStatus({
      ...unavailableState,
      showUnavailableStatus: false,
    }),
    false,
  );
});

test("shouldShowFrontendWithdrawalPausedStatus only shows an otherwise empty paused withdrawal state", () => {
  const pausedState = {
    claimablesLoading: false,
    frontendFeeWithdrawalBlockedByDispute: true,
    isClaiming: false,
    isPreparingActiveClaim: false,
    visibleClaimableItemsCount: 0,
  };

  assert.equal(shouldShowFrontendWithdrawalPausedStatus(pausedState), true);
  assert.equal(
    shouldShowFrontendWithdrawalPausedStatus({
      ...pausedState,
      visibleClaimableItemsCount: 1,
    }),
    false,
  );
  assert.equal(
    shouldShowFrontendWithdrawalPausedStatus({
      ...pausedState,
      frontendFeeWithdrawalBlockedByDispute: false,
    }),
    false,
  );
});
