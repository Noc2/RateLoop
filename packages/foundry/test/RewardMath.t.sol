// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import { RewardMath } from "../contracts/libraries/RewardMath.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";

/// @title Harness to expose RewardMath internal functions for testing
contract RewardMathHarness {
    function splitPool(uint256 losingPool) external pure returns (uint256, uint256, uint256) {
        return RewardMath.splitPool(losingPool);
    }

    function calculateVoterReward(uint256 effectiveStake, uint256 totalWeightedWinningStake, uint256 voterPool)
        external
        pure
        returns (uint256)
    {
        return RewardMath.calculateVoterReward(effectiveStake, totalWeightedWinningStake, voterPool);
    }

    function calculateRating(uint256 totalUpStake, uint256 totalDownStake) external pure returns (uint16) {
        return RewardMath.calculateRating(totalUpStake, totalDownStake);
    }

    function calculatePositiveScoreSpreadWeight(uint256 rbtsWeight, uint16 scoreBps, uint16 meanScoreBps)
        external
        pure
        returns (uint256)
    {
        return RewardMath.calculatePositiveScoreSpreadWeight(rbtsWeight, scoreBps, meanScoreBps);
    }

    function calculateNegativeScoreSpreadForfeit(
        uint256 stakeAmount,
        uint16 scoreBps,
        uint16 meanScoreBps,
        uint256 revealedCount
    )
        external
        pure
        returns (uint256)
    {
        return RewardMath.calculateNegativeScoreSpreadForfeit(stakeAmount, scoreBps, meanScoreBps, revealedCount);
    }

    function epochWeightBps(uint8 epochIndex) external pure returns (uint256) {
        return RoundLib.epochWeightBps(epochIndex);
    }
}

/// @title RewardMath Fuzz & Unit Tests
contract RewardMathTest is Test {
    RewardMathHarness public harness;

    function setUp() public {
        harness = new RewardMathHarness();
    }

    // ====================================================
    // splitPool — Fuzz Tests
    // ====================================================

    function testFuzz_SplitPool_Conservation(uint256 losingPool) public view {
        losingPool = bound(losingPool, 0, type(uint128).max);

        (uint256 voterShare, uint256 platformShare, uint256 treasuryShare) = harness.splitPool(losingPool);

        assertEq(voterShare + platformShare + treasuryShare, losingPool, "Pool split must conserve total");
    }

    function testFuzz_SplitPool_ProtocolSharesComeFromForfeitedPool(uint256 losingPool) public view {
        losingPool = bound(losingPool, 0, type(uint128).max);

        (uint256 voterShare, uint256 platformShare, uint256 treasuryShare) = harness.splitPool(losingPool);

        assertEq(voterShare + platformShare + treasuryShare, losingPool, "Forfeited pool split must conserve total");
    }

    function testFuzz_SplitPool_VoterShareDominates(uint256 losingPool) public view {
        losingPool = bound(losingPool, 1, type(uint128).max);

        (uint256 voterShare, uint256 platformShare, uint256 treasuryShare) = harness.splitPool(losingPool);

        assertGe(voterShare, platformShare, "Voter share must be >= platform share");
        assertGe(voterShare, treasuryShare, "Voter share must be >= treasury share");
    }

    function testFuzz_SplitPool_Proportions(uint256 losingPool) public view {
        losingPool = bound(losingPool, 10000, type(uint128).max);

        (uint256 voterShare, uint256 platformShare, uint256 treasuryShare) = harness.splitPool(losingPool);

        assertEq(platformShare, (losingPool * 300) / 10000, "Platform share must be 3%");
        assertEq(treasuryShare, (losingPool * 100) / 10000, "Treasury share must be 1%");
        assertEq(voterShare, losingPool - platformShare - treasuryShare, "Voter share must be remainder");
    }

    // ====================================================
    // calculateRating — Fuzz Tests
    // ====================================================

    function testFuzz_CalculateRating_Bounded(uint256 upStake, uint256 downStake) public view {
        upStake = bound(upStake, 0, type(uint128).max);
        downStake = bound(downStake, 0, type(uint128).max);

        uint16 rating = harness.calculateRating(upStake, downStake);

        assertLe(rating, 100, "Rating must be <= 100");
    }

    function testFuzz_CalculateRating_UpBias(uint256 upStake, uint256 downStake) public view {
        upStake = bound(upStake, 1, type(uint128).max);
        downStake = bound(downStake, 0, upStake - 1);

        uint16 rating = harness.calculateRating(upStake, downStake);

        assertGe(rating, 50, "More UP stake must produce rating >= 50");
    }

    function testFuzz_CalculateRating_DownBias(uint256 upStake, uint256 downStake) public view {
        downStake = bound(downStake, 1, type(uint128).max);
        upStake = bound(upStake, 0, downStake - 1);

        uint16 rating = harness.calculateRating(upStake, downStake);

        assertLe(rating, 50, "More DOWN stake must produce rating <= 50");
    }

    function test_CalculateRating_ZeroStakes() public view {
        uint16 rating = harness.calculateRating(0, 0);
        assertEq(rating, 50, "Zero stakes must return neutral rating of 50");
    }

    function test_CalculateRating_EqualStakes() public view {
        uint16 rating = harness.calculateRating(100e6, 100e6);
        assertEq(rating, 50, "Equal stakes must return neutral rating of 50");
    }

    function test_CalculateRating_AllUp() public view {
        // rating = 50 + 50 * 1000e6 / (1000e6 + 50e6) ≈ 50 + 47.6 = 97
        uint16 rating = harness.calculateRating(1000e6, 0);
        assertGt(rating, 90, "All-UP heavy stake should produce high rating");
        assertLe(rating, 100, "Rating capped at 100");
    }

    function test_CalculateRating_AllDown() public view {
        uint16 rating = harness.calculateRating(0, 1000e6);
        assertLt(rating, 10, "All-DOWN heavy stake should produce low rating");
    }

    // ====================================================
    // calculateVoterReward — Fuzz Tests
    // ====================================================

    function testFuzz_CalculateVoterReward_NeverExceedsPool(
        uint256 effectiveStake,
        uint256 totalWeightedWinningStake,
        uint256 voterPool
    ) public view {
        effectiveStake = bound(effectiveStake, 1, type(uint128).max);
        totalWeightedWinningStake = bound(totalWeightedWinningStake, effectiveStake, type(uint128).max);
        voterPool = bound(voterPool, 0, type(uint128).max);

        uint256 reward = harness.calculateVoterReward(effectiveStake, totalWeightedWinningStake, voterPool);

        assertLe(reward, voterPool, "Individual reward must never exceed pool");
    }

    function testFuzz_CalculateVoterReward_Proportional(
        uint256 effectiveStake1,
        uint256 effectiveStake2,
        uint256 totalWeightedWinningStake,
        uint256 voterPool
    ) public view {
        effectiveStake1 = bound(effectiveStake1, 1, type(uint64).max);
        effectiveStake2 = bound(effectiveStake2, effectiveStake1, type(uint64).max);
        totalWeightedWinningStake = bound(totalWeightedWinningStake, effectiveStake2, type(uint128).max);
        voterPool = bound(voterPool, 1, type(uint128).max);

        uint256 reward1 = harness.calculateVoterReward(effectiveStake1, totalWeightedWinningStake, voterPool);
        uint256 reward2 = harness.calculateVoterReward(effectiveStake2, totalWeightedWinningStake, voterPool);

        assertLe(reward1, reward2, "Higher effective stake must get >= reward");
    }

    function testFuzz_CalculateVoterReward_ZeroTotal(uint256 effectiveStake, uint256 voterPool) public view {
        effectiveStake = bound(effectiveStake, 0, type(uint128).max);
        voterPool = bound(voterPool, 0, type(uint128).max);

        uint256 reward = harness.calculateVoterReward(effectiveStake, 0, voterPool);

        assertEq(reward, 0, "Zero totalWeightedWinningStake must return zero reward");
    }

    // ====================================================
    // score-spread accounting — Unit Tests
    // ====================================================

    function test_CalculatePositiveScoreSpreadWeight_UsesRbtsWeightAndDelta() public view {
        uint256 weight = harness.calculatePositiveScoreSpreadWeight(10e6, 9350, 8525);

        assertEq(weight, 825_000, "Alice positive spread weight should be stake * 8.25%");
    }

    function test_CalculatePositiveScoreSpreadWeight_ZeroAtOrBelowMean() public view {
        assertEq(harness.calculatePositiveScoreSpreadWeight(10e6, 8525, 8525), 0, "Mean score has no reward weight");
        assertEq(
            harness.calculatePositiveScoreSpreadWeight(10e6, 6400, 8525), 0, "Below-mean score has no reward weight"
        );
    }

    function test_CalculateNegativeScoreSpreadForfeit_ZeroBelowEconomicThreshold() public view {
        assertEq(
            harness.calculateNegativeScoreSpreadForfeit(5e6, 6400, 8525, 7),
            0,
            "Low-turnout rounds do not apply score-spread forfeits"
        );
    }

    function test_CalculateNegativeScoreSpreadForfeit_AppliesIntensityAndCapsAtHalfStake() public view {
        uint256 forfeited = harness.calculateNegativeScoreSpreadForfeit(5e6, 6400, 8525, 8);

        assertEq(forfeited, 1_593_750, "Carol forfeits stake * 1.5 * 21.25%");
        assertEq(harness.calculateNegativeScoreSpreadForfeit(5e6, 0, 10_000, 8), 2_500_000, "Forfeit is capped at 50%");
    }

    function test_CalculateNegativeScoreSpreadForfeit_ZeroAtOrAboveMean() public view {
        assertEq(harness.calculateNegativeScoreSpreadForfeit(5e6, 8525, 8525, 8), 0, "Mean score does not forfeit");
        assertEq(
            harness.calculateNegativeScoreSpreadForfeit(5e6, 9350, 8525, 8), 0, "Above-mean score does not forfeit"
        );
    }

    // ====================================================
    // splitPool — Edge Case Unit Tests
    // ====================================================

    function test_SplitPool_Zero() public view {
        (uint256 voterShare, uint256 platformShare, uint256 treasuryShare) = harness.splitPool(0);

        assertEq(voterShare, 0);
        assertEq(platformShare, 0);
        assertEq(treasuryShare, 0);
    }

    function test_SplitPool_SmallValues() public view {
        // With 100 tokens: platform = 3, treasury = 1, voter = 96
        (uint256 voterShare, uint256 platformShare, uint256 treasuryShare) = harness.splitPool(100);

        assertEq(platformShare, 3);
        assertEq(treasuryShare, 1);
        assertEq(voterShare, 96);
    }

    function test_SplitPool_One() public view {
        // With 1 token: rounding means platform=0, treasury=0, voter=1
        (uint256 voterShare, uint256 platformShare, uint256 treasuryShare) = harness.splitPool(1);

        assertEq(platformShare, 0);
        assertEq(treasuryShare, 0);
        assertEq(voterShare, 1);
    }

    // ====================================================
    // epochWeightBps — Unit Tests
    // ====================================================

    function test_EpochWeightBps_Epoch0_Returns10000() public view {
        uint256 weight = harness.epochWeightBps(0);
        assertEq(weight, 10000, "Epoch 0 (blind epoch-1) must return 10000 bps (100%)");
    }

    function test_EpochWeightBps_Epoch1_Returns2500() public view {
        uint256 weight = harness.epochWeightBps(1);
        assertEq(weight, 2500, "Epoch 1 (informed epoch-2+) must return 2500 bps (25%)");
    }

    function test_EpochWeightBps_HighEpoch_Returns2500() public view {
        // All epochs >= 1 (informed) return the same 25% weight
        uint256 weight2 = harness.epochWeightBps(2);
        uint256 weight100 = harness.epochWeightBps(100);
        assertEq(weight2, 2500, "Epoch 2 must also return 2500 bps");
        assertEq(weight100, 2500, "Epoch 100 must also return 2500 bps");
    }

    function test_EpochWeightBps_EarlyVoterAdvantage() public view {
        // Epoch-1 voter gets 4x the reward weight of an epoch-2+ voter
        uint256 blindWeight = harness.epochWeightBps(0);
        uint256 informedWeight = harness.epochWeightBps(1);
        assertEq(blindWeight / informedWeight, 4, "Blind voter must have 4x weight vs informed voter");
    }
}
