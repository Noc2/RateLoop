// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {VotingTestBase} from "./helpers/VotingTestHelpers.sol";
import {ContentRegistry} from "../contracts/ContentRegistry.sol";
import {HumanReputation} from "../contracts/HumanReputation.sol";
import {FrontendRegistry} from "../contracts/FrontendRegistry.sol";
import {MockCategoryRegistry} from "../contracts/mocks/MockCategoryRegistry.sol";
import {MockERC20} from "../contracts/mocks/MockERC20.sol";
import {ClusterPayoutOracle} from "../contracts/ClusterPayoutOracle.sol";
import {IClusterPayoutOracle} from "../contracts/interfaces/IClusterPayoutOracle.sol";
import {ProtocolConfig} from "../contracts/ProtocolConfig.sol";
import {QuestionRewardPoolEscrow} from "../contracts/QuestionRewardPoolEscrow.sol";
import {RoundRewardDistributor} from "../contracts/RoundRewardDistributor.sol";
import {RoundVotingEngine} from "../contracts/RoundVotingEngine.sol";
import {RoundEngineReadHelpers} from "./helpers/RoundEngineReadHelpers.sol";
import {RoundLib} from "../contracts/libraries/RoundLib.sol";
import {RoundSnapshot} from "../contracts/libraries/QuestionRewardPoolEscrowTypes.sol";
import {TlockVoteLib} from "../contracts/libraries/TlockVoteLib.sol";
import {Eip3009Authorization, X402QuestionSubmitter} from "../contracts/X402QuestionSubmitter.sol";
import {MockQuestionRewardPoolEscrow} from "./mocks/MockQuestionRewardPoolEscrow.sol";
import {MockRaterIdentityRegistry} from "./mocks/MockRaterIdentityRegistry.sol";

contract QuestionRewardPoolEscrowTest is VotingTestBase {
    HumanReputation public hrepToken;
    ContentRegistry public registry;
    RoundVotingEngine public votingEngine;
    RoundRewardDistributor public rewardDistributor;
    FrontendRegistry public frontendRegistry;
    QuestionRewardPoolEscrow public rewardPoolEscrow;
    X402QuestionSubmitter public x402QuestionSubmitter;
    ProtocolConfig public protocolConfig;
    MockERC20 public usdc;
    MockRaterIdentityRegistry public raterIdentityRegistry;

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
    uint256 public constant REWARD_POOL_AMOUNT = 100e6;

    string internal constant QUESTION = "Would you recommend this hotel?";
    string internal constant DESCRIPTION = "Vote based on the overall stay quality.";
    string internal constant TAGS = "travel";
    string internal constant DEFAULT_MEDIA_URL = "https://example.com/hotel-room.jpg";
    uint256 internal constant CATEGORY_ID = 1;
    uint8 internal constant REWARD_ASSET_HREP = 0;
    uint8 internal constant REWARD_ASSET_USDC = 1;
    uint256 internal constant MIN_REWARD_POOL_PARTICIPANTS = 3;
    uint256 internal constant HIGH_VALUE_REWARD_POOL_THRESHOLD = 1_000e6;
    uint256 internal constant MIN_HIGH_VALUE_PARTICIPANTS = 5;
    uint256 internal constant MAX_FRONTEND_FEE_BPS = 500;
    uint256 internal constant BUNDLE_CLAIM_GRACE = 7 days;
    uint256 internal constant BUNDLE_REFUND_GRACE = 98 days;
    uint8 internal constant BOUNTY_ELIGIBILITY_VERIFIED_HUMAN = 1;

    mapping(uint256 => mapping(uint256 => uint256)) internal mockedRoundCommitCount;

    event RewardPoolCreated(
        uint256 indexed rewardPoolId,
        uint256 indexed contentId,
        address indexed funder,
        uint256 funderRaterIdentity,
        uint256 amount,
        uint256 requiredVoters,
        uint256 requiredSettledRounds,
        uint256 startRoundId,
        uint256 bountyOpensAt,
        uint256 bountyClosesAt,
        uint256 feedbackClosesAt,
        uint256 frontendFeeBps,
        uint8 asset,
        uint8 bountyEligibility,
        bytes32 bountyEligibilityDataHash,
        bool nonRefundable
    );
    event RewardPoolPurposeSet(
        uint256 indexed rewardPoolId, uint8 indexed bountyKind, uint256 indexed challengedRoundId, bytes32 reasonHash
    );

    struct X402TestQuestion {
        string contextUrl;
        string title;
        string description;
        string tags;
        string[] imageUrls;
        RoundLib.RoundConfig roundConfig;
        ContentRegistry.SubmissionRewardTerms rewardTerms;
        ContentRegistry.QuestionSpecCommitment spec;
        bytes32 salt;
    }

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

        hrepToken = new HumanReputation(owner, owner);
        hrepToken.grantRole(hrepToken.MINTER_ROLE(), owner);

        ContentRegistry registryImpl = new ContentRegistry();
        RoundVotingEngine engineImpl = new RoundVotingEngine();
        RoundRewardDistributor distImpl = new RoundRewardDistributor();
        FrontendRegistry frontendRegistryImpl = new FrontendRegistry();
        QuestionRewardPoolEscrow rewardPoolImpl = new QuestionRewardPoolEscrow();

        protocolConfig = _deployProtocolConfig(owner);
        registry = ContentRegistry(
            address(
                new ERC1967Proxy(
                    address(registryImpl),
                    abi.encodeCall(ContentRegistry.initializeWithTreasury, (owner, owner, owner, address(hrepToken)))
                )
            )
        );
        votingEngine = RoundVotingEngine(
            address(
                new ERC1967Proxy(
                    address(engineImpl),
                    abi.encodeCall(
                        RoundVotingEngine.initialize,
                        (owner, address(hrepToken), address(registry), address(protocolConfig))
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
                        (owner, address(hrepToken), address(votingEngine), address(registry))
                    )
                )
            )
        );

        usdc = new MockERC20("USD Coin", "USDC", 6);
        raterIdentityRegistry = new MockRaterIdentityRegistry();
        frontendRegistry = FrontendRegistry(
            address(
                new ERC1967Proxy(
                    address(frontendRegistryImpl),
                    abi.encodeCall(FrontendRegistry.initialize, (owner, owner, address(hrepToken)))
                )
            )
        );
        rewardPoolEscrow = QuestionRewardPoolEscrow(
            address(
                new ERC1967Proxy(
                    address(rewardPoolImpl),
                    abi.encodeCall(
                        QuestionRewardPoolEscrow.initialize,
                        (
                            owner,
                            address(hrepToken),
                            address(usdc),
                            address(registry),
                            address(votingEngine),
                            address(raterIdentityRegistry)
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
        registry.setQuestionRewardPoolEscrow(address(rewardPoolEscrow));
        x402QuestionSubmitter = new X402QuestionSubmitter(registry, address(usdc), address(rewardPoolEscrow));
        registry.grantRole(registry.X402_GATEWAY_ROLE(), address(x402QuestionSubmitter));

        frontendRegistry.setVotingEngine(address(votingEngine));

        protocolConfig.setRewardDistributor(address(rewardDistributor));
        protocolConfig.setCategoryRegistry(address(mockCategoryRegistry));
        protocolConfig.setFrontendRegistry(address(frontendRegistry));
        protocolConfig.setTreasury(treasury);
        protocolConfig.setRaterRegistry(address(raterIdentityRegistry));
        _setTlockDrandConfig(protocolConfig, DEFAULT_DRAND_CHAIN_HASH, DEFAULT_DRAND_GENESIS_TIME, DEFAULT_DRAND_PERIOD);
        _setTlockRoundConfig(protocolConfig, EPOCH_DURATION, 7 days, 3, 200);

        uint256 reserveAmount = 1_000_000e6;
        hrepToken.mint(owner, reserveAmount);
        hrepToken.approve(address(votingEngine), reserveAmount);
        votingEngine.addToConsensusReserve(reserveAmount);

        address[7] memory humans = [submitter, funder, voter1, voter2, voter3, voter4, frontend1];
        for (uint256 i = 0; i < humans.length; i++) {
            raterIdentityRegistry.setHolder(humans[i]);
            hrepToken.mint(humans[i], 10_000e6);
            usdc.mint(humans[i], 1_000e6);
        }
        usdc.mint(delegate1, 1_000e6);

        vm.stopPrank();
    }

    function testMediaQuestionCanReceiveRewardPoolAndPayWeightedRevealedVoters() public {
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);
        uint256 roundId = _settleRoundWith(voters, contentId, directions);

        uint256 reward1 = _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);
        uint256 reward2 = _claimQuestionRewardAndAssert(voter2, rewardPoolId, roundId);
        uint256 reward3 = _claimQuestionRewardAndAssert(voter3, rewardPoolId, roundId);

        assertEq(reward1 + reward2 + reward3, REWARD_POOL_AMOUNT);
        assertEq(usdc.balanceOf(voter1), 1_000e6 + reward1);
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), 0);
    }

    function testQuestionRewardsUsePredictionEffectiveWeights() public {
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        address[] memory voters = _threeVoters();
        uint16[] memory predictions = new uint16[](3);
        predictions[0] = 8_000;
        predictions[1] = 5_000;
        predictions[2] = 6_500;
        uint256 roundId = _settlePredictionRoundWith(voters, contentId, predictions);

        uint256 claimable1 = rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1);
        uint256 claimable2 = rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter2);
        uint256 claimable3 = rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter3);

        assertGt(claimable1, 0);
        assertGt(claimable2, 0);
        assertGt(claimable3, 0);
        assertTrue(claimable1 != claimable2 || claimable2 != claimable3);

        uint256 reward1 = _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);
        uint256 reward2 = _claimQuestionRewardAndAssert(voter2, rewardPoolId, roundId);
        uint256 reward3 = _claimQuestionRewardAndAssert(voter3, rewardPoolId, roundId);

        assertEq(reward1, claimable1);
        assertEq(reward2, claimable2);
        assertEq(reward1 + reward2 + reward3, REWARD_POOL_AMOUNT);
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), 0);
    }

    function testVerifiedHumanBountyCountsOnlyVerifiedHumansWhileVotingStaysOpen() public {
        raterIdentityRegistry.revokeHumanCredential(voter4);

        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId =
            _createRewardPoolWithEligibility(contentId, REWARD_POOL_AMOUNT, 3, 1, BOUNTY_ELIGIBILITY_VERIFIED_HUMAN);

        uint256 roundId = _settleRoundWith(_fourVoters(), contentId, _directions(true, true, false, true));
        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);

        RoundSnapshot memory snapshot = rewardPoolEscrow.getRoundSnapshot(rewardPoolId, roundId);
        assertEq(snapshot.rawEligibleVoters, 3);
        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);
        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter4), 0);

        vm.prank(voter4);
        vm.expectRevert("Not bounty eligible");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);
    }

    function testHighValueRewardPoolRequiresHigherParticipantFloor() public {
        uint256 contentId = _submitQuestion("");
        uint256 highValueAmount = HIGH_VALUE_REWARD_POOL_THRESHOLD;

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), highValueAmount);
        vm.expectRevert("High-value floor");
        rewardPoolEscrow.createRewardPool(contentId, highValueAmount, 3, 1, block.timestamp + 30 days, 0);

        usdc.approve(address(rewardPoolEscrow), highValueAmount);
        uint256 rewardPoolId = rewardPoolEscrow.createRewardPool(
            contentId, highValueAmount, MIN_HIGH_VALUE_PARTICIPANTS, 1, block.timestamp + 30 days, 0
        );
        vm.stopPrank();

        assertGt(rewardPoolId, 0);
    }

    function testOpenWalletCanClaimQuestionRewardWithoutRaterIdentity() public {
        address openVoter1 = address(201);
        address openVoter2 = address(202);
        address openVoter3 = address(203);
        vm.startPrank(owner);
        hrepToken.mint(openVoter1, 10_000e6);
        hrepToken.mint(openVoter2, 10_000e6);
        hrepToken.mint(openVoter3, 10_000e6);
        vm.stopPrank();

        uint256 contentId = _submitQuestion("https://example.com/open-wallet-single.jpg");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        address[] memory voters = new address[](3);
        voters[0] = openVoter1;
        voters[1] = openVoter2;
        voters[2] = openVoter3;
        uint256 roundId = _settleRoundWith(voters, contentId, _directions(true, true, false));

        uint256 reward = _claimQuestionRewardAndAssert(openVoter1, rewardPoolId, roundId);
        assertEq(usdc.balanceOf(openVoter1), reward);
    }

    function testCreateRewardPoolRejectsStaleRegistryEscrow() public {
        uint256 contentId = _submitQuestion("");
        QuestionRewardPoolEscrow replacementEscrow = QuestionRewardPoolEscrow(
            address(
                new ERC1967Proxy(
                    address(new QuestionRewardPoolEscrow()),
                    abi.encodeCall(
                        QuestionRewardPoolEscrow.initialize,
                        (
                            owner,
                            address(hrepToken),
                            address(usdc),
                            address(registry),
                            address(votingEngine),
                            address(raterIdentityRegistry)
                        )
                    )
                )
            )
        );

        vm.startPrank(owner);
        registry.pause();
        registry.setQuestionRewardPoolEscrow(address(replacementEscrow));
        registry.unpause();
        vm.stopPrank();

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), REWARD_POOL_AMOUNT);
        vm.expectRevert("Stale escrow");
        rewardPoolEscrow.createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1, block.timestamp + 30 days, 0);
        vm.stopPrank();
    }

    function testQuestionRewardCannotReplayAfterRaterIdentityRemintWithSameNullifier() public {
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);
        uint256 nullifier = 111_111;
        raterIdentityRegistry.mint(voter1, nullifier);

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);
        uint256 roundId = _settleRoundWith(voters, contentId, directions);

        _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);

        raterIdentityRegistry.resetNullifier(nullifier);
        raterIdentityRegistry.mint(voter1, nullifier);

        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);
        vm.prank(voter1);
        vm.expectRevert("Already claimed");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);
    }

    function testCreateChallengeRewardPoolEmitsPurpose() public {
        uint256 contentId = _submitQuestion("");
        bytes32 reasonHash = keccak256("stale rating");
        uint256 bountyClosesAt = block.timestamp + 30 days;

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), REWARD_POOL_AMOUNT);
        vm.expectEmit(false, true, true, true);
        emit RewardPoolPurposeSet(0, 1, 1, reasonHash);
        uint256 rewardPoolId = rewardPoolEscrow.createChallengeRewardPool(
            contentId, REWARD_POOL_AMOUNT, 3, 1, reasonHash, bountyClosesAt, 0
        );
        vm.stopPrank();

        assertGt(rewardPoolId, 0);
    }

    function testQuestionRewardClaimSucceedsWhileEscrowPaused() public {
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);
        uint256 roundId = _settleRoundWith(voters, contentId, directions);

        vm.prank(owner);
        rewardPoolEscrow.pause();

        _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);
    }

    function testQuestionRewardClaimWaitsForUnrevealedCleanup() public {
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);
        uint256 roundId = _settleRoundWithOneUnrevealed(contentId);

        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);
        vm.expectRevert(bytes("Cleanup pending"));
        vm.prank(voter1);
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);

        votingEngine.processUnrevealedVotes(contentId, roundId, 0, 0);

        vm.prank(voter1);
        uint256 reward = rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);
        assertGt(reward, 0);
    }

    function testQualifyRoundWaitsForUnrevealedCleanup() public {
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);
        uint256 roundId = _settleRoundWithOneUnrevealed(contentId);

        vm.expectRevert("Cleanup pending");
        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);

        votingEngine.processUnrevealedVotes(contentId, roundId, 0, 0);

        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);
        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);
    }

    function testCompletedPoolRefundGraceStartsAfterCleanupQualification() public {
        uint256 contentId = _submitQuestion("");
        uint256 expiresAt = block.timestamp + 30 days;
        uint256 rewardPoolId = _createRewardPoolWithExpiry(contentId, REWARD_POOL_AMOUNT, 3, 1, expiresAt);
        uint256 roundId = _settleRoundWithOneUnrevealed(contentId);

        vm.warp(expiresAt + BUNDLE_CLAIM_GRACE + 1);
        vm.expectRevert("Cleanup pending");
        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);

        votingEngine.processUnrevealedVotes(contentId, roundId, 0, 0);
        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);

        vm.expectRevert("Grace");
        rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId);

        vm.warp(block.timestamp + BUNDLE_CLAIM_GRACE + 1);
        uint256 refundAmount = rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId);
        assertEq(refundAmount, REWARD_POOL_AMOUNT);
    }

    // T-1: thresholdReachedAt is the timestamp of the minVoters-th reveal, but bounty
    // qualification cares about whether `requiredVoters` voters revealed before
    // `bountyClosesAt`. When minVoters > requiredVoters (allowed configuration), the
    // early return in QuestionRewardPoolEscrowQualificationLib.previewRoundQualification
    // wrongly disqualifies a round whose first `requiredVoters` reveals were timely.
    function testT1ThresholdReachedAtVsRequiredVotersDivergence() public {
        // Content config: minVoters=5, maxVoters=5 (so settle requires 5 reveals).
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 5, maxVoters: 5
        });
        uint256 contentId = _submitQuestionWithRoundConfig("https://example.com/t1.jpg", roundConfig);

        // Bootstrap a fifth voter (existing fixtures define voter1..voter4).
        address voter5 = address(0x55);
        vm.startPrank(owner);
        raterIdentityRegistry.setHolder(voter5);
        hrepToken.mint(voter5, 10_000e6);
        usdc.mint(voter5, 1_000e6);
        vm.stopPrank();

        // requiredVoters=3 (< minVoters=5). Bounty closes 1 hour out so we can
        // straddle it across reveals. fundedAmount must cover requiredSettledRounds*maxVoters
        // = 1*5 = 5 (refundable path), so 5e6 USDC is enough.
        uint256 fundedAmount = 5e6;
        uint256 bountyClosesAt = block.timestamp + 1 hours;
        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), fundedAmount);
        uint256 rewardPoolId = rewardPoolEscrow.createRewardPool(
            contentId,
            fundedAmount,
            /*requiredVoters=*/
            3,
            /*requiredSettledRounds=*/
            1,
            bountyClosesAt,
            0
        );
        vm.stopPrank();

        // Five voters commit (commits all happen pre-bountyClose).
        address[5] memory voters = [voter1, voter2, voter3, voter4, voter5];
        bool[5] memory directions = [true, true, true, false, false];
        bytes32[5] memory salts;
        bytes32[5] memory commitKeys;
        for (uint256 i = 0; i < 5; i++) {
            salts[i] = keccak256(abi.encodePacked("t1", voters[i], contentId, i));
            commitKeys[i] = _commitTestVote(
                DirectTestCommitRequest({
                    engine: votingEngine,
                    hrepToken: hrepToken,
                    voter: voters[i],
                    contentId: contentId,
                    isUp: directions[i],
                    stake: STAKE,
                    frontend: address(0),
                    salt: salts[i]
                })
            );
        }
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);

        // Warp past epoch end (~10 min in) but well before bountyClosesAt (1h out).
        // Reveal A, B, C — all timely (revealedAt < bountyClosesAt).
        _warpPastTlockRevealTime(block.timestamp + EPOCH_DURATION);
        for (uint256 i = 0; i < 3; i++) {
            votingEngine.revealVoteByCommitKey(contentId, roundId, commitKeys[i], directions[i], 5_000, salts[i]);
        }
        // Sanity: thresholdReachedAt is still 0 (only 3 revealed, minVoters=5).
        (,,,,,,,,,,, uint48 thresholdReachedMid,,) = votingEngine.rounds(contentId, roundId);
        assertEq(thresholdReachedMid, 0, "threshold should not be hit at 3 reveals when minVoters=5");

        // Warp past bountyClosesAt; reveal D and E now (they are NOT timely).
        vm.warp(bountyClosesAt + 1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, commitKeys[3], directions[3], 5_000, salts[3]);
        votingEngine.revealVoteByCommitKey(contentId, roundId, commitKeys[4], directions[4], 5_000, salts[4]);

        // thresholdReachedAt now equals E's revealedAt — past bountyClosesAt.
        (,,,,,,,,,,, uint48 thresholdReachedAfter,,) = votingEngine.rounds(contentId, roundId);
        assertGt(thresholdReachedAfter, bountyClosesAt, "thresholdReachedAt must be past bountyClose");

        // Settle the round (revealedCount=5 >= minVoters=5).
        votingEngine.settleRound(contentId, roundId);

        // requiredVoters=3, A/B/C revealed timely => correct expectation: claimable > 0.
        // Buggy library early-returns canQualify=false because thresholdReachedAt > bountyClosesAt.
        uint256 claimableA = rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1);

        // If the early-return is wrong, claimableA == 0 (bug). If correct, > 0.
        // We assert > 0; failure of this assertion confirms the bug.
        assertGt(
            claimableA,
            0,
            "T-1 confirmed: voter A revealed before bountyClosesAt with 3-of-5 timely reveals, but library disqualified the round via thresholdReachedAt"
        );
    }

    function testT1BundleThresholdReachedAtVsRequiredCompletersDivergence() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 5, maxVoters: 5
        });
        uint256[] memory contentIds = new uint256[](2);
        contentIds[0] = _submitQuestionWithContextAndRoundConfig(
            "https://example.com/t1-bundle-a", "https://example.com/t1-a.jpg", roundConfig
        );
        contentIds[1] = _submitQuestionWithContextAndRoundConfig(
            "https://example.com/t1-bundle-b", "https://example.com/t1-b.jpg", roundConfig
        );

        address voter5 = address(0x55);
        _registerTestVoter(voter5);

        uint256 bountyClosesAt = block.timestamp + 1 hours;
        uint256 bundleId = _createSubmissionBundleWithClose(
            contentIds,
            funder,
            REWARD_ASSET_USDC,
            20e6,
            /*requiredCompleters=*/
            3,
            bountyClosesAt
        );

        (uint256 firstRoundId, bytes32[5] memory firstSalts, bytes32[5] memory firstCommitKeys) =
            _commitFiveVoterT1Round(contentIds[0], voter5, "t1-bundle-a");
        (uint256 secondRoundId, bytes32[5] memory secondSalts, bytes32[5] memory secondCommitKeys) =
            _commitFiveVoterT1Round(contentIds[1], voter5, "t1-bundle-b");

        _warpPastTlockRevealTime(block.timestamp + EPOCH_DURATION);
        _revealFiveVoterT1Round(contentIds[0], firstRoundId, firstSalts, firstCommitKeys, 0, 3);
        _revealFiveVoterT1Round(contentIds[1], secondRoundId, secondSalts, secondCommitKeys, 0, 3);

        vm.warp(bountyClosesAt + 1);
        _revealFiveVoterT1Round(contentIds[0], firstRoundId, firstSalts, firstCommitKeys, 3, 5);
        _revealFiveVoterT1Round(contentIds[1], secondRoundId, secondSalts, secondCommitKeys, 3, 5);

        assertGt(
            RoundEngineReadHelpers.round(votingEngine, contentIds[0], firstRoundId).thresholdReachedAt, bountyClosesAt
        );
        assertGt(
            RoundEngineReadHelpers.round(votingEngine, contentIds[1], secondRoundId).thresholdReachedAt, bountyClosesAt
        );

        votingEngine.settleRound(contentIds[0], firstRoundId);
        votingEngine.settleRound(contentIds[1], secondRoundId);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[1], secondRoundId);

        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), 0);
    }

    function testRefundableRewardPoolAmountUsesQuestionSelectedVoterCap() public {
        RoundLib.RoundConfig memory roundConfig =
            RoundLib.RoundConfig({epochDuration: 10 minutes, maxDuration: 1 hours, minVoters: 3, maxVoters: 4});
        uint256 contentId = _submitQuestionWithRoundConfig("https://example.com/small-cap.jpg", roundConfig);

        uint256 rewardPoolId = _createRewardPool(contentId, 4, 3, 1);

        assertEq(rewardPoolId, 2);
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), 4);
    }

    function testRewardPoolRejectsRequiredVotersAboveQuestionCap() public {
        RoundLib.RoundConfig memory roundConfig =
            RoundLib.RoundConfig({epochDuration: 10 minutes, maxDuration: 1 hours, minVoters: 3, maxVoters: 4});
        uint256 contentId = _submitQuestionWithRoundConfig("https://example.com/impossible-cap.jpg", roundConfig);

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), REWARD_POOL_AMOUNT);
        vm.expectRevert("Voters exceed max");
        rewardPoolEscrow.createRewardPool(contentId, REWARD_POOL_AMOUNT, 5, 1, block.timestamp + 30 days, 0);
        vm.stopPrank();
    }

    function testRewardPoolRejectsQuestionVoterCapAboveQualificationLimit() public {
        uint256 contentId = _submitQuestion("");
        vm.mockCall(
            address(registry),
            abi.encodeWithSelector(ContentRegistry.getContentRoundConfig.selector, contentId),
            abi.encode(
                RoundLib.RoundConfig({epochDuration: 10 minutes, maxDuration: 1 hours, minVoters: 3, maxVoters: 201})
            )
        );

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), REWARD_POOL_AMOUNT);
        vm.expectRevert("Voters exceed max");
        rewardPoolEscrow.createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1, block.timestamp + 30 days, 0);
        vm.stopPrank();
    }

    function testEligibleFrontendReceivesThreePercentFromQuestionRewardClaims() public {
        _registerFrontend(frontend1);

        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);
        uint256 roundId = _settleRoundWithFrontend(voters, contentId, directions, frontend1);

        uint256 frontendBalanceBefore = usdc.balanceOf(frontend1);

        uint256 reward1 = _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);
        uint256 reward2 = _claimQuestionRewardAndAssert(voter2, rewardPoolId, roundId);
        uint256 reward3 = _claimQuestionRewardAndAssert(voter3, rewardPoolId, roundId);

        assertEq(reward1 + reward2 + reward3, 97e6);
        assertEq(usdc.balanceOf(frontend1), frontendBalanceBefore + 3e6);
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), 0);
    }

    function testFrontendTransferFailureFallsBackToQuestionRewardVoter() public {
        _registerFrontend(frontend1);

        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);
        uint256 roundId = _settleRoundWithFrontend(voters, contentId, directions, frontend1);

        usdc.setBlockedRecipient(frontend1, true);

        uint256 voterBalanceBefore = usdc.balanceOf(voter1);
        uint256 frontendBalanceBefore = usdc.balanceOf(frontend1);

        uint256 quotedReward = rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1);
        assertGt(quotedReward, 0);
        vm.prank(voter1);
        uint256 reward = rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);

        assertGt(reward, quotedReward);
        assertEq(usdc.balanceOf(voter1), voterBalanceBefore + reward);
        assertEq(usdc.balanceOf(frontend1), frontendBalanceBefore);
    }

    /// @dev A frontend mid-unbonding cannot collect bounty fees on rounds it serviced before
    ///      requesting deregistration. The unbonding window is the slashing review period;
    ///      bounty fee routing must mirror the main `claimFees` path's exit-pending guard,
    ///      otherwise USDC fees leak to the operator EOA mid-window.
    function testExitPendingFrontendDoesNotReceiveHistoricalQuestionRewardFees() public {
        _registerFrontend(frontend1);

        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);
        uint256 roundId = _settleRoundWithFrontend(voters, contentId, directions, frontend1);

        vm.prank(frontend1);
        frontendRegistry.requestDeregister();

        uint256 frontendBalanceBefore = usdc.balanceOf(frontend1);
        // Without an eligible frontend recipient, the fee carve-out falls back to the voter.
        _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);

        assertEq(usdc.balanceOf(frontend1), frontendBalanceBefore);
    }

    function testUnregisteredFrontendFeeShareFallsBackToVoterReward() public {
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);
        uint256 roundId = _settleRoundWithFrontend(voters, contentId, directions, frontend1);

        uint256 frontendBalanceBefore = usdc.balanceOf(frontend1);
        _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);

        assertEq(usdc.balanceOf(frontend1), frontendBalanceBefore);
    }

    function testVotingEngineIsPinnedAfterInitialization() public {
        address newEngine = address(0xBEEF);

        vm.prank(owner);
        (bool ok,) = address(rewardPoolEscrow).call(abi.encodeWithSignature("setVotingEngine(address)", newEngine));
        assertFalse(ok);
    }

    function testRegistrySubmissionRewardRejectsStaleEscrowAfterEngineRotation() public {
        RoundVotingEngine replacementEngine = RoundVotingEngine(
            address(
                new ERC1967Proxy(
                    address(new RoundVotingEngine()),
                    abi.encodeCall(
                        RoundVotingEngine.initialize,
                        (owner, address(hrepToken), address(registry), address(protocolConfig))
                    )
                )
            )
        );

        vm.startPrank(owner);
        registry.pause();
        registry.setVotingEngine(address(replacementEngine));
        registry.unpause();
        vm.stopPrank();

        string[] memory imageUrls = new string[](1);
        imageUrls[0] = DEFAULT_MEDIA_URL;
        bytes32 salt = keccak256("stale-engine-reward");
        uint256 rewardAmount = _defaultSubmissionRewardAmount(registry);
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = _defaultSubmissionRewardTerms(registry);
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 3, maxVoters: 200
        });
        (, bytes32 submissionKey) = registry.previewQuestionSubmissionKey(
            "https://example.com/context", imageUrls, "", QUESTION, DESCRIPTION, TAGS, CATEGORY_ID
        );
        bytes32 revealCommitment = _questionRevealCommitment(
            submissionKey,
            _submissionMediaHash(imageUrls, ""),
            QUESTION,
            DESCRIPTION,
            TAGS,
            CATEGORY_ID,
            salt,
            submitter,
            rewardTerms,
            roundConfig
        );

        uint256 submitterBalanceBefore = hrepToken.balanceOf(submitter);
        uint256 escrowBalanceBefore = hrepToken.balanceOf(address(rewardPoolEscrow));
        uint256 nextContentIdBefore = registry.nextContentId();

        vm.startPrank(submitter);
        hrepToken.approve(address(rewardPoolEscrow), rewardAmount);
        registry.reserveSubmission(revealCommitment);
        vm.warp(block.timestamp + 1);
        vm.expectRevert("Stale engine");
        registry.submitQuestionWithRewardAndRoundConfig(
            "https://example.com/context",
            imageUrls,
            "",
            QUESTION,
            DESCRIPTION,
            TAGS,
            CATEGORY_ID,
            salt,
            rewardTerms,
            roundConfig,
            _defaultQuestionSpec()
        );
        vm.stopPrank();

        assertEq(registry.nextContentId(), nextContentIdBefore);
        assertEq(hrepToken.balanceOf(submitter), submitterBalanceBefore);
        assertEq(hrepToken.balanceOf(address(rewardPoolEscrow)), escrowBalanceBefore);
    }

    function testBundleRoundSetCanSyncAfterVotingEngineRotation() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);
        uint256 firstRoundId = _settleRoundWithoutBundleSync(voters, contentIds[0], directions);
        uint256 secondRoundId = _settleRoundWithoutBundleSync(voters, contentIds[1], directions);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), 0);

        RoundVotingEngine replacementEngine = RoundVotingEngine(
            address(
                new ERC1967Proxy(
                    address(new RoundVotingEngine()),
                    abi.encodeCall(
                        RoundVotingEngine.initialize,
                        (owner, address(hrepToken), address(registry), address(protocolConfig))
                    )
                )
            )
        );

        vm.startPrank(owner);
        registry.pause();
        registry.setVotingEngine(address(replacementEngine));
        registry.unpause();
        vm.stopPrank();

        vm.prank(address(votingEngine));
        rewardPoolEscrow.recordBundleQuestionTerminal(contentIds[0], firstRoundId, true);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[1], secondRoundId);

        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), 0);
    }

    function testSetVotingEngineRejectsZeroAddress() public {
        vm.prank(owner);
        (bool ok,) = address(rewardPoolEscrow).call(abi.encodeWithSignature("setVotingEngine(address)", address(0)));
        assertFalse(ok);
    }

    function testSetVotingEngineAlwaysReverts() public {
        vm.prank(voter1);
        (bool ok,) =
            address(rewardPoolEscrow).call(abi.encodeWithSignature("setVotingEngine(address)", address(0xBEEF)));
        assertFalse(ok);
    }

    function testDelegateCanClaimByUnderlyingRaterIdentityOnlyOnce() public {
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        vm.prank(voter1);
        raterIdentityRegistry.setDelegate(delegate1);

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);
        uint256 roundId = _settleRoundWith(voters, contentId, directions);

        vm.prank(delegate1);
        uint256 reward = rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);
        assertEq(usdc.balanceOf(voter1), 1_000e6 + reward);
        assertEq(usdc.balanceOf(delegate1), 1_000e6);

        vm.prank(voter1);
        vm.expectRevert("Already claimed");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);
    }

    function testOpenRoundUsesRaterIdentitySnapshotAfterMigration() public {
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        bytes32 salt1 = keccak256("snapshot-voter-1");
        bytes32 commitKey1 = _commitTestVote(
            DirectTestCommitRequest({
                engine: votingEngine,
                hrepToken: hrepToken,
                voter: voter1,
                contentId: contentId,
                isUp: true,
                stake: STAKE,
                frontend: address(0),
                salt: salt1
            })
        );
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        assertEq(votingEngine.roundRaterRegistrySnapshot(contentId, roundId), address(raterIdentityRegistry));

        MockRaterIdentityRegistry migratedRaterIdentityRegistry = _migrateRaterIdentitiesWithDifferentIds();
        assertNotEq(
            migratedRaterIdentityRegistry.getCredentialId(voter2), raterIdentityRegistry.getCredentialId(voter2)
        );

        bytes32 salt2 = keccak256("snapshot-voter-2");
        bytes32 commitKey2 = _commitTestVote(
            DirectTestCommitRequest({
                engine: votingEngine,
                hrepToken: hrepToken,
                voter: voter2,
                contentId: contentId,
                isUp: true,
                stake: STAKE,
                frontend: address(0),
                salt: salt2
            })
        );
        bytes32 salt3 = keccak256("snapshot-voter-3");
        bytes32 commitKey3 = _commitTestVote(
            DirectTestCommitRequest({
                engine: votingEngine,
                hrepToken: hrepToken,
                voter: voter3,
                contentId: contentId,
                isUp: false,
                stake: STAKE,
                frontend: address(0),
                salt: salt3
            })
        );

        _warpPastTlockRevealTime(block.timestamp + EPOCH_DURATION);
        votingEngine.revealVoteByCommitKey(contentId, roundId, commitKey1, true, 5_000, salt1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, commitKey2, true, 5_000, salt2);
        votingEngine.revealVoteByCommitKey(contentId, roundId, commitKey3, false, 5_000, salt3);
        votingEngine.settleRound(contentId, roundId);

        _claimQuestionRewardAndAssert(voter2, rewardPoolId, roundId);
    }

    function testFunderExclusionUsesRoundRaterIdentitySnapshotAfterMigration() public {
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        address[] memory voters = new address[](4);
        voters[0] = funder;
        voters[1] = voter1;
        voters[2] = voter2;
        voters[3] = voter3;
        bool[] memory directions = _directions(true, true, true, false);
        uint256 roundId = _settleRoundWith(voters, contentId, directions);

        MockRaterIdentityRegistry migratedRaterIdentityRegistry = _migrateRaterIdentitiesWithDifferentIds();
        assertNotEq(
            migratedRaterIdentityRegistry.getCredentialId(funder), raterIdentityRegistry.getCredentialId(funder)
        );

        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, funder), 0);
        vm.prank(funder);
        vm.expectRevert("Excluded voter");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);
    }

    function testStoredFunderRaterIdentityDoesNotExcludeDifferentSnapshotHolder() public {
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);
        uint256 oldFunderRaterIdentity = raterIdentityRegistry.getCredentialId(funder);

        MockRaterIdentityRegistry migratedRaterIdentityRegistry = _migrateRaterIdentitiesWithVoter1AtOldFunderId();
        assertEq(migratedRaterIdentityRegistry.getCredentialId(voter1), oldFunderRaterIdentity);
        assertEq(migratedRaterIdentityRegistry.getCredentialId(funder), 0);

        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));

        _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);
    }

    function testBundleClaimUsesRoundSpecificRaterIdentitiesAfterMigration() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);

        address[] memory voters = new address[](3);
        voters[0] = voter2;
        voters[1] = voter3;
        voters[2] = voter4;
        bool[] memory directions = _directions(true, true, false);

        uint256 firstRoundId = _settleRoundWith(voters, contentIds[0], directions);
        assertEq(votingEngine.roundRaterRegistrySnapshot(contentIds[0], firstRoundId), address(raterIdentityRegistry));

        MockRaterIdentityRegistry migratedRaterIdentityRegistry = _migrateRaterIdentitiesWithDifferentIds();
        assertNotEq(
            migratedRaterIdentityRegistry.getCredentialId(voter2), raterIdentityRegistry.getCredentialId(voter2)
        );

        uint256 secondRoundId = _settleRoundWith(voters, contentIds[1], directions);
        assertEq(
            votingEngine.roundRaterRegistrySnapshot(contentIds[1], secondRoundId),
            address(migratedRaterIdentityRegistry)
        );

        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter2), 0);

        vm.prank(voter2);
        uint256 reward = rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0);

        assertEq(reward, REWARD_POOL_AMOUNT / 3);
        assertEq(usdc.balanceOf(voter2), 1_000e6 + reward);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter2), 0);
    }

    function testBundleClaimQualifiesRecordedRoundSetBeforeClaim() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);

        _settleRoundWithoutBundleSync(voters, contentIds[0], directions);
        _settleRoundWithoutBundleSync(voters, contentIds[1], directions);

        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter2), 0);

        vm.prank(voter2);
        uint256 reward = rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0);

        assertEq(reward, REWARD_POOL_AMOUNT / 3);
        assertEq(usdc.balanceOf(voter2), 1_000e6 + reward);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter2), 0);
    }

    function testBundleRewardsSnapshotAllCompletersAboveMinimum() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);

        address[] memory voters = _fourVoters();
        bool[] memory directions = _directions(true, true, false, true);

        _settleRoundWith(voters, contentIds[0], directions);
        _settleRoundWith(voters, contentIds[1], directions);

        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), REWARD_POOL_AMOUNT / 4);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter4), REWARD_POOL_AMOUNT / 4);

        uint256 totalClaimed;
        for (uint256 i = 0; i < voters.length; i++) {
            vm.prank(voters[i]);
            totalClaimed += rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0);
        }

        assertEq(totalClaimed, REWARD_POOL_AMOUNT);
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), 0);
    }

    function testBundleRewardSupportsOpenWalletCompletersWithoutRaterIdentity() public {
        address openVoter1 = address(211);
        address openVoter2 = address(212);
        address openVoter3 = address(213);
        vm.startPrank(owner);
        hrepToken.mint(openVoter1, 10_000e6);
        hrepToken.mint(openVoter2, 10_000e6);
        hrepToken.mint(openVoter3, 10_000e6);
        vm.stopPrank();

        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);

        address[] memory voters = new address[](3);
        voters[0] = openVoter1;
        voters[1] = openVoter2;
        voters[2] = openVoter3;
        bool[] memory directions = _directions(true, true, false);

        _settleRoundWith(voters, contentIds[0], directions);
        _settleRoundWith(voters, contentIds[1], directions);

        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, openVoter1), REWARD_POOL_AMOUNT / 3);

        vm.prank(openVoter1);
        uint256 reward = rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0);

        assertEq(reward, REWARD_POOL_AMOUNT / 3);
        assertEq(usdc.balanceOf(openVoter1), reward);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, openVoter1), 0);
    }

    function testBundleAboveQuorumQualifiesWhenRequiredCompletersRevealBeforeClose() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 3, maxVoters: 4
        });
        uint256[] memory contentIds = new uint256[](2);
        contentIds[0] = _submitQuestionWithContextAndRoundConfig(
            "https://example.com/bundle-above-before-a", "https://example.com/bundle-above-before-a.jpg", roundConfig
        );
        contentIds[1] = _submitQuestionWithContextAndRoundConfig(
            "https://example.com/bundle-above-before-b", "https://example.com/bundle-above-before-b.jpg", roundConfig
        );
        uint256 closesAt = block.timestamp + 2 * EPOCH_DURATION + 20;
        uint256 bundleId =
            _createSubmissionBundleWithClose(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 4, closesAt);

        uint256 firstRoundId = _revealRoundWith(_fourVoters(), contentIds[0], _directions(true, true, false, true));
        uint256 secondRoundId = _revealRoundWith(_fourVoters(), contentIds[1], _directions(true, true, false, true));
        _assertThresholdReachedAtLe(contentIds[0], firstRoundId, closesAt);
        _assertThresholdReachedAtLe(contentIds[1], secondRoundId, closesAt);

        vm.warp(closesAt + 1);
        votingEngine.settleRound(contentIds[0], firstRoundId);
        votingEngine.settleRound(contentIds[1], secondRoundId);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[1], secondRoundId);

        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), REWARD_POOL_AMOUNT / 4);
    }

    function testBundleAboveQuorumDoesNotQualifyWhenRequiredCompleterRevealsAfterClose() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 3, maxVoters: 4
        });
        uint256[] memory contentIds = new uint256[](2);
        contentIds[0] = _submitQuestionWithContextAndRoundConfig(
            "https://example.com/bundle-above-after-a", "https://example.com/bundle-above-after-a.jpg", roundConfig
        );
        contentIds[1] = _submitQuestionWithContextAndRoundConfig(
            "https://example.com/bundle-above-after-b", "https://example.com/bundle-above-after-b.jpg", roundConfig
        );
        uint256 closesAt = block.timestamp + 2 * EPOCH_DURATION + 20;
        uint256 bundleId =
            _createSubmissionBundleWithClose(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 4, closesAt);

        (uint256 firstRoundId, bytes32 firstLateCommitKey, bytes32 firstLateSalt, bool firstLateDirection) =
            _revealThresholdAndReturnUnrevealed(contentIds[0]);
        (uint256 secondRoundId, bytes32 secondLateCommitKey, bytes32 secondLateSalt, bool secondLateDirection) =
            _revealThresholdAndReturnUnrevealed(contentIds[1]);
        _assertThresholdReachedAtLe(contentIds[0], firstRoundId, closesAt);
        _assertThresholdReachedAtLe(contentIds[1], secondRoundId, closesAt);

        vm.warp(closesAt + 1);
        votingEngine.revealVoteByCommitKey(
            contentIds[0], firstRoundId, firstLateCommitKey, firstLateDirection, 5_000, firstLateSalt
        );
        votingEngine.revealVoteByCommitKey(
            contentIds[1], secondRoundId, secondLateCommitKey, secondLateDirection, 5_000, secondLateSalt
        );
        votingEngine.settleRound(contentIds[0], firstRoundId);
        votingEngine.settleRound(contentIds[1], secondRoundId);

        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), 0);
    }

    function testBundleIgnoresExtraCompleterRevealedAfterClose() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 3, maxVoters: 4
        });
        uint256[] memory contentIds = new uint256[](2);
        contentIds[0] = _submitQuestionWithContextAndRoundConfig(
            "https://example.com/bundle-late-extra-a", "https://example.com/bundle-late-extra-a.jpg", roundConfig
        );
        contentIds[1] = _submitQuestionWithContextAndRoundConfig(
            "https://example.com/bundle-late-extra-b", "https://example.com/bundle-late-extra-b.jpg", roundConfig
        );
        uint256 closesAt = block.timestamp + 2 * EPOCH_DURATION + 20;
        uint256 bundleId =
            _createSubmissionBundleWithClose(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3, closesAt);

        (uint256 firstRoundId, bytes32 firstLateCommitKey, bytes32 firstLateSalt, bool firstLateDirection) =
            _revealThresholdAndReturnUnrevealed(contentIds[0]);
        (uint256 secondRoundId, bytes32 secondLateCommitKey, bytes32 secondLateSalt, bool secondLateDirection) =
            _revealThresholdAndReturnUnrevealed(contentIds[1]);
        _assertThresholdReachedAtLe(contentIds[0], firstRoundId, closesAt);
        _assertThresholdReachedAtLe(contentIds[1], secondRoundId, closesAt);

        vm.warp(closesAt + 1);
        votingEngine.revealVoteByCommitKey(
            contentIds[0], firstRoundId, firstLateCommitKey, firstLateDirection, 5_000, firstLateSalt
        );
        votingEngine.revealVoteByCommitKey(
            contentIds[1], secondRoundId, secondLateCommitKey, secondLateDirection, 5_000, secondLateSalt
        );
        votingEngine.settleRound(contentIds[0], firstRoundId);
        votingEngine.settleRound(contentIds[1], secondRoundId);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[1], secondRoundId);

        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), REWARD_POOL_AMOUNT / 3);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter4), 0);

        vm.prank(voter4);
        vm.expectRevert("Bundle incomplete");
        rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0);

        vm.prank(voter1);
        assertEq(rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0), REWARD_POOL_AMOUNT / 3);
    }

    function testBundleClaimSupportsMultipleRoundSets() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleAmount = 120e6;
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, bundleAmount, 3, 2);

        address[] memory voters = new address[](3);
        voters[0] = voter2;
        voters[1] = voter3;
        voters[2] = voter4;
        bool[] memory directions = _directions(true, true, false);

        _settleRoundWith(voters, contentIds[0], directions);
        _settleRoundWith(voters, contentIds[1], directions);
        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter2), 0);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 1, voter2), 0);

        vm.warp(block.timestamp + 25 hours);
        _settleRoundWith(voters, contentIds[0], directions);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 1, voter2), 0);

        _settleRoundWith(voters, contentIds[1], directions);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 1, voter2), 20e6);

        vm.prank(voter2);
        uint256 firstReward = rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0);
        vm.prank(voter2);
        uint256 secondReward = rewardPoolEscrow.claimQuestionBundleReward(bundleId, 1);

        assertEq(firstReward, 20e6);
        assertEq(secondReward, 20e6);
        assertEq(usdc.balanceOf(voter2), 1_000e6 + firstReward + secondReward);
    }

    function testSyncBundleQuestionTerminalDoesNotReplaySameRoundIntoLaterRoundSet() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, 120e6, 3, 2);

        address[] memory voters = new address[](3);
        voters[0] = voter2;
        voters[1] = voter3;
        voters[2] = voter4;
        bool[] memory directions = _directions(true, true, false);

        uint256 firstQuestionRoundId = _settleRoundWith(voters, contentIds[0], directions);
        uint256 secondQuestionRoundId = _settleRoundWith(voters, contentIds[1], directions);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter2), 20e6);

        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[0], firstQuestionRoundId);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[1], secondQuestionRoundId);

        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 1, voter2), 0);
    }

    function testBundleRewardCannotReplayAfterRaterIdentityRemintWithSameNullifier() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);
        uint256 nullifier = 222_222;
        raterIdentityRegistry.mint(voter2, nullifier);

        address[] memory voters = new address[](3);
        voters[0] = voter2;
        voters[1] = voter3;
        voters[2] = voter4;
        bool[] memory directions = _directions(true, true, false);

        _settleRoundWith(voters, contentIds[0], directions);
        _settleRoundWith(voters, contentIds[1], directions);

        vm.prank(voter2);
        uint256 firstReward = rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0);
        assertEq(firstReward, REWARD_POOL_AMOUNT / 3);

        raterIdentityRegistry.resetNullifier(nullifier);
        raterIdentityRegistry.mint(voter2, nullifier);

        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter2), 0);
        vm.prank(voter2);
        vm.expectRevert("Already claimed");
        rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0);
    }

    function testBundleRoundSetCountsCompleterAfterRaterIdentityRemintWithSameNullifier() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);
        uint256 nullifier = 222_223;
        raterIdentityRegistry.mint(voter2, nullifier);

        address[] memory voters = new address[](3);
        voters[0] = voter2;
        voters[1] = voter3;
        voters[2] = voter4;
        bool[] memory directions = _directions(true, true, false);

        _settleRoundWith(voters, contentIds[0], directions);
        raterIdentityRegistry.revokeHumanCredential(voter2);
        raterIdentityRegistry.resetNullifier(nullifier);
        raterIdentityRegistry.mint(voter2, nullifier);
        _settleRoundWith(voters, contentIds[1], directions);

        uint256 claimable = rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter2);
        assertEq(claimable, REWARD_POOL_AMOUNT / 3);
    }

    function testBundleFunderNullifierStaysExcludedAfterRemintToDifferentAddress() public {
        address remintedFunder = address(0xF00D);
        uint256 nullifier = 222_224;
        raterIdentityRegistry.mint(funder, nullifier);
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);

        raterIdentityRegistry.revokeHumanCredential(funder);
        raterIdentityRegistry.resetNullifier(nullifier);
        raterIdentityRegistry.mint(remintedFunder, nullifier);
        vm.prank(owner);
        hrepToken.mint(remintedFunder, 10_000e6);

        address[] memory voters = new address[](3);
        voters[0] = remintedFunder;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory directions = _directions(true, true, false);

        _settleRoundWith(voters, contentIds[0], directions);
        _settleRoundWith(voters, contentIds[1], directions);

        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, remintedFunder), 0);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter2), 0);
    }

    function testBundleDelegatedFunderStaysExcludedAfterAgentReassignment() public {
        address voter5 = address(0x55);
        raterIdentityRegistry.setHolder(voter5);
        vm.prank(owner);
        hrepToken.mint(voter5, 10_000e6);
        vm.prank(owner);
        hrepToken.mint(delegate1, 10_000e6);

        uint256[] memory contentIds = _submitBundleQuestions();
        vm.prank(voter1);
        raterIdentityRegistry.setDelegate(delegate1);
        uint256 bundleId = _createSubmissionBundle(contentIds, delegate1, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);
        vm.prank(voter1);
        raterIdentityRegistry.removeDelegate();
        vm.prank(voter3);
        raterIdentityRegistry.setDelegate(delegate1);

        address[] memory voters = new address[](4);
        voters[0] = delegate1;
        voters[1] = voter2;
        voters[2] = voter4;
        voters[3] = voter5;
        bool[] memory directions = _directions(true, true, false, true);

        _settleRoundWith(voters, contentIds[0], directions);
        _settleRoundWith(voters, contentIds[1], directions);

        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, delegate1), 0);
        vm.prank(delegate1);
        vm.expectRevert("Excluded voter");
        rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0);
    }

    function testBundleSubmitterNullifierStaysExcludedAfterRemintToDifferentAddress() public {
        address remintedSubmitter = address(0x5A1D);
        uint256 nullifier = 222_225;
        raterIdentityRegistry.mint(submitter, nullifier);
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);

        raterIdentityRegistry.revokeHumanCredential(submitter);
        raterIdentityRegistry.resetNullifier(nullifier);
        raterIdentityRegistry.mint(remintedSubmitter, nullifier);
        vm.prank(owner);
        hrepToken.mint(remintedSubmitter, 10_000e6);

        _expectSelfVoteCommitRevert(remintedSubmitter, contentIds[0], keccak256("bundle-reminted-submitter"));

        address[] memory voters = new address[](3);
        voters[0] = voter2;
        voters[1] = voter3;
        voters[2] = voter4;
        bool[] memory directions = _directions(true, true, false);

        _settleRoundWith(voters, contentIds[0], directions);
        _settleRoundWith(voters, contentIds[1], directions);

        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, remintedSubmitter), 0);
        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter2), 0);
    }

    function testBundleClaimRecordsOutOfOrderFutureRoundSetTerminal() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, 120e6, 3, 2);

        address[] memory firstSetVoters = new address[](3);
        firstSetVoters[0] = voter2;
        firstSetVoters[1] = voter3;
        firstSetVoters[2] = voter4;
        address[] memory secondSetVoters = new address[](3);
        secondSetVoters[0] = address(20);
        secondSetVoters[1] = address(21);
        secondSetVoters[2] = address(22);
        vm.startPrank(owner);
        for (uint256 i = 0; i < secondSetVoters.length; i++) {
            raterIdentityRegistry.setHolder(secondSetVoters[i]);
            hrepToken.mint(secondSetVoters[i], 10_000e6);
        }
        vm.stopPrank();
        bool[] memory directions = _directions(true, true, false);

        _settleRoundWith(firstSetVoters, contentIds[0], directions);
        _settleRoundWith(secondSetVoters, contentIds[0], directions);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter2), 0);

        _settleRoundWith(firstSetVoters, contentIds[1], directions);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter2), 20e6);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 1, secondSetVoters[0]), 0);

        _settleRoundWith(secondSetVoters, contentIds[1], directions);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 1, secondSetVoters[0]), 20e6);
    }

    function testBundleRoundSetDoesNotQualifyWithoutRequiredCompleterIntersection() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);

        address[] memory firstQuestionVoters = new address[](3);
        firstQuestionVoters[0] = voter1;
        firstQuestionVoters[1] = voter2;
        firstQuestionVoters[2] = voter3;
        address[] memory secondQuestionVoters = new address[](3);
        secondQuestionVoters[0] = voter2;
        secondQuestionVoters[1] = voter3;
        secondQuestionVoters[2] = voter4;
        bool[] memory directions = _directions(true, true, false);

        _settleRoundWith(firstQuestionVoters, contentIds[0], directions);
        _settleRoundWith(secondQuestionVoters, contentIds[1], directions);

        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter2), 0);

        vm.prank(voter2);
        vm.expectRevert("Bundle not claimable");
        rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0);
    }

    function testBundleRoundSetRetriesAfterInsufficientCompleterIntersection() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);

        address[] memory firstQuestionVoters = new address[](3);
        firstQuestionVoters[0] = voter1;
        firstQuestionVoters[1] = voter2;
        firstQuestionVoters[2] = voter3;
        address[] memory secondQuestionVoters = new address[](3);
        secondQuestionVoters[0] = voter2;
        secondQuestionVoters[1] = voter3;
        secondQuestionVoters[2] = voter4;
        bool[] memory directions = _directions(true, true, false);

        _settleRoundWith(firstQuestionVoters, contentIds[0], directions);
        _settleRoundWith(secondQuestionVoters, contentIds[1], directions);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter2), 0);

        vm.warp(block.timestamp + 25 hours);
        _settleRoundWith(firstQuestionVoters, contentIds[0], directions);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter2), 0);
        _settleRoundWith(firstQuestionVoters, contentIds[1], directions);

        uint256 claimable = rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter2);
        assertEq(claimable, REWARD_POOL_AMOUNT / 3);
        vm.prank(voter2);
        uint256 reward = rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0);
        assertEq(reward, claimable);
    }

    function testSyncBundleQuestionTerminalDoesNotReplayFailedRoundIntoRetrySet() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);

        address[] memory firstQuestionVoters = new address[](3);
        firstQuestionVoters[0] = voter1;
        firstQuestionVoters[1] = voter2;
        firstQuestionVoters[2] = voter3;
        address[] memory secondQuestionVoters = new address[](3);
        secondQuestionVoters[0] = voter2;
        secondQuestionVoters[1] = voter3;
        secondQuestionVoters[2] = voter4;
        bool[] memory directions = _directions(true, true, false);

        _settleRoundWith(firstQuestionVoters, contentIds[0], directions);
        uint256 staleSecondRoundId = _settleRoundWith(secondQuestionVoters, contentIds[1], directions);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter2), 0);

        vm.warp(block.timestamp + 25 hours);
        _settleRoundWith(firstQuestionVoters, contentIds[0], directions);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[1], staleSecondRoundId);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter2), 0);

        _settleRoundWith(firstQuestionVoters, contentIds[1], directions);
        uint256 claimable = rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter2);
        assertEq(claimable, REWARD_POOL_AMOUNT / 3);
    }

    function testSubmissionBundleRequiresFundingForMaxCompleters() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 3, maxVoters: 4
        });
        uint256[] memory contentIds = new uint256[](2);
        contentIds[0] = _submitQuestionWithContextAndRoundConfig(
            "https://example.com/bundle-underfunded-a", "https://example.com/bundle-underfunded-a.jpg", roundConfig
        );
        contentIds[1] = _submitQuestionWithContextAndRoundConfig(
            "https://example.com/bundle-underfunded-b", "https://example.com/bundle-underfunded-b.jpg", roundConfig
        );

        uint256 amount = 3;
        vm.prank(funder);
        usdc.approve(address(rewardPoolEscrow), amount);

        uint256 bountyClosesAt = block.timestamp + 30 days;
        vm.expectRevert("Amount too small");
        vm.prank(address(registry));
        rewardPoolEscrow.createSubmissionBundleFromRegistry(
            1, contentIds, funder, REWARD_ASSET_USDC, amount, 3, 1, bountyClosesAt, bountyClosesAt
        );
    }

    function testSubmissionBundleFundedAtMaxCompletersQualifies() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 3, maxVoters: 4
        });
        uint256[] memory contentIds = new uint256[](2);
        contentIds[0] = _submitQuestionWithContextAndRoundConfig(
            "https://example.com/bundle-funded-a", "https://example.com/bundle-funded-a.jpg", roundConfig
        );
        contentIds[1] = _submitQuestionWithContextAndRoundConfig(
            "https://example.com/bundle-funded-b", "https://example.com/bundle-funded-b.jpg", roundConfig
        );
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, 4, 3);

        address[] memory overfullVoters = _fourVoters();
        bool[] memory overfullDirections = _directions(true, true, false, true);
        _settleRoundWith(overfullVoters, contentIds[0], overfullDirections);
        _settleRoundWith(overfullVoters, contentIds[1], overfullDirections);

        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), 1);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter4), 1);
    }

    function testBundleRoundSetRetryIgnoresFutureRoundsRecordedBeforeReset() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, 120e6, 3, 2);

        address staleCompleter1 = address(20);
        address staleCompleter2 = address(21);
        address staleCompleter3 = address(22);
        address retryCompleter1 = address(23);
        address retryCompleter2 = address(24);
        address retryCompleter3 = address(25);
        address[] memory extraVoters = new address[](6);
        extraVoters[0] = staleCompleter1;
        extraVoters[1] = staleCompleter2;
        extraVoters[2] = staleCompleter3;
        extraVoters[3] = retryCompleter1;
        extraVoters[4] = retryCompleter2;
        extraVoters[5] = retryCompleter3;
        vm.startPrank(owner);
        for (uint256 i = 0; i < extraVoters.length; i++) {
            raterIdentityRegistry.setHolder(extraVoters[i]);
            hrepToken.mint(extraVoters[i], 10_000e6);
        }
        vm.stopPrank();

        address[] memory firstQuestionVoters = new address[](3);
        firstQuestionVoters[0] = voter1;
        firstQuestionVoters[1] = voter2;
        firstQuestionVoters[2] = voter3;
        address[] memory secondQuestionVoters = new address[](3);
        secondQuestionVoters[0] = voter2;
        secondQuestionVoters[1] = voter3;
        secondQuestionVoters[2] = voter4;
        address[] memory staleCompleters = new address[](3);
        staleCompleters[0] = staleCompleter1;
        staleCompleters[1] = staleCompleter2;
        staleCompleters[2] = staleCompleter3;
        address[] memory retryCompleters = new address[](3);
        retryCompleters[0] = retryCompleter1;
        retryCompleters[1] = retryCompleter2;
        retryCompleters[2] = retryCompleter3;
        bool[] memory directions = _directions(true, true, false);

        _settleRoundWith(firstQuestionVoters, contentIds[0], directions);
        vm.warp(block.timestamp + 2 days);
        _settleRoundWith(staleCompleters, contentIds[0], directions);
        _settleRoundWith(secondQuestionVoters, contentIds[1], directions);

        vm.warp(block.timestamp + 2 days);
        _settleRoundWith(retryCompleters, contentIds[0], directions);
        _settleRoundWith(retryCompleters, contentIds[1], directions);
        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, retryCompleter1), 0);

        vm.warp(block.timestamp + 2 days);
        _settleRoundWith(staleCompleters, contentIds[1], directions);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 1, staleCompleter1), 0);
    }

    function testBundleRoundSetResetClearsPoisonedFutureFloor() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, 120e6, 3, 2);

        address[12] memory extraVoters = [
            address(30),
            address(31),
            address(32),
            address(33),
            address(34),
            address(35),
            address(36),
            address(37),
            address(38),
            address(39),
            address(40),
            address(41)
        ];
        address[] memory firstQuestionSet0 = _voters(voter1, voter2, voter3);
        address[] memory retrySet0 = _voters(extraVoters[0], extraVoters[1], extraVoters[2]);
        address[] memory retrySet1 = _voters(extraVoters[3], extraVoters[4], extraVoters[5]);
        address[] memory poisonedFuture = _voters(extraVoters[6], extraVoters[7], extraVoters[8]);
        bool[] memory directions = _directions(true, true, false);

        _settleRoundWith(firstQuestionSet0, contentIds[0], directions);

        vm.startPrank(owner);
        for (uint256 i = 0; i < extraVoters.length; i++) {
            raterIdentityRegistry.setHolder(extraVoters[i]);
            hrepToken.mint(extraVoters[i], 10_000e6);
        }
        MockQuestionRewardPoolEscrow mockEscrow = new MockQuestionRewardPoolEscrow();
        registry.pause();
        registry.setQuestionRewardPoolEscrow(address(mockEscrow));
        registry.unpause();
        vm.stopPrank();

        vm.warp(block.timestamp + 2 days);
        uint256 retryQuestion0Round = _settleRoundWith(retrySet0, contentIds[0], directions);
        vm.warp(block.timestamp + 2 days);
        uint256 secondQuestion0Round = _settleRoundWith(retrySet1, contentIds[0], directions);
        vm.warp(block.timestamp + 2 days);
        uint256 poisonedQuestion0Round = _settleRoundWith(poisonedFuture, contentIds[0], directions);

        vm.startPrank(owner);
        registry.pause();
        registry.setQuestionRewardPoolEscrow(address(rewardPoolEscrow));
        registry.unpause();
        vm.stopPrank();
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[0], poisonedQuestion0Round);

        _settleRoundWith(_voters(extraVoters[9], extraVoters[10], extraVoters[11]), contentIds[1], directions);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), 0);

        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[0], retryQuestion0Round);
        vm.warp(block.timestamp + 2 days);
        _settleRoundWith(retrySet0, contentIds[1], directions);
        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, extraVoters[0]), 0);

        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[0], secondQuestion0Round);
        vm.warp(block.timestamp + 2 days);
        _settleRoundWith(retrySet1, contentIds[1], directions);
        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 1, extraVoters[3]), 0);
    }

    function testBundleRoundSetCountsDelegateCommitAfterDelegateRemoval() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);
        vm.prank(owner);
        hrepToken.mint(delegate1, 10_000e6);

        vm.prank(voter2);
        raterIdentityRegistry.setDelegate(delegate1);

        address[] memory firstQuestionVoters = new address[](3);
        firstQuestionVoters[0] = delegate1;
        firstQuestionVoters[1] = voter3;
        firstQuestionVoters[2] = voter4;
        address[] memory secondQuestionVoters = new address[](3);
        secondQuestionVoters[0] = voter2;
        secondQuestionVoters[1] = voter3;
        secondQuestionVoters[2] = voter4;
        bool[] memory directions = _directions(true, true, false);

        _settleRoundWith(firstQuestionVoters, contentIds[0], directions);
        vm.prank(voter2);
        raterIdentityRegistry.removeDelegate();
        _settleRoundWith(secondQuestionVoters, contentIds[1], directions);

        uint256 claimable = rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter2);
        assertEq(claimable, REWARD_POOL_AMOUNT / 3);
    }

    function testBundleRewardPaysRaterIdentityHolderWhenNewDelegateClaims() public {
        address newDelegate = address(0xD1E);
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);
        vm.prank(owner);
        hrepToken.mint(delegate1, 10_000e6);

        vm.prank(voter1);
        raterIdentityRegistry.setDelegate(delegate1);

        address[] memory voters = new address[](3);
        voters[0] = delegate1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory directions = _directions(true, true, false);
        _settleRoundWith(voters, contentIds[0], directions);
        _settleRoundWith(voters, contentIds[1], directions);

        vm.prank(voter1);
        raterIdentityRegistry.removeDelegate();
        vm.prank(voter1);
        raterIdentityRegistry.setDelegate(newDelegate);

        uint256 holderBalanceBefore = usdc.balanceOf(voter1);
        uint256 delegateBalanceBefore = usdc.balanceOf(newDelegate);

        vm.prank(newDelegate);
        uint256 reward = rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0);

        assertEq(reward, REWARD_POOL_AMOUNT / 3);
        assertEq(usdc.balanceOf(voter1), holderBalanceBefore + reward);
        assertEq(usdc.balanceOf(newDelegate), delegateBalanceBefore);
    }

    function testFunderAndSubmitterRaterIdentitiesAreExcludedFromRewardPoolClaims() public {
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        address[] memory voters = new address[](4);
        voters[0] = funder;
        voters[1] = voter1;
        voters[2] = voter2;
        voters[3] = voter3;
        bool[] memory directions = new bool[](4);
        directions[0] = true;
        directions[1] = true;
        directions[2] = true;
        directions[3] = false;
        uint256 roundId = _settleRoundWith(voters, contentId, directions);

        vm.prank(funder);
        vm.expectRevert("Excluded voter");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);

        _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);
    }

    function testSubmitterSnapshotKeepsOldRaterIdentityExcludedAfterRemint() public {
        uint256 contentId = _submitQuestion("");
        uint256 submitterSnapshotRaterIdentity = raterIdentityRegistry.getCredentialId(submitter);
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        raterIdentityRegistry.mint(submitter, 999);
        assertNotEq(raterIdentityRegistry.getCredentialId(submitter), submitterSnapshotRaterIdentity);

        uint256 roundId = 1;
        _mockSettledRound(contentId, roundId, 2);
        _mockRevealedCommitForRaterIdentity(contentId, roundId, submitterSnapshotRaterIdentity, submitter);
        _mockRevealedCommitForRaterIdentity(contentId, roundId, raterIdentityRegistry.getCredentialId(voter1), voter1);

        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);
        vm.prank(voter1);
        vm.expectRevert("Too few eligible voters");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);
    }

    function testDelegatedFunderStaysExcludedAfterDelegateRemoval() public {
        uint256 contentId = _submitQuestion("");

        vm.prank(voter1);
        raterIdentityRegistry.setDelegate(delegate1);
        uint256 rewardPoolId = _createRewardPoolAs(delegate1, contentId, REWARD_POOL_AMOUNT, 3, 1);
        vm.prank(voter1);
        raterIdentityRegistry.removeDelegate();

        address[] memory voters = new address[](4);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        voters[3] = voter4;
        uint256 roundId = _settleRoundWith(voters, contentId, _directions(true, true, true, false));

        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);
        vm.prank(voter1);
        vm.expectRevert("Excluded voter");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);

        _claimQuestionRewardAndAssert(voter2, rewardPoolId, roundId);
    }

    function testFunderNullifierStaysExcludedAfterRemint() public {
        raterIdentityRegistry.mint(funder, 333_001);
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        raterIdentityRegistry.revokeHumanCredential(funder);
        raterIdentityRegistry.resetNullifier(333_001);
        raterIdentityRegistry.mint(voter1, 333_001);

        address[] memory voters = new address[](4);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        voters[3] = voter4;
        uint256 roundId = _settleRoundWith(voters, contentId, _directions(true, true, true, false));

        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);
        vm.prank(voter1);
        vm.expectRevert("Excluded voter");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);

        _claimQuestionRewardAndAssert(voter2, rewardPoolId, roundId);
    }

    function testSubmitterNullifierStaysExcludedAfterRemint() public {
        raterIdentityRegistry.mint(submitter, 333_002);
        uint256 contentId = _submitQuestion("");
        assertEq(registry.contentSubmitterIdentityKey(contentId), bytes32(uint256(333_002)));

        raterIdentityRegistry.revokeHumanCredential(submitter);
        raterIdentityRegistry.resetNullifier(333_002);
        raterIdentityRegistry.mint(voter1, 333_002);

        _expectSelfVoteCommitRevert(voter1, contentId, keccak256("reminted-submitter-self-vote"));
    }

    function testRemintedSubmitterCannotVoteOnOwnQuestion() public {
        raterIdentityRegistry.mint(submitter, 333_003);
        uint256 contentId = _submitQuestion("");
        assertEq(registry.contentSubmitterIdentityKey(contentId), bytes32(uint256(333_003)));

        raterIdentityRegistry.revokeHumanCredential(submitter);
        raterIdentityRegistry.resetNullifier(333_003);
        address remintedSubmitter = address(0x5A1D);
        raterIdentityRegistry.mint(remintedSubmitter, 333_003);
        vm.prank(owner);
        hrepToken.mint(remintedSubmitter, 10_000e6);

        _expectSelfVoteCommitRevert(remintedSubmitter, contentId, keccak256("reminted-submitter-self-vote-2"));
    }

    function testDelegatedFunderStaysExcludedAfterAgentReassignment() public {
        uint256 contentId = _submitQuestion("");

        vm.prank(voter1);
        raterIdentityRegistry.setDelegate(delegate1);
        uint256 rewardPoolId = _createRewardPoolAs(delegate1, contentId, REWARD_POOL_AMOUNT, 3, 1);
        vm.prank(voter1);
        raterIdentityRegistry.removeDelegate();
        vm.prank(voter3);
        raterIdentityRegistry.setDelegate(delegate1);

        address[] memory voters = new address[](5);
        voters[0] = voter1;
        voters[1] = voter3;
        voters[2] = voter2;
        voters[3] = voter4;
        voters[4] = funder;
        bool[] memory directions = new bool[](5);
        directions[0] = true;
        directions[1] = true;
        directions[2] = true;
        directions[3] = true;
        directions[4] = false;
        uint256 roundId = _settleRoundWith(voters, contentId, directions);

        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);
        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, delegate1), 0);

        vm.prank(voter1);
        vm.expectRevert("Excluded voter");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);

        vm.prank(delegate1);
        vm.expectRevert("Excluded voter");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);

        _claimQuestionRewardAndAssert(voter2, rewardPoolId, roundId);
    }

    function testDelegatedFunderCannotQualifyRoundAfterDelegateRemoval() public {
        uint256 contentId = _submitQuestion("");

        vm.prank(voter1);
        raterIdentityRegistry.setDelegate(delegate1);
        uint256 rewardPoolId = _createRewardPoolAs(delegate1, contentId, REWARD_POOL_AMOUNT, 3, 1);
        vm.prank(voter1);
        raterIdentityRegistry.removeDelegate();

        address[] memory voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        uint256 roundId = _settleRoundWith(voters, contentId, _directions(true, true, false));

        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter2), 0);
        vm.prank(voter2);
        vm.expectRevert("Too few eligible voters");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);
    }

    function testDelegatedFunderStaysExcludedAfterDelegateRemovalAndRaterIdentityMigration() public {
        uint256 contentId = _submitQuestion("");

        vm.prank(voter2);
        raterIdentityRegistry.setDelegate(delegate1);
        uint256 originalRaterIdentity = raterIdentityRegistry.getCredentialId(voter2);
        uint256 rewardPoolId = _createRewardPoolAs(delegate1, contentId, REWARD_POOL_AMOUNT, 3, 1);
        vm.prank(voter2);
        raterIdentityRegistry.removeDelegate();

        MockRaterIdentityRegistry migratedRaterIdentityRegistry = _migrateRaterIdentitiesWithDifferentIds();
        assertNotEq(migratedRaterIdentityRegistry.getCredentialId(voter2), originalRaterIdentity);

        address[] memory voters = new address[](4);
        voters[0] = voter2;
        voters[1] = voter1;
        voters[2] = voter3;
        voters[3] = voter4;
        uint256 roundId = _settleRoundWith(voters, contentId, _directions(true, true, true, false));

        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter2), 0);
        vm.prank(voter2);
        vm.expectRevert("Excluded voter");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);

        _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);
    }

    function testQuestionRewardPaysRaterIdentityHolderWhenNewDelegateClaims() public {
        address newDelegate = address(0xD1E);
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        vm.prank(owner);
        hrepToken.mint(delegate1, 10_000e6);
        vm.prank(voter1);
        raterIdentityRegistry.setDelegate(delegate1);

        address[] memory voters = new address[](3);
        voters[0] = delegate1;
        voters[1] = voter2;
        voters[2] = voter3;
        uint256 roundId = _settleRoundWith(voters, contentId, _directions(true, true, false));

        vm.prank(voter1);
        raterIdentityRegistry.removeDelegate();
        vm.prank(voter1);
        raterIdentityRegistry.setDelegate(newDelegate);

        uint256 holderBalanceBefore = usdc.balanceOf(voter1);
        uint256 delegateBalanceBefore = usdc.balanceOf(newDelegate);

        uint256 reward = _claimQuestionRewardAndAssert(newDelegate, rewardPoolId, roundId);

        assertEq(usdc.balanceOf(voter1), holderBalanceBefore + reward);
        assertEq(usdc.balanceOf(newDelegate), delegateBalanceBefore);
    }

    function testSettledRoundCanQualifyAfterPoolExpires() public {
        uint256 contentId = _submitQuestion("");
        uint256 expiresAt = block.timestamp + EPOCH_DURATION + 10;
        uint256 rewardPoolId = _createRewardPoolWithExpiry(contentId, REWARD_POOL_AMOUNT, 3, 1, expiresAt);

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);
        uint256 roundId = _settleRoundWith(voters, contentId, directions);

        vm.warp(expiresAt + 1);

        vm.expectRevert(QuestionRewardPoolEscrow.RewardPoolCursorNeedsAdvance.selector);
        rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId);

        _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);
    }

    function testOpenRoundThatReachedThresholdBeforeExpiryBlocksRefundAndCanQualify() public {
        uint256 contentId = _submitQuestion("");
        uint256 expiresAt = block.timestamp + EPOCH_DURATION + 10;
        uint256 rewardPoolId = _createRewardPoolWithExpiry(contentId, REWARD_POOL_AMOUNT, 3, 1, expiresAt);

        address[] memory voters = _threeVoters();
        uint256 roundId = _revealRoundWith(voters, contentId, _directions(true, true, false));

        vm.warp(expiresAt + 1);

        vm.expectRevert(QuestionRewardPoolEscrow.RewardPoolCursorNeedsAdvance.selector);
        rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId);

        votingEngine.settleRound(contentId, roundId);
        _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);
    }

    function testOpenRoundWithTimelyRequiredVotersBelowQuorumBlocksRefundAndCanQualify() public {
        address voter5 = address(0x55);
        _registerTestVoter(voter5);
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 5, maxVoters: 5
        });
        uint256 contentId =
            _submitQuestionWithRoundConfig("https://example.com/below-quorum-before-close.jpg", roundConfig);
        uint256 expiresAt = block.timestamp + EPOCH_DURATION + 10;
        uint256 rewardPoolId = _createRewardPoolWithExpiry(contentId, REWARD_POOL_AMOUNT, 3, 1, expiresAt);

        (uint256 roundId, bytes32[5] memory salts, bytes32[5] memory commitKeys) =
            _commitFiveVoterT1Round(contentId, voter5, "timely-below-quorum");
        _warpPastTlockRevealTime(block.timestamp + EPOCH_DURATION);
        _revealFiveVoterT1Round(contentId, roundId, salts, commitKeys, 0, 3);
        assertEq(RoundEngineReadHelpers.round(votingEngine, contentId, roundId).thresholdReachedAt, 0);

        vm.warp(expiresAt + 1);
        vm.expectRevert(QuestionRewardPoolEscrow.RewardPoolCursorNeedsAdvance.selector);
        rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId);

        _revealFiveVoterT1Round(contentId, roundId, salts, commitKeys, 3, 5);
        assertGt(RoundEngineReadHelpers.round(votingEngine, contentId, roundId).thresholdReachedAt, expiresAt);
        votingEngine.settleRound(contentId, roundId);

        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);
        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter4), 0);

        _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);
    }

    function testRewardPoolAboveQuorumQualifiesWhenRequiredVotersRevealBeforeClose() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 3, maxVoters: 4
        });
        uint256 contentId =
            _submitQuestionWithRoundConfig("https://example.com/above-quorum-before-close.jpg", roundConfig);
        uint256 expiresAt = block.timestamp + EPOCH_DURATION + 10;
        uint256 rewardPoolId = _createRewardPoolWithExpiry(contentId, REWARD_POOL_AMOUNT, 4, 1, expiresAt);

        uint256 roundId = _revealRoundWith(_fourVoters(), contentId, _directions(true, true, false, true));
        _assertThresholdReachedAtLe(contentId, roundId, expiresAt);

        vm.warp(expiresAt + 1);
        votingEngine.settleRound(contentId, roundId);

        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);
    }

    function testRewardPoolAboveQuorumDoesNotQualifyWhenRequiredVoterRevealsAfterClose() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 3, maxVoters: 4
        });
        uint256 contentId =
            _submitQuestionWithRoundConfig("https://example.com/above-quorum-after-close.jpg", roundConfig);
        uint256 expiresAt = block.timestamp + EPOCH_DURATION + 10;
        uint256 rewardPoolId = _createRewardPoolWithExpiry(contentId, REWARD_POOL_AMOUNT, 4, 1, expiresAt);

        (uint256 roundId, bytes32 lateCommitKey, bytes32 lateSalt, bool lateDirection) =
            _revealThresholdAndReturnUnrevealed(contentId);
        _assertThresholdReachedAtLe(contentId, roundId, expiresAt);

        vm.warp(expiresAt + 1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, lateCommitKey, lateDirection, 5_000, lateSalt);
        votingEngine.settleRound(contentId, roundId);

        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);

        rewardPoolEscrow.advanceQualificationCursor(rewardPoolId, 1);
        uint256 funderBalanceBefore = usdc.balanceOf(funder);
        vm.prank(funder);
        uint256 refundAmount = rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId);
        assertEq(refundAmount, REWARD_POOL_AMOUNT);
        assertEq(usdc.balanceOf(funder), funderBalanceBefore + refundAmount);
    }

    function testRewardPoolIgnoresExtraVoterRevealedAfterClose() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 3, maxVoters: 4
        });
        uint256 contentId = _submitQuestionWithRoundConfig("https://example.com/min-quorum-late-extra.jpg", roundConfig);
        uint256 expiresAt = block.timestamp + EPOCH_DURATION + 10;
        uint256 rewardPoolId = _createRewardPoolWithExpiry(contentId, REWARD_POOL_AMOUNT, 3, 1, expiresAt);

        (uint256 roundId, bytes32 lateCommitKey, bytes32 lateSalt, bool lateDirection) =
            _revealThresholdAndReturnUnrevealed(contentId);
        _assertThresholdReachedAtLe(contentId, roundId, expiresAt);

        vm.warp(expiresAt + 1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, lateCommitKey, lateDirection, 5_000, lateSalt);
        votingEngine.settleRound(contentId, roundId);

        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);
        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter4), 0);

        vm.prank(voter4);
        vm.expectRevert("Vote not revealed");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);

        _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);
    }

    function testCompletedPoolRefundRequiresGraceAndSweepsUnclaimedRewards() public {
        uint256 contentId = _submitQuestion("");
        uint256 expiresAt = block.timestamp + EPOCH_DURATION + 10;
        uint256 rewardPoolId = _createRewardPoolWithExpiry(contentId, REWARD_POOL_AMOUNT, 3, 1, expiresAt);

        address[] memory voters = _threeVoters();
        uint256 roundId = _settleRoundWith(voters, contentId, _directions(true, true, false));

        vm.prank(voter1);
        uint256 claimed = rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);

        vm.warp(expiresAt + 1);
        vm.expectRevert("Grace");
        rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId);

        vm.warp(expiresAt + BUNDLE_CLAIM_GRACE + 1);
        uint256 funderBalanceBefore = usdc.balanceOf(funder);
        uint256 refundAmount = rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId);
        assertEq(refundAmount, REWARD_POOL_AMOUNT - claimed);
        assertEq(usdc.balanceOf(funder), funderBalanceBefore + refundAmount);
        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter2), 0);
    }

    function testCompletedOpenEndedSubmissionPoolCanForfeitUnclaimedRewardsAfterGrace() public {
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = contentId;
        uint256 rewardAmount = _defaultSubmissionRewardAmount(registry);

        address[] memory voters = _threeVoters();
        uint256 roundId = _settleRoundWith(voters, contentId, _directions(true, true, false));

        vm.prank(voter1);
        uint256 claimed = rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);

        vm.expectRevert("Grace");
        rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId);

        vm.warp(block.timestamp + BUNDLE_CLAIM_GRACE + 1);
        uint256 treasuryBalanceBefore = hrepToken.balanceOf(treasury);
        uint256 refundAmount = rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId);

        assertEq(refundAmount, rewardAmount - claimed);
        assertEq(hrepToken.balanceOf(treasury), treasuryBalanceBefore + refundAmount);
        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter2), 0);
    }

    function testSettledRoundCanQualifyAfterContentDormant() public {
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);
        uint256 roundId = _settleRoundWith(voters, contentId, directions);

        vm.warp(block.timestamp + 31 days);
        registry.markDormant(contentId);
        assertFalse(registry.isContentActive(contentId));

        // Submitter has a 24h exclusive revival window after markDormant; the inactive-pool
        // refund is gated on it. Forfeit attempts during the window revert early, so warp
        // past it to reach the "pending qualifying round" check this test is asserting.
        vm.warp(block.timestamp + 2 days);

        vm.expectRevert(QuestionRewardPoolEscrow.RewardPoolCursorNeedsAdvance.selector);
        rewardPoolEscrow.refundInactiveRewardPool(rewardPoolId);

        _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);
    }

    function testExpiredPoolBlocksNewQualificationButLeavesQualifiedClaimsPayable() public {
        uint256 contentId = _submitQuestion("");
        uint256 expiresAt = block.timestamp + 1 days;
        uint256 rewardPoolId = _createRewardPoolWithExpiry(contentId, REWARD_POOL_AMOUNT, 3, 2, expiresAt);

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);
        uint256 firstRoundId = _settleRoundWith(voters, contentId, directions);
        rewardPoolEscrow.qualifyRound(rewardPoolId, firstRoundId);

        vm.warp(expiresAt + 1);
        vm.warp(block.timestamp + 25 hours);
        uint256 secondRoundId = _settleRoundWith(voters, contentId, directions);

        vm.prank(voter1);
        vm.expectRevert("Too few eligible voters");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, secondRoundId);

        (uint256 skipped, uint256 nextRoundToEvaluate) = rewardPoolEscrow.advanceQualificationCursor(rewardPoolId, 1);
        assertEq(skipped, 1);
        assertEq(nextRoundToEvaluate, secondRoundId + 1);

        uint256 funderBalanceBefore = usdc.balanceOf(funder);
        uint256 refundAmount = rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId);
        assertEq(refundAmount, REWARD_POOL_AMOUNT / 2);
        assertEq(usdc.balanceOf(funder), funderBalanceBefore + refundAmount);

        _claimQuestionRewardAndAssert(voter1, rewardPoolId, firstRoundId);
    }

    function testPartialExpiredPoolCanSweepUnclaimedAllocatedRewardsAfterGrace() public {
        uint256 contentId = _submitQuestion("");
        uint256 expiresAt = block.timestamp + 1 days;
        uint256 rewardPoolId = _createRewardPoolWithExpiry(contentId, 120e6, 3, 2, expiresAt);

        address[] memory voters = _threeVoters();
        uint256 firstRoundId = _settleRoundWith(voters, contentId, _directions(true, true, false));
        rewardPoolEscrow.qualifyRound(rewardPoolId, firstRoundId);

        vm.warp(expiresAt + 1);
        uint256 funderBalanceBefore = usdc.balanceOf(funder);
        uint256 unallocatedRefund = rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId);
        assertEq(unallocatedRefund, 60e6);
        assertEq(usdc.balanceOf(funder), funderBalanceBefore + unallocatedRefund);

        uint256 claimed = _claimQuestionRewardAndAssert(voter1, rewardPoolId, firstRoundId);

        vm.warp(expiresAt + BUNDLE_CLAIM_GRACE + 1);
        uint256 finalRefund = rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId);
        assertEq(finalRefund, 60e6 - claimed);
        assertEq(usdc.balanceOf(funder), funderBalanceBefore + unallocatedRefund + finalRefund);
        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, firstRoundId, voter2), 0);
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), 0);
    }

    function testLaterEligibleRoundCannotSkipEarlierEligibleRound() public {
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);
        uint256 firstRoundId = _settleRoundWith(voters, contentId, directions);

        vm.warp(block.timestamp + 25 hours);
        uint256 secondRoundId = _settleRoundWith(voters, contentId, directions);

        (uint256 skipped, uint256 nextRoundToEvaluate) = rewardPoolEscrow.advanceQualificationCursor(rewardPoolId, 1);
        assertEq(skipped, 0);
        assertEq(nextRoundToEvaluate, firstRoundId);

        vm.prank(voter1);
        vm.expectRevert("Round out of order");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, secondRoundId);

        _claimQuestionRewardAndAssert(voter1, rewardPoolId, firstRoundId);
    }

    function testClusterRewardPoolDoesNotSkipSettledRoundWithoutFinalizedSnapshot() public {
        _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));

        (uint256 skipped, uint256 nextRoundToEvaluate) = rewardPoolEscrow.advanceQualificationCursor(rewardPoolId, 1);
        assertEq(skipped, 0);
        assertEq(nextRoundToEvaluate, roundId);
    }

    function testClusterRewardPoolCanSkipFinalizedBelowFloorSnapshot() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        _finalizeClusterPayoutSnapshot(oracle, rewardPoolId, contentId, roundId, 3, 20_000, 1);

        (uint256 skipped, uint256 nextRoundToEvaluate) = rewardPoolEscrow.advanceQualificationCursor(rewardPoolId, 1);
        assertEq(skipped, 1);
        assertEq(nextRoundToEvaluate, roundId + 1);
    }

    function testRewardPoolCreatedBeforeClusterOracleKeepsStandardClaims() public {
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);
        _enableClusterPayoutOracle();

        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));

        _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);
    }

    function testClusterRewardPoolUsesSnapshottedOracleAfterConfigRotation() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        IClusterPayoutOracle.PayoutWeight memory payoutWeight =
            _clusterPayoutWeight(rewardPoolId, contentId, roundId, 0);
        _finalizeClusterPayoutSnapshotWithRoot(
            oracle,
            rewardPoolId,
            contentId,
            roundId,
            3,
            30_000,
            payoutWeight.effectiveWeight,
            oracle.payoutWeightLeaf(payoutWeight)
        );

        ClusterPayoutOracle replacementOracle = _newEligibleClusterPayoutOracle();
        vm.prank(owner);
        protocolConfig.setClusterPayoutOracle(address(replacementOracle));

        bytes32[] memory proof = new bytes32[](0);
        vm.prank(voter1);
        uint256 reward = rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId, payoutWeight, proof);
        assertGt(reward, 0);
    }

    function testClusterClaimableQuestionRewardWithPayoutWeightPreviewsUnqualifiedRound() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        IClusterPayoutOracle.PayoutWeight memory payoutWeight =
            _clusterPayoutWeight(rewardPoolId, contentId, roundId, 0);
        _finalizeClusterPayoutSnapshotWithRoot(
            oracle,
            rewardPoolId,
            contentId,
            roundId,
            3,
            30_000,
            payoutWeight.effectiveWeight,
            oracle.payoutWeightLeaf(payoutWeight)
        );

        bytes32[] memory proof = new bytes32[](0);
        uint256 expectedReward = rewardPoolEscrow.claimableQuestionRewardWithPayoutWeight(
            rewardPoolId, roundId, voter1, payoutWeight, proof
        );

        assertGt(expectedReward, 0);
        vm.prank(voter1);
        uint256 reward = rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId, payoutWeight, proof);
        assertEq(reward, expectedReward);
    }

    function testIneligibleEarlierRoundCanBeSkippedForLaterEligibleRound() public {
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        address[] memory ineligibleVoters = new address[](3);
        ineligibleVoters[0] = funder;
        ineligibleVoters[1] = voter1;
        ineligibleVoters[2] = voter2;
        bool[] memory directions = _directions(true, true, false);
        _settleRoundWith(ineligibleVoters, contentId, directions);

        vm.warp(block.timestamp + 25 hours);
        uint256 eligibleRoundId = _settleRoundWith(_threeVoters(), contentId, directions);

        (uint256 skipped, uint256 nextRoundToEvaluate) = rewardPoolEscrow.advanceQualificationCursor(rewardPoolId, 1);
        assertEq(skipped, 1);
        assertEq(nextRoundToEvaluate, eligibleRoundId);

        uint256 reward = _claimQuestionRewardAndAssert(voter1, rewardPoolId, eligibleRoundId);

        uint256 funderBalanceBefore = usdc.balanceOf(funder);
        vm.warp(block.timestamp + 31 days + BUNDLE_CLAIM_GRACE + 1);
        uint256 refund = rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId);
        assertEq(refund, REWARD_POOL_AMOUNT - reward);
        assertEq(usdc.balanceOf(funder), funderBalanceBefore + refund);
    }

    function testAdvanceQualificationCursorSkipsIneligibleRoundsInChunks() public {
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        uint256 nextCommitAt = block.timestamp;
        bool[] memory directions = _directions(true, true, false);
        for (uint256 i = 0; i < 5; i++) {
            vm.warp(nextCommitAt);
            _settleRoundWith(_ineligibleVoters(), contentId, directions);
            nextCommitAt += 25 hours;
        }
        vm.warp(nextCommitAt);
        uint256 eligibleRoundId = _settleRoundWith(_threeVoters(), contentId, directions);

        (uint256 skipped, uint256 nextRoundToEvaluate) = rewardPoolEscrow.advanceQualificationCursor(rewardPoolId, 2);
        assertEq(skipped, 2);
        assertEq(nextRoundToEvaluate, 3);

        (skipped, nextRoundToEvaluate) = rewardPoolEscrow.advanceQualificationCursor(rewardPoolId, 2);
        assertEq(skipped, 2);
        assertEq(nextRoundToEvaluate, 5);

        (skipped, nextRoundToEvaluate) = rewardPoolEscrow.advanceQualificationCursor(rewardPoolId, 2);
        assertEq(skipped, 1);
        assertEq(nextRoundToEvaluate, eligibleRoundId);

        _claimQuestionRewardAndAssert(voter1, rewardPoolId, eligibleRoundId);
    }

    function testInactiveUnexpiredPoolCanRefundUnallocatedFunds() public {
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        vm.prank(submitter);
        registry.cancelContent(contentId);

        uint256 funderBalanceBefore = usdc.balanceOf(funder);
        uint256 refundAmount = rewardPoolEscrow.refundInactiveRewardPool(rewardPoolId);

        assertEq(refundAmount, REWARD_POOL_AMOUNT);
        assertEq(usdc.balanceOf(funder), funderBalanceBefore + REWARD_POOL_AMOUNT);
    }

    function testBundleDoesNotFailOnUnsettledTerminalRound() public {
        uint256[] memory contentIds = new uint256[](2);
        contentIds[0] = _submitQuestionWithContext("https://example.com/bundle-a", "https://example.com/bundle-a.jpg");
        contentIds[1] = _submitQuestionWithContext("https://example.com/bundle-b", "https://example.com/bundle-b.jpg");
        uint256 bundleId = 1;
        uint8 rewardAsset = REWARD_ASSET_HREP;
        uint256 bountyClosesAt = block.timestamp + 30 days;

        vm.prank(submitter);
        hrepToken.approve(address(rewardPoolEscrow), REWARD_POOL_AMOUNT);

        vm.prank(address(registry));
        rewardPoolEscrow.createSubmissionBundleFromRegistry(
            bundleId, contentIds, submitter, rewardAsset, REWARD_POOL_AMOUNT, 3, 1, bountyClosesAt, bountyClosesAt
        );

        vm.prank(address(votingEngine));
        rewardPoolEscrow.recordBundleQuestionTerminal(contentIds[0], 1, false);

        vm.expectRevert("Bundle active");
        rewardPoolEscrow.refundQuestionBundleReward(bundleId);
    }

    function testRewardPoolRequiresExpiry() public {
        uint256 contentId = _submitQuestion("");

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), REWARD_POOL_AMOUNT);
        vm.expectRevert("Bad close");
        rewardPoolEscrow.createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1, 0, 0);
        vm.stopPrank();
    }

    function testRewardPoolAmountMustCoverEachRequiredRound() public {
        uint256 contentId = _submitQuestion("");

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), 1);
        vm.expectRevert("Amount too small");
        rewardPoolEscrow.createRewardPool(contentId, 1, 3, 2, block.timestamp + 30 days, 0);
        vm.stopPrank();
    }

    function testRewardPoolRejectsTooManyRequiredRounds() public {
        uint256 contentId = _submitQuestion("");

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), REWARD_POOL_AMOUNT);
        vm.expectRevert("Too many rounds");
        rewardPoolEscrow.createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 17, block.timestamp + 30 days, 0);
        vm.stopPrank();
    }

    function testRewardPoolAmountMustCoverMaxVotersForEachRequiredRound() public {
        uint256 contentId = _submitQuestion("");

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), 199);
        vm.expectRevert("Amount too small");
        rewardPoolEscrow.createRewardPool(contentId, 199, 3, 1, block.timestamp + 30 days, 0);
        vm.stopPrank();
    }

    function testStandaloneUsdcRewardPoolAllowsFunderWithoutRaterIdentity() public {
        uint256 contentId = _submitQuestion("");
        address unverifiedFunder = address(0xB0B);
        usdc.mint(unverifiedFunder, REWARD_POOL_AMOUNT);

        vm.startPrank(unverifiedFunder);
        usdc.approve(address(rewardPoolEscrow), REWARD_POOL_AMOUNT);
        uint256 rewardPoolId =
            rewardPoolEscrow.createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1, block.timestamp + 30 days, 0);
        vm.stopPrank();
        assertGt(rewardPoolId, 0);
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), REWARD_POOL_AMOUNT);
    }

    function testAgentWalletQuestionSubmissionFundsEscrowFromSigningWallet() public {
        address agentWallet = address(0xA11CE);
        string memory contextUrl = "https://example.com/agent-funded-context";
        string memory title = "Which supplier should the agent shortlist?";
        string memory description = "Check that direct agent submissions fund escrow from the signer.";
        string memory tags = "agents,bounty";
        string[] memory imageUrls = new string[](1);
        imageUrls[0] = "https://example.com/agent-funded-context.jpg";
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 3, maxVoters: 200
        });
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = ContentRegistry.SubmissionRewardTerms({
            asset: REWARD_ASSET_USDC,
            amount: REWARD_POOL_AMOUNT,
            requiredVoters: 3,
            requiredSettledRounds: 1,
            bountyClosesAt: block.timestamp + 30 days,
            feedbackClosesAt: block.timestamp + 30 days,
            bountyEligibility: 0
        });
        bytes32 salt = keccak256("agent-wallet-usdc-submission-bounty");
        activeTlockContentRegistry = registry;

        vm.prank(submitter);
        raterIdentityRegistry.setDelegate(agentWallet);
        usdc.mint(agentWallet, REWARD_POOL_AMOUNT);

        (, bytes32 submissionKey) =
            registry.previewQuestionSubmissionKey(contextUrl, imageUrls, "", title, description, tags, CATEGORY_ID);
        bytes32 revealCommitment = _questionRevealCommitment(
            submissionKey,
            _submissionMediaHash(imageUrls, ""),
            title,
            description,
            tags,
            CATEGORY_ID,
            salt,
            agentWallet,
            rewardTerms,
            roundConfig
        );

        vm.startPrank(agentWallet);
        usdc.approve(address(rewardPoolEscrow), rewardTerms.amount);
        registry.reserveSubmission(revealCommitment);
        vm.warp(block.timestamp + 1);

        uint256 escrowBalanceBefore = usdc.balanceOf(address(rewardPoolEscrow));
        uint256 agentBalanceBefore = usdc.balanceOf(agentWallet);
        uint256 expectedContentId = registry.nextContentId();

        uint256 contentId = registry.submitQuestionWithRewardAndRoundConfig(
            contextUrl,
            imageUrls,
            "",
            title,
            description,
            tags,
            CATEGORY_ID,
            salt,
            rewardTerms,
            roundConfig,
            _defaultQuestionSpec()
        );
        vm.stopPrank();

        assertEq(contentId, expectedContentId);
        (,, address storedSubmitter,,,,,,,) = registry.contents(contentId);
        assertEq(storedSubmitter, agentWallet);
        assertEq(registry.getSubmitterIdentity(contentId), submitter);
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), escrowBalanceBefore + rewardTerms.amount);
        assertEq(usdc.balanceOf(agentWallet), agentBalanceBefore - rewardTerms.amount);
    }

    function testUndelegatedAgentQuestionSubmissionWithUsdcRewardAllowsOpenSubmitter() public {
        address agentWallet = address(0xA11CE);
        uint256 nextContentIdBefore = registry.nextContentId();
        uint256 escrowBalanceBefore = usdc.balanceOf(address(rewardPoolEscrow));

        (uint256 contentId,) = _submitAgentQuestionWithUsdcReward(agentWallet, "agent-undelegated-no-voter-id");

        assertEq(contentId, nextContentIdBefore);
        assertEq(registry.getSubmitterIdentity(contentId), agentWallet);
        assertEq(registry.contentSubmitterIdentityKey(contentId), raterIdentityRegistry.addressIdentityKey(agentWallet));
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), escrowBalanceBefore + REWARD_POOL_AMOUNT);
    }

    function testX402QuestionSubmissionAllowsOpenSubmitter() public {
        address agentWallet = address(0xA11CE);
        X402TestQuestion memory question = _x402TestQuestion();
        Eip3009Authorization memory authorization = _x402Authorization(agentWallet, question);

        usdc.mint(agentWallet, question.rewardTerms.amount);
        uint256 escrowBalanceBefore = usdc.balanceOf(address(rewardPoolEscrow));
        uint256 agentBalanceBefore = usdc.balanceOf(agentWallet);
        uint256 nextContentIdBefore = registry.nextContentId();

        _reserveX402Question(agentWallet, question);
        vm.warp(block.timestamp + 1);

        uint256 contentId = x402QuestionSubmitter.submitQuestionWithX402Payment(
            question.contextUrl,
            question.imageUrls,
            "",
            question.title,
            question.description,
            question.tags,
            CATEGORY_ID,
            question.salt,
            question.rewardTerms,
            question.roundConfig,
            question.spec,
            authorization
        );

        assertTrue(usdc.authorizationState(agentWallet, authorization.nonce));
        assertEq(contentId, nextContentIdBefore);
        assertEq(registry.getSubmitterIdentity(contentId), agentWallet);
        assertEq(registry.contentSubmitterIdentityKey(contentId), raterIdentityRegistry.addressIdentityKey(agentWallet));
        assertEq(registry.nextContentId(), nextContentIdBefore + 1);
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), escrowBalanceBefore + question.rewardTerms.amount);
        assertEq(usdc.balanceOf(agentWallet), agentBalanceBefore - question.rewardTerms.amount);
    }

    function testX402QuestionSubmissionRequiresReservationBeforeUsdcAuthorization() public {
        address agentWallet = address(0xA11CE);
        X402TestQuestion memory question = _x402TestQuestion();
        Eip3009Authorization memory authorization = _x402Authorization(agentWallet, question);

        vm.prank(submitter);
        raterIdentityRegistry.setDelegate(agentWallet);
        usdc.mint(agentWallet, question.rewardTerms.amount);
        uint256 escrowBalanceBefore = usdc.balanceOf(address(rewardPoolEscrow));
        uint256 agentBalanceBefore = usdc.balanceOf(agentWallet);
        uint256 nextContentIdBefore = registry.nextContentId();

        vm.expectRevert("Reservation not found");
        x402QuestionSubmitter.submitQuestionWithX402Payment(
            question.contextUrl,
            question.imageUrls,
            "",
            question.title,
            question.description,
            question.tags,
            CATEGORY_ID,
            question.salt,
            question.rewardTerms,
            question.roundConfig,
            question.spec,
            authorization
        );

        assertFalse(usdc.authorizationState(agentWallet, authorization.nonce));
        assertEq(registry.nextContentId(), nextContentIdBefore);
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), escrowBalanceBefore);
        assertEq(usdc.balanceOf(agentWallet), agentBalanceBefore);
    }

    function testX402QuestionSubmissionRejectsTooNewReservationBeforeUsdcAuthorization() public {
        address agentWallet = address(0xA11CE);
        X402TestQuestion memory question = _x402TestQuestion();
        Eip3009Authorization memory authorization = _x402Authorization(agentWallet, question);

        vm.prank(submitter);
        raterIdentityRegistry.setDelegate(agentWallet);
        usdc.mint(agentWallet, question.rewardTerms.amount);
        uint256 escrowBalanceBefore = usdc.balanceOf(address(rewardPoolEscrow));
        uint256 agentBalanceBefore = usdc.balanceOf(agentWallet);
        uint256 nextContentIdBefore = registry.nextContentId();

        _reserveX402Question(agentWallet, question);

        vm.expectRevert("Reservation too new");
        x402QuestionSubmitter.submitQuestionWithX402Payment(
            question.contextUrl,
            question.imageUrls,
            "",
            question.title,
            question.description,
            question.tags,
            CATEGORY_ID,
            question.salt,
            question.rewardTerms,
            question.roundConfig,
            question.spec,
            authorization
        );

        assertFalse(usdc.authorizationState(agentWallet, authorization.nonce));
        assertEq(registry.nextContentId(), nextContentIdBefore);
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), escrowBalanceBefore);
        assertEq(usdc.balanceOf(agentWallet), agentBalanceBefore);
    }

    function testX402QuestionSubmissionRejectsStaleEscrowBeforeUsdcAuthorization() public {
        address agentWallet = address(0xA11CE);
        X402TestQuestion memory question = _x402TestQuestion();
        Eip3009Authorization memory authorization = _x402Authorization(agentWallet, question);

        vm.prank(submitter);
        raterIdentityRegistry.setDelegate(agentWallet);
        usdc.mint(agentWallet, question.rewardTerms.amount);
        uint256 escrowBalanceBefore = usdc.balanceOf(address(rewardPoolEscrow));
        uint256 agentBalanceBefore = usdc.balanceOf(agentWallet);
        uint256 nextContentIdBefore = registry.nextContentId();

        _reserveX402Question(agentWallet, question);
        vm.warp(block.timestamp + 1);

        QuestionRewardPoolEscrow replacementEscrow = QuestionRewardPoolEscrow(
            address(
                new ERC1967Proxy(
                    address(new QuestionRewardPoolEscrow()),
                    abi.encodeCall(
                        QuestionRewardPoolEscrow.initialize,
                        (
                            owner,
                            address(hrepToken),
                            address(usdc),
                            address(registry),
                            address(votingEngine),
                            address(raterIdentityRegistry)
                        )
                    )
                )
            )
        );

        vm.startPrank(owner);
        registry.pause();
        registry.setQuestionRewardPoolEscrow(address(replacementEscrow));
        registry.unpause();
        vm.stopPrank();

        vm.expectRevert("Stale escrow");
        x402QuestionSubmitter.submitQuestionWithX402Payment(
            question.contextUrl,
            question.imageUrls,
            "",
            question.title,
            question.description,
            question.tags,
            CATEGORY_ID,
            question.salt,
            question.rewardTerms,
            question.roundConfig,
            question.spec,
            authorization
        );

        assertFalse(usdc.authorizationState(agentWallet, authorization.nonce));
        assertEq(registry.nextContentId(), nextContentIdBefore);
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), escrowBalanceBefore);
        assertEq(usdc.balanceOf(agentWallet), agentBalanceBefore);
    }

    function testX402QuestionSubmissionConsumesUsdcAuthorizationWithDelegatedRaterIdentity() public {
        address agentWallet = address(0xA11CE);
        X402TestQuestion memory question = _x402TestQuestion();
        Eip3009Authorization memory authorization = _x402Authorization(agentWallet, question);

        vm.prank(submitter);
        raterIdentityRegistry.setDelegate(agentWallet);
        usdc.mint(agentWallet, question.rewardTerms.amount);
        uint256 escrowBalanceBefore = usdc.balanceOf(address(rewardPoolEscrow));
        uint256 agentBalanceBefore = usdc.balanceOf(agentWallet);

        _reserveX402Question(agentWallet, question);
        vm.warp(block.timestamp + 1);

        uint256 contentId = x402QuestionSubmitter.submitQuestionWithX402Payment(
            question.contextUrl,
            question.imageUrls,
            "",
            question.title,
            question.description,
            question.tags,
            CATEGORY_ID,
            question.salt,
            question.rewardTerms,
            question.roundConfig,
            question.spec,
            authorization
        );

        (,, address storedSubmitter,,,,,,,) = registry.contents(contentId);
        assertEq(storedSubmitter, agentWallet);
        assertEq(registry.getSubmitterIdentity(contentId), submitter);
        assertEq(
            registry.contentSubmitterIdentityKey(contentId),
            bytes32(raterIdentityRegistry.getCredentialNullifier(raterIdentityRegistry.getCredentialId(submitter)))
        );
        assertTrue(usdc.authorizationState(agentWallet, authorization.nonce));
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), escrowBalanceBefore + question.rewardTerms.amount);
        assertEq(usdc.balanceOf(agentWallet), agentBalanceBefore - question.rewardTerms.amount);
    }

    function testDelegatedAgentSubmitterHolderCannotClaimQuestionReward() public {
        address agentWallet = address(0xA11CE);
        vm.prank(submitter);
        raterIdentityRegistry.setDelegate(agentWallet);

        (uint256 contentId, uint256 rewardPoolId) =
            _submitAgentQuestionWithUsdcReward(agentWallet, "agent-delegated-claim");
        uint256 roundId = 1;
        uint256 submitterRaterIdentity = raterIdentityRegistry.getCredentialId(submitter);

        _mockSettledRound(contentId, roundId, 4);
        _mockRevealedCommitForRaterIdentity(contentId, roundId, submitterRaterIdentity, submitter);
        _mockRevealedCommitForRaterIdentity(contentId, roundId, raterIdentityRegistry.getCredentialId(voter1), voter1);
        _mockRevealedCommitForRaterIdentity(contentId, roundId, raterIdentityRegistry.getCredentialId(voter2), voter2);
        _mockRevealedCommitForRaterIdentity(contentId, roundId, raterIdentityRegistry.getCredentialId(voter3), voter3);

        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, submitter), 0);
        vm.prank(submitter);
        vm.expectRevert("Excluded voter");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);
    }

    function testSubmissionRewardFloorsRejectUnderfundedRoundAllocation() public {
        vm.startPrank(owner);
        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        protocolConfig.setSubmissionRewardMinimums(3, 3);
        vm.stopPrank();
    }

    function _submitBundleQuestions() internal returns (uint256[] memory contentIds) {
        contentIds = new uint256[](2);
        contentIds[0] = _submitQuestionWithContext("https://example.com/bundle-a", "https://example.com/bundle-a.jpg");
        contentIds[1] = _submitQuestionWithContext("https://example.com/bundle-b", "https://example.com/bundle-b.jpg");
    }

    function _createSubmissionBundle(
        uint256[] memory contentIds,
        address bundleFunder,
        uint8 asset,
        uint256 amount,
        uint256 requiredCompleters
    ) internal returns (uint256 bundleId) {
        return _createSubmissionBundle(contentIds, bundleFunder, asset, amount, requiredCompleters, 1);
    }

    function _createSubmissionBundle(
        uint256[] memory contentIds,
        address bundleFunder,
        uint8 asset,
        uint256 amount,
        uint256 requiredCompleters,
        uint256 requiredSettledRounds
    ) internal returns (uint256 bundleId) {
        bundleId = 1;
        vm.startPrank(bundleFunder);
        if (asset == REWARD_ASSET_HREP) {
            hrepToken.approve(address(rewardPoolEscrow), amount);
        } else {
            usdc.approve(address(rewardPoolEscrow), amount);
        }
        vm.stopPrank();

        uint256 bountyClosesAt = block.timestamp + 30 days;
        vm.prank(address(registry));
        rewardPoolEscrow.createSubmissionBundleFromRegistry(
            bundleId,
            contentIds,
            bundleFunder,
            asset,
            amount,
            requiredCompleters,
            requiredSettledRounds,
            bountyClosesAt,
            bountyClosesAt
        );
    }

    function _createSubmissionBundleWithClose(
        uint256[] memory contentIds,
        address bundleFunder,
        uint8 asset,
        uint256 amount,
        uint256 requiredCompleters,
        uint256 bountyClosesAt
    ) internal returns (uint256 bundleId) {
        bundleId = 1;
        vm.startPrank(bundleFunder);
        if (asset == REWARD_ASSET_HREP) {
            hrepToken.approve(address(rewardPoolEscrow), amount);
        } else {
            usdc.approve(address(rewardPoolEscrow), amount);
        }
        vm.stopPrank();

        vm.prank(address(registry));
        rewardPoolEscrow.createSubmissionBundleFromRegistry(
            bundleId, contentIds, bundleFunder, asset, amount, requiredCompleters, 1, bountyClosesAt, bountyClosesAt
        );
    }

    function _registerTestVoter(address voter) internal {
        vm.startPrank(owner);
        raterIdentityRegistry.setHolder(voter);
        hrepToken.mint(voter, 10_000e6);
        usdc.mint(voter, 1_000e6);
        vm.stopPrank();
    }

    function _commitFiveVoterT1Round(uint256 contentId, address voter5, string memory label)
        internal
        returns (uint256 roundId, bytes32[5] memory salts, bytes32[5] memory commitKeys)
    {
        address[5] memory voters = [voter1, voter2, voter3, voter4, voter5];
        bool[5] memory directions = [true, true, true, false, false];
        for (uint256 i = 0; i < 5; i++) {
            salts[i] = keccak256(abi.encodePacked(label, voters[i], contentId, i));
            commitKeys[i] = _commitTestVote(
                DirectTestCommitRequest({
                    engine: votingEngine,
                    hrepToken: hrepToken,
                    voter: voters[i],
                    contentId: contentId,
                    isUp: directions[i],
                    stake: STAKE,
                    frontend: address(0),
                    salt: salts[i]
                })
            );
        }
        roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
    }

    function _revealFiveVoterT1Round(
        uint256 contentId,
        uint256 roundId,
        bytes32[5] memory salts,
        bytes32[5] memory commitKeys,
        uint256 startIndex,
        uint256 endIndex
    ) internal {
        bool[5] memory directions = [true, true, true, false, false];
        for (uint256 i = startIndex; i < endIndex; i++) {
            votingEngine.revealVoteByCommitKey(contentId, roundId, commitKeys[i], directions[i], 5_000, salts[i]);
        }
    }

    function _submitQuestion(string memory url) internal returns (uint256 contentId) {
        string memory mediaUrl = bytes(url).length == 0 ? DEFAULT_MEDIA_URL : url;
        return _submitQuestionWithContext("https://example.com/context", mediaUrl);
    }

    function _submitQuestionWithContext(string memory contextUrl, string memory mediaUrl)
        internal
        returns (uint256 contentId)
    {
        string[] memory imageUrls = new string[](1);
        imageUrls[0] = mediaUrl;
        activeTlockContentRegistry = registry;
        bytes32 salt = keccak256(
            abi.encode(contextUrl, mediaUrl, QUESTION, DESCRIPTION, TAGS, CATEGORY_ID, submitter, block.timestamp)
        );

        vm.startPrank(submitter);
        _reserveQuestionMediaSubmission(
            registry, contextUrl, imageUrls, "", QUESTION, DESCRIPTION, TAGS, CATEGORY_ID, salt, submitter
        );
        vm.warp(block.timestamp + 1);
        contentId = registry.submitQuestion(
            contextUrl, imageUrls, "", QUESTION, DESCRIPTION, TAGS, CATEGORY_ID, salt, _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function _submitQuestionWithRoundConfig(string memory url, RoundLib.RoundConfig memory roundConfig)
        internal
        returns (uint256 contentId)
    {
        contentId = _submitQuestionWithContextAndRoundConfig("https://example.com/context", url, roundConfig);
    }

    function _submitQuestionWithContextAndRoundConfig(
        string memory contextUrl,
        string memory mediaUrl,
        RoundLib.RoundConfig memory roundConfig
    ) internal returns (uint256 contentId) {
        string[] memory imageUrls = new string[](1);
        imageUrls[0] = mediaUrl;
        activeTlockContentRegistry = registry;
        bytes32 salt = keccak256(
            abi.encode(contextUrl, mediaUrl, QUESTION, DESCRIPTION, TAGS, CATEGORY_ID, submitter, block.timestamp)
        );

        (, bytes32 submissionKey) =
            registry.previewQuestionSubmissionKey(contextUrl, imageUrls, "", QUESTION, DESCRIPTION, TAGS, CATEGORY_ID);
        uint256 rewardAmount = _defaultSubmissionRewardAmount(registry);
        bytes32 revealCommitment = _questionRevealCommitment(
            submissionKey,
            _submissionMediaHash(imageUrls, ""),
            QUESTION,
            DESCRIPTION,
            TAGS,
            CATEGORY_ID,
            salt,
            submitter,
            ContentRegistry.SubmissionRewardTerms({
                asset: DEFAULT_SUBMISSION_REWARD_ASSET_HREP,
                amount: rewardAmount,
                requiredVoters: DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS,
                requiredSettledRounds: DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
                bountyClosesAt: DEFAULT_SUBMISSION_REWARD_EXPIRES_AT,
                feedbackClosesAt: DEFAULT_SUBMISSION_REWARD_EXPIRES_AT,
                bountyEligibility: 0
            }),
            roundConfig
        );

        vm.startPrank(submitter);
        hrepToken.approve(address(rewardPoolEscrow), rewardAmount);
        registry.reserveSubmission(revealCommitment);
        vm.warp(block.timestamp + 1);
        contentId = registry.submitQuestionWithRewardAndRoundConfig(
            contextUrl,
            imageUrls,
            "",
            QUESTION,
            DESCRIPTION,
            TAGS,
            CATEGORY_ID,
            salt,
            _defaultSubmissionRewardTerms(registry),
            roundConfig,
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function _x402TestQuestion() internal view returns (X402TestQuestion memory question) {
        question.contextUrl = "https://example.com/x402-agent-question";
        question.title = "Should the agent proceed with this supplier?";
        question.description = "Review the supplied context and vote on whether the agent should continue.";
        question.tags = "agents,bounty";
        question.imageUrls = new string[](1);
        question.imageUrls[0] = "https://example.com/x402-agent-question.jpg";
        question.roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 3, maxVoters: 200
        });
        question.rewardTerms = ContentRegistry.SubmissionRewardTerms({
            asset: REWARD_ASSET_USDC,
            amount: REWARD_POOL_AMOUNT,
            requiredVoters: 3,
            requiredSettledRounds: 1,
            bountyClosesAt: block.timestamp + 30 days,
            feedbackClosesAt: block.timestamp + 30 days,
            bountyEligibility: 0
        });
        question.spec = ContentRegistry.QuestionSpecCommitment({
            questionMetadataHash: keccak256("x402-question-metadata"), resultSpecHash: keccak256("x402-result-spec")
        });
        question.salt = keccak256("x402-usdc-no-voter-id");
    }

    function _reserveX402Question(address agentWallet, X402TestQuestion memory question)
        internal
        returns (bytes32 revealCommitment)
    {
        (, bytes32 submissionKey) = registry.previewQuestionSubmissionKey(
            question.contextUrl,
            question.imageUrls,
            "",
            question.title,
            question.description,
            question.tags,
            CATEGORY_ID
        );
        revealCommitment = _questionRevealCommitment(
            submissionKey,
            _submissionMediaHash(question.imageUrls, ""),
            question.title,
            question.description,
            question.tags,
            CATEGORY_ID,
            question.salt,
            agentWallet,
            question.rewardTerms,
            question.roundConfig,
            question.spec
        );

        vm.prank(agentWallet);
        registry.reserveSubmission(revealCommitment);
    }

    function _x402Authorization(address agentWallet, X402TestQuestion memory question)
        internal
        view
        returns (Eip3009Authorization memory authorization)
    {
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 30 minutes;
        ContentRegistry.SubmissionMetadata memory metadata = ContentRegistry.SubmissionMetadata({
            url: question.contextUrl,
            title: question.title,
            description: question.description,
            tags: question.tags,
            categoryId: CATEGORY_ID
        });
        authorization = Eip3009Authorization({
            from: agentWallet,
            to: address(x402QuestionSubmitter),
            value: question.rewardTerms.amount,
            validAfter: validAfter,
            validBefore: validBefore,
            nonce: x402QuestionSubmitter.computeX402QuestionPaymentNonce(
                metadata,
                question.imageUrls,
                "",
                question.salt,
                question.rewardTerms,
                question.roundConfig,
                question.spec,
                agentWallet,
                address(x402QuestionSubmitter),
                question.rewardTerms.amount,
                validAfter,
                validBefore
            ),
            v: 27,
            r: bytes32(0),
            s: bytes32(0)
        });
    }

    function _submitAgentQuestionWithUsdcReward(address agentWallet, string memory path)
        internal
        returns (uint256 contentId, uint256 rewardPoolId)
    {
        string memory contextUrl = string(abi.encodePacked("https://example.com/", path));
        string[] memory imageUrls = new string[](1);
        imageUrls[0] = string(abi.encodePacked(contextUrl, ".jpg"));
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 3, maxVoters: 200
        });
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = ContentRegistry.SubmissionRewardTerms({
            asset: REWARD_ASSET_USDC,
            amount: REWARD_POOL_AMOUNT,
            requiredVoters: 3,
            requiredSettledRounds: 1,
            bountyClosesAt: block.timestamp + 30 days,
            feedbackClosesAt: block.timestamp + 30 days,
            bountyEligibility: 0
        });
        bytes32 salt = keccak256(abi.encodePacked(path, agentWallet));
        activeTlockContentRegistry = registry;

        usdc.mint(agentWallet, rewardTerms.amount);
        (, bytes32 submissionKey) =
            registry.previewQuestionSubmissionKey(contextUrl, imageUrls, "", QUESTION, DESCRIPTION, TAGS, CATEGORY_ID);
        bytes32 revealCommitment = _questionRevealCommitment(
            submissionKey,
            _submissionMediaHash(imageUrls, ""),
            QUESTION,
            DESCRIPTION,
            TAGS,
            CATEGORY_ID,
            salt,
            agentWallet,
            rewardTerms,
            roundConfig
        );

        vm.startPrank(agentWallet);
        usdc.approve(address(rewardPoolEscrow), rewardTerms.amount);
        registry.reserveSubmission(revealCommitment);
        vm.warp(block.timestamp + 1);
        contentId = registry.submitQuestionWithRewardAndRoundConfig(
            contextUrl,
            imageUrls,
            "",
            QUESTION,
            DESCRIPTION,
            TAGS,
            CATEGORY_ID,
            salt,
            rewardTerms,
            roundConfig,
            _defaultQuestionSpec()
        );
        rewardPoolId = contentId;
        vm.stopPrank();
    }

    function _expectSelfVoteCommitRevert(address voter, uint256 contentId, bytes32 salt) internal {
        TestCommitArtifacts memory artifacts =
            _buildTestCommitArtifacts(address(votingEngine), voter, true, salt, contentId);
        vm.startPrank(voter);
        hrepToken.approve(address(votingEngine), STAKE);
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

    function _createRewardPool(uint256 contentId, uint256 amount, uint256 requiredVoters, uint256 requiredSettledRounds)
        internal
        returns (uint256 rewardPoolId)
    {
        return _createRewardPoolWithExpiry(
            contentId, amount, requiredVoters, requiredSettledRounds, block.timestamp + 30 days
        );
    }

    function _createRewardPoolWithExpiry(
        uint256 contentId,
        uint256 amount,
        uint256 requiredVoters,
        uint256 requiredSettledRounds,
        uint256 expiresAt
    ) internal returns (uint256 rewardPoolId) {
        rewardPoolId = _createRewardPoolAs(funder, contentId, amount, requiredVoters, requiredSettledRounds, expiresAt);
    }

    function _createRewardPoolAs(
        address poolFunder,
        uint256 contentId,
        uint256 amount,
        uint256 requiredVoters,
        uint256 requiredSettledRounds
    ) internal returns (uint256 rewardPoolId) {
        rewardPoolId = _createRewardPoolAs(
            poolFunder, contentId, amount, requiredVoters, requiredSettledRounds, block.timestamp + 30 days
        );
    }

    function _createRewardPoolAs(
        address poolFunder,
        uint256 contentId,
        uint256 amount,
        uint256 requiredVoters,
        uint256 requiredSettledRounds,
        uint256 expiresAt
    ) internal returns (uint256 rewardPoolId) {
        vm.startPrank(poolFunder);
        usdc.approve(address(rewardPoolEscrow), amount);
        rewardPoolId =
            rewardPoolEscrow.createRewardPool(contentId, amount, requiredVoters, requiredSettledRounds, expiresAt, 0);
        vm.stopPrank();
    }

    function _claimQuestionRewardAndAssert(address claimant, uint256 rewardPoolId, uint256 roundId)
        internal
        returns (uint256 reward)
    {
        uint256 expectedReward = rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, claimant);
        assertGt(expectedReward, 0);
        vm.prank(claimant);
        reward = rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);
        assertEq(reward, expectedReward);
    }

    function _enableClusterPayoutOracle() internal returns (ClusterPayoutOracle oracle) {
        oracle = _newEligibleClusterPayoutOracle();
        oracle.setOracleConfig(1 hours, 0.01 ether, address(this));
        vm.deal(address(this), 10 ether);
        vm.prank(owner);
        protocolConfig.setClusterPayoutOracle(address(oracle));
    }

    function _newEligibleClusterPayoutOracle() internal returns (ClusterPayoutOracle oracle) {
        MockQuestionRewardOracleFrontendRegistry oracleFrontendRegistry = new MockQuestionRewardOracleFrontendRegistry();
        oracleFrontendRegistry.setEligible(address(this), true);
        oracle = new ClusterPayoutOracle(address(this), address(oracleFrontendRegistry));
    }

    function _finalizeClusterPayoutSnapshot(
        ClusterPayoutOracle oracle,
        uint256 rewardPoolId,
        uint256 contentId,
        uint256 roundId,
        uint32 rawEligibleVoters,
        uint32 effectiveParticipantUnits,
        uint256 totalClaimWeight
    ) internal {
        _finalizeClusterPayoutSnapshotWithRoot(
            oracle,
            rewardPoolId,
            contentId,
            roundId,
            rawEligibleVoters,
            effectiveParticipantUnits,
            totalClaimWeight,
            keccak256(abi.encode("weight-root", rewardPoolId, roundId))
        );
    }

    function _finalizeClusterPayoutSnapshotWithRoot(
        ClusterPayoutOracle oracle,
        uint256 rewardPoolId,
        uint256 contentId,
        uint256 roundId,
        uint32 rawEligibleVoters,
        uint32 effectiveParticipantUnits,
        uint256 totalClaimWeight,
        bytes32 weightRoot
    ) internal {
        uint64 correlationEpochId = uint64(roundId);
        oracle.proposeCorrelationEpoch(
            correlationEpochId,
            uint64(roundId),
            uint64(roundId),
            keccak256(abi.encode("cluster-root", roundId)),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://epoch"
        );
        vm.warp(block.timestamp + 1 hours + 1);
        oracle.finalizeCorrelationEpoch(correlationEpochId);

        oracle.proposeRoundPayoutSnapshot(
            IClusterPayoutOracle.RoundPayoutSnapshotInput({
                domain: 1,
                rewardPoolId: rewardPoolId,
                contentId: contentId,
                roundId: roundId,
                correlationEpochId: correlationEpochId,
                rawEligibleVoters: rawEligibleVoters,
                effectiveParticipantUnits: effectiveParticipantUnits,
                totalClaimWeight: totalClaimWeight,
                weightRoot: weightRoot,
                reasonRoot: keccak256("reason-root"),
                artifactHash: keccak256("round-artifact"),
                artifactURI: "ipfs://round"
            })
        );
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(1, rewardPoolId, contentId, roundId);
        vm.warp(block.timestamp + 1 hours + 1);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);
    }

    function _clusterPayoutWeight(uint256 rewardPoolId, uint256 contentId, uint256 roundId, uint256 commitIndex)
        internal
        view
        returns (IClusterPayoutOracle.PayoutWeight memory payoutWeight)
    {
        bytes32 commitKey = votingEngine.getRoundCommitKey(contentId, roundId, commitIndex);
        uint256 baseWeight = votingEngine.roundRbtsScored(contentId, roundId)
            ? votingEngine.commitRbtsRewardWeight(contentId, roundId, commitKey)
            : 10_000;
        payoutWeight = IClusterPayoutOracle.PayoutWeight({
            domain: 1,
            rewardPoolId: rewardPoolId,
            contentId: contentId,
            roundId: roundId,
            commitKey: commitKey,
            identityKey: votingEngine.commitIdentityKey(contentId, roundId, commitKey),
            account: votingEngine.commitIdentityHolder(contentId, roundId, commitKey),
            baseWeight: baseWeight,
            independenceBps: 10_000,
            effectiveWeight: baseWeight,
            reasonHash: keccak256("cluster-payout")
        });
    }

    function _createRewardPoolWithEligibility(
        uint256 contentId,
        uint256 amount,
        uint256 requiredVoters,
        uint256 requiredSettledRounds,
        uint8 bountyEligibility
    ) internal returns (uint256 rewardPoolId) {
        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), amount);
        rewardPoolId = rewardPoolEscrow.createRewardPoolWithEligibility(
            contentId, amount, requiredVoters, requiredSettledRounds, block.timestamp + 30 days, 0, bountyEligibility
        );
        vm.stopPrank();
    }

    function _settleRoundWith(address[] memory voters, uint256 contentId, bool[] memory directions)
        internal
        returns (uint256 roundId)
    {
        return _settleRoundWithFrontend(voters, contentId, directions, address(0));
    }

    function _settlePredictionRoundWith(address[] memory voters, uint256 contentId, uint16[] memory predictions)
        internal
        returns (uint256 roundId)
    {
        uint256[] memory stakes = new uint256[](voters.length);
        for (uint256 i = 0; i < voters.length; i++) {
            stakes[i] = STAKE;
        }
        return _settlePredictionRoundWithStakes(voters, contentId, predictions, stakes);
    }

    function _settlePredictionRoundWithStakes(
        address[] memory voters,
        uint256 contentId,
        uint16[] memory predictions,
        uint256[] memory stakes
    ) internal returns (uint256 roundId) {
        assertEq(voters.length, predictions.length);
        assertEq(voters.length, stakes.length);
        bytes32[] memory salts = new bytes32[](voters.length);
        bytes32[] memory commitKeys = new bytes32[](voters.length);
        for (uint256 i = 0; i < voters.length; i++) {
            salts[i] = keccak256(abi.encodePacked(voters[i], contentId, predictions[i], i));
            commitKeys[i] = _commitPrediction(voters[i], contentId, predictions[i], stakes[i], salts[i]);
        }

        roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        _warpPastTlockRevealTime(block.timestamp + EPOCH_DURATION);

        for (uint256 i = 0; i < voters.length; i++) {
            votingEngine.revealVoteByCommitKey(
                contentId, roundId, commitKeys[i], predictions[i] >= 5_000, predictions[i], salts[i]
            );
        }

        votingEngine.settleRound(contentId, roundId);
    }

    function _commitPrediction(address voter, uint256 contentId, uint16 predictedRatingBps, uint256 stake, bytes32 salt)
        internal
        returns (bytes32 commitKey)
    {
        uint256 roundId = votingEngine.currentRoundId(contentId);
        if (roundId == 0) {
            roundId = _defaultTestCommitRoundId(contentId);
        }
        uint16 referenceRatingBps = _currentRatingReferenceBps(contentId);
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();
        bool isUp = predictedRatingBps >= 5_000;
        bytes memory ciphertext = _testCiphertext(isUp, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = TlockVoteLib.buildExpectedRbtsCommitHash(
            isUp,
            predictedRatingBps,
            salt,
            voter,
            contentId,
            roundId,
            referenceRatingBps,
            targetRound,
            drandChainHash,
            ciphertext
        );

        vm.startPrank(voter);
        hrepToken.approve(address(votingEngine), stake);
        votingEngine.commitVote(
            contentId,
            _roundContext(roundId, referenceRatingBps),
            targetRound,
            drandChainHash,
            commitHash,
            ciphertext,
            stake,
            address(0)
        );
        vm.stopPrank();

        return keccak256(abi.encodePacked(voter, commitHash));
    }

    /// @dev Settle without triggering bundle qualification on the test's `rewardPoolEscrow`.
    ///      Used by tests that intentionally race the escrow wiring (e.g., mock-escrow swaps).
    function _settleRoundWithoutBundleSync(address[] memory voters, uint256 contentId, bool[] memory directions)
        internal
        returns (uint256 roundId)
    {
        bytes32[] memory salts = new bytes32[](voters.length);
        bytes32[] memory commitKeys = new bytes32[](voters.length);
        for (uint256 i = 0; i < voters.length; i++) {
            salts[i] = keccak256(abi.encodePacked(voters[i], contentId, directions[i], i));
            commitKeys[i] = _commitTestVote(
                DirectTestCommitRequest({
                    engine: votingEngine,
                    hrepToken: hrepToken,
                    voter: voters[i],
                    contentId: contentId,
                    isUp: directions[i],
                    stake: STAKE,
                    frontend: address(0),
                    salt: salts[i]
                })
            );
        }
        roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        _warpPastTlockRevealTime(block.timestamp + EPOCH_DURATION);
        for (uint256 i = 0; i < voters.length; i++) {
            votingEngine.revealVoteByCommitKey(contentId, roundId, commitKeys[i], directions[i], 5_000, salts[i]);
        }
        votingEngine.settleRound(contentId, roundId);
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
                    hrepToken: hrepToken,
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

        votingEngine.settleRound(contentId, roundId);
        // Bundle qualification is decoupled from settlement to keep settlement O(1) at high
        // `maxVoters` × bundle-size. `syncBundleQuestionTerminal` is permissionless, idempotent,
        // and a no-op for non-bundled content; calling it from the test helper keeps the
        // existing test assertions (which expect a qualified snapshot post-settle) accurate.
        rewardPoolEscrow.syncBundleQuestionTerminal(contentId, roundId);
    }

    function _revealRoundWith(address[] memory voters, uint256 contentId, bool[] memory directions)
        internal
        returns (uint256 roundId)
    {
        bytes32[] memory salts = new bytes32[](voters.length);
        bytes32[] memory commitKeys = new bytes32[](voters.length);

        for (uint256 i = 0; i < voters.length; i++) {
            salts[i] = keccak256(abi.encodePacked("reveal-only", voters[i], contentId, directions[i], i));
            commitKeys[i] = _commitTestVote(
                DirectTestCommitRequest({
                    engine: votingEngine,
                    hrepToken: hrepToken,
                    voter: voters[i],
                    contentId: contentId,
                    isUp: directions[i],
                    stake: STAKE,
                    frontend: address(0),
                    salt: salts[i]
                })
            );
        }

        roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        _warpPastTlockRevealTime(block.timestamp + EPOCH_DURATION);

        for (uint256 i = 0; i < voters.length; i++) {
            votingEngine.revealVoteByCommitKey(contentId, roundId, commitKeys[i], directions[i], 5_000, salts[i]);
        }
    }

    function _settleRoundWithOneUnrevealed(uint256 contentId) internal returns (uint256 roundId) {
        address[] memory voters = _fourVoters();
        bool[] memory directions = _directions(true, true, false, true);
        bytes32[] memory salts = new bytes32[](voters.length);
        bytes32[] memory commitKeys = new bytes32[](voters.length);

        for (uint256 i = 0; i < voters.length; i++) {
            salts[i] = keccak256(abi.encodePacked(voters[i], contentId, directions[i], i));
            commitKeys[i] = _commitTestVote(
                DirectTestCommitRequest({
                    engine: votingEngine,
                    hrepToken: hrepToken,
                    voter: voters[i],
                    contentId: contentId,
                    isUp: directions[i],
                    stake: STAKE,
                    frontend: address(0),
                    salt: salts[i]
                })
            );
        }

        roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH_DURATION);

        for (uint256 i = 0; i < voters.length - 1; i++) {
            votingEngine.revealVoteByCommitKey(contentId, roundId, commitKeys[i], directions[i], 5_000, salts[i]);
        }

        vm.warp(round.startTime + 7 days + protocolConfig.revealGracePeriod() + 1);
        votingEngine.settleRound(contentId, roundId);
        assertEq(votingEngine.roundUnrevealedCleanupRemaining(contentId, roundId), 1);
    }

    function _revealThresholdWithOneUnrevealed(uint256 contentId) internal returns (uint256 roundId) {
        address[] memory voters = _fourVoters();
        bool[] memory directions = _directions(true, true, false, true);
        bytes32[] memory salts = new bytes32[](voters.length);
        bytes32[] memory commitKeys = new bytes32[](voters.length);

        for (uint256 i = 0; i < voters.length; i++) {
            salts[i] = keccak256(abi.encodePacked("threshold-open", voters[i], contentId, directions[i], i));
            commitKeys[i] = _commitTestVote(
                DirectTestCommitRequest({
                    engine: votingEngine,
                    hrepToken: hrepToken,
                    voter: voters[i],
                    contentId: contentId,
                    isUp: directions[i],
                    stake: STAKE,
                    frontend: address(0),
                    salt: salts[i]
                })
            );
        }

        roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH_DURATION);

        for (uint256 i = 0; i < voters.length - 1; i++) {
            votingEngine.revealVoteByCommitKey(contentId, roundId, commitKeys[i], directions[i], 5_000, salts[i]);
        }
    }

    function _revealThresholdAndReturnUnrevealed(uint256 contentId)
        internal
        returns (uint256 roundId, bytes32 lateCommitKey, bytes32 lateSalt, bool lateDirection)
    {
        address[] memory voters = _fourVoters();
        bool[] memory directions = _directions(true, true, false, true);
        bytes32[] memory salts = new bytes32[](voters.length);
        bytes32[] memory commitKeys = new bytes32[](voters.length);

        for (uint256 i = 0; i < voters.length; i++) {
            salts[i] = keccak256(abi.encodePacked("late-required", voters[i], contentId, directions[i], i));
            commitKeys[i] = _commitTestVote(
                DirectTestCommitRequest({
                    engine: votingEngine,
                    hrepToken: hrepToken,
                    voter: voters[i],
                    contentId: contentId,
                    isUp: directions[i],
                    stake: STAKE,
                    frontend: address(0),
                    salt: salts[i]
                })
            );
        }

        roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH_DURATION);

        for (uint256 i = 0; i < voters.length - 1; i++) {
            votingEngine.revealVoteByCommitKey(contentId, roundId, commitKeys[i], directions[i], 5_000, salts[i]);
        }

        lateCommitKey = commitKeys[voters.length - 1];
        lateSalt = salts[voters.length - 1];
        lateDirection = directions[voters.length - 1];
    }

    function _mockSettledRound(uint256 contentId, uint256 roundId, uint16 revealedCount) internal {
        vm.mockCall(
            address(votingEngine),
            abi.encodeWithSignature("rounds(uint256,uint256)", contentId, roundId),
            abi.encode(
                uint48(block.timestamp),
                RoundLib.RoundState.Settled,
                revealedCount,
                revealedCount,
                uint64(0),
                uint64(0),
                uint64(0),
                uint16(0),
                uint16(0),
                true,
                uint48(block.timestamp),
                uint48(block.timestamp),
                uint64(0),
                uint64(0)
            )
        );
    }

    function _mockRevealedCommitForRaterIdentity(
        uint256 contentId,
        uint256 roundId,
        uint256 raterIdentity,
        address voter
    ) internal {
        bytes32 commitKey = keccak256(abi.encode(contentId, roundId, raterIdentity, voter));
        bytes32 identityKey = bytes32(raterIdentityRegistry.getCredentialNullifier(raterIdentity));
        uint256 index = mockedRoundCommitCount[contentId][roundId]++;
        vm.mockCall(
            address(votingEngine),
            abi.encodeWithSignature("getRoundCommitKey(uint256,uint256,uint256)", contentId, roundId, index),
            abi.encode(commitKey)
        );
        vm.mockCall(
            address(votingEngine),
            abi.encodeWithSignature("identityCommitKey(uint256,uint256,bytes32)", contentId, roundId, identityKey),
            abi.encode(commitKey)
        );
        vm.mockCall(
            address(votingEngine),
            abi.encodeWithSignature("commitIdentityKey(uint256,uint256,bytes32)", contentId, roundId, commitKey),
            abi.encode(identityKey)
        );
        vm.mockCall(
            address(votingEngine),
            abi.encodeWithSignature("commitIdentityHolder(uint256,uint256,bytes32)", contentId, roundId, commitKey),
            abi.encode(voter)
        );
        vm.mockCall(
            address(votingEngine),
            abi.encodeWithSignature("commitRevealData(uint256,uint256,bytes32)", contentId, roundId, commitKey),
            abi.encode(bytes(""), uint64(0), bytes32(0), uint48(block.timestamp), true, uint64(STAKE))
        );
        // Escrow reads via the narrow commitCore getter for gas; mock it too so synthetic
        // reveals behave like real commits.
        vm.mockCall(
            address(votingEngine),
            abi.encodeWithSignature("commitCore(uint256,uint256,bytes32)", contentId, roundId, commitKey),
            abi.encode(voter, uint64(STAKE), address(0), uint48(block.timestamp), true, true, uint8(0))
        );
    }

    function _registerFrontend(address frontend) internal {
        vm.startPrank(frontend);
        hrepToken.approve(address(frontendRegistry), frontendRegistry.STAKE_AMOUNT());
        frontendRegistry.register();
        vm.stopPrank();
    }

    function _migrateRaterIdentitiesWithDifferentIds()
        internal
        returns (MockRaterIdentityRegistry migratedRaterIdentityRegistry)
    {
        migratedRaterIdentityRegistry = new MockRaterIdentityRegistry();
        address[7] memory migratedHumans = [voter3, voter2, voter1, submitter, funder, voter4, frontend1];
        for (uint256 i = 0; i < migratedHumans.length; i++) {
            migratedRaterIdentityRegistry.setHolder(migratedHumans[i]);
        }

        vm.startPrank(owner);
        protocolConfig.setRaterRegistry(address(migratedRaterIdentityRegistry));
        vm.stopPrank();
    }

    function _migrateRaterIdentitiesWithVoter1AtOldFunderId()
        internal
        returns (MockRaterIdentityRegistry migratedRaterIdentityRegistry)
    {
        migratedRaterIdentityRegistry = new MockRaterIdentityRegistry();
        address[6] memory migratedHumans = [submitter, voter1, voter2, voter3, voter4, frontend1];
        for (uint256 i = 0; i < migratedHumans.length; i++) {
            migratedRaterIdentityRegistry.setHolder(migratedHumans[i]);
        }

        vm.startPrank(owner);
        protocolConfig.setRaterRegistry(address(migratedRaterIdentityRegistry));
        vm.stopPrank();
    }

    function _threeVoters() internal view returns (address[] memory voters) {
        voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
    }

    function _voters(address voterA, address voterB, address voterC) internal pure returns (address[] memory voters) {
        voters = new address[](3);
        voters[0] = voterA;
        voters[1] = voterB;
        voters[2] = voterC;
    }

    function _ineligibleVoters() internal view returns (address[] memory voters) {
        voters = new address[](3);
        voters[0] = funder;
        voters[1] = voter1;
        voters[2] = voter2;
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

    function _assertThresholdReachedAtLe(uint256 contentId, uint256 roundId, uint256 maxThresholdReachedAt)
        internal
        view
    {
        assertLe(
            RoundEngineReadHelpers.round(votingEngine, contentId, roundId).thresholdReachedAt, maxThresholdReachedAt
        );
    }

    // --- Security fix: BUNDLE_CLAIM_GRACE ---

    function testBundleRefundWindowAllowsThresholdReachedRoundsToSettleAfterClose() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);
        uint256 bountyClosesAt = block.timestamp + 30 days;

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);
        uint256 firstRoundId = _revealRoundWith(voters, contentIds[0], directions);
        uint256 secondRoundId = _revealRoundWith(voters, contentIds[1], directions);
        _assertThresholdReachedAtLe(contentIds[0], firstRoundId, bountyClosesAt);
        _assertThresholdReachedAtLe(contentIds[1], secondRoundId, bountyClosesAt);

        vm.warp(bountyClosesAt + BUNDLE_CLAIM_GRACE + 1);
        vm.expectRevert("Grace");
        rewardPoolEscrow.refundQuestionBundleReward(bundleId);

        votingEngine.settleRound(contentIds[0], firstRoundId);
        votingEngine.settleRound(contentIds[1], secondRoundId);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[1], secondRoundId);

        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), 0);
        vm.prank(voter1);
        assertGt(rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0), 0);
    }

    function testBundleRefundWindowCoversMaxRevealGraceForOpenThresholdRounds() public {
        vm.prank(owner);
        protocolConfig.setRevealGracePeriod(31 days);

        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);
        uint256 bountyClosesAt = block.timestamp + 30 days;

        vm.warp(bountyClosesAt - 1 days);
        uint256 firstRoundId = _revealThresholdWithOneUnrevealed(contentIds[0]);
        uint256 secondRoundId = _revealThresholdWithOneUnrevealed(contentIds[1]);
        _assertThresholdReachedAtLe(contentIds[0], firstRoundId, bountyClosesAt);
        _assertThresholdReachedAtLe(contentIds[1], secondRoundId, bountyClosesAt);

        vm.warp(bountyClosesAt + (2 * BUNDLE_CLAIM_GRACE) + 1);
        vm.expectRevert("Grace");
        rewardPoolEscrow.refundQuestionBundleReward(bundleId);

        uint256 firstSettlementReadyAt = votingEngine.lastCommitRevealableAfter(contentIds[0], firstRoundId)
            + protocolConfig.revealGracePeriod() + 1;
        uint256 secondSettlementReadyAt = votingEngine.lastCommitRevealableAfter(contentIds[1], secondRoundId)
            + protocolConfig.revealGracePeriod() + 1;
        vm.warp(firstSettlementReadyAt > secondSettlementReadyAt ? firstSettlementReadyAt : secondSettlementReadyAt);

        votingEngine.settleRound(contentIds[0], firstRoundId);
        votingEngine.settleRound(contentIds[1], secondRoundId);
        votingEngine.processUnrevealedVotes(contentIds[0], firstRoundId, 0, 0);
        votingEngine.processUnrevealedVotes(contentIds[1], secondRoundId, 0, 0);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[1], secondRoundId);

        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), 0);
    }

    function testBundleRefund_NoRecordedRoundSetStillWaitsForGraceAtBountyClose() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);
        uint256 bountyClosesAt = block.timestamp + 30 days;

        vm.warp(bountyClosesAt + 1);
        vm.expectRevert("Grace");
        rewardPoolEscrow.refundQuestionBundleReward(bundleId);

        vm.warp(bountyClosesAt + BUNDLE_REFUND_GRACE + 1);
        uint256 treasuryBalanceBefore = usdc.balanceOf(treasury);
        uint256 refundAmount = rewardPoolEscrow.refundQuestionBundleReward(bundleId);
        assertEq(refundAmount, REWARD_POOL_AMOUNT);
        assertEq(usdc.balanceOf(treasury), treasuryBalanceBefore + refundAmount);
    }

    function testBundleRefund_CompleteRecordedRoundSetQualifiesBeforeRefund() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);
        uint256 bountyClosesAt = block.timestamp + 30 days;

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);
        _settleRoundWithoutBundleSync(voters, contentIds[0], directions);
        _settleRoundWithoutBundleSync(voters, contentIds[1], directions);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), 0);

        vm.warp(bountyClosesAt + BUNDLE_REFUND_GRACE + 1);
        assertEq(rewardPoolEscrow.refundQuestionBundleReward(bundleId), 0);
        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), 0);

        vm.expectRevert("Grace");
        rewardPoolEscrow.refundQuestionBundleReward(bundleId);

        vm.prank(voter1);
        assertGt(rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0), 0);
    }

    function testBundleRefund_ClaimGraceBlocksRaceAtBountyClose() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);
        uint256 bountyClosesAt = block.timestamp + 30 days;

        address[] memory voters = new address[](3);
        voters[0] = voter2;
        voters[1] = voter3;
        voters[2] = voter4;
        bool[] memory directions = _directions(true, true, false);

        _settleRoundWith(voters, contentIds[0], directions);
        _settleRoundWith(voters, contentIds[1], directions);

        // Voter2 claims their bundle reward; voter3 has not yet claimed, so the bundle
        // is still claim-open and BUNDLE_CLAIM_GRACE should apply.
        vm.prank(voter2);
        rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0);
        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter3), 0);

        // Jump past bountyClosesAt (helper sets +30 days).
        vm.warp(bountyClosesAt + 1);
        vm.expectRevert("Grace");
        rewardPoolEscrow.refundQuestionBundleReward(bundleId);

        // Jump past the refund grace; refund now allowed (forfeits to treasury since
        // registry-initiated bundles are nonRefundable).
        vm.warp(bountyClosesAt + BUNDLE_REFUND_GRACE + 1);
        uint256 startedGrace = rewardPoolEscrow.refundQuestionBundleReward(bundleId);
        assertEq(startedGrace, 0);

        vm.warp(block.timestamp + BUNDLE_CLAIM_GRACE + 1);
        uint256 treasuryBalanceBefore = usdc.balanceOf(treasury);
        uint256 refundAmount = rewardPoolEscrow.refundQuestionBundleReward(bundleId);
        assertGt(refundAmount, 0);
        assertEq(usdc.balanceOf(treasury), treasuryBalanceBefore + refundAmount);
    }

    function testBundleRefund_LateSyncedRoundSetExtendsClaimGrace() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, 120e6, 3, 2);
        uint256 bountyClosesAt = block.timestamp + 30 days;

        address[] memory voters = new address[](3);
        voters[0] = voter2;
        voters[1] = voter3;
        voters[2] = voter4;
        bool[] memory directions = _directions(true, true, false);

        _settleRoundWith(voters, contentIds[0], directions);
        _settleRoundWith(voters, contentIds[1], directions);

        vm.startPrank(owner);
        MockQuestionRewardPoolEscrow mockEscrow = new MockQuestionRewardPoolEscrow();
        registry.pause();
        registry.setQuestionRewardPoolEscrow(address(mockEscrow));
        registry.unpause();
        vm.stopPrank();

        vm.warp(block.timestamp + 25 hours);
        // Settle without auto-sync: the registry's active escrow is the mock, so we want to
        // verify the LATER `syncBundleQuestionTerminal` call does the recording on the real
        // escrow (the "late-synced round set" scenario).
        uint256 lateFirstRoundId = _settleRoundWithoutBundleSync(voters, contentIds[0], directions);
        uint256 lateSecondRoundId = _settleRoundWithoutBundleSync(voters, contentIds[1], directions);

        vm.startPrank(owner);
        registry.pause();
        registry.setQuestionRewardPoolEscrow(address(rewardPoolEscrow));
        registry.unpause();
        vm.stopPrank();

        vm.warp(bountyClosesAt + BUNDLE_REFUND_GRACE + 1);
        assertEq(rewardPoolEscrow.refundQuestionBundleReward(bundleId), 0);
        vm.warp(block.timestamp + BUNDLE_CLAIM_GRACE + 1);

        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[0], lateFirstRoundId);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[1], lateSecondRoundId);
        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 1, voter2), 0);

        assertEq(rewardPoolEscrow.refundQuestionBundleReward(bundleId), 0);
        vm.expectRevert("Grace");
        rewardPoolEscrow.refundQuestionBundleReward(bundleId);

        vm.prank(voter2);
        assertGt(rewardPoolEscrow.claimQuestionBundleReward(bundleId, 1), 0);
    }

    function testBundleRefund_LateSyncedRoundSetWaitsForCleanupBeforeClaimGrace() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, 120e6, 3, 2);
        uint256 bountyClosesAt = block.timestamp + 30 days;

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);

        _settleRoundWith(voters, contentIds[0], directions);
        _settleRoundWith(voters, contentIds[1], directions);

        vm.startPrank(owner);
        MockQuestionRewardPoolEscrow mockEscrow = new MockQuestionRewardPoolEscrow();
        registry.pause();
        registry.setQuestionRewardPoolEscrow(address(mockEscrow));
        registry.unpause();
        vm.stopPrank();

        vm.warp(block.timestamp + 25 hours);
        uint256 cleanupRoundId = _settleRoundWithOneUnrevealed(contentIds[0]);
        uint256 lateSecondRoundId = _settleRoundWith(voters, contentIds[1], directions);

        vm.startPrank(owner);
        registry.pause();
        registry.setQuestionRewardPoolEscrow(address(rewardPoolEscrow));
        registry.unpause();
        vm.stopPrank();

        vm.warp(bountyClosesAt + BUNDLE_REFUND_GRACE + 1);
        assertEq(rewardPoolEscrow.refundQuestionBundleReward(bundleId), 0);
        vm.warp(block.timestamp + BUNDLE_CLAIM_GRACE + 1);

        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[0], cleanupRoundId);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[1], lateSecondRoundId);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 1, voter1), 0);

        vm.expectRevert("Cleanup pending");
        rewardPoolEscrow.refundQuestionBundleReward(bundleId);

        votingEngine.processUnrevealedVotes(contentIds[0], cleanupRoundId, 0, 0);
        assertEq(rewardPoolEscrow.refundQuestionBundleReward(bundleId), 0);
        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 1, voter1), 0);

        vm.prank(voter1);
        assertGt(rewardPoolEscrow.claimQuestionBundleReward(bundleId, 1), 0);
    }

    function testBundleRefund_WaitsForUnrevealedCleanupAfterGrace() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);
        uint256 bountyClosesAt = block.timestamp + 30 days;

        uint256 cleanupRoundId = _settleRoundWithOneUnrevealed(contentIds[0]);

        address[] memory voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory directions = _directions(true, true, false);
        _settleRoundWith(voters, contentIds[1], directions);

        vm.warp(bountyClosesAt + BUNDLE_REFUND_GRACE + 1);
        vm.expectRevert("Cleanup pending");
        rewardPoolEscrow.refundQuestionBundleReward(bundleId);

        votingEngine.processUnrevealedVotes(contentIds[0], cleanupRoundId, 0, 0);
        uint256 startedGrace = rewardPoolEscrow.refundQuestionBundleReward(bundleId);
        assertEq(startedGrace, 0);

        vm.warp(block.timestamp + BUNDLE_CLAIM_GRACE + 1);
        uint256 treasuryBalanceBefore = usdc.balanceOf(treasury);
        uint256 refundAmount = rewardPoolEscrow.refundQuestionBundleReward(bundleId);
        assertGt(refundAmount, 0);
        assertEq(usdc.balanceOf(treasury), treasuryBalanceBefore + refundAmount);
    }
}

contract MockQuestionRewardOracleFrontendRegistry {
    mapping(address => bool) internal eligible;

    function setEligible(address frontend, bool value) external {
        eligible[frontend] = value;
    }

    function isEligible(address frontend) external view returns (bool) {
        return eligible[frontend];
    }
}
