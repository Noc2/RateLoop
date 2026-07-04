// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import { RoundRewardDistributor } from "../contracts/RoundRewardDistributor.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { RewardMath } from "../contracts/libraries/RewardMath.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";

contract BannedRewardProtocolConfig {
    address public treasury;
    address public launchDistributionPool;
    address public raterRegistry;

    constructor(address treasury_, address raterRegistry_) {
        treasury = treasury_;
        raterRegistry = raterRegistry_;
    }

    function setRaterRegistry(address value) external {
        raterRegistry = value;
    }
}

contract BannedRewardRegistry {
    mapping(bytes32 => bool) public banned;

    function setBanned(bytes32 identityKey, bool value) external {
        banned[identityKey] = value;
    }

    function isIdentityKeyBanned(bytes32 identityKey) external view returns (bool) {
        return banned[identityKey];
    }
}

contract BannedRewardVotingEngine {
    struct CommitState {
        address voter;
        uint16 predictedUpBps;
        uint16 scoreBps;
        uint256 scoringWeight;
        uint256 rewardWeight;
        uint256 stakeReturned;
        bytes32 identityKey;
    }

    MockERC20 public immutable token;
    BannedRewardProtocolConfig public immutable config;
    BannedRewardRegistry public immutable registry;

    uint256 public totalScoreWeight;
    uint256 public rewardClaimants;
    uint256 public voterPool;
    mapping(bytes32 => CommitState) public commitStates;

    constructor(MockERC20 token_, BannedRewardProtocolConfig config_, BannedRewardRegistry registry_) {
        token = token_;
        config = config_;
        registry = registry_;
    }

    function setRoundState(uint256 totalScoreWeight_, uint256 rewardClaimants_, uint256 voterPool_) external {
        totalScoreWeight = totalScoreWeight_;
        rewardClaimants = rewardClaimants_;
        voterPool = voterPool_;
    }

    function setCommitState(
        bytes32 commitKey,
        address voter,
        uint256 rewardWeight,
        uint256 stakeReturned,
        bytes32 identityKey
    ) external {
        commitStates[commitKey] = CommitState({
            voter: voter,
            predictedUpBps: 8_000,
            scoreBps: 8_000,
            scoringWeight: rewardWeight,
            rewardWeight: rewardWeight,
            stakeReturned: stakeReturned,
            identityKey: identityKey
        });
    }

    function roundCore(uint256, uint256)
        external
        pure
        returns (
            uint48 startTime,
            uint8 state,
            uint16 voteCount,
            uint16 revealedCount,
            uint64 totalStake,
            uint48 thresholdReachedAt,
            uint48 settledAt,
            uint8 upWins
        )
    {
        startTime = 1;
        state = uint8(RoundLib.RoundState.Settled);
        voteCount = 3;
        revealedCount = 3;
        totalStake = 3_000_000;
        thresholdReachedAt = 1;
        settledAt = 1;
        upWins = 1;
    }

    function roundLifecycleState(uint256, uint256)
        external
        pure
        returns (uint256 revealGracePeriod, uint256 lastRevealableAfter, uint256 cleanupRemaining, uint48 readyAt)
    {
        return (0, 0, 0, 0);
    }

    function commitCore(uint256, uint256, bytes32 commitKey)
        external
        view
        returns (
            address voter,
            uint64 stakeAmount,
            address frontend,
            uint48 revealableAfter,
            bool revealed,
            bool isUp,
            uint32 epochIndex
        )
    {
        CommitState memory state = commitStates[commitKey];
        voter = state.voter;
        stakeAmount = 1_000_000;
        frontend = address(0);
        revealableAfter = 0;
        revealed = voter != address(0);
        isUp = true;
        epochIndex = 0;
    }

    function rbtsCommitState(uint256, uint256, bytes32 commitKey)
        external
        view
        returns (
            uint16 predictedUpBps,
            uint16 scoreBps,
            uint256 scoringWeight,
            uint256 rewardWeight,
            uint256 stakeReturned
        )
    {
        CommitState memory state = commitStates[commitKey];
        return (state.predictedUpBps, state.scoreBps, state.scoringWeight, state.rewardWeight, state.stakeReturned);
    }

    function rbtsRoundState(uint256, uint256)
        external
        view
        returns (bool scored, bytes32 scoreSeed, uint256 rewardWeight, uint256 totalRewardClaimants, uint256 pool)
    {
        return (true, bytes32("seed"), totalScoreWeight, rewardClaimants, voterPool);
    }

    function commitIdentityState(uint256, uint256, bytes32 commitKey)
        external
        view
        returns (
            bytes32 identityKey,
            address holder,
            uint48 committedAt,
            uint8 credentialMask,
            uint8 freshCredentialMask,
            bool frontendEligible
        )
    {
        identityKey = commitStates[commitKey].identityKey;
        holder = address(uint160(uint256(identityKey)));
        committedAt = 1;
        credentialMask = 1;
        freshCredentialMask = 0;
        frontendEligible = false;
    }

    function roundRaterRegistrySnapshot(uint256, uint256) external view returns (address) {
        return address(registry);
    }

    function protocolConfig() external view returns (address) {
        return address(config);
    }

    function transferReward(address recipient, uint256 amount) external {
        token.transfer(recipient, amount);
    }
}

contract RoundRewardDistributorHarness is RoundRewardDistributor {
    function exposedClaimRbtsReward(
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        RoundLib.Commit memory commit,
        address rewardRecipient
    ) external {
        _claimRbtsReward(contentId, roundId, commitKey, commit, rewardRecipient);
    }
}

contract RoundRewardDistributorBannedRewardTest is Test {
    MockERC20 internal lrep;
    BannedRewardProtocolConfig internal config;
    BannedRewardRegistry internal banRegistry;
    BannedRewardRegistry internal currentBanRegistry;
    BannedRewardVotingEngine internal engine;
    RoundRewardDistributorHarness internal distributor;

    address internal governance = address(1);
    address internal treasury = address(2);
    address internal voter1 = address(3);
    address internal voter2 = address(4);
    address internal voter3 = address(5);

    bytes32 internal constant COMMIT_1 = keccak256("commit-1");
    bytes32 internal constant COMMIT_2 = keccak256("commit-2");
    bytes32 internal constant COMMIT_3 = keccak256("commit-3");
    bytes32 internal constant IDENTITY_1 = keccak256("identity-1");
    uint256 internal constant CONTENT_ID = 1;
    uint256 internal constant ROUND_ID = 1;

    function setUp() public {
        lrep = new MockERC20("Loop Reputation", "LREP", 6);
        banRegistry = new BannedRewardRegistry();
        currentBanRegistry = new BannedRewardRegistry();
        config = new BannedRewardProtocolConfig(treasury, address(currentBanRegistry));
        engine = new BannedRewardVotingEngine(lrep, config, banRegistry);

        distributor = RoundRewardDistributorHarness(
            address(
                new ERC1967Proxy(
                    address(new RoundRewardDistributorHarness()),
                    abi.encodeCall(
                        RoundRewardDistributor.initialize,
                        (governance, address(lrep), address(engine), address(new BannedRewardRegistry()))
                    )
                )
            )
        );

        engine.setRoundState(600, 3, 300_000);
        engine.setCommitState(COMMIT_1, voter1, 100, 1_000_000, IDENTITY_1);
        engine.setCommitState(COMMIT_2, voter2, 200, 1_000_000, bytes32(uint256(2)));
        engine.setCommitState(COMMIT_3, voter3, 300, 1_000_000, bytes32(uint256(3)));
        lrep.mint(address(engine), 3_300_000);
    }

    function test_BannedPositiveScoreRoutesBlockedRewardToTreasury() public {
        banRegistry.setBanned(IDENTITY_1, true);

        uint256 blockedReward = RewardMath.calculateVoterReward(100, 600, 300_000);
        uint256 voter2Reward = RewardMath.calculateVoterReward(200, 600, 300_000);
        uint256 voter3Reward = 300_000 - blockedReward - voter2Reward;

        distributor.exposedClaimRbtsReward(CONTENT_ID, ROUND_ID, COMMIT_1, _commit(voter1), voter1);
        assertEq(lrep.balanceOf(treasury), blockedReward, "blocked share routed");
        assertEq(lrep.balanceOf(voter1), 1_000_000, "banned voter gets stake only");
        assertEq(distributor.roundVoterRewardClaimedCount(CONTENT_ID, ROUND_ID), 1);
        assertEq(distributor.roundVoterRewardClaimedAmount(CONTENT_ID, ROUND_ID), blockedReward);

        distributor.exposedClaimRbtsReward(CONTENT_ID, ROUND_ID, COMMIT_2, _commit(voter2), voter2);
        assertEq(lrep.balanceOf(voter2), 1_000_000 + voter2Reward);

        distributor.exposedClaimRbtsReward(CONTENT_ID, ROUND_ID, COMMIT_3, _commit(voter3), voter3);
        assertEq(lrep.balanceOf(voter3), 1_000_000 + voter3Reward);
        assertEq(distributor.roundVoterRewardClaimedAmount(CONTENT_ID, ROUND_ID), 300_000);
    }

    function test_BannedLastClaimantRoutesRemainderToTreasury() public {
        bytes32 identity3 = bytes32(uint256(3));
        engine.setRoundState(3, 3, 100);
        engine.setCommitState(COMMIT_1, voter1, 1, 1_000_000, IDENTITY_1);
        engine.setCommitState(COMMIT_2, voter2, 1, 1_000_000, bytes32(uint256(2)));
        engine.setCommitState(COMMIT_3, voter3, 1, 1_000_000, identity3);
        banRegistry.setBanned(identity3, true);

        distributor.exposedClaimRbtsReward(CONTENT_ID, ROUND_ID, COMMIT_1, _commit(voter1), voter1);
        distributor.exposedClaimRbtsReward(CONTENT_ID, ROUND_ID, COMMIT_2, _commit(voter2), voter2);
        distributor.exposedClaimRbtsReward(CONTENT_ID, ROUND_ID, COMMIT_3, _commit(voter3), voter3);

        assertEq(lrep.balanceOf(voter1), 1_000_033, "first voter gets truncated share");
        assertEq(lrep.balanceOf(voter2), 1_000_033, "second voter gets truncated share");
        assertEq(lrep.balanceOf(voter3), 1_000_000, "banned voter gets stake only");
        assertEq(lrep.balanceOf(treasury), 34, "blocked final remainder routed");
        assertEq(distributor.roundVoterRewardClaimedAmount(CONTENT_ID, ROUND_ID), 100);
    }

    function test_ConfiscateBannedRewardCanBeCalledByThirdParty() public {
        banRegistry.setBanned(IDENTITY_1, true);

        uint256 blockedReward = RewardMath.calculateVoterReward(100, 600, 300_000);

        vm.prank(address(0xBEEF));
        distributor.confiscateBannedReward(CONTENT_ID, ROUND_ID, COMMIT_1);

        assertEq(lrep.balanceOf(treasury), blockedReward, "blocked share routed");
        assertEq(lrep.balanceOf(voter1), 1_000_000, "stake returned");
        assertTrue(distributor.rewardCommitClaimed(CONTENT_ID, ROUND_ID, COMMIT_1));
        assertTrue(distributor.rewardClaimed(CONTENT_ID, ROUND_ID, voter1));
        assertEq(distributor.roundVoterRewardClaimedCount(CONTENT_ID, ROUND_ID), 1);
        assertEq(distributor.roundVoterRewardClaimedAmount(CONTENT_ID, ROUND_ID), blockedReward);
        assertTrue(distributor.claimAccountingStarted());
    }

    function test_ConfiscateBannedRewardUsesCurrentRegistryAfterRotation() public {
        currentBanRegistry.setBanned(IDENTITY_1, true);

        uint256 blockedReward = RewardMath.calculateVoterReward(100, 600, 300_000);

        vm.prank(address(0xBEEF));
        distributor.confiscateBannedReward(CONTENT_ID, ROUND_ID, COMMIT_1);

        assertEq(lrep.balanceOf(treasury), blockedReward, "current-registry ban routed");
        assertEq(lrep.balanceOf(voter1), 1_000_000, "stake returned");
        assertTrue(distributor.rewardCommitClaimed(CONTENT_ID, ROUND_ID, COMMIT_1));
    }

    function test_ConfiscateBannedRewardCanBeCalledForStakePayerAddressBan() public {
        banRegistry.setBanned(_addressIdentityKey(voter1), true);

        uint256 blockedReward = RewardMath.calculateVoterReward(100, 600, 300_000);

        vm.prank(address(0xBEEF));
        distributor.confiscateBannedReward(CONTENT_ID, ROUND_ID, COMMIT_1);

        assertEq(lrep.balanceOf(treasury), blockedReward, "stake-payer ban routed");
        assertEq(lrep.balanceOf(voter1), 1_000_000, "stake returned");
        assertTrue(distributor.rewardCommitClaimed(CONTENT_ID, ROUND_ID, COMMIT_1));
    }

    function test_ConfiscateBannedRewardCanBeCalledForCommitHolderAddressBan() public {
        banRegistry.setBanned(_addressIdentityKey(_holderForIdentity(IDENTITY_1)), true);

        uint256 blockedReward = RewardMath.calculateVoterReward(100, 600, 300_000);

        vm.prank(address(0xBEEF));
        distributor.confiscateBannedReward(CONTENT_ID, ROUND_ID, COMMIT_1);

        assertEq(lrep.balanceOf(treasury), blockedReward, "holder ban routed");
        assertEq(lrep.balanceOf(voter1), 1_000_000, "stake returned");
        assertTrue(distributor.rewardCommitClaimed(CONTENT_ID, ROUND_ID, COMMIT_1));
    }

    function test_ConfiscateBannedRewardRejectsUnbannedCommit() public {
        vm.expectRevert(RoundRewardDistributor.RewardNotConfiscatable.selector);
        distributor.confiscateBannedReward(CONTENT_ID, ROUND_ID, COMMIT_1);
    }

    function _addressIdentityKey(address account) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("rateloop.address-identity-v1", account));
    }

    function _holderForIdentity(bytes32 identityKey) internal pure returns (address) {
        return address(uint160(uint256(identityKey)));
    }

    function _commit(address voter) internal pure returns (RoundLib.Commit memory commit) {
        commit.voter = voter;
        commit.stakeAmount = 1_000_000;
        commit.revealed = true;
        commit.isUp = true;
    }
}
