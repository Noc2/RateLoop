// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {
    BOUNTY_ELIGIBILITY_CREDENTIAL_MASK,
    BOUNTY_ELIGIBILITY_OPEN,
    BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG,
    BOUNTY_ELIGIBILITY_VERIFIED_HUMAN
} from "./QuestionRewardPoolEscrowTypes.sol";

library QuestionRewardPoolEscrowEligibilityLib {
    uint256 internal constant NON_REFUNDABLE_RECAPTURE_PROTECTION_THRESHOLD = 500e6;

    function isValidPolicy(uint8 bountyEligibility) internal pure returns (bool) {
        uint8 unsupportedBits =
            bountyEligibility & ~(BOUNTY_ELIGIBILITY_CREDENTIAL_MASK | BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG);
        if (unsupportedBits != 0) return false;

        uint8 credentialMask = _credentialMask(bountyEligibility);
        if (credentialMask == BOUNTY_ELIGIBILITY_OPEN) return bountyEligibility == BOUNTY_ELIGIBILITY_OPEN;
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

    function isRecaptureProtectedPolicy(uint256 amount, bool nonRefundable, uint8 bountyEligibility)
        internal
        pure
        returns (bool)
    {
        if (!nonRefundable || amount < NON_REFUNDABLE_RECAPTURE_PROTECTION_THRESHOLD) return true;
        return (_credentialMask(bountyEligibility) & BOUNTY_ELIGIBILITY_VERIFIED_HUMAN) != 0;
    }

    function eligibilityDataHash() internal pure returns (bytes32) {
        return bytes32(0);
    }

    function _credentialMask(uint8 bountyEligibility) private pure returns (uint8) {
        return bountyEligibility & BOUNTY_ELIGIBILITY_CREDENTIAL_MASK;
    }
}
