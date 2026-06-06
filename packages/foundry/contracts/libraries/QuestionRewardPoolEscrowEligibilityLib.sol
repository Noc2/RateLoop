// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ProtocolConfig } from "../ProtocolConfig.sol";
import { IRaterRegistryStatus } from "../interfaces/IRaterRegistryStatus.sol";
import {
    BOUNTY_ELIGIBILITY_CREDENTIAL_MASK,
    BOUNTY_ELIGIBILITY_OPEN,
    BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG
} from "./QuestionRewardPoolEscrowTypes.sol";

library QuestionRewardPoolEscrowEligibilityLib {
    function isValidPolicy(uint8 bountyEligibility) internal pure returns (bool) {
        uint8 unsupportedBits =
            bountyEligibility & ~(BOUNTY_ELIGIBILITY_CREDENTIAL_MASK | BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG);
        if (unsupportedBits != 0) return false;

        uint8 credentialMask = _credentialMask(bountyEligibility);
        if (credentialMask == BOUNTY_ELIGIBILITY_OPEN) return bountyEligibility == BOUNTY_ELIGIBILITY_OPEN;
        return true;
    }

    function isAccountEligibleForBounty(ProtocolConfig protocolConfig, uint8 bountyEligibility, address account)
        internal
        view
        returns (bool)
    {
        if (bountyEligibility == BOUNTY_ELIGIBILITY_OPEN) return true;
        if (!isValidPolicy(bountyEligibility)) return false;
        if (account == address(0)) return false;

        uint8 requiredMask = _credentialMask(bountyEligibility);
        (uint8 activeMask, uint8 freshMask) = _credentialStatusBits(protocolConfig, account);
        if ((activeMask & requiredMask) == 0) return false;
        if ((bountyEligibility & BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG) != 0) {
            return (activeMask & freshMask & requiredMask) != 0;
        }
        return true;
    }

    function isCommitEligibleForBounty(uint8 bountyEligibility, uint8 credentialMask, uint8 freshCredentialMask)
        internal
        pure
        returns (bool)
    {
        if (bountyEligibility == BOUNTY_ELIGIBILITY_OPEN) return true;
        if (!isValidPolicy(bountyEligibility)) return false;
        uint8 requiredMask = _credentialMask(bountyEligibility);
        if ((credentialMask & requiredMask) == 0) return false;
        if ((bountyEligibility & BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG) != 0) {
            return (credentialMask & freshCredentialMask & requiredMask) != 0;
        }
        return true;
    }

    function eligibilityDataHash() internal pure returns (bytes32) {
        return bytes32(0);
    }

    function _credentialMask(uint8 bountyEligibility) private pure returns (uint8) {
        return bountyEligibility & BOUNTY_ELIGIBILITY_CREDENTIAL_MASK;
    }

    function _credentialStatusBits(ProtocolConfig protocolConfig, address account)
        private
        view
        returns (uint8 activeMask, uint8 freshMask)
    {
        if (address(protocolConfig) == address(0)) return (0, 0);
        address raterRegistry = protocolConfig.raterRegistry();
        if (raterRegistry == address(0)) return (0, 0);

        try IRaterRegistryStatus(raterRegistry).credentialStatusBits(account) returns (uint8 active, uint8 fresh) {
            return (active, fresh);
        } catch {
            return (0, 0);
        }
    }
}
