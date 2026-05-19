// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { VotingTestBase } from "./helpers/VotingTestHelpers.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { FeedbackBonusEscrow } from "../contracts/FeedbackBonusEscrow.sol";
import { FrontendRegistry } from "../contracts/FrontendRegistry.sol";
import { IFrontendRegistry } from "../contracts/interfaces/IFrontendRegistry.sol";
import { MockCategoryRegistry } from "../contracts/mocks/MockCategoryRegistry.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { QuestionRewardPoolEscrow } from "../contracts/QuestionRewardPoolEscrow.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { RoundRewardDistributor } from "../contracts/RoundRewardDistributor.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
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

    function creditFees(address, uint256) external { }

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

contract FeedbackBonusEscrowTest is VotingTestBase {
    LoopReputation public lrepToken;
    ContentRegistry public registry;
    RoundVotingEngine public votingEngine;
    RoundRewardDistributor public rewardDistributor;
    FrontendRegistry public frontendRegistry;
    QuestionRewardPoolEscrow public questionRewardPoolEscrow;
    FeedbackBonusEscrow public feedbackBonusEscrow;
    ProtocolConfig public protocolConfig;
    MockERC20 public usdc;
    RaterRegistry public raterRegistry;

    address public owner = address(1);
    address public submitter = address(2);
    address public funder = address(3);
    address public voter1 = address(4);
    address public voter2 = address(5);
    address public voter3 = address(6);
    address public voter4 = address(7);
    address public delegate1 = address(8);
    address public frontend1 = address(9);
    address public treasury = address(100);

    uint256 public constant STAKE = 5e6;
    uint256 public constant EPOCH_DURATION = 10 minutes;
    uint256 public constant BONUS_AMOUNT = 100e6;
    bytes32 public constant FEEDBACK_HASH = keccak256("curyo-feedback-v1:test");

    string internal constant QUESTION = "Would you recommend this hotel?";
    string internal constant DESCRIPTION = "Vote based on the overall stay quality.";
    string internal constant TAGS = "travel";
    string internal constant DEFAULT_MEDIA_URL = "hotel-room";
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

        vm.startPrank(owner);

        lrepToken = new LoopReputation(owner, owner);
        lrepToken.grantRole(lrepToken.MINTER_ROLE(), owner);

        ContentRegistry registryImpl = new ContentRegistry();
        RoundVotingEngine engineImpl = new RoundVotingEngine();
        RoundRewardDistributor distImpl = new RoundRewardDistributor();
        FrontendRegistry frontendRegistryImpl = new FrontendRegistry();
        QuestionRewardPoolEscrow questionRewardPoolImpl = new QuestionRewardPoolEscrow();
        FeedbackBonusEscrow feedbackBonusImpl = new FeedbackBonusEscrow();

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
        feedbackBonusEscrow = FeedbackBonusEscrow(
            address(
                new ERC1967Proxy(
                    address(feedbackBonusImpl),
                    abi.encodeCall(
                        FeedbackBonusEscrow.initialize,
                        (owner, address(usdc), address(registry), address(votingEngine), address(raterRegistry))
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

        frontendRegistry.setVotingEngine(address(votingEngine));

        protocolConfig.setRewardDistributor(address(rewardDistributor));
        protocolConfig.setCategoryRegistry(address(mockCategoryRegistry));
        protocolConfig.setFrontendRegistry(address(frontendRegistry));
        protocolConfig.setTreasury(treasury);
        protocolConfig.setRaterRegistry(address(raterRegistry));
        _setTlockDrandConfig(protocolConfig, DEFAULT_DRAND_CHAIN_HASH, DEFAULT_DRAND_GENESIS_TIME, DEFAULT_DRAND_PERIOD);
        _setTlockRoundConfig(protocolConfig, EPOCH_DURATION, 7 days, 3, 200);

        address[7] memory humans = [submitter, funder, voter1, voter2, voter3, voter4, frontend1];
        for (uint256 i = 0; i < humans.length; i++) {
            _seedRaterIdentity(raterRegistry, humans[i], bytes32(uint256(uint160(humans[i]))));
            lrepToken.mint(humans[i], 10_000e6);
            usdc.mint(humans[i], 1_000e6);
        }
        lrepToken.mint(delegate1, 10_000e6);

        vm.stopPrank();
    }

    function testVotingEngineIsPinnedAfterInitialization() public {
        address newEngine = address(0xBEEF);

        vm.prank(owner);
        vm.expectRevert("Invalid engine");
        feedbackBonusEscrow.setVotingEngine(newEngine);

        assertEq(address(feedbackBonusEscrow.votingEngine()), address(votingEngine));
    }

    function testSetVotingEngineRejectsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert("Invalid engine");
        feedbackBonusEscrow.setVotingEngine(address(0));
    }

    function testSetVotingEngineRequiresConfigRole() public {
        vm.prank(voter1);
        vm.expectRevert();
        feedbackBonusEscrow.setVotingEngine(address(0xBEEF));
    }

    function testCreateFeedbackBonusPoolRejectsStaleEscrowAfterEngineRotation() public {
        uint256 contentId = _submitQuestion("");
        RoundVotingEngine replacementEngine = RoundVotingEngine(
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

        vm.startPrank(owner);
        registry.pause();
        registry.setVotingEngine(address(replacementEngine));
        registry.unpause();
        vm.stopPrank();

        vm.startPrank(funder);
        usdc.approve(address(feedbackBonusEscrow), BONUS_AMOUNT);
        vm.expectRevert("Stale engine");
        feedbackBonusEscrow.createFeedbackBonusPool(contentId, 1, BONUS_AMOUNT, block.timestamp + 7 days, funder);
        vm.stopPrank();
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
        (,,,,,,,,,,,, uint256 remainingAmount,,) = feedbackBonusEscrow.feedbackBonusPools(poolId);
        assertEq(remainingAmount, 90e6);
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
        raterRegistry.clearRevokedHumanNullifier(RaterRegistry.HumanCredentialProvider.CuryoSelfVerifiedSeed, anchor);
        _seedRaterIdentity(raterRegistry, voter1, anchor);
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
        raterRegistry.clearRevokedHumanNullifier(RaterRegistry.HumanCredentialProvider.CuryoSelfVerifiedSeed, anchor);
        _seedRaterIdentity(raterRegistry, voter1, anchor);
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

    function testAwardRequiresRevealedVote() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);
        _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));

        vm.prank(funder);
        vm.expectRevert("No commit");
        feedbackBonusEscrow.awardFeedbackBonus(poolId, voter4, FEEDBACK_HASH, 10e6);
    }

    function testAwardUnverifiedRecipientUsesDirectCommitKey() public {
        uint256 contentId = _submitQuestion("");
        uint256 poolId = _createFeedbackBonusPool(contentId);

        vm.prank(owner);
        raterRegistry.revokeHumanCredential(voter1);
        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        bytes32 commitHash = votingEngine.voterCommitHash(contentId, roundId, voter1);
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

    function testAwardPaysIdentityHolderWhenNewDelegateIsRecipient() public {
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

        uint256 holderBalanceBefore = usdc.balanceOf(voter1);
        uint256 delegateBalanceBefore = usdc.balanceOf(newDelegate);

        vm.prank(funder);
        uint256 recipientAmount = feedbackBonusEscrow.awardFeedbackBonus(poolId, newDelegate, FEEDBACK_HASH, 10e6);

        assertEq(recipientAmount, 10e6);
        assertEq(usdc.balanceOf(voter1), holderBalanceBefore + recipientAmount);
        assertEq(usdc.balanceOf(newDelegate), delegateBalanceBefore);
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
        assertTrue(votingEngine.holderCommitKey(contentId, roundId, voter1) != bytes32(0));

        bytes32 oldAnchor = bytes32(uint256(uint160(voter1)));
        vm.startPrank(owner);
        raterRegistry.revokeHumanCredential(voter1);
        raterRegistry.clearRevokedHumanNullifier(RaterRegistry.HumanCredentialProvider.CuryoSelfVerifiedSeed, oldAnchor);
        _seedRaterIdentity(raterRegistry, voter1, keccak256("voter1-rotated-anchor"));
        vm.stopPrank();

        uint256 holderBalanceBefore = usdc.balanceOf(voter1);

        vm.prank(funder);
        uint256 recipientAmount = feedbackBonusEscrow.awardFeedbackBonus(poolId, voter1, FEEDBACK_HASH, 10e6);

        assertEq(recipientAmount, 10e6);
        assertEq(usdc.balanceOf(voter1), holderBalanceBefore + recipientAmount);
    }

    function testCreateFeedbackBonusPoolAllowsFunderWithoutHumanCredential() public {
        uint256 contentId = _submitQuestion("");
        address unverifiedFunder = address(0xB0B);
        usdc.mint(unverifiedFunder, BONUS_AMOUNT);

        vm.startPrank(unverifiedFunder);
        usdc.approve(address(feedbackBonusEscrow), BONUS_AMOUNT);
        uint256 poolId =
            feedbackBonusEscrow.createFeedbackBonusPool(contentId, 1, BONUS_AMOUNT, block.timestamp + 7 days, funder);
        vm.stopPrank();

        assertGt(poolId, 0);
        (,,,,, address funderIdentity,,,,,,,,,) = feedbackBonusEscrow.feedbackBonusPools(poolId);
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
        raterRegistry.clearRevokedHumanNullifier(RaterRegistry.HumanCredentialProvider.CuryoSelfVerifiedSeed, anchor);
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
        (,,,,,,,,,,,, uint256 remainingAmount, bool forfeited,) = feedbackBonusEscrow.feedbackBonusPools(poolId);
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
            DESCRIPTION,
            TAGS,
            CATEGORY_ID,
            salt,
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function _createFeedbackBonusPool(uint256 contentId) internal returns (uint256 poolId) {
        vm.startPrank(funder);
        usdc.approve(address(feedbackBonusEscrow), BONUS_AMOUNT);
        poolId =
            feedbackBonusEscrow.createFeedbackBonusPool(contentId, 1, BONUS_AMOUNT, block.timestamp + 7 days, funder);
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
        bytes32[] memory salts = new bytes32[](voters.length);
        bytes32[] memory commitKeys = new bytes32[](voters.length);

        for (uint256 i = 0; i < voters.length; i++) {
            salts[i] = keccak256(abi.encodePacked(voters[i], contentId, directions[i], i));
            commitKeys[i] = _commitTestVote(
                DirectTestCommitRequest({
                    engine: votingEngine,
                    lrepToken: lrepToken,
                    voter: voters[i],
                    contentId: contentId,
                    isUp: directions[i],
                    stake: STAKE,
                    frontend: frontend,
                    salt: salts[i]
                })
            );
        }

        roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        _warpPastTlockRevealTime(block.timestamp + EPOCH_DURATION);

        for (uint256 i = 0; i < voters.length; i++) {
            votingEngine.revealVoteByCommitKey(contentId, roundId, commitKeys[i], directions[i], 5_000, salts[i]);
        }

        _settleAfterRbtsSeed(votingEngine, contentId, roundId);
    }

    function _expectSelfVoteCommitRevert(address voter, uint256 contentId, bytes32 salt) internal {
        TestCommitArtifacts memory artifacts =
            _buildTestCommitArtifacts(address(votingEngine), voter, true, salt, contentId);
        vm.startPrank(voter);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext1 =
            _roundContext(votingEngine.previewCommitRoundId(contentId), artifacts.roundReferenceRatingBps);
        vm.expectRevert(RoundVotingEngine.SelfVote.selector);
        votingEngine.commitVote(
            contentId,
            cachedRoundContext1,
            artifacts.targetRound,
            artifacts.drandChainHash,
            artifacts.commitHash,
            artifacts.ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }

    function _registerFrontend(address frontend) internal {
        vm.startPrank(frontend);
        lrepToken.approve(address(frontendRegistry), frontendRegistry.STAKE_AMOUNT());
        frontendRegistry.register();
        vm.stopPrank();
    }

    function _threeVoters() internal view returns (address[] memory voters) {
        voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
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
