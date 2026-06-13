// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { FrontendRegistry } from "../contracts/FrontendRegistry.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { IFrontendRegistry } from "../contracts/interfaces/IFrontendRegistry.sol";
import { IRoundVotingEngine } from "../contracts/interfaces/IRoundVotingEngine.sol";
import { RatingLib } from "../contracts/libraries/RatingLib.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";

// =========================================================================
// MOCKS
// =========================================================================

contract MockVotingEngine_FR is IRoundVotingEngine {
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

contract MockRewardDistributor_FR {
    bytes32 public constant RATELOOP_REWARD_DISTRIBUTOR_MARKER = keccak256("rateloop.round-reward-distributor.v1");
    address public immutable votingEngine;

    constructor(address votingEngine_) {
        votingEngine = votingEngine_;
    }
}

contract MockFeeCreditorProtocolConfig_FR {
    mapping(address => mapping(address => bool)) public rewardDistributorForEngine;

    function setRewardDistributorForEngine(address distributor, address engine, bool authorized) external {
        rewardDistributorForEngine[distributor][engine] = authorized;
    }

    function isRewardDistributorForEngine(address distributor, address engine) external view returns (bool) {
        return rewardDistributorForEngine[distributor][engine];
    }
}

// =========================================================================
// TEST CONTRACT: FrontendRegistry Coverage Gaps
// =========================================================================

/// @title FrontendRegistryCoverageTest
/// @notice Tests for branch coverage gaps in FrontendRegistry: register/deregister edge cases,
///         creditFees boundaries, slash edge cases, access control negatives.
contract FrontendRegistryCoverageTest is Test {
    FrontendRegistry public registry;
    LoopReputation public lrepToken;
    MockVotingEngine_FR public votingEngine;
    MockRewardDistributor_FR public rewardDistributor;
    MockFeeCreditorProtocolConfig_FR public protocolConfig;

    address public admin = address(1);
    address public governance = address(10);
    address public frontend1 = address(3);
    address public frontend2 = address(4);
    address public frontend3 = address(5);
    address public feeCreditor;
    address public nonAdmin = address(7);

    uint256 public constant STAKE = 1000e6;
    uint256 public constant MAX_FEE_CREDIT = 50_000e6;

    function setUp() public {
        vm.startPrank(admin);

        lrepToken = new LoopReputation(admin, admin);
        lrepToken.grantRole(lrepToken.MINTER_ROLE(), admin);

        protocolConfig = new MockFeeCreditorProtocolConfig_FR();
        votingEngine = new MockVotingEngine_FR(lrepToken, address(protocolConfig));
        rewardDistributor = new MockRewardDistributor_FR(address(votingEngine));
        feeCreditor = address(rewardDistributor);
        protocolConfig.setRewardDistributorForEngine(feeCreditor, address(votingEngine), true);

        FrontendRegistry impl = new FrontendRegistry();
        registry = FrontendRegistry(
            address(
                new ERC1967Proxy(
                    address(impl), abi.encodeCall(FrontendRegistry.initialize, (admin, admin, address(lrepToken)))
                )
            )
        );

        registry.setVotingEngine(address(votingEngine));
        registry.addFeeCreditor(feeCreditor);

        lrepToken.mint(frontend1, 50_000e6);
        lrepToken.mint(frontend2, 50_000e6);
        lrepToken.mint(frontend3, 50_000e6);
        lrepToken.mint(address(registry), 1_000_000e6);

        vm.stopPrank();

        vm.roll(block.number + 5);
    }

    // =========================================================================
    // 1. INITIALIZE BRANCH COVERAGE
    // =========================================================================

    function test_Initialize_AdminNotEqGovernance_GrantsBothRoles() public {
        vm.startPrank(admin);
        FrontendRegistry impl2 = new FrontendRegistry();
        FrontendRegistry reg2 = FrontendRegistry(
            address(
                new ERC1967Proxy(
                    address(impl2), abi.encodeCall(FrontendRegistry.initialize, (admin, governance, address(lrepToken)))
                )
            )
        );
        vm.stopPrank();

        // Both admin and governance should have ADMIN_ROLE
        assertTrue(reg2.hasRole(reg2.ADMIN_ROLE(), admin));
        assertTrue(reg2.hasRole(reg2.ADMIN_ROLE(), governance));
        // Only governance gets GOVERNANCE_ROLE
        assertTrue(reg2.hasRole(reg2.GOVERNANCE_ROLE(), governance));
        assertFalse(reg2.hasRole(reg2.GOVERNANCE_ROLE(), admin));
    }

    function test_Initialize_ZeroAdmin_Reverts() public {
        vm.startPrank(admin);
        FrontendRegistry impl2 = new FrontendRegistry();
        vm.expectRevert("Invalid admin");
        new ERC1967Proxy(
            address(impl2), abi.encodeCall(FrontendRegistry.initialize, (address(0), admin, address(lrepToken)))
        );
        vm.stopPrank();
    }

    function test_Initialize_ZeroGovernance_Reverts() public {
        vm.startPrank(admin);
        FrontendRegistry impl2 = new FrontendRegistry();
        vm.expectRevert("Invalid governance");
        new ERC1967Proxy(
            address(impl2), abi.encodeCall(FrontendRegistry.initialize, (admin, address(0), address(lrepToken)))
        );
        vm.stopPrank();
    }

    function test_Initialize_ZeroToken_Reverts() public {
        vm.startPrank(admin);
        FrontendRegistry impl2 = new FrontendRegistry();
        vm.expectRevert("Invalid token");
        new ERC1967Proxy(address(impl2), abi.encodeCall(FrontendRegistry.initialize, (admin, admin, address(0))));
        vm.stopPrank();
    }

    // =========================================================================
    // 2. REGISTER
    // =========================================================================

    function test_Register_AllowsAnyBondedOperator() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        (address operator,,,) = registry.getFrontendInfo(frontend1);
        assertEq(operator, frontend1);
    }

    function test_Register_SucceedsWithBond() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        (address operator,,,) = registry.getFrontendInfo(frontend1);
        assertEq(operator, frontend1);
    }

    function test_Register_AllowsIndependentFrontendWallet() public {
        vm.startPrank(frontend2);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        (address operator,,,) = registry.getFrontendInfo(frontend2);
        assertEq(operator, frontend2);
    }

    function test_Register_IndependentFrontendWalletsRemainEligible() public {
        vm.startPrank(frontend2);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.startPrank(frontend3);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        assertTrue(registry.isEligible(frontend2));
        assertTrue(registry.isEligible(frontend3));
    }

    function test_Register_WithoutVotingEngine_Succeeds() public {
        vm.startPrank(admin);
        FrontendRegistry impl2 = new FrontendRegistry();
        FrontendRegistry unsetRegistry = FrontendRegistry(
            address(
                new ERC1967Proxy(
                    address(impl2), abi.encodeCall(FrontendRegistry.initialize, (admin, admin, address(lrepToken)))
                )
            )
        );
        vm.stopPrank();

        vm.startPrank(frontend1);
        lrepToken.approve(address(unsetRegistry), STAKE);
        unsetRegistry.register();
        vm.stopPrank();

        assertTrue(unsetRegistry.isEligible(frontend1));
    }

    function test_Register_InsufficientApproval_Reverts() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE - 1);
        vm.expectRevert();
        registry.register();
        vm.stopPrank();
    }

    function test_Register_InsufficientBalance_Reverts() public {
        address poorFrontend = address(99);
        // Has no LREP tokens
        vm.startPrank(poorFrontend);
        lrepToken.approve(address(registry), STAKE);
        vm.expectRevert();
        registry.register();
        vm.stopPrank();
    }

    // =========================================================================
    // 3. CREDIT FEES BRANCH COVERAGE
    // =========================================================================

    function test_CreditFees_ExactMaxAmount_Succeeds() public {
        _registerFrontend(frontend1);

        vm.prank(feeCreditor);
        registry.creditFees(frontend1, MAX_FEE_CREDIT);

        assertEq(registry.getAccumulatedFees(frontend1), MAX_FEE_CREDIT);
    }

    function test_CreditFees_MaxLaunchRoundFrontendFee_Succeeds() public {
        _registerFrontend(frontend1);

        uint256 maxLaunchRoundFrontendFee = 38_000e6;
        vm.prank(feeCreditor);
        registry.creditFees(frontend1, maxLaunchRoundFrontendFee);

        assertEq(registry.getAccumulatedFees(frontend1), maxLaunchRoundFrontendFee);
    }

    function test_CreditFees_ExceedsMax_Reverts() public {
        _registerFrontend(frontend1);

        vm.prank(feeCreditor);
        vm.expectRevert("Fee credit too large");
        registry.creditFees(frontend1, MAX_FEE_CREDIT + 1);
    }

    function test_CreditFees_ZeroAmount_Succeeds() public {
        _registerFrontend(frontend1);

        // Zero is <= MAX_FEE_CREDIT, so it should pass
        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 0);

        assertEq(registry.getAccumulatedFees(frontend1), 0);
    }

    function test_CreditFees_ToRegisteredFrontend_Succeeds() public {
        _registerFrontend(frontend1);

        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 100e6);

        assertEq(registry.getAccumulatedFees(frontend1), 100e6);
    }

    function test_CreditFees_ToSlashedFrontend_Reverts() public {
        _registerFrontend(frontend1);

        vm.prank(admin);
        registry.slashFrontend(frontend1, 100e6, "test");

        vm.prank(feeCreditor);
        vm.expectRevert("Frontend is slashed");
        registry.creditFees(frontend1, 100e6);
    }

    function test_CreditFees_ToExitPendingFrontend_Reverts() public {
        _registerFrontend(frontend1);

        vm.prank(frontend1);
        registry.requestDeregister();

        vm.prank(feeCreditor);
        vm.expectRevert(IFrontendRegistry.FrontendExitPending.selector);
        registry.creditFees(frontend1, 100e6);
    }

    // =========================================================================
    // 5. SLASH EDGE CASES
    // =========================================================================

    function test_Slash_FullStake_SetsStakeToZero() public {
        _registerFrontend(frontend1);

        vm.prank(admin);
        registry.slashFrontend(frontend1, STAKE, "full slash");

        (, uint256 stakedAmount,, bool slashed) = registry.getFrontendInfo(frontend1);
        assertEq(stakedAmount, 0);
        assertTrue(slashed);
    }

    function test_Slash_ZeroAmount_SetsSlashedFlag() public {
        _registerFrontend(frontend1);

        vm.prank(admin);
        registry.slashFrontend(frontend1, 0, "zero slash");

        (, uint256 stakedAmount,, bool slashed) = registry.getFrontendInfo(frontend1);
        assertEq(stakedAmount, STAKE); // No stake deducted
        assertTrue(slashed); // But slashed flag is set
    }

    function test_Slash_ExceedsStake_Reverts() public {
        _registerFrontend(frontend1);

        vm.prank(admin);
        vm.expectRevert("Slash exceeds stake");
        registry.slashFrontend(frontend1, STAKE + 1, "too much");
    }

    function test_Slash_NotRegistered_Reverts() public {
        vm.prank(admin);
        vm.expectRevert("Frontend not registered");
        registry.slashFrontend(frontend1, 100e6, "not registered");
    }

    function test_Slash_NonGovernance_Reverts() public {
        _registerFrontend(frontend1);

        vm.prank(nonAdmin);
        vm.expectRevert();
        registry.slashFrontend(frontend1, 100e6, "unauthorized");
    }

    function test_Slash_SetsEligibilityToFalse() public {
        _registerFrontend(frontend1);
        assertTrue(registry.isEligible(frontend1));

        vm.prank(admin);
        registry.slashFrontend(frontend1, 100e6, "slash eligible");

        assertFalse(registry.isEligible(frontend1));
    }

    // =========================================================================
    // 6. DEREGISTER WITH ZERO STAKE (post-full-slash + unslash)
    // =========================================================================

    function test_Deregister_AfterFullSlashAndUnslash_ReturnsZero() public {
        _registerFrontend(frontend1);

        vm.startPrank(admin);
        registry.slashFrontend(frontend1, STAKE, "full slash");
        registry.unslashFrontend(frontend1);
        vm.stopPrank();

        vm.prank(frontend1);
        registry.requestDeregister();
        uint256 balanceBefore = lrepToken.balanceOf(frontend1);
        _completeDeregister(frontend1);
        uint256 balanceAfter = lrepToken.balanceOf(frontend1);

        // No stake to return, no fees
        assertEq(balanceAfter - balanceBefore, 0);
    }

    function test_Deregister_ZeroRefundZeroFees_NoTransfer() public {
        // Register, slash full stake, unslash, deregister — total=0, should not transfer
        _registerFrontend(frontend1);

        vm.startPrank(admin);
        registry.slashFrontend(frontend1, STAKE, "full");
        registry.unslashFrontend(frontend1);
        vm.stopPrank();

        vm.prank(frontend1);
        registry.requestDeregister();
        _completeDeregister(frontend1); // Should not revert even with total=0

        (address operator,,,) = registry.getFrontendInfo(frontend1);
        assertEq(operator, address(0));
    }

    // =========================================================================
    // 7. UNSLASH EDGE CASES
    // =========================================================================

    function test_Unslash_NotRegistered_Reverts() public {
        vm.prank(admin);
        vm.expectRevert("Frontend not registered");
        registry.unslashFrontend(frontend1);
    }

    function test_Unslash_NonGovernance_Reverts() public {
        _registerFrontend(frontend1);

        vm.startPrank(admin);
        registry.slashFrontend(frontend1, 100e6, "test");
        vm.stopPrank();

        vm.prank(nonAdmin);
        vm.expectRevert();
        registry.unslashFrontend(frontend1);
    }

    function test_Unslash_DoesNotRestoreEligibility() public {
        _registerFrontend(frontend1);

        vm.startPrank(admin);
        registry.slashFrontend(frontend1, 100e6, "test");
        registry.unslashFrontend(frontend1);
        vm.stopPrank();

        assertFalse(registry.isEligible(frontend1));
    }

    function test_TopUp_AfterUnslashRestoresEligibility() public {
        _registerFrontend(frontend1);

        vm.startPrank(admin);
        registry.slashFrontend(frontend1, 100e6, "test");
        registry.unslashFrontend(frontend1);
        vm.stopPrank();

        assertFalse(registry.isEligible(frontend1));

        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), 100e6);
        registry.topUpStake(100e6);
        vm.stopPrank();

        assertTrue(registry.isEligible(frontend1));
    }

    /// @dev A slashed frontend cannot top up before governance unslashes them. Allowing the
    ///      top-up while slashed would let the operator silently re-bond ahead of any
    ///      governance review of the slashing event, blunting the slash signal.
    function test_TopUp_WhileSlashed_Reverts() public {
        _registerFrontend(frontend1);

        vm.prank(admin);
        registry.slashFrontend(frontend1, 100e6, "test");

        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), 100e6);
        vm.expectRevert(bytes("Frontend is slashed"));
        registry.topUpStake(100e6);
        vm.stopPrank();
    }

    /// @dev `canReceiveHistoricalFees` must respect the unbonding window — a frontend
    ///      currently in `requestDeregister` cooldown cannot be eligible for newly resolved
    ///      historical fees, otherwise bounty-path fee routing leaks fees to the operator
    ///      EOA mid-window while the main `claimFees` path is correctly blocked.
    function test_CanReceiveHistoricalFees_RejectsExitPending() public {
        _registerFrontend(frontend1);
        assertTrue(registry.canReceiveHistoricalFees(frontend1));

        vm.prank(frontend1);
        registry.requestDeregister();

        assertFalse(registry.canReceiveHistoricalFees(frontend1));
    }

    // =========================================================================
    // 8. VIEW FUNCTIONS FOR UNREGISTERED ADDRESSES
    // =========================================================================

    function test_IsEligible_Unregistered_ReturnsFalse() public view {
        assertFalse(registry.isEligible(frontend1));
    }

    function test_GetAccumulatedFees_Unregistered_ReturnsZero() public view {
        assertEq(registry.getAccumulatedFees(frontend1), 0);
    }

    function test_GetFrontendInfo_Unregistered_ReturnsDefaults() public view {
        (address operator, uint256 stakedAmount, bool eligible, bool slashed) = registry.getFrontendInfo(frontend1);
        assertEq(operator, address(0));
        assertEq(stakedAmount, 0);
        assertFalse(eligible);
        assertFalse(slashed);
    }

    function test_GetRegisteredFrontendsPaginated_EmptyList() public view {
        (address[] memory frontends, uint256 total) = registry.getRegisteredFrontendsPaginated(0, 10);
        assertEq(total, 0);
        assertEq(frontends.length, 0);
    }

    function test_GetRegisteredFrontendsPaginated_TotalAfterMultipleRegistrations() public {
        _registerFrontend(frontend1);
        _registerFrontend(frontend2);
        _registerFrontend(frontend3);

        (, uint256 total) = registry.getRegisteredFrontendsPaginated(0, 1);
        assertEq(total, 3);
    }

    // =========================================================================
    // 11. MULTIPLE FRONTENDS — list consistency
    // =========================================================================

    function test_RegisteredFrontends_ListPersistsAfterDeregister() public {
        _registerFrontend(frontend1);
        _registerFrontend(frontend2);

        vm.prank(frontend1);
        registry.requestDeregister();

        // frontend1 is still in the list while unbonding
        (address[] memory frontends, uint256 total) = registry.getRegisteredFrontendsPaginated(0, 10);
        assertEq(total, 2);
        assertEq(frontends.length, 2);
    }

    // =========================================================================
    // 12. CLAIM FEES AFTER SLASH+UNSLASH
    // =========================================================================

    function test_ClaimFees_AfterSlashAndUnslashRequiresTopUp() public {
        _registerFrontend(frontend1);

        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 500e6);

        vm.startPrank(admin);
        registry.slashFrontend(frontend1, 100e6, "test");
        registry.unslashFrontend(frontend1);
        vm.stopPrank();

        vm.prank(frontend1);
        vm.expectRevert("Frontend is underbonded");
        registry.requestFeeWithdrawal();

        assertEq(registry.getAccumulatedFees(frontend1), 0);
    }

    function test_ClaimFees_WhileSlashed_Reverts() public {
        _registerFrontend(frontend1);

        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 500e6);

        vm.prank(admin);
        registry.slashFrontend(frontend1, 100e6, "test");

        vm.prank(frontend1);
        vm.expectRevert("Frontend is slashed");
        registry.requestFeeWithdrawal();

        assertEq(registry.getAccumulatedFees(frontend1), 0);
    }

    function test_ClaimFees_WhileExitPending_Reverts() public {
        _registerFrontend(frontend1);

        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 500e6);

        vm.prank(frontend1);
        registry.requestDeregister();

        vm.prank(frontend1);
        vm.expectRevert(IFrontendRegistry.FrontendExitPending.selector);
        registry.requestFeeWithdrawal();

        assertEq(registry.getAccumulatedFees(frontend1), 500e6);
    }

    // =========================================================================
    // 13. SET VOTING ENGINE ACCESS CONTROL
    // =========================================================================

    function test_SetVotingEngine_NonAdmin_Reverts() public {
        vm.prank(nonAdmin);
        vm.expectRevert();
        registry.setVotingEngine(address(votingEngine));
    }

    // =========================================================================
    // 14. ADD/REMOVE FEE CREDITOR ACCESS CONTROL
    // =========================================================================

    function test_AddFeeCreditor_NonGovernance_Reverts() public {
        vm.prank(nonAdmin);
        vm.expectRevert();
        registry.addFeeCreditor(address(99));
    }

    function test_RemoveFeeCreditor_NonGovernance_Reverts() public {
        vm.prank(nonAdmin);
        vm.expectRevert();
        registry.removeFeeCreditor(feeCreditor);
    }

    function test_RemoveFeeCreditor_ClearsSingleton() public {
        vm.prank(admin);
        registry.removeFeeCreditor(feeCreditor);

        assertFalse(registry.hasRole(registry.FEE_CREDITOR_ROLE(), feeCreditor));
        assertEq(registry.feeCreditor(), address(0));
    }

    function test_GrantRoleExtraFeeCreditor_CannotCreditFees() public {
        _registerFrontend(frontend1);
        address extraCreditor = address(new MockRewardDistributor_FR(address(votingEngine)));
        bytes32 feeCreditorRole = registry.FEE_CREDITOR_ROLE();

        vm.prank(admin);
        registry.grantRole(feeCreditorRole, extraCreditor);
        assertTrue(registry.hasRole(feeCreditorRole, extraCreditor));
        assertEq(registry.feeCreditor(), feeCreditor);

        vm.prank(extraCreditor);
        vm.expectRevert("Unauthorized fee creditor");
        registry.creditFees(frontend1, 100e6);
    }

    function test_AddFeeCreditor_AdminWithoutGovernance_Reverts() public {
        vm.startPrank(admin);
        FrontendRegistry impl2 = new FrontendRegistry();
        FrontendRegistry splitRoleRegistry = FrontendRegistry(
            address(
                new ERC1967Proxy(
                    address(impl2), abi.encodeCall(FrontendRegistry.initialize, (admin, governance, address(lrepToken)))
                )
            )
        );

        vm.expectRevert();
        splitRoleRegistry.addFeeCreditor(address(99));
        vm.stopPrank();
    }

    function test_InitialFeeCreditorSetup_RequiresConfiguredVotingEngine() public {
        vm.startPrank(admin);
        FrontendRegistry impl2 = new FrontendRegistry();
        FrontendRegistry splitRoleRegistry = FrontendRegistry(
            address(
                new ERC1967Proxy(
                    address(impl2), abi.encodeCall(FrontendRegistry.initialize, (admin, governance, address(lrepToken)))
                )
            )
        );

        splitRoleRegistry.setVotingEngine(address(votingEngine));
        splitRoleRegistry.initializeFeeCreditor(feeCreditor);
        assertTrue(splitRoleRegistry.hasRole(splitRoleRegistry.FEE_CREDITOR_ROLE(), feeCreditor));
        assertEq(splitRoleRegistry.feeCreditor(), feeCreditor);

        vm.expectRevert("Initial fee creditor set");
        splitRoleRegistry.initializeFeeCreditor(address(99));
        vm.stopPrank();

        MockRewardDistributor_FR newCreditor = new MockRewardDistributor_FR(address(votingEngine));
        protocolConfig.setRewardDistributorForEngine(address(newCreditor), address(votingEngine), true);
        vm.prank(governance);
        splitRoleRegistry.addFeeCreditor(address(newCreditor));
        // Rotation revokes the prior creditor's role so a stale distributor can no longer
        // call creditFees() and inflate accounting without sending backing LREP.
        assertFalse(splitRoleRegistry.hasRole(splitRoleRegistry.FEE_CREDITOR_ROLE(), feeCreditor));
        assertTrue(splitRoleRegistry.hasRole(splitRoleRegistry.FEE_CREDITOR_ROLE(), address(newCreditor)));
        assertEq(splitRoleRegistry.feeCreditor(), address(newCreditor));
    }

    function test_InitialFeeCreditorSetup_BeforeVotingEngine_Reverts() public {
        vm.startPrank(admin);
        FrontendRegistry impl2 = new FrontendRegistry();
        FrontendRegistry splitRoleRegistry = FrontendRegistry(
            address(
                new ERC1967Proxy(
                    address(impl2), abi.encodeCall(FrontendRegistry.initialize, (admin, governance, address(lrepToken)))
                )
            )
        );

        vm.expectRevert("VotingEngine not set");
        splitRoleRegistry.initializeFeeCreditor(feeCreditor);
        vm.stopPrank();
    }

    function test_InitialFeeCreditorSetup_RejectsWrongEngine() public {
        vm.startPrank(admin);
        FrontendRegistry impl2 = new FrontendRegistry();
        FrontendRegistry splitRoleRegistry = FrontendRegistry(
            address(
                new ERC1967Proxy(
                    address(impl2), abi.encodeCall(FrontendRegistry.initialize, (admin, governance, address(lrepToken)))
                )
            )
        );

        splitRoleRegistry.setVotingEngine(address(votingEngine));
        MockRewardDistributor_FR wrongCreditor = new MockRewardDistributor_FR(address(0xBEEF));
        vm.expectRevert("Invalid fee creditor");
        splitRoleRegistry.initializeFeeCreditor(address(wrongCreditor));
        vm.stopPrank();
    }

    // =========================================================================
    // 15. EVENTS
    // =========================================================================

    function test_Register_EmitsFrontendRegistered() public {
        vm.startPrank(frontend1);
        lrepToken.approve(address(registry), STAKE);

        vm.expectEmit(true, true, false, true);
        emit FrontendRegistry.FrontendRegistered(frontend1, frontend1, STAKE);
        registry.register();
        vm.stopPrank();
    }

    function test_Deregister_EmitsFrontendDeregistered() public {
        _registerFrontend(frontend1);

        vm.prank(frontend1);
        registry.requestDeregister();

        vm.expectEmit(true, false, false, false);
        emit FrontendRegistry.FrontendDeregistered(frontend1);
        _completeDeregister(frontend1);
    }

    function test_Deregister_WithFees_EmitsFeesClaimed() public {
        _registerFrontend(frontend1);

        vm.prank(feeCreditor);
        registry.creditFees(frontend1, 200e6);

        vm.prank(frontend1);
        registry.requestDeregister();

        vm.warp(block.timestamp + registry.FEE_WITHDRAWAL_DELAY() + 1);
        vm.expectEmit(true, false, false, true);
        emit FrontendRegistry.FeesClaimed(frontend1, 200e6);
        vm.prank(frontend1);
        registry.completeDeregister();
    }

    function test_Slash_EmitsFrontendSlashed() public {
        _registerFrontend(frontend1);

        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit FrontendRegistry.FrontendSlashed(frontend1, 100e6, "bad behavior");
        registry.slashFrontend(frontend1, 100e6, "bad behavior");
    }

    function test_Slash_RevertsWhenReasonTooLong() public {
        _registerFrontend(frontend1);

        string memory reason = new string(registry.MAX_SLASH_REASON_LENGTH() + 1);

        vm.prank(admin);
        vm.expectRevert("Slash reason too long");
        registry.slashFrontend(frontend1, 100e6, reason);
    }

    function test_CreditFees_EmitsFeesCredited() public {
        _registerFrontend(frontend1);

        vm.prank(feeCreditor);
        vm.expectEmit(true, false, false, true);
        emit FrontendRegistry.FeesCredited(frontend1, 100e6);
        registry.creditFees(frontend1, 100e6);
    }

    // =========================================================================
    // 16. PAGINATED VIEW (L-15)
    // =========================================================================

    function test_GetRegisteredFrontendsPaginated_FullPage() public {
        _registerFrontend(frontend1);
        _registerFrontend(frontend2);
        _registerFrontend(frontend3);

        (address[] memory addrs, uint256 total) = registry.getRegisteredFrontendsPaginated(0, 10);
        assertEq(total, 3);
        assertEq(addrs.length, 3);
        assertEq(addrs[0], frontend1);
        assertEq(addrs[1], frontend2);
        assertEq(addrs[2], frontend3);
    }

    function test_GetRegisteredFrontendsPaginated_OffsetAndLimit() public {
        _registerFrontend(frontend1);
        _registerFrontend(frontend2);
        _registerFrontend(frontend3);

        (address[] memory addrs, uint256 total) = registry.getRegisteredFrontendsPaginated(1, 1);
        assertEq(total, 3);
        assertEq(addrs.length, 1);
        assertEq(addrs[0], frontend2);
    }

    function test_GetRegisteredFrontendsPaginated_OffsetBeyondLength() public {
        _registerFrontend(frontend1);

        (address[] memory addrs, uint256 total) = registry.getRegisteredFrontendsPaginated(5, 10);
        assertEq(total, 1);
        assertEq(addrs.length, 0);
    }

    function test_GetRegisteredFrontendsPaginated_ZeroLimit() public {
        _registerFrontend(frontend1);

        (address[] memory addrs, uint256 total) = registry.getRegisteredFrontendsPaginated(0, 0);
        assertEq(total, 1);
        assertEq(addrs.length, 0);
    }

    function test_GetRegisteredFrontendsPaginated_Empty() public view {
        (address[] memory addrs, uint256 total) = registry.getRegisteredFrontendsPaginated(0, 10);
        assertEq(total, 0);
        assertEq(addrs.length, 0);
    }

    function test_GetRegisteredFrontendsPaginated_LimitClampedToEnd() public {
        _registerFrontend(frontend1);
        _registerFrontend(frontend2);

        (address[] memory addrs, uint256 total) = registry.getRegisteredFrontendsPaginated(1, 100);
        assertEq(total, 2);
        assertEq(addrs.length, 1);
        assertEq(addrs[0], frontend2);
    }

    function test_GetRegisteredFrontendsPaginated_AfterDeregister() public {
        _registerFrontend(frontend1);
        _registerFrontend(frontend2);

        vm.prank(frontend1);
        registry.requestDeregister();

        // frontend1 still in array while unbonding, total unchanged
        (address[] memory addrs, uint256 total) = registry.getRegisteredFrontendsPaginated(0, 10);
        assertEq(total, 2);
        assertEq(addrs.length, 2);
        assertEq(addrs[0], frontend1);
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    function _registerFrontend(address fe) internal {
        vm.startPrank(fe);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();
    }

    function _completeDeregister(address fe) internal {
        vm.warp(block.timestamp + registry.UNBONDING_PERIOD() + 1);
        vm.prank(fe);
        registry.completeDeregister();
    }
}
