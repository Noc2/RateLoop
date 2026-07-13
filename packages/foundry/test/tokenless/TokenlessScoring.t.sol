// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { Test } from "forge-std/Test.sol";
import { TokenlessScoring } from "../../contracts/tokenless/libraries/TokenlessScoring.sol";

contract TokenlessScoringHarness {
    function accuracyScore(uint8 vote, uint16 prediction, uint256 upVotes, uint256 reveals)
        external
        pure
        returns (uint256)
    {
        return TokenlessScoring.accuracyScore(vote, prediction, upVotes, reveals);
    }

    function pools(uint256 bounty) external pure returns (uint256 basePool, uint256 bonusPool) {
        return TokenlessScoring.pools(bounty);
    }
}

contract TokenlessScoringTest is Test {
    TokenlessScoringHarness internal scoring = new TokenlessScoringHarness();

    function test_ExecutableWorkedExampleFreezesEightyTwentyAndLeaveOneOutScoring() public view {
        (uint256 basePool, uint256 bonusPool) = scoring.pools(101_000_003);
        assertEq(basePool, 80_800_002);
        assertEq(bonusPool, 20_200_001);

        // Votes [up, up, down]. Each rater predicts the share among the other two.
        assertEq(scoring.accuracyScore(1, 5_000, 2, 3), 100_000_000); // peers are 50% up
        assertEq(scoring.accuracyScore(1, 7_000, 2, 3), 96_000_000); // 20pp error
        assertEq(scoring.accuracyScore(0, 9_000, 2, 3), 99_000_000); // peers are 100% up
    }

    function test_SingleRevealUsesNeutralReferenceAndInvalidBucketsFailClosed() public {
        assertEq(scoring.accuracyScore(0, 5_000, 0, 1), 100_000_000);

        vm.expectRevert(TokenlessScoring.InvalidPredictionBucket.selector);
        scoring.accuracyScore(1, 6_000, 1, 2);
    }

    /// @dev Baseline characterization: the disposable v0 score only rewards the
    ///      prediction. Flipping this rater's vote while holding the three peer
    ///      votes and prediction fixed cannot change the score because the
    ///      leave-one-out peer share is identical in both valid reveal sets.
    function test_V0ScoreIsInvariantToOwnVote() public view {
        uint256 downScore = scoring.accuracyScore(0, 7_000, 2, 4);
        uint256 upScore = scoring.accuracyScore(1, 7_000, 3, 4);

        assertEq(downScore, upScore);
        assertEq(downScore, 99_888_444);
    }

    function testFuzz_V0ScoreIsInvariantToOwnVote(uint16 predictionBucket, uint32 peerUpVotes, uint32 peerCount)
        public
        view
    {
        uint16[5] memory buckets = [uint16(1_000), 3_000, 5_000, 7_000, 9_000];
        uint16 prediction = buckets[uint256(predictionBucket) % buckets.length];
        uint256 boundedPeerCount = bound(uint256(peerCount), 1, 1_000);
        uint256 boundedPeerUpVotes = bound(uint256(peerUpVotes), 0, boundedPeerCount);

        uint256 downScore =
            scoring.accuracyScore(0, prediction, boundedPeerUpVotes, boundedPeerCount + 1);
        uint256 upScore =
            scoring.accuracyScore(1, prediction, boundedPeerUpVotes + 1, boundedPeerCount + 1);

        assertEq(downScore, upScore);
        assertLe(downScore, 100_000_000);
        assertGe(downScore, 19_000_000);
    }

    function test_RandomClickFixturesKeepMaterialPositiveScores() public view {
        // A random report receives a positive score even at the largest possible
        // error for an allowed bucket. This is a property of v0, not a target for
        // tokenless-rbts-v1.
        assertEq(scoring.accuracyScore(0, 1_000, 1, 2), 19_000_000);
        assertEq(scoring.accuracyScore(1, 9_000, 1, 2), 19_000_000);
    }
}
