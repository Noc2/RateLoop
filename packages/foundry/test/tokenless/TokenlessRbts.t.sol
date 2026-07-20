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

    function sortCanonical(bytes32 seed, bytes32[] memory commitKeys) external pure returns (bytes32[] memory) {
        TokenlessRbts.sortCanonical(seed, commitKeys);
        return commitKeys;
    }
}

contract TokenlessRbtsTest is Test {
    struct OracleCandidate {
        bytes32 commitKey;
        bytes32 rankHash;
        bool wraps;
        bool set;
    }

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
        bytes32[] memory sorted = rbts.sortCanonical(VECTOR_SEED, canonical);
        bytes32[] memory reorderedSorted = rbts.sortCanonical(VECTOR_SEED, reordered);

        for (uint256 i = 0; i < canonical.length; ++i) {
            assertEq(sorted[i], reorderedSorted[i]);
            bytes32 referenceKey = sorted[(i + 1) % sorted.length];
            bytes32 peerKey = sorted[(i + 2) % sorted.length];
            assertNotEq(referenceKey, sorted[i]);
            assertNotEq(peerKey, sorted[i]);
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
            if (i > 0) assertTrue(_oracleRankBefore(VECTOR_SEED, sorted[i - 1], sorted[i]));
            (bytes32 expectedReference, bytes32 expectedPeer) =
                _selectReferenceAndPeerOracle(VECTOR_SEED, sorted[i], input);
            assertEq(sorted[(i + 1) % sorted.length], expectedReference);
            assertEq(sorted[(i + 2) % sorted.length], expectedPeer);
        }
    }

    function testFuzz_CanonicalHeapSortMatchesIndependentOracleAcrossPanelCap(
        bytes32 seed,
        bytes32 keyDomain,
        uint16 panelSizeSeed,
        uint16 ownIndexSeed
    ) public view {
        uint256 panelSize = bound(uint256(panelSizeSeed), 3, 500);
        bytes32[] memory input = _distinctKeys(panelSize, keyDomain);
        bytes32[] memory sorted = rbts.sortCanonical(seed, input);

        _assertSameRevealSet(input, sorted);
        _assertStrictlyCanonical(seed, sorted);
        _assertOracleAssignment(seed, input, sorted, uint256(ownIndexSeed) % panelSize);
    }

    function test_InvalidOrIncompleteRevealSetsFailClosed() public {
        bytes32[] memory tooSmall = new bytes32[](2);
        tooSmall[0] = bytes32(uint256(1));
        tooSmall[1] = bytes32(uint256(2));
        vm.expectRevert(TokenlessRbts.InvalidRevealSet.selector);
        rbts.sortCanonical(VECTOR_SEED, tooSmall);
    }

    function test_MaximumPanelCanonicalSortMatchesIndependentOracleSamples() public view {
        bytes32[] memory input = _distinctKeys(500, keccak256("maximum-panel"));
        bytes32[] memory sorted = rbts.sortCanonical(VECTOR_SEED, input);

        _assertSameRevealSet(input, sorted);
        _assertStrictlyCanonical(VECTOR_SEED, sorted);
        _assertOracleAssignment(VECTOR_SEED, input, sorted, 0);
        _assertOracleAssignment(VECTOR_SEED, input, sorted, 249);
        _assertOracleAssignment(VECTOR_SEED, input, sorted, 499);
    }

    function _assertAssignment(bytes32[] memory keys, uint256 own, uint256 referenceKey, uint256 peerKey) private view {
        bytes32[] memory sorted = rbts.sortCanonical(VECTOR_SEED, keys);
        uint256 ownIndex = _indexOf(sorted, bytes32(own));
        assertEq(sorted[(ownIndex + 1) % sorted.length], bytes32(referenceKey));
        assertEq(sorted[(ownIndex + 2) % sorted.length], bytes32(peerKey));
    }

    function _assertSameRevealSet(bytes32[] memory input, bytes32[] memory sorted) private view {
        (bytes32 inputXor, uint256 inputSum) = _accumulate(input);
        (bytes32 sortedXor, uint256 sortedSum) = _accumulate(sorted);
        assertEq(sortedXor, inputXor);
        assertEq(sortedSum, inputSum);
    }

    function _assertStrictlyCanonical(bytes32 seed, bytes32[] memory sorted) private pure {
        for (uint256 i = 1; i < sorted.length; ++i) {
            assertTrue(_oracleRankBefore(seed, sorted[i - 1], sorted[i]));
        }
    }

    function _assertOracleAssignment(bytes32 seed, bytes32[] memory input, bytes32[] memory sorted, uint256 ownIndex)
        private
        pure
    {
        bytes32 ownCommitKey = sorted[ownIndex];
        (bytes32 expectedReference, bytes32 expectedPeer) = _selectReferenceAndPeerOracle(seed, ownCommitKey, input);
        assertEq(sorted[(ownIndex + 1) % sorted.length], expectedReference);
        assertEq(sorted[(ownIndex + 2) % sorted.length], expectedPeer);
    }

    /// @dev Independent O(n) test oracle retained outside production code.
    function _selectReferenceAndPeerOracle(bytes32 seed, bytes32 ownCommitKey, bytes32[] memory commitKeys)
        private
        pure
        returns (bytes32 referenceCommitKey, bytes32 peerCommitKey)
    {
        bytes32 ownRankHash = keccak256(abi.encode(seed, ownCommitKey));
        uint256 ownMatches;
        OracleCandidate memory first;
        OracleCandidate memory second;

        for (uint256 i = 0; i < commitKeys.length; ++i) {
            bytes32 candidateKey = commitKeys[i];
            if (candidateKey == ownCommitKey) {
                ++ownMatches;
                continue;
            }

            bytes32 candidateRankHash = keccak256(abi.encode(seed, candidateKey));
            OracleCandidate memory candidate = OracleCandidate({
                commitKey: candidateKey,
                rankHash: candidateRankHash,
                wraps: _oracleTupleBefore(candidateRankHash, candidateKey, ownRankHash, ownCommitKey),
                set: true
            });
            if (_oracleCandidateBefore(candidate, first)) {
                second = first;
                first = candidate;
            } else if (_oracleCandidateBefore(candidate, second)) {
                second = candidate;
            }
        }

        assertEq(ownMatches, 1);
        assertTrue(first.set && second.set);
        return (first.commitKey, second.commitKey);
    }

    function _oracleCandidateBefore(OracleCandidate memory left, OracleCandidate memory right)
        private
        pure
        returns (bool)
    {
        if (!right.set) return true;
        if (left.wraps != right.wraps) return !left.wraps;
        return _oracleTupleBefore(left.rankHash, left.commitKey, right.rankHash, right.commitKey);
    }

    function _oracleRankBefore(bytes32 seed, bytes32 leftKey, bytes32 rightKey) private pure returns (bool) {
        return _oracleTupleBefore(
            keccak256(abi.encode(seed, leftKey)), leftKey, keccak256(abi.encode(seed, rightKey)), rightKey
        );
    }

    function _oracleTupleBefore(bytes32 leftHash, bytes32 leftKey, bytes32 rightHash, bytes32 rightKey)
        private
        pure
        returns (bool)
    {
        if (leftHash != rightHash) return uint256(leftHash) < uint256(rightHash);
        return uint256(leftKey) < uint256(rightKey);
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

    function _distinctKeys(uint256 count, bytes32 domain) private pure returns (bytes32[] memory keys) {
        keys = new bytes32[](count);
        for (uint256 i = 0; i < count; ++i) {
            keys[i] = keccak256(abi.encode("fuzz-rater", domain, i));
        }
    }
}
