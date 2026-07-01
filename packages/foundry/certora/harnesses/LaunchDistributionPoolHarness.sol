// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { LaunchDistributionPool } from "../../contracts/LaunchDistributionPool.sol";

/// @title LaunchDistributionPoolHarness
/// @notice Exposes Certora-only views over LaunchDistributionPool internal state and
///         mirrors the private cap clamp used at assignment. Verification target for
///         certora/specs/LaunchDistributionPool*.spec.
contract LaunchDistributionPoolHarness is LaunchDistributionPool {
    constructor(address lrep, address registry, address governance)
        LaunchDistributionPool(lrep, registry, governance)
    { }

    function unverifiedCapBps_() external view returns (uint256) {
        return uint256(launchRewardPolicy.unverifiedEarnedRaterCapBps);
    }

    function verifiedBonusClaimedByAccount_(address account) external view returns (bool) {
        return verifiedBonusClaimedByAccount[account];
    }

    /// @notice Mirrors the private cap-assignment clamp so the spec can machine-check the
    ///         clamp `activeCap <= fullCap` directly at the point it is computed
    ///         (`activeCap = (fullCap * bps) / BPS_DENOMINATOR`, or `fullCap` when the
    ///         full cap is unlocked). Uses the live policy, so `unverifiedCapBps_()`
    ///         is the bps the spec constrains <= 10000. See LaunchDistributionPoolCap.spec.
    function assignLaunchCap_(address rater, uint256 fullCap) external view returns (uint256 activeCap) {
        if (raterFullLaunchCapUnlocked[rater]) return fullCap;
        return (fullCap * uint256(launchRewardPolicy.unverifiedEarnedRaterCapBps)) / BPS_DENOMINATOR;
    }
}
