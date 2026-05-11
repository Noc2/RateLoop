// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ProtocolConfig } from "../ProtocolConfig.sol";
import { IRaterDeclarationWeights } from "../interfaces/IRaterDeclarationWeights.sol";
import { IRaterRegistryWeights } from "../interfaces/IRaterRegistryWeights.sol";

/// @notice Linked helper for commit-time rater weight snapshots.
library RaterWeightLib {
    uint16 internal constant WEIGHT_BPS = 10_000;
    uint16 internal constant MAX_COMBINED_RATER_WEIGHT_BPS = 12_500;

    function currentRaterWeightBps(ProtocolConfig protocolConfig, address voter) external view returns (uint16) {
        (uint16 weightBps,) = currentRaterWeightAndAiStatus(protocolConfig, voter);
        return weightBps;
    }

    function currentRaterWeightAndAiStatus(ProtocolConfig protocolConfig, address voter)
        public
        view
        returns (uint16, bool)
    {
        uint256 weightBps = WEIGHT_BPS;
        bool hadActiveAiDeclaration;
        address configuredRaterRegistry = protocolConfig.raterRegistry();
        if (configuredRaterRegistry != address(0)) {
            IRaterRegistryWeights registryWeights = IRaterRegistryWeights(configuredRaterRegistry);
            try registryWeights.getClusterScore(voter) returns (bytes32, uint16 discountBps, uint64, uint64 updatedAt) {
                if (updatedAt != 0) {
                    if (discountBps >= WEIGHT_BPS) {
                        weightBps = 0;
                    } else {
                        weightBps = (weightBps * (WEIGHT_BPS - discountBps)) / WEIGHT_BPS;
                    }
                }
            } catch { }

            try registryWeights.credentialMultiplierBps(voter) returns (uint16 multiplierBps) {
                if (multiplierBps > WEIGHT_BPS) weightBps = (weightBps * multiplierBps) / WEIGHT_BPS;
            } catch { }
        }

        address configuredRaterDeclarationRegistry = protocolConfig.raterDeclarationRegistry();
        if (configuredRaterDeclarationRegistry != address(0)) {
            IRaterDeclarationWeights declarationWeights = IRaterDeclarationWeights(configuredRaterDeclarationRegistry);
            try declarationWeights.hasActiveAiDeclaration(voter) returns (bool active) {
                hadActiveAiDeclaration = active;
            } catch { }

            try declarationWeights.tierMultiplierBps(voter) returns (uint16 multiplierBps) {
                if (multiplierBps > WEIGHT_BPS) {
                    weightBps = (weightBps * multiplierBps) / WEIGHT_BPS;
                }
            } catch { }
        }

        if (weightBps > MAX_COMBINED_RATER_WEIGHT_BPS) return (MAX_COMBINED_RATER_WEIGHT_BPS, hadActiveAiDeclaration);
        return (uint16(weightBps), hadActiveAiDeclaration);
    }

    function hasActiveAiDeclaration(ProtocolConfig protocolConfig, address rater) public view returns (bool) {
        address configuredRaterDeclarationRegistry = protocolConfig.raterDeclarationRegistry();
        if (configuredRaterDeclarationRegistry == address(0)) return false;

        IRaterDeclarationWeights declarationWeights = IRaterDeclarationWeights(configuredRaterDeclarationRegistry);
        try declarationWeights.hasActiveAiDeclaration(rater) returns (bool active) {
            return active;
        } catch {
            return false;
        }
    }
}
