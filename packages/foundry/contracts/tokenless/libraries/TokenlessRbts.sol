// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/// @title TokenlessRbts
/// @notice Pure tokenless-rbts-v1 scoring, reveal-set, seed, and canonical peer-selection helpers.
/// @dev The fund core supplies a post-closure entropy value and a frozen list of distinct commit keys.
library TokenlessRbts {
    uint16 internal constant BPS = 10_000;
    uint16 internal constant MIN_USER_PREDICTION_BPS = 100;
    uint16 internal constant MAX_USER_PREDICTION_BPS = 9_900;
    uint16 internal constant USER_PREDICTION_STEP_BPS = 100;
    uint8 internal constant SCORING_VERSION = 2;
    string internal constant SCORING_SEED_DOMAIN = "rateloop-tokenless-rbts-v1";

    struct Score {
        uint16 shadowPredictionBps;
        uint16 informationScoreBps;
        uint16 predictionScoreBps;
        uint16 scoreBps;
    }

    struct RankedCandidate {
        bytes32 commitKey;
        bytes32 rankHash;
        bool wraps;
        bool set;
    }

    error InvalidPrediction();
    error InvalidRevealSet();
    error InvalidVote();

    /// @notice v1 accepts predictions from 1% through 99% on an exact 1%-step grid.
    function isValidUserPrediction(uint16 predictedUpBps) internal pure returns (bool) {
        return predictedUpBps >= MIN_USER_PREDICTION_BPS && predictedUpBps <= MAX_USER_PREDICTION_BPS
            && predictedUpBps % USER_PREDICTION_STEP_BPS == 0;
    }

    function shadowPredictionBps(uint16 referencePredictionBps, uint8 ownVote) internal pure returns (uint16 shadow) {
        _requireVote(ownVote);
        _requireUserPrediction(referencePredictionBps);
        uint16 inverse = BPS - referencePredictionBps;
        uint16 delta = referencePredictionBps <= inverse ? referencePredictionBps : inverse;
        shadow = ownVote == 1 ? referencePredictionBps + delta : referencePredictionBps - delta;
    }

    /// @notice Bounded quadratic score for an internal probability, including shadow endpoints 0% and 100%.
    function quadraticScoreBps(uint16 predictionBps, uint8 actualVote) internal pure returns (uint16 scoreBps) {
        _requireVote(actualVote);
        if (predictionBps > BPS) revert InvalidPrediction();
        uint256 prediction = predictionBps;
        uint256 squared = prediction * prediction;
        if (actualVote == 1) {
            scoreBps = uint16(((2 * uint256(BPS) * prediction) - squared) / BPS);
        } else {
            scoreBps = uint16(uint256(BPS) - (squared / BPS));
        }
    }

    /// @notice Compute the vote-linked information score and prediction score for one frozen assignment.
    function score(uint8 ownVote, uint16 ownPredictionBps, uint16 referencePredictionBps, uint8 peerVote)
        internal
        pure
        returns (Score memory result)
    {
        _requireVote(ownVote);
        _requireVote(peerVote);
        _requireUserPrediction(ownPredictionBps);
        _requireUserPrediction(referencePredictionBps);

        result.shadowPredictionBps = shadowPredictionBps(referencePredictionBps, ownVote);
        result.informationScoreBps = quadraticScoreBps(result.shadowPredictionBps, peerVote);
        result.predictionScoreBps = quadraticScoreBps(ownPredictionBps, peerVote);
        result.scoreBps = uint16((uint256(result.informationScoreBps) + result.predictionScoreBps) / 2);
    }

    /// @notice Add one commit key to the order-independent XOR and modular-sum reveal-set commitment.
    function accumulateRevealSet(bytes32 revealSetXor, uint256 revealSetSum, bytes32 commitKey)
        internal
        pure
        returns (bytes32 nextXor, uint256 nextSum)
    {
        bytes32 leaf = keccak256(abi.encode(commitKey));
        nextXor = revealSetXor ^ leaf;
        unchecked {
            nextSum = revealSetSum + uint256(leaf);
        }
    }

    /// @notice Bind the exact frozen set and post-closure entropy into the v1 scoring seed.
    function scoringSeed(
        uint256 chainId,
        address panelAddress,
        uint256 roundId,
        uint32 frozenRevealCount,
        bytes32 revealSetXor,
        uint256 revealSetSum,
        bytes32 entropy
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SCORING_SEED_DOMAIN,
                chainId,
                panelAddress,
                roundId,
                frozenRevealCount,
                revealSetXor,
                revealSetSum,
                entropy
            )
        );
    }

    /// @notice Hash component of the canonical `(rankHash, commitKey)` ordering tuple.
    function rankHash(bytes32 seed, bytes32 commitKey) internal pure returns (bytes32) {
        return keccak256(abi.encode(seed, commitKey));
    }

    /// @notice Strict lexicographic ordering for canonical rank tuples, including the commit-key tie break.
    function rankBefore(bytes32 leftHash, bytes32 leftKey, bytes32 rightHash, bytes32 rightKey)
        internal
        pure
        returns (bool)
    {
        if (leftHash != rightHash) return uint256(leftHash) < uint256(rightHash);
        return uint256(leftKey) < uint256(rightKey);
    }

    /// @notice Sort the exact frozen reveal set by the canonical `(rankHash, commitKey)` tuple.
    /// @dev Heap sort is deterministic O(n log n), in-place in memory, and has bounded stack usage.
    ///      The fund core persists this order once, after the beacon proof is verified, so each
    ///      later score requires only constant-time successor lookups.
    function sortCanonical(bytes32 seed, bytes32[] memory commitKeys) internal pure {
        uint256 length = commitKeys.length;
        if (length < 3) revert InvalidRevealSet();

        bytes32[] memory rankHashes = new bytes32[](length);
        for (uint256 i; i < length; ++i) {
            rankHashes[i] = rankHash(seed, commitKeys[i]);
        }

        for (uint256 start = length / 2; start > 0;) {
            unchecked {
                --start;
            }
            _siftDown(commitKeys, rankHashes, start, length);
        }
        for (uint256 end = length - 1; end > 0;) {
            _swap(commitKeys, rankHashes, 0, end);
            _siftDown(commitKeys, rankHashes, 0, end);
            unchecked {
                --end;
            }
        }
    }

    /// @notice Find the next and next-next reports in the canonical circular hash-rank ordering.
    /// @dev `revealedCommitKeys` must be the frozen set of distinct commit keys. The scan is O(n), so the
    ///      integrating fund core must retain a tested maximum panel-size bound and paginate outer scoring.
    function selectReferenceAndPeer(bytes32 seed, bytes32 ownCommitKey, bytes32[] memory revealedCommitKeys)
        internal
        pure
        returns (bytes32 referenceCommitKey, bytes32 peerCommitKey)
    {
        if (revealedCommitKeys.length < 3) revert InvalidRevealSet();

        bytes32 ownRankHash = rankHash(seed, ownCommitKey);
        uint256 ownMatches;
        RankedCandidate memory first;
        RankedCandidate memory second;

        for (uint256 i = 0; i < revealedCommitKeys.length; ++i) {
            bytes32 candidateKey = revealedCommitKeys[i];
            if (candidateKey == ownCommitKey) {
                ++ownMatches;
                continue;
            }

            bytes32 candidateRankHash = rankHash(seed, candidateKey);
            RankedCandidate memory candidate = RankedCandidate({
                commitKey: candidateKey,
                rankHash: candidateRankHash,
                wraps: rankBefore(candidateRankHash, candidateKey, ownRankHash, ownCommitKey),
                set: true
            });

            if (_candidateBefore(candidate, first)) {
                second = first;
                first = candidate;
            } else if (_candidateBefore(candidate, second)) {
                second = candidate;
            }
        }

        if (ownMatches != 1 || !first.set || !second.set || first.commitKey == second.commitKey) {
            revert InvalidRevealSet();
        }
        return (first.commitKey, second.commitKey);
    }

    function _candidateBefore(RankedCandidate memory left, RankedCandidate memory right) private pure returns (bool) {
        if (!right.set) return true;
        if (left.wraps != right.wraps) return !left.wraps;
        return rankBefore(left.rankHash, left.commitKey, right.rankHash, right.commitKey);
    }

    function _siftDown(bytes32[] memory keys, bytes32[] memory hashes, uint256 root, uint256 length) private pure {
        while (true) {
            uint256 child = root * 2 + 1;
            if (child >= length) return;

            uint256 selected = root;
            if (rankBefore(hashes[selected], keys[selected], hashes[child], keys[child])) selected = child;
            if (child + 1 < length && rankBefore(hashes[selected], keys[selected], hashes[child + 1], keys[child + 1]))
            {
                selected = child + 1;
            }
            if (selected == root) return;
            _swap(keys, hashes, root, selected);
            root = selected;
        }
    }

    function _swap(bytes32[] memory keys, bytes32[] memory hashes, uint256 left, uint256 right) private pure {
        (keys[left], keys[right]) = (keys[right], keys[left]);
        (hashes[left], hashes[right]) = (hashes[right], hashes[left]);
    }

    function _requireUserPrediction(uint16 predictedUpBps) private pure {
        if (!isValidUserPrediction(predictedUpBps)) revert InvalidPrediction();
    }

    function _requireVote(uint8 vote) private pure {
        if (vote > 1) revert InvalidVote();
    }
}
