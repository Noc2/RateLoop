// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { RewardMath } from "../contracts/libraries/RewardMath.sol";

/// @title RewardMathFuzz
/// @notice Fuzz tests for the pure functions in RewardMath.sol.
contract RewardMathFuzz is Test {
    using RewardMath for *;

    // =========================================================================
    // calculateRating
    // =========================================================================

    function testFuzz_calculateRating_AlwaysBounded(uint256 upStake, uint256 downStake) public pure {
        // Bound to avoid overflow in (upStake + downStake + RATING_B)
        upStake = bound(upStake, 0, type(uint128).max);
        downStake = bound(downStake, 0, type(uint128).max);

        uint16 rating = RewardMath.calculateRating(upStake, downStake);
        assertLe(rating, 100, "rating > 100");
    }

    function test_calculateRating_ZeroStakeReturns50() public pure {
        // When both stakes are zero, rating = 50
        uint16 rating = RewardMath.calculateRating(0, 0);
        assertEq(rating, 50, "zero-stake should return 50");
    }

    function testFuzz_calculateRating_UpMajorityGe50(uint256 upStake, uint256 downStake) public pure {
        upStake = bound(upStake, 1, type(uint128).max);
        downStake = bound(downStake, 0, upStake - 1); // upStake > downStake

        uint16 rating = RewardMath.calculateRating(upStake, downStake);
        assertGe(rating, 50, "UP-majority should give rating >= 50");
    }

    // =========================================================================
    // calculateVoterReward
    // =========================================================================

    function testFuzz_calculateVoterReward_NeverExceedsPool(
        uint256 effectiveStake,
        uint256 totalWeightedWinning,
        uint256 voterPool
    ) public pure {
        effectiveStake = bound(effectiveStake, 0, type(uint128).max);
        totalWeightedWinning = bound(totalWeightedWinning, 1, type(uint128).max);
        voterPool = bound(voterPool, 0, type(uint128).max);

        // Single voter's effective stake can't exceed the total
        effectiveStake = bound(effectiveStake, 0, totalWeightedWinning);

        uint256 reward = RewardMath.calculateVoterReward(effectiveStake, totalWeightedWinning, voterPool);
        assertLe(reward, voterPool, "voter reward exceeds pool");
    }

    function testFuzz_calculateVoterReward_ZeroStakeReturnsZero(uint256 totalWeighted, uint256 pool) public pure {
        totalWeighted = bound(totalWeighted, 1, type(uint128).max);
        pool = bound(pool, 0, type(uint128).max);

        uint256 reward = RewardMath.calculateVoterReward(0, totalWeighted, pool);
        assertEq(reward, 0, "zero effective stake should return 0");
    }

    // =========================================================================
    // splitPool
    // =========================================================================

    function testFuzz_splitPool_SharesSumToInput(uint256 losingPool) public pure {
        losingPool = bound(losingPool, 0, type(uint128).max);

        (uint256 voter, uint256 platform, uint256 treasury) = RewardMath.splitPool(losingPool);

        uint256 total = voter + platform + treasury;
        assertEq(total, losingPool, "shares do not sum to input");
    }

    function testFuzz_splitPool_VoterGetsRemainder(uint256 losingPool) public pure {
        losingPool = bound(losingPool, 10000, type(uint128).max); // Need enough for meaningful split

        (uint256 voter,,) = RewardMath.splitPool(losingPool);

        // Voter share should be >= 96% because it receives the unallocated rounding remainder.
        uint256 minVoter = (losingPool * 9600) / 10000;
        assertGe(voter, minVoter, "voter share below 96% floor");
    }

    // =========================================================================
    // score-spread accounting
    // =========================================================================

    function testFuzz_calculatePositiveScoreSpreadWeight_MatchesDelta(
        uint256 rbtsWeight,
        uint16 scoreBps,
        uint16 meanScoreBps
    ) public pure {
        rbtsWeight = bound(rbtsWeight, 0, type(uint128).max);
        scoreBps = uint16(bound(scoreBps, 0, 10_000));
        meanScoreBps = uint16(bound(meanScoreBps, 0, 10_000));

        uint256 weight = RewardMath.calculatePositiveScoreSpreadWeight(rbtsWeight, scoreBps, meanScoreBps);
        uint256 expected = scoreBps > meanScoreBps ? (rbtsWeight * (scoreBps - meanScoreBps)) / 10_000 : 0;

        assertEq(weight, expected, "positive spread weight mismatch");
    }

    function testFuzz_calculateNegativeScoreSpreadForfeit_CappedAtStake(
        uint256 stake,
        uint16 scoreBps,
        uint16 meanScoreBps
    ) public pure {
        stake = bound(stake, 0, type(uint128).max);
        scoreBps = uint16(bound(scoreBps, 0, 10_000));
        meanScoreBps = uint16(bound(meanScoreBps, 0, 10_000));

        uint256 forfeited = RewardMath.calculateNegativeScoreSpreadForfeit(stake, scoreBps, meanScoreBps);

        assertLe(forfeited, stake, "forfeit exceeds original stake");
        if (scoreBps >= meanScoreBps) {
            assertEq(forfeited, 0, "non-negative spread should not forfeit");
        }
    }
}
