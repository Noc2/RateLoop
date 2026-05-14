// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title RobustBtsMath
/// @notice Binary Robust Bayesian Truth Serum scoring helpers using 0-10000 BPS probabilities.
library RobustBtsMath {
    uint16 internal constant BPS_SCALE = 10_000;

    error InvalidPrediction();

    struct ScoreParts {
        uint16 informationScoreBps;
        uint16 predictionScoreBps;
    }

    function requireValidPrediction(uint16 predictedUpBps) internal pure {
        if (predictedUpBps > BPS_SCALE) revert InvalidPrediction();
    }

    function shadowPredictionBps(uint16 referencePredictionBps, bool signalIsUp) internal pure returns (uint16) {
        requireValidPrediction(referencePredictionBps);
        uint16 delta = referencePredictionBps <= BPS_SCALE - referencePredictionBps
            ? referencePredictionBps
            : BPS_SCALE - referencePredictionBps;
        return signalIsUp ? referencePredictionBps + delta : referencePredictionBps - delta;
    }

    function quadraticScoreBps(uint16 predictionBps, bool actualIsUp) internal pure returns (uint16) {
        requireValidPrediction(predictionBps);
        uint256 y = predictionBps;
        uint256 ySquared = y * y;
        if (actualIsUp) {
            return uint16(((2 * uint256(BPS_SCALE) * y) - ySquared) / BPS_SCALE);
        }
        return uint16(uint256(BPS_SCALE) - (ySquared / BPS_SCALE));
    }

    function informationScoreBps(bool ownSignalIsUp, uint16 referencePredictionBps, bool peerSignalIsUp)
        internal
        pure
        returns (uint16)
    {
        uint16 shadow = shadowPredictionBps(referencePredictionBps, ownSignalIsUp);
        return quadraticScoreBps(shadow, peerSignalIsUp);
    }

    function predictionScoreBps(uint16 ownPredictionBps, bool peerSignalIsUp) internal pure returns (uint16) {
        return quadraticScoreBps(ownPredictionBps, peerSignalIsUp);
    }

    function scorePartsBps(
        bool ownSignalIsUp,
        uint16 ownPredictionBps,
        uint16 referencePredictionBps,
        bool peerSignalIsUp
    ) internal pure returns (ScoreParts memory parts) {
        parts.informationScoreBps = informationScoreBps(ownSignalIsUp, referencePredictionBps, peerSignalIsUp);
        parts.predictionScoreBps = predictionScoreBps(ownPredictionBps, peerSignalIsUp);
    }

    function scoreBps(
        bool ownSignalIsUp,
        uint16 ownPredictionBps,
        uint16 referencePredictionBps,
        bool peerSignalIsUp
    ) internal pure returns (uint16) {
        ScoreParts memory parts =
            scorePartsBps(ownSignalIsUp, ownPredictionBps, referencePredictionBps, peerSignalIsUp);
        return uint16((uint256(parts.informationScoreBps) + uint256(parts.predictionScoreBps)) / 2);
    }
}
