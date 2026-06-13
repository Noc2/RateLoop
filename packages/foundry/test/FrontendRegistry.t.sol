// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test, console } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { FrontendRegistry } from "../contracts/FrontendRegistry.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { IFrontendRegistry } from "../contracts/interfaces/IFrontendRegistry.sol";
import { IRoundVotingEngine } from "../contracts/interfaces/IRoundVotingEngine.sol";
import { RatingLib } from "../contracts/libraries/RatingLib.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";

/// @title Mock RoundVotingEngine for testing FrontendRegistry
contract MockVotingEngine is IRoundVotingEngine {
    LoopReputation public immutable lrepToken;
    address public immutable protocolConfig;

    constructor(LoopReputation lrepToken_, address protocolConfig_) {
        lrepToken = lrepToken_;
        protocolConfig = protocolConfig_;
    }

    function hasCommits(uint256) external pure override returns (bool) {
        return false;
    }

    function currentRoundId(uint256) external pure override returns (uint256) {
        return 0;
    }

    function isDormancyBlocked(uint256) external pure override returns (bool) {
        return false;
    }

    function roundCore(uint256, uint256)
        external
        pure
        override
        returns (uint48, RoundLib.RoundState, uint16, uint16, uint64, uint48, uint48, uint8)
    {
        return (0, RoundLib.RoundState.Open, 0, 0, 0, 0, 0, 0);
    }

    function roundRatingConfigPacked(uint256, uint256) external pure override returns (uint256, uint256) {
        return (0, 0);
    }

    function ratingCommitStateCompact(uint256, uint256, bytes32)
        external
        pure
        override
        returns (uint256, bytes32, address)
    {
        return (0, bytes32(0), address(0));
    }

    function roundLifecycleState(uint256, uint256) external pure override returns (uint256, uint256, uint256, uint48) {
        return (0, 0, 0, 0);
    }

    function transferReward(address, uint256) external override { }
}

contract MockRewardDistributor {
    bytes32 public constant RATELOOP_REWARD_DISTRIBUTOR_MARKER = keccak256("rateloop.round-reward-distributor.v1");
    address public immutable votingEngine;

    constructor(address votingEngine_) {
        votingEngine = votingEngine_;
    }
}

contract MockUnmarkedRewardDistributor {
    address public immutable votingEngine;

    constructor(address votingEngine_) {
        votingEngine = votingEngine_;
    }
}

contract MockFeeCreditorProtocolConfig {
    mapping(address => mapping(address => bool)) public rewardDistributorForEngine;

    function setRewardDistributorForEngine(address distributor, address engine, bool authorized) external {
        rewardDistributorForEngine[distributor][engine] = authorized;
    }

    function isRewardDistributorForEngine(address distributor, address engine) external view returns (bool) {
        return rewardDistributorForEngine[distributor][engine];
    }
}

contract FrontendRegistryHarness is FrontendRegistry {
    function forceSetFees(address frontend, uint128 amount) external {
        frontends[frontend].lrepFees = amount;
    }
}

/// @title FrontendRegistry Test Suite
contract FrontendRegistryTest is Test {
    FrontendRegistry public registry;
    LoopReputation public lrepToken;
    MockVotingEngine public votingEngine;
    MockRewardDistributor public rewardDistributor;
    MockFeeCreditorProtocolConfig public protocolConfig;

    address public admin = address(1);
    address public frontend1 = address(3);
    address public frontend2 = address(4);
    address public frontend3 = address(6);
    address public feeCreditor;

    uint256 public constant STAKE = 1000e6; // Fixed 1,000 LREP

    function setUp() public {
        vm.startPrank(admin);

        // Deploy LREP token
        lrepToken = new LoopReputation(admin, admin);

        // Grant minter role to admin
        lrepToken.grantRole(lrepToken.MINTER_ROLE(), admin);

        // Deploy mock voting engine
        protocolConfig = new MockFeeCreditorProtocolConfig();
        votingEngine = new MockVotingEngine(lrepToken, address(protocolConfig));
        rewardDistributor = new MockRewardDistributor(address(votingEngine));
        feeCreditor = address(rewardDistributor);
        protocolConfig.setRewardDistributorForEngine(feeCreditor, address(votingEngine), true);

        // Deploy registry behind an ERC1967 proxy for upgradeable storage behavior
        FrontendRegistry impl = new FrontendRegistry();
        registry = FrontendRegistry(
            address(
                new ERC1967Proxy(
                    address(impl), abi.encodeCall(FrontendRegistry.initialize, (admin, admin, address(lrepToken)))
                )
            )
        );

        // Set voting engine for slashing
        registry.setVotingEngine(address(votingEngine));

        // Grant fee creditor role
        registry.addFeeCreditor(feeCreditor);

        // Mint LREP tokens for frontends (not transfer, to avoid governance lock checks)
        lrepToken.mint(frontend1, 10_000e6);
        lrepToken.mint(frontend2, 10_000e6);
        lrepToken.mint(frontend3, 10_000e6);

        // Mint LREP for fee crediting (to registry)
        lrepToken.mint(address(registry), 1_000_000e6);

        vm.stopPrank();

        // Advance blocks to activate voting power
        vm.roll(block.number + 5);
    }

    // --- Initialization Tests ---

    function test_Initialization() public view {
        assertEq(address(registry.lrepToken()), address(lrepToken));
        assertEq(registry.STAKE_AMOUNT(), 1000e6);
    }

    // --- Registration Tests ---

    function test_Register() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        (address operator, uint256 stakedAmount, bool eligible, bool slashed) = registry.getFrontendInfo(frontend1);
        assertEq(operator, frontend1);
        assertEq(stakedAmount, STAKE);
        assertTrue(eligible);
        assertFalse(slashed);

        (address[] memory frontends, uint256 total) = registry.getRegisteredFrontendsPaginated(0, 10);
        assertEq(total, 1);
        assertEq(frontends.length, 1);
        assertEq(frontends[0], frontend1);
    }

    function test_RevertRegisterAlreadyRegistered() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE * 2);
        registry.register();

        vm.expectRevert("Already registered");
        registry.register();
        vm.stopPrank();
    }

    // --- Deregister Tests ---

    function test_Deregister() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.prank(frontend1);
        registry.requestDeregister();

        uint256 availableAt = registry.frontendExitAvailableAt(frontend1);
        assertEq(availableAt, block.timestamp + registry.UNBONDING_PERIOD());

        uint256 balanceBefore = lrepToken.balanceOf(frontend1);
        _completeDeregister(frontend1);

        uint256 balanceAfter = lrepToken.balanceOf(frontend1);
        assertEq(balanceAfter - balanceBefore, STAKE);

        (address operator, uint256 stakedAmount, bool eligible,) = registry.getFrontendInfo(frontend1);
        assertEq(operator, address(0));
        assertEq(stakedAmount, 0);
        assertFalse(eligible);
    }

    function test_RevertDeregisterNotRegistered() public {
        vm.prank(frontend1);
        vm.expectRevert("Not registered");
        registry.requestDeregister();
    }

    function test_RevertDeregisterSlashed() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.prank(admin);
        registry.slashFrontend(frontend1, 500e6, "Test slash");

        vm.prank(frontend1);
        vm.expectRevert("Frontend is slashed");
        registry.requestDeregister();
    }

    function test_DeregisterWithPendingFees() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        // Credit some fees
        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 200e6);

        vm.prank(frontend1);
        registry.requestDeregister();
        uint256 feeReviewAvailableAt = block.timestamp + registry.FEE_WITHDRAWAL_DELAY();

        uint256 balanceBefore = lrepToken.balanceOf(frontend1);
        vm.warp(block.timestamp + registry.UNBONDING_PERIOD() + 1);
        vm.prank(frontend1);
        vm.expectRevert("Fee withdrawal delay active");
        registry.completeDeregister();

        vm.warp(feeReviewAvailableAt);
        vm.prank(frontend1);
        registry.completeDeregister();

        // Should receive stake + pending fees
        uint256 balanceAfter = lrepToken.balanceOf(frontend1);
        assertEq(balanceAfter - balanceBefore, STAKE + 200e6);

        // Fees should be zeroed
        assertEq(registry.getAccumulatedFees(frontend1), 0);
    }

    function test_CanClaimFeesForRoundRejectsSameTimestampReregistration() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        registry.requestDeregister();
        vm.stopPrank();

        _completeDeregister(frontend1);

        uint48 roundSettledAt = uint48(block.timestamp);
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        assertTrue(registry.canReceiveHistoricalFees(frontend1));
        assertFalse(registry.canClaimFeesForRound(frontend1, roundSettledAt));
    }

    function test_RevertClaimFeesWhileExitPending() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 100e6);

        vm.prank(frontend1);
        registry.requestDeregister();

        vm.prank(frontend1);
        vm.expectRevert(IFrontendRegistry.FrontendExitPending.selector);
        registry.requestFeeWithdrawal();

        assertEq(registry.getAccumulatedFees(frontend1), 100e6);
    }

    function test_ReregisterAfterDeregister() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        registry.requestDeregister();
        vm.stopPrank();

        _completeDeregister(frontend1);

        // Should be able to register again
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        (address operator, uint256 stakedAmount,,) = registry.getFrontendInfo(frontend1);
        assertEq(operator, frontend1);
        assertEq(stakedAmount, STAKE);
    }

    function test_RegisteredFrontendsPagination_RemovesExitedEntriesAndAvoidsDuplicates() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.startPrank(frontend2);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.startPrank(frontend3);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.prank(frontend1);
        registry.requestDeregister();
        _completeDeregister(frontend1);

        (address[] memory frontendsAfterFirstExit, uint256 totalAfterFirstExit) =
            registry.getRegisteredFrontendsPaginated(0, 10);
        assertEq(totalAfterFirstExit, 2);
        assertEq(frontendsAfterFirstExit.length, 2);
        assertFalse(_contains(frontendsAfterFirstExit, frontend1));
        assertTrue(_contains(frontendsAfterFirstExit, frontend2));
        assertTrue(_contains(frontendsAfterFirstExit, frontend3));

        vm.prank(frontend3);
        registry.requestDeregister();
        _completeDeregister(frontend3);

        (address[] memory frontendsAfterSecondExit, uint256 totalAfterSecondExit) =
            registry.getRegisteredFrontendsPaginated(0, 10);
        assertEq(totalAfterSecondExit, 1);
        assertEq(frontendsAfterSecondExit.length, 1);
        assertEq(frontendsAfterSecondExit[0], frontend2);

        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        (address[] memory frontendsAfterReregister, uint256 totalAfterReregister) =
            registry.getRegisteredFrontendsPaginated(0, 10);
        assertEq(totalAfterReregister, 2);
        assertEq(frontendsAfterReregister.length, 2);
        assertEq(_count(frontendsAfterReregister, frontend1), 1);
        assertEq(_count(frontendsAfterReregister, frontend2), 1);
        assertFalse(_contains(frontendsAfterReregister, frontend3));
    }

    function test_DeregisterAfterUnslash() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.startPrank(admin);
        registry.slashFrontend(frontend1, 500e6, "Test");
        registry.unslashFrontend(frontend1);
        vm.stopPrank();

        vm.prank(frontend1);
        registry.requestDeregister();

        uint256 balanceBefore = lrepToken.balanceOf(frontend1);
        _completeDeregister(frontend1);

        // Should return remaining 500e6 (half was slashed)
        uint256 balanceAfter = lrepToken.balanceOf(frontend1);
        assertEq(balanceAfter - balanceBefore, 500e6);
    }

    // --- Eligibility Tests ---

    function test_RegisterFrontendBecomesEligible() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        assertTrue(registry.isEligible(frontend1));

        (,, bool eligible,) = registry.getFrontendInfo(frontend1);
        assertTrue(eligible);
    }

    function test_UnregisteredFrontendIsNotEligible() public view {
        assertFalse(registry.isEligible(frontend1));
    }

    function test_SlashedFrontendIsNotEligible() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.prank(admin);
        registry.slashFrontend(frontend1, STAKE / 2, "Test");

        assertFalse(registry.isEligible(frontend1));
    }

    function test_ExitPendingFrontendIsNotEligible() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        registry.requestDeregister();
        vm.stopPrank();

        assertFalse(registry.isEligible(frontend1));
    }

    function test_RegisteredFrontendRemainsEligibleWithoutIdentityGate() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        assertTrue(registry.isEligible(frontend1));
        (,, bool eligible,) = registry.getFrontendInfo(frontend1);
        assertTrue(eligible);
    }

    function test_UnderbondedFrontendIsNotEligibleAfterUnslash() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.startPrank(admin);
        registry.slashFrontend(frontend1, STAKE / 2, "Test");
        registry.unslashFrontend(frontend1);
        vm.stopPrank();

        assertFalse(registry.isEligible(frontend1));
    }

    function test_SetSnapshotProposerDirectlyAuthorizesKeeperAddress() public {
        address keeper = address(0xBEEF);

        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        registry.setSnapshotProposer(keeper);
        vm.stopPrank();

        assertEq(registry.snapshotProposerForFrontend(frontend1), keeper);
        assertEq(registry.frontendForSnapshotProposer(keeper), frontend1);
        assertEq(registry.authorizedSnapshotFrontend(keeper), frontend1);
        assertTrue(registry.isAuthorizedSnapshotProposer(frontend1, keeper));
        assertEq(registry.authorizedSnapshotFrontend(frontend1), frontend1);
        assertTrue(registry.isAuthorizedSnapshotProposer(frontend1, frontend1));

        vm.prank(frontend1);
        registry.setSnapshotProposer(keeper);
        assertEq(registry.snapshotProposerForFrontend(frontend1), keeper);
    }

    function test_SetSnapshotProposerRotatesAndClearsPreviousKeeper() public {
        address keeper1 = address(0xBEEF);
        address keeper2 = address(0xCAFE);

        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.startPrank(frontend1);
        registry.setSnapshotProposer(keeper1);
        registry.setSnapshotProposer(keeper2);
        vm.stopPrank();

        assertEq(registry.snapshotProposerForFrontend(frontend1), keeper2);
        assertEq(registry.frontendForSnapshotProposer(keeper1), address(0));
        assertEq(registry.frontendForSnapshotProposer(keeper2), frontend1);
        assertEq(registry.authorizedSnapshotFrontend(keeper1), address(0));
        assertEq(registry.authorizedSnapshotFrontend(keeper2), frontend1);

        vm.prank(frontend1);
        registry.clearSnapshotProposer();

        assertEq(registry.snapshotProposerForFrontend(frontend1), address(0));
        assertEq(registry.frontendForSnapshotProposer(keeper2), address(0));
        assertEq(registry.authorizedSnapshotFrontend(keeper2), address(0));
    }

    function test_SetSnapshotProposerRejectsProposerAlreadyAssignedToAnotherFrontend() public {
        address keeper = address(0xBEEF);

        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        registry.setSnapshotProposer(keeper);
        vm.stopPrank();

        vm.startPrank(frontend2);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.expectRevert("Proposer already assigned");
        registry.setSnapshotProposer(keeper);
        vm.stopPrank();
    }

    function test_SetSnapshotProposerRejectsRegisteredProposer() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.startPrank(frontend2);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.prank(frontend1);
        vm.expectRevert("Proposer is registered");
        registry.setSnapshotProposer(frontend2);
    }

    function test_AssignedSnapshotProposerCanRegisterAndClearInboundAssignment() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.startPrank(frontend1);
        registry.setSnapshotProposer(frontend2);
        vm.stopPrank();

        assertEq(registry.snapshotProposerForFrontend(frontend1), frontend2);
        assertEq(registry.frontendForSnapshotProposer(frontend2), frontend1);

        vm.startPrank(frontend2);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        assertEq(registry.snapshotProposerForFrontend(frontend1), address(0));
        assertEq(registry.frontendForSnapshotProposer(frontend2), address(0));
        assertEq(registry.authorizedSnapshotFrontend(frontend2), frontend2);
        assertTrue(registry.isEligible(frontend2));
    }

    function test_SnapshotProposerAuthorizationDropsWhenFrontendExitsOrIsSlashed() public {
        address keeper = address(0xBEEF);

        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.startPrank(frontend1);
        registry.setSnapshotProposer(keeper);
        registry.requestDeregister();
        vm.stopPrank();

        assertEq(registry.snapshotProposerForFrontend(frontend1), address(0));
        assertEq(registry.authorizedSnapshotFrontend(keeper), address(0));

        vm.startPrank(frontend2);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.startPrank(frontend2);
        registry.setSnapshotProposer(keeper);
        vm.stopPrank();

        vm.prank(admin);
        registry.slashFrontend(frontend2, STAKE / 2, "Test");

        assertEq(registry.snapshotProposerForFrontend(frontend2), address(0));
        assertEq(registry.authorizedSnapshotFrontend(keeper), address(0));
    }

    // --- Slash Tests ---

    function test_SlashFrontend() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        uint256 slashAmount = STAKE / 2;
        uint256 confiscationRecipientBefore = lrepToken.balanceOf(admin);

        vm.prank(admin);
        registry.slashFrontend(frontend1, slashAmount, "Malicious behavior");

        (, uint256 stakedAmount, bool eligible, bool slashed) = registry.getFrontendInfo(frontend1);
        assertEq(stakedAmount, STAKE - slashAmount);
        assertFalse(eligible);
        assertTrue(slashed);

        assertEq(lrepToken.balanceOf(admin), confiscationRecipientBefore + slashAmount);
    }

    function test_SlashFrontendWithBounty_SplitsConfiscation() public {
        address challenger = address(77);

        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        // Build up both fee buckets: 100 LREP pending withdrawal, 50 LREP accrued.
        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 100e6);
        vm.prank(frontend1);
        registry.requestFeeWithdrawal();
        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 50e6);

        uint256 slashAmount = STAKE;
        uint256 totalConfiscated = slashAmount + 150e6;
        uint256 expectedBounty = (totalConfiscated * registry.CHALLENGER_BOUNTY_BPS()) / 10_000;

        uint256 recipientBefore = lrepToken.balanceOf(admin);
        uint256 challengerBefore = lrepToken.balanceOf(challenger);

        vm.expectEmit(true, true, false, true, address(registry));
        emit FrontendRegistry.ChallengerBountyPaid(frontend1, challenger, expectedBounty);
        vm.prank(admin);
        registry.slashFrontendWithBounty(frontend1, slashAmount, "Rejected payout root", challenger);

        assertEq(lrepToken.balanceOf(challenger) - challengerBefore, expectedBounty);
        assertEq(lrepToken.balanceOf(admin) - recipientBefore, totalConfiscated - expectedBounty);
        assertEq(registry.getAccumulatedFees(frontend1), 0);
        assertEq(registry.pendingFeeWithdrawalAmount(frontend1), 0);

        (,,, bool slashed) = registry.getFrontendInfo(frontend1);
        assertTrue(slashed);
    }

    function test_SlashFrontendWithBounty_RoundsBountyDown() public {
        address challenger = address(77);

        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        // Odd confiscation total: bounty rounds down, dust stays with the confiscation recipient.
        uint256 slashAmount = 3;
        uint256 recipientBefore = lrepToken.balanceOf(admin);

        vm.prank(admin);
        registry.slashFrontendWithBounty(frontend1, slashAmount, "Rejected payout root", challenger);

        assertEq(lrepToken.balanceOf(challenger), 1);
        assertEq(lrepToken.balanceOf(admin) - recipientBefore, 2);
    }

    function test_RevertSlashFrontendWithBountyInvalidRecipient() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.startPrank(admin);
        vm.expectRevert("Invalid bounty recipient");
        registry.slashFrontendWithBounty(frontend1, STAKE / 2, "Test", address(0));

        vm.expectRevert("Bounty recipient is frontend");
        registry.slashFrontendWithBounty(frontend1, STAKE / 2, "Test", frontend1);
        vm.stopPrank();
    }

    function test_RevertSlashFrontendWithBountyRecipientIsProposer() public {
        address proposer = address(88);

        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        registry.setSnapshotProposer(proposer);
        vm.stopPrank();

        vm.prank(admin);
        vm.expectRevert("Bounty recipient is proposer");
        registry.slashFrontendWithBounty(frontend1, STAKE / 2, "Test", proposer);
    }

    function test_RevertSlashFrontendWithBountyNonGovernance() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.prank(frontend2);
        vm.expectRevert();
        registry.slashFrontendWithBounty(frontend1, STAKE / 2, "Test", address(77));
    }

    function test_UnslashFrontend() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.startPrank(admin);
        registry.slashFrontend(frontend1, STAKE / 2, "Test");

        (,,, bool slashed) = registry.getFrontendInfo(frontend1);
        assertTrue(slashed);

        registry.unslashFrontend(frontend1);

        (,,, slashed) = registry.getFrontendInfo(frontend1);
        assertFalse(slashed);
        assertFalse(registry.isEligible(frontend1));
        vm.stopPrank();
    }

    function test_RevertUnslashFrontendNotSlashed() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.prank(admin);
        vm.expectRevert("Frontend not slashed");
        registry.unslashFrontend(frontend1);
    }

    // --- Fee Crediting Tests ---

    function test_CreditFees() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 100e6);

        uint256 lrepFees = registry.getAccumulatedFees(frontend1);
        assertEq(lrepFees, 100e6);
    }

    function test_CreditFeesAccumulates() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.startPrank(feeCreditor);
        registry.creditFees(frontend1, 100e6);
        registry.creditFees(frontend1, 100e6);
        vm.stopPrank();

        uint256 lrepFees = registry.getAccumulatedFees(frontend1);
        assertEq(lrepFees, 200e6);
    }

    function test_CreditFeesAccumulatesAboveLegacyUint64Limit() public {
        FrontendRegistryHarness impl = new FrontendRegistryHarness();
        FrontendRegistryHarness largeFeeRegistry = FrontendRegistryHarness(
            address(
                new ERC1967Proxy(
                    address(impl), abi.encodeCall(FrontendRegistry.initialize, (admin, admin, address(lrepToken)))
                )
            )
        );

        vm.startPrank(admin);
        largeFeeRegistry.setVotingEngine(address(votingEngine));
        largeFeeRegistry.addFeeCreditor(feeCreditor);
        vm.stopPrank();

        vm.startPrank(frontend1);
        lrepToken.approve(address(largeFeeRegistry), STAKE);
        largeFeeRegistry.register();
        vm.stopPrank();

        largeFeeRegistry.forceSetFees(frontend1, type(uint64).max);

        vm.prank(feeCreditor);
        largeFeeRegistry.creditFees(frontend1, 1);

        assertEq(largeFeeRegistry.getAccumulatedFees(frontend1), uint256(type(uint64).max) + 1);
    }

    function test_CreditFeesRevertsForUnregisteredFrontend() public {
        // L-02: Should revert for unregistered frontend to prevent silent token loss
        vm.prank(feeCreditor);
        vm.expectRevert("Frontend not registered");
        registry.creditFees(frontend1, 100e6);
    }

    function test_CreditFeesAfterRegistrationWithoutIdentityGate() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 100e6);

        assertEq(registry.getAccumulatedFees(frontend1), 100e6);
    }

    function test_RevertCreditFeesNonCreditor() public {
        vm.prank(frontend1);
        vm.expectRevert();
        registry.creditFees(frontend1, 100e6);
    }

    // --- Fee Withdrawal Tests ---

    function test_FeeWithdrawalDelayCoversGovernanceReviewSlack() public view {
        assertEq(registry.FEE_WITHDRAWAL_DELAY(), 21 days);
    }

    function test_FeeWithdrawalTwoStep() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 100e6);

        uint256 lrepBefore = lrepToken.balanceOf(frontend1);

        vm.prank(frontend1);
        registry.requestFeeWithdrawal();

        // Fees move to the pending bucket immediately, but nothing leaves the registry.
        assertEq(registry.getAccumulatedFees(frontend1), 0);
        assertEq(registry.pendingFeeWithdrawalAmount(frontend1), 100e6);
        assertEq(registry.pendingFeeWithdrawalReleaseAt(frontend1), block.timestamp + registry.FEE_WITHDRAWAL_DELAY());
        assertEq(lrepToken.balanceOf(frontend1), lrepBefore);

        vm.warp(block.timestamp + registry.FEE_WITHDRAWAL_DELAY());

        vm.prank(frontend1);
        registry.completeFeeWithdrawal();

        assertEq(lrepToken.balanceOf(frontend1) - lrepBefore, 100e6);
        assertEq(registry.pendingFeeWithdrawalAmount(frontend1), 0);
        assertEq(registry.pendingFeeWithdrawalReleaseAt(frontend1), 0);
    }

    function test_RevertCompleteFeeWithdrawalBeforeDelay() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 100e6);

        vm.prank(frontend1);
        registry.requestFeeWithdrawal();

        vm.warp(block.timestamp + registry.FEE_WITHDRAWAL_DELAY() - 1);

        vm.prank(frontend1);
        vm.expectRevert("Withdrawal delay active");
        registry.completeFeeWithdrawal();
    }

    function test_RevertRequestFeeWithdrawalWhilePending() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 100e6);

        vm.prank(frontend1);
        registry.requestFeeWithdrawal();

        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 50e6);

        vm.prank(frontend1);
        vm.expectRevert("Withdrawal already pending");
        registry.requestFeeWithdrawal();
    }

    function test_SlashConfiscatesPendingFeeWithdrawal() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 100e6);

        vm.prank(frontend1);
        registry.requestFeeWithdrawal();

        vm.warp(block.timestamp + registry.FEE_WITHDRAWAL_DELAY());

        uint256 recipientBefore = lrepToken.balanceOf(admin);
        vm.prank(admin);
        registry.slashFrontend(frontend1, STAKE / 2, "Test");

        // Slash sweeps the matured-but-uncompleted pending bucket along with the stake cut.
        assertEq(lrepToken.balanceOf(admin) - recipientBefore, STAKE / 2 + 100e6);
        assertEq(registry.pendingFeeWithdrawalAmount(frontend1), 0);
        assertEq(registry.pendingFeeWithdrawalReleaseAt(frontend1), 0);

        vm.prank(frontend1);
        vm.expectRevert("Frontend is slashed");
        registry.completeFeeWithdrawal();
    }

    function test_DeregisterSweepsPendingFeeWithdrawal() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 100e6);

        vm.prank(frontend1);
        registry.requestFeeWithdrawal();

        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 50e6);

        vm.prank(frontend1);
        registry.requestDeregister();
        uint256 feeReviewAvailableAt = registry.pendingFeeWithdrawalReleaseAt(frontend1);

        // Completion is blocked mid-exit and before fee review matures.
        vm.warp(block.timestamp + registry.UNBONDING_PERIOD() + 1);
        vm.prank(frontend1);
        vm.expectRevert("Fee withdrawal delay active");
        registry.completeDeregister();

        vm.warp(feeReviewAvailableAt);
        vm.prank(frontend1);
        vm.expectRevert(IFrontendRegistry.FrontendExitPending.selector);
        registry.completeFeeWithdrawal();

        uint256 balanceBefore = lrepToken.balanceOf(frontend1);
        vm.prank(frontend1);
        registry.completeDeregister();

        assertEq(lrepToken.balanceOf(frontend1) - balanceBefore, STAKE + 150e6);
        assertEq(registry.pendingFeeWithdrawalAmount(frontend1), 0);
        assertEq(registry.pendingFeeWithdrawalReleaseAt(frontend1), 0);
    }

    function test_RevertRequestFeeWithdrawalWhileSlashed() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 100e6);

        vm.prank(admin);
        registry.slashFrontend(frontend1, STAKE / 2, "Test");

        vm.prank(frontend1);
        vm.expectRevert("Frontend is slashed");
        registry.requestFeeWithdrawal();
    }

    function test_RevertRequestFeeWithdrawalWhileUnderbonded() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 100e6);

        vm.startPrank(admin);
        registry.slashFrontend(frontend1, STAKE / 2, "Test");
        registry.unslashFrontend(frontend1);
        vm.stopPrank();

        vm.prank(frontend1);
        vm.expectRevert("Frontend is underbonded");
        registry.requestFeeWithdrawal();
    }

    function test_RevertRequestFeeWithdrawalNotRegistered() public {
        vm.prank(frontend1);
        vm.expectRevert("Not registered");
        registry.requestFeeWithdrawal();
    }

    function test_RevertRequestFeeWithdrawalNoFees() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();

        vm.expectRevert("No fees to claim");
        registry.requestFeeWithdrawal();
        vm.stopPrank();
    }

    function test_RevertCompleteFeeWithdrawalNothingPending() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();

        vm.expectRevert("No pending withdrawal");
        registry.completeFeeWithdrawal();
        vm.stopPrank();
    }

    function test_DeregisterPaysPendingFeesWithoutIdentityGate() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 200e6);

        vm.prank(frontend1);
        registry.requestDeregister();
        uint256 feeReviewAvailableAt = block.timestamp + registry.FEE_WITHDRAWAL_DELAY();

        uint256 balanceBefore = lrepToken.balanceOf(frontend1);
        vm.warp(feeReviewAvailableAt);
        vm.prank(frontend1);
        registry.completeDeregister();

        assertEq(lrepToken.balanceOf(frontend1) - balanceBefore, STAKE + 200e6);
        assertEq(registry.getAccumulatedFees(frontend1), 0);
    }

    // --- Eligibility Tests ---

    function test_TopUpStakeRestoresFullBond() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE + 500e6);
        registry.register();
        vm.stopPrank();

        vm.startPrank(admin);
        registry.slashFrontend(frontend1, 500e6, "Test");
        registry.unslashFrontend(frontend1);
        vm.stopPrank();

        vm.startPrank(frontend1);
        registry.topUpStake(500e6);
        vm.stopPrank();

        (, uint256 stakedAmount,, bool slashed) = registry.getFrontendInfo(frontend1);
        assertEq(stakedAmount, STAKE);
        assertFalse(slashed);
        assertTrue(registry.isEligible(frontend1));
    }

    function test_SlashFrontendConfiscatesAccruedFees() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 200e6);

        uint256 confiscationRecipientBefore = lrepToken.balanceOf(admin);

        vm.prank(admin);
        registry.slashFrontend(frontend1, 100e6, "Malicious behavior");

        assertEq(registry.getAccumulatedFees(frontend1), 0);
        assertEq(lrepToken.balanceOf(admin), confiscationRecipientBefore + 300e6);
    }

    function test_SlashFrontendConfiscatesAccruedFeesWhileExitPending() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        // Fees must be credited before the deregister request — creditFees rejects
        // exit-pending frontends (audit L-2 defense-in-depth).
        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 200e6);

        vm.prank(frontend1);
        registry.requestDeregister();

        uint256 confiscationRecipientBefore = lrepToken.balanceOf(admin);

        vm.prank(admin);
        registry.slashFrontend(frontend1, 100e6, "Malicious behavior");

        assertEq(registry.getAccumulatedFees(frontend1), 0);
        assertEq(lrepToken.balanceOf(admin), confiscationRecipientBefore + 300e6);
    }

    // --- Admin Functions Tests ---

    function test_SetVotingEngine() public {
        address newVotingEngine = address(new MockVotingEngine(lrepToken, address(protocolConfig)));

        vm.prank(admin);
        registry.removeFeeCreditor(feeCreditor);

        vm.prank(admin);
        vm.expectEmit(true, true, true, true);
        emit FrontendRegistry.VotingEngineUpdated(newVotingEngine);
        registry.setVotingEngine(newVotingEngine);

        assertEq(address(registry.votingEngine()), newVotingEngine);
    }

    function test_SetVotingEngine_PreservesHistoricalFeeCreditor() public {
        address newVotingEngine = address(new MockVotingEngine(lrepToken, address(protocolConfig)));

        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.prank(admin);
        registry.setVotingEngine(newVotingEngine);

        assertEq(address(registry.votingEngine()), newVotingEngine);
        assertEq(registry.feeCreditor(), address(0));
        assertTrue(registry.hasRole(registry.FEE_CREDITOR_ROLE(), feeCreditor));

        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 100e6);

        assertEq(registry.getAccumulatedFees(frontend1), 100e6);
    }

    function test_SetVotingEngine_RejectsNoCode() public {
        vm.prank(admin);
        vm.expectRevert("Invalid voting engine");
        registry.setVotingEngine(address(100));
    }

    function test_SetVotingEngine_SameEngineDoesNotClearFeeCreditor() public {
        assertEq(registry.feeCreditor(), feeCreditor);
        assertTrue(registry.hasRole(registry.FEE_CREDITOR_ROLE(), feeCreditor));

        vm.prank(admin);
        registry.setVotingEngine(address(votingEngine));

        assertEq(address(registry.votingEngine()), address(votingEngine));
        assertEq(registry.feeCreditor(), feeCreditor);
        assertTrue(registry.hasRole(registry.FEE_CREDITOR_ROLE(), feeCreditor));
    }

    function test_RevertSetVotingEngineZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert("Invalid voting engine");
        registry.setVotingEngine(address(0));
    }

    function test_SlashFrontendWithoutVotingEngine() public {
        // Deploy a fresh registry without setting voting engine.
        vm.startPrank(admin);
        FrontendRegistry impl2 = new FrontendRegistry();
        FrontendRegistry noEngineRegistry = FrontendRegistry(
            address(
                new ERC1967Proxy(
                    address(impl2), abi.encodeCall(FrontendRegistry.initialize, (admin, admin, address(lrepToken)))
                )
            )
        );
        // Do NOT call setVotingEngine

        // Mint and register a frontend
        lrepToken.mint(frontend1, 10_000e6);
        vm.stopPrank();

        vm.startPrank(frontend1);
        lrepToken.approve(address(noEngineRegistry), STAKE);
        noEngineRegistry.register();
        vm.stopPrank();

        uint256 adminBalanceBefore = lrepToken.balanceOf(admin);

        vm.prank(admin);
        noEngineRegistry.slashFrontend(frontend1, STAKE / 2, "Test");

        assertFalse(noEngineRegistry.isEligible(frontend1));
        assertEq(lrepToken.balanceOf(admin), adminBalanceBefore + STAKE / 2);
    }

    function test_AddAndRemoveFeeCreditor() public {
        address newCreditor = address(new MockRewardDistributor(address(votingEngine)));
        protocolConfig.setRewardDistributorForEngine(newCreditor, address(votingEngine), true);

        vm.startPrank(admin);
        registry.addFeeCreditor(newCreditor);
        vm.stopPrank();

        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        // New creditor can credit fees.
        vm.prank(newCreditor);
        registry.creditFees(frontend1, 100e6);

        // Prior fee creditor lost authorization on rotation (addFeeCreditor revokes previous).
        vm.prank(feeCreditor);
        vm.expectRevert();
        registry.creditFees(frontend1, 25e6);

        uint256 lrepFees = registry.getAccumulatedFees(frontend1);
        assertEq(lrepFees, 100e6);

        // Removing the new creditor revokes its authorization too.
        vm.prank(admin);
        registry.removeFeeCreditor(newCreditor);

        vm.prank(newCreditor);
        vm.expectRevert();
        registry.creditFees(frontend1, 100e6);
    }

    function test_AddFeeCreditor_RejectsEOA() public {
        vm.prank(admin);
        vm.expectRevert("Invalid fee creditor");
        registry.addFeeCreditor(address(100));
    }

    function test_AddFeeCreditor_RejectsUnmarkedDistributor() public {
        address unmarkedCreditor = address(new MockUnmarkedRewardDistributor(address(votingEngine)));

        vm.prank(admin);
        vm.expectRevert("Invalid fee creditor");
        registry.addFeeCreditor(unmarkedCreditor);
    }

    function test_AddFeeCreditor_RejectsUnconfiguredDistributor() public {
        address unconfiguredCreditor = address(new MockRewardDistributor(address(votingEngine)));

        vm.prank(admin);
        vm.expectRevert("Invalid fee creditor");
        registry.addFeeCreditor(unconfiguredCreditor);
    }

    function _completeDeregister(address frontend) internal {
        vm.warp(block.timestamp + registry.UNBONDING_PERIOD() + 1);
        vm.prank(frontend);
        registry.completeDeregister();
    }

    function _contains(address[] memory frontends, address frontend) internal pure returns (bool) {
        return _count(frontends, frontend) > 0;
    }

    function _count(address[] memory frontends, address frontend) internal pure returns (uint256 matches) {
        for (uint256 i = 0; i < frontends.length; i++) {
            if (frontends[i] == frontend) {
                matches++;
            }
        }
    }
}
