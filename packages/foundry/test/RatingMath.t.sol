// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import { RatingLib } from "../contracts/libraries/RatingLib.sol";
import { RatingMath } from "../contracts/libraries/RatingMath.sol";

contract RatingMathHarness {
    function clampRatingBps(uint256 ratingBps) external pure returns (uint16) {
        return RatingMath.clampRatingBps(ratingBps);
    }

    function displayRatingFromBps(uint16 ratingBps) external pure returns (uint8) {
        return RatingMath.displayRatingFromBps(ratingBps);
    }

    function ratingBpsToLogitX18(uint16 ratingBps) external pure returns (int256) {
        return RatingMath.ratingBpsToLogitX18(ratingBps);
    }

    function logitX18ToRatingBps(int256 ratingLogitX18) external pure returns (uint16) {
        return RatingMath.logitX18ToRatingBps(ratingLogitX18);
    }

    function computeConservativeRatingBps(uint16 ratingBps, uint256 confidenceMass, RatingLib.RatingConfig calldata cfg)
        external
        pure
        returns (uint16)
    {
        return RatingMath.computeConservativeRatingBps(ratingBps, confidenceMass, cfg);
    }

    function applySettlement(
        uint16 referenceRatingBps,
        uint256 weightedUp,
        uint256 weightedDown,
        RatingLib.RatingState calldata previousState,
        RatingLib.RatingConfig calldata ratingConfig,
        RatingLib.SlashConfig calldata slashConfig,
        uint48 settledAt
    ) external pure returns (RatingLib.RatingState memory nextState) {
        return RatingMath.applySettlement(
            referenceRatingBps, weightedUp, weightedDown, previousState, ratingConfig, slashConfig, settledAt
        );
    }
}

contract RatingMathTest is Test {
    RatingMathHarness internal harness;

    function setUp() public {
        harness = new RatingMathHarness();
    }

    function _ratingConfig() internal pure returns (RatingLib.RatingConfig memory cfg) {
        cfg = RatingLib.RatingConfig({
            smoothingAlpha: 10e6,
            smoothingBeta: 10e6,
            observationBetaX18: 2e18,
            confidenceMassInitial: 80e6,
            confidenceMassMin: 50e6,
            confidenceMassMax: 500e6,
            confidenceGainBps: 1_500,
            confidenceReopenBps: 2_000,
            surpriseReferenceX18: 8e17,
            maxDeltaLogitX18: 6e17,
            maxAbsLogitX18: 4_595_119_850_134_590_000,
            conservativePenaltyMaxBps: 1_500,
            conservativePenaltyMinBps: 250
        });
    }

    function _slashConfig() internal pure returns (RatingLib.SlashConfig memory cfg) {
        cfg = RatingLib.SlashConfig({
            slashThresholdBps: 2_500, minSlashSettledRounds: 2, minSlashLowDuration: 7 days, minSlashEvidence: 200e6
        });
    }

    function _state(
        int128 ratingLogitX18,
        uint128 confidenceMass,
        uint128 effectiveEvidence,
        uint128 upEvidence,
        uint128 downEvidence,
        uint32 settledRounds,
        uint16 ratingBps,
        uint16 conservativeRatingBps,
        uint48 lastUpdatedAt,
        uint48 lowSince
    ) internal pure returns (RatingLib.RatingState memory state) {
        state = RatingLib.RatingState({
            ratingLogitX18: ratingLogitX18,
            confidenceMass: confidenceMass,
            effectiveEvidence: effectiveEvidence,
            upEvidence: upEvidence,
            downEvidence: downEvidence,
            settledRounds: settledRounds,
            ratingBps: ratingBps,
            conservativeRatingBps: conservativeRatingBps,
            lastUpdatedAt: lastUpdatedAt,
            lowSince: lowSince
        });
    }

    function test_ClampRatingBps_ConstrainsExtremes() public view {
        assertEq(harness.clampRatingBps(0), 100);
        assertEq(harness.clampRatingBps(99), 100);
        assertEq(harness.clampRatingBps(5_000), 5_000);
        assertEq(harness.clampRatingBps(10_000), 9_900);
        assertEq(harness.clampRatingBps(12_500), 9_900);
    }

    function test_LogitRoundTrip_StaysCloseForRepresentativeScores() public view {
        uint16[5] memory values = [uint16(100), 1_750, 5_000, 7_250, 9_900];
        for (uint256 i = 0; i < values.length; i++) {
            uint16 ratingBps = values[i];
            uint16 roundTrip = harness.logitX18ToRatingBps(harness.ratingBpsToLogitX18(ratingBps));
            assertApproxEqAbs(roundTrip, ratingBps, 1, "round-trip drift too large");
        }
    }

    function test_EvidenceSettlement_FirstRoundUsesDirectBoundedShare() public view {
        RatingLib.RatingConfig memory cfg = _ratingConfig();
        RatingLib.SlashConfig memory slashCfg = _slashConfig();
        RatingLib.RatingState memory prev = _state(0, 80e6, 0, 0, 0, 0, 5_000, 5_000, 0, 0);

        RatingLib.RatingState memory next = harness.applySettlement(5_000, 3_200_000, 1_150_000, prev, cfg, slashCfg, 1);

        assertEq(next.ratingBps, 7_356, "rating should be direct cumulative up evidence share");
        assertEq(next.upEvidence, 3_200_000, "up evidence should accumulate");
        assertEq(next.downEvidence, 1_150_000, "down evidence should accumulate");
        assertEq(next.effectiveEvidence, 4_350_000, "total evidence should accumulate");
    }

    function test_EvidenceSettlement_LaterRoundsAggregateWithPriorEvidence() public view {
        RatingLib.RatingConfig memory cfg = _ratingConfig();
        RatingLib.SlashConfig memory slashCfg = _slashConfig();
        RatingLib.RatingState memory prev = _state(0, 50e6, 4_350_000, 3_200_000, 1_150_000, 1, 7_356, 5_856, 1, 0);

        RatingLib.RatingState memory next = harness.applySettlement(7_356, 0, 4_350_000, prev, cfg, slashCfg, 2);

        assertEq(next.upEvidence, 3_200_000, "prior up evidence should remain");
        assertEq(next.downEvidence, 5_500_000, "new down evidence should accumulate");
        assertEq(next.ratingBps, 3_678, "later rounds should refine the cumulative rating");
    }

    function test_ConservativeRatingPenalty_ClosesUpWithMoreConfidence() public view {
        RatingLib.RatingConfig memory cfg = _ratingConfig();

        uint16 lowConfidenceConservative = harness.computeConservativeRatingBps(6_800, 80e6, cfg);
        uint16 highConfidenceConservative = harness.computeConservativeRatingBps(6_800, 320e6, cfg);

        assertLt(lowConfidenceConservative, highConfidenceConservative, "higher confidence should penalize less");
        assertEq(lowConfidenceConservative, 5_300, "default low-confidence penalty should be 1500 bps");
        assertEq(highConfidenceConservative, 6_425, "higher confidence should shrink the penalty");
    }

    function test_LowSinceGating_RequiresEvidenceRoundsAndPersistence() public view {
        RatingLib.RatingConfig memory cfg = _ratingConfig();
        RatingLib.SlashConfig memory slashCfg = _slashConfig();
        RatingLib.RatingState memory prev = _state(0, 80e6, 0, 0, 0, 0, 5_000, 5_000, 0, 0);

        RatingLib.RatingState memory notYetSlashable = harness.applySettlement(5_000, 0, 300e6, prev, cfg, slashCfg, 1);
        assertEq(notYetSlashable.lowSince, 0, "insufficient settled rounds should not arm lowSince");

        prev = _state(0, 80e6, 100e6, 0, 100e6, 1, 1_000, 1_000, 1, 0);
        RatingLib.RatingState memory slashable = harness.applySettlement(5_000, 0, 300e6, prev, cfg, slashCfg, 2);
        assertEq(slashable.lowSince, 2, "persistent low rating should arm lowSince once thresholds are met");

        RatingLib.RatingState memory recovered = harness.applySettlement(5_000, 500e6, 0, slashable, cfg, slashCfg, 3);
        assertEq(recovered.lowSince, 0, "recovery above threshold should clear lowSince");
    }
}
