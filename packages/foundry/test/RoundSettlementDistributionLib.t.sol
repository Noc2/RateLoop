// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { RoundSettlementDistributionLib } from "../contracts/libraries/RoundSettlementDistributionLib.sol";

contract RoundSettlementDistributionHarness {
    RoundLib.Round internal round;
    uint256 internal reserve;
    mapping(uint256 => mapping(uint256 => uint256)) internal roundVoterPool;
    mapping(uint256 => mapping(uint256 => uint256)) internal roundWinningStake;
    mapping(uint256 => mapping(uint256 => uint256)) internal roundStakeWithEligibleFrontend;
    mapping(uint256 => mapping(uint256 => uint256)) internal roundFrontendPool;
    mapping(uint256 => mapping(uint256 => address)) internal roundFrontendRegistrySnapshot;

    function setRoundPools(uint64 upPool, uint64 downPool) external {
        round.upPool = upPool;
        round.downPool = downPool;
    }

    function setReserve(uint256 value) external {
        reserve = value;
    }

    function distribute(uint256 weightedWinningStake, uint256 forfeitedPool, bool rawUnanimous) external {
        (reserve,) = RoundSettlementDistributionLib.distribute(
            IERC20(address(0)),
            ProtocolConfig(address(0)),
            round,
            roundVoterPool,
            roundWinningStake,
            roundStakeWithEligibleFrontend,
            roundFrontendPool,
            roundFrontendRegistrySnapshot,
            reserve,
            1,
            1,
            weightedWinningStake,
            forfeitedPool,
            rawUnanimous
        );
    }

    function consensusReserve() external view returns (uint256) {
        return reserve;
    }

    function voterPool() external view returns (uint256) {
        return roundVoterPool[1][1];
    }
}

contract RoundSettlementDistributionLibTest is Test {
    function test_ContestedZeroForfeitureDoesNotReceiveConsensusSubsidy() public {
        RoundSettlementDistributionHarness harness = new RoundSettlementDistributionHarness();
        harness.setRoundPools(10e6, 5e6);
        harness.setReserve(100e6);

        harness.distribute(15e6, 0, false);

        assertEq(harness.consensusReserve(), 100e6);
        assertEq(harness.voterPool(), 0);
    }

    function test_RawUnanimousZeroForfeitureReceivesConsensusSubsidy() public {
        RoundSettlementDistributionHarness harness = new RoundSettlementDistributionHarness();
        harness.setRoundPools(15e6, 0);
        harness.setReserve(100e6);

        harness.distribute(15e6, 0, true);

        assertEq(harness.consensusReserve(), 100e6 - 750_000);
        assertEq(harness.voterPool(), 750_000);
    }
}
