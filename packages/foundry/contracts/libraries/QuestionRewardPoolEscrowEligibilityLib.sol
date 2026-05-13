// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ProtocolConfig } from "../ProtocolConfig.sol";
import { IRaterRegistryStatus } from "../interfaces/IRaterRegistryStatus.sol";
import {
    BOUNTY_ELIGIBILITY_OPEN,
    BOUNTY_ELIGIBILITY_VERIFIED_HUMAN
} from "./QuestionRewardPoolEscrowTypes.sol";

library QuestionRewardPoolEscrowEligibilityLib {
    function isValidPolicy(uint8 bountyEligibility) internal pure returns (bool) {
        return bountyEligibility <= BOUNTY_ELIGIBILITY_VERIFIED_HUMAN;
    }

    function isAccountEligibleForBounty(
        ProtocolConfig protocolConfig,
        uint8 bountyEligibility,
        address account
    ) internal view returns (bool) {
        if (bountyEligibility == BOUNTY_ELIGIBILITY_OPEN) return true;
        if (account == address(0)) return false;

        if (bountyEligibility == BOUNTY_ELIGIBILITY_VERIFIED_HUMAN) {
            return _hasActiveHumanCredential(protocolConfig, account);
        }
        return false;
    }

    function eligibilityDataHash() internal pure returns (bytes32) {
        return bytes32(0);
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

}
