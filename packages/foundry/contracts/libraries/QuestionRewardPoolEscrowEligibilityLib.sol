// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ProtocolConfig } from "../ProtocolConfig.sol";
import { IRaterRegistryStatus } from "../interfaces/IRaterRegistryStatus.sol";
import {
    BOUNTY_ELIGIBILITY_KIND_MASK,
    BOUNTY_ELIGIBILITY_OPEN,
    BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG,
    BOUNTY_ELIGIBILITY_SELFIE,
    BOUNTY_ELIGIBILITY_VERIFIED_HUMAN
} from "./QuestionRewardPoolEscrowTypes.sol";

library QuestionRewardPoolEscrowEligibilityLib {
    function isValidPolicy(uint8 bountyEligibility) internal pure returns (bool) {
        uint8 kind = bountyEligibility & BOUNTY_ELIGIBILITY_KIND_MASK;
        return kind == BOUNTY_ELIGIBILITY_OPEN
            || (kind >= BOUNTY_ELIGIBILITY_SELFIE && kind <= BOUNTY_ELIGIBILITY_VERIFIED_HUMAN);
    }

    function isAccountEligibleForBounty(ProtocolConfig protocolConfig, uint8 bountyEligibility, address account)
        internal
        view
        returns (bool)
    {
        if (bountyEligibility == BOUNTY_ELIGIBILITY_OPEN) return true;
        if (account == address(0)) return false;

        uint8 kind = bountyEligibility & BOUNTY_ELIGIBILITY_KIND_MASK;
        if (kind == BOUNTY_ELIGIBILITY_OPEN) return true;
        if (!_hasActiveCredentialKind(protocolConfig, account, kind)) return false;
        if ((bountyEligibility & BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG) != 0) {
            return _hasRecentCredentialRecheck(protocolConfig, account, kind);
        }
        return true;
    }

    function isCommitEligibleForBounty(uint8 bountyEligibility, uint8 credentialMask, uint8 freshCredentialMask)
        internal
        pure
        returns (bool)
    {
        uint8 kind = bountyEligibility & BOUNTY_ELIGIBILITY_KIND_MASK;
        if (kind == BOUNTY_ELIGIBILITY_OPEN) return true;
        uint8 requiredBit = uint8(1 << kind);
        if ((credentialMask & requiredBit) == 0) return false;
        if ((bountyEligibility & BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG) != 0) {
            return (freshCredentialMask & requiredBit) != 0;
        }
        return true;
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

    function _hasActiveCredentialKind(ProtocolConfig protocolConfig, address account, uint8 kind)
        private
        view
        returns (bool)
    {
        if (kind == BOUNTY_ELIGIBILITY_VERIFIED_HUMAN) return _hasActiveHumanCredential(protocolConfig, account);
        if (address(protocolConfig) == address(0)) return false;
        address raterRegistry = protocolConfig.raterRegistry();
        if (raterRegistry == address(0)) return false;
        try IRaterRegistryStatus(raterRegistry).hasActiveCredentialKind(account, kind) returns (bool active) {
            return active;
        } catch {
            return false;
        }
    }

    function _hasRecentCredentialRecheck(ProtocolConfig protocolConfig, address account, uint8 kind)
        private
        view
        returns (bool)
    {
        if (address(protocolConfig) == address(0)) return false;
        address raterRegistry = protocolConfig.raterRegistry();
        if (raterRegistry == address(0)) return false;
        try IRaterRegistryStatus(raterRegistry).hasRecentCredentialRecheck(account, kind) returns (bool fresh) {
            return fresh;
        } catch {
            return false;
        }
    }
}
