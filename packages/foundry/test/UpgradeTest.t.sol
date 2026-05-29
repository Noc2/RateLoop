// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import {
    TransparentUpgradeableProxy,
    ITransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { ProxyAdmin } from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
import { RoundRewardDistributor } from "../contracts/RoundRewardDistributor.sol";
import { ProfileRegistry } from "../contracts/ProfileRegistry.sol";
import { FrontendRegistry } from "../contracts/FrontendRegistry.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { QuestionRewardPoolEscrow } from "../contracts/QuestionRewardPoolEscrow.sol";
import { FeedbackBonusEscrow } from "../contracts/FeedbackBonusEscrow.sol";
import { FeedbackRegistry } from "../contracts/FeedbackRegistry.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { IProfileRegistry } from "../contracts/interfaces/IProfileRegistry.sol";
import { IRoundVotingEngine } from "../contracts/interfaces/IRoundVotingEngine.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { MockWorldIDRouter } from "../contracts/mocks/MockWorldIDRouter.sol";

/// @title Minimal mock for RoundVotingEngine interface (used by FrontendRegistry)
contract MockVotingEngineForUpgrade is IRoundVotingEngine {
    function hasCommits(uint256) external pure override returns (bool) {
        return false;
    }

    function currentRoundId(uint256) external pure override returns (uint256) {
        return 0;
    }

    function activeRoundId(uint256) external pure override returns (uint256) {
        return 0;
    }

    function isDormancyBlocked(uint256) external pure override returns (bool) {
        return false;
    }

    function rounds(uint256, uint256)
        external
        pure
        override
        returns (
            uint48,
            RoundLib.RoundState,
            uint16,
            uint16,
            uint64,
            uint64,
            uint64,
            uint16,
            uint16,
            bool,
            uint48,
            uint48,
            uint64,
            uint64
        )
    {
        return (0, RoundLib.RoundState.Open, 0, 0, 0, 0, 0, 0, 0, false, 0, 0, 0, 0);
    }

    function transferReward(address, uint256) external override { }
}

/// @title Transparent Proxy Upgrade Tests for all proxy-backed contracts
contract UpgradeTest is Test {
    // Contracts
    ContentRegistry public contentRegistry;
    RoundVotingEngine public votingEngine;
    RoundRewardDistributor public rewardDistributor;
    ProfileRegistry public profileRegistry;
    FrontendRegistry public frontendRegistry;
    ProtocolConfig public protocolConfig;
    QuestionRewardPoolEscrow public questionRewardPoolEscrow;
    FeedbackBonusEscrow public feedbackBonusEscrow;
    FeedbackRegistry public feedbackRegistry;
    RaterRegistry public raterRegistry;
    ProxyAdmin public contentRegistryAdmin;
    ProxyAdmin public votingEngineAdmin;
    ProxyAdmin public rewardDistributorAdmin;
    ProxyAdmin public profileRegistryAdmin;
    ProxyAdmin public frontendRegistryAdmin;
    ProxyAdmin public protocolConfigAdmin;
    ProxyAdmin public questionRewardPoolEscrowAdmin;
    ProxyAdmin public feedbackBonusEscrowAdmin;
    ProxyAdmin public feedbackRegistryAdmin;
    ProxyAdmin public raterRegistryAdmin;

    LoopReputation public lrepToken;
    MockVotingEngineForUpgrade public mockVotingEngine;
    MockWorldIDRouter public worldIdRouter;

    // Roles
    address public admin = address(1);
    address public governance = address(2);
    address public attacker = address(999);
    bytes32 internal constant ERC1967_ADMIN_SLOT = bytes32(uint256(keccak256("eip1967.proxy.admin")) - 1);

    function setUp() public {
        vm.startPrank(admin);

        // Deploy token
        lrepToken = new LoopReputation(admin, governance);
        mockVotingEngine = new MockVotingEngineForUpgrade();
        worldIdRouter = new MockWorldIDRouter();

        // --- ContentRegistry ---
        ContentRegistry crImpl = new ContentRegistry();
        TransparentUpgradeableProxy crProxy = new TransparentUpgradeableProxy(
            address(crImpl),
            governance,
            abi.encodeCall(ContentRegistry.initializeWithTreasury, (admin, governance, governance, address(lrepToken)))
        );
        contentRegistry = ContentRegistry(address(crProxy));
        contentRegistryAdmin = _proxyAdmin(address(crProxy));

        // --- ProtocolConfig ---
        ProtocolConfig pcImpl = new ProtocolConfig();
        TransparentUpgradeableProxy pcProxy = new TransparentUpgradeableProxy(
            address(pcImpl), governance, abi.encodeCall(ProtocolConfig.initialize, (admin, governance))
        );
        protocolConfig = ProtocolConfig(address(pcProxy));
        protocolConfigAdmin = _proxyAdmin(address(pcProxy));

        // --- RoundVotingEngine ---
        RoundVotingEngine veImpl = new RoundVotingEngine();
        TransparentUpgradeableProxy veProxy = new TransparentUpgradeableProxy(
            address(veImpl),
            governance,
            abi.encodeCall(
                RoundVotingEngine.initialize,
                (governance, address(lrepToken), address(contentRegistry), address(protocolConfig))
            )
        );
        votingEngine = RoundVotingEngine(address(veProxy));
        votingEngineAdmin = _proxyAdmin(address(veProxy));

        // --- RoundRewardDistributor ---
        RoundRewardDistributor rdImpl = new RoundRewardDistributor();
        TransparentUpgradeableProxy rdProxy = new TransparentUpgradeableProxy(
            address(rdImpl),
            governance,
            abi.encodeCall(
                RoundRewardDistributor.initialize,
                (governance, address(lrepToken), address(votingEngine), address(contentRegistry))
            )
        );
        rewardDistributor = RoundRewardDistributor(address(rdProxy));
        rewardDistributorAdmin = _proxyAdmin(address(rdProxy));

        // --- ProfileRegistry ---
        ProfileRegistry prImpl = new ProfileRegistry();
        TransparentUpgradeableProxy prProxy = new TransparentUpgradeableProxy(
            address(prImpl), governance, abi.encodeCall(ProfileRegistry.initialize, (admin, governance))
        );
        profileRegistry = ProfileRegistry(address(prProxy));
        profileRegistryAdmin = _proxyAdmin(address(prProxy));

        // --- FrontendRegistry ---
        FrontendRegistry frImpl = new FrontendRegistry();
        TransparentUpgradeableProxy frProxy = new TransparentUpgradeableProxy(
            address(frImpl),
            governance,
            abi.encodeCall(FrontendRegistry.initialize, (admin, governance, address(lrepToken)))
        );
        frontendRegistry = FrontendRegistry(address(frProxy));
        frontendRegistryAdmin = _proxyAdmin(address(frProxy));

        // --- RaterRegistry ---
        RaterRegistry rrImpl =
            new RaterRegistry(admin, governance, address(worldIdRouter), bytes32("rate-loop"), 1, 365 days);
        TransparentUpgradeableProxy rrProxy = new TransparentUpgradeableProxy(
            address(rrImpl),
            governance,
            abi.encodeCall(
                RaterRegistry.initialize, (admin, governance, address(worldIdRouter), bytes32("rate-loop"), 1, 365 days)
            )
        );
        raterRegistry = RaterRegistry(address(rrProxy));
        raterRegistryAdmin = _proxyAdmin(address(rrProxy));

        profileRegistry.setRaterRegistry(address(raterRegistry));

        // --- QuestionRewardPoolEscrow ---
        QuestionRewardPoolEscrow qrpImpl = new QuestionRewardPoolEscrow();
        TransparentUpgradeableProxy qrpProxy = new TransparentUpgradeableProxy(
            address(qrpImpl),
            governance,
            abi.encodeCall(
                QuestionRewardPoolEscrow.initialize,
                (
                    governance,
                    address(lrepToken),
                    address(lrepToken),
                    address(contentRegistry),
                    address(votingEngine),
                    address(raterRegistry)
                )
            )
        );
        questionRewardPoolEscrow = QuestionRewardPoolEscrow(address(qrpProxy));
        questionRewardPoolEscrowAdmin = _proxyAdmin(address(qrpProxy));

        // --- FeedbackBonusEscrow ---
        FeedbackRegistry feedbackRegistryImpl = new FeedbackRegistry();
        TransparentUpgradeableProxy feedbackRegistryProxy = new TransparentUpgradeableProxy(
            address(feedbackRegistryImpl),
            governance,
            abi.encodeCall(FeedbackRegistry.initialize, (admin, governance, address(votingEngine)))
        );
        feedbackRegistry = FeedbackRegistry(address(feedbackRegistryProxy));
        feedbackRegistryAdmin = _proxyAdmin(address(feedbackRegistryProxy));

        FeedbackBonusEscrow fbeImpl = new FeedbackBonusEscrow();
        TransparentUpgradeableProxy fbeProxy = new TransparentUpgradeableProxy(
            address(fbeImpl),
            governance,
            abi.encodeCall(
                FeedbackBonusEscrow.initialize,
                (
                    governance,
                    address(lrepToken),
                    address(lrepToken),
                    address(contentRegistry),
                    address(votingEngine),
                    address(raterRegistry),
                    address(feedbackRegistry)
                )
            )
        );
        feedbackBonusEscrow = FeedbackBonusEscrow(address(fbeProxy));
        feedbackBonusEscrowAdmin = _proxyAdmin(address(fbeProxy));

        vm.stopPrank();
    }

    // =========================================================================
    // ContentRegistry upgrade tests
    // =========================================================================

    function test_ContentRegistry_GovernanceCanUpgrade() public {
        ContentRegistry newImpl = new ContentRegistry();
        vm.prank(governance);
        contentRegistryAdmin.upgradeAndCall(_proxy(address(contentRegistry)), address(newImpl), "");
    }

    function test_ContentRegistry_UnauthorizedCannotUpgrade() public {
        ContentRegistry newImpl = new ContentRegistry();
        vm.prank(attacker);
        vm.expectRevert();
        contentRegistryAdmin.upgradeAndCall(_proxy(address(contentRegistry)), address(newImpl), "");
    }

    function test_ContentRegistry_CannotReinitialize() public {
        vm.prank(admin);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        contentRegistry.initializeWithTreasury(admin, governance, governance, address(lrepToken));
    }

    function test_ContentRegistry_StatePreservedAfterUpgrade() public {
        assertEq(contentRegistryAdmin.owner(), governance);

        // Upgrade
        ContentRegistry newImpl = new ContentRegistry();
        vm.prank(governance);
        contentRegistryAdmin.upgradeAndCall(_proxy(address(contentRegistry)), address(newImpl), "");

        // Verify state preserved
        assertEq(contentRegistryAdmin.owner(), governance);
        assertEq(address(contentRegistry.lrepToken()), address(lrepToken));
    }

    // =========================================================================
    // ProtocolConfig upgrade tests
    // =========================================================================

    function test_ProtocolConfig_GovernanceCanUpgrade() public {
        ProtocolConfig newImpl = new ProtocolConfig();
        vm.prank(governance);
        protocolConfigAdmin.upgradeAndCall(_proxy(address(protocolConfig)), address(newImpl), "");
    }

    function test_ProtocolConfig_UnauthorizedCannotUpgrade() public {
        ProtocolConfig newImpl = new ProtocolConfig();
        vm.prank(attacker);
        vm.expectRevert();
        protocolConfigAdmin.upgradeAndCall(_proxy(address(protocolConfig)), address(newImpl), "");
    }

    function test_ProtocolConfig_CannotReinitialize() public {
        vm.prank(admin);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        protocolConfig.initialize(admin, governance);
    }

    function test_ProtocolConfig_StatePreservedAfterUpgrade() public {
        vm.prank(governance);
        protocolConfig.setTreasury(address(1234));

        assertEq(protocolConfigAdmin.owner(), governance);
        assertEq(protocolConfig.treasury(), address(1234));
        assertTrue(protocolConfig.hasRole(protocolConfig.DEFAULT_ADMIN_ROLE(), governance));
        assertTrue(protocolConfig.hasRole(protocolConfig.CONFIG_ROLE(), governance));
        assertTrue(protocolConfig.hasRole(protocolConfig.CONFIG_ROLE(), admin));
        assertTrue(protocolConfig.hasRole(protocolConfig.TREASURY_ADMIN_ROLE(), governance));
        assertTrue(protocolConfig.hasRole(protocolConfig.TREASURY_ROLE(), governance));
        assertEq(protocolConfig.getRoleAdmin(protocolConfig.TREASURY_ROLE()), protocolConfig.TREASURY_ADMIN_ROLE());
        assertEq(protocolConfig.getRoleAdmin(protocolConfig.TREASURY_ADMIN_ROLE()), protocolConfig.DEFAULT_ADMIN_ROLE());

        ProtocolConfig newImpl = new ProtocolConfig();
        vm.prank(governance);
        protocolConfigAdmin.upgradeAndCall(_proxy(address(protocolConfig)), address(newImpl), "");

        assertEq(protocolConfigAdmin.owner(), governance);
        assertEq(protocolConfig.treasury(), address(1234));
        assertTrue(protocolConfig.hasRole(protocolConfig.DEFAULT_ADMIN_ROLE(), governance));
        assertTrue(protocolConfig.hasRole(protocolConfig.CONFIG_ROLE(), governance));
        assertTrue(protocolConfig.hasRole(protocolConfig.CONFIG_ROLE(), admin));
        assertTrue(protocolConfig.hasRole(protocolConfig.TREASURY_ADMIN_ROLE(), governance));
        assertTrue(protocolConfig.hasRole(protocolConfig.TREASURY_ROLE(), governance));
        assertEq(protocolConfig.getRoleAdmin(protocolConfig.TREASURY_ROLE()), protocolConfig.TREASURY_ADMIN_ROLE());
        assertEq(protocolConfig.getRoleAdmin(protocolConfig.TREASURY_ADMIN_ROLE()), protocolConfig.DEFAULT_ADMIN_ROLE());
    }

    // =========================================================================
    // RoundVotingEngine upgrade tests
    // =========================================================================

    function test_VotingEngine_GovernanceCanUpgrade() public {
        RoundVotingEngine newImpl = new RoundVotingEngine();
        vm.prank(governance);
        votingEngineAdmin.upgradeAndCall(_proxy(address(votingEngine)), address(newImpl), "");
    }

    function test_VotingEngine_UnauthorizedCannotUpgrade() public {
        RoundVotingEngine newImpl = new RoundVotingEngine();
        vm.prank(attacker);
        vm.expectRevert();
        votingEngineAdmin.upgradeAndCall(_proxy(address(votingEngine)), address(newImpl), "");
    }

    function test_VotingEngine_CannotReinitialize() public {
        address protocolConfigAddress = address(votingEngine.protocolConfig());
        vm.prank(admin);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        votingEngine.initialize(governance, address(lrepToken), address(contentRegistry), protocolConfigAddress);
    }

    function test_VotingEngine_StatePreservedAfterUpgrade() public {
        assertEq(votingEngineAdmin.owner(), governance);

        RoundVotingEngine newImpl = new RoundVotingEngine();
        vm.prank(governance);
        votingEngineAdmin.upgradeAndCall(_proxy(address(votingEngine)), address(newImpl), "");

        assertEq(votingEngineAdmin.owner(), governance);
    }

    function test_VotingEngine_LateStorageLayoutSlotsStayStable() public {
        uint256 contentId = 77;
        uint256 roundId = 8;
        bytes32 commitKey = keccak256("layout-commit");

        vm.store(address(votingEngine), _doubleUintMappingSlot(57, contentId, roundId), bytes32(uint256(111)));
        vm.store(address(votingEngine), _doubleUintMappingSlot(58, contentId, roundId), bytes32(uint256(222)));
        vm.store(
            address(votingEngine),
            _tripleUintBytes32MappingSlot(59, contentId, roundId, commitKey),
            bytes32(uint256(333))
        );

        assertEq(votingEngine.roundRatingUpEvidence(contentId, roundId), 111);
        assertEq(votingEngine.roundRatingDownEvidence(contentId, roundId), 222);
        assertEq(votingEngine.commitCommittedAt(contentId, roundId, commitKey), 333);
    }

    // =========================================================================
    // RoundRewardDistributor upgrade tests
    // =========================================================================

    function test_RewardDistributor_GovernanceCanUpgrade() public {
        RoundRewardDistributor newImpl = new RoundRewardDistributor();
        vm.prank(governance);
        rewardDistributorAdmin.upgradeAndCall(_proxy(address(rewardDistributor)), address(newImpl), "");
    }

    function test_RewardDistributor_UnauthorizedCannotUpgrade() public {
        RoundRewardDistributor newImpl = new RoundRewardDistributor();
        vm.prank(attacker);
        vm.expectRevert();
        rewardDistributorAdmin.upgradeAndCall(_proxy(address(rewardDistributor)), address(newImpl), "");
    }

    function test_RewardDistributor_CannotReinitialize() public {
        vm.prank(admin);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        rewardDistributor.initialize(governance, address(lrepToken), address(votingEngine), address(contentRegistry));
    }

    function test_RewardDistributor_StatePreservedAfterUpgrade() public {
        assertEq(rewardDistributorAdmin.owner(), governance);
        assertEq(address(rewardDistributor.lrepToken()), address(lrepToken));

        RoundRewardDistributor newImpl = new RoundRewardDistributor();
        vm.prank(governance);
        rewardDistributorAdmin.upgradeAndCall(_proxy(address(rewardDistributor)), address(newImpl), "");

        assertEq(rewardDistributorAdmin.owner(), governance);
        assertEq(address(rewardDistributor.lrepToken()), address(lrepToken));
    }

    // =========================================================================
    // ProfileRegistry upgrade tests
    // =========================================================================

    function test_ProfileRegistry_GovernanceCanUpgrade() public {
        ProfileRegistry newImpl = new ProfileRegistry();
        vm.prank(governance);
        profileRegistryAdmin.upgradeAndCall(_proxy(address(profileRegistry)), address(newImpl), "");
    }

    function test_ProfileRegistry_UnauthorizedCannotUpgrade() public {
        ProfileRegistry newImpl = new ProfileRegistry();
        vm.prank(attacker);
        vm.expectRevert();
        profileRegistryAdmin.upgradeAndCall(_proxy(address(profileRegistry)), address(newImpl), "");
    }

    function test_ProfileRegistry_CannotReinitialize() public {
        vm.prank(admin);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        profileRegistry.initialize(admin, governance);
    }

    function test_ProfileRegistry_StatePreservedAfterUpgrade() public {
        // Create a profile before upgrade
        vm.prank(address(10));
        profileRegistry.setProfile("testuser", "");

        vm.prank(address(10));
        profileRegistry.setAvatarAccent(0xF26426);

        assertEq(profileRegistryAdmin.owner(), governance);
        assertTrue(profileRegistry.hasProfile(address(10)));

        ProfileRegistry newImpl = new ProfileRegistry();
        vm.prank(governance);
        profileRegistryAdmin.upgradeAndCall(_proxy(address(profileRegistry)), address(newImpl), "");

        // State preserved
        assertEq(profileRegistryAdmin.owner(), governance);
        assertTrue(profileRegistry.hasProfile(address(10)));

        IProfileRegistry.Profile memory profile = profileRegistry.getProfile(address(10));
        assertEq(profile.name, "testuser");
        assertEq(profile.selfReport, "");
        assertTrue(profile.createdAt > 0);
        assertTrue(profile.updatedAt > 0);

        (bool enabled, uint24 rgb) = profileRegistry.getAvatarAccent(address(10));
        assertTrue(enabled);
        assertEq(rgb, 0xF26426);
    }

    // =========================================================================
    // FrontendRegistry upgrade tests
    // =========================================================================

    function test_FrontendRegistry_GovernanceCanUpgrade() public {
        FrontendRegistry newImpl = new FrontendRegistry();
        vm.prank(governance);
        frontendRegistryAdmin.upgradeAndCall(_proxy(address(frontendRegistry)), address(newImpl), "");
    }

    function test_FrontendRegistry_UnauthorizedCannotUpgrade() public {
        FrontendRegistry newImpl = new FrontendRegistry();
        vm.prank(attacker);
        vm.expectRevert();
        frontendRegistryAdmin.upgradeAndCall(_proxy(address(frontendRegistry)), address(newImpl), "");
    }

    function test_FrontendRegistry_CannotReinitialize() public {
        vm.prank(admin);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        frontendRegistry.initialize(admin, governance, address(lrepToken));
    }

    function test_FrontendRegistry_StatePreservedAfterUpgrade() public {
        assertEq(frontendRegistryAdmin.owner(), governance);
        assertEq(frontendRegistry.STAKE_AMOUNT(), 1000e6);

        FrontendRegistry newImpl = new FrontendRegistry();
        vm.prank(governance);
        frontendRegistryAdmin.upgradeAndCall(_proxy(address(frontendRegistry)), address(newImpl), "");

        assertEq(frontendRegistryAdmin.owner(), governance);
        assertEq(frontendRegistry.STAKE_AMOUNT(), 1000e6);
    }

    // =========================================================================
    // RaterRegistry upgrade tests
    // =========================================================================

    function test_RaterRegistry_GovernanceCanUpgrade() public {
        RaterRegistry newImpl =
            new RaterRegistry(admin, governance, address(worldIdRouter), bytes32("rate-loop"), 1, 365 days);
        vm.prank(governance);
        raterRegistryAdmin.upgradeAndCall(_proxy(address(raterRegistry)), address(newImpl), "");
    }

    function test_RaterRegistry_UnauthorizedCannotUpgrade() public {
        RaterRegistry newImpl =
            new RaterRegistry(admin, governance, address(worldIdRouter), bytes32("rate-loop"), 1, 365 days);
        vm.prank(attacker);
        vm.expectRevert();
        raterRegistryAdmin.upgradeAndCall(_proxy(address(raterRegistry)), address(newImpl), "");
    }

    function test_RaterRegistry_CannotReinitialize() public {
        vm.prank(admin);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        raterRegistry.initialize(admin, governance, address(worldIdRouter), bytes32("rate-loop"), 1, 365 days);
    }

    function test_RaterRegistry_StatePreservedAfterUpgrade() public {
        vm.prank(admin);
        raterRegistry.seedHumanCredential(address(10), uint64(block.timestamp + 30 days), bytes32("human-10"), 0);

        assertEq(raterRegistryAdmin.owner(), governance);
        assertTrue(raterRegistry.hasRole(raterRegistry.DEFAULT_ADMIN_ROLE(), governance));
        assertTrue(raterRegistry.hasActiveHumanCredential(address(10)));
        assertEq(address(raterRegistry.worldIdRouter()), address(worldIdRouter));
        assertEq(raterRegistry.worldIdScope(), bytes32("rate-loop"));

        RaterRegistry newImpl =
            new RaterRegistry(admin, governance, address(worldIdRouter), bytes32("rate-loop"), 1, 365 days);
        vm.prank(governance);
        raterRegistryAdmin.upgradeAndCall(_proxy(address(raterRegistry)), address(newImpl), "");

        assertEq(raterRegistryAdmin.owner(), governance);
        assertTrue(raterRegistry.hasRole(raterRegistry.DEFAULT_ADMIN_ROLE(), governance));
        assertTrue(raterRegistry.hasActiveHumanCredential(address(10)));
        assertEq(address(raterRegistry.worldIdRouter()), address(worldIdRouter));
        assertEq(raterRegistry.worldIdScope(), bytes32("rate-loop"));
    }

    // =========================================================================
    // QuestionRewardPoolEscrow upgrade tests
    // =========================================================================

    function test_QuestionRewardPoolEscrow_GovernanceCanUpgrade() public {
        QuestionRewardPoolEscrow newImpl = new QuestionRewardPoolEscrow();
        vm.prank(governance);
        questionRewardPoolEscrowAdmin.upgradeAndCall(_proxy(address(questionRewardPoolEscrow)), address(newImpl), "");
    }

    function test_QuestionRewardPoolEscrow_UnauthorizedCannotUpgrade() public {
        QuestionRewardPoolEscrow newImpl = new QuestionRewardPoolEscrow();
        vm.prank(attacker);
        vm.expectRevert();
        questionRewardPoolEscrowAdmin.upgradeAndCall(_proxy(address(questionRewardPoolEscrow)), address(newImpl), "");
    }

    function test_QuestionRewardPoolEscrow_CannotReinitialize() public {
        vm.prank(admin);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        questionRewardPoolEscrow.initialize(
            governance,
            address(lrepToken),
            address(lrepToken),
            address(contentRegistry),
            address(votingEngine),
            address(raterRegistry)
        );
    }

    function test_QuestionRewardPoolEscrow_StatePreservedAfterUpgrade() public {
        assertEq(questionRewardPoolEscrowAdmin.owner(), governance);
        assertEq(questionRewardPoolEscrow.defaultFrontendFeeBps(), 300);
        assertTrue(questionRewardPoolEscrow.hasRole(questionRewardPoolEscrow.DEFAULT_ADMIN_ROLE(), governance));

        QuestionRewardPoolEscrow newImpl = new QuestionRewardPoolEscrow();
        vm.prank(governance);
        questionRewardPoolEscrowAdmin.upgradeAndCall(_proxy(address(questionRewardPoolEscrow)), address(newImpl), "");

        assertEq(questionRewardPoolEscrowAdmin.owner(), governance);
        assertEq(questionRewardPoolEscrow.defaultFrontendFeeBps(), 300);
        assertTrue(questionRewardPoolEscrow.hasRole(questionRewardPoolEscrow.DEFAULT_ADMIN_ROLE(), governance));
    }

    // =========================================================================
    // FeedbackBonusEscrow upgrade tests
    // =========================================================================

    function test_FeedbackBonusEscrow_GovernanceCanUpgrade() public {
        FeedbackBonusEscrow newImpl = new FeedbackBonusEscrow();
        vm.prank(governance);
        feedbackBonusEscrowAdmin.upgradeAndCall(_proxy(address(feedbackBonusEscrow)), address(newImpl), "");
    }

    function test_FeedbackBonusEscrow_UnauthorizedCannotUpgrade() public {
        FeedbackBonusEscrow newImpl = new FeedbackBonusEscrow();
        vm.prank(attacker);
        vm.expectRevert();
        feedbackBonusEscrowAdmin.upgradeAndCall(_proxy(address(feedbackBonusEscrow)), address(newImpl), "");
    }

    function test_FeedbackBonusEscrow_CannotReinitialize() public {
        vm.prank(admin);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        feedbackBonusEscrow.initialize(
            governance,
            address(lrepToken),
            address(lrepToken),
            address(contentRegistry),
            address(votingEngine),
            address(raterRegistry),
            address(feedbackRegistry)
        );
    }

    function test_FeedbackBonusEscrow_StatePreservedAfterUpgrade() public {
        vm.prank(governance);
        feedbackBonusEscrow.setDefaultFrontendFeeBps(400);

        assertEq(feedbackBonusEscrowAdmin.owner(), governance);
        assertEq(feedbackBonusEscrow.defaultFrontendFeeBps(), 400);
        assertEq(address(feedbackBonusEscrow.usdcToken()), address(lrepToken));
        assertTrue(feedbackBonusEscrow.hasRole(feedbackBonusEscrow.DEFAULT_ADMIN_ROLE(), governance));

        FeedbackBonusEscrow newImpl = new FeedbackBonusEscrow();
        vm.prank(governance);
        feedbackBonusEscrowAdmin.upgradeAndCall(_proxy(address(feedbackBonusEscrow)), address(newImpl), "");

        assertEq(feedbackBonusEscrowAdmin.owner(), governance);
        assertEq(feedbackBonusEscrow.defaultFrontendFeeBps(), 400);
        assertEq(address(feedbackBonusEscrow.usdcToken()), address(lrepToken));
        assertTrue(feedbackBonusEscrow.hasRole(feedbackBonusEscrow.DEFAULT_ADMIN_ROLE(), governance));
    }

    // =========================================================================
    // FeedbackRegistry upgrade tests
    // =========================================================================

    function test_FeedbackRegistry_GovernanceCanUpgrade() public {
        FeedbackRegistry newImpl = new FeedbackRegistry();
        vm.prank(governance);
        feedbackRegistryAdmin.upgradeAndCall(_proxy(address(feedbackRegistry)), address(newImpl), "");
    }

    function test_FeedbackRegistry_UnauthorizedCannotUpgrade() public {
        FeedbackRegistry newImpl = new FeedbackRegistry();
        vm.prank(attacker);
        vm.expectRevert();
        feedbackRegistryAdmin.upgradeAndCall(_proxy(address(feedbackRegistry)), address(newImpl), "");
    }

    function test_FeedbackRegistry_CannotReinitialize() public {
        vm.prank(admin);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        feedbackRegistry.initialize(admin, governance, address(votingEngine));
    }

    function test_FeedbackRegistry_StatePreservedAfterUpgrade() public {
        assertEq(feedbackRegistryAdmin.owner(), governance);
        assertEq(address(feedbackRegistry.votingEngine()), address(votingEngine));
        assertTrue(feedbackRegistry.hasRole(feedbackRegistry.DEFAULT_ADMIN_ROLE(), governance));
        assertTrue(feedbackRegistry.hasRole(feedbackRegistry.CONFIG_ROLE(), governance));
        assertTrue(feedbackRegistry.hasRole(feedbackRegistry.CONFIG_ROLE(), admin));

        FeedbackRegistry newImpl = new FeedbackRegistry();
        vm.prank(governance);
        feedbackRegistryAdmin.upgradeAndCall(_proxy(address(feedbackRegistry)), address(newImpl), "");

        assertEq(feedbackRegistryAdmin.owner(), governance);
        assertEq(address(feedbackRegistry.votingEngine()), address(votingEngine));
        assertTrue(feedbackRegistry.hasRole(feedbackRegistry.DEFAULT_ADMIN_ROLE(), governance));
        assertTrue(feedbackRegistry.hasRole(feedbackRegistry.CONFIG_ROLE(), governance));
        assertTrue(feedbackRegistry.hasRole(feedbackRegistry.CONFIG_ROLE(), admin));
    }

    // =========================================================================
    // Implementation direct initialization protection
    // =========================================================================

    function test_ImplementationsCannotBeInitializedDirectly() public {
        // Each implementation should have _disableInitializers() in its constructor
        ContentRegistry crImpl = new ContentRegistry();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        crImpl.initializeWithTreasury(admin, governance, governance, address(lrepToken));

        RoundVotingEngine veImpl = new RoundVotingEngine();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        veImpl.initialize(admin, governance, address(lrepToken), address(contentRegistry));

        RoundRewardDistributor rdImpl = new RoundRewardDistributor();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        rdImpl.initialize(governance, address(lrepToken), address(votingEngine), address(contentRegistry));

        ProfileRegistry prImpl = new ProfileRegistry();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        prImpl.initialize(admin, governance);

        FrontendRegistry frImpl = new FrontendRegistry();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        frImpl.initialize(admin, governance, address(lrepToken));

        ProtocolConfig pcImpl = new ProtocolConfig();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        pcImpl.initialize(admin, governance);

        QuestionRewardPoolEscrow qrpImpl = new QuestionRewardPoolEscrow();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        qrpImpl.initialize(
            governance,
            address(lrepToken),
            address(lrepToken),
            address(contentRegistry),
            address(votingEngine),
            address(raterRegistry)
        );

        FeedbackBonusEscrow fbeImpl = new FeedbackBonusEscrow();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        fbeImpl.initialize(
            governance,
            address(lrepToken),
            address(lrepToken),
            address(contentRegistry),
            address(votingEngine),
            address(raterRegistry),
            address(feedbackRegistry)
        );

        FeedbackRegistry feedbackImpl = new FeedbackRegistry();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        feedbackImpl.initialize(admin, governance, address(votingEngine));

        RaterRegistry raterImpl =
            new RaterRegistry(admin, governance, address(worldIdRouter), bytes32("rate-loop"), 1, 365 days);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        raterImpl.initialize(admin, governance, address(worldIdRouter), bytes32("rate-loop"), 1, 365 days);
    }

    function _proxy(address proxy) internal pure returns (ITransparentUpgradeableProxy) {
        return ITransparentUpgradeableProxy(payable(proxy));
    }

    function _proxyAdmin(address proxy) internal view returns (ProxyAdmin) {
        return ProxyAdmin(address(uint160(uint256(vm.load(proxy, ERC1967_ADMIN_SLOT)))));
    }

    function _doubleUintMappingSlot(uint256 baseSlot, uint256 firstKey, uint256 secondKey)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(secondKey, keccak256(abi.encode(firstKey, baseSlot))));
    }

    function _tripleUintBytes32MappingSlot(uint256 baseSlot, uint256 firstKey, uint256 secondKey, bytes32 thirdKey)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(thirdKey, _doubleUintMappingSlot(baseSlot, firstKey, secondKey)));
    }
}
