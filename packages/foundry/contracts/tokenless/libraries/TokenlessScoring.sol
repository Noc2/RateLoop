// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/// @title TokenlessScoring
/// @notice Pure v0 payout transform: 80% equal base and 20% prediction-accuracy bonus.
library TokenlessScoring {
    uint16 internal constant BPS = 10_000;
    uint16 internal constant BASE_POOL_BPS = 8_000;
    uint256 internal constant MAX_SQUARED_ERROR = 100_000_000;

    error InvalidPredictionBucket();
    error InvalidVote();
    error InvalidRevealSet();

    /// @notice v0 accepts one of five low-friction prediction buckets.
    function isPredictionBucket(uint16 predictedUpBps) internal pure returns (bool) {
        return predictedUpBps == 1_000 || predictedUpBps == 3_000 || predictedUpBps == 5_000 || predictedUpBps == 7_000
            || predictedUpBps == 9_000;
    }

    /// @notice Score prediction accuracy against the immutable leave-one-out panel share.
    /// @dev This is intentionally legible rather than marketed as a full RBTS implementation.
    ///      A one-person reveal set uses the neutral 50% reference point.
    function accuracyScore(uint8 vote, uint16 predictedUpBps, uint256 upVotes, uint256 revealCount)
        internal
        pure
        returns (uint256)
    {
        if (vote > 1) revert InvalidVote();
        if (!isPredictionBucket(predictedUpBps)) revert InvalidPredictionBucket();
        if (revealCount == 0 || upVotes > revealCount || vote > upVotes) revert InvalidRevealSet();

        uint256 peerUpBps = revealCount == 1 ? 5_000 : ((upVotes - vote) * BPS) / (revealCount - 1);
        uint256 difference = predictedUpBps > peerUpBps ? predictedUpBps - peerUpBps : peerUpBps - predictedUpBps;
        return MAX_SQUARED_ERROR - difference * difference;
    }

    function pools(uint256 bountyAmount) internal pure returns (uint256 basePool, uint256 bonusPool) {
        basePool = (bountyAmount * BASE_POOL_BPS) / BPS;
        bonusPool = bountyAmount - basePool;
    }
}
