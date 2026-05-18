// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title RobustBtsMath
/// @notice Binary Robust Bayesian Truth Serum scoring helpers using 0-10000 BPS probabilities.
library RobustBtsMath {
    uint16 internal constant BPS_SCALE = 10_000;

    /// @notice Tightest user-facing prediction bounds. Predictions at exactly 0 or 10000 collapse
    ///         `shadowPredictionBps` to a function of the peer signal alone, allowing a two-commit
    ///         attacker to wipe the information half of honest voters' BTS scores (L-Vote-8).
    ///         Internal helpers still accept the full [0, 10000] range because shadow values
    ///         legitimately reach the endpoints by construction.
    uint16 internal constant MIN_USER_PREDICTION_BPS = 100;
    uint16 internal constant MAX_USER_PREDICTION_BPS = 9_900;

    error InvalidPrediction();

    function requireValidPrediction(uint16 predictedUpBps) internal pure {
        if (predictedUpBps > BPS_SCALE) revert InvalidPrediction();
    }

    /// @notice Stricter check used on user-supplied predictions at reveal time. Rejects the
    ///         0 / 10000 endpoints where `shadowPredictionBps` becomes peer-signal-only.
    function requireValidUserPrediction(uint16 predictedUpBps) internal pure {
        if (predictedUpBps < MIN_USER_PREDICTION_BPS || predictedUpBps > MAX_USER_PREDICTION_BPS) {
            revert InvalidPrediction();
        }
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

    function scoreBps(bool ownSignalIsUp, uint16 ownPredictionBps, uint16 referencePredictionBps, bool peerSignalIsUp)
        internal
        pure
        returns (uint16)
    {
        uint16 shadow = shadowPredictionBps(referencePredictionBps, ownSignalIsUp);
        uint256 informationScore = quadraticScoreBps(shadow, peerSignalIsUp);
        uint256 predictionScore = quadraticScoreBps(ownPredictionBps, peerSignalIsUp);
        return uint16((informationScore + predictionScore) / 2);
    }
}
