// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IFrontendRegistry } from "../interfaces/IFrontendRegistry.sol";

/// @notice Linked helper for historical frontend-fee claim disposition.
library FrontendFeeLib {
    uint8 internal constant DISPOSITION_DIRECT = 0;
    uint8 internal constant DISPOSITION_CREDIT_REGISTRY = 1;
    uint8 internal constant DISPOSITION_PROTOCOL = 2;

    function resolveDisposition(address snapshotRegistryAddress, address frontend, uint48 roundSettledAt)
        external
        view
        returns (uint8 disposition, address operator, bool registryLookupFailed)
    {
        if (snapshotRegistryAddress == address(0)) {
            return (DISPOSITION_DIRECT, frontend, false);
        }

        IFrontendRegistry snapshotRegistry = IFrontendRegistry(snapshotRegistryAddress);
        try snapshotRegistry.getFrontendInfo(frontend) returns (address frontendOperator, uint256, bool, bool) {
            if (frontendOperator == address(0)) {
                return (DISPOSITION_PROTOCOL, frontend, false);
            }
            if (canClaimFeesForRound(snapshotRegistry, frontend, roundSettledAt)) {
                return (DISPOSITION_CREDIT_REGISTRY, frontendOperator, false);
            }
            return (DISPOSITION_PROTOCOL, frontendOperator, false);
        } catch {
            return (DISPOSITION_PROTOCOL, frontend, true);
        }
    }

    function canClaimFeesForRound(IFrontendRegistry snapshotRegistry, address frontend, uint48 roundSettledAt)
        internal
        view
        returns (bool)
    {
        try snapshotRegistry.canClaimFeesForRound(frontend, roundSettledAt) returns (bool canClaim) {
            return canClaim;
        } catch {
            return false;
        }
    }
}
