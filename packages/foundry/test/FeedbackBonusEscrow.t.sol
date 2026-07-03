// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { VotingTestBase } from "./helpers/VotingTestHelpers.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { FeedbackBonusEscrow } from "../contracts/FeedbackBonusEscrow.sol";
import { FeedbackRegistry } from "../contracts/FeedbackRegistry.sol";
import { FrontendRegistry } from "../contracts/FrontendRegistry.sol";
import { IFrontendRegistry } from "../contracts/interfaces/IFrontendRegistry.sol";
import { IRaterIdentityRegistry } from "../contracts/interfaces/IRaterIdentityRegistry.sol";
import { MockCategoryRegistry } from "../contracts/mocks/MockCategoryRegistry.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { QuestionRewardPoolEscrow } from "../contracts/QuestionRewardPoolEscrow.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { RoundRewardDistributor } from "../contracts/RoundRewardDistributor.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { RoundEngineReadHelpers } from "./helpers/RoundEngineReadHelpers.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

contract SlashedFrontendRegistryMock is IFrontendRegistry {
    address public immutable frontend;

    constructor(address frontend_) {
        frontend = frontend_;
    }

    function STAKE_AMOUNT() external pure returns (uint256) {
        return 1;
    }

    function isEligible(address frontend_) external view returns (bool) {
        return frontend_ == frontend;
    }

    function authorizedSnapshotFrontend(address proposer) external view returns (address) {
        return proposer == frontend ? frontend : address(0);
    }

    function isAuthorizedSnapshotProposer(address frontend_, address proposer) external view returns (bool) {
        return frontend_ == frontend && proposer == frontend;
    }

    function snapshotProposerForFrontend(address) external pure returns (address proposer) {
        return address(0);
    }

    function authorizedAccessRecorderFrontend(address recorder) external view returns (address) {
        return recorder == frontend ? frontend : address(0);
    }

    function isAuthorizedAccessRecorder(address frontend_, address recorder) external view returns (bool) {
        return frontend_ == frontend && recorder == frontend;
    }

    function accessRecorderForFrontend(address) external pure returns (address recorder) {
        return address(0);
    }

    function creditFees(address, uint256) external { }

    function feeCreditorForEngine(address) external pure returns (address) {
        return address(0);
    }

    function getAccumulatedFees(address) external pure returns (uint256 lrepFees) {
        return 0;
    }

    function canReceiveHistoricalFees(address) external pure returns (bool) {
        return false;
    }

    function canClaimFeesForRound(address, uint48) external pure returns (bool) {
        return false;
    }

    function getFrontendInfo(address frontend_)
        external
        view
        returns (address operator, uint256 stakedAmount, bool eligible, bool slashed)
    {
        if (frontend_ == frontend) {
            return (frontend, 1, true, true);
        }
        return (address(0), 0, false, false);
    }
}

contract WeakFeedbackRaterRegistry {
    function addressIdentityKey(address account) external pure returns (bytes32) {
        if (account == address(0)) return bytes32(0);
        return bytes32(uint256(1));
    }
}

contract FeedbackRaterRegistryStatusMock {
    mapping(bytes32 => bool) internal banned;

    function setBanned(bytes32 identityKey, bool value) external {
        banned[identityKey] = value;
    }

    function isIdentityKeyBanned(bytes32 identityKey) external view returns (bool) {
        return banned[identityKey];
    }

    function addressIdentityKey(address account) external pure returns (bytes32) {
        if (account == address(0)) return bytes32(0);
        return keccak256(abi.encodePacked("rateloop.address-identity-v1", account));
    }

    function resolveRater(address actor) external pure returns (IRaterIdentityRegistry.ResolvedRater memory resolved) {
        resolved.holder = actor;
        resolved.identityKey =
            actor == address(0) ? bytes32(0) : keccak256(abi.encodePacked("rateloop.address-identity-v1", actor));
    }

    function hasActiveHumanCredential(address) external pure returns (bool) {
        return false;
    }

    function getHumanCredential(address) external pure returns (RaterRegistry.HumanCredential memory credential) {
        return credential;
    }
}

contract FeedbackRegistryNoVotingEngineShapeMock {
    function isAwardableFeedback(uint256, uint256, bytes32, bytes32) external pure returns (bool) {
        return false;
    }

    function awardableFeedbackPublishedAt(uint256, uint256, bytes32, bytes32) external pure returns (uint256) {
        return 0;
    }
}

contract FeedbackBonusEscrowTest is VotingTestBase {
    event FeedbackBonusFunderRefunded(uint256 indexed poolId, address indexed funder, uint256 amount);

    LoopReputation public lrepToken;
    ContentRegistry public registry;
    RoundVotingEngine public votingEngine;
    RoundRewardDistributor public rewardDistributor;
    FrontendRegistry public frontendRegistry;
    QuestionRewardPoolEscrow public questionRewardPoolEscrow;
    FeedbackBonusEscrow public feedbackBonusEscrow;
    FeedbackRegistry public feedbackRegistry;
    ProtocolConfig public protocolConfig;
    MockERC20 public usdc;
    RaterRegistry public raterRegistry;

    address public owner = address(1);
    address public submitter = address(2);
    uint256 internal constant FUNDER_KEY = 0xF00D;
    address public funder;
    address public voter1 = address(4);
    address public voter2 = address(5);
    address public voter3 = address(6);
    address public voter4 = address(7);
    address public delegate1 = address(8);
    address public frontend1 = address(9);
    address public treasury = address(100);
    address public feedbackGateway = address(0x402);

    uint256 public constant STAKE = 5e6;
    uint256 public constant EPOCH_DURATION = 10 minutes;
    uint256 public constant BONUS_AMOUNT = 100e6;
    bytes32 internal constant X402_GATEWAY_ROLE = keccak256("X402_GATEWAY_ROLE");
    bytes32 public FEEDBACK_HASH;

    string internal constant QUESTION = "Would you recommend this hotel?";
    string internal constant DESCRIPTION = "Vote based on the overall stay quality.";
    string internal constant TAGS = "travel";
    string internal constant DEFAULT_MEDIA_URL = "hotel-room";
    string internal constant FEEDBACK_TYPE = "evidence";
    string internal constant FEEDBACK_BODY = "Helpful feedback for the asker.";
    string internal constant FEEDBACK_SOURCE_URL = "https://example.com/feedback-source";
    bytes32 internal constant FEEDBACK_NONCE = keccak256("feedback nonce");
    uint256 internal constant CATEGORY_ID = 1;

    function _tlockDrandChainHash() internal pure override returns (bytes32) {
        return DEFAULT_DRAND_CHAIN_HASH;
    }

    function _tlockDrandGenesisTime() internal pure override returns (uint64) {
        return DEFAULT_DRAND_GENESIS_TIME;
    }

    function _tlockDrandPeriod() internal pure override returns (uint64) {
        return DEFAULT_DRAND_PERIOD;
    }

    function _tlockEpochDuration() internal pure override returns (uint256) {
        return EPOCH_DURATION;
    }

    function setUp() public {
        vm.warp(1000);
        vm.roll(100);
        funder = vm.addr(FUNDER_KEY);

        vm.startPrank(owner);

        lrepToken = new LoopReputation(owner, owner);
        lrepToken.grantRole(lrepToken.MINTER_ROLE(), owner);

        ContentRegistry registryImpl = new ContentRegistry();
        RoundVotingEngine engineImpl = new RoundVotingEngine();
        RoundRewardDistributor distImpl = new RoundRewardDistributor();
        FrontendRegistry frontendRegistryImpl = new FrontendRegistry();
        QuestionRewardPoolEscrow questionRewardPoolImpl = new QuestionRewardPoolEscrow();
        FeedbackBonusEscrow feedbackBonusImpl = new FeedbackBonusEscrow();
        FeedbackRegistry feedbackRegistryImpl = new FeedbackRegistry();

        protocolConfig = _deployProtocolConfig(owner);
        registry = ContentRegistry(
            address(
                new ERC1967Proxy(
                    address(registryImpl),
                    abi.encodeCall(ContentRegistry.initializeWithTreasury, (owner, owner, owner, address(lrepToken)))
                )
            )
        );
        votingEngine = RoundVotingEngine(
            address(
                new ERC1967Proxy(
                    address(engineImpl),
                    abi.encodeCall(
                        RoundVotingEngine.initialize,
                        (owner, address(lrepToken), address(registry), address(protocolConfig))
                    )
                )
            )
        );
        rewardDistributor = RoundRewardDistributor(
            address(
                new ERC1967Proxy(
                    address(distImpl),
                    abi.encodeCall(
                        RoundRewardDistributor.initialize,
                        (owner, address(lrepToken), address(votingEngine), address(registry))
                    )
                )
            )
        );

        usdc = new MockERC20("USD Coin", "USDC", 6);
        raterRegistry = _deployRaterRegistry(owner);
        frontendRegistry = FrontendRegistry(
            address(
                new ERC1967Proxy(
                    address(frontendRegistryImpl),
                    abi.encodeCall(FrontendRegistry.initialize, (owner, owner, address(lrepToken)))
                )
            )
        );
        questionRewardPoolEscrow = QuestionRewardPoolEscrow(
            address(
                new ERC1967Proxy(
                    address(questionRewardPoolImpl),
                    abi.encodeCall(
                        QuestionRewardPoolEscrow.initialize,
                        (
                            owner,
                            address(lrepToken),
                            address(usdc),
                            address(registry),
                            address(votingEngine),
                            address(raterRegistry)
                        )
                    )
                )
            )
        );
        feedbackRegistry = FeedbackRegistry(
            address(
                new ERC1967Proxy(
                    address(feedbackRegistryImpl),
                    abi.encodeCall(FeedbackRegistry.initialize, (owner, owner, address(votingEngine)))
                )
            )
        );
        FEEDBACK_HASH = _feedbackHash(1, 1, voter1);
        feedbackBonusEscrow = FeedbackBonusEscrow(
            address(
                new ERC1967Proxy(
                    address(feedbackBonusImpl),
                    abi.encodeCall(
                        FeedbackBonusEscrow.initialize,
                        (
                            owner,
                            address(lrepToken),
                            address(usdc),
                            address(registry),
                            address(votingEngine),
                            address(raterRegistry),
                            address(feedbackRegistry)
                        )
                    )
                )
            )
        );

        MockCategoryRegistry mockCategoryRegistry = new MockCategoryRegistry();
        mockCategoryRegistry.seedDefaultTestCategories();

        registry.setVotingEngine(address(votingEngine));
        registry.setProtocolConfig(address(protocolConfig));
        registry.setCategoryRegistry(address(mockCategoryRegistry));
        registry.setQuestionRewardPoolEscrow(address(questionRewardPoolEscrow));
        registry.grantRole(X402_GATEWAY_ROLE, feedbackGateway);

        frontendRegistry.setVotingEngine(address(votingEngine));

        protocolConfig.setRewardDistributor(address(rewardDistributor));
        protocolConfig.setCategoryRegistry(address(mockCategoryRegistry));
        protocolConfig.setFrontendRegistry(address(frontendRegistry));
        protocolConfig.setTreasury(treasury);
        protocolConfig.setRaterRegistry(address(raterRegistry));
        _setTlockDrandConfig(protocolConfig, DEFAULT_DRAND_CHAIN_HASH, DEFAULT_DRAND_GENESIS_TIME, DEFAULT_DRAND_PERIOD);
        _setTlockRoundConfig(protocolConfig, EPOCH_DURATION, EPOCH_DURATION, 3, 100);

        address[7] memory humans = [submitter, funder, voter1, voter2, voter3, voter4, frontend1];
        for (uint256 i = 0; i < humans.length; i++) {
            _seedRaterIdentity(raterRegistry, humans[i], bytes32(uint256(uint160(humans[i]))));
            lrepToken.mint(humans[i], 10_000e6);
            usdc.mint(humans[i], 1_000e6);
        }
        lrepToken.mint(delegate1, 10_000e6);
        usdc.mint(feedbackGateway, 10_000e6);

        vm.stopPrank();
    }

    function testCreateFeedbackBonusPoolRejectsStaleEscrowAfterEngineRotation() public {
        uint256 contentId = _submitQuestion("");
        RoundVotingEngine replacementEngine = _deployReplacementEngine();

        vm.startPrank(owner);
        registry.pause();
        registry.setVotingEngine(address(replacementEngine));
        registry.unpause();
        vm.stopPrank();

        vm.startPrank(feedbackGateway);
        usdc.approve(address(feedbackBonusEscrow), BONUS_AMOUNT);
        vm.expectRevert(FeedbackBonusEscrow.StaleEngine.selector);
        feedbackBonusEscrow.createFeedbackBonusPoolFromGateway(
            contentId, 1, BONUS_AMOUNT, block.timestamp + 7 days, funder, funder
        );
        vm.stopPrank();
    }

    function testExistingFeedbackBonusPoolCanAwardAfterRegistryEngineRotation() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);
        (uint256 roundId, bytes32[] memory commitKeys) =
            _settleRoundWithPublishedFeedback(_threeVoters(), contentId, _directions(true, true, false), address(0));
        RoundVotingEngine replacementEngine = _deployReplacementEngine();

        vm.startPrank(owner);
        registry.pause();
        registry.setVotingEngine(address(replacementEngine));
        registry.unpause();
        vm.stopPrank();

        assertEq(address(feedbackRegistry.votingEngine()), address(votingEngine));
        assertTrue(feedbackRegistry.isAwardableFeedback(contentId, roundId, commitKeys[0], FEEDBACK_HASH));

        vm.prank(funder);
        uint256 recipientAmount = feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, FEEDBACK_HASH, 10e6);

        assertEq(recipientAmount, 10e6);
        assertEq(usdc.balanceOf(voter1), 1_010e6);
    }

    function testExistingFeedbackBonusPoolUsesSnapshotAfterEscrowFeedbackRegistryRotation() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);
        (uint256 roundId, bytes32[] memory commitKeys) =
            _settleRoundWithPublishedFeedback(_threeVoters(), contentId, _directions(true, true, false), address(0));
        FeedbackRegistry replacementFeedbackRegistry = _deployFeedbackRegistry(address(votingEngine));

        vm.prank(owner);
        feedbackBonusEscrow.setFeedbackRegistry(address(replacementFeedbackRegistry));

        assertEq(feedbackBonusEscrow.feedbackRegistrySnapshot(poolId), address(feedbackRegistry));
        assertEq(address(feedbackBonusEscrow.feedbackRegistry()), address(replacementFeedbackRegistry));
        assertTrue(feedbackRegistry.isAwardableFeedback(contentId, roundId, commitKeys[0], FEEDBACK_HASH));
        assertFalse(replacementFeedbackRegistry.isAwardableFeedback(contentId, roundId, commitKeys[0], FEEDBACK_HASH));

        vm.prank(funder);
        uint256 recipientAmount = feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, FEEDBACK_HASH, 10e6);

        assertEq(recipientAmount, 10e6);
        assertEq(usdc.balanceOf(voter1), 1_010e6);
    }

    function testSetFeedbackRegistryRejectsMismatchedVotingEngineShape() public {
        RoundVotingEngine replacementEngine = _deployReplacementEngine();
        FeedbackRegistry mismatchedFeedbackRegistry = _deployFeedbackRegistry(address(replacementEngine));

        vm.prank(owner);
        vm.expectRevert("Invalid feedback registry");
        feedbackBonusEscrow.setFeedbackRegistry(address(mismatchedFeedbackRegistry));
    }

    function testSetFeedbackRegistryRejectsRegistryWithoutVotingEngineShape() public {
        FeedbackRegistryNoVotingEngineShapeMock fakeFeedbackRegistry = new FeedbackRegistryNoVotingEngineShapeMock();

        vm.prank(owner);
        vm.expectRevert("Invalid feedback registry");
        feedbackBonusEscrow.setFeedbackRegistry(address(fakeFeedbackRegistry));
    }

    function testReplacementFeedbackStackCanCreatePoolsAfterEngineRotation() public {
        RoundVotingEngine replacementEngine = _deployReplacementEngine();
        QuestionRewardPoolEscrow replacementQuestionEscrow = QuestionRewardPoolEscrow(
            address(
                new ERC1967Proxy(
                    address(new QuestionRewardPoolEscrow()),
                    abi.encodeCall(
                        QuestionRewardPoolEscrow.initialize,
                        (
                            owner,
                            address(lrepToken),
                            address(usdc),
                            address(registry),
                            address(replacementEngine),
                            address(raterRegistry)
                        )
                    )
                )
            )
        );
        FeedbackRegistry replacementFeedbackRegistry = FeedbackRegistry(
            address(
                new ERC1967Proxy(
                    address(new FeedbackRegistry()),
                    abi.encodeCall(FeedbackRegistry.initialize, (owner, owner, address(replacementEngine)))
                )
            )
        );
        FeedbackBonusEscrow replacementEscrow = FeedbackBonusEscrow(
            address(
                new ERC1967Proxy(
                    address(new FeedbackBonusEscrow()),
                    abi.encodeCall(
                        FeedbackBonusEscrow.initialize,
                        (
                            owner,
                            address(lrepToken),
                            address(usdc),
                            address(registry),
                            address(replacementEngine),
                            address(raterRegistry),
                            address(replacementFeedbackRegistry)
                        )
                    )
                )
            )
        );

        vm.startPrank(owner);
        registry.pause();
        registry.setVotingEngine(address(replacementEngine));
        registry.setQuestionRewardPoolEscrow(address(replacementQuestionEscrow));
        registry.unpause();
        vm.stopPrank();

        uint256 contentId = _submitQuestion("replacement-feedback-stack");
        uint256 replacementRoundId = RoundEngineReadHelpers.activeRoundId(replacementEngine, contentId);

        vm.startPrank(feedbackGateway);
        usdc.approve(address(replacementEscrow), BONUS_AMOUNT);
        uint256 poolId = replacementEscrow.createFeedbackBonusPoolFromGateway(
            contentId, replacementRoundId, BONUS_AMOUNT, block.timestamp + 7 days, funder, funder
        );
        vm.stopPrank();

        (uint64 storedId, uint64 storedContentId, uint64 storedRoundId,,,,,,,,,, uint256 fundedAmount,,,) =
            replacementEscrow.feedbackBonusPools(poolId);
        assertEq(storedId, poolId);
        assertEq(storedContentId, contentId);
        assertEq(storedRoundId, replacementRoundId);
        assertEq(fundedAmount, BONUS_AMOUNT);
        assertEq(address(replacementFeedbackRegistry.votingEngine()), address(replacementEngine));
    }

    function testCreateFeedbackBonusPoolFromGatewayFundsUsdcPool() public {
        uint256 contentId = _submitQuestion("gateway-feedback-bonus");
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        uint256 escrowBalanceBefore = usdc.balanceOf(address(feedbackBonusEscrow));
        uint256 gatewayBalanceBefore = usdc.balanceOf(feedbackGateway);

        vm.startPrank(feedbackGateway);
        usdc.approve(address(feedbackBonusEscrow), BONUS_AMOUNT);
        uint256 poolId = feedbackBonusEscrow.createFeedbackBonusPoolFromGateway(
            contentId, roundId, BONUS_AMOUNT, block.timestamp + EPOCH_DURATION, funder, funder
        );
        vm.stopPrank();

        (,,,, address storedFunder,,,,,,, uint256 fundedAmount,,,,) = feedbackBonusEscrow.feedbackBonusPools(poolId);
        assertEq(storedFunder, funder);
        assertEq(fundedAmount, BONUS_AMOUNT);
        assertEq(usdc.balanceOf(address(feedbackBonusEscrow)), escrowBalanceBefore + BONUS_AMOUNT);
        assertEq(usdc.balanceOf(feedbackGateway), gatewayBalanceBefore - BONUS_AMOUNT);
    }

    function testCreateFeedbackBonusPoolFromGatewayRequiresGatewayRole() public {
        uint256 contentId = _submitQuestion("gateway-feedback-bonus-role");
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);

        vm.startPrank(funder);
        usdc.approve(address(feedbackBonusEscrow), BONUS_AMOUNT);
        vm.expectRevert("Only gateway");
        feedbackBonusEscrow.createFeedbackBonusPoolFromGateway(
            contentId, roundId, BONUS_AMOUNT, block.timestamp + EPOCH_DURATION, funder, funder
        );
        vm.stopPrank();
    }

    function testCreateFeedbackBonusPoolFundsDefaultUsdcPoolFromFunder() public {
        uint256 contentId = _submitQuestion("wallet-feedback-bonus-usdc");
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        uint256 escrowBalanceBefore = usdc.balanceOf(address(feedbackBonusEscrow));
        uint256 funderBalanceBefore = usdc.balanceOf(funder);

        vm.startPrank(funder);
        usdc.approve(address(feedbackBonusEscrow), BONUS_AMOUNT);
        uint256 poolId = feedbackBonusEscrow.createFeedbackBonusPool(
            contentId, roundId, BONUS_AMOUNT, block.timestamp + EPOCH_DURATION, funder
        );
        vm.stopPrank();

        (,,,, address storedFunder,,,,,,, uint256 fundedAmount,,,, uint8 asset) =
            feedbackBonusEscrow.feedbackBonusPools(poolId);
        assertEq(storedFunder, funder);
        assertEq(fundedAmount, BONUS_AMOUNT);
        assertEq(asset, feedbackBonusEscrow.REWARD_ASSET_USDC());
        assertEq(usdc.balanceOf(address(feedbackBonusEscrow)), escrowBalanceBefore + BONUS_AMOUNT);
        assertEq(usdc.balanceOf(funder), funderBalanceBefore - BONUS_AMOUNT);
    }

    function testCreateFeedbackBonusPoolWithAssetFundsLrepPoolFromFunder() public {
        uint256 contentId = _submitQuestion("wallet-feedback-bonus-lrep");
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        uint256 escrowBalanceBefore = lrepToken.balanceOf(address(feedbackBonusEscrow));
        uint256 funderBalanceBefore = lrepToken.balanceOf(funder);
        uint8 lrepAsset = feedbackBonusEscrow.REWARD_ASSET_LREP();

        vm.startPrank(funder);
        lrepToken.approve(address(feedbackBonusEscrow), BONUS_AMOUNT);
        uint256 poolId = feedbackBonusEscrow.createFeedbackBonusPoolWithAsset(
            contentId, roundId, lrepAsset, BONUS_AMOUNT, block.timestamp + EPOCH_DURATION, funder
        );
        vm.stopPrank();

        (,,,, address storedFunder,,,,,,, uint256 fundedAmount,,,, uint8 asset) =
            feedbackBonusEscrow.feedbackBonusPools(poolId);
        assertEq(storedFunder, funder);
        assertEq(fundedAmount, BONUS_AMOUNT);
        assertEq(asset, lrepAsset);
        assertEq(lrepToken.balanceOf(address(feedbackBonusEscrow)), escrowBalanceBefore + BONUS_AMOUNT);
        assertEq(lrepToken.balanceOf(funder), funderBalanceBefore - BONUS_AMOUNT);
    }

    function testFeedbackPublishIsImmediatelyAwardableOnChain() public {
        uint256 contentId = _submitQuestion("");
        (, bytes32 commitKey) = _commitFeedbackVote(voter1, contentId, true, 0, address(0));
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        bytes32 feedbackHash = _feedbackHash(contentId, roundId, voter1);

        vm.prank(voter1);
        feedbackRegistry.publishFeedback(
            contentId, roundId, commitKey, FEEDBACK_TYPE, FEEDBACK_BODY, FEEDBACK_SOURCE_URL, FEEDBACK_NONCE
        );
        assertTrue(feedbackRegistry.isAwardableFeedback(contentId, roundId, commitKey, feedbackHash));
        assertEq(
            feedbackRegistry.awardableFeedbackPublishedAt(contentId, roundId, commitKey, feedbackHash), block.timestamp
        );
    }

    function testDelegateCanPublishFeedbackAfterDelegatedVote() public {
        uint256 contentId = _submitQuestion("delegate-feedback-publish");
        _setAcceptedDelegate(raterRegistry, voter1, delegate1);

        (, bytes32 commitKey) = _commitFeedbackVote(delegate1, contentId, true, 0, address(0));
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        bytes32 feedbackHash = _feedbackHash(contentId, roundId, delegate1);

        vm.prank(delegate1);
        feedbackRegistry.publishFeedback(
            contentId, roundId, commitKey, FEEDBACK_TYPE, FEEDBACK_BODY, FEEDBACK_SOURCE_URL, FEEDBACK_NONCE
        );
        assertTrue(feedbackRegistry.isAwardableFeedback(contentId, roundId, commitKey, feedbackHash));
    }

    function testPublishedFeedbackCanReceiveAwardAfterSettlement() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);
        (uint256 roundId, bytes32[] memory commitKeys) =
            _settleRoundWithPublishedFeedback(_threeVoters(), contentId, _directions(true, true, false), address(0));

        assertTrue(feedbackRegistry.isAwardableFeedback(contentId, roundId, commitKeys[0], FEEDBACK_HASH));
        vm.prank(funder);
        uint256 recipientAmount = feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, FEEDBACK_HASH, 10e6);
        assertEq(recipientAmount, 10e6);
        assertEq(usdc.balanceOf(voter1), 1_010e6);
    }

    function testAwardRejectsIdentityBannedInCurrentRegistryAfterPoolSnapshot() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);
        (uint256 settledRoundId, bytes32[] memory commitKeys) =
            _settleRoundWithPublishedFeedback(_threeVoters(), contentId, _directions(true, true, false), address(0));

        (bytes32 awardIdentityKey,,,,,) = votingEngine.commitIdentityState(contentId, settledRoundId, commitKeys[0]);
        if (awardIdentityKey == bytes32(0)) {
            awardIdentityKey = raterRegistry.resolveRater(voter1).identityKey;
        }
        assertTrue(awardIdentityKey != bytes32(0));
        FeedbackRaterRegistryStatusMock replacementRegistry = new FeedbackRaterRegistryStatusMock();
        replacementRegistry.setBanned(awardIdentityKey, true);
        bytes32 feedbackHash = _feedbackHash(contentId, settledRoundId, voter1);

        vm.prank(owner);
        feedbackBonusEscrow.setRaterRegistry(address(replacementRegistry));
        assertEq(address(feedbackBonusEscrow.raterRegistry()), address(replacementRegistry));
        (,,,,,,,,,, address snapshotRegistry,,,,,) = feedbackBonusEscrow.feedbackBonusPools(poolId);
        assertTrue(snapshotRegistry != address(replacementRegistry));
        assertTrue(replacementRegistry.isIdentityKeyBanned(awardIdentityKey));

        vm.prank(funder);
        vm.expectRevert("Identity banned");
        feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, feedbackHash, 10e6);
    }

    function testRoundRegistrySnapshotIsAnchoredAtQuestionCreationAfterProtocolRotation() public {
        uint256 contentId = _submitQuestion("round-snapshot-feedback-ban");
        uint256 poolId = _createFeedbackBonusPool(contentId);

        FeedbackRaterRegistryStatusMock replacementRegistry = new FeedbackRaterRegistryStatusMock();
        vm.prank(owner);
        protocolConfig.setRaterRegistry(address(replacementRegistry));

        (uint256 settledRoundId, bytes32[] memory commitKeys) =
            _settleRoundWithPublishedFeedback(_threeVoters(), contentId, _directions(true, true, false), address(0));

        assertEq(votingEngine.roundRaterRegistrySnapshot(contentId, settledRoundId), address(raterRegistry));
        assertEq(address(feedbackBonusEscrow.raterRegistry()), address(raterRegistry));
        (,,,,,,,,,, address poolSnapshotRegistry,,,,,) = feedbackBonusEscrow.feedbackBonusPools(poolId);
        assertEq(poolSnapshotRegistry, address(raterRegistry));

        (bytes32 awardIdentityKey,,,,,) = votingEngine.commitIdentityState(contentId, settledRoundId, commitKeys[0]);
        assertTrue(awardIdentityKey != bytes32(0));
        replacementRegistry.setBanned(awardIdentityKey, true);
        bytes32 feedbackHash = _feedbackHash(contentId, settledRoundId, voter1);

        vm.prank(funder);
        uint256 recipientAmount = feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, feedbackHash, 10e6);
        assertEq(recipientAmount, 10e6);
    }

    function testAwardRejectsCommittedHolderAddressBannedInCurrentRegistry() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);

        _setAcceptedDelegate(raterRegistry, voter1, delegate1);

        address[] memory voters = new address[](3);
        voters[0] = delegate1;
        voters[1] = voter2;
        voters[2] = voter3;
        (uint256 settledRoundId, bytes32[] memory commitKeys) =
            _settleRoundWithPublishedFeedback(voters, contentId, _directions(true, true, false), address(0));

        (, address committedHolder,,,,) = votingEngine.commitIdentityState(contentId, settledRoundId, commitKeys[0]);
        assertEq(committedHolder, voter1);

        FeedbackRaterRegistryStatusMock replacementRegistry = new FeedbackRaterRegistryStatusMock();
        replacementRegistry.setBanned(replacementRegistry.addressIdentityKey(committedHolder), true);

        vm.prank(owner);
        feedbackBonusEscrow.setRaterRegistry(address(replacementRegistry));

        bytes32 delegateFeedbackHash = _feedbackHash(contentId, settledRoundId, delegate1);
        vm.prank(funder);
        vm.expectRevert("Identity banned");
        feedbackBonusEscrow.awardFeedbackBonus(poolId, delegate1, delegateFeedbackHash, 10e6);
    }

    function testAwardRejectsFeedbackPublishedAfterRequestedClose() public {
        uint256 contentId = _submitQuestion("");
        uint256 requestedDeadline = block.timestamp + 100;
        uint256 poolId = _createFeedbackBonusPoolWithDeadline(contentId, requestedDeadline);
        (bytes32 salt1, bytes32 commitKey1) = _commitFeedbackVote(voter1, contentId, true, 0, address(0));
        (bytes32 salt2, bytes32 commitKey2) = _commitFeedbackVote(voter2, contentId, true, 1, address(0));
        (bytes32 salt3, bytes32 commitKey3) = _commitFeedbackVote(voter3, contentId, false, 2, address(0));
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        bytes32 feedbackHash = _feedbackHash(contentId, roundId, voter1);

        vm.warp(block.timestamp + 101);
        vm.prank(voter1);
        feedbackRegistry.publishFeedback(
            contentId, roundId, commitKey1, FEEDBACK_TYPE, FEEDBACK_BODY, FEEDBACK_SOURCE_URL, FEEDBACK_NONCE
        );
        assertTrue(feedbackRegistry.isAwardableFeedback(contentId, roundId, commitKey1, feedbackHash));

        _warpPastTlockRevealTime(
            uint256(RoundEngineReadHelpers.round(votingEngine, contentId, roundId).startTime) + EPOCH_DURATION
        );
        votingEngine.revealVoteByCommitKey(contentId, roundId, commitKey1, true, 5_000, salt1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, commitKey2, true, 5_000, salt2);
        votingEngine.revealVoteByCommitKey(contentId, roundId, commitKey3, false, 5_000, salt3);
        _settleAfterRbtsSeed(votingEngine, contentId, roundId);

        vm.prank(funder);
        vm.expectRevert("Feedback not timely");
        feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, feedbackHash, 10e6);
    }

    function testPublishFeedbackRejectsAfterRoundLeavesOpenState() public {
        uint256 contentId = _submitQuestion("");
        (bytes32 salt, bytes32 commitKey) = _commitFeedbackVote(voter1, contentId, true, 0, address(0));
        (bytes32 salt2, bytes32 commitKey2) = _commitFeedbackVote(voter2, contentId, true, 1, address(0));
        (bytes32 salt3, bytes32 commitKey3) = _commitFeedbackVote(voter3, contentId, false, 2, address(0));
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        _warpPastTlockRevealTime(block.timestamp + EPOCH_DURATION);
        votingEngine.revealVoteByCommitKey(contentId, roundId, commitKey, true, 5_000, salt);
        votingEngine.revealVoteByCommitKey(contentId, roundId, commitKey2, true, 5_000, salt2);
        votingEngine.revealVoteByCommitKey(contentId, roundId, commitKey3, false, 5_000, salt3);
        _settleAfterRbtsSeed(votingEngine, contentId, roundId);

        vm.prank(voter1);
        vm.expectRevert("Round not open");
        feedbackRegistry.publishFeedback(
            contentId, roundId, commitKey, FEEDBACK_TYPE, FEEDBACK_BODY, FEEDBACK_SOURCE_URL, FEEDBACK_NONCE
        );
    }

    function testPublishFeedbackRejectsNonAuthor() public {
        uint256 contentId = _submitQuestion("");
        (, bytes32 commitKey) = _commitFeedbackVote(voter1, contentId, true, 0, address(0));
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);

        vm.prank(address(0xBEEF));
        vm.expectRevert("Only commit voter");
        feedbackRegistry.publishFeedback(
            contentId, roundId, commitKey, FEEDBACK_TYPE, FEEDBACK_BODY, FEEDBACK_SOURCE_URL, FEEDBACK_NONCE
        );
    }

    function testPublishFeedbackRejectsDuplicatePublish() public {
        uint256 contentId = _submitQuestion("");
        (, bytes32 commitKey) = _commitFeedbackVote(voter1, contentId, true, 0, address(0));
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);

        vm.prank(voter1);
        feedbackRegistry.publishFeedback(
            contentId, roundId, commitKey, FEEDBACK_TYPE, FEEDBACK_BODY, FEEDBACK_SOURCE_URL, FEEDBACK_NONCE
        );

        vm.prank(voter1);
        vm.expectRevert("Feedback already published");
        feedbackRegistry.publishFeedback(
            contentId, roundId, commitKey, FEEDBACK_TYPE, FEEDBACK_BODY, FEEDBACK_SOURCE_URL, FEEDBACK_NONCE
        );
    }

    function testPublishFeedbackRejectsCancelledRound() public {
        uint256 contentId = _submitQuestion("");
        (bytes32 salt, bytes32 commitKey) = _commitFeedbackVote(voter1, contentId, true, 0, address(0));
        salt;
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);

        vm.warp(block.timestamp + 7 days + 1);
        votingEngine.cancelExpiredRound(contentId, roundId);

        vm.prank(voter1);
        vm.expectRevert("Round not open");
        feedbackRegistry.publishFeedback(
            contentId, roundId, commitKey, FEEDBACK_TYPE, FEEDBACK_BODY, FEEDBACK_SOURCE_URL, FEEDBACK_NONCE
        );
    }

    function testAwardPaysRevealedVoterAndVoteAttributedFrontend() public {
        _registerFrontend(frontend1);
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);
        uint256 roundId = _settleRoundWithFrontend(_threeVoters(), contentId, _directions(true, true, false), frontend1);

        vm.prank(funder);
        uint256 recipientAmount = feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, FEEDBACK_HASH, 10e6);

        assertEq(roundId, 1);
        assertEq(recipientAmount, 9_700_000);
        assertEq(usdc.balanceOf(voter1), 1_009_700_000);
        assertEq(usdc.balanceOf(frontend1), 1_000_300_000);
        (,,,,,,,,,,,, uint256 remainingAmount,,,) = feedbackBonusEscrow.feedbackBonusPools(poolId);
        assertEq(remainingAmount, 90e6);
    }

    function testAwardDeadlineExtendsToOneHourAfterSettlement() public {
        uint256 contentId = _submitQuestion("");
        uint256 requestedDeadline = block.timestamp + 1;
        uint256 poolId = _createFeedbackBonusPoolWithDeadline(contentId, requestedDeadline);
        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        (,,,,,, uint48 settledAt,) = votingEngine.roundCore(contentId, roundId);

        assertGt(block.timestamp, requestedDeadline);
        assertEq(
            feedbackBonusEscrow.feedbackBonusAwardDeadline(poolId),
            uint256(settledAt) + feedbackBonusEscrow.MIN_FEEDBACK_AWARD_DECISION_SECONDS()
        );

        vm.prank(funder);
        uint256 recipientAmount = feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, FEEDBACK_HASH, 10e6);

        assertEq(recipientAmount, 10e6);
        assertEq(usdc.balanceOf(voter1), 1_010e6);
    }

    function testSettlementPendingFeedbackBonusCannotForfeitBeforeRbtsSettlement() public {
        uint256 contentId = _submitQuestion("");
        uint256 requestedDeadline = block.timestamp + 1;
        uint256 poolId = _createFeedbackBonusPoolWithDeadline(contentId, requestedDeadline);
        uint256 roundId = _moveRoundToSettlementPendingWithPublishedFeedback(
            _threeVoters(), contentId, _directions(true, true, false)
        );
        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);

        assertGt(block.timestamp, requestedDeadline);
        assertEq(feedbackBonusEscrow.feedbackBonusAwardDeadline(poolId), type(uint256).max);

        vm.prank(funder);
        vm.expectRevert("Round not settled");
        feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, FEEDBACK_HASH, 10e6);

        vm.expectRevert("Not expired");
        feedbackBonusEscrow.forfeitExpiredFeedbackBonus(poolId);

        _applyIdentityRbtsSettlementSnapshot(votingEngine, contentId, roundId, round.revealedCount);
        (,,,,,, uint48 settledAt,) = votingEngine.roundCore(contentId, roundId);
        uint256 awardDeadline = uint256(settledAt) + feedbackBonusEscrow.MIN_FEEDBACK_AWARD_DECISION_SECONDS();
        assertEq(feedbackBonusEscrow.feedbackBonusAwardDeadline(poolId), awardDeadline);

        vm.warp(awardDeadline);
        vm.prank(funder);
        assertEq(feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, FEEDBACK_HASH, 10e6), 10e6);

        vm.warp(awardDeadline + 1);
        uint256 treasuryBalanceBefore = usdc.balanceOf(treasury);
        uint256 forfeitedAmount = feedbackBonusEscrow.forfeitExpiredFeedbackBonus(poolId);
        assertEq(forfeitedAmount, 90e6);
        assertEq(usdc.balanceOf(treasury), treasuryBalanceBefore + 90e6);
    }

    function testAwardRejectsAfterMinimumDecisionWindowAndForfeits() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPoolWithDeadline(contentId, block.timestamp + 1);
        _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        uint256 awardDeadline = feedbackBonusEscrow.feedbackBonusAwardDeadline(poolId);

        vm.warp(awardDeadline + 1);

        vm.prank(funder);
        vm.expectRevert("Feedback closed");
        feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, FEEDBACK_HASH, 10e6);

        uint256 treasuryBalanceBefore = usdc.balanceOf(treasury);
        uint256 forfeitedAmount = feedbackBonusEscrow.forfeitExpiredFeedbackBonus(poolId);

        assertEq(forfeitedAmount, BONUS_AMOUNT);
        assertEq(usdc.balanceOf(treasury), treasuryBalanceBefore + BONUS_AMOUNT);
    }

    function testExpiredCancelledRoundBonusRefundsFunder() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPoolWithDeadline(contentId, block.timestamp + 7 days);
        (bytes32 salt,) = _commitFeedbackVote(voter1, contentId, true, 0, address(0));
        salt;
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);

        vm.warp(block.timestamp + 7 days + 1);
        votingEngine.cancelExpiredRound(contentId, roundId);

        uint256 funderBalanceBefore = usdc.balanceOf(funder);
        uint256 treasuryBalanceBefore = usdc.balanceOf(treasury);
        vm.expectEmit(true, true, false, true);
        emit FeedbackBonusFunderRefunded(poolId, funder, BONUS_AMOUNT);
        uint256 refundedAmount = feedbackBonusEscrow.forfeitExpiredFeedbackBonus(poolId);

        assertEq(refundedAmount, BONUS_AMOUNT);
        assertEq(usdc.balanceOf(funder), funderBalanceBefore + BONUS_AMOUNT);
        assertEq(usdc.balanceOf(treasury), treasuryBalanceBefore);
    }

    function testLongerRequestedAwardDeadlineWinsOverMinimumDecisionWindow() public {
        uint256 contentId = _submitQuestion("");
        uint256 requestedDeadline = block.timestamp + 7 days;
        uint256 poolId = _createFeedbackBonusPoolWithDeadline(contentId, requestedDeadline);
        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        (,,,,,, uint48 settledAt,) = votingEngine.roundCore(contentId, roundId);
        uint256 minimumDecisionDeadline = uint256(settledAt) + feedbackBonusEscrow.MIN_FEEDBACK_AWARD_DECISION_SECONDS();

        assertGt(requestedDeadline, minimumDecisionDeadline);
        assertEq(feedbackBonusEscrow.feedbackBonusAwardDeadline(poolId), requestedDeadline);

        vm.warp(minimumDecisionDeadline + 1);
        vm.prank(funder);
        uint256 recipientAmount = feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, FEEDBACK_HASH, 10e6);

        assertEq(recipientAmount, 10e6);
    }

    function testOpenUncommittedRoundFeedbackBonusCannotForfeitBeforeTerminal() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPoolWithDeadline(contentId, block.timestamp + 1);

        vm.warp(block.timestamp + 2);
        vm.expectRevert("Not expired");
        feedbackBonusEscrow.forfeitExpiredFeedbackBonus(poolId);
    }

    function testStartedOpenRoundFeedbackBonusCannotForfeitBeforeTerminalDeadline() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPoolWithDeadline(contentId, block.timestamp + 1);
        _commitFeedbackVote(voter1, contentId, true, 0, address(0));

        vm.warp(block.timestamp + 2);
        vm.expectRevert("Not expired");
        feedbackBonusEscrow.forfeitExpiredFeedbackBonus(poolId);
    }

    function testRecoverNonAssetTokenRejectsLrepAndUsdc() public {
        vm.startPrank(owner);
        vm.expectRevert("Cannot recover protocol asset");
        feedbackBonusEscrow.recoverNonAssetToken(lrepToken, owner, 1);
        vm.expectRevert("Cannot recover protocol asset");
        feedbackBonusEscrow.recoverNonAssetToken(usdc, owner, 1);
        vm.stopPrank();
    }

    function testAwardFrontendTransferFailureFallsBackToVoter() public {
        _registerFrontend(frontend1);
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);
        _settleRoundWithFrontend(_threeVoters(), contentId, _directions(true, true, false), frontend1);

        usdc.setBlockedRecipient(frontend1, true);

        uint256 voterBalanceBefore = usdc.balanceOf(voter1);
        uint256 frontendBalanceBefore = usdc.balanceOf(frontend1);

        vm.prank(funder);
        uint256 recipientAmount = feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, FEEDBACK_HASH, 10e6);

        assertEq(recipientAmount, 10e6);
        assertEq(usdc.balanceOf(voter1), voterBalanceBefore + 10e6);
        assertEq(usdc.balanceOf(frontend1), frontendBalanceBefore);
    }

    function testAwardUsesOriginalCommitKeyForFrontendFee() public {
        _registerFrontend(frontend1);
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);
        _settleRoundWithFrontend(_threeVoters(), contentId, _directions(true, true, false), frontend1);

        vm.prank(funder);
        uint256 recipientAmount = feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, FEEDBACK_HASH, 10e6);

        assertEq(recipientAmount, 9_700_000);
        assertEq(usdc.balanceOf(voter1), 1_009_700_000);
        assertEq(usdc.balanceOf(frontend1), 1_000_300_000);
    }

    /// @dev A frontend in unbonding cannot collect feedback-bonus frontend fees on a round it
    ///      serviced before requesting deregistration — the unbonding window is the slashing
    ///      review period and `canReceiveHistoricalFees` must mirror the main `claimFees`
    ///      path's exit-pending guard. The fee carve-out falls back to the voter.
    function testAwardDoesNotPayExitPendingHistoricalFrontend() public {
        _registerFrontend(frontend1);
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);
        uint256 roundId = _settleRoundWithFrontend(_threeVoters(), contentId, _directions(true, true, false), frontend1);

        vm.prank(frontend1);
        frontendRegistry.requestDeregister();

        vm.prank(funder);
        uint256 recipientAmount = feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, FEEDBACK_HASH, 10e6);

        assertEq(roundId, 1);
        assertEq(recipientAmount, 10e6);
        assertEq(usdc.balanceOf(voter1), 1_010e6);
        assertEq(usdc.balanceOf(frontend1), 1_000e6);
    }

    function testAwardFallsBackToVoterWhenFrontendWasNotEligibleAtCommit() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);
        _settleRoundWithFrontend(_threeVoters(), contentId, _directions(true, true, false), frontend1);
        _registerFrontend(frontend1);

        vm.prank(funder);
        uint256 recipientAmount = feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, FEEDBACK_HASH, 10e6);

        assertEq(recipientAmount, 10e6);
        assertEq(usdc.balanceOf(voter1), 1_010e6);
        assertEq(usdc.balanceOf(frontend1), 1_000e6);
    }

    function testAwardFallsBackToVoterWhenSnapshotFrontendIsSlashed() public {
        SlashedFrontendRegistryMock slashedFrontendRegistry = new SlashedFrontendRegistryMock(frontend1);
        vm.prank(owner);
        protocolConfig.setFrontendRegistry(address(slashedFrontendRegistry));

        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);
        _settleRoundWithFrontend(_threeVoters(), contentId, _directions(true, true, false), frontend1);

        vm.prank(funder);
        uint256 recipientAmount = feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, FEEDBACK_HASH, 10e6);

        assertEq(recipientAmount, 10e6);
        assertEq(usdc.balanceOf(voter1), 1_010e6);
        assertEq(usdc.balanceOf(frontend1), 1_000e6);
    }

    function testFunderCannotReceiveFeedbackBonus() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);

        address[] memory voters = new address[](4);
        voters[0] = funder;
        voters[1] = voter1;
        voters[2] = voter2;
        voters[3] = voter3;
        _settleRoundWith(voters, contentId, _directions(true, true, true, false));

        vm.prank(funder);
        vm.expectRevert("Excluded rater");
        feedbackBonusEscrow.awardFeedbackBonus(poolId, funder, FEEDBACK_HASH, 10e6);
    }

    function testFunderIdentityCannotReceiveFeedbackBonusAfterRebind() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);

        bytes32 anchor = bytes32(uint256(uint160(funder)));
        vm.startPrank(owner);
        raterRegistry.revokeHumanCredential(funder);
        raterRegistry.clearRevokedHumanNullifier(RaterRegistry.HumanCredentialProvider.SeededHuman, anchor);
        _seedRaterIdentity(raterRegistry, voter1, anchor);
        // M-Identity-2: re-seeding no longer silently rotates the canonical identity key.
        // Governance must explicitly rotate voter1 onto the new anchor for the funder/voter1
        // identity collision to materialize on-chain.
        raterRegistry.rotateCanonicalIdentityKey(voter1);
        vm.stopPrank();

        _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));

        vm.prank(funder);
        vm.expectRevert("Excluded rater");
        feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, FEEDBACK_HASH, 10e6);
    }

    function testSubmitterIdentityCannotReceiveFeedbackBonusAfterRebind() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);

        bytes32 anchor = bytes32(uint256(uint160(submitter)));
        vm.startPrank(owner);
        raterRegistry.revokeHumanCredential(submitter);
        raterRegistry.clearRevokedHumanNullifier(RaterRegistry.HumanCredentialProvider.SeededHuman, anchor);
        _seedRaterIdentity(raterRegistry, voter1, anchor);
        // M-Identity-2: re-seeding no longer silently rotates the canonical identity key.
        // Governance must explicitly rotate voter1 onto the new anchor for the submitter/voter1
        // identity collision to materialize on-chain.
        raterRegistry.rotateCanonicalIdentityKey(voter1);
        vm.stopPrank();

        _expectSelfVoteCommitRevert(voter1, contentId, keccak256("feedback-reminted-submitter"));

        address[] memory voters = new address[](3);
        voters[0] = voter2;
        voters[1] = voter3;
        voters[2] = voter4;
        _settleRoundWith(voters, contentId, _directions(true, true, false));

        vm.prank(funder);
        vm.expectRevert("Excluded rater");
        feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, FEEDBACK_HASH, 10e6);
    }

    function testRaterRegistryRejectsZeroAfterInitialWiring() public {
        vm.prank(owner);
        vm.expectRevert(ProtocolConfig.InvalidAddress.selector);
        protocolConfig.setRaterRegistry(address(0));
    }

    function testSetRaterRegistryRejectsZero() public {
        vm.prank(owner);
        vm.expectRevert("Invalid registry");
        feedbackBonusEscrow.setRaterRegistry(address(0));
    }

    function testSetRaterRegistryRejectsWeakAbiShape() public {
        WeakFeedbackRaterRegistry weakRegistry = new WeakFeedbackRaterRegistry();

        vm.prank(owner);
        vm.expectRevert("Invalid registry");
        feedbackBonusEscrow.setRaterRegistry(address(weakRegistry));
    }

    function testSetRaterRegistryRejectsInvalidBanStatus() public {
        FeedbackRaterRegistryStatusMock invalidRegistry = new FeedbackRaterRegistryStatusMock();
        invalidRegistry.setBanned(bytes32(0), true);

        vm.prank(owner);
        vm.expectRevert("Invalid registry");
        feedbackBonusEscrow.setRaterRegistry(address(invalidRegistry));
    }

    function testAwardRequiresRevealedVote() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);
        _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));

        vm.prank(funder);
        vm.expectRevert("No commit");
        feedbackBonusEscrow.awardFeedbackBonus(poolId, voter4, FEEDBACK_HASH, 10e6);
    }

    function testAwardRejectsPostSettlementClosureReveal() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);
        address[] memory voters = _fourVoters();
        bool[] memory directions = _directions(true, true, false, false);
        uint256 roundId = _settleRoundWith(voters, contentId, directions);

        vm.warp(block.timestamp + 24 hours + 1);
        (, bytes32 laterCommitKey) = _commitFeedbackVote(voter4, contentId, false, 4, address(0));
        uint256 laterRoundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        assertGt(laterRoundId, roundId);

        bytes32 voter1FeedbackHash = _feedbackHash(contentId, roundId, voter1);
        bytes32 voter4FeedbackHash = _feedbackHash(contentId, laterRoundId, voter4);
        vm.prank(voter4);
        feedbackRegistry.publishFeedback(
            contentId, laterRoundId, laterCommitKey, FEEDBACK_TYPE, FEEDBACK_BODY, FEEDBACK_SOURCE_URL, FEEDBACK_NONCE
        );

        vm.prank(funder);
        vm.expectRevert("Feedback not revealed");
        feedbackBonusEscrow.awardFeedbackBonus(poolId, voter4, voter4FeedbackHash, 10e6);

        vm.prank(funder);
        uint256 recipientAmount = feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, voter1FeedbackHash, 10e6);
        assertEq(recipientAmount, 10e6);
    }

    function testAwardUnverifiedRecipientUsesDirectCommitKey() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);

        vm.prank(owner);
        raterRegistry.revokeHumanCredential(voter1);
        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        bytes32 commitHash = _voterCommitHash(votingEngine, contentId, roundId, voter1);
        bytes32 commitKey = _commitKey(voter1, commitHash);
        (address committedVoter,,,, bool revealed,,) = votingEngine.commitCore(contentId, roundId, commitKey);

        assertEq(committedVoter, voter1);
        assertTrue(revealed);

        uint256 voterBalanceBefore = usdc.balanceOf(voter1);

        vm.prank(funder);
        uint256 recipientAmount = feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, FEEDBACK_HASH, 10e6);

        assertEq(recipientAmount, 10e6);
        assertEq(usdc.balanceOf(voter1), voterBalanceBefore + recipientAmount);
    }

    function testAwardRejectsNewDelegateForHistoricalCommit() public {
        address newDelegate = address(0xD1E);
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);

        _setAcceptedDelegate(raterRegistry, voter1, delegate1);

        address[] memory voters = new address[](3);
        voters[0] = delegate1;
        voters[1] = voter2;
        voters[2] = voter3;
        _settleRoundWith(voters, contentId, _directions(true, true, false));

        vm.prank(voter1);
        raterRegistry.removeDelegate();
        _setAcceptedDelegate(raterRegistry, voter1, newDelegate);

        vm.prank(funder);
        vm.expectRevert("No commit");
        feedbackBonusEscrow.awardFeedbackBonus(poolId, newDelegate, FEEDBACK_HASH, 10e6);
    }

    function testAwardPaysCommittedHolderWhenOriginalDelegateIsRecipient() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);

        _setAcceptedDelegate(raterRegistry, voter1, delegate1);

        address[] memory voters = new address[](3);
        voters[0] = delegate1;
        voters[1] = voter2;
        voters[2] = voter3;
        _settleRoundWith(voters, contentId, _directions(true, true, false));

        vm.prank(voter1);
        raterRegistry.removeDelegate();

        uint256 holderBalanceBefore = usdc.balanceOf(voter1);
        uint256 delegateBalanceBefore = usdc.balanceOf(delegate1);
        bytes32 delegateFeedbackHash = _feedbackHash(contentId, 1, delegate1);

        vm.prank(funder);
        uint256 recipientAmount = feedbackBonusEscrow.awardFeedbackBonus(poolId, delegate1, delegateFeedbackHash, 10e6);

        assertEq(recipientAmount, 10e6);
        assertEq(usdc.balanceOf(voter1), holderBalanceBefore + recipientAmount);
        assertEq(usdc.balanceOf(delegate1), delegateBalanceBefore);
    }

    function testAwardUsesCommittedHolderAfterIdentityKeyRotation() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);

        _setAcceptedDelegate(raterRegistry, voter1, delegate1);

        address[] memory voters = new address[](3);
        voters[0] = delegate1;
        voters[1] = voter2;
        voters[2] = voter3;
        uint256 roundId = _settleRoundWith(voters, contentId, _directions(true, true, false));
        assertTrue(_holderCommitKey(votingEngine, contentId, roundId, voter1) != bytes32(0));

        bytes32 oldAnchor = bytes32(uint256(uint160(voter1)));
        vm.startPrank(owner);
        raterRegistry.revokeHumanCredential(voter1);
        raterRegistry.clearRevokedHumanNullifier(RaterRegistry.HumanCredentialProvider.SeededHuman, oldAnchor);
        _seedRaterIdentity(raterRegistry, voter1, keccak256("voter1-rotated-anchor"));
        vm.stopPrank();

        uint256 holderBalanceBefore = usdc.balanceOf(voter1);
        bytes32 delegateFeedbackHash = _feedbackHash(contentId, roundId, delegate1);

        vm.prank(funder);
        uint256 recipientAmount = feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, delegateFeedbackHash, 10e6);

        assertEq(recipientAmount, 10e6);
        assertEq(usdc.balanceOf(voter1), holderBalanceBefore + recipientAmount);
    }

    function testCreateFeedbackBonusPoolAllowsFunderWithoutHumanCredential() public {
        uint256 contentId = _submitQuestion("");
        address unverifiedFunder = address(0xB0B);

        uint256 poolId = _createFeedbackBonusPoolForFunder(contentId, unverifiedFunder);

        assertGt(poolId, 0);
        (,,,,, address funderIdentity,,,,,,,,,,) = feedbackBonusEscrow.feedbackBonusPools(poolId);
        assertEq(funderIdentity, unverifiedFunder);
    }

    function testCannotAwardSameVoterOrFeedbackHashTwice() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);
        _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));

        vm.startPrank(funder);
        feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, FEEDBACK_HASH, 10e6);
        vm.expectRevert("Rater already awarded");
        feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, keccak256("second-feedback"), 10e6);
        vm.expectRevert("Feedback already awarded");
        feedbackBonusEscrow.awardFeedbackBonus(poolId, voter2, FEEDBACK_HASH, 10e6);
        vm.stopPrank();
    }

    function testCannotAwardSameCommittedIdentityAfterRebind() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);
        _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));

        vm.startPrank(funder);
        feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, FEEDBACK_HASH, 10e6);
        vm.stopPrank();

        bytes32 anchor = bytes32(uint256(uint160(voter1)));
        vm.startPrank(owner);
        raterRegistry.revokeHumanCredential(voter1);
        raterRegistry.clearRevokedHumanNullifier(RaterRegistry.HumanCredentialProvider.SeededHuman, anchor);
        _seedRaterIdentity(raterRegistry, voter1, anchor);
        vm.stopPrank();

        vm.prank(funder);
        vm.expectRevert("Rater already awarded");
        feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, keccak256("second-feedback"), 10e6);
    }

    function testAwardFeedbackBonusRevertsWhilePaused() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);
        _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));

        vm.prank(owner);
        feedbackBonusEscrow.pause();

        vm.prank(funder);
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, FEEDBACK_HASH, 10e6);
    }

    function testExpiredRemainderForfeitsToTreasury() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);
        _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));

        vm.prank(funder);
        feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, FEEDBACK_HASH, 10e6);

        vm.warp(block.timestamp + 8 days);
        uint256 treasuryBalanceBefore = usdc.balanceOf(treasury);
        uint256 forfeitedAmount = feedbackBonusEscrow.forfeitExpiredFeedbackBonus(poolId);

        assertEq(forfeitedAmount, 90e6);
        assertEq(usdc.balanceOf(treasury), treasuryBalanceBefore + 90e6);
        (,,,,,,,,,,,, uint256 remainingAmount, bool forfeited,,) = feedbackBonusEscrow.feedbackBonusPools(poolId);
        assertEq(remainingAmount, 0);
        assertTrue(forfeited);
    }

    function testExpiredRemainderForfeitRevertsWhilePaused() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);
        _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));

        vm.prank(funder);
        feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, FEEDBACK_HASH, 10e6);

        vm.warp(block.timestamp + 8 days);
        vm.prank(owner);
        feedbackBonusEscrow.pause();

        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        feedbackBonusEscrow.forfeitExpiredFeedbackBonus(poolId);
    }

    function testAwarderOnlyCanAward() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);
        _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));

        vm.prank(voter2);
        vm.expectRevert("Only awarder");
        feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, FEEDBACK_HASH, 10e6);
    }

    function _submitQuestion(string memory url) internal returns (uint256 contentId) {
        string memory mediaUrl = bytes(url).length == 0 ? DEFAULT_MEDIA_URL : url;
        mediaUrl = _submissionImageUrl(mediaUrl);
        string[] memory imageUrls = new string[](1);
        imageUrls[0] = mediaUrl;
        activeTlockContentRegistry = registry;
        bytes32 salt =
            keccak256(abi.encode(mediaUrl, QUESTION, DESCRIPTION, TAGS, CATEGORY_ID, submitter, block.timestamp));

        vm.startPrank(submitter);
        _reserveQuestionMediaSubmission(
            registry,
            "https://example.com/context",
            imageUrls,
            "",
            QUESTION,
            DESCRIPTION,
            TAGS,
            CATEGORY_ID,
            salt,
            submitter
        );
        vm.warp(block.timestamp + 1);
        contentId = registry.submitQuestion(
            "https://example.com/context",
            imageUrls,
            "",
            QUESTION,
            TAGS,
            CATEGORY_ID,
            _emptySubmissionDetails(),
            salt,
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function _deployReplacementEngine() internal returns (RoundVotingEngine replacementEngine) {
        replacementEngine = RoundVotingEngine(
            address(
                new ERC1967Proxy(
                    address(new RoundVotingEngine()),
                    abi.encodeCall(
                        RoundVotingEngine.initialize,
                        (owner, address(lrepToken), address(registry), address(protocolConfig))
                    )
                )
            )
        );
    }

    function _deployFeedbackRegistry(address engine) internal returns (FeedbackRegistry deployedFeedbackRegistry) {
        deployedFeedbackRegistry = FeedbackRegistry(
            address(
                new ERC1967Proxy(
                    address(new FeedbackRegistry()), abi.encodeCall(FeedbackRegistry.initialize, (owner, owner, engine))
                )
            )
        );
    }

    function _createFeedbackBonusPool(uint256 contentId) internal returns (uint256 poolId) {
        poolId = _createFeedbackBonusPoolWithDeadline(contentId, block.timestamp + 7 days);
    }

    function _createFeedbackBonusPoolWithDeadline(uint256 contentId, uint256 feedbackClosesAt)
        internal
        returns (uint256 poolId)
    {
        poolId = _createFeedbackBonusPoolForFunderWithDeadline(contentId, funder, feedbackClosesAt);
    }

    function _createFeedbackBonusPoolForFunder(uint256 contentId, address poolFunder)
        internal
        returns (uint256 poolId)
    {
        poolId = _createFeedbackBonusPoolForFunderWithDeadline(contentId, poolFunder, block.timestamp + 7 days);
    }

    function _createFeedbackBonusPoolForFunderWithDeadline(
        uint256 contentId,
        address poolFunder,
        uint256 feedbackClosesAt
    ) internal returns (uint256 poolId) {
        vm.startPrank(feedbackGateway);
        usdc.approve(address(feedbackBonusEscrow), BONUS_AMOUNT);
        poolId = feedbackBonusEscrow.createFeedbackBonusPoolFromGateway(
            contentId, 1, BONUS_AMOUNT, feedbackClosesAt, funder, poolFunder
        );
        vm.stopPrank();
    }

    function _settleRoundWith(address[] memory voters, uint256 contentId, bool[] memory directions)
        internal
        returns (uint256 roundId)
    {
        return _settleRoundWithFrontend(voters, contentId, directions, address(0));
    }

    function _settleRoundWithFrontend(
        address[] memory voters,
        uint256 contentId,
        bool[] memory directions,
        address frontend
    ) internal returns (uint256 roundId) {
        bytes32[] memory commitKeys;
        (roundId, commitKeys) = _settleRoundWithPublishedFeedback(voters, contentId, directions, frontend);
        commitKeys;
    }

    function _settleRoundWithPublishedFeedback(
        address[] memory voters,
        uint256 contentId,
        bool[] memory directions,
        address frontend
    ) internal returns (uint256 roundId, bytes32[] memory commitKeys) {
        bytes32[] memory salts = new bytes32[](voters.length);
        commitKeys = new bytes32[](voters.length);

        for (uint256 i = 0; i < voters.length; i++) {
            (salts[i], commitKeys[i]) = _commitFeedbackVote(voters[i], contentId, directions[i], i, frontend);
        }

        roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        for (uint256 i = 0; i < voters.length; i++) {
            vm.prank(voters[i]);
            feedbackRegistry.publishFeedback(
                contentId, roundId, commitKeys[i], FEEDBACK_TYPE, FEEDBACK_BODY, FEEDBACK_SOURCE_URL, FEEDBACK_NONCE
            );
        }

        _warpPastTlockRevealTime(block.timestamp + EPOCH_DURATION);

        for (uint256 i = 0; i < voters.length; i++) {
            votingEngine.revealVoteByCommitKey(contentId, roundId, commitKeys[i], directions[i], 5_000, salts[i]);
        }

        _settleAfterRbtsSeed(votingEngine, contentId, roundId);
    }

    function _moveRoundToSettlementPendingWithPublishedFeedback(
        address[] memory voters,
        uint256 contentId,
        bool[] memory directions
    ) internal returns (uint256 roundId) {
        bytes32[] memory salts = new bytes32[](voters.length);
        bytes32[] memory commitKeys = new bytes32[](voters.length);

        for (uint256 i = 0; i < voters.length; i++) {
            (salts[i], commitKeys[i]) = _commitFeedbackVote(voters[i], contentId, directions[i], i, address(0));
        }

        roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        for (uint256 i = 0; i < voters.length; i++) {
            vm.prank(voters[i]);
            feedbackRegistry.publishFeedback(
                contentId, roundId, commitKeys[i], FEEDBACK_TYPE, FEEDBACK_BODY, FEEDBACK_SOURCE_URL, FEEDBACK_NONCE
            );
        }

        _warpPastTlockRevealTime(block.timestamp + EPOCH_DURATION);

        for (uint256 i = 0; i < voters.length; i++) {
            votingEngine.revealVoteByCommitKey(contentId, roundId, commitKeys[i], directions[i], 5_000, salts[i]);
        }

        _ensureTestClusterPayoutOracle(votingEngine);
        vm.roll(block.number + 1);
        votingEngine.settleRound(contentId, roundId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.SettlementPending));
    }

    function _commitFeedbackVote(address voter, uint256 contentId, bool isUp, uint256 index, address frontend)
        internal
        returns (bytes32 salt, bytes32 commitKey)
    {
        salt = keccak256(abi.encodePacked(voter, contentId, isUp, index));
        commitKey = _commitTestVote(
            DirectTestCommitRequest({
                engine: votingEngine,
                lrepToken: lrepToken,
                voter: voter,
                contentId: contentId,
                isUp: isUp,
                stake: STAKE,
                frontend: frontend,
                salt: salt
            })
        );
    }

    function _expectSelfVoteCommitRevert(address voter, uint256 contentId, bytes32 salt) internal {
        salt;
        vm.expectRevert(RoundVotingEngine.SelfVote.selector);
        vm.prank(voter);
        votingEngine.openRound(contentId);
    }

    function _registerFrontend(address frontend) internal {
        vm.startPrank(frontend);
        lrepToken.approve(address(frontendRegistry), frontendRegistry.STAKE_AMOUNT());
        frontendRegistry.register();
        vm.stopPrank();
    }

    function _feedbackHash(uint256 contentId, uint256 roundId, address author) internal view returns (bytes32) {
        return feedbackRegistry.buildContentFeedbackHash(
            contentId, roundId, author, FEEDBACK_TYPE, FEEDBACK_BODY, FEEDBACK_SOURCE_URL, FEEDBACK_NONCE
        );
    }

    function _threeVoters() internal view returns (address[] memory voters) {
        voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
    }

    function _fourVoters() internal view returns (address[] memory voters) {
        voters = new address[](4);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        voters[3] = voter4;
    }

    function _directions(bool a, bool b, bool c) internal pure returns (bool[] memory directions) {
        directions = new bool[](3);
        directions[0] = a;
        directions[1] = b;
        directions[2] = c;
    }

    function _directions(bool a, bool b, bool c, bool d) internal pure returns (bool[] memory directions) {
        directions = new bool[](4);
        directions[0] = a;
        directions[1] = b;
        directions[2] = c;
        directions[3] = d;
    }
}
