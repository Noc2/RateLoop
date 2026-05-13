// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ProtocolConfig } from "../ProtocolConfig.sol";
import { IRaterDeclarationStatus } from "../interfaces/IRaterDeclarationStatus.sol";
import { IRaterRegistryStatus } from "../interfaces/IRaterRegistryStatus.sol";
import {
    BOUNTY_ELIGIBILITY_OPEN,
    BOUNTY_ELIGIBILITY_VERIFIED_HUMAN,
    BOUNTY_ELIGIBILITY_ACTIVE_AI,
    BOUNTY_ELIGIBILITY_VERIFIED_HUMAN_OR_ACTIVE_AI,
    BOUNTY_ELIGIBILITY_SPECIFIC_AI_DECLARATIONS
} from "./QuestionRewardPoolEscrowTypes.sol";

library QuestionRewardPoolEscrowEligibilityLib {
    function isValidPolicy(uint8 bountyEligibility) internal pure returns (bool) {
        return bountyEligibility <= BOUNTY_ELIGIBILITY_SPECIFIC_AI_DECLARATIONS;
    }

    function isAccountEligibleForBounty(
        ProtocolConfig protocolConfig,
        uint8 bountyEligibility,
        mapping(uint256 => mapping(bytes32 => bool)) storage allowedAiDeclarationIds,
        uint256 rewardId,
        address account
    ) internal view returns (bool) {
        if (bountyEligibility == BOUNTY_ELIGIBILITY_OPEN) return true;
        if (account == address(0)) return false;

        if (bountyEligibility == BOUNTY_ELIGIBILITY_VERIFIED_HUMAN) {
            return _hasActiveHumanCredential(protocolConfig, account);
        }
        if (bountyEligibility == BOUNTY_ELIGIBILITY_ACTIVE_AI) {
            return _hasActiveAiDeclaration(protocolConfig, account);
        }
        if (bountyEligibility == BOUNTY_ELIGIBILITY_VERIFIED_HUMAN_OR_ACTIVE_AI) {
            return
                _hasActiveHumanCredential(protocolConfig, account) || _hasActiveAiDeclaration(protocolConfig, account);
        }
        if (bountyEligibility == BOUNTY_ELIGIBILITY_SPECIFIC_AI_DECLARATIONS) {
            bytes32 declarationHash = _activeAiDeclarationHash(protocolConfig, account);
            return declarationHash != bytes32(0) && allowedAiDeclarationIds[rewardId][declarationHash];
        }
        return false;
    }

    function eligibilityDataHash(bytes32[] memory allowedAiDeclarationIds) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(allowedAiDeclarationIds));
    }

    function _hasActiveHumanCredential(ProtocolConfig protocolConfig, address account) private view returns (bool) {
        if (address(protocolConfig) == address(0)) return false;
        address raterRegistry = protocolConfig.raterRegistry();
        if (raterRegistry == address(0)) return false;

        try IRaterRegistryStatus(raterRegistry).hasActiveHumanCredential(account) returns (bool active) {
            return active;
        } catch {
            return false;
        }
    }

    function _hasActiveAiDeclaration(ProtocolConfig protocolConfig, address account) private view returns (bool) {
        if (address(protocolConfig) == address(0)) return false;
        address declarationRegistry = protocolConfig.raterDeclarationRegistry();
        if (declarationRegistry == address(0)) return false;

        try IRaterDeclarationStatus(declarationRegistry).hasActiveAiDeclaration(account) returns (bool active) {
            return active;
        } catch {
            return _activeAiDeclarationHash(protocolConfig, account) != bytes32(0);
        }
    }

    function _activeAiDeclarationHash(ProtocolConfig protocolConfig, address account) private view returns (bytes32) {
        if (address(protocolConfig) == address(0)) return bytes32(0);
        address declarationRegistry = protocolConfig.raterDeclarationRegistry();
        if (declarationRegistry == address(0)) return bytes32(0);

        try IRaterDeclarationStatus(declarationRegistry).activeAiDeclarationHash(account) returns (
            bytes32 declarationHash
        ) {
            return declarationHash;
        } catch {
            return bytes32(0);
        }
    }
}
