// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { VotingTestBase } from "./helpers/VotingTestHelpers.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { FrontendRegistry } from "../contracts/FrontendRegistry.sol";
import { MockCategoryRegistry } from "../contracts/mocks/MockCategoryRegistry.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";
import { ClusterPayoutOracle } from "../contracts/ClusterPayoutOracle.sol";
import { IClusterPayoutOracle } from "../contracts/interfaces/IClusterPayoutOracle.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { QuestionRewardPoolEscrow } from "../contracts/QuestionRewardPoolEscrow.sol";
import { RoundRewardDistributor } from "../contracts/RoundRewardDistributor.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
import { RoundEngineReadHelpers } from "./helpers/RoundEngineReadHelpers.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import {
    AuthorizedRewardPoolParams,
    BOUNTY_ELIGIBILITY_PASSPORT,
    BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG,
    BOUNTY_ELIGIBILITY_VERIFIED_HUMAN,
    RoundSnapshot
} from "../contracts/libraries/QuestionRewardPoolEscrowTypes.sol";
import { TlockVoteLib } from "../contracts/libraries/TlockVoteLib.sol";
import { Eip3009Authorization } from "../contracts/interfaces/IEip3009.sol";
import { X402QuestionSubmitter } from "../contracts/X402QuestionSubmitter.sol";
import { MockQuestionRewardPoolEscrow } from "./mocks/MockQuestionRewardPoolEscrow.sol";
import { MockRaterIdentityRegistry } from "./mocks/MockRaterIdentityRegistry.sol";

contract QuestionRewardPoolEscrowTest is VotingTestBase {
    LoopReputation public lrepToken;
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
    uint256 internal constant FUNDER_KEY = 0xF00D;
    uint256 internal constant X402_AGENT_KEY = 0xA11CE;
    uint256 internal constant WRONG_AUTHORIZATION_SIGNER_KEY = 0xB0B;
    address public funder;
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
    string internal constant DEFAULT_MEDIA_URL = "hotel-room";
    uint256 internal constant CATEGORY_ID = 1;
    uint8 internal constant REWARD_ASSET_LREP = 0;
    uint8 internal constant REWARD_ASSET_USDC = 1;
    uint256 internal constant MIN_REWARD_POOL_PARTICIPANTS = 3;
    uint256 internal constant HIGH_VALUE_REWARD_POOL_THRESHOLD = 1_000e6;
    uint256 internal constant MIN_HIGH_VALUE_PARTICIPANTS = 5;
    uint256 internal constant VERY_HIGH_VALUE_REWARD_POOL_THRESHOLD = 10_000e6;
    uint256 internal constant MIN_VERY_HIGH_VALUE_PARTICIPANTS = 8;
    uint256 internal constant MAX_FRONTEND_FEE_BPS = 500;
    uint256 internal constant BUNDLE_CLAIM_GRACE = 7 days;
    uint256 internal constant BUNDLE_REFUND_GRACE = 98 days;
    mapping(uint256 => mapping(uint256 => uint256)) internal mockedRoundCommitCount;

    /// @dev M-Oracle-1: stub so the test contract can act as a question-reward consumer in the
    ///      "different consumer" test paths. Returns 1 (always-ready) to advance past the oracle's
    ///      source-readiness gate, letting downstream qualify/cluster-mismatch defenses run.
    function roundPayoutSnapshotSourceReadyAt(uint8, uint256, uint256, uint256) external pure returns (uint64) {
        return 1;
    }

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
        funder = vm.addr(FUNDER_KEY);

        vm.startPrank(owner);

        lrepToken = new LoopReputation(owner, owner);
        lrepToken.grantRole(lrepToken.MINTER_ROLE(), owner);

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
        raterIdentityRegistry = new MockRaterIdentityRegistry();
        frontendRegistry = FrontendRegistry(
            address(
                new ERC1967Proxy(
                    address(frontendRegistryImpl),
                    abi.encodeCall(FrontendRegistry.initialize, (owner, owner, address(lrepToken)))
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
                            address(lrepToken),
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
        x402QuestionSubmitter = new X402QuestionSubmitter(registry, address(usdc), address(rewardPoolEscrow), owner);
        registry.grantRole(registry.X402_GATEWAY_ROLE(), address(x402QuestionSubmitter));

        frontendRegistry.setVotingEngine(address(votingEngine));

        protocolConfig.setRewardDistributor(address(rewardDistributor));
        protocolConfig.setCategoryRegistry(address(mockCategoryRegistry));
        protocolConfig.setFrontendRegistry(address(frontendRegistry));
        protocolConfig.setTreasury(treasury);
        protocolConfig.setRaterRegistry(address(raterIdentityRegistry));
        _setTlockDrandConfig(protocolConfig, DEFAULT_DRAND_CHAIN_HASH, DEFAULT_DRAND_GENESIS_TIME, DEFAULT_DRAND_PERIOD);
        _setTlockRoundConfig(protocolConfig, EPOCH_DURATION, 7 days, 3, 100);

        address[7] memory humans = [submitter, funder, voter1, voter2, voter3, voter4, frontend1];
        for (uint256 i = 0; i < humans.length; i++) {
            raterIdentityRegistry.setHolder(humans[i]);
            lrepToken.mint(humans[i], 10_000e6);
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

    function testQuestionRewardsUseParticipationWeights() public {
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
        assertEq(claimable1, REWARD_POOL_AMOUNT / 3);
        assertEq(claimable2, REWARD_POOL_AMOUNT / 3);
        assertEq(claimable3, REWARD_POOL_AMOUNT / 3);

        uint256 reward1 = _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);
        uint256 reward2 = _claimQuestionRewardAndAssert(voter2, rewardPoolId, roundId);
        uint256 reward3 = _claimQuestionRewardAndAssert(voter3, rewardPoolId, roundId);

        assertEq(reward1, claimable1);
        assertEq(reward2, claimable2);
        assertEq(reward1 + reward2 + reward3, REWARD_POOL_AMOUNT);
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), 0);
    }

    function testCreateRewardPoolWithAuthorizationFundsUsdcPool() public {
        uint256 contentId = _submitQuestion("authorized-reward-pool");
        AuthorizedRewardPoolParams memory params = _authorizedRewardPoolParams(contentId);
        Eip3009Authorization memory authorization = _rewardPoolAuthorization(funder, params);
        uint256 escrowBalanceBefore = usdc.balanceOf(address(rewardPoolEscrow));
        uint256 funderBalanceBefore = usdc.balanceOf(funder);

        vm.prank(voter1);
        uint256 rewardPoolId = rewardPoolEscrow.createRewardPoolWithAuthorization(params, authorization);

        assertGt(rewardPoolId, 0);
        assertTrue(usdc.authorizationState(funder, authorization.nonce));
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), escrowBalanceBefore + params.amount);
        assertEq(usdc.balanceOf(funder), funderBalanceBefore - params.amount);
    }

    function testCreateRewardPoolWithAuthorizationRejectsInvalidSignature() public {
        uint256 contentId = _submitQuestion("authorized-reward-pool-bad-signature");
        AuthorizedRewardPoolParams memory params = _authorizedRewardPoolParams(contentId);
        Eip3009Authorization memory authorization = _rewardPoolAuthorization(funder, params);
        _signAuthorization(authorization, WRONG_AUTHORIZATION_SIGNER_KEY);
        uint256 escrowBalanceBefore = usdc.balanceOf(address(rewardPoolEscrow));
        uint256 funderBalanceBefore = usdc.balanceOf(funder);

        vm.expectRevert("MockERC20: invalid authorization signature");
        rewardPoolEscrow.createRewardPoolWithAuthorization(params, authorization);

        assertFalse(usdc.authorizationState(funder, authorization.nonce));
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), escrowBalanceBefore);
        assertEq(usdc.balanceOf(funder), funderBalanceBefore);
    }

    function testCreateRewardPoolWithAuthorizationRejectsBadNonceBeforeTransfer() public {
        uint256 contentId = _submitQuestion("authorized-reward-pool-bad-nonce");
        AuthorizedRewardPoolParams memory params = _authorizedRewardPoolParams(contentId);
        Eip3009Authorization memory authorization = _rewardPoolAuthorization(funder, params);
        authorization.nonce = keccak256("wrong reward pool nonce");
        uint256 escrowBalanceBefore = usdc.balanceOf(address(rewardPoolEscrow));
        uint256 funderBalanceBefore = usdc.balanceOf(funder);

        vm.expectRevert("Bad nonce");
        rewardPoolEscrow.createRewardPoolWithAuthorization(params, authorization);

        assertFalse(usdc.authorizationState(funder, authorization.nonce));
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), escrowBalanceBefore);
        assertEq(usdc.balanceOf(funder), funderBalanceBefore);
    }

    function testCreateRewardPoolWithAuthorizationRejectsShortReceipt() public {
        uint256 contentId = _submitQuestion("authorized-reward-pool-short-receipt");
        AuthorizedRewardPoolParams memory params = _authorizedRewardPoolParams(contentId);
        Eip3009Authorization memory authorization = _rewardPoolAuthorization(funder, params);
        uint256 escrowBalanceBefore = usdc.balanceOf(address(rewardPoolEscrow));
        uint256 funderBalanceBefore = usdc.balanceOf(funder);
        usdc.setAuthorizationTransferShortfall(1);

        vm.expectRevert("Bad token");
        rewardPoolEscrow.createRewardPoolWithAuthorization(params, authorization);

        assertFalse(usdc.authorizationState(funder, authorization.nonce));
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), escrowBalanceBefore);
        assertEq(usdc.balanceOf(funder), funderBalanceBefore);
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

    function testVerifiedHumanBountyRejectsVoterVerifiedAfterQualification() public {
        raterIdentityRegistry.revokeHumanCredential(voter4);

        uint256 contentId = _submitQuestion("verified-after-qualification");
        uint256 rewardPoolId =
            _createRewardPoolWithEligibility(contentId, REWARD_POOL_AMOUNT, 3, 1, BOUNTY_ELIGIBILITY_VERIFIED_HUMAN);

        uint256 roundId = _settleRoundWith(_fourVoters(), contentId, _directions(true, true, false, true));
        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);

        raterIdentityRegistry.setHolder(voter4);

        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter4), 0);
        vm.prank(voter4);
        vm.expectRevert("Not bounty eligible");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);
    }

    function testVerifiedHumanBountyAllowsQualifiedVoterAfterCredentialRevoked() public {
        uint256 contentId = _submitQuestion("verified-revoked-after-qualification");
        uint256 rewardPoolId =
            _createRewardPoolWithEligibility(contentId, REWARD_POOL_AMOUNT, 3, 1, BOUNTY_ELIGIBILITY_VERIFIED_HUMAN);

        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);

        raterIdentityRegistry.revokeHumanCredential(voter1);

        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);
        _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);
    }

    function testMultiCredentialBountyAllowsPassportOrVerifiedHuman() public {
        uint8 passportOrHumanEligibility = BOUNTY_ELIGIBILITY_PASSPORT | BOUNTY_ELIGIBILITY_VERIFIED_HUMAN;
        raterIdentityRegistry.setCredentialStatusMasks(voter1, BOUNTY_ELIGIBILITY_PASSPORT, 0);
        raterIdentityRegistry.setCredentialStatusMasks(voter2, BOUNTY_ELIGIBILITY_VERIFIED_HUMAN, 0);
        raterIdentityRegistry.setCredentialStatusMasks(voter3, BOUNTY_ELIGIBILITY_PASSPORT, 0);
        raterIdentityRegistry.setCredentialStatusMasks(voter4, 0, 0);

        uint256 contentId = _submitQuestion("passport-or-human-bounty");
        uint256 rewardPoolId =
            _createRewardPoolWithEligibility(contentId, REWARD_POOL_AMOUNT, 3, 1, passportOrHumanEligibility);

        uint256 roundId = _settleRoundWith(_fourVoters(), contentId, _directions(true, true, false, true));
        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);

        RoundSnapshot memory snapshot = rewardPoolEscrow.getRoundSnapshot(rewardPoolId, roundId);
        assertEq(snapshot.rawEligibleVoters, 3);
        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);
        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter2), 0);
        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter4), 0);

        vm.prank(voter4);
        vm.expectRevert("Not bounty eligible");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);
    }

    function testRecentMultiCredentialBountyAllowsAnyFreshSelectedCredential() public {
        uint8 passportOrHumanEligibility = BOUNTY_ELIGIBILITY_PASSPORT | BOUNTY_ELIGIBILITY_VERIFIED_HUMAN;
        uint8 recentPassportOrHumanEligibility = BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG | passportOrHumanEligibility;
        raterIdentityRegistry.setCredentialStatusMasks(voter1, passportOrHumanEligibility, BOUNTY_ELIGIBILITY_PASSPORT);
        raterIdentityRegistry.setCredentialStatusMasks(
            voter2, passportOrHumanEligibility, BOUNTY_ELIGIBILITY_VERIFIED_HUMAN
        );
        raterIdentityRegistry.setCredentialStatusMasks(voter3, BOUNTY_ELIGIBILITY_PASSPORT, BOUNTY_ELIGIBILITY_PASSPORT);
        raterIdentityRegistry.setCredentialStatusMasks(voter4, passportOrHumanEligibility, 0);

        uint256 contentId = _submitQuestion("recent-passport-or-human-bounty");
        uint256 rewardPoolId =
            _createRewardPoolWithEligibility(contentId, REWARD_POOL_AMOUNT, 3, 1, recentPassportOrHumanEligibility);

        uint256 roundId = _settleRoundWith(_fourVoters(), contentId, _directions(true, true, false, true));
        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);

        RoundSnapshot memory snapshot = rewardPoolEscrow.getRoundSnapshot(rewardPoolId, roundId);
        assertEq(snapshot.rawEligibleVoters, 3);
        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);
        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter2), 0);
        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter3), 0);
        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter4), 0);
    }

    function testRecentRecheckBountyUsesFreshnessSnapshotAtCommit() public {
        uint8 humanBit = BOUNTY_ELIGIBILITY_VERIFIED_HUMAN;
        uint8 recentHumanEligibility = BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG | BOUNTY_ELIGIBILITY_VERIFIED_HUMAN;
        raterIdentityRegistry.setCredentialStatusMasks(voter1, humanBit, humanBit);
        raterIdentityRegistry.setCredentialStatusMasks(voter2, humanBit, humanBit);
        raterIdentityRegistry.setCredentialStatusMasks(voter3, humanBit, humanBit);

        uint256 contentId = _submitQuestion("recent-recheck-snapshot");
        uint256 rewardPoolId =
            _createRewardPoolWithEligibility(contentId, REWARD_POOL_AMOUNT, 3, 1, recentHumanEligibility);
        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));

        raterIdentityRegistry.setCredentialStatusMasks(voter1, humanBit, 0);
        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);

        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);

        RoundSnapshot memory snapshot = rewardPoolEscrow.getRoundSnapshot(rewardPoolId, roundId);
        assertEq(snapshot.rawEligibleVoters, 3);
        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);
        _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);
    }

    function testRecentRecheckBountyRejectsVoterRecheckedAfterCommit() public {
        uint8 humanBit = BOUNTY_ELIGIBILITY_VERIFIED_HUMAN;
        uint8 recentHumanEligibility = BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG | BOUNTY_ELIGIBILITY_VERIFIED_HUMAN;
        raterIdentityRegistry.setCredentialStatusMasks(voter1, humanBit, humanBit);
        raterIdentityRegistry.setCredentialStatusMasks(voter2, humanBit, humanBit);
        raterIdentityRegistry.setCredentialStatusMasks(voter3, humanBit, humanBit);
        raterIdentityRegistry.setCredentialStatusMasks(voter4, humanBit, 0);

        uint256 contentId = _submitQuestion("recent-recheck-too-late");
        uint256 rewardPoolId =
            _createRewardPoolWithEligibility(contentId, REWARD_POOL_AMOUNT, 3, 1, recentHumanEligibility);
        uint256 roundId = _settleRoundWith(_fourVoters(), contentId, _directions(true, true, false, true));

        raterIdentityRegistry.setCredentialStatusMasks(voter4, humanBit, humanBit);
        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter4), 0);

        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);

        RoundSnapshot memory snapshot = rewardPoolEscrow.getRoundSnapshot(rewardPoolId, roundId);
        assertEq(snapshot.rawEligibleVoters, 3);
        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);
        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter4), 0);

        vm.prank(voter4);
        vm.expectRevert("Not bounty eligible");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);
    }

    function testRewardPoolRejectsRecentRecheckFlagWithoutCredentialKind() public {
        uint256 contentId = _submitQuestion("recent-open-policy");

        vm.prank(funder);
        usdc.approve(address(rewardPoolEscrow), REWARD_POOL_AMOUNT);

        vm.expectRevert("Invalid eligibility");
        vm.prank(address(registry));
        rewardPoolEscrow.createSubmissionRewardPoolFromRegistry(
            contentId,
            funder,
            address(0),
            REWARD_ASSET_USDC,
            REWARD_POOL_AMOUNT,
            3,
            1,
            block.timestamp + 30 days,
            30 days,
            0,
            BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG
        );
    }

    function testSubmissionBundleRejectsRecentRecheckFlagWithoutCredentialKind() public {
        uint256[] memory contentIds = _submitBundleQuestions();

        vm.prank(funder);
        usdc.approve(address(rewardPoolEscrow), REWARD_POOL_AMOUNT);

        vm.expectRevert("Invalid eligibility");
        vm.prank(address(registry));
        rewardPoolEscrow.createSubmissionBundleFromRegistry(
            1,
            contentIds,
            funder,
            REWARD_ASSET_USDC,
            REWARD_POOL_AMOUNT,
            3,
            1,
            block.timestamp + 30 days,
            30 days,
            30 days,
            BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG
        );
    }

    function testHighValueRewardPoolRequiresHigherParticipantFloor() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 5, maxVoters: 5
        });
        uint256 contentId = _submitQuestionWithRoundConfig("high-value-floor", roundConfig);
        uint256 highValueAmount = HIGH_VALUE_REWARD_POOL_THRESHOLD;

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), highValueAmount);
        vm.expectRevert("High-value floor");
        rewardPoolEscrow.createRewardPool(contentId, highValueAmount, 3, 1, block.timestamp + 30 days, 30 days, 0);

        usdc.approve(address(rewardPoolEscrow), highValueAmount);
        uint256 rewardPoolId = rewardPoolEscrow.createRewardPool(
            contentId, highValueAmount, MIN_HIGH_VALUE_PARTICIPANTS, 1, block.timestamp + 30 days, 30 days, 0
        );
        vm.stopPrank();

        assertGt(rewardPoolId, 0);
    }

    function testVeryHighValueRewardPoolRequiresEconomicParticipantFloor() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 8, maxVoters: 8
        });
        uint256 contentId = _submitQuestionWithRoundConfig("very-high-value-floor", roundConfig);
        uint256 veryHighValueAmount = VERY_HIGH_VALUE_REWARD_POOL_THRESHOLD;
        usdc.mint(funder, 2 * veryHighValueAmount);

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), veryHighValueAmount);
        vm.expectRevert("High-value floor");
        rewardPoolEscrow.createRewardPool(
            contentId, veryHighValueAmount, MIN_HIGH_VALUE_PARTICIPANTS, 1, block.timestamp + 30 days, 30 days, 0
        );

        usdc.approve(address(rewardPoolEscrow), veryHighValueAmount);
        uint256 rewardPoolId = rewardPoolEscrow.createRewardPool(
            contentId, veryHighValueAmount, MIN_VERY_HIGH_VALUE_PARTICIPANTS, 1, block.timestamp + 30 days, 30 days, 0
        );
        vm.stopPrank();

        assertGt(rewardPoolId, 0);
    }

    function testOpenWalletCanClaimQuestionRewardWithoutRaterIdentity() public {
        address openVoter1 = address(201);
        address openVoter2 = address(202);
        address openVoter3 = address(203);
        vm.startPrank(owner);
        lrepToken.mint(openVoter1, 10_000e6);
        lrepToken.mint(openVoter2, 10_000e6);
        lrepToken.mint(openVoter3, 10_000e6);
        vm.stopPrank();

        uint256 contentId = _submitQuestion("open-wallet-single");
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
        QuestionRewardPoolEscrow replacementEscrow = _deployReplacementQuestionRewardPoolEscrow();

        vm.startPrank(owner);
        registry.pause();
        registry.setQuestionRewardPoolEscrow(address(replacementEscrow));
        registry.unpause();
        vm.stopPrank();

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), REWARD_POOL_AMOUNT);
        vm.expectRevert("Stale escrow");
        rewardPoolEscrow.createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1, block.timestamp + 30 days, 30 days, 0);
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
        uint256 rewardPoolId = rewardPoolEscrow.createPurposeRewardPool(
            contentId, REWARD_POOL_AMOUNT, 3, 1, reasonHash, bountyClosesAt, 30 days, 0, 1, 0
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

    function testSyncedBountyWindowQualifiesPreCloseCommitsRevealedAfterClose() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 3, maxVoters: 3
        });
        uint256 submittedAt = block.timestamp;
        uint256 contentId = _submitQuestionWithRoundConfig("synced-bounty-window", roundConfig);
        uint256 bountyClosesAt = submittedAt + EPOCH_DURATION;
        uint256 rewardPoolId = _createRewardPoolWithExpiry(contentId, REWARD_POOL_AMOUNT, 3, 1, bountyClosesAt);

        vm.warp(submittedAt + 30 seconds);
        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);
        bytes32[] memory salts = new bytes32[](voters.length);
        bytes32[] memory commitKeys = new bytes32[](voters.length);
        for (uint256 i = 0; i < voters.length; i++) {
            salts[i] = keccak256(abi.encodePacked("synced-bounty-window", voters[i], contentId, i));
            commitKeys[i] = _commitTestVote(
                DirectTestCommitRequest({
                    engine: votingEngine,
                    lrepToken: lrepToken,
                    voter: voters[i],
                    contentId: contentId,
                    isUp: directions[i],
                    stake: STAKE,
                    frontend: address(0),
                    salt: salts[i]
                })
            );
            assertLe(
                _commitCommittedAt(
                    votingEngine,
                    contentId,
                    RoundEngineReadHelpers.activeRoundId(votingEngine, contentId),
                    commitKeys[i]
                ),
                bountyClosesAt,
                "commit must land inside synced bounty window"
            );
        }

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        uint256 revealableAt = _lastCommitRevealableAfter(votingEngine, contentId, roundId);
        assertGt(revealableAt, bountyClosesAt, "blind epoch reveal must be after synced bounty close");
        _warpPastTlockRevealTime(revealableAt);

        for (uint256 i = 0; i < voters.length; i++) {
            votingEngine.revealVoteByCommitKey(contentId, roundId, commitKeys[i], directions[i], 5_000, salts[i]);
        }
        _settleAfterRbtsSeed(votingEngine, contentId, roundId);

        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);
        _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);
    }

    function testCreateRewardPoolRejectsRequiredVotersBelowSettlementVoters() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 5, maxVoters: 5
        });
        uint256 contentId = _submitQuestionWithRoundConfig("underpaid-bounty", roundConfig);

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), 5e6);
        vm.expectRevert("Voters mismatch");
        rewardPoolEscrow.createRewardPool(
            contentId,
            5e6,
            /*requiredVoters=*/
            3,
            /*requiredSettledRounds=*/
            1,
            block.timestamp + 1 hours,
            1 hours,
            0
        );
        vm.stopPrank();
    }

    function testCreateRewardPoolRejectsRequiredVotersAboveSettlementVoters() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 3, maxVoters: 5
        });
        uint256 contentId = _submitQuestionWithRoundConfig("overgated-bounty", roundConfig);

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), 5e6);
        vm.expectRevert("Voters mismatch");
        rewardPoolEscrow.createRewardPool(
            contentId,
            5e6,
            /*requiredVoters=*/
            5,
            /*requiredSettledRounds=*/
            1,
            block.timestamp + 1 hours,
            1 hours,
            0
        );
        vm.stopPrank();
    }

    function testT1ThresholdReachedAfterBountyCloseStillQualifiesMatchedVoters() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 5, maxVoters: 5
        });
        uint256 contentId = _submitQuestionWithRoundConfig("t1", roundConfig);

        address voter5 = address(0x55);
        _registerTestVoter(voter5);

        uint256 fundedAmount = 5e6;
        uint256 bountyClosesAt = block.timestamp + 1 hours;
        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), fundedAmount);
        uint256 rewardPoolId = rewardPoolEscrow.createRewardPool(
            contentId,
            fundedAmount,
            /*requiredVoters=*/
            5,
            /*requiredSettledRounds=*/
            1,
            bountyClosesAt,
            1 hours,
            0
        );
        vm.stopPrank();

        address[5] memory voters = [voter1, voter2, voter3, voter4, voter5];
        bool[5] memory directions = [true, true, true, false, false];
        bytes32[5] memory salts;
        bytes32[5] memory commitKeys;
        for (uint256 i = 0; i < 5; i++) {
            salts[i] = keccak256(abi.encodePacked("t1", voters[i], contentId, i));
            commitKeys[i] = _commitTestVote(
                DirectTestCommitRequest({
                    engine: votingEngine,
                    lrepToken: lrepToken,
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

        _warpPastTlockRevealTime(block.timestamp + EPOCH_DURATION);
        for (uint256 i = 0; i < 3; i++) {
            votingEngine.revealVoteByCommitKey(contentId, roundId, commitKeys[i], directions[i], 5_000, salts[i]);
        }
        (,,,,, uint48 thresholdReachedMid,) = votingEngine.roundCore(contentId, roundId);
        assertEq(thresholdReachedMid, 0, "threshold should not be hit at 3 reveals when minVoters=5");

        vm.warp(bountyClosesAt + 1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, commitKeys[3], directions[3], 5_000, salts[3]);
        votingEngine.revealVoteByCommitKey(contentId, roundId, commitKeys[4], directions[4], 5_000, salts[4]);
        (,,,,, uint48 thresholdReachedAfter,) = votingEngine.roundCore(contentId, roundId);
        assertGt(thresholdReachedAfter, bountyClosesAt, "thresholdReachedAt should be after bounty close");

        _settleAfterRbtsSeed(votingEngine, contentId, roundId);

        uint256 claimableA = rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1);
        assertGt(claimableA, 0);
    }

    function testCreateSubmissionBundleRejectsCompletersBelowSettlementVoters() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 5, maxVoters: 5
        });
        uint256[] memory contentIds = new uint256[](2);
        contentIds[0] = _submitQuestionWithContextAndRoundConfig("https://example.com/t1-bundle-a", "t1-a", roundConfig);
        contentIds[1] = _submitQuestionWithContextAndRoundConfig("https://example.com/t1-bundle-b", "t1-b", roundConfig);
        assertEq(registry.getContentRoundConfig(contentIds[0]).minVoters, 5);
        assertEq(registry.getContentRoundConfig(contentIds[1]).minVoters, 5);

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), 20e6);
        vm.stopPrank();

        vm.expectRevert("Voters mismatch");
        vm.prank(address(registry));
        rewardPoolEscrow.createSubmissionBundleFromRegistry(
            1, contentIds, funder, REWARD_ASSET_USDC, 20e6, 3, 1, block.timestamp + 1 hours, 1 hours, 1 hours, 0
        );
    }

    function testCreateSubmissionBundleRejectsVeryHighValueBelowEconomicFloor() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 8, maxVoters: 8
        });
        uint256[] memory contentIds = new uint256[](2);
        contentIds[0] = _submitQuestionWithContextAndRoundConfig("https://example.com/vh-bundle-a", "vh-a", roundConfig);
        contentIds[1] = _submitQuestionWithContextAndRoundConfig("https://example.com/vh-bundle-b", "vh-b", roundConfig);

        usdc.mint(funder, 2 * VERY_HIGH_VALUE_REWARD_POOL_THRESHOLD);

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), VERY_HIGH_VALUE_REWARD_POOL_THRESHOLD);
        vm.stopPrank();

        vm.expectRevert("High-value floor");
        vm.prank(address(registry));
        rewardPoolEscrow.createSubmissionBundleFromRegistry(
            1,
            contentIds,
            funder,
            REWARD_ASSET_USDC,
            VERY_HIGH_VALUE_REWARD_POOL_THRESHOLD,
            MIN_HIGH_VALUE_PARTICIPANTS,
            1,
            block.timestamp + 1 hours,
            1 hours,
            1 hours,
            0
        );

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), VERY_HIGH_VALUE_REWARD_POOL_THRESHOLD);
        vm.stopPrank();

        vm.prank(address(registry));
        uint256 bundleId = rewardPoolEscrow.createSubmissionBundleFromRegistry(
            2,
            contentIds,
            funder,
            REWARD_ASSET_USDC,
            VERY_HIGH_VALUE_REWARD_POOL_THRESHOLD,
            MIN_VERY_HIGH_VALUE_PARTICIPANTS,
            1,
            block.timestamp + 1 hours,
            1 hours,
            1 hours,
            0
        );
        assertEq(bundleId, 2);
    }

    function testT1BundleThresholdReachedAfterBountyCloseStillQualifiesMatchedCompleters() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 5, maxVoters: 5
        });
        uint256[] memory contentIds = new uint256[](2);
        contentIds[0] = _submitQuestionWithContextAndRoundConfig("https://example.com/t1-bundle-a", "t1-a", roundConfig);
        contentIds[1] = _submitQuestionWithContextAndRoundConfig("https://example.com/t1-bundle-b", "t1-b", roundConfig);

        address voter5 = address(0x55);
        _registerTestVoter(voter5);

        uint256 bountyClosesAt = block.timestamp + 1 hours;
        uint256 bundleId = _createSubmissionBundleWithClose(
            contentIds,
            funder,
            REWARD_ASSET_USDC,
            20e6,
            /*requiredCompleters=*/
            5,
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

        _settleAfterRbtsSeed(votingEngine, contentIds[0], firstRoundId);
        _settleAfterRbtsSeed(votingEngine, contentIds[1], secondRoundId);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[0], firstRoundId);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[1], secondRoundId);

        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), 0);
    }

    function testRefundableRewardPoolAmountUsesQuestionSelectedVoterCap() public {
        RoundLib.RoundConfig memory roundConfig =
            RoundLib.RoundConfig({ epochDuration: 10 minutes, maxDuration: 1 hours, minVoters: 3, maxVoters: 4 });
        uint256 contentId = _submitQuestionWithRoundConfig("small-cap", roundConfig);

        uint256 fundedAmount = 4 * 10_000;
        uint256 rewardPoolId = _createRewardPool(contentId, fundedAmount, 3, 1);

        assertEq(rewardPoolId, 2);
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), fundedAmount);
    }

    function testRewardPoolRejectsRequiredVotersAboveSettlementVoters() public {
        RoundLib.RoundConfig memory roundConfig =
            RoundLib.RoundConfig({ epochDuration: 10 minutes, maxDuration: 1 hours, minVoters: 3, maxVoters: 4 });
        uint256 contentId = _submitQuestionWithRoundConfig("impossible-cap", roundConfig);

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), REWARD_POOL_AMOUNT);
        vm.expectRevert("Voters mismatch");
        rewardPoolEscrow.createRewardPool(contentId, REWARD_POOL_AMOUNT, 5, 1, block.timestamp + 30 days, 30 days, 0);
        vm.stopPrank();
    }

    function testRewardPoolRejectsQuestionVoterCapAboveQualificationLimit() public {
        uint256 contentId = _submitQuestion("");
        vm.mockCall(
            address(registry),
            abi.encodeWithSelector(ContentRegistry.getContentRoundConfig.selector, contentId),
            abi.encode(
                RoundLib.RoundConfig({ epochDuration: 10 minutes, maxDuration: 1 hours, minVoters: 3, maxVoters: 201 })
            )
        );

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), REWARD_POOL_AMOUNT);
        vm.expectRevert("Voters exceed max");
        rewardPoolEscrow.createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1, block.timestamp + 30 days, 30 days, 0);
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

        string[] memory imageUrls = new string[](1);
        imageUrls[0] = _submissionImageUrl(DEFAULT_MEDIA_URL);
        bytes32 salt = keccak256("stale-engine-reward");
        uint256 rewardAmount = _defaultSubmissionRewardAmount(registry);
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = _defaultSubmissionRewardTerms(registry);
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 3, maxVoters: 200
        });
        bytes32 submissionKey = _questionSubmissionKey(
            "https://example.com/context", imageUrls, "", QUESTION, TAGS, CATEGORY_ID, _emptySubmissionDetails()
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

        uint256 submitterBalanceBefore = lrepToken.balanceOf(submitter);
        uint256 escrowBalanceBefore = lrepToken.balanceOf(address(rewardPoolEscrow));
        uint256 nextContentIdBefore = registry.nextContentId();

        vm.startPrank(submitter);
        lrepToken.approve(address(rewardPoolEscrow), rewardAmount);
        registry.reserveSubmission(revealCommitment);
        vm.warp(block.timestamp + 1);
        vm.expectRevert("Stale engine");
        registry.submitQuestionWithRewardAndRoundConfig(
            "https://example.com/context",
            imageUrls,
            "",
            QUESTION,
            TAGS,
            CATEGORY_ID,
            _emptySubmissionDetails(),
            salt,
            rewardTerms,
            roundConfig,
            _defaultQuestionSpec()
        );
        vm.stopPrank();

        assertEq(registry.nextContentId(), nextContentIdBefore);
        assertEq(lrepToken.balanceOf(submitter), submitterBalanceBefore);
        assertEq(lrepToken.balanceOf(address(rewardPoolEscrow)), escrowBalanceBefore);
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

        vm.prank(address(votingEngine));
        rewardPoolEscrow.recordBundleQuestionTerminal(contentIds[0], firstRoundId, true);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[1], secondRoundId);

        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), 0);
    }

    function testUsdcSubmissionBundleRejectsActiveClusterOracle() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        assertEq(address(protocolConfig.clusterPayoutOracle()), address(oracle));
        assertEq(address(votingEngine.protocolConfig().clusterPayoutOracle()), address(oracle));
        uint256[] memory contentIds = _submitBundleQuestions();

        vm.prank(funder);
        usdc.approve(address(rewardPoolEscrow), REWARD_POOL_AMOUNT);
        vm.expectRevert("Cluster bundle unsupported");
        vm.prank(address(registry));
        rewardPoolEscrow.createSubmissionBundleFromRegistry(
            1,
            contentIds,
            funder,
            REWARD_ASSET_USDC,
            REWARD_POOL_AMOUNT,
            3,
            1,
            block.timestamp + 30 days,
            30 days,
            30 days,
            0
        );
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
                lrepToken: lrepToken,
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
                lrepToken: lrepToken,
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
                lrepToken: lrepToken,
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
        _settleAfterRbtsSeed(votingEngine, contentId, roundId);

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

    function testQuestionRewardClaimChecksCurrentRaterRegistryBanAfterMigration() public {
        uint256 contentId = _submitQuestion("current-ban-after-qualification");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);
        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);

        MockRaterIdentityRegistry migratedRaterIdentityRegistry = _migrateRaterIdentitiesWithDifferentIds();
        migratedRaterIdentityRegistry.setBanned(_identityKey(voter1), true);

        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);
        vm.prank(voter1);
        vm.expectRevert("Identity banned");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);
    }

    function testRewardPoolQualificationChecksCurrentRaterRegistryBanAfterMigration() public {
        uint256 contentId = _submitQuestion("current-ban-before-qualification");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);
        uint256 roundId = _settleRoundWith(_fourVoters(), contentId, _directions(true, true, false, true));

        MockRaterIdentityRegistry migratedRaterIdentityRegistry = _migrateRaterIdentitiesWithDifferentIds();
        migratedRaterIdentityRegistry.setBanned(_identityKey(voter1), true);

        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);

        RoundSnapshot memory snapshot = rewardPoolEscrow.getRoundSnapshot(rewardPoolId, roundId);
        assertTrue(snapshot.qualified);
        assertEq(snapshot.rawEligibleVoters, 3);
        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);
        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter4), 0);
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

    function testBundleClaimChecksCurrentRaterRegistryBanAfterMigration() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);

        _settleRoundWith(voters, contentIds[0], directions);
        _settleRoundWith(voters, contentIds[1], directions);

        MockRaterIdentityRegistry migratedRaterIdentityRegistry = _migrateRaterIdentitiesWithDifferentIds();
        migratedRaterIdentityRegistry.setBanned(_identityKey(voter1), true);

        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), 0);
        vm.prank(voter1);
        vm.expectRevert("Identity banned");
        rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0);
    }

    function testBundleClaimQualifiesRecordedRoundSetBeforeClaim() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);

        uint256 firstRoundId = _settleRoundWithoutBundleSync(voters, contentIds[0], directions);
        uint256 secondRoundId = _settleRoundWithoutBundleSync(voters, contentIds[1], directions);

        vm.startPrank(address(votingEngine));
        rewardPoolEscrow.recordBundleQuestionTerminal(contentIds[0], firstRoundId, true);
        rewardPoolEscrow.recordBundleQuestionTerminal(contentIds[1], secondRoundId, true);
        vm.stopPrank();

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

    function testVerifiedHumanBundleRejectsCompleterVerifiedAfterRoundSetQualification() public {
        raterIdentityRegistry.revokeHumanCredential(voter4);

        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundleWithEligibility(
            contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3, BOUNTY_ELIGIBILITY_VERIFIED_HUMAN
        );

        address[] memory voters = _fourVoters();
        bool[] memory directions = _directions(true, true, false, true);
        _settleRoundWith(voters, contentIds[0], directions);
        _settleRoundWith(voters, contentIds[1], directions);

        raterIdentityRegistry.setHolder(voter4);

        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter4), 0);
        vm.prank(voter4);
        vm.expectRevert("Not bounty eligible");
        rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0);
    }

    function testVerifiedHumanBundleRejectsCompleterVerifiedBeforeDeferredRoundSetQualification() public {
        raterIdentityRegistry.revokeHumanCredential(voter4);

        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundleWithEligibility(
            contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3, BOUNTY_ELIGIBILITY_VERIFIED_HUMAN
        );

        address[] memory voters = _fourVoters();
        bool[] memory directions = _directions(true, true, false, true);
        uint256 firstRoundId = _settleRoundWithoutBundleSync(voters, contentIds[0], directions);
        uint256 secondRoundId = _settleRoundWithoutBundleSync(voters, contentIds[1], directions);

        raterIdentityRegistry.setHolder(voter4);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[0], firstRoundId);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[1], secondRoundId);

        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter4), 0);
        vm.prank(voter4);
        vm.expectRevert("Not bounty eligible");
        rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0);
    }

    function testVerifiedHumanBundleAllowsQualifiedCompleterAfterCredentialRevoked() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundleWithEligibility(
            contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3, BOUNTY_ELIGIBILITY_VERIFIED_HUMAN
        );

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);
        _settleRoundWith(voters, contentIds[0], directions);
        _settleRoundWith(voters, contentIds[1], directions);

        raterIdentityRegistry.revokeHumanCredential(voter1);

        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), 0);
        vm.prank(voter1);
        assertGt(rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0), 0);
    }

    function testVerifiedHumanBundleAllowsQualifiedCompleterRevokedBeforeDeferredRoundSetQualification() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundleWithEligibility(
            contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3, BOUNTY_ELIGIBILITY_VERIFIED_HUMAN
        );

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);
        uint256 firstRoundId = _settleRoundWithoutBundleSync(voters, contentIds[0], directions);
        uint256 secondRoundId = _settleRoundWithoutBundleSync(voters, contentIds[1], directions);

        raterIdentityRegistry.revokeHumanCredential(voter1);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[0], firstRoundId);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[1], secondRoundId);

        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), 0);
        vm.prank(voter1);
        assertGt(rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0), 0);
    }

    function testRecentRecheckBundleUsesFreshnessSnapshotAtCommit() public {
        uint8 humanBit = BOUNTY_ELIGIBILITY_VERIFIED_HUMAN;
        uint8 recentHumanEligibility = BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG | BOUNTY_ELIGIBILITY_VERIFIED_HUMAN;
        raterIdentityRegistry.setCredentialStatusMasks(voter1, humanBit, humanBit);
        raterIdentityRegistry.setCredentialStatusMasks(voter2, humanBit, humanBit);
        raterIdentityRegistry.setCredentialStatusMasks(voter3, humanBit, humanBit);

        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundleWithEligibility(
            contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3, recentHumanEligibility
        );

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);
        uint256 firstRoundId = _settleRoundWithoutBundleSync(voters, contentIds[0], directions);
        uint256 secondRoundId = _settleRoundWithoutBundleSync(voters, contentIds[1], directions);

        raterIdentityRegistry.setCredentialStatusMasks(voter1, humanBit, 0);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[0], firstRoundId);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[1], secondRoundId);

        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), 0);
        vm.prank(voter1);
        assertGt(rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0), 0);
    }

    function testRecentRecheckBundleRequiresEveryQuestionCommitFreshAtCommit() public {
        uint8 humanBit = BOUNTY_ELIGIBILITY_VERIFIED_HUMAN;
        uint8 recentHumanEligibility = BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG | BOUNTY_ELIGIBILITY_VERIFIED_HUMAN;
        raterIdentityRegistry.setCredentialStatusMasks(voter1, humanBit, humanBit);
        raterIdentityRegistry.setCredentialStatusMasks(voter2, humanBit, humanBit);
        raterIdentityRegistry.setCredentialStatusMasks(voter3, humanBit, humanBit);

        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundleWithEligibility(
            contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3, recentHumanEligibility
        );

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);
        uint256 firstRoundId = _settleRoundWithoutBundleSync(voters, contentIds[0], directions);
        raterIdentityRegistry.setCredentialStatusMasks(voter1, humanBit, 0);
        uint256 secondRoundId = _settleRoundWithoutBundleSync(voters, contentIds[1], directions);

        raterIdentityRegistry.setCredentialStatusMasks(voter1, humanBit, humanBit);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[0], firstRoundId);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[1], secondRoundId);

        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), 0);
        vm.prank(voter1);
        vm.expectRevert("Bundle not claimable");
        rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0);
    }

    function testBundleRewardSupportsOpenWalletCompletersWithoutRaterIdentity() public {
        address openVoter1 = address(211);
        address openVoter2 = address(212);
        address openVoter3 = address(213);
        vm.startPrank(owner);
        lrepToken.mint(openVoter1, 10_000e6);
        lrepToken.mint(openVoter2, 10_000e6);
        lrepToken.mint(openVoter3, 10_000e6);
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

    function testBundleFrontendFeeRequiresEveryQuestionRoundRecipient() public {
        _registerFrontend(frontend1);
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);
        _settleRoundWithFrontend(voters, contentIds[0], directions, frontend1);

        MockBundleFrontendRegistry secondRoundFrontendRegistry = new MockBundleFrontendRegistry();
        secondRoundFrontendRegistry.setFrontend(frontend1, address(0xFEE), true, false);
        vm.prank(owner);
        protocolConfig.setFrontendRegistry(address(secondRoundFrontendRegistry));

        _settleRoundWithFrontend(voters, contentIds[1], directions, frontend1);

        uint256 frontendBalanceBefore = usdc.balanceOf(frontend1);
        uint256 quotedReward = rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1);
        assertGt(quotedReward, 0);

        vm.prank(voter1);
        uint256 reward = rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0);

        assertEq(reward, quotedReward);
        assertEq(usdc.balanceOf(frontend1), frontendBalanceBefore);
    }

    function testBundleFourVoterThresholdQualifiesWhenCompletersRevealBeforeClose() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 4, maxVoters: 4
        });
        uint256[] memory contentIds = new uint256[](2);
        contentIds[0] = _submitQuestionWithContextAndRoundConfig(
            "https://example.com/bundle-above-before-a", "bundle-above-before-a", roundConfig
        );
        contentIds[1] = _submitQuestionWithContextAndRoundConfig(
            "https://example.com/bundle-above-before-b", "bundle-above-before-b", roundConfig
        );
        uint256 closesAt = block.timestamp + 2 * EPOCH_DURATION + 20;
        uint256 bundleId =
            _createSubmissionBundleWithClose(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 4, closesAt);

        uint256 firstRoundId = _revealRoundWith(_fourVoters(), contentIds[0], _directions(true, true, false, true));
        uint256 secondRoundId = _revealRoundWith(_fourVoters(), contentIds[1], _directions(true, true, false, true));
        _assertThresholdReachedAtLe(contentIds[0], firstRoundId, closesAt);
        _assertThresholdReachedAtLe(contentIds[1], secondRoundId, closesAt);

        vm.warp(closesAt + 1);
        _settleAfterRbtsSeed(votingEngine, contentIds[0], firstRoundId);
        _settleAfterRbtsSeed(votingEngine, contentIds[1], secondRoundId);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[0], firstRoundId);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[1], secondRoundId);

        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), REWARD_POOL_AMOUNT / 4);
    }

    function testBundleFourVoterThresholdQualifiesWhenCompleterCommittedBeforeCloseButRevealsAfterClose() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 4, maxVoters: 4
        });
        uint256[] memory contentIds = new uint256[](2);
        contentIds[0] = _submitQuestionWithContextAndRoundConfig(
            "https://example.com/bundle-above-after-a", "bundle-above-after-a", roundConfig
        );
        contentIds[1] = _submitQuestionWithContextAndRoundConfig(
            "https://example.com/bundle-above-after-b", "bundle-above-after-b", roundConfig
        );
        uint256 closesAt = block.timestamp + 2 * EPOCH_DURATION + 20;
        uint256 bundleId =
            _createSubmissionBundleWithClose(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 4, closesAt);

        (uint256 firstRoundId, bytes32 firstLateCommitKey, bytes32 firstLateSalt, bool firstLateDirection) =
            _revealThresholdAndReturnUnrevealed(contentIds[0]);
        (uint256 secondRoundId, bytes32 secondLateCommitKey, bytes32 secondLateSalt, bool secondLateDirection) =
            _revealThresholdAndReturnUnrevealed(contentIds[1]);
        _assertThresholdNotReached(contentIds[0], firstRoundId);
        _assertThresholdNotReached(contentIds[1], secondRoundId);

        vm.warp(closesAt + 1);
        votingEngine.revealVoteByCommitKey(
            contentIds[0], firstRoundId, firstLateCommitKey, firstLateDirection, 5_000, firstLateSalt
        );
        votingEngine.revealVoteByCommitKey(
            contentIds[1], secondRoundId, secondLateCommitKey, secondLateDirection, 5_000, secondLateSalt
        );
        _assertThresholdReachedAtGt(contentIds[0], firstRoundId, closesAt);
        _assertThresholdReachedAtGt(contentIds[1], secondRoundId, closesAt);
        _settleAfterRbtsSeed(votingEngine, contentIds[0], firstRoundId);
        _settleAfterRbtsSeed(votingEngine, contentIds[1], secondRoundId);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[0], firstRoundId);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[1], secondRoundId);

        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), REWARD_POOL_AMOUNT / 4);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter4), REWARD_POOL_AMOUNT / 4);
    }

    function testBundleIncludesExtraCompleterCommittedBeforeCloseWhenRevealedAfterClose() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 3, maxVoters: 4
        });
        uint256[] memory contentIds = new uint256[](2);
        contentIds[0] = _submitQuestionWithContextAndRoundConfig(
            "https://example.com/bundle-late-extra-a", "bundle-late-extra-a", roundConfig
        );
        contentIds[1] = _submitQuestionWithContextAndRoundConfig(
            "https://example.com/bundle-late-extra-b", "bundle-late-extra-b", roundConfig
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
        _settleAfterRbtsSeed(votingEngine, contentIds[0], firstRoundId);
        _settleAfterRbtsSeed(votingEngine, contentIds[1], secondRoundId);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[0], firstRoundId);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[1], secondRoundId);

        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), REWARD_POOL_AMOUNT / 4);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter4), REWARD_POOL_AMOUNT / 4);

        vm.prank(voter4);
        assertEq(rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0), REWARD_POOL_AMOUNT / 4);

        vm.prank(voter1);
        assertEq(rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0), REWARD_POOL_AMOUNT / 4);
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
        lrepToken.mint(remintedFunder, 10_000e6);

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
        lrepToken.mint(voter5, 10_000e6);
        vm.prank(owner);
        lrepToken.mint(delegate1, 10_000e6);

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

        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, delegate1), 0);
        uint256 holderBalanceBefore = usdc.balanceOf(voter3);
        uint256 delegateBalanceBefore = usdc.balanceOf(delegate1);
        vm.prank(delegate1);
        uint256 reward = rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0);
        assertEq(usdc.balanceOf(voter3), holderBalanceBefore + reward);
        assertEq(usdc.balanceOf(delegate1), delegateBalanceBefore);
    }

    function testBundleDelegatedFunderStaysExcludedAfterDelegateRotationAndRaterIdentityMigration() public {
        address newDelegate = address(0xD1E);
        address voter5 = address(0x55);
        raterIdentityRegistry.setHolder(voter5);
        vm.prank(owner);
        lrepToken.mint(voter5, 10_000e6);
        vm.prank(owner);
        lrepToken.mint(newDelegate, 10_000e6);

        uint256[] memory contentIds = _submitBundleQuestions();
        vm.prank(voter1);
        raterIdentityRegistry.setDelegate(delegate1);
        uint256 bundleId = _createSubmissionBundle(contentIds, delegate1, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);
        vm.prank(voter1);
        raterIdentityRegistry.removeDelegate();

        MockRaterIdentityRegistry migratedRaterIdentityRegistry = _migrateRaterIdentitiesWithDifferentIds();
        vm.prank(voter1);
        migratedRaterIdentityRegistry.setDelegate(newDelegate);

        address[] memory voters = new address[](4);
        voters[0] = newDelegate;
        voters[1] = voter2;
        voters[2] = voter4;
        voters[3] = voter5;
        bool[] memory directions = _directions(true, true, false, true);

        _settleRoundWith(voters, contentIds[0], directions);
        _settleRoundWith(voters, contentIds[1], directions);

        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, newDelegate), 0);
        vm.prank(newDelegate);
        vm.expectRevert("Excluded voter");
        rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0);

        vm.prank(voter2);
        assertGt(rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0), 0);
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
        lrepToken.mint(remintedSubmitter, 10_000e6);

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
            lrepToken.mint(secondSetVoters[i], 10_000e6);
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

    function testBatchBundleSyncReplaysFutureRoundsAfterFailedSetReset() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, 120e6, 3, 2);

        address retryCompleter1 = address(30);
        address retryCompleter2 = address(31);
        address retryCompleter3 = address(32);
        _registerTestVoter(retryCompleter1);
        _registerTestVoter(retryCompleter2);
        _registerTestVoter(retryCompleter3);

        address[] memory firstQuestionVoters = _voters(voter1, voter2, voter3);
        address[] memory secondQuestionVoters = _voters(voter2, voter3, voter4);
        address[] memory retryCompleters = _voters(retryCompleter1, retryCompleter2, retryCompleter3);
        bool[] memory directions = _directions(true, true, false);

        _settleRoundWithoutBundleSync(firstQuestionVoters, contentIds[0], directions);
        vm.warp(block.timestamp + 2 days);
        _settleRoundWithoutBundleSync(retryCompleters, contentIds[0], directions);
        _settleRoundWithoutBundleSync(secondQuestionVoters, contentIds[1], directions);
        vm.warp(block.timestamp + 2 days);
        _settleRoundWithoutBundleSync(retryCompleters, contentIds[1], directions);

        (uint256 processedRounds, bool complete) = rewardPoolEscrow.syncQuestionBundleTerminals(bundleId, 10);
        assertEq(processedRounds, 4);
        assertTrue(complete);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, retryCompleter1), 0);

        (processedRounds, complete) = rewardPoolEscrow.syncQuestionBundleTerminals(bundleId, 10);
        assertEq(processedRounds, 2);
        assertTrue(complete);
        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, retryCompleter1), 0);
    }

    function testSubmissionBundleRequiresFundingForMaxCompleters() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 3, maxVoters: 4
        });
        uint256[] memory contentIds = new uint256[](2);
        contentIds[0] = _submitQuestionWithContextAndRoundConfig(
            "https://example.com/bundle-underfunded-a", "bundle-underfunded-a", roundConfig
        );
        contentIds[1] = _submitQuestionWithContextAndRoundConfig(
            "https://example.com/bundle-underfunded-b", "bundle-underfunded-b", roundConfig
        );

        uint256 amount = 4 * 10_000 - 1;
        vm.prank(funder);
        usdc.approve(address(rewardPoolEscrow), amount);

        uint256 bountyClosesAt = block.timestamp + 30 days;
        vm.expectRevert("Amount too small");
        vm.prank(address(registry));
        rewardPoolEscrow.createSubmissionBundleFromRegistry(
            1, contentIds, funder, REWARD_ASSET_USDC, amount, 3, 1, bountyClosesAt, 30 days, 30 days, 0
        );
    }

    function testSubmissionBundleFundedAtMaxCompletersQualifies() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 3, maxVoters: 4
        });
        uint256[] memory contentIds = new uint256[](2);
        contentIds[0] = _submitQuestionWithContextAndRoundConfig(
            "https://example.com/bundle-funded-a", "bundle-funded-a", roundConfig
        );
        contentIds[1] = _submitQuestionWithContextAndRoundConfig(
            "https://example.com/bundle-funded-b", "bundle-funded-b", roundConfig
        );
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, 4 * 10_000, 3);

        address[] memory overfullVoters = _fourVoters();
        bool[] memory overfullDirections = _directions(true, true, false, true);
        _settleRoundWith(overfullVoters, contentIds[0], overfullDirections);
        _settleRoundWith(overfullVoters, contentIds[1], overfullDirections);

        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), 10_000);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter4), 10_000);
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
            lrepToken.mint(extraVoters[i], 10_000e6);
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
            lrepToken.mint(extraVoters[i], 10_000e6);
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
        lrepToken.mint(delegate1, 10_000e6);

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

    function testBundleRewardRejectsDelegateStitchingDifferentHolders() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);
        vm.prank(owner);
        lrepToken.mint(delegate1, 10_000e6);

        vm.prank(voter2);
        raterIdentityRegistry.setDelegate(delegate1);
        _settleRoundWith(_voters(delegate1, voter1, voter4), contentIds[0], _directions(true, true, false));

        vm.prank(voter2);
        raterIdentityRegistry.removeDelegate();
        vm.prank(voter3);
        raterIdentityRegistry.setDelegate(delegate1);

        address[] memory secondQuestionVoters = new address[](4);
        secondQuestionVoters[0] = delegate1;
        secondQuestionVoters[1] = voter1;
        secondQuestionVoters[2] = voter2;
        secondQuestionVoters[3] = voter4;
        _settleRoundWith(secondQuestionVoters, contentIds[1], _directions(true, true, true, false));

        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, delegate1), 0);
        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), 0);
        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter2), 0);
        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter4), 0);

        vm.prank(delegate1);
        vm.expectRevert("Bundle incomplete");
        rewardPoolEscrow.claimQuestionBundleReward(bundleId, 0);
    }

    function testBundleRewardPaysRaterIdentityHolderWhenNewDelegateClaims() public {
        address newDelegate = address(0xD1E);
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);
        vm.prank(owner);
        lrepToken.mint(delegate1, 10_000e6);

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
        lrepToken.mint(remintedSubmitter, 10_000e6);

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
        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, delegate1), 0);

        vm.prank(voter1);
        vm.expectRevert("Excluded voter");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);

        uint256 holderBalanceBefore = usdc.balanceOf(voter3);
        uint256 delegateBalanceBefore = usdc.balanceOf(delegate1);
        vm.prank(delegate1);
        uint256 delegatedReward = rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);
        assertEq(usdc.balanceOf(voter3), holderBalanceBefore + delegatedReward);
        assertEq(usdc.balanceOf(delegate1), delegateBalanceBefore);

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

    function testDelegatedFunderStaysExcludedAfterDelegateRotationAndRaterIdentityMigration() public {
        address newDelegate = address(0xD1E);
        uint256 contentId = _submitQuestion("");

        vm.prank(owner);
        lrepToken.mint(newDelegate, 10_000e6);

        vm.prank(voter2);
        raterIdentityRegistry.setDelegate(delegate1);
        uint256 rewardPoolId = _createRewardPoolAs(delegate1, contentId, REWARD_POOL_AMOUNT, 3, 1);
        vm.prank(voter2);
        raterIdentityRegistry.removeDelegate();

        MockRaterIdentityRegistry migratedRaterIdentityRegistry = _migrateRaterIdentitiesWithDifferentIds();
        vm.prank(voter2);
        migratedRaterIdentityRegistry.setDelegate(newDelegate);

        address[] memory voters = new address[](4);
        voters[0] = newDelegate;
        voters[1] = voter1;
        voters[2] = voter3;
        voters[3] = voter4;
        uint256 roundId = _settleRoundWith(voters, contentId, _directions(true, true, true, false));

        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, newDelegate), 0);
        vm.prank(newDelegate);
        vm.expectRevert("Excluded voter");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId);

        _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);
    }

    function testQuestionRewardPaysRaterIdentityHolderWhenNewDelegateClaims() public {
        address newDelegate = address(0xD1E);
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        vm.prank(owner);
        lrepToken.mint(delegate1, 10_000e6);
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

    /// @dev H-1 regression: an empty (zero-commit) leading round that finishes must not let
    ///      refundExpiredRewardPool bypass the cursor guard and drain funds owed to a later qualifiable round.
    function testRefundBlockedWhenEmptyLeadingRoundPrecedesQualifiableRound() public {
        uint256 contentId = _submitQuestion("");
        uint256 expiresAt = block.timestamp + 30 days;
        uint256 rewardPoolId = _createRewardPoolWithExpiry(contentId, REWARD_POOL_AMOUNT, 3, 1, expiresAt);

        // Leading round opens empty and is cancelled -> a finished, zero-commit round sits at the cursor,
        // so the bounty window never activates (bountyClosesAt stays 0).
        vm.prank(voter1);
        votingEngine.openRound(contentId);
        uint256 emptyRoundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        vm.warp(block.timestamp + 7 days + 1);
        votingEngine.cancelExpiredRound(contentId, emptyRoundId);

        // A later round is staked, voted, and settles within the (still-unactivated) window.
        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));

        // Past bountyStartBy the pool reports expired, but the finished empty cursor round must be advanced
        // first -- the refund must NOT skip the guard and drain the later round's voters' funds.
        vm.warp(expiresAt + 1);
        vm.expectRevert(QuestionRewardPoolEscrow.RewardPoolCursorNeedsAdvance.selector);
        rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId);

        // Advancing past the empty round, the later round still qualifies and pays out.
        (uint256 skipped, uint256 nextRoundToEvaluate) = rewardPoolEscrow.advanceQualificationCursor(rewardPoolId, 1);
        assertEq(skipped, 1);
        assertEq(nextRoundToEvaluate, roundId);
        _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);
    }

    function testOpenRoundDoesNotStartBountyWindowBeforeFirstStake() public {
        uint256 contentId = _submitQuestion("");
        uint256 openedAt = block.timestamp;
        uint256 bountyStartBy = openedAt + 1 days;
        uint256 bountyWindowSeconds = 1 hours;

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), REWARD_POOL_AMOUNT);
        uint256 rewardPoolId = rewardPoolEscrow.createRewardPool(
            contentId, REWARD_POOL_AMOUNT, 3, 1, bountyStartBy, bountyWindowSeconds, 0
        );
        vm.stopPrank();

        vm.prank(voter1);
        votingEngine.openRound(contentId);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        assertEq(RoundEngineReadHelpers.round(votingEngine, contentId, roundId).startTime, openedAt);
        assertEq(RoundEngineReadHelpers.round(votingEngine, contentId, roundId).voteCount, 0);

        vm.warp(openedAt + bountyWindowSeconds + 1);
        _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));

        bytes32 firstCommitKey = votingEngine.getRoundCommitKey(contentId, roundId, 0);
        uint48 firstStakedAt = _commitCommittedAt(votingEngine, contentId, roundId, firstCommitKey);
        assertGt(firstStakedAt, openedAt + bountyWindowSeconds);
        assertLe(firstStakedAt, bountyStartBy);
        _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);
    }

    function testMissedStartByOpenRoundLateFirstStakeRefundsWithoutTerminalRound() public {
        uint256 contentId = _submitQuestion("");
        uint256 openedAt = block.timestamp;
        uint256 bountyStartBy = openedAt + 1 days;
        uint256 bountyWindowSeconds = 1 hours;

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), REWARD_POOL_AMOUNT);
        uint256 rewardPoolId = rewardPoolEscrow.createRewardPool(
            contentId, REWARD_POOL_AMOUNT, 3, 1, bountyStartBy, bountyWindowSeconds, 0
        );
        vm.stopPrank();

        vm.prank(voter1);
        votingEngine.openRound(contentId);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        assertEq(RoundEngineReadHelpers.round(votingEngine, contentId, roundId).voteCount, 0);

        vm.warp(bountyStartBy + 1);
        _commitPrediction(voter1, contentId, 6_000, 1e6, keccak256("late first stake"));
        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Open));
        assertEq(round.voteCount, 1);

        uint256 funderBalanceBefore = usdc.balanceOf(funder);
        vm.prank(address(0xCAFE));
        uint256 refundAmount = rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId);

        assertEq(refundAmount, REWARD_POOL_AMOUNT);
        assertEq(usdc.balanceOf(funder), funderBalanceBefore + REWARD_POOL_AMOUNT);
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

        _settleAfterRbtsSeed(votingEngine, contentId, roundId);
        _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);
    }

    function testOpenRoundWithTimelyMatchedVotersBelowThresholdBlocksRefundAndCanQualify() public {
        address voter5 = address(0x55);
        _registerTestVoter(voter5);
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 5, maxVoters: 5
        });
        uint256 contentId = _submitQuestionWithRoundConfig("below-quorum-before-close", roundConfig);
        uint256 expiresAt = block.timestamp + EPOCH_DURATION + 10;
        uint256 rewardPoolId = _createRewardPoolWithExpiry(contentId, REWARD_POOL_AMOUNT, 5, 1, expiresAt);

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
        _settleAfterRbtsSeed(votingEngine, contentId, roundId);

        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);
        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter4), 0);

        _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);
    }

    function testRewardPoolFourVoterThresholdQualifiesWhenVotersRevealBeforeClose() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 4, maxVoters: 4
        });
        uint256 contentId = _submitQuestionWithRoundConfig("above-quorum-before-close", roundConfig);
        uint256 expiresAt = block.timestamp + EPOCH_DURATION + 10;
        uint256 rewardPoolId = _createRewardPoolWithExpiry(contentId, REWARD_POOL_AMOUNT, 4, 1, expiresAt);

        uint256 roundId = _revealRoundWith(_fourVoters(), contentId, _directions(true, true, false, true));
        _assertThresholdReachedAtLe(contentId, roundId, expiresAt);

        vm.warp(expiresAt + 1);
        _settleAfterRbtsSeed(votingEngine, contentId, roundId);

        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);
        RoundSnapshot memory snapshot = rewardPoolEscrow.getRoundSnapshot(rewardPoolId, roundId);
        assertEq(snapshot.rawEligibleVoters, 4);
        assertEq(snapshot.eligibleVoters, 4 * 10_000);
        assertEq(snapshot.totalClaimWeight, 4 * 10_000);
        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);
    }

    function testRewardPoolFourVoterThresholdQualifiesWhenVoterCommittedBeforeCloseButRevealsAfterClose() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 4, maxVoters: 4
        });
        uint256 contentId = _submitQuestionWithRoundConfig("above-quorum-after-close", roundConfig);
        uint256 expiresAt = block.timestamp + EPOCH_DURATION + 10;
        uint256 rewardPoolId = _createRewardPoolWithExpiry(contentId, REWARD_POOL_AMOUNT, 4, 1, expiresAt);

        (
            uint256 roundId,
            bytes32[2] memory lateCommitKeys,
            bytes32[2] memory lateSalts,
            bool[2] memory lateDirections
        ) = _revealBelowThresholdAndReturnUnrevealedPair(contentId);
        assertEq(RoundEngineReadHelpers.round(votingEngine, contentId, roundId).thresholdReachedAt, 0);

        vm.warp(expiresAt + 1);
        for (uint256 i = 0; i < lateCommitKeys.length; i++) {
            votingEngine.revealVoteByCommitKey(
                contentId, roundId, lateCommitKeys[i], lateDirections[i], 5_000, lateSalts[i]
            );
        }
        assertGt(RoundEngineReadHelpers.round(votingEngine, contentId, roundId).thresholdReachedAt, expiresAt);
        _settleAfterRbtsSeed(votingEngine, contentId, roundId);

        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);
        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter4), 0);
    }

    function testRewardPoolIncludesExtraVoterCommittedBeforeCloseWhenRevealedAfterClose() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 3, maxVoters: 4
        });
        uint256 contentId = _submitQuestionWithRoundConfig("min-quorum-late-extra", roundConfig);
        uint256 expiresAt = block.timestamp + EPOCH_DURATION + 10;
        uint256 rewardPoolId = _createRewardPoolWithExpiry(contentId, REWARD_POOL_AMOUNT, 3, 1, expiresAt);

        (
            uint256 roundId,
            bytes32[2] memory lateCommitKeys,
            bytes32[2] memory lateSalts,
            bool[2] memory lateDirections
        ) = _revealBelowThresholdAndReturnUnrevealedPair(contentId);
        assertEq(RoundEngineReadHelpers.round(votingEngine, contentId, roundId).thresholdReachedAt, 0);

        vm.warp(expiresAt + 1);
        for (uint256 i = 0; i < lateCommitKeys.length; i++) {
            votingEngine.revealVoteByCommitKey(
                contentId, roundId, lateCommitKeys[i], lateDirections[i], 5_000, lateSalts[i]
            );
        }
        assertGt(RoundEngineReadHelpers.round(votingEngine, contentId, roundId).thresholdReachedAt, expiresAt);
        _settleAfterRbtsSeed(votingEngine, contentId, roundId);

        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);
        assertEq(_commitRbtsRewardWeight(votingEngine, contentId, roundId, lateCommitKeys[1]), 0);
        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter4), 0);

        vm.prank(voter4);
        assertGt(rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId), 0);

        _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);
    }

    function testRewardPoolExcludesVoterCommittedAfterCloseInExistingRound() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 3, maxVoters: 4
        });
        uint256 contentId = _submitQuestionWithRoundConfig("post-close-commit-direct", roundConfig);
        uint256 bountyClosesAt = block.timestamp + 1;
        uint256 rewardPoolId = _createRewardPoolWithExpiry(contentId, REWARD_POOL_AMOUNT, 3, 1, bountyClosesAt);

        address[] memory timelyVoters = _threeVoters();
        bool[] memory timelyDirections = _directions(true, true, false);
        bytes32[] memory timelySalts = new bytes32[](timelyVoters.length);
        bytes32[] memory timelyCommitKeys = new bytes32[](timelyVoters.length);
        for (uint256 i = 0; i < timelyVoters.length; i++) {
            timelySalts[i] = keccak256(abi.encodePacked("post-close-direct-timely", timelyVoters[i], contentId, i));
            timelyCommitKeys[i] = _commitTestVote(
                DirectTestCommitRequest({
                    engine: votingEngine,
                    lrepToken: lrepToken,
                    voter: timelyVoters[i],
                    contentId: contentId,
                    isUp: timelyDirections[i],
                    stake: STAKE,
                    frontend: address(0),
                    salt: timelySalts[i]
                })
            );
        }

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        vm.warp(bountyClosesAt + 1);
        bytes32 lateSalt = keccak256(abi.encodePacked("post-close-direct-late", voter4, contentId));
        bytes32 lateCommitKey = _commitTestVoteTargetingRevealableAfter(
            voter4, contentId, true, round.startTime + EPOCH_DURATION, lateSalt
        );
        assertGt(_commitCommittedAt(votingEngine, contentId, roundId, lateCommitKey), bountyClosesAt);

        _warpPastTlockRevealTime(_lastCommitRevealableAfter(votingEngine, contentId, roundId));
        for (uint256 i = 0; i < timelyVoters.length; i++) {
            votingEngine.revealVoteByCommitKey(
                contentId, roundId, timelyCommitKeys[i], timelyDirections[i], 5_000, timelySalts[i]
            );
        }
        votingEngine.revealVoteByCommitKey(contentId, roundId, lateCommitKey, true, 5_000, lateSalt);
        _settleAfterRbtsSeed(votingEngine, contentId, roundId);

        assertGt(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter1), 0);
        assertEq(rewardPoolEscrow.claimableQuestionReward(rewardPoolId, roundId, voter4), 0);
    }

    function testRewardPoolBundleExcludesCompleterCommittedAfterCloseInExistingRounds() public {
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 3, maxVoters: 4
        });
        uint256[] memory contentIds = new uint256[](2);
        contentIds[0] = _submitQuestionWithContextAndRoundConfig(
            "https://example.com/post-close-bundle-a", "bundle-a", roundConfig
        );
        contentIds[1] = _submitQuestionWithContextAndRoundConfig(
            "https://example.com/post-close-bundle-b", "bundle-b", roundConfig
        );

        uint256 bountyClosesAt = block.timestamp + 1;
        uint256 bundleId =
            _createSubmissionBundleWithClose(contentIds, funder, REWARD_ASSET_USDC, 20e6, 3, bountyClosesAt);

        bytes32[3][2] memory timelySalts;
        bytes32[3][2] memory timelyCommitKeys;
        bytes32[2] memory lateSalts;
        bytes32[2] memory lateCommitKeys;
        uint256[2] memory roundIds;
        address[3] memory timelyVoters = [voter1, voter2, voter3];
        bool[3] memory timelyDirections = [true, true, false];

        for (uint256 contentIndex = 0; contentIndex < contentIds.length; contentIndex++) {
            for (uint256 voterIndex = 0; voterIndex < timelyVoters.length; voterIndex++) {
                timelySalts[contentIndex][voterIndex] = keccak256(
                    abi.encodePacked("post-close-bundle-timely", contentIds[contentIndex], timelyVoters[voterIndex])
                );
                timelyCommitKeys[contentIndex][voterIndex] = _commitTestVote(
                    DirectTestCommitRequest({
                        engine: votingEngine,
                        lrepToken: lrepToken,
                        voter: timelyVoters[voterIndex],
                        contentId: contentIds[contentIndex],
                        isUp: timelyDirections[voterIndex],
                        stake: STAKE,
                        frontend: address(0),
                        salt: timelySalts[contentIndex][voterIndex]
                    })
                );
            }
            roundIds[contentIndex] = RoundEngineReadHelpers.activeRoundId(votingEngine, contentIds[contentIndex]);
        }

        vm.warp(bountyClosesAt + 1);
        for (uint256 contentIndex = 0; contentIndex < contentIds.length; contentIndex++) {
            lateSalts[contentIndex] =
                keccak256(abi.encodePacked("post-close-bundle-late", voter4, contentIds[contentIndex]));
            RoundLib.Round memory round =
                RoundEngineReadHelpers.round(votingEngine, contentIds[contentIndex], roundIds[contentIndex]);
            lateCommitKeys[contentIndex] = _commitTestVoteTargetingRevealableAfter(
                voter4, contentIds[contentIndex], true, round.startTime + EPOCH_DURATION, lateSalts[contentIndex]
            );
            assertGt(
                _commitCommittedAt(
                    votingEngine, contentIds[contentIndex], roundIds[contentIndex], lateCommitKeys[contentIndex]
                ),
                bountyClosesAt
            );
        }

        _warpPastTlockRevealTime(_lastCommitRevealableAfter(votingEngine, contentIds[1], roundIds[1]));
        for (uint256 contentIndex = 0; contentIndex < contentIds.length; contentIndex++) {
            for (uint256 voterIndex = 0; voterIndex < timelyVoters.length; voterIndex++) {
                votingEngine.revealVoteByCommitKey(
                    contentIds[contentIndex],
                    roundIds[contentIndex],
                    timelyCommitKeys[contentIndex][voterIndex],
                    timelyDirections[voterIndex],
                    5_000,
                    timelySalts[contentIndex][voterIndex]
                );
            }
            votingEngine.revealVoteByCommitKey(
                contentIds[contentIndex],
                roundIds[contentIndex],
                lateCommitKeys[contentIndex],
                true,
                5_000,
                lateSalts[contentIndex]
            );
            _settleAfterRbtsSeed(votingEngine, contentIds[contentIndex], roundIds[contentIndex]);
        }
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[0], roundIds[0]);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[1], roundIds[1]);

        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), 0);
        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter4), 0);
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
        uint256 treasuryBalanceBefore = lrepToken.balanceOf(treasury);
        uint256 refundAmount = rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId);

        assertEq(refundAmount, rewardAmount - claimed);
        assertEq(lrepToken.balanceOf(treasury), treasuryBalanceBefore + refundAmount);
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

    function testClusterRewardPoolRejectsOracleWithDifferentConsumer() public {
        uint256 contentId = _submitQuestion("");

        ClusterPayoutOracle oracle = _newEligibleClusterPayoutOracle();
        oracle.setOracleConfig(1 hours, 5e6, address(this));
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), address(this));
        vm.prank(owner);
        protocolConfig.setClusterPayoutOracle(address(oracle));

        vm.prank(funder);
        usdc.approve(address(rewardPoolEscrow), REWARD_POOL_AMOUNT);
        vm.expectRevert("Oracle consumer mismatch");
        vm.prank(funder);
        rewardPoolEscrow.createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1, block.timestamp + 30 days, 30 days, 0);
    }

    function testClusterRewardPoolDoesNotSnapshotBelowFloorOracleWithDifferentConsumer() public {
        uint256 contentId = _submitQuestion("");

        ClusterPayoutOracle oracle = _newEligibleClusterPayoutOracle();
        oracle.setOracleConfig(1 hours, 5e6, address(this));
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), address(this));
        vm.prank(owner);
        protocolConfig.setClusterPayoutOracle(address(oracle));

        vm.prank(funder);
        usdc.approve(address(rewardPoolEscrow), REWARD_POOL_AMOUNT);
        vm.expectRevert("Oracle consumer mismatch");
        vm.prank(funder);
        rewardPoolEscrow.createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1, block.timestamp + 30 days, 30 days, 0);
    }

    function testClusterRewardPoolRejectsSnapshotProposedBeforeCleanupComplete() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        uint256 roundId = _settleRoundWithOneUnrevealed(contentId);
        assertEq(_roundClusterPayoutReadyAt(votingEngine, contentId, roundId), 0);

        // M-Oracle-1: the layer-1 oracle gate now also rejects pre-source proposals via
        // `roundPayoutSnapshotSourceReadyAt`. Bypass that gate for this test by mocking the
        // consumer view so the layer-2 defense at qualifyRound (`Cluster source stale`) is still
        // exercised end-to-end. This guards against future regressions if the layer-1 gate is
        // weakened or bypassed by a misconfigured consumer.
        vm.mockCall(
            address(rewardPoolEscrow),
            abi.encodeWithSelector(
                rewardPoolEscrow.roundPayoutSnapshotSourceReadyAt.selector, uint8(1), rewardPoolId, contentId, roundId
            ),
            abi.encode(uint64(1))
        );
        _finalizeClusterPayoutSnapshot(oracle, rewardPoolId, contentId, roundId, 3, 30_000, 10_000);
        vm.clearMockedCalls();
        votingEngine.processUnrevealedVotes(contentId, roundId, 0, 0);
        assertGt(_roundClusterPayoutReadyAt(votingEngine, contentId, roundId), 0);

        vm.expectRevert("Cluster source stale");
        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);

        (uint256 skipped, uint256 nextRoundToEvaluate) = rewardPoolEscrow.advanceQualificationCursor(rewardPoolId, 1);
        assertEq(skipped, 0);
        assertEq(nextRoundToEvaluate, roundId);
    }

    function testClusterRewardPoolDoesNotSkipBelowFloorSnapshotProposedBeforeCleanupComplete() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        uint256 roundId = _settleRoundWithOneUnrevealed(contentId);
        assertEq(_roundClusterPayoutReadyAt(votingEngine, contentId, roundId), 0);

        // M-Oracle-1: bypass the new layer-1 gate so the layer-2 defense at qualify time can be
        // verified independently. See sibling test for rationale.
        vm.mockCall(
            address(rewardPoolEscrow),
            abi.encodeWithSelector(
                rewardPoolEscrow.roundPayoutSnapshotSourceReadyAt.selector, uint8(1), rewardPoolId, contentId, roundId
            ),
            abi.encode(uint64(1))
        );
        _finalizeClusterPayoutSnapshot(oracle, rewardPoolId, contentId, roundId, 3, 20_000, 1);
        vm.clearMockedCalls();
        votingEngine.processUnrevealedVotes(contentId, roundId, 0, 0);

        (uint256 skipped, uint256 nextRoundToEvaluate) = rewardPoolEscrow.advanceQualificationCursor(rewardPoolId, 1);
        assertEq(skipped, 0);
        assertEq(nextRoundToEvaluate, roundId);
    }

    function testClusterRewardPoolAcceptsSnapshotProposedAfterCleanupComplete() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        uint256 roundId = _settleRoundWithOneUnrevealed(contentId);
        votingEngine.processUnrevealedVotes(contentId, roundId, 0, 0);
        assertGt(_roundClusterPayoutReadyAt(votingEngine, contentId, roundId), 0);

        _finalizeClusterPayoutSnapshot(oracle, rewardPoolId, contentId, roundId, 3, 30_000, 10_000);

        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);
        RoundSnapshot memory snapshot = rewardPoolEscrow.getRoundSnapshot(rewardPoolId, roundId);
        assertTrue(snapshot.qualified);
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

    function testClusterRewardPoolCanSkipFinalizedEmptySnapshot() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId =
            _createRewardPoolWithEligibility(contentId, REWARD_POOL_AMOUNT, 3, 1, BOUNTY_ELIGIBILITY_VERIFIED_HUMAN);

        address[] memory unverifiedVoters = _voters(address(20), address(21), address(22));
        vm.startPrank(owner);
        for (uint256 i = 0; i < unverifiedVoters.length; i++) {
            lrepToken.mint(unverifiedVoters[i], 10_000e6);
        }
        vm.stopPrank();

        uint256 roundId = _settleRoundWith(unverifiedVoters, contentId, _directions(true, true, false));
        _finalizeClusterPayoutSnapshotWithRoot(oracle, rewardPoolId, contentId, roundId, 0, 0, 0, bytes32(0));

        vm.expectRevert("Too few eligible voters");
        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);

        (uint256 skipped, uint256 nextRoundToEvaluate) = rewardPoolEscrow.advanceQualificationCursor(rewardPoolId, 1);
        assertEq(skipped, 1);
        assertEq(nextRoundToEvaluate, roundId + 1);

        RoundSnapshot memory skippedSnapshot = rewardPoolEscrow.getRoundSnapshot(rewardPoolId, roundId);
        assertFalse(skippedSnapshot.qualified);
        assertEq(skippedSnapshot.allocation, 0);
        assertFalse(rewardPoolEscrow.isRoundPayoutSnapshotConsumed(1, rewardPoolId, contentId, roundId));
    }

    function testClusterRewardPoolDoesNotSkipEmptySnapshotWithRawMismatch() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        _finalizeClusterPayoutSnapshotWithRoot(oracle, rewardPoolId, contentId, roundId, 0, 0, 0, bytes32(0));

        (uint256 skipped, uint256 nextRoundToEvaluate) = rewardPoolEscrow.advanceQualificationCursor(rewardPoolId, 1);
        assertEq(skipped, 0);
        assertEq(nextRoundToEvaluate, roundId);
    }

    function testGovernanceCanReplaceUnconsumedFinalizedClusterSnapshotMismatch() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        IClusterPayoutOracle.PayoutWeight memory payoutWeight =
            _clusterPayoutWeight(rewardPoolId, contentId, roundId, 0);
        bytes32 weightRoot = oracle.payoutWeightLeaf(payoutWeight);
        _finalizeClusterPayoutSnapshotWithRoot(
            oracle, rewardPoolId, contentId, roundId, 4, 30_000, 10_000, keccak256("bad-weight-root")
        );

        vm.expectRevert("Cluster snapshot mismatch");
        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);
        assertFalse(rewardPoolEscrow.isRoundPayoutSnapshotConsumed(1, rewardPoolId, contentId, roundId));

        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(1, rewardPoolId, contentId, roundId);
        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("raw-eligible-voter-mismatch"));
        _finalizeClusterRoundPayoutSnapshotWithRoot(
            oracle,
            rewardPoolId,
            contentId,
            roundId,
            uint64(roundId),
            3,
            30_000,
            payoutWeight.effectiveWeight,
            weightRoot
        );

        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);
        // M-Oracle-2-Followup: qualification alone no longer flips the consumed flag. The flag
        // mirrors the launch consumer's "first paid wei" semantics so the arbiter's
        // post-veto-window rejection branch stays open for forensic discovery until a real
        // claim has moved funds.
        assertFalse(rewardPoolEscrow.isRoundPayoutSnapshotConsumed(1, rewardPoolId, contentId, roundId));

        // Claim one reward against the corrected snapshot. After the first paid wei, the
        // consumer reports consumed and rejections outside the veto window must revert.
        bytes32[] memory proof = new bytes32[](0);
        vm.prank(voter1);
        uint256 paid = rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId, payoutWeight, proof);
        assertGt(paid, 0);
        assertTrue(rewardPoolEscrow.isRoundPayoutSnapshotConsumed(1, rewardPoolId, contentId, roundId));

        // Past the finalization veto window, a snapshot that has actually paid out can no
        // longer be rejected.
        vm.warp(block.timestamp + oracle.FINALIZATION_VETO_WINDOW() + 1);
        vm.expectRevert(ClusterPayoutOracle.SnapshotConsumed.selector);
        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("already-applied"));
    }

    function testQualifiedClusterSnapshotRejectsReplacementRootClaims() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        IClusterPayoutOracle.PayoutWeight memory payoutWeight =
            _clusterPayoutWeight(rewardPoolId, contentId, roundId, 0);
        bytes32 originalRoot = oracle.payoutWeightLeaf(payoutWeight);
        _finalizeClusterPayoutSnapshotWithRoot(
            oracle, rewardPoolId, contentId, roundId, 3, 30_000, payoutWeight.effectiveWeight, originalRoot
        );

        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);
        RoundSnapshot memory snapshot = rewardPoolEscrow.getRoundSnapshot(rewardPoolId, roundId);
        assertEq(snapshot.clusterWeightRoot, originalRoot);
        assertTrue(snapshot.clusterSnapshotDigest != bytes32(0));
        assertFalse(rewardPoolEscrow.isRoundPayoutSnapshotConsumed(1, rewardPoolId, contentId, roundId));

        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(1, rewardPoolId, contentId, roundId);
        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("replace-qualified-root"));
        assertFalse(oracle.rejectedRoundPayoutSnapshotRoots(snapshotKey, originalRoot));
        assertTrue(oracle.rejectedRoundPayoutSnapshotDigests(snapshotKey, snapshot.clusterSnapshotDigest));

        IClusterPayoutOracle.PayoutWeight memory replacementWeight = payoutWeight;
        replacementWeight.effectiveWeight = payoutWeight.effectiveWeight / 2;
        replacementWeight.reasonHash = keccak256("replacement-cluster-payout");
        bytes32 replacementRoot = oracle.payoutWeightLeaf(replacementWeight);
        _finalizeClusterRoundPayoutSnapshotWithRoot(
            oracle,
            rewardPoolId,
            contentId,
            roundId,
            uint64(roundId),
            3,
            30_000,
            replacementWeight.effectiveWeight,
            replacementRoot
        );

        bytes32[] memory proof = new bytes32[](0);
        vm.prank(voter1);
        vm.expectRevert("Cluster snapshot changed");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId, replacementWeight, proof);

        vm.prank(voter2);
        rewardPoolEscrow.recoverRejectedSnapshotRound(rewardPoolId, roundId);
        RoundSnapshot memory recovered = rewardPoolEscrow.getRoundSnapshot(rewardPoolId, roundId);
        assertFalse(recovered.qualified);
    }

    function testQualifiedClusterSnapshotRejectsSameRootMetadataReplacementClaims() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        IClusterPayoutOracle.PayoutWeight memory payoutWeight =
            _clusterPayoutWeight(rewardPoolId, contentId, roundId, 0);
        bytes32 originalRoot = oracle.payoutWeightLeaf(payoutWeight);
        _finalizeClusterPayoutSnapshotWithRoot(
            oracle, rewardPoolId, contentId, roundId, 3, 30_000, payoutWeight.effectiveWeight, originalRoot
        );

        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);
        RoundSnapshot memory snapshot = rewardPoolEscrow.getRoundSnapshot(rewardPoolId, roundId);
        assertEq(snapshot.clusterWeightRoot, originalRoot);
        assertTrue(snapshot.clusterSnapshotDigest != bytes32(0));

        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(1, rewardPoolId, contentId, roundId);
        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("same-root-bad-metadata"));
        assertTrue(oracle.rejectedRoundPayoutSnapshotDigests(snapshotKey, snapshot.clusterSnapshotDigest));

        oracle.proposeRoundPayoutSnapshot(
            IClusterPayoutOracle.RoundPayoutSnapshotInput({
                domain: 1,
                rewardPoolId: rewardPoolId,
                contentId: contentId,
                roundId: roundId,
                correlationEpochId: uint64(roundId),
                rawEligibleVoters: 3,
                effectiveParticipantUnits: 30_000,
                totalClaimWeight: payoutWeight.effectiveWeight,
                weightRoot: originalRoot,
                reasonRoot: keccak256("same-root-corrected-reason-root"),
                artifactHash: keccak256("epoch-artifact"),
                artifactURI: "ipfs://round-same-root-corrected"
            })
        );
        ClusterPayoutOracle.RoundPayoutProposal memory proposal = oracle.roundPayoutProposal(snapshotKey);
        vm.warp(uint256(proposal.proposedAt) + uint256(oracle.challengeWindow()) + 1);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);

        bytes32[] memory proof = new bytes32[](0);
        vm.prank(voter1);
        vm.expectRevert("Cluster snapshot changed");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId, payoutWeight, proof);

        vm.prank(voter2);
        rewardPoolEscrow.recoverRejectedSnapshotRound(rewardPoolId, roundId);
        RoundSnapshot memory recovered = rewardPoolEscrow.getRoundSnapshot(rewardPoolId, roundId);
        assertFalse(recovered.qualified);
    }

    function testRecoveredClusterSnapshotCanReopenWithCorrectedSameRootMetadata() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        IClusterPayoutOracle.PayoutWeight memory payoutWeight =
            _clusterPayoutWeight(rewardPoolId, contentId, roundId, 0);
        bytes32 originalRoot = oracle.payoutWeightLeaf(payoutWeight);
        _finalizeClusterPayoutSnapshotWithRoot(
            oracle, rewardPoolId, contentId, roundId, 3, 30_000, payoutWeight.effectiveWeight, originalRoot
        );

        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);
        RoundSnapshot memory rejectedSnapshot = rewardPoolEscrow.getRoundSnapshot(rewardPoolId, roundId);
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(1, rewardPoolId, contentId, roundId);
        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("bad-metadata"));

        vm.prank(voter2);
        rewardPoolEscrow.recoverRejectedSnapshotRound(rewardPoolId, roundId);

        IClusterPayoutOracle.RoundPayoutSnapshotInput memory correctedInput =
            IClusterPayoutOracle.RoundPayoutSnapshotInput({
                domain: 1,
                rewardPoolId: rewardPoolId,
                contentId: contentId,
                roundId: roundId,
                correlationEpochId: uint64(roundId),
                rawEligibleVoters: 3,
                effectiveParticipantUnits: 30_000,
                totalClaimWeight: payoutWeight.effectiveWeight + 1,
                weightRoot: originalRoot,
                reasonRoot: keccak256("corrected-reason-root"),
                artifactHash: keccak256("epoch-artifact"),
                artifactURI: "ipfs://round-corrected"
            });
        oracle.proposeRoundPayoutSnapshot(correctedInput);
        ClusterPayoutOracle.RoundPayoutProposal memory proposal = oracle.roundPayoutProposal(snapshotKey);
        vm.warp(uint256(proposal.proposedAt) + uint256(oracle.challengeWindow()) + 1);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);

        vm.prank(voter3);
        rewardPoolEscrow.reopenRecoveredSnapshotRound(rewardPoolId, roundId);
        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);

        RoundSnapshot memory replacementSnapshot = rewardPoolEscrow.getRoundSnapshot(rewardPoolId, roundId);
        assertEq(replacementSnapshot.clusterWeightRoot, originalRoot);
        assertTrue(replacementSnapshot.clusterSnapshotDigest != rejectedSnapshot.clusterSnapshotDigest);
        assertEq(replacementSnapshot.totalClaimWeight, payoutWeight.effectiveWeight + 1);
    }

    // FE-1 (audit 2026-05-20-followup): regression test. Confirms that after a
    // rejected-and-recovered snapshot, any caller can reopen the round once the oracle has a NEW
    // finalized snapshot with a different weightRoot, and honest voters can then claim.
    function testReopenRecoveredSnapshotRound_AllowsHonestRequalification() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        IClusterPayoutOracle.PayoutWeight memory payoutWeight =
            _clusterPayoutWeight(rewardPoolId, contentId, roundId, 0);

        // 1) Finalize an initial (later-to-be-rejected) snapshot, qualify, then reject it.
        bytes32 originalRoot = oracle.payoutWeightLeaf(payoutWeight);
        _finalizeClusterPayoutSnapshotWithRoot(
            oracle, rewardPoolId, contentId, roundId, 3, 30_000, payoutWeight.effectiveWeight, originalRoot
        );
        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);

        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(1, rewardPoolId, contentId, roundId);
        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("reject-original"));

        // 2) Anyone can recover the rejected-snapshot allocation. Cursor advances past `roundId`.
        vm.prank(voter2);
        rewardPoolEscrow.recoverRejectedSnapshotRound(rewardPoolId, roundId);
        assertTrue(rewardPoolEscrow.rejectedRecoveredRound(rewardPoolId, roundId));

        // Before the fix this revert was permanent: qualifyRound complains "Round out of order".
        vm.expectRevert("Round not recovered");
        vm.prank(voter2);
        rewardPoolEscrow.reopenRecoveredSnapshotRound(rewardPoolId, roundId + 1);

        // 3) Oracle finalizes a NEW snapshot for the SAME roundId with a DIFFERENT weightRoot.
        IClusterPayoutOracle.PayoutWeight memory honestWeight = payoutWeight;
        honestWeight.reasonHash = keccak256("honest-replacement");
        bytes32 honestRoot = oracle.payoutWeightLeaf(honestWeight);
        _finalizeClusterRoundPayoutSnapshotWithRoot(
            oracle,
            rewardPoolId,
            contentId,
            roundId,
            uint64(roundId),
            3,
            30_000,
            honestWeight.effectiveWeight,
            honestRoot
        );

        // 4) Anyone can reopen the recovered round; the flag flips and the cursor rewinds
        //    (only one advancement happened so the cursor goes from roundId+1 back to roundId).
        vm.expectEmit(true, true, true, true);
        emit RecoveredSnapshotRoundReopened(rewardPoolId, contentId, roundId, honestRoot);
        vm.prank(voter3);
        rewardPoolEscrow.reopenRecoveredSnapshotRound(rewardPoolId, roundId);
        assertTrue(rewardPoolEscrow.reopenedRecoveredRound(rewardPoolId, roundId));
        assertTrue(rewardPoolEscrow.rejectedRecoveredRound(rewardPoolId, roundId));

        // 5) Honest voter can now claim. The recovery flags are consumed during qualification.
        bytes32[] memory proof = new bytes32[](0);
        vm.prank(voter1);
        uint256 paid = rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId, honestWeight, proof);
        assertGt(paid, 0);
        assertFalse(rewardPoolEscrow.reopenedRecoveredRound(rewardPoolId, roundId));
        assertFalse(rewardPoolEscrow.rejectedRecoveredRound(rewardPoolId, roundId));

        RoundSnapshot memory finalSnapshot = rewardPoolEscrow.getRoundSnapshot(rewardPoolId, roundId);
        assertTrue(finalSnapshot.qualified);
        assertEq(finalSnapshot.clusterWeightRoot, honestRoot);
    }

    function testReopenRecoveredSnapshotRound_RemainsRecoverableIfReplacementRejectedBeforeClaim() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        IClusterPayoutOracle.PayoutWeight memory payoutWeight =
            _clusterPayoutWeight(rewardPoolId, contentId, roundId, 0);
        bytes32 originalRoot = oracle.payoutWeightLeaf(payoutWeight);
        _finalizeClusterPayoutSnapshotWithRoot(
            oracle, rewardPoolId, contentId, roundId, 3, 30_000, payoutWeight.effectiveWeight, originalRoot
        );
        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);

        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(1, rewardPoolId, contentId, roundId);
        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("reject-original-before-race"));
        vm.prank(voter2);
        rewardPoolEscrow.recoverRejectedSnapshotRound(rewardPoolId, roundId);

        IClusterPayoutOracle.PayoutWeight memory firstReplacement = payoutWeight;
        firstReplacement.reasonHash = keccak256("first-replacement-before-race");
        bytes32 firstReplacementRoot = oracle.payoutWeightLeaf(firstReplacement);
        _finalizeClusterRoundPayoutSnapshotWithRoot(
            oracle,
            rewardPoolId,
            contentId,
            roundId,
            uint64(roundId),
            3,
            30_000,
            firstReplacement.effectiveWeight,
            firstReplacementRoot
        );

        vm.prank(voter3);
        rewardPoolEscrow.reopenRecoveredSnapshotRound(rewardPoolId, roundId);
        assertTrue(rewardPoolEscrow.reopenedRecoveredRound(rewardPoolId, roundId));
        assertTrue(rewardPoolEscrow.rejectedRecoveredRound(rewardPoolId, roundId));

        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("reject-first-replacement-before-claim"));

        IClusterPayoutOracle.PayoutWeight memory secondReplacement = payoutWeight;
        secondReplacement.reasonHash = keccak256("second-replacement-after-race");
        bytes32 secondReplacementRoot = oracle.payoutWeightLeaf(secondReplacement);
        _finalizeClusterRoundPayoutSnapshotWithRoot(
            oracle,
            rewardPoolId,
            contentId,
            roundId,
            uint64(roundId),
            3,
            30_000,
            secondReplacement.effectiveWeight,
            secondReplacementRoot
        );

        vm.prank(voter1);
        uint256 paid = rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId, secondReplacement, new bytes32[](0));
        assertGt(paid, 0);
        assertFalse(rewardPoolEscrow.reopenedRecoveredRound(rewardPoolId, roundId));
        assertFalse(rewardPoolEscrow.rejectedRecoveredRound(rewardPoolId, roundId));
        RoundSnapshot memory finalSnapshot = rewardPoolEscrow.getRoundSnapshot(rewardPoolId, roundId);
        assertEq(finalSnapshot.clusterWeightRoot, secondReplacementRoot);
    }

    function testRecoveredSnapshotRoundBlocksLaterQualificationUntilRequalified() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 2);

        uint256 firstRoundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        IClusterPayoutOracle.PayoutWeight memory firstWeight =
            _clusterPayoutWeight(rewardPoolId, contentId, firstRoundId, 0);
        bytes32 firstRoot = oracle.payoutWeightLeaf(firstWeight);
        _finalizeClusterPayoutSnapshotWithRoot(
            oracle, rewardPoolId, contentId, firstRoundId, 3, 30_000, firstWeight.effectiveWeight, firstRoot
        );
        rewardPoolEscrow.qualifyRound(rewardPoolId, firstRoundId);

        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(1, rewardPoolId, contentId, firstRoundId);
        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("reject-first"));
        vm.prank(owner);
        rewardPoolEscrow.recoverRejectedSnapshotRound(rewardPoolId, firstRoundId);

        vm.warp(block.timestamp + 25 hours);
        uint256 secondRoundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        IClusterPayoutOracle.PayoutWeight memory secondWeight =
            _clusterPayoutWeight(rewardPoolId, contentId, secondRoundId, 0);
        _finalizeClusterPayoutSnapshot(
            oracle, rewardPoolId, contentId, secondRoundId, 3, 30_000, secondWeight.effectiveWeight
        );

        vm.expectRevert("Recovered round pending");
        rewardPoolEscrow.qualifyRound(rewardPoolId, secondRoundId);

        IClusterPayoutOracle.PayoutWeight memory honestWeight = firstWeight;
        honestWeight.reasonHash = keccak256("honest-replacement");
        bytes32 honestRoot = oracle.payoutWeightLeaf(honestWeight);
        _finalizeClusterRoundPayoutSnapshotWithRoot(
            oracle,
            rewardPoolId,
            contentId,
            firstRoundId,
            uint64(firstRoundId),
            3,
            30_000,
            honestWeight.effectiveWeight,
            honestRoot
        );

        vm.prank(owner);
        rewardPoolEscrow.reopenRecoveredSnapshotRound(rewardPoolId, firstRoundId);
        vm.prank(voter1);
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, firstRoundId, honestWeight, new bytes32[](0));

        rewardPoolEscrow.qualifyRound(rewardPoolId, secondRoundId);
        RoundSnapshot memory secondSnapshot = rewardPoolEscrow.getRoundSnapshot(rewardPoolId, secondRoundId);
        assertTrue(secondSnapshot.qualified);
    }

    function testRecoveredSnapshotRoundBlocksUnallocatedRefund() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 expiresAt = block.timestamp + 1 days;
        uint256 rewardPoolId = _createRewardPoolWithExpiry(contentId, REWARD_POOL_AMOUNT, 3, 2, expiresAt);

        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        IClusterPayoutOracle.PayoutWeight memory payoutWeight =
            _clusterPayoutWeight(rewardPoolId, contentId, roundId, 0);
        bytes32 originalRoot = oracle.payoutWeightLeaf(payoutWeight);
        _finalizeClusterPayoutSnapshotWithRoot(
            oracle, rewardPoolId, contentId, roundId, 3, 30_000, payoutWeight.effectiveWeight, originalRoot
        );
        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);

        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(1, rewardPoolId, contentId, roundId);
        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("reject-original"));
        vm.prank(owner);
        rewardPoolEscrow.recoverRejectedSnapshotRound(rewardPoolId, roundId);

        vm.warp(expiresAt + 1);
        vm.expectRevert(bytes4(keccak256("RecoveredRoundPending()")));
        rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId);
    }

    function testRecoveredSnapshotRoundCanReopenAfterUnallocatedRefund() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 expiresAt = block.timestamp + 1 days;
        uint256 rewardPoolId = _createRewardPoolWithExpiry(contentId, 120e6, 3, 2, expiresAt);

        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        IClusterPayoutOracle.PayoutWeight memory payoutWeight =
            _clusterPayoutWeight(rewardPoolId, contentId, roundId, 0);
        bytes32 originalRoot = oracle.payoutWeightLeaf(payoutWeight);
        _finalizeClusterPayoutSnapshotWithRoot(
            oracle, rewardPoolId, contentId, roundId, 3, 30_000, payoutWeight.effectiveWeight, originalRoot
        );
        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);

        vm.warp(expiresAt + 1);
        uint256 funderBalanceBefore = usdc.balanceOf(funder);
        uint256 unallocatedRefund = rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId);
        assertEq(unallocatedRefund, 60e6);
        assertEq(usdc.balanceOf(funder), funderBalanceBefore + unallocatedRefund);

        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(1, rewardPoolId, contentId, roundId);
        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("reject-after-unallocated-refund"));
        vm.prank(owner);
        rewardPoolEscrow.recoverRejectedSnapshotRound(rewardPoolId, roundId);

        vm.expectRevert(bytes4(keccak256("RecoveredRoundPending()")));
        rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId);

        IClusterPayoutOracle.PayoutWeight memory replacementWeight = payoutWeight;
        replacementWeight.reasonHash = keccak256("replacement-after-unallocated-refund");
        bytes32 replacementRoot = oracle.payoutWeightLeaf(replacementWeight);
        _finalizeClusterRoundPayoutSnapshotWithRoot(
            oracle,
            rewardPoolId,
            contentId,
            roundId,
            uint64(roundId),
            3,
            30_000,
            replacementWeight.effectiveWeight,
            replacementRoot
        );

        vm.prank(owner);
        rewardPoolEscrow.reopenRecoveredSnapshotRound(rewardPoolId, roundId);

        vm.prank(voter1);
        uint256 paid = rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId, replacementWeight, new bytes32[](0));
        assertGt(paid, 0);
        RoundSnapshot memory replacementSnapshot = rewardPoolEscrow.getRoundSnapshot(rewardPoolId, roundId);
        assertTrue(replacementSnapshot.qualified);
        assertEq(replacementSnapshot.allocation, 60e6, "reopened round keeps recovered allocation");
        assertEq(replacementSnapshot.clusterWeightRoot, replacementRoot);
    }

    function testRecoveredSnapshotRoundRejectsAfterCompleteRefund() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 expiresAt = block.timestamp + EPOCH_DURATION + 10;
        uint256 rewardPoolId = _createRewardPoolWithExpiry(contentId, REWARD_POOL_AMOUNT, 3, 1, expiresAt);

        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        IClusterPayoutOracle.PayoutWeight memory payoutWeight =
            _clusterPayoutWeight(rewardPoolId, contentId, roundId, 0);
        bytes32 originalRoot = oracle.payoutWeightLeaf(payoutWeight);
        _finalizeClusterPayoutSnapshotWithRoot(
            oracle, rewardPoolId, contentId, roundId, 3, 30_000, payoutWeight.effectiveWeight, originalRoot
        );
        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);

        vm.warp(expiresAt + BUNDLE_CLAIM_GRACE + 1);
        assertEq(rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId), REWARD_POOL_AMOUNT);

        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(1, rewardPoolId, contentId, roundId);
        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("reject-after-complete-refund"));

        vm.prank(owner);
        vm.expectRevert("Bounty refunded");
        rewardPoolEscrow.recoverRejectedSnapshotRound(rewardPoolId, roundId);
    }

    function testRecoveredSnapshotRoundsShareRecoveredAllocationAfterUnallocatedRefund() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 expiresAt = block.timestamp + 7 days;
        uint256 rewardPoolId = _createRewardPoolWithExpiry(contentId, 180e6, 3, 3, expiresAt);

        uint256 firstRoundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        IClusterPayoutOracle.PayoutWeight memory firstWeight =
            _clusterPayoutWeight(rewardPoolId, contentId, firstRoundId, 0);
        bytes32 firstRoot = oracle.payoutWeightLeaf(firstWeight);
        _finalizeClusterPayoutSnapshotWithRoot(
            oracle, rewardPoolId, contentId, firstRoundId, 3, 30_000, firstWeight.effectiveWeight, firstRoot
        );
        rewardPoolEscrow.qualifyRound(rewardPoolId, firstRoundId);

        vm.warp(block.timestamp + 25 hours);
        uint256 secondRoundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        IClusterPayoutOracle.PayoutWeight memory secondWeight =
            _clusterPayoutWeight(rewardPoolId, contentId, secondRoundId, 0);
        bytes32 secondRoot = oracle.payoutWeightLeaf(secondWeight);
        _finalizeClusterPayoutSnapshotWithRoot(
            oracle, rewardPoolId, contentId, secondRoundId, 3, 30_000, secondWeight.effectiveWeight, secondRoot
        );
        rewardPoolEscrow.qualifyRound(rewardPoolId, secondRoundId);

        vm.warp(expiresAt + 1);
        assertEq(rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId), 60e6);

        bytes32 firstSnapshotKey = oracle.roundPayoutSnapshotKey(1, rewardPoolId, contentId, firstRoundId);
        oracle.rejectFinalizedRoundPayoutSnapshot(firstSnapshotKey, keccak256("reject-first-after-refund"));
        vm.prank(owner);
        rewardPoolEscrow.recoverRejectedSnapshotRound(rewardPoolId, firstRoundId);

        bytes32 secondSnapshotKey = oracle.roundPayoutSnapshotKey(1, rewardPoolId, contentId, secondRoundId);
        oracle.rejectFinalizedRoundPayoutSnapshot(secondSnapshotKey, keccak256("reject-second-after-refund"));
        vm.prank(owner);
        rewardPoolEscrow.recoverRejectedSnapshotRound(rewardPoolId, secondRoundId);

        IClusterPayoutOracle.PayoutWeight memory firstReplacement = firstWeight;
        firstReplacement.reasonHash = keccak256("first-replacement-after-refund");
        bytes32 firstReplacementRoot = oracle.payoutWeightLeaf(firstReplacement);
        _finalizeClusterRoundPayoutSnapshotWithRoot(
            oracle,
            rewardPoolId,
            contentId,
            firstRoundId,
            uint64(firstRoundId),
            3,
            30_000,
            firstReplacement.effectiveWeight,
            firstReplacementRoot
        );

        IClusterPayoutOracle.PayoutWeight memory secondReplacement = secondWeight;
        secondReplacement.reasonHash = keccak256("second-replacement-after-refund");
        bytes32 secondReplacementRoot = oracle.payoutWeightLeaf(secondReplacement);
        _finalizeClusterRoundPayoutSnapshotWithRoot(
            oracle,
            rewardPoolId,
            contentId,
            secondRoundId,
            uint64(secondRoundId),
            3,
            30_000,
            secondReplacement.effectiveWeight,
            secondReplacementRoot
        );

        vm.prank(owner);
        rewardPoolEscrow.reopenRecoveredSnapshotRound(rewardPoolId, firstRoundId);
        vm.prank(voter1);
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, firstRoundId, firstReplacement, new bytes32[](0));
        RoundSnapshot memory firstSnapshot = rewardPoolEscrow.getRoundSnapshot(rewardPoolId, firstRoundId);
        assertEq(firstSnapshot.allocation, 60e6, "first recovered round gets half");

        vm.prank(owner);
        rewardPoolEscrow.reopenRecoveredSnapshotRound(rewardPoolId, secondRoundId);
        vm.prank(voter1);
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, secondRoundId, secondReplacement, new bytes32[](0));
        RoundSnapshot memory secondSnapshot = rewardPoolEscrow.getRoundSnapshot(rewardPoolId, secondRoundId);
        assertEq(secondSnapshot.allocation, 60e6, "second recovered round gets remainder");
    }

    // FE-1 negative test: the admin entrypoint refuses to reopen a recovered round unless the
    // oracle has a new finalized snapshot for that round.
    function testReopenRecoveredSnapshotRound_RevertsWithoutNewOracleSnapshot() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        IClusterPayoutOracle.PayoutWeight memory payoutWeight =
            _clusterPayoutWeight(rewardPoolId, contentId, roundId, 0);
        bytes32 originalRoot = oracle.payoutWeightLeaf(payoutWeight);
        _finalizeClusterPayoutSnapshotWithRoot(
            oracle, rewardPoolId, contentId, roundId, 3, 30_000, payoutWeight.effectiveWeight, originalRoot
        );
        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);

        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(1, rewardPoolId, contentId, roundId);
        oracle.rejectFinalizedRoundPayoutSnapshot(snapshotKey, keccak256("reject-original"));

        vm.prank(voter2);
        rewardPoolEscrow.recoverRejectedSnapshotRound(rewardPoolId, roundId);

        // Oracle still has the rejected snapshot only; no new finalized snapshot.
        vm.prank(owner);
        vm.expectRevert("Oracle snapshot not finalized");
        rewardPoolEscrow.reopenRecoveredSnapshotRound(rewardPoolId, roundId);

        vm.prank(voter1);
        vm.expectRevert("Oracle snapshot not finalized");
        rewardPoolEscrow.reopenRecoveredSnapshotRound(rewardPoolId, roundId);
    }

    event RecoveredSnapshotRoundReopened(
        uint256 indexed rewardPoolId, uint256 indexed contentId, uint256 indexed roundId, bytes32 newWeightRoot
    );

    function testClaimableClusterRewardReturnsZeroWhileRecoveredRoundPending() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 2);

        uint256 firstRoundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        IClusterPayoutOracle.PayoutWeight memory firstWeight =
            _clusterPayoutWeight(rewardPoolId, contentId, firstRoundId, 0);
        bytes32 firstRoot = oracle.payoutWeightLeaf(firstWeight);
        _finalizeClusterPayoutSnapshotWithRoot(
            oracle, rewardPoolId, contentId, firstRoundId, 3, 30_000, firstWeight.effectiveWeight, firstRoot
        );
        rewardPoolEscrow.qualifyRound(rewardPoolId, firstRoundId);

        bytes32 firstSnapshotKey = oracle.roundPayoutSnapshotKey(1, rewardPoolId, contentId, firstRoundId);
        oracle.rejectFinalizedRoundPayoutSnapshot(firstSnapshotKey, keccak256("reject-preview-first"));
        vm.prank(owner);
        rewardPoolEscrow.recoverRejectedSnapshotRound(rewardPoolId, firstRoundId);

        vm.warp(block.timestamp + 25 hours);
        uint256 secondRoundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        IClusterPayoutOracle.PayoutWeight memory secondWeight =
            _clusterPayoutWeight(rewardPoolId, contentId, secondRoundId, 0);
        bytes32 secondRoot = oracle.payoutWeightLeaf(secondWeight);
        _finalizeClusterPayoutSnapshotWithRoot(
            oracle, rewardPoolId, contentId, secondRoundId, 3, 30_000, secondWeight.effectiveWeight, secondRoot
        );

        assertEq(
            rewardPoolEscrow.claimableQuestionRewardWithPayoutWeight(
                rewardPoolId, secondRoundId, voter1, secondWeight, new bytes32[](0)
            ),
            0
        );

        IClusterPayoutOracle.PayoutWeight memory replacementWeight = firstWeight;
        replacementWeight.reasonHash = keccak256("preview-replacement");
        bytes32 replacementRoot = oracle.payoutWeightLeaf(replacementWeight);
        _finalizeClusterRoundPayoutSnapshotWithRoot(
            oracle,
            rewardPoolId,
            contentId,
            firstRoundId,
            uint64(firstRoundId),
            3,
            30_000,
            replacementWeight.effectiveWeight,
            replacementRoot
        );
        vm.prank(owner);
        rewardPoolEscrow.reopenRecoveredSnapshotRound(rewardPoolId, firstRoundId);
        vm.prank(voter1);
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, firstRoundId, replacementWeight, new bytes32[](0));

        assertGt(
            rewardPoolEscrow.claimableQuestionRewardWithPayoutWeight(
                rewardPoolId, secondRoundId, voter1, secondWeight, new bytes32[](0)
            ),
            0
        );
    }

    function testRoundSnapshotStorageLayoutAppendsFirstClaimPaidClusterRootAndDigest() public {
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);
        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));

        rewardPoolEscrow.qualifyRound(rewardPoolId, roundId);

        bytes32 snapshotSlot = _roundSnapshotStorageSlot(rewardPoolId, roundId);
        uint256 packedCounts = uint256(vm.load(address(rewardPoolEscrow), snapshotSlot));
        assertEq(packedCounts, uint256(1) | (uint256(30_000) << 8) | (uint256(3) << 40));

        bytes32 firstClaimPaidSlot = bytes32(uint256(snapshotSlot) + 8);
        assertEq(uint256(vm.load(address(rewardPoolEscrow), firstClaimPaidSlot)), 0);
        bytes32 clusterWeightRootSlot = bytes32(uint256(snapshotSlot) + 9);
        assertEq(uint256(vm.load(address(rewardPoolEscrow), clusterWeightRootSlot)), 0);
        bytes32 clusterSnapshotDigestSlot = bytes32(uint256(snapshotSlot) + 10);
        assertEq(uint256(vm.load(address(rewardPoolEscrow), clusterSnapshotDigestSlot)), 0);

        _claimQuestionRewardAndAssert(voter1, rewardPoolId, roundId);
        assertEq(uint256(vm.load(address(rewardPoolEscrow), firstClaimPaidSlot)), 1);
        assertEq(uint256(vm.load(address(rewardPoolEscrow), clusterWeightRootSlot)), 0);
        assertEq(uint256(vm.load(address(rewardPoolEscrow), clusterSnapshotDigestSlot)), 0);
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

    function testGovernanceCanRepointUnqualifiedRewardPoolClusterOracle() public {
        _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);
        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));

        ClusterPayoutOracle replacementOracle = _newEligibleClusterPayoutOracle();
        replacementOracle.setOracleConfig(1 hours, 5e6, address(this));
        replacementOracle.setRoundPayoutSnapshotConsumer(
            replacementOracle.PAYOUT_DOMAIN_QUESTION_REWARD(), address(rewardPoolEscrow)
        );

        vm.prank(owner);
        rewardPoolEscrow.repointRewardPoolClusterPayoutOracle(rewardPoolId, address(replacementOracle));

        IClusterPayoutOracle.PayoutWeight memory payoutWeight =
            _clusterPayoutWeight(rewardPoolId, contentId, roundId, 0);
        _finalizeClusterPayoutSnapshotWithRoot(
            replacementOracle,
            rewardPoolId,
            contentId,
            roundId,
            3,
            30_000,
            payoutWeight.effectiveWeight,
            replacementOracle.payoutWeightLeaf(payoutWeight)
        );

        vm.prank(voter1);
        uint256 reward = rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId, payoutWeight, new bytes32[](0));
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

    function testClusterClaimablePayoutWeightChecksCurrentRaterRegistryBanAfterMigration() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("cluster-current-ban-preview");
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

        MockRaterIdentityRegistry migratedRaterIdentityRegistry = _migrateRaterIdentitiesWithDifferentIds();
        migratedRaterIdentityRegistry.setBanned(_identityKey(voter1), true);

        assertEq(
            rewardPoolEscrow.claimableQuestionRewardWithPayoutWeight(
                rewardPoolId, roundId, voter1, payoutWeight, new bytes32[](0)
            ),
            0
        );
    }

    function testClusterRewardPoolPaysAllMerkleProofClaimantsWithEffectiveWeights() public {
        uint256[] memory baseWeights = new uint256[](4);
        baseWeights[0] = 10_000;
        baseWeights[1] = 10_000;
        baseWeights[2] = 10_000;
        baseWeights[3] = 10_000;
        uint16[] memory independenceBps = new uint16[](4);
        independenceBps[0] = 10_000;
        independenceBps[1] = 10_000;
        independenceBps[2] = 6_000;
        independenceBps[3] = 4_000;
        // effectiveWeights = [10_000, 10_000, 6_000, 4_000], totalClaimWeight = 30_000;
        // 100e6 * weight / 30_000, with the last claimant sweeping the rounding residue.
        uint256[] memory expectedRewards = new uint256[](4);
        expectedRewards[0] = 33_333_333;
        expectedRewards[1] = 33_333_333;
        expectedRewards[2] = 20_000_000;
        expectedRewards[3] = 13_333_334;

        _runSurpriseWeightedClaimScenario(
            baseWeights, independenceBps, expectedRewards, _directions(true, true, false, true)
        );
    }

    // Surprise-weighted leaves (docs/surprise-weighted-bounty-weights.md) carry baseWeight in
    // [10_000, 20_000]; each claim pays allocation * effectiveWeight / totalClaimWeight.
    function testClusterRewardPoolPaysSurpriseWeightedBaseClaimWeights() public {
        uint256[] memory baseWeights = new uint256[](3);
        baseWeights[0] = 10_000;
        baseWeights[1] = 15_000;
        baseWeights[2] = 20_000;
        uint16[] memory independenceBps = new uint16[](3);
        independenceBps[0] = 10_000;
        independenceBps[1] = 10_000;
        independenceBps[2] = 10_000;
        // totalClaimWeight = 45_000; 100e6 * weight / 45_000, with the last claimant sweeping
        // the rounding residue.
        uint256[] memory expectedRewards = new uint256[](3);
        expectedRewards[0] = 22_222_222;
        expectedRewards[1] = 33_333_333;
        expectedRewards[2] = 44_444_445;

        _runSurpriseWeightedClaimScenario(baseWeights, independenceBps, expectedRewards, _directions(true, true, false));
    }

    function testClusterClaimRejectsBaseWeightAboveSurpriseCap() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        IClusterPayoutOracle.PayoutWeight memory payoutWeight =
            _clusterPayoutWeight(rewardPoolId, contentId, roundId, 0);
        payoutWeight.baseWeight = 20_001;
        payoutWeight.effectiveWeight = 20_001;
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
        vm.prank(voter1);
        vm.expectRevert("Invalid cluster proof");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId, payoutWeight, proof);
    }

    function testClusterClaimRejectsBaseWeightBelowFloor() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));
        IClusterPayoutOracle.PayoutWeight memory payoutWeight =
            _clusterPayoutWeight(rewardPoolId, contentId, roundId, 0);
        payoutWeight.baseWeight = 9_999;
        payoutWeight.effectiveWeight = 9_999;
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
        vm.prank(voter1);
        vm.expectRevert("Invalid cluster proof");
        rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId, payoutWeight, proof);
    }

    // Surprise-weighted baseWeight composes multiplicatively with the independence discount:
    // effectiveWeight = baseWeight * independenceBps / 10_000.
    function testClusterRewardPoolComposesSurpriseWeightWithIndependenceDiscount() public {
        uint256[] memory baseWeights = new uint256[](4);
        baseWeights[0] = 10_000;
        baseWeights[1] = 15_000;
        baseWeights[2] = 20_000;
        baseWeights[3] = 20_000;
        uint16[] memory independenceBps = new uint16[](4);
        independenceBps[0] = 10_000;
        independenceBps[1] = 10_000;
        independenceBps[2] = 6_000;
        independenceBps[3] = 4_000;
        // effectiveWeights = [10_000, 15_000, 12_000, 8_000], totalClaimWeight = 45_000;
        // 100e6 * weight / 45_000, with the last claimant sweeping the rounding residue.
        uint256[] memory expectedRewards = new uint256[](4);
        expectedRewards[0] = 22_222_222;
        expectedRewards[1] = 33_333_333;
        expectedRewards[2] = 26_666_666;
        expectedRewards[3] = 17_777_779;

        _runSurpriseWeightedClaimScenario(
            baseWeights, independenceBps, expectedRewards, _directions(true, true, false, true)
        );
    }

    /// @dev Drives a full cluster-snapshot claim scenario with per-rater surprise-weighted
    ///      baseWeights and independence discounts. Split into helpers so the via-ir compiler
    ///      stays within the stack budget.
    function _runSurpriseWeightedClaimScenario(
        uint256[] memory baseWeights,
        uint16[] memory independenceBps,
        uint256[] memory expectedRewards,
        bool[] memory directions
    ) internal {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        address[] memory voters = baseWeights.length == 4 ? _fourVoters() : _threeVoters();
        uint256 roundId = _settleRoundWith(voters, contentId, directions);

        (IClusterPayoutOracle.PayoutWeight[] memory payoutWeights, bytes32[] memory leaves) =
            _surpriseWeightedPayoutLeaves(oracle, rewardPoolId, contentId, roundId, baseWeights, independenceBps);

        _finalizeClusterPayoutSnapshotWithRoot(
            oracle,
            rewardPoolId,
            contentId,
            roundId,
            uint32(voters.length),
            _sumIndependenceUnits(independenceBps),
            _sumEffectiveWeights(payoutWeights),
            _merkleRoot(leaves)
        );

        uint256 totalClaimed =
            _claimWeightedRewards(rewardPoolId, roundId, voters, payoutWeights, leaves, expectedRewards);
        assertEq(totalClaimed, REWARD_POOL_AMOUNT);
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), 0);
    }

    function _surpriseWeightedPayoutLeaves(
        ClusterPayoutOracle oracle,
        uint256 rewardPoolId,
        uint256 contentId,
        uint256 roundId,
        uint256[] memory baseWeights,
        uint16[] memory independenceBps
    ) internal view returns (IClusterPayoutOracle.PayoutWeight[] memory payoutWeights, bytes32[] memory leaves) {
        payoutWeights = new IClusterPayoutOracle.PayoutWeight[](baseWeights.length);
        leaves = new bytes32[](baseWeights.length);
        for (uint256 i = 0; i < baseWeights.length; i++) {
            payoutWeights[i] = _clusterPayoutWeight(rewardPoolId, contentId, roundId, i);
            payoutWeights[i].baseWeight = baseWeights[i];
            payoutWeights[i].independenceBps = independenceBps[i];
            payoutWeights[i].effectiveWeight = (baseWeights[i] * uint256(independenceBps[i])) / 10_000;
            payoutWeights[i].reasonHash = keccak256(abi.encodePacked("surprise-weighted-payout", i));
            leaves[i] = oracle.payoutWeightLeaf(payoutWeights[i]);
        }
    }

    function _sumIndependenceUnits(uint16[] memory independenceBps) internal pure returns (uint32 units) {
        for (uint256 i = 0; i < independenceBps.length; i++) {
            units += independenceBps[i];
        }
    }

    function _sumEffectiveWeights(IClusterPayoutOracle.PayoutWeight[] memory payoutWeights)
        internal
        pure
        returns (uint256 total)
    {
        for (uint256 i = 0; i < payoutWeights.length; i++) {
            total += payoutWeights[i].effectiveWeight;
        }
    }

    function _claimWeightedRewards(
        uint256 rewardPoolId,
        uint256 roundId,
        address[] memory voters,
        IClusterPayoutOracle.PayoutWeight[] memory payoutWeights,
        bytes32[] memory leaves,
        uint256[] memory expectedRewards
    ) internal returns (uint256 totalClaimed) {
        for (uint256 i = 0; i < voters.length; i++) {
            bytes32[] memory proof = _merkleProof(leaves, leaves[i]);
            assertEq(
                rewardPoolEscrow.claimableQuestionRewardWithPayoutWeight(
                    rewardPoolId, roundId, voters[i], payoutWeights[i], proof
                ),
                expectedRewards[i],
                "claimable weighted reward"
            );

            vm.prank(voters[i]);
            uint256 claimed = rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId, payoutWeights[i], proof);
            assertEq(claimed, expectedRewards[i], "claimed weighted reward");
            totalClaimed += claimed;
        }
    }

    function testClusterRewardPoolSkipsRawIneligibleRoundWithoutOracleSnapshot() public {
        _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 rewardPoolId = _createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1);

        uint256 roundId = _settleRoundWith(_ineligibleVoters(), contentId, _directions(true, true, false));

        (uint256 skipped, uint256 nextRoundToEvaluate) = rewardPoolEscrow.advanceQualificationCursor(rewardPoolId, 1);
        assertEq(skipped, 1);
        assertEq(nextRoundToEvaluate, roundId + 1);
    }

    function testClusterRewardPoolRefundsRawIneligibleRoundAfterCursorAdvanceWithoutOracleSnapshot() public {
        _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 expiresAt = block.timestamp + EPOCH_DURATION + 10;
        uint256 rewardPoolId = _createRewardPoolWithExpiry(contentId, REWARD_POOL_AMOUNT, 3, 1, expiresAt);

        _settleRoundWith(_ineligibleVoters(), contentId, _directions(true, true, false));

        vm.warp(expiresAt + 1);
        vm.expectRevert(QuestionRewardPoolEscrow.RewardPoolCursorNeedsAdvance.selector);
        rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId);

        (uint256 skipped,) = rewardPoolEscrow.advanceQualificationCursor(rewardPoolId, 1);
        assertEq(skipped, 1);

        uint256 funderBalanceBefore = usdc.balanceOf(funder);
        uint256 refund = rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId);
        assertEq(refund, REWARD_POOL_AMOUNT);
        assertEq(usdc.balanceOf(funder), funderBalanceBefore + refund);
    }

    function testClusterRewardPoolKeepsRawEligibleRoundPendingWithoutOracleSnapshot() public {
        ClusterPayoutOracle oracle = _enableClusterPayoutOracle();
        uint256 contentId = _submitQuestion("");
        uint256 expiresAt = block.timestamp + EPOCH_DURATION + 10;
        uint256 rewardPoolId = _createRewardPoolWithExpiry(contentId, REWARD_POOL_AMOUNT, 3, 1, expiresAt);

        uint256 roundId = _settleRoundWith(_threeVoters(), contentId, _directions(true, true, false));

        (uint256 skipped, uint256 nextRoundToEvaluate) = rewardPoolEscrow.advanceQualificationCursor(rewardPoolId, 1);
        assertEq(skipped, 0);
        assertEq(nextRoundToEvaluate, roundId);

        vm.warp(expiresAt + 1);
        vm.expectRevert(QuestionRewardPoolEscrow.RewardPoolCursorNeedsAdvance.selector);
        rewardPoolEscrow.refundExpiredRewardPool(rewardPoolId);

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
        vm.prank(voter1);
        uint256 reward = rewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId, payoutWeight, proof);
        assertGt(reward, 0);
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
        contentIds[0] = _submitQuestionWithContext("https://example.com/bundle-a", "bundle-a");
        contentIds[1] = _submitQuestionWithContext("https://example.com/bundle-b", "bundle-b");
        uint256 bundleId = 1;
        uint8 rewardAsset = REWARD_ASSET_LREP;
        uint256 bountyClosesAt = block.timestamp + 30 days;

        vm.prank(submitter);
        lrepToken.approve(address(rewardPoolEscrow), REWARD_POOL_AMOUNT);

        vm.prank(address(registry));
        rewardPoolEscrow.createSubmissionBundleFromRegistry(
            bundleId, contentIds, submitter, rewardAsset, REWARD_POOL_AMOUNT, 3, 1, bountyClosesAt, 30 days, 30 days, 0
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
        vm.expectRevert("Bounty window required");
        rewardPoolEscrow.createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 1, 0, 0, 0);
        vm.stopPrank();
    }

    function testRewardPoolAmountMustCoverEachRequiredRound() public {
        uint256 contentId = _submitQuestion("");

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), 1);
        vm.expectRevert("Amount too small");
        rewardPoolEscrow.createRewardPool(contentId, 1, 3, 2, block.timestamp + 30 days, 30 days, 0);
        vm.stopPrank();
    }

    function testRewardPoolRejectsTooManyRequiredRounds() public {
        uint256 contentId = _submitQuestion("");

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), REWARD_POOL_AMOUNT);
        vm.expectRevert("Too many rounds");
        rewardPoolEscrow.createRewardPool(contentId, REWARD_POOL_AMOUNT, 3, 17, block.timestamp + 30 days, 30 days, 0);
        vm.stopPrank();
    }

    function testRewardPoolAmountMustCoverMaxVotersForEachRequiredRound() public {
        uint256 contentId = _submitQuestion("");

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), 199);
        vm.expectRevert("Amount too small");
        rewardPoolEscrow.createRewardPool(contentId, 199, 3, 1, block.timestamp + 30 days, 30 days, 0);
        vm.stopPrank();
    }

    function testRewardPoolAmountMustCoverBpsScaledMaxVotersForRefundablePool() public {
        uint256 contentId = _submitQuestion("");
        uint256 exactAmount = 100 * 10_000;

        vm.startPrank(funder);
        usdc.approve(address(rewardPoolEscrow), exactAmount - 1);
        vm.expectRevert("Amount too small");
        rewardPoolEscrow.createRewardPool(contentId, exactAmount - 1, 3, 1, block.timestamp + 30 days, 30 days, 0);

        usdc.approve(address(rewardPoolEscrow), exactAmount);
        uint256 rewardPoolId =
            rewardPoolEscrow.createRewardPool(contentId, exactAmount, 3, 1, block.timestamp + 30 days, 30 days, 0);
        vm.stopPrank();

        assertGt(rewardPoolId, 0);
    }

    function testStandaloneUsdcRewardPoolAllowsFunderWithoutRaterIdentity() public {
        uint256 contentId = _submitQuestion("");
        address unverifiedFunder = address(0xB0B);
        usdc.mint(unverifiedFunder, REWARD_POOL_AMOUNT);

        vm.startPrank(unverifiedFunder);
        usdc.approve(address(rewardPoolEscrow), REWARD_POOL_AMOUNT);
        uint256 rewardPoolId = rewardPoolEscrow.createRewardPool(
            contentId, REWARD_POOL_AMOUNT, 3, 1, block.timestamp + 30 days, 30 days, 0
        );
        vm.stopPrank();
        assertGt(rewardPoolId, 0);
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), REWARD_POOL_AMOUNT);
    }

    function testAgentWalletQuestionSubmissionFundsEscrowFromSigningWallet() public {
        address agentWallet = _x402AgentWallet();
        string memory contextUrl = "https://example.com/agent-funded-context";
        string memory title = "Which supplier should the agent shortlist?";
        string memory tags = "agents,bounty";
        string[] memory imageUrls = new string[](1);
        imageUrls[0] = _submissionImageUrl("agent-funded-context");
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 3, maxVoters: 200
        });
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = ContentRegistry.SubmissionRewardTerms({
            asset: REWARD_ASSET_USDC,
            amount: REWARD_POOL_AMOUNT,
            requiredVoters: 3,
            requiredSettledRounds: 1,
            bountyStartBy: block.timestamp + 30 days,
            bountyWindowSeconds: 30 days,
            feedbackWindowSeconds: 30 days,
            bountyEligibility: 0
        });
        bytes32 salt = keccak256("agent-wallet-usdc-submission-bounty");
        activeTlockContentRegistry = registry;

        vm.prank(submitter);
        raterIdentityRegistry.setDelegate(agentWallet);
        usdc.mint(agentWallet, REWARD_POOL_AMOUNT);

        bytes32 submissionKey =
            _questionSubmissionKey(contextUrl, imageUrls, "", title, tags, CATEGORY_ID, _emptySubmissionDetails());
        bytes32 revealCommitment = _questionRevealCommitment(
            submissionKey,
            _submissionMediaHash(imageUrls, ""),
            title,
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
            tags,
            CATEGORY_ID,
            _emptySubmissionDetails(),
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
        address agentWallet = _x402AgentWallet();
        uint256 nextContentIdBefore = registry.nextContentId();
        uint256 escrowBalanceBefore = usdc.balanceOf(address(rewardPoolEscrow));

        (uint256 contentId,) = _submitAgentQuestionWithUsdcReward(agentWallet, "agent-undelegated-no-voter-id");

        assertEq(contentId, nextContentIdBefore);
        assertEq(registry.getSubmitterIdentity(contentId), agentWallet);
        assertEq(registry.contentSubmitterIdentityKey(contentId), raterIdentityRegistry.addressIdentityKey(agentWallet));
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), escrowBalanceBefore + REWARD_POOL_AMOUNT);
    }

    function testX402QuestionSubmissionAllowsOpenSubmitter() public {
        address agentWallet = _x402AgentWallet();
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
            question.tags,
            CATEGORY_ID,
            _emptySubmissionDetails(),
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
        address agentWallet = _x402AgentWallet();
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
            question.tags,
            CATEGORY_ID,
            _emptySubmissionDetails(),
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
        address agentWallet = _x402AgentWallet();
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
            question.tags,
            CATEGORY_ID,
            _emptySubmissionDetails(),
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
        address agentWallet = _x402AgentWallet();
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
                            address(lrepToken),
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
            question.tags,
            CATEGORY_ID,
            _emptySubmissionDetails(),
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

    function testX402QuestionSubmitterOwnerCanRefreshEscrowAfterRegistryRotation() public {
        address agentWallet = _x402AgentWallet();
        X402TestQuestion memory question = _x402TestQuestion();
        QuestionRewardPoolEscrow replacementEscrow = _deployReplacementQuestionRewardPoolEscrow();

        vm.startPrank(owner);
        registry.pause();
        registry.setQuestionRewardPoolEscrow(address(replacementEscrow));
        registry.unpause();
        vm.expectEmit(true, true, false, false, address(x402QuestionSubmitter));
        emit X402QuestionSubmitter.QuestionRewardPoolEscrowUpdated(
            address(rewardPoolEscrow), address(replacementEscrow)
        );
        x402QuestionSubmitter.setQuestionRewardPoolEscrow(address(replacementEscrow));
        vm.stopPrank();

        Eip3009Authorization memory authorization = _x402Authorization(agentWallet, question);
        usdc.mint(agentWallet, question.rewardTerms.amount);
        uint256 replacementEscrowBalanceBefore = usdc.balanceOf(address(replacementEscrow));
        uint256 oldEscrowBalanceBefore = usdc.balanceOf(address(rewardPoolEscrow));

        _reserveX402Question(agentWallet, question);
        vm.warp(block.timestamp + 1);

        uint256 contentId = x402QuestionSubmitter.submitQuestionWithX402Payment(
            question.contextUrl,
            question.imageUrls,
            "",
            question.title,
            question.tags,
            CATEGORY_ID,
            _emptySubmissionDetails(),
            question.salt,
            question.rewardTerms,
            question.roundConfig,
            question.spec,
            authorization
        );

        assertTrue(usdc.authorizationState(agentWallet, authorization.nonce));
        assertEq(x402QuestionSubmitter.questionRewardPoolEscrow(), address(replacementEscrow));
        assertEq(registry.nextContentId(), contentId + 1);
        assertEq(
            usdc.balanceOf(address(replacementEscrow)), replacementEscrowBalanceBefore + question.rewardTerms.amount
        );
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), oldEscrowBalanceBefore);
    }

    function testX402QuestionSubmitterRefreshRequiresOwner() public {
        QuestionRewardPoolEscrow replacementEscrow = _deployReplacementQuestionRewardPoolEscrow();

        vm.startPrank(owner);
        registry.pause();
        registry.setQuestionRewardPoolEscrow(address(replacementEscrow));
        registry.unpause();
        vm.stopPrank();

        vm.prank(submitter);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, submitter));
        x402QuestionSubmitter.setQuestionRewardPoolEscrow(address(replacementEscrow));

        assertEq(x402QuestionSubmitter.questionRewardPoolEscrow(), address(rewardPoolEscrow));
    }

    function testX402QuestionSubmitterRefreshRejectsUnadoptedEscrow() public {
        QuestionRewardPoolEscrow replacementEscrow = _deployReplacementQuestionRewardPoolEscrow();

        vm.prank(owner);
        vm.expectRevert("Stale escrow");
        x402QuestionSubmitter.setQuestionRewardPoolEscrow(address(replacementEscrow));

        assertEq(x402QuestionSubmitter.questionRewardPoolEscrow(), address(rewardPoolEscrow));
    }

    function testX402QuestionSubmissionRejectsOldEscrowNonceAfterRefreshBeforeUsdcAuthorization() public {
        address agentWallet = _x402AgentWallet();
        X402TestQuestion memory question = _x402TestQuestion();
        Eip3009Authorization memory staleAuthorization = _x402Authorization(agentWallet, question);
        QuestionRewardPoolEscrow replacementEscrow = _deployReplacementQuestionRewardPoolEscrow();

        vm.startPrank(owner);
        registry.pause();
        registry.setQuestionRewardPoolEscrow(address(replacementEscrow));
        registry.unpause();
        x402QuestionSubmitter.setQuestionRewardPoolEscrow(address(replacementEscrow));
        vm.stopPrank();

        usdc.mint(agentWallet, question.rewardTerms.amount);
        uint256 replacementEscrowBalanceBefore = usdc.balanceOf(address(replacementEscrow));
        uint256 agentBalanceBefore = usdc.balanceOf(agentWallet);
        uint256 nextContentIdBefore = registry.nextContentId();

        _reserveX402Question(agentWallet, question);
        vm.warp(block.timestamp + 1);

        vm.expectRevert("Bad nonce");
        x402QuestionSubmitter.submitQuestionWithX402Payment(
            question.contextUrl,
            question.imageUrls,
            "",
            question.title,
            question.tags,
            CATEGORY_ID,
            _emptySubmissionDetails(),
            question.salt,
            question.rewardTerms,
            question.roundConfig,
            question.spec,
            staleAuthorization
        );

        assertFalse(usdc.authorizationState(agentWallet, staleAuthorization.nonce));
        assertEq(registry.nextContentId(), nextContentIdBefore);
        assertEq(usdc.balanceOf(address(replacementEscrow)), replacementEscrowBalanceBefore);
        assertEq(usdc.balanceOf(agentWallet), agentBalanceBefore);
    }

    function testX402QuestionSubmissionConsumesUsdcAuthorizationWithDelegatedRaterIdentity() public {
        address agentWallet = _x402AgentWallet();
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
            question.tags,
            CATEGORY_ID,
            _emptySubmissionDetails(),
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

    function testX402QuestionSubmissionRejectsShortReceipt() public {
        address agentWallet = _x402AgentWallet();
        X402TestQuestion memory question = _x402TestQuestion();
        Eip3009Authorization memory authorization = _x402Authorization(agentWallet, question);

        usdc.mint(agentWallet, question.rewardTerms.amount);
        uint256 escrowBalanceBefore = usdc.balanceOf(address(rewardPoolEscrow));
        uint256 gatewayBalanceBefore = usdc.balanceOf(address(x402QuestionSubmitter));
        uint256 agentBalanceBefore = usdc.balanceOf(agentWallet);
        uint256 nextContentIdBefore = registry.nextContentId();

        _reserveX402Question(agentWallet, question);
        vm.warp(block.timestamp + 1);
        usdc.setAuthorizationTransferShortfall(1);

        vm.expectRevert("Bad token");
        x402QuestionSubmitter.submitQuestionWithX402Payment(
            question.contextUrl,
            question.imageUrls,
            "",
            question.title,
            question.tags,
            CATEGORY_ID,
            _emptySubmissionDetails(),
            question.salt,
            question.rewardTerms,
            question.roundConfig,
            question.spec,
            authorization
        );

        assertFalse(usdc.authorizationState(agentWallet, authorization.nonce));
        assertEq(registry.nextContentId(), nextContentIdBefore);
        assertEq(usdc.balanceOf(address(rewardPoolEscrow)), escrowBalanceBefore);
        assertEq(usdc.balanceOf(address(x402QuestionSubmitter)), gatewayBalanceBefore);
        assertEq(usdc.balanceOf(agentWallet), agentBalanceBefore);
    }

    function testDelegatedAgentSubmitterHolderCannotClaimQuestionReward() public {
        address agentWallet = _x402AgentWallet();
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
        contentIds[0] = _submitQuestionWithContext("https://example.com/bundle-a", "bundle-a");
        contentIds[1] = _submitQuestionWithContext("https://example.com/bundle-b", "bundle-b");
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
        if (asset == REWARD_ASSET_LREP) {
            lrepToken.approve(address(rewardPoolEscrow), amount);
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
            30 days,
            30 days,
            0
        );
    }

    function _createSubmissionBundleWithEligibility(
        uint256[] memory contentIds,
        address bundleFunder,
        uint8 asset,
        uint256 amount,
        uint256 requiredCompleters,
        uint8 bountyEligibility
    ) internal returns (uint256 bundleId) {
        bundleId = 1;
        vm.startPrank(bundleFunder);
        if (asset == REWARD_ASSET_LREP) {
            lrepToken.approve(address(rewardPoolEscrow), amount);
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
            1,
            bountyClosesAt,
            30 days,
            30 days,
            bountyEligibility
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
        if (asset == REWARD_ASSET_LREP) {
            lrepToken.approve(address(rewardPoolEscrow), amount);
        } else {
            usdc.approve(address(rewardPoolEscrow), amount);
        }
        vm.stopPrank();

        vm.prank(address(registry));
        rewardPoolEscrow.createSubmissionBundleFromRegistry(
            bundleId,
            contentIds,
            bundleFunder,
            asset,
            amount,
            requiredCompleters,
            1,
            bountyClosesAt,
            bountyClosesAt - block.timestamp,
            bountyClosesAt - block.timestamp,
            0
        );
    }

    function _registerTestVoter(address voter) internal {
        vm.startPrank(owner);
        raterIdentityRegistry.setHolder(voter);
        lrepToken.mint(voter, 10_000e6);
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
                    lrepToken: lrepToken,
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
        mediaUrl = _submissionImageUrl(mediaUrl);
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
            contextUrl,
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
        mediaUrl = _submissionImageUrl(mediaUrl);
        string[] memory imageUrls = new string[](1);
        imageUrls[0] = mediaUrl;
        activeTlockContentRegistry = registry;
        bytes32 salt = keccak256(
            abi.encode(contextUrl, mediaUrl, QUESTION, DESCRIPTION, TAGS, CATEGORY_ID, submitter, block.timestamp)
        );

        bytes32 submissionKey =
            _questionSubmissionKey(contextUrl, imageUrls, "", QUESTION, TAGS, CATEGORY_ID, _emptySubmissionDetails());
        uint256 rewardAmount = _defaultSubmissionRewardAmount(registry);
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = ContentRegistry.SubmissionRewardTerms({
            asset: DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            amount: rewardAmount,
            requiredVoters: roundConfig.minVoters,
            requiredSettledRounds: DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
            bountyStartBy: DEFAULT_SUBMISSION_REWARD_EXPIRES_AT,
            bountyWindowSeconds: DEFAULT_SUBMISSION_REWARD_EXPIRES_AT,
            feedbackWindowSeconds: DEFAULT_SUBMISSION_REWARD_EXPIRES_AT,
            bountyEligibility: 0
        });
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

        vm.startPrank(submitter);
        lrepToken.approve(address(rewardPoolEscrow), rewardAmount);
        registry.reserveSubmission(revealCommitment);
        vm.warp(block.timestamp + 1);
        contentId = registry.submitQuestionWithRewardAndRoundConfig(
            contextUrl,
            imageUrls,
            "",
            QUESTION,
            TAGS,
            CATEGORY_ID,
            _emptySubmissionDetails(),
            salt,
            rewardTerms,
            roundConfig,
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function _x402TestQuestion() internal view returns (X402TestQuestion memory question) {
        question.contextUrl = "https://example.com/x402-agent-question";
        question.title = "Should the agent proceed with this supplier?";
        question.tags = "agents,bounty";
        question.imageUrls = new string[](1);
        question.imageUrls[0] = _submissionImageUrl("x402-agent-question");
        question.roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 3, maxVoters: 200
        });
        question.rewardTerms = ContentRegistry.SubmissionRewardTerms({
            asset: REWARD_ASSET_USDC,
            amount: REWARD_POOL_AMOUNT,
            requiredVoters: 3,
            requiredSettledRounds: 1,
            bountyStartBy: block.timestamp + 30 days,
            bountyWindowSeconds: 30 days,
            feedbackWindowSeconds: 30 days,
            bountyEligibility: 0
        });
        question.spec = ContentRegistry.QuestionSpecCommitment({
            questionMetadataHash: keccak256("x402-question-metadata"), resultSpecHash: keccak256("x402-result-spec")
        });
        question.salt = keccak256("x402-usdc-no-voter-id");
    }

    function _authorizedRewardPoolParams(uint256 contentId)
        internal
        view
        returns (AuthorizedRewardPoolParams memory params)
    {
        params = AuthorizedRewardPoolParams({
            contentId: contentId,
            amount: REWARD_POOL_AMOUNT,
            requiredVoters: 3,
            requiredSettledRounds: 1,
            bountyStartBy: block.timestamp + 30 days,
            bountyWindowSeconds: 30 days,
            feedbackWindowSeconds: 30 days,
            bountyEligibility: 0,
            bountyKind: 0,
            relatedRoundId: 0,
            reasonHash: bytes32(0)
        });
    }

    function _rewardPoolAuthorization(address payer, AuthorizedRewardPoolParams memory params)
        internal
        view
        returns (Eip3009Authorization memory authorization)
    {
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 30 minutes;
        authorization = Eip3009Authorization({
            from: payer,
            to: address(rewardPoolEscrow),
            value: params.amount,
            validAfter: validAfter,
            validBefore: validBefore,
            nonce: rewardPoolEscrow.computeRewardPoolAuthorizationNonce(params, payer, validAfter, validBefore),
            v: 27,
            r: bytes32(0),
            s: bytes32(0)
        });
        _signAuthorization(authorization, FUNDER_KEY);
    }

    function _signAuthorization(Eip3009Authorization memory authorization, uint256 signerKey) internal view {
        (authorization.v, authorization.r, authorization.s) = vm.sign(
            signerKey,
            usdc.receiveWithAuthorizationDigest(
                authorization.from,
                authorization.to,
                authorization.value,
                authorization.validAfter,
                authorization.validBefore,
                authorization.nonce
            )
        );
    }

    function _x402AgentWallet() internal pure returns (address) {
        return vm.addr(X402_AGENT_KEY);
    }

    function _deployReplacementQuestionRewardPoolEscrow()
        internal
        returns (QuestionRewardPoolEscrow replacementEscrow)
    {
        replacementEscrow = QuestionRewardPoolEscrow(
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
                            address(votingEngine),
                            address(raterIdentityRegistry)
                        )
                    )
                )
            )
        );
    }

    function _reserveX402Question(address agentWallet, X402TestQuestion memory question)
        internal
        returns (bytes32 revealCommitment)
    {
        bytes32 submissionKey = _questionSubmissionKey(
            question.contextUrl,
            question.imageUrls,
            "",
            question.title,
            question.tags,
            CATEGORY_ID,
            _emptySubmissionDetails()
        );
        revealCommitment = _questionRevealCommitment(
            submissionKey,
            _submissionMediaHash(question.imageUrls, ""),
            question.title,
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
            url: question.contextUrl, title: question.title, tags: question.tags, categoryId: CATEGORY_ID
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
                _emptySubmissionDetails(),
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
        _signAuthorization(authorization, X402_AGENT_KEY);
    }

    function _submitAgentQuestionWithUsdcReward(address agentWallet, string memory path)
        internal
        returns (uint256 contentId, uint256 rewardPoolId)
    {
        string memory contextUrl = string(abi.encodePacked("https://example.com/", path));
        string[] memory imageUrls = new string[](1);
        imageUrls[0] = _submissionImageUrl(path);
        RoundLib.RoundConfig memory roundConfig = RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION), maxDuration: uint32(7 days), minVoters: 3, maxVoters: 200
        });
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = ContentRegistry.SubmissionRewardTerms({
            asset: REWARD_ASSET_USDC,
            amount: REWARD_POOL_AMOUNT,
            requiredVoters: 3,
            requiredSettledRounds: 1,
            bountyStartBy: block.timestamp + 30 days,
            bountyWindowSeconds: 30 days,
            feedbackWindowSeconds: 30 days,
            bountyEligibility: 0
        });
        bytes32 salt = keccak256(abi.encodePacked(path, agentWallet));
        activeTlockContentRegistry = registry;

        usdc.mint(agentWallet, rewardTerms.amount);
        bytes32 submissionKey =
            _questionSubmissionKey(contextUrl, imageUrls, "", QUESTION, TAGS, CATEGORY_ID, _emptySubmissionDetails());
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
            TAGS,
            CATEGORY_ID,
            _emptySubmissionDetails(),
            salt,
            rewardTerms,
            roundConfig,
            _defaultQuestionSpec()
        );
        rewardPoolId = contentId;
        vm.stopPrank();
    }

    function _expectSelfVoteCommitRevert(address voter, uint256 contentId, bytes32 salt) internal {
        salt;
        vm.expectRevert(RoundVotingEngine.SelfVote.selector);
        vm.prank(voter);
        votingEngine.openRound(contentId);
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
        uint256 windowSeconds = expiresAt == 0 ? 0 : expiresAt - block.timestamp;
        rewardPoolId = rewardPoolEscrow.createRewardPool(
            contentId, amount, requiredVoters, requiredSettledRounds, expiresAt, windowSeconds, 0
        );
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
        oracle.setOracleConfig(1 hours, 5e6, address(this));
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), address(rewardPoolEscrow));
        vm.prank(owner);
        protocolConfig.setClusterPayoutOracle(address(oracle));
    }

    function _newEligibleClusterPayoutOracle() internal returns (ClusterPayoutOracle oracle) {
        MockQuestionRewardOracleFrontendRegistry oracleFrontendRegistry = new MockQuestionRewardOracleFrontendRegistry();
        oracleFrontendRegistry.setEligible(address(this), true);
        oracle = new ClusterPayoutOracle(address(this), address(oracleFrontendRegistry), address(usdc));
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
            "ipfs://epoch",
            _questionEpochSources(rewardPoolId, contentId, roundId)
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
                artifactHash: keccak256("epoch-artifact"),
                artifactURI: "ipfs://round"
            })
        );
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(1, rewardPoolId, contentId, roundId);
        ClusterPayoutOracle.RoundPayoutProposal memory proposal = oracle.roundPayoutProposal(snapshotKey);
        vm.warp(uint256(proposal.proposedAt) + uint256(oracle.challengeWindow()) + 1);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);
    }

    function _finalizeClusterRoundPayoutSnapshotWithRoot(
        ClusterPayoutOracle oracle,
        uint256 rewardPoolId,
        uint256 contentId,
        uint256 roundId,
        uint64 correlationEpochId,
        uint32 rawEligibleVoters,
        uint32 effectiveParticipantUnits,
        uint256 totalClaimWeight,
        bytes32 weightRoot
    ) internal {
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
                artifactHash: keccak256("epoch-artifact"),
                artifactURI: "ipfs://round"
            })
        );
        bytes32 snapshotKey = oracle.roundPayoutSnapshotKey(1, rewardPoolId, contentId, roundId);
        ClusterPayoutOracle.RoundPayoutProposal memory proposal = oracle.roundPayoutProposal(snapshotKey);
        vm.warp(uint256(proposal.proposedAt) + uint256(oracle.challengeWindow()) + 1);
        oracle.finalizeRoundPayoutSnapshot(snapshotKey);
    }

    function _clusterPayoutWeight(uint256 rewardPoolId, uint256 contentId, uint256 roundId, uint256 commitIndex)
        internal
        view
        returns (IClusterPayoutOracle.PayoutWeight memory payoutWeight)
    {
        bytes32 commitKey = votingEngine.getRoundCommitKey(contentId, roundId, commitIndex);
        uint256 baseWeight = 10_000;
        payoutWeight = IClusterPayoutOracle.PayoutWeight({
            domain: 1,
            rewardPoolId: rewardPoolId,
            contentId: contentId,
            roundId: roundId,
            commitKey: commitKey,
            identityKey: _commitIdentityKey(votingEngine, contentId, roundId, commitKey),
            account: _commitIdentityHolder(votingEngine, contentId, roundId, commitKey),
            baseWeight: baseWeight,
            independenceBps: 10_000,
            effectiveWeight: baseWeight,
            reasonHash: keccak256("cluster-payout")
        });
    }

    function _merkleRoot(bytes32[] memory leaves) internal pure returns (bytes32) {
        bytes32[] memory level = _sortedLeaves(leaves);
        while (level.length > 1) {
            level = _nextMerkleLevel(level);
        }
        return level.length == 0 ? bytes32(0) : level[0];
    }

    function _merkleProof(bytes32[] memory leaves, bytes32 leaf) internal pure returns (bytes32[] memory proof) {
        bytes32[] memory level = _sortedLeaves(leaves);
        uint256 leafIndex = _findLeafIndex(level, leaf);
        proof = new bytes32[](_merkleDepth(level.length));
        uint256 proofIndex;

        while (level.length > 1) {
            uint256 siblingIndex = leafIndex % 2 == 0 ? leafIndex + 1 : leafIndex - 1;
            proof[proofIndex++] = siblingIndex < level.length ? level[siblingIndex] : level[leafIndex];
            leafIndex = leafIndex / 2;
            level = _nextMerkleLevel(level);
        }
    }

    function _sortedLeaves(bytes32[] memory leaves) internal pure returns (bytes32[] memory sorted) {
        sorted = new bytes32[](leaves.length);
        for (uint256 i = 0; i < leaves.length; i++) {
            sorted[i] = leaves[i];
        }
        for (uint256 i = 0; i < sorted.length; i++) {
            for (uint256 j = i + 1; j < sorted.length; j++) {
                if (uint256(sorted[j]) < uint256(sorted[i])) {
                    bytes32 current = sorted[i];
                    sorted[i] = sorted[j];
                    sorted[j] = current;
                }
            }
        }
    }

    function _nextMerkleLevel(bytes32[] memory level) internal pure returns (bytes32[] memory next) {
        next = new bytes32[]((level.length + 1) / 2);
        for (uint256 i = 0; i < level.length; i += 2) {
            bytes32 right = i + 1 < level.length ? level[i + 1] : level[i];
            next[i / 2] = _hashSortedPair(level[i], right);
        }
    }

    function _hashSortedPair(bytes32 left, bytes32 right) internal pure returns (bytes32) {
        return
            uint256(left) <= uint256(right)
                ? keccak256(bytes.concat(left, right))
                : keccak256(bytes.concat(right, left));
    }

    function _findLeafIndex(bytes32[] memory level, bytes32 leaf) internal pure returns (uint256) {
        for (uint256 i = 0; i < level.length; i++) {
            if (level[i] == leaf) return i;
        }
        revert("Leaf not found");
    }

    function _merkleDepth(uint256 leafCount) internal pure returns (uint256 depth) {
        while (leafCount > 1) {
            leafCount = (leafCount + 1) / 2;
            depth++;
        }
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
        vm.stopPrank();

        vm.prank(address(registry));
        rewardPoolId = rewardPoolEscrow.createSubmissionRewardPoolFromRegistry(
            contentId,
            funder,
            address(0),
            REWARD_ASSET_USDC,
            amount,
            requiredVoters,
            requiredSettledRounds,
            block.timestamp + 30 days,
            30 days,
            0,
            bountyEligibility
        );
    }

    function _questionEpochSources(uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        internal
        pure
        returns (IClusterPayoutOracle.CorrelationEpochSourceRef[] memory sources)
    {
        sources = new IClusterPayoutOracle.CorrelationEpochSourceRef[](1);
        sources[0] = IClusterPayoutOracle.CorrelationEpochSourceRef({
            domain: 1, rewardPoolId: rewardPoolId, contentId: contentId, roundId: roundId
        });
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

        _settleAfterRbtsSeed(votingEngine, contentId, roundId);
    }

    function _commitPrediction(address voter, uint256 contentId, uint16 predictedRatingBps, uint256 stake, bytes32 salt)
        internal
        returns (bytes32 commitKey)
    {
        _openRoundForTest(votingEngine, contentId, voter);
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
        lrepToken.approve(address(votingEngine), stake);
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

    function _commitTestVoteTargetingRevealableAfter(
        address voter,
        uint256 contentId,
        bool isUp,
        uint256 revealableAfter,
        bytes32 salt
    ) internal returns (bytes32 commitKey) {
        _openRoundForTest(votingEngine, contentId, voter);
        uint256 roundId = votingEngine.currentRoundId(contentId);
        if (roundId == 0) {
            roundId = _defaultTestCommitRoundId(contentId);
        }
        uint16 referenceRatingBps = _currentRatingReferenceBps(contentId);
        uint64 targetRound = _tlockTargetRoundAt(revealableAfter);
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes memory ciphertext = _testCiphertext(isUp, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = TlockVoteLib.buildExpectedRbtsCommitHash(
            isUp, 5_000, salt, voter, contentId, roundId, referenceRatingBps, targetRound, drandChainHash, ciphertext
        );

        vm.startPrank(voter);
        lrepToken.approve(address(votingEngine), STAKE);
        votingEngine.commitVote(
            contentId,
            _roundContext(roundId, referenceRatingBps),
            targetRound,
            drandChainHash,
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();

        return _commitKey(voter, commitHash);
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
                    lrepToken: lrepToken,
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
        _settleAfterRbtsSeed(votingEngine, contentId, roundId);
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
                    lrepToken: lrepToken,
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
                    lrepToken: lrepToken,
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
        _settleAfterRbtsSeed(votingEngine, contentId, roundId);
        assertEq(_roundUnrevealedCleanupRemaining(votingEngine, contentId, roundId), 1);
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
                    lrepToken: lrepToken,
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
                    lrepToken: lrepToken,
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

    function _revealBelowThresholdAndReturnUnrevealedPair(uint256 contentId)
        internal
        returns (
            uint256 roundId,
            bytes32[2] memory lateCommitKeys,
            bytes32[2] memory lateSalts,
            bool[2] memory lateDirections
        )
    {
        address[] memory voters = _fourVoters();
        bool[] memory directions = _directions(true, true, false, true);
        bytes32[] memory salts = new bytes32[](voters.length);
        bytes32[] memory commitKeys = new bytes32[](voters.length);

        for (uint256 i = 0; i < voters.length; i++) {
            salts[i] = keccak256(abi.encodePacked("late-pair", voters[i], contentId, directions[i], i));
            commitKeys[i] = _commitTestVote(
                DirectTestCommitRequest({
                    engine: votingEngine,
                    lrepToken: lrepToken,
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

        for (uint256 i = 0; i < voters.length - 2; i++) {
            votingEngine.revealVoteByCommitKey(contentId, roundId, commitKeys[i], directions[i], 5_000, salts[i]);
        }

        for (uint256 i = 0; i < lateCommitKeys.length; i++) {
            uint256 sourceIndex = i + voters.length - lateCommitKeys.length;
            lateCommitKeys[i] = commitKeys[sourceIndex];
            lateSalts[i] = salts[sourceIndex];
            lateDirections[i] = directions[sourceIndex];
        }
    }

    function _mockSettledRound(uint256 contentId, uint256 roundId, uint16 revealedCount) internal {
        vm.mockCall(
            address(votingEngine),
            abi.encodeWithSignature("roundCore(uint256,uint256)", contentId, roundId),
            abi.encode(
                uint48(block.timestamp),
                RoundLib.RoundState.Settled,
                revealedCount,
                revealedCount,
                uint64(uint256(revealedCount) * STAKE),
                uint48(block.timestamp),
                uint48(block.timestamp)
            )
        );
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
            abi.encodeWithSignature(
                "identityCommitState(uint256,uint256,bytes32,address)", contentId, roundId, identityKey, voter
            ),
            abi.encode(commitKey, bytes32(0), uint256(0))
        );
        vm.mockCall(
            address(votingEngine),
            abi.encodeWithSignature("commitIdentityState(uint256,uint256,bytes32)", contentId, roundId, commitKey),
            abi.encode(identityKey, voter, uint48(block.timestamp), uint8(0), uint8(0), false)
        );
        vm.mockCall(
            address(votingEngine),
            abi.encodeWithSignature("commitRevealData(uint256,uint256,bytes32)", contentId, roundId, commitKey),
            abi.encode(bytes32(0), uint64(0), bytes32(0), uint48(block.timestamp), true, uint64(STAKE))
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
        lrepToken.approve(address(frontendRegistry), frontendRegistry.STAKE_AMOUNT());
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

    function _identityKey(address account) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(account)));
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

    function _roundSnapshotStorageSlot(uint256 rewardPoolId, uint256 roundId) internal pure returns (bytes32) {
        bytes32 rewardPoolSnapshotSlot = keccak256(abi.encode(rewardPoolId, uint256(7)));
        return keccak256(abi.encode(roundId, rewardPoolSnapshotSlot));
    }

    function _assertThresholdReachedAtLe(uint256 contentId, uint256 roundId, uint256 maxThresholdReachedAt)
        internal
        view
    {
        assertLe(
            RoundEngineReadHelpers.round(votingEngine, contentId, roundId).thresholdReachedAt, maxThresholdReachedAt
        );
    }

    function _assertThresholdReachedAtGt(uint256 contentId, uint256 roundId, uint256 minThresholdReachedAt)
        internal
        view
    {
        assertGt(
            RoundEngineReadHelpers.round(votingEngine, contentId, roundId).thresholdReachedAt, minThresholdReachedAt
        );
    }

    function _assertThresholdNotReached(uint256 contentId, uint256 roundId) internal view {
        assertEq(RoundEngineReadHelpers.round(votingEngine, contentId, roundId).thresholdReachedAt, 0);
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

        _settleAfterRbtsSeed(votingEngine, contentIds[0], firstRoundId);
        _settleAfterRbtsSeed(votingEngine, contentIds[1], secondRoundId);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[0], firstRoundId);
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

        uint256 firstSettlementReadyAt = _lastCommitRevealableAfter(votingEngine, contentIds[0], firstRoundId)
            + protocolConfig.revealGracePeriod() + 1;
        uint256 secondSettlementReadyAt = _lastCommitRevealableAfter(votingEngine, contentIds[1], secondRoundId)
            + protocolConfig.revealGracePeriod() + 1;
        vm.warp(firstSettlementReadyAt > secondSettlementReadyAt ? firstSettlementReadyAt : secondSettlementReadyAt);

        _settleAfterRbtsSeed(votingEngine, contentIds[0], firstRoundId);
        _settleAfterRbtsSeed(votingEngine, contentIds[1], secondRoundId);
        votingEngine.processUnrevealedVotes(contentIds[0], firstRoundId, 0, 0);
        votingEngine.processUnrevealedVotes(contentIds[1], secondRoundId, 0, 0);
        rewardPoolEscrow.syncBundleQuestionTerminal(contentIds[0], firstRoundId);
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

    function testBundleRefundSyncsUnobservedTerminalRoundSetBeforeSweep() public {
        uint256[] memory contentIds = _submitBundleQuestions();
        uint256 bundleId = _createSubmissionBundle(contentIds, funder, REWARD_ASSET_USDC, REWARD_POOL_AMOUNT, 3);
        uint256 bountyClosesAt = block.timestamp + 30 days;

        vm.startPrank(owner);
        MockQuestionRewardPoolEscrow mockEscrow = new MockQuestionRewardPoolEscrow();
        registry.pause();
        registry.setQuestionRewardPoolEscrow(address(mockEscrow));
        registry.unpause();
        vm.stopPrank();

        address[] memory voters = _threeVoters();
        bool[] memory directions = _directions(true, true, false);
        _settleRoundWithoutBundleSync(voters, contentIds[0], directions);
        _settleRoundWithoutBundleSync(voters, contentIds[1], directions);

        vm.startPrank(owner);
        registry.pause();
        registry.setQuestionRewardPoolEscrow(address(rewardPoolEscrow));
        registry.unpause();
        vm.stopPrank();

        assertEq(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), 0);

        vm.warp(bountyClosesAt + BUNDLE_REFUND_GRACE + 1);
        assertEq(rewardPoolEscrow.refundQuestionBundleReward(bundleId), 0);
        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 0, voter1), 0);
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
        // verify the refund path catches up the real escrow before sweeping funds.
        _settleRoundWithoutBundleSync(voters, contentIds[0], directions);
        _settleRoundWithoutBundleSync(voters, contentIds[1], directions);

        vm.startPrank(owner);
        registry.pause();
        registry.setQuestionRewardPoolEscrow(address(rewardPoolEscrow));
        registry.unpause();
        vm.stopPrank();

        vm.warp(bountyClosesAt + BUNDLE_REFUND_GRACE + 1);
        assertEq(rewardPoolEscrow.refundQuestionBundleReward(bundleId), 0);
        assertGt(rewardPoolEscrow.claimableQuestionBundleReward(bundleId, 1, voter2), 0);

        vm.warp(block.timestamp + BUNDLE_CLAIM_GRACE + 1);

        uint256 treasuryBalanceBefore = usdc.balanceOf(treasury);
        uint256 refundAmount = rewardPoolEscrow.refundQuestionBundleReward(bundleId);
        assertGt(refundAmount, 0);
        assertEq(usdc.balanceOf(treasury), treasuryBalanceBefore + refundAmount);

        vm.prank(voter2);
        vm.expectRevert("Bundle not claimable");
        rewardPoolEscrow.claimQuestionBundleReward(bundleId, 1);
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
        _settleRoundWith(voters, contentIds[1], directions);

        vm.startPrank(owner);
        registry.pause();
        registry.setQuestionRewardPoolEscrow(address(rewardPoolEscrow));
        registry.unpause();
        vm.stopPrank();

        vm.warp(bountyClosesAt + BUNDLE_REFUND_GRACE + 1);
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
    uint256 public constant STAKE_AMOUNT = 1_000e6;

    mapping(address => bool) internal eligible;

    function setEligible(address frontend, bool value) external {
        eligible[frontend] = value;
    }

    function isEligible(address frontend) external view returns (bool) {
        return eligible[frontend];
    }

    function authorizedSnapshotFrontend(address proposer) external view returns (address frontend) {
        return eligible[proposer] ? proposer : address(0);
    }

    function isAuthorizedSnapshotProposer(address frontend, address proposer) external view returns (bool) {
        return proposer != address(0) && frontend == proposer && eligible[frontend];
    }

    function snapshotProposerForFrontend(address) external pure returns (address proposer) {
        return address(0);
    }
}

contract MockBundleFrontendRegistry {
    struct FrontendInfo {
        address operator;
        bool eligible;
        bool canClaim;
    }

    mapping(address => FrontendInfo) public frontends;

    function setFrontend(address frontend, address operator, bool eligible, bool canClaim) external {
        frontends[frontend] = FrontendInfo({ operator: operator, eligible: eligible, canClaim: canClaim });
    }

    function STAKE_AMOUNT() external pure returns (uint256) {
        return 1;
    }

    function isEligible(address frontend) external view returns (bool) {
        return frontends[frontend].eligible;
    }

    function getFrontendInfo(address frontend)
        external
        view
        returns (address operator, uint256 stakedAmount, bool eligible, bool slashed)
    {
        FrontendInfo memory info = frontends[frontend];
        return (info.operator, 1, info.eligible, false);
    }

    function canClaimFeesForRound(address frontend, uint48) external view returns (bool) {
        return frontends[frontend].canClaim;
    }
}
