// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { LaunchDistributionPool } from "../../contracts/LaunchDistributionPool.sol";

/// @title LaunchDistributionPoolHarness
/// @notice Exposes the policy's unverified-cap bps so Certora can prove the auxiliary
///         invariant `raterLaunchCap <= raterFullLaunchCap` (which needs bps <= 10000) in
///         the cap-conservation chain. Verification target for
///         certora/specs/LaunchDistributionPoolCap.spec (Phase 5b / Track B).
contract LaunchDistributionPoolHarness is LaunchDistributionPool {
    constructor(address lrep, address registry, address governance)
        LaunchDistributionPool(lrep, registry, governance)
    { }

    function unverifiedCapBps_() external view returns (uint256) {
        return uint256(launchRewardPolicy.unverifiedEarnedRaterCapBps);
    }

    /// @notice Exposes the internal cap-assignment so the spec can machine-check the
    ///         clamp `activeCap <= fullCap` directly at the point it is computed
    ///         (`activeCap = (fullCap * bps) / BPS_DENOMINATOR`, or `fullCap` when the
    ///         full cap is unlocked). Uses the live policy, so `unverifiedCapBps_()`
    ///         is the bps the spec constrains <= 10000. See LaunchDistributionPoolCap.spec.
    function assignLaunchCap_(address rater, uint256 fullCap) external returns (uint256 activeCap) {
        (activeCap,) = _assignLaunchCap(rater, fullCap, launchRewardPolicy);
    }
}
