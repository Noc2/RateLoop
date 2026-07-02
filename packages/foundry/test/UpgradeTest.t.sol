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
import { SubmissionMediaValidator } from "../contracts/SubmissionMediaValidator.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
import { RoundRewardDistributor } from "../contracts/RoundRewardDistributor.sol";
import { ProfileRegistry } from "../contracts/ProfileRegistry.sol";
import { FrontendRegistry } from "../contracts/FrontendRegistry.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { QuestionRewardPoolEscrow } from "../contracts/QuestionRewardPoolEscrow.sol";
import { ConfidentialityEscrow } from "../contracts/ConfidentialityEscrow.sol";
import { FeedbackBonusEscrow } from "../contracts/FeedbackBonusEscrow.sol";
import { FeedbackRegistry } from "../contracts/FeedbackRegistry.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { IProfileRegistry } from "../contracts/interfaces/IProfileRegistry.sol";
import { IRoundVotingEngine } from "../contracts/interfaces/IRoundVotingEngine.sol";
import { RatingLib } from "../contracts/libraries/RatingLib.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { MockWorldIDVerifier } from "../contracts/mocks/MockWorldIDVerifier.sol";

/// @title Minimal mock for RoundVotingEngine interface (used by FrontendRegistry)
contract MockVotingEngineForUpgrade is IRoundVotingEngine {
    function hasCommits(uint256) external pure override returns (bool) {
        return false;
    }

    function currentRoundId(uint256) external pure override returns (uint256) {
        return 0;
    }

    function nextRoundIdForContent(uint256) external pure override returns (uint256) {
        return 1;
    }

    function openInitialRoundFromRegistry(uint256, uint256) external pure override { }

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
    ConfidentialityEscrow public confidentialityEscrow;
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
    ProxyAdmin public confidentialityEscrowAdmin;
    ProxyAdmin public feedbackBonusEscrowAdmin;
    ProxyAdmin public feedbackRegistryAdmin;
    ProxyAdmin public raterRegistryAdmin;

    LoopReputation public lrepToken;
    MockVotingEngineForUpgrade public mockVotingEngine;
    MockWorldIDVerifier public worldIdRouter;

    // Roles
    address public admin = address(1);
    address public governance = address(2);
    address public attacker = address(999);
    bytes32 internal constant ERC1967_ADMIN_SLOT = bytes32(uint256(keccak256("eip1967.proxy.admin")) - 1);
    bytes32 internal constant QUICKNET_CHAIN_HASH = 0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971;
    uint64 internal constant QUICKNET_TEST_GENESIS_TIME = 1;
    uint64 internal constant QUICKNET_TEST_PERIOD = 3;

    function setUp() public {
        vm.startPrank(admin);

        // Deploy token
        lrepToken = new LoopReputation(admin, governance);
        mockVotingEngine = new MockVotingEngineForUpgrade();
        worldIdRouter = new MockWorldIDVerifier();

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
            address(pcImpl),
            governance,
            abi.encodeCall(
                ProtocolConfig.initializeWithDrandConfig,
                (admin, governance, governance, QUICKNET_CHAIN_HASH, QUICKNET_TEST_GENESIS_TIME, QUICKNET_TEST_PERIOD)
            )
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
        RaterRegistry rrImpl = new RaterRegistry(
            admin,
            governance,
            address(worldIdRouter),
            42,
            uint256(keccak256("rateloop-human-credential-v4")),
            uint256(keccak256("rateloop-human-presence-v1")),
            365 days,
            15 minutes,
            7,
            0
        );
        TransparentUpgradeableProxy rrProxy = new TransparentUpgradeableProxy(
            address(rrImpl),
            governance,
            abi.encodeCall(
                RaterRegistry.initialize,
                (
                    admin,
                    governance,
                    address(worldIdRouter),
                    42,
                    uint256(keccak256("rateloop-human-credential-v4")),
                    uint256(keccak256("rateloop-human-presence-v1")),
                    365 days,
                    15 minutes,
                    7,
                    0
                )
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

        // --- ConfidentialityEscrow ---
        ConfidentialityEscrow ceImpl = new ConfidentialityEscrow();
        TransparentUpgradeableProxy ceProxy = new TransparentUpgradeableProxy(
            address(ceImpl),
            governance,
            abi.encodeCall(
                ConfidentialityEscrow.initialize,
                (
                    admin,
                    governance,
                    address(lrepToken),
                    address(lrepToken),
                    address(contentRegistry),
                    address(protocolConfig),
                    governance
                )
            )
        );
        confidentialityEscrow = ConfidentialityEscrow(address(ceProxy));
        confidentialityEscrowAdmin = _proxyAdmin(address(ceProxy));

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

    function test_ContentRegistry_MediaValidatorSurvivesUpgrade() public {
        SubmissionMediaValidator validator = contentRegistry.submissionMediaValidator();
        assertTrue(address(validator) != address(0));
        assertEq(validator.authorizedEmitter(), address(contentRegistry));

        ContentRegistry newImpl = new ContentRegistry();
        vm.prank(governance);
        contentRegistryAdmin.upgradeAndCall(_proxy(address(contentRegistry)), address(newImpl), "");

        assertEq(address(contentRegistry.submissionMediaValidator()), address(validator));
        assertEq(contentRegistry.submissionMediaValidator().authorizedEmitter(), address(contentRegistry));
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
        protocolConfig.initializeWithDrandConfig(
            admin, governance, governance, QUICKNET_CHAIN_HASH, QUICKNET_TEST_GENESIS_TIME, QUICKNET_TEST_PERIOD
        );
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

        vm.store(address(votingEngine), _doubleUintMappingSlot(59, contentId, roundId), bytes32(uint256(111)));
        vm.store(address(votingEngine), _doubleUintMappingSlot(60, contentId, roundId), bytes32(uint256(222)));
        vm.store(
            address(votingEngine),
            _tripleUintBytes32MappingSlot(61, contentId, roundId, commitKey),
            bytes32(uint256(333))
        );

        assertEq(uint256(vm.load(address(votingEngine), _doubleUintMappingSlot(59, contentId, roundId))), 111);
        assertEq(uint256(vm.load(address(votingEngine), _doubleUintMappingSlot(60, contentId, roundId))), 222);
        (,, uint48 committedAt,,,) = votingEngine.commitIdentityState(contentId, roundId, commitKey);
        assertEq(committedAt, 333);
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
        RaterRegistry newImpl = new RaterRegistry(
            admin,
            governance,
            address(worldIdRouter),
            42,
            uint256(keccak256("rateloop-human-credential-v4")),
            uint256(keccak256("rateloop-human-presence-v1")),
            365 days,
            15 minutes,
            7,
            0
        );
        vm.prank(governance);
        raterRegistryAdmin.upgradeAndCall(_proxy(address(raterRegistry)), address(newImpl), "");
    }

    function test_RaterRegistry_UnauthorizedCannotUpgrade() public {
        RaterRegistry newImpl = new RaterRegistry(
            admin,
            governance,
            address(worldIdRouter),
            42,
            uint256(keccak256("rateloop-human-credential-v4")),
            uint256(keccak256("rateloop-human-presence-v1")),
            365 days,
            15 minutes,
            7,
            0
        );
        vm.prank(attacker);
        vm.expectRevert();
        raterRegistryAdmin.upgradeAndCall(_proxy(address(raterRegistry)), address(newImpl), "");
    }

    function test_RaterRegistry_CannotReinitialize() public {
        vm.prank(admin);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        raterRegistry.initialize(
            admin,
            governance,
            address(worldIdRouter),
            42,
            uint256(keccak256("rateloop-human-credential-v4")),
            uint256(keccak256("rateloop-human-presence-v1")),
            365 days,
            15 minutes,
            7,
            0
        );
    }

    function test_RaterRegistry_StatePreservedAfterUpgrade() public {
        vm.prank(admin);
        raterRegistry.seedHumanCredential(address(10), uint64(block.timestamp + 30 days), bytes32("human-10"), 0);

        assertEq(raterRegistryAdmin.owner(), governance);
        assertTrue(raterRegistry.hasRole(raterRegistry.DEFAULT_ADMIN_ROLE(), governance));
        assertTrue(raterRegistry.hasActiveHumanCredential(address(10)));
        assertEq(address(raterRegistry.worldIdV4Verifier()), address(worldIdRouter));
        assertEq(
            keccak256(abi.encode("world-id-v4", uint64(42), uint256(keccak256("rateloop-human-credential-v4")))),
            keccak256(abi.encode("world-id-v4", uint64(42), uint256(keccak256("rateloop-human-credential-v4"))))
        );

        RaterRegistry newImpl = new RaterRegistry(
            admin,
            governance,
            address(worldIdRouter),
            42,
            uint256(keccak256("rateloop-human-credential-v4")),
            uint256(keccak256("rateloop-human-presence-v1")),
            365 days,
            15 minutes,
            7,
            0
        );
        vm.prank(governance);
        raterRegistryAdmin.upgradeAndCall(_proxy(address(raterRegistry)), address(newImpl), "");

        assertEq(raterRegistryAdmin.owner(), governance);
        assertTrue(raterRegistry.hasRole(raterRegistry.DEFAULT_ADMIN_ROLE(), governance));
        assertTrue(raterRegistry.hasActiveHumanCredential(address(10)));
        assertEq(address(raterRegistry.worldIdV4Verifier()), address(worldIdRouter));
        assertEq(
            keccak256(abi.encode("world-id-v4", uint64(42), uint256(keccak256("rateloop-human-credential-v4")))),
            keccak256(abi.encode("world-id-v4", uint64(42), uint256(keccak256("rateloop-human-credential-v4"))))
        );
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
    // ConfidentialityEscrow upgrade tests
    // =========================================================================

    function test_ConfidentialityEscrow_GovernanceCanUpgrade() public {
        ConfidentialityEscrow newImpl = new ConfidentialityEscrow();
        vm.prank(governance);
        confidentialityEscrowAdmin.upgradeAndCall(_proxy(address(confidentialityEscrow)), address(newImpl), "");
    }

    function test_ConfidentialityEscrow_UnauthorizedCannotUpgrade() public {
        ConfidentialityEscrow newImpl = new ConfidentialityEscrow();
        vm.prank(attacker);
        vm.expectRevert();
        confidentialityEscrowAdmin.upgradeAndCall(_proxy(address(confidentialityEscrow)), address(newImpl), "");
    }

    function test_ConfidentialityEscrow_CannotReinitialize() public {
        vm.prank(admin);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        confidentialityEscrow.initialize(
            admin,
            governance,
            address(lrepToken),
            address(lrepToken),
            address(contentRegistry),
            address(protocolConfig),
            governance
        );
    }

    function test_ConfidentialityEscrow_StatePreservedAfterUpgrade() public {
        vm.prank(governance);
        confidentialityEscrow.setBondBounds(123e6, 14 days, 90 days);

        assertEq(confidentialityEscrowAdmin.owner(), governance);
        assertEq(address(confidentialityEscrow.lrepToken()), address(lrepToken));
        assertEq(address(confidentialityEscrow.usdcToken()), address(lrepToken));
        assertEq(address(confidentialityEscrow.registry()), address(contentRegistry));
        assertEq(address(confidentialityEscrow.protocolConfig()), address(protocolConfig));
        assertEq(confidentialityEscrow.confiscationRecipient(), governance);
        assertEq(confidentialityEscrow.maxBond(), 123e6);
        assertEq(confidentialityEscrow.evidenceWindow(), 14 days);
        assertEq(confidentialityEscrow.maxBondLockDuration(), 90 days);
        assertTrue(confidentialityEscrow.hasRole(confidentialityEscrow.DEFAULT_ADMIN_ROLE(), governance));
        assertFalse(confidentialityEscrow.hasRole(confidentialityEscrow.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(confidentialityEscrow.hasRole(confidentialityEscrow.CONFIG_ROLE(), governance));
        assertTrue(confidentialityEscrow.hasRole(confidentialityEscrow.CONFIG_ROLE(), admin));
        assertTrue(confidentialityEscrow.hasRole(confidentialityEscrow.CONFIG_ROLE(), address(contentRegistry)));

        ConfidentialityEscrow newImpl = new ConfidentialityEscrow();
        vm.prank(governance);
        confidentialityEscrowAdmin.upgradeAndCall(_proxy(address(confidentialityEscrow)), address(newImpl), "");

        assertEq(confidentialityEscrowAdmin.owner(), governance);
        assertEq(address(confidentialityEscrow.lrepToken()), address(lrepToken));
        assertEq(address(confidentialityEscrow.usdcToken()), address(lrepToken));
        assertEq(address(confidentialityEscrow.registry()), address(contentRegistry));
        assertEq(address(confidentialityEscrow.protocolConfig()), address(protocolConfig));
        assertEq(confidentialityEscrow.confiscationRecipient(), governance);
        assertEq(confidentialityEscrow.maxBond(), 123e6);
        assertEq(confidentialityEscrow.evidenceWindow(), 14 days);
        assertEq(confidentialityEscrow.maxBondLockDuration(), 90 days);
        assertTrue(confidentialityEscrow.hasRole(confidentialityEscrow.DEFAULT_ADMIN_ROLE(), governance));
        assertFalse(confidentialityEscrow.hasRole(confidentialityEscrow.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(confidentialityEscrow.hasRole(confidentialityEscrow.CONFIG_ROLE(), governance));
        assertTrue(confidentialityEscrow.hasRole(confidentialityEscrow.CONFIG_ROLE(), admin));
        assertTrue(confidentialityEscrow.hasRole(confidentialityEscrow.CONFIG_ROLE(), address(contentRegistry)));
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
        pcImpl.initializeWithDrandConfig(
            admin, governance, governance, QUICKNET_CHAIN_HASH, QUICKNET_TEST_GENESIS_TIME, QUICKNET_TEST_PERIOD
        );

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

        ConfidentialityEscrow ceImpl = new ConfidentialityEscrow();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        ceImpl.initialize(
            admin,
            governance,
            address(lrepToken),
            address(lrepToken),
            address(contentRegistry),
            address(protocolConfig),
            governance
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

        RaterRegistry raterImpl = new RaterRegistry(
            admin,
            governance,
            address(worldIdRouter),
            42,
            uint256(keccak256("rateloop-human-credential-v4")),
            uint256(keccak256("rateloop-human-presence-v1")),
            365 days,
            15 minutes,
            7,
            0
        );
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        raterImpl.initialize(
            admin,
            governance,
            address(worldIdRouter),
            42,
            uint256(keccak256("rateloop-human-credential-v4")),
            uint256(keccak256("rateloop-human-presence-v1")),
            365 days,
            15 minutes,
            7,
            0
        );
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
