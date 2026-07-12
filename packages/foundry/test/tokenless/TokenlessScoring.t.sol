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
}
