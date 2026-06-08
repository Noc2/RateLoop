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
}
