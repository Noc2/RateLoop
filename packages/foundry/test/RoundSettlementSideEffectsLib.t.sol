// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { RoundSettlementSideEffectsLib } from "../contracts/libraries/RoundSettlementSideEffectsLib.sol";

contract RevertingPendingRatingRegistry {
    function recordPendingRatingSettlement(
        uint256,
        uint256,
        uint16,
        uint64,
        uint64
    )
        external
        pure
    {
        revert("rating side effect blocked");
    }
}

contract RoundSettlementSideEffectsLibTest is Test {
    function test_EmitsFailureWhenRegistryReverts() public {
        RevertingPendingRatingRegistry revertingRegistry = new RevertingPendingRatingRegistry();

        vm.expectEmit(true, true, true, true);
        emit RoundSettlementSideEffectsLib.SettlementSideEffectFailed(
            42,
            7,
            address(revertingRegistry),
            RoundSettlementSideEffectsLib.SideEffectFailureStage.RatingStateUpdate
        );

        RoundSettlementSideEffectsLib.recordSettlement(
            ContentRegistry(address(revertingRegistry)), 42, 7, 5000, 2, 1
        );
    }
}
