// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { Test } from "forge-std/Test.sol";
import { TokenlessRbts } from "../../contracts/tokenless/libraries/TokenlessRbts.sol";

contract TokenlessRbtsHarness {
    function isValidUserPrediction(uint16 prediction) external pure returns (bool) {
        return TokenlessRbts.isValidUserPrediction(prediction);
    }

    function shadowPredictionBps(uint16 referencePrediction, uint8 ownVote) external pure returns (uint16) {
        return TokenlessRbts.shadowPredictionBps(referencePrediction, ownVote);
    }

    function quadraticScoreBps(uint16 prediction, uint8 actualVote) external pure returns (uint16) {
        return TokenlessRbts.quadraticScoreBps(prediction, actualVote);
    }

    function score(uint8 ownVote, uint16 ownPrediction, uint16 referencePrediction, uint8 peerVote)
        external
        pure
        returns (TokenlessRbts.Score memory)
    {
        return TokenlessRbts.score(ownVote, ownPrediction, referencePrediction, peerVote);
    }

    function accumulateRevealSet(bytes32 revealSetXor, uint256 revealSetSum, bytes32 commitKey)
        external
        pure
        returns (bytes32 nextXor, uint256 nextSum)
    {
        return TokenlessRbts.accumulateRevealSet(revealSetXor, revealSetSum, commitKey);
    }

    function scoringSeed(
        uint256 chainId,
        address panelAddress,
        uint256 roundId,
        uint32 frozenRevealCount,
        bytes32 revealSetXor,
        uint256 revealSetSum,
        bytes32 entropy
    ) external pure returns (bytes32) {
        return TokenlessRbts.scoringSeed(
            chainId, panelAddress, roundId, frozenRevealCount, revealSetXor, revealSetSum, entropy
        );
    }

    function rankHash(bytes32 seed, bytes32 commitKey) external pure returns (bytes32) {
        return TokenlessRbts.rankHash(seed, commitKey);
    }

    function rankBefore(bytes32 leftHash, bytes32 leftKey, bytes32 rightHash, bytes32 rightKey)
        external
        pure
        returns (bool)
    {
        return TokenlessRbts.rankBefore(leftHash, leftKey, rightHash, rightKey);
    }

    function selectReferenceAndPeer(bytes32 seed, bytes32 ownCommitKey, bytes32[] memory revealedCommitKeys)
        external
        pure
        returns (bytes32 referenceCommitKey, bytes32 peerCommitKey)
    {
        return TokenlessRbts.selectReferenceAndPeer(seed, ownCommitKey, revealedCommitKeys);
    }

    function sortCanonical(bytes32 seed, bytes32[] memory commitKeys) external pure returns (bytes32[] memory) {
        TokenlessRbts.sortCanonical(seed, commitKeys);
        return commitKeys;
    }
}

/// @dev Includes the storage-to-memory copy used by one paginated panel scoring call.
contract TokenlessRbtsStorageGasHarness {
    bytes32[] internal _keys;

    constructor(uint256 count) {
        for (uint256 i = 0; i < count; ++i) {
            _keys.push(keccak256(abi.encode("maximum-panel-key", i)));
        }
    }

    function selectAt(bytes32 seed, uint256 index) external view returns (bytes32 referenceKey, bytes32 peerKey) {
        bytes32[] memory keys = _keys;
        return TokenlessRbts.selectReferenceAndPeer(seed, keys[index], keys);
    }
}

contract TokenlessRbtsTest is Test {
    TokenlessRbtsHarness internal rbts = new TokenlessRbtsHarness();

    bytes32 internal constant VECTOR_SEED = 0xb31ec78a68f9fafb9fb8a2306cdb0f66274cf1611dfd001862bf44dc3d16d889;

    function test_JavascriptWorkedVectorsMatchExactly() public view {
        TokenlessRbts.Score memory up = rbts.score(1, 7_000, 7_000, 1);
        assertEq(up.shadowPredictionBps, 10_000);
        assertEq(up.informationScoreBps, 10_000);
        assertEq(up.predictionScoreBps, 9_100);
        assertEq(up.scoreBps, 9_550);

        TokenlessRbts.Score memory down = rbts.score(0, 7_000, 7_000, 1);
        assertEq(down.shadowPredictionBps, 4_000);
        assertEq(down.informationScoreBps, 6_400);
        assertEq(down.predictionScoreBps, 9_100);
        assertEq(down.scoreBps, 7_750);
    }

    function test_OnePercentGridAndInternalQuadraticEndpointsAreExact() public {
        assertTrue(rbts.isValidUserPrediction(100));
        assertTrue(rbts.isValidUserPrediction(5_000));
        assertTrue(rbts.isValidUserPrediction(9_900));
        assertFalse(rbts.isValidUserPrediction(0));
        assertFalse(rbts.isValidUserPrediction(150));
        assertFalse(rbts.isValidUserPrediction(10_000));

        assertEq(rbts.quadraticScoreBps(0, 0), 10_000);
        assertEq(rbts.quadraticScoreBps(0, 1), 0);
        assertEq(rbts.quadraticScoreBps(10_000, 0), 0);
        assertEq(rbts.quadraticScoreBps(10_000, 1), 10_000);

        vm.expectRevert(TokenlessRbts.InvalidPrediction.selector);
        rbts.score(1, 150, 7_000, 1);
        vm.expectRevert(TokenlessRbts.InvalidPrediction.selector);
        rbts.score(1, 7_000, 150, 1);
        vm.expectRevert(TokenlessRbts.InvalidVote.selector);
        rbts.score(2, 7_000, 7_000, 1);
    }

    function test_OwnVoteChangesTheInformationComponentAndCombinedScore() public view {
        TokenlessRbts.Score memory up = rbts.score(1, 7_000, 7_000, 1);
        TokenlessRbts.Score memory down = rbts.score(0, 7_000, 7_000, 1);

        assertNotEq(up.shadowPredictionBps, down.shadowPredictionBps);
        assertNotEq(up.informationScoreBps, down.informationScoreBps);
        assertNotEq(up.scoreBps, down.scoreBps);
        assertEq(up.predictionScoreBps, down.predictionScoreBps);
    }

    function testFuzz_ScoreComponentsStayWithinBasisPoints(
        uint8 ownVoteSeed,
        uint8 peerVoteSeed,
        uint8 ownPredictionStep,
        uint8 referencePredictionStep
    ) public view {
        uint8 ownVote = ownVoteSeed % 2;
        uint8 peerVote = peerVoteSeed % 2;
        uint16 ownPrediction = uint16(bound(uint256(ownPredictionStep), 1, 99) * 100);
        uint16 referencePrediction = uint16(bound(uint256(referencePredictionStep), 1, 99) * 100);

        TokenlessRbts.Score memory result = rbts.score(ownVote, ownPrediction, referencePrediction, peerVote);
        assertLe(result.shadowPredictionBps, 10_000);
        assertLe(result.informationScoreBps, 10_000);
        assertLe(result.predictionScoreBps, 10_000);
        assertLe(result.scoreBps, 10_000);
    }

    function test_RevealSetAccumulatorsAreOrderIndependent() public view {
        bytes32[] memory keys = _fiveKeys();
        (bytes32 forwardXor, uint256 forwardSum) = _accumulate(keys);

        bytes32[] memory reversed = new bytes32[](keys.length);
        for (uint256 i = 0; i < keys.length; ++i) {
            reversed[i] = keys[keys.length - 1 - i];
        }
        (bytes32 reverseXor, uint256 reverseSum) = _accumulate(reversed);

        assertEq(forwardXor, reverseXor);
        assertEq(forwardSum, reverseSum);
    }

    function test_SeedAndRankMatchAbiEncodingVectors() public view {
        bytes32 seed = rbts.scoringSeed(
            84_532,
            0x1111111111111111111111111111111111111111,
            42,
            3,
            0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,
            123_456,
            0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
        );
        assertEq(seed, VECTOR_SEED);
        assertEq(
            rbts.rankHash(seed, bytes32(uint256(1))), 0x7cedd517134e283c3967fd4b44d532d0ab4f8c52bb14addb802db9fca715ec10
        );
    }

    function test_RankTupleUsesCommitKeyAsTheDeterministicTieBreak() public view {
        bytes32 sameHash = keccak256("rank-collision-fixture");
        assertTrue(rbts.rankBefore(sameHash, bytes32(uint256(1)), sameHash, bytes32(uint256(2))));
        assertFalse(rbts.rankBefore(sameHash, bytes32(uint256(2)), sameHash, bytes32(uint256(1))));
        assertFalse(rbts.rankBefore(sameHash, bytes32(uint256(1)), sameHash, bytes32(uint256(1))));
    }

    function test_CanonicalCircularSelectionMatchesFrozenVector() public view {
        bytes32[] memory keys = _fiveKeys();
        _assertAssignment(keys, 1, 2, 4);
        _assertAssignment(keys, 2, 4, 5);
        _assertAssignment(keys, 3, 1, 2);
        _assertAssignment(keys, 4, 5, 3);
        _assertAssignment(keys, 5, 3, 1);
    }

    function test_SelectionIsInputOrderIndependentAndUsesEachRoleExactlyOnce() public view {
        bytes32[] memory canonical = _fiveKeys();
        bytes32[] memory reordered = new bytes32[](5);
        reordered[0] = canonical[3];
        reordered[1] = canonical[0];
        reordered[2] = canonical[4];
        reordered[3] = canonical[1];
        reordered[4] = canonical[2];
        uint256[] memory referenceCounts = new uint256[](canonical.length);
        uint256[] memory peerCounts = new uint256[](canonical.length);

        for (uint256 i = 0; i < canonical.length; ++i) {
            (bytes32 referenceKey, bytes32 peerKey) = rbts.selectReferenceAndPeer(VECTOR_SEED, canonical[i], canonical);
            (bytes32 reorderedReference, bytes32 reorderedPeer) =
                rbts.selectReferenceAndPeer(VECTOR_SEED, canonical[i], reordered);
            assertEq(referenceKey, reorderedReference);
            assertEq(peerKey, reorderedPeer);
            assertNotEq(referenceKey, canonical[i]);
            assertNotEq(peerKey, canonical[i]);
            assertNotEq(referenceKey, peerKey);
            ++referenceCounts[_indexOf(canonical, referenceKey)];
            ++peerCounts[_indexOf(canonical, peerKey)];
        }

        for (uint256 i = 0; i < canonical.length; ++i) {
            assertEq(referenceCounts[i], 1);
            assertEq(peerCounts[i], 1);
        }
    }

    function test_CanonicalHeapSortSuccessorsMatchIndependentSelection() public view {
        bytes32[] memory input = _sevenDistinctKeys();
        bytes32[] memory sorted = rbts.sortCanonical(VECTOR_SEED, input);

        for (uint256 i = 0; i < sorted.length; ++i) {
            if (i > 0) {
                assertTrue(
                    rbts.rankBefore(
                        rbts.rankHash(VECTOR_SEED, sorted[i - 1]),
                        sorted[i - 1],
                        rbts.rankHash(VECTOR_SEED, sorted[i]),
                        sorted[i]
                    )
                );
            }
            (bytes32 expectedReference, bytes32 expectedPeer) =
                rbts.selectReferenceAndPeer(VECTOR_SEED, sorted[i], sorted);
            assertEq(sorted[(i + 1) % sorted.length], expectedReference);
            assertEq(sorted[(i + 2) % sorted.length], expectedPeer);
        }
    }

    function testFuzz_SelectionIsDeterministicAcrossRotation(bytes32 seed, uint8 rotationSeed) public view {
        bytes32[] memory canonical = _sevenDistinctKeys();
        bytes32[] memory rotated = new bytes32[](canonical.length);
        uint256 rotation = uint256(rotationSeed) % canonical.length;
        for (uint256 i = 0; i < canonical.length; ++i) {
            rotated[i] = canonical[(i + rotation) % canonical.length];
        }

        for (uint256 i = 0; i < canonical.length; ++i) {
            (bytes32 referenceKey, bytes32 peerKey) = rbts.selectReferenceAndPeer(seed, canonical[i], canonical);
            (bytes32 rotatedReference, bytes32 rotatedPeer) = rbts.selectReferenceAndPeer(seed, canonical[i], rotated);
            assertEq(referenceKey, rotatedReference);
            assertEq(peerKey, rotatedPeer);
        }
    }

    function test_InvalidOrIncompleteRevealSetsFailClosed() public {
        bytes32[] memory tooSmall = new bytes32[](2);
        tooSmall[0] = bytes32(uint256(1));
        tooSmall[1] = bytes32(uint256(2));
        vm.expectRevert(TokenlessRbts.InvalidRevealSet.selector);
        rbts.selectReferenceAndPeer(VECTOR_SEED, tooSmall[0], tooSmall);

        bytes32[] memory missingOwn = _fiveKeys();
        vm.expectRevert(TokenlessRbts.InvalidRevealSet.selector);
        rbts.selectReferenceAndPeer(VECTOR_SEED, bytes32(uint256(99)), missingOwn);

        bytes32[] memory duplicateOwn = new bytes32[](3);
        duplicateOwn[0] = bytes32(uint256(1));
        duplicateOwn[1] = bytes32(uint256(1));
        duplicateOwn[2] = bytes32(uint256(2));
        vm.expectRevert(TokenlessRbts.InvalidRevealSet.selector);
        rbts.selectReferenceAndPeer(VECTOR_SEED, duplicateOwn[0], duplicateOwn);
    }

    function test_GasMaximumPanelSingleSeatSelectionRemainsPaginateable() public {
        TokenlessRbtsStorageGasHarness harness = new TokenlessRbtsStorageGasHarness(500);
        uint256 gasBefore = gasleft();
        (bytes32 referenceKey, bytes32 peerKey) = harness.selectAt(VECTOR_SEED, 249);
        uint256 gasUsed = gasBefore - gasleft();

        emit log_named_uint("500-seat storage-copy plus single selection gas", gasUsed);
        assertNotEq(referenceKey, bytes32(0));
        assertNotEq(peerKey, bytes32(0));
        assertNotEq(referenceKey, peerKey);
        assertLt(gasUsed, 2_000_000);
    }

    function _assertAssignment(bytes32[] memory keys, uint256 own, uint256 referenceKey, uint256 peerKey) private view {
        (bytes32 actualReference, bytes32 actualPeer) = rbts.selectReferenceAndPeer(VECTOR_SEED, bytes32(own), keys);
        assertEq(actualReference, bytes32(referenceKey));
        assertEq(actualPeer, bytes32(peerKey));
    }

    function _accumulate(bytes32[] memory keys) private view returns (bytes32 setXor, uint256 setSum) {
        for (uint256 i = 0; i < keys.length; ++i) {
            (setXor, setSum) = rbts.accumulateRevealSet(setXor, setSum, keys[i]);
        }
    }

    function _indexOf(bytes32[] memory keys, bytes32 needle) private pure returns (uint256) {
        for (uint256 i = 0; i < keys.length; ++i) {
            if (keys[i] == needle) return i;
        }
        revert("missing fixture key");
    }

    function _fiveKeys() private pure returns (bytes32[] memory keys) {
        keys = new bytes32[](5);
        for (uint256 i = 0; i < keys.length; ++i) {
            keys[i] = bytes32(i + 1);
        }
    }

    function _sevenDistinctKeys() private pure returns (bytes32[] memory keys) {
        keys = new bytes32[](7);
        for (uint256 i = 0; i < keys.length; ++i) {
            keys[i] = keccak256(abi.encode("rater", i));
        }
    }
}
