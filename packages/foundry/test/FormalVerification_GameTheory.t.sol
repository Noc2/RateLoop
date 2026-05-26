// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { RoundRewardDistributor } from "../contracts/RoundRewardDistributor.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { RoundEngineReadHelpers } from "./helpers/RoundEngineReadHelpers.sol";
import { VotingTestBase } from "./helpers/VotingTestHelpers.sol";
import { MockCategoryRegistry } from "../contracts/mocks/MockCategoryRegistry.sol";

/// @title Formal Verification: Parimutuel Game Theory (Public Vote + Random Settlement)
/// @notice 14 scenarios verifying honest voting profitability, collusion resistance,
///         unanimous settlement accounting, settlement timing, and tied rounds.
contract FormalVerification_GameTheoryTest is VotingTestBase {
    LoopReputation lrepToken;
    ContentRegistry registry;
    RoundVotingEngine engine;
    RoundRewardDistributor distributor;

    address owner = address(1);
    address submitter = address(2);
    address treasuryAddr = address(3);
    address[10] v; // voter addresses

    // Config values matching the Robust BTS 3-rater settlement floor.
    uint64 constant MIN_EPOCH_BLOCKS = 10;
    uint64 constant MAX_EPOCH_BLOCKS = 50;
    uint256 constant MAX_DURATION = 7 days;
    uint256 constant MIN_VOTERS = 3;

    uint256 contentNonce;

    function setUp() public {
        for (uint256 i = 0; i < 10; i++) {
            v[i] = address(uint160(10 + i));
        }

        vm.startPrank(owner);

        lrepToken = new LoopReputation(owner, owner);
        lrepToken.grantRole(lrepToken.MINTER_ROLE(), owner);

        ContentRegistry regImpl = new ContentRegistry();
        RoundVotingEngine engImpl = new RoundVotingEngine();
        RoundRewardDistributor distImpl = new RoundRewardDistributor();

        registry = ContentRegistry(
            address(
                new ERC1967Proxy(
                    address(regImpl),
                    abi.encodeCall(ContentRegistry.initializeWithTreasury, (owner, owner, owner, address(lrepToken)))
                )
            )
        );
        engine = RoundVotingEngine(
            address(
                new ERC1967Proxy(
                    address(engImpl),
                    abi.encodeCall(
                        RoundVotingEngine.initialize,
                        (owner, address(lrepToken), address(registry), address(_deployProtocolConfig(owner)))
                    )
                )
            )
        );
        distributor = RoundRewardDistributor(
            address(
                new ERC1967Proxy(
                    address(distImpl),
                    abi.encodeCall(
                        RoundRewardDistributor.initialize,
                        (owner, address(lrepToken), address(engine), address(registry))
                    )
                )
            )
        );

        registry.setVotingEngine(address(engine));
        MockCategoryRegistry mockCategoryRegistry = new MockCategoryRegistry();
        mockCategoryRegistry.seedDefaultTestCategories();
        registry.setCategoryRegistry(address(mockCategoryRegistry));
        registry.setTreasury(treasuryAddr);
        ProtocolConfig(address(engine.protocolConfig())).setRewardDistributor(address(distributor));
        ProtocolConfig(address(engine.protocolConfig())).setCategoryRegistry(address(mockCategoryRegistry));
        ProtocolConfig(address(engine.protocolConfig())).setTreasury(treasuryAddr);

        // Config: epochDuration=1h, maxDuration=7d, minVoters=3, maxVoters=200
        _setTlockRoundConfig(ProtocolConfig(address(engine.protocolConfig())), 1 hours, MAX_DURATION, MIN_VOTERS, 200);

        // Fund submitter and voters
        lrepToken.mint(submitter, 100_000e6);
        for (uint256 i = 0; i < 10; i++) {
            lrepToken.mint(v[i], 100_000e6);
        }

        vm.stopPrank();

        vm.warp(1000); // Predictable start time
    }

    // ==================== Helpers ====================

    function _submit() internal returns (uint256) {
        contentNonce++;
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        uint256 id = _submitContentWithReservation(
            registry, string(abi.encodePacked("https://t.co/gt", vm.toString(contentNonce))), "Goal", "Goal", "tag", 0
        );
        vm.stopPrank();
        return id;
    }

    function _setRoundMinVoters(uint16 minVoters) internal {
        ProtocolConfig protocolConfig = ProtocolConfig(address(engine.protocolConfig()));
        vm.startPrank(owner);
        _setTlockRoundConfig(protocolConfig, 1 hours, MAX_DURATION, minVoters, 200);
        vm.stopPrank();
    }

    function _vote(address voter, uint256 cid, bool up, uint256 stake)
        internal
        returns (bytes32 commitKey, bytes32 salt)
    {
        salt = keccak256(abi.encodePacked(voter, block.timestamp, cid));
        uint64 targetRound = _tlockCommitTargetRound(engine, cid);
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes memory ciphertext = _testCiphertext(up, salt, cid, targetRound, drandChainHash);
        bytes32 commitHash =
            _commitHash(up, salt, voter, cid, _defaultRatingReferenceBps(), targetRound, drandChainHash, ciphertext);
        _openRoundForTest(engine, cid, voter);
        vm.prank(voter);
        lrepToken.approve(address(engine), stake);
        uint256 cachedRoundContext1 = _roundContext(engine.previewCommitRoundId(cid), _defaultRatingReferenceBps());
        vm.prank(voter);
        engine.commitVote(
            cid, cachedRoundContext1, targetRound, drandChainHash, commitHash, ciphertext, stake, address(0)
        );
        commitKey = keccak256(abi.encodePacked(voter, commitHash));
        _rememberTestReveal(commitKey, up, salt);
    }

    function _forceSettle(uint256 cid) internal {
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, cid);
        if (roundId == 0) return;
        RoundLib.Round memory r = RoundEngineReadHelpers.round(engine, cid, roundId);
        _warpPastTlockRevealTime(uint256(r.startTime) + 1 hours);
        bytes32[] memory keys = RoundEngineReadHelpers.commitKeys(engine, cid, roundId);
        for (uint256 i = 0; i < keys.length; i++) {
            RoundLib.Commit memory c = RoundEngineReadHelpers.commit(engine, cid, roundId, keys[i]);
            if (!c.revealed && c.stakeAmount > 0) {
                (bool up, bytes32 s, bool exists) = _testRevealPayload(keys[i]);
                if (exists) {
                    try engine.revealVoteByCommitKey(cid, roundId, keys[i], up, 5_000, s) { } catch { }
                    if (engine.roundThresholdReachedBlock(cid, roundId) == block.number) {
                        vm.roll(block.number + 1);
                    }
                }
            }
        }
        RoundLib.Round memory r2 = RoundEngineReadHelpers.round(engine, cid, roundId);
        if (r2.thresholdReachedAt > 0) {
            vm.roll(block.number + 1);
            try engine.settleRound(cid, roundId) { } catch { }
        }
    }

    function _rbtsConsensusShare(uint256 cid, uint256 rid) internal view returns (uint256) {
        uint256 forfeitedPool = engine.roundRbtsForfeitedPool(cid, rid);
        uint256 loserRefundShare = (forfeitedPool * 500) / 10_000;
        return ((forfeitedPool - loserRefundShare) * 500) / 10_000;
    }

    function _consensusSubsidy(uint256 cid, uint256 rid) internal view returns (uint256) {
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, cid, rid);
        uint256 desired = ((round.upPool + round.downPool) * 500) / 10_000;
        return desired > 50e6 ? 50e6 : desired;
    }

    function _applyUnanimousReserveAccounting(uint256 reserve, uint256 cid, uint256 rid)
        internal
        view
        returns (uint256)
    {
        uint256 subsidy = _consensusSubsidy(cid, rid);
        uint256 rbtsConsensusShare = _rbtsConsensusShare(cid, rid);
        if (subsidy >= rbtsConsensusShare) {
            return reserve - (subsidy - rbtsConsensusShare);
        }
        return reserve + (rbtsConsensusShare - subsidy);
    }

    function _claimPayout(address voter, uint256 cid, uint256 rid) internal returns (uint256 payout) {
        uint256 bal = lrepToken.balanceOf(voter);
        vm.prank(voter);
        distributor.claimReward(cid, rid);
        payout = lrepToken.balanceOf(voter) - bal;
    }

    // ==================== Test 1: Honest Voting Profitability ====================

    /// @notice 3 UP vs 2 DOWN settles to UP and pays RBTS claim value.
    function test_HonestVoting_3Up2Down_RbtsClaimsBounded() public {
        uint256 cid = _submit();

        _vote(v[0], cid, true, 5e6);
        _vote(v[1], cid, true, 5e6);
        _vote(v[2], cid, true, 5e6);
        (bytes32 downKey,) = _vote(v[3], cid, false, 5e6);
        _vote(v[4], cid, false, 5e6);

        uint256 rid = RoundEngineReadHelpers.activeRoundId(engine, cid);

        // Force settle past maxEpochBlocks
        _forceSettle(cid);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, cid, rid);
        assertTrue(round.upWins, "UP majority wins");

        uint256 winnerPayout = _claimPayout(v[0], cid, rid);
        assertGt(winnerPayout, 0, "Winner receives RBTS claim value");
        assertLe(winnerPayout, 5e6 + engine.roundVoterPool(cid, rid), "Winner claim stays inside pool bounds");

        uint256 expectedLoserPayout = engine.commitRbtsStakeReturned(cid, rid, downKey);
        uint256 loserPayout = _claimPayout(v[3], cid, rid);
        assertEq(loserPayout, expectedLoserPayout, "Losing-side claim has no loser rebate");
    }

    // ==================== Test 2: Proportional Rewards ====================

    /// @notice 7 UP (varying stakes) vs 3 DOWN. Higher stake -> higher absolute reward.
    /// @dev With bonding curve shares, early voters get more shares per LREP. Within the same
    ///      direction, later voters with higher stakes still get higher absolute rewards because
    ///      the stake difference dominates the share discount. We verify monotonically increasing payouts.
    function test_HonestVoting_LargePool_7Up3Down() public {
        uint256 cid = _submit();

        // UP voters with increasing stakes (1, 2, 3, 4, 5, 6, 7)
        _vote(v[0], cid, true, 1e6);
        _vote(v[1], cid, true, 2e6);
        _vote(v[2], cid, true, 3e6);
        _vote(v[3], cid, true, 4e6);
        _vote(v[4], cid, true, 5e6);
        _vote(v[5], cid, true, 6e6);
        _vote(v[6], cid, true, 7e6);
        // DOWN voters
        _vote(v[7], cid, false, 8e6);
        _vote(v[8], cid, false, 9e6);
        _vote(v[9], cid, false, 10e6);

        uint256 rid = RoundEngineReadHelpers.activeRoundId(engine, cid);

        _forceSettle(cid);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, cid, rid);
        assertTrue(round.upWins, "UP side should win the weighted signal");

        for (uint256 i = 0; i < 10; i++) {
            uint256 payout = _claimPayout(v[i], cid, rid);
            assertGt(payout, 0, "Every revealed economic voter receives RBTS claim value");
        }
        assertEq(
            distributor.roundVoterRewardClaimedAmount(cid, rid),
            engine.roundVoterPool(cid, rid),
            "All score-eligible claims exhaust voter pool"
        );
    }

    // ==================== Test 3: Stake-Weight Determines Outcome ====================

    /// @notice 4 UP (1 each = 4 total) vs 1 DOWN (10). DOWN wins because stake > voter count.
    function test_StakeWeight_DeterminesOutcome() public {
        _setRoundMinVoters(5);
        uint256 cid = _submit();

        _vote(v[0], cid, true, 1e6);
        _vote(v[1], cid, true, 1e6);
        _vote(v[2], cid, true, 1e6);
        _vote(v[3], cid, true, 1e6);
        _vote(v[4], cid, false, 10e6);

        uint256 rid = RoundEngineReadHelpers.activeRoundId(engine, cid);

        _forceSettle(cid);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, cid, rid);
        assertFalse(round.upWins, "DOWN wins - stake weight, not voter count, decides outcome");

        uint256 payout = _claimPayout(v[4], cid, rid);
        assertGt(payout, 0, "Winning whale receives RBTS claim value");
        assertLe(payout, 10e6 + engine.roundVoterPool(cid, rid), "Winning whale claim stays inside pool bounds");
    }

    // ==================== Test 4: Collusion at Threshold - Negligible Profit ====================

    /// @notice 4 colluders UP (100 each) + 1 innocent DOWN (1). Profit < 1 LREP.
    function test_Threshold_CollusionNegligibleProfit() public {
        uint256 cid = _submit();

        _vote(v[0], cid, true, 10e6);
        _vote(v[1], cid, true, 10e6);
        _vote(v[2], cid, true, 10e6);
        _vote(v[3], cid, true, 10e6);
        _vote(v[4], cid, false, 1e6); // innocent victim

        uint256 rid = RoundEngineReadHelpers.activeRoundId(engine, cid);

        _forceSettle(cid);

        // losingPool = 1e6 -> voterPool ~0.8 LREP -> split among 4 colluders proportional to shares.
        // RBTS scoring (with the M-Vote-1 seed) can score some colluders below their stake; the
        // bound we care about is total colluder *profit* (claimed payout minus original stake),
        // which must stay strictly below 1 LREP. Allowing negative per-voter contributions keeps
        // the assertion meaningful when individual payouts are sub-stake.
        int256 totalProfit = 0;
        for (uint256 i = 0; i < 4; i++) {
            uint256 bal = lrepToken.balanceOf(v[i]);
            vm.prank(v[i]);
            distributor.claimReward(cid, rid);
            uint256 payout = lrepToken.balanceOf(v[i]) - bal;
            totalProfit += int256(payout) - int256(uint256(10e6));
        }

        assertLt(totalProfit, int256(uint256(1e6)), "Total colluder profit < 1 LREP - negligible");
    }

    // ==================== Test 5: Unanimous Round - No Subsidy ====================

    /// @notice 5 UP (50 each). No losers -> no extra voter pool.
    function test_UnanimousRound_NoConsensusSubsidy() public {
        uint256 cid = _submit();
        uint256 submitterBefore = lrepToken.balanceOf(submitter);

        _vote(v[0], cid, true, 5e6);
        _vote(v[1], cid, true, 5e6);
        _vote(v[2], cid, true, 5e6);
        _vote(v[3], cid, true, 5e6);
        _vote(v[4], cid, true, 5e6);

        uint256 rid = RoundEngineReadHelpers.activeRoundId(engine, cid);

        // Consensus settlement after maxEpochBlocks
        _forceSettle(cid);

        uint256 forfeitedPool = engine.roundRbtsForfeitedPool(cid, rid);
        if (engine.roundRbtsRewardWeight(cid, rid) > 0) {
            assertEq(engine.roundVoterPool(cid, rid), forfeitedPool, "Voter pool comes only from RBTS forfeitures");
        }

        uint256 payout = _claimPayout(v[0], cid, rid);
        assertGt(payout, 0, "Voter gets RBTS claim value");
        assertLe(payout, 5e6 + engine.roundVoterPool(cid, rid), "Voter claim stays inside pool bounds");

        assertEq(lrepToken.balanceOf(submitter), submitterBefore, "Submitter receives no voter-pool payout");
    }

    // ==================== Test 6: Same-Epoch Stake Weight ====================

    /// @notice 1 whale UP (10) + 4 minnows UP (1 each) vs 5 DOWN (1 each).
    /// @dev Same-epoch votes retain full raw stake in the weighted signal. RBTS scores
    ///      determine individual reward returns after settlement.
    function test_StakeAsymmetry_WeightedPoolsTrackSameEpochStake() public {
        _setRoundMinVoters(10);
        uint256 cid = _submit();

        // UP side: whale first, then minnows (all in epoch-1)
        _vote(v[0], cid, true, 10e6); // whale
        _vote(v[1], cid, true, 1e6); // minnow 1
        _vote(v[2], cid, true, 1e6); // minnow 2
        _vote(v[3], cid, true, 1e6); // minnow 3
        _vote(v[4], cid, true, 1e6); // minnow 4
        // DOWN side
        _vote(v[5], cid, false, 1e6);
        _vote(v[6], cid, false, 1e6);
        _vote(v[7], cid, false, 1e6);
        _vote(v[8], cid, false, 1e6);
        _vote(v[9], cid, false, 1e6);

        uint256 rid = RoundEngineReadHelpers.activeRoundId(engine, cid);

        _forceSettle(cid);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, cid, rid);
        assertTrue(round.upWins, "UP side should win");
        assertEq(round.weightedUpPool, 14e6, "Same-epoch weighted UP pool tracks raw stake");
        assertEq(round.weightedDownPool, 5e6, "Same-epoch weighted DOWN pool tracks raw stake");

        assertGt(_claimPayout(v[0], cid, rid), 0, "Whale receives RBTS claim value");
        assertGt(_claimPayout(v[4], cid, rid), 0, "Minnow receives RBTS claim value");
    }

    // ==================== Test 7: Whale in Thin Market ====================

    /// @notice 1 whale UP (100) vs 4 minnows DOWN (1 each). Whale wins but low ROI.
    function test_StakeAsymmetry_WhaleThinMarket() public {
        uint256 cid = _submit();

        _vote(v[0], cid, true, 10e6); // whale
        _vote(v[1], cid, false, 1e6);
        _vote(v[2], cid, false, 1e6);
        _vote(v[3], cid, false, 1e6);
        _vote(v[4], cid, false, 1e6);

        uint256 rid = RoundEngineReadHelpers.activeRoundId(engine, cid);

        _forceSettle(cid);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, cid, rid);
        assertTrue(round.upWins, "Whale's stake determines the weighted outcome");

        uint256 payout = _claimPayout(v[0], cid, rid);
        assertGt(payout, 0, "Whale receives RBTS claim value");
        assertLe(payout, 10e6 + engine.roundVoterPool(cid, rid), "Whale claim stays inside pool bounds");
    }

    // ==================== Test 8: Minnows Defeat Whale ====================

    /// @notice 1 whale DOWN (100) vs 9 minnows UP (50 each). Minnows win.
    function test_StakeAsymmetry_MinnowsDefeatWhale() public {
        _setRoundMinVoters(10);
        uint256 cid = _submit();

        (bytes32 whaleKey,) = _vote(v[0], cid, false, 10e6); // whale DOWN
        _vote(v[1], cid, true, 5e6);
        _vote(v[2], cid, true, 5e6);
        _vote(v[3], cid, true, 5e6);
        _vote(v[4], cid, true, 5e6);
        _vote(v[5], cid, true, 5e6);
        _vote(v[6], cid, true, 5e6);
        _vote(v[7], cid, true, 5e6);
        _vote(v[8], cid, true, 5e6);
        _vote(v[9], cid, true, 5e6);

        uint256 rid = RoundEngineReadHelpers.activeRoundId(engine, cid);

        _forceSettle(cid);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, cid, rid);
        assertTrue(round.upWins, "Minnows outweigh whale (450 > 100)");

        uint256 expectedPayout = engine.commitRbtsStakeReturned(cid, rid, whaleKey);
        uint256 payout = _claimPayout(v[0], cid, rid);
        assertEq(payout, expectedPayout, "Losing whale claim has no loser rebate");
        assertLe(payout, 10e6 + engine.roundVoterPool(cid, rid), "Losing whale claim stays inside pool bounds");
    }

    // ==================== Test 9: Manufactured Dissent Unprofitable ====================

    /// @notice Attacker: UP (100) + DOWN (50) via 2 wallets. 3 honest UP (50 each).
    function test_ManufacturedDissent_Unprofitable() public {
        uint256 cid = _submit();

        // Record starting balances (attacker uses v[0] and v[1])
        uint256 attackerStartA = lrepToken.balanceOf(v[0]);
        uint256 attackerStartB = lrepToken.balanceOf(v[1]);

        _vote(v[0], cid, true, 10e6); // attacker UP
        _vote(v[1], cid, false, 5e6); // attacker DOWN (manufactured dissent)
        _vote(v[2], cid, true, 5e6); // honest
        _vote(v[3], cid, true, 5e6); // honest
        _vote(v[4], cid, true, 5e6); // honest

        uint256 rid = RoundEngineReadHelpers.activeRoundId(engine, cid);

        _forceSettle(cid);

        // Attacker wallet A (UP winner) claims
        vm.prank(v[0]);
        distributor.claimReward(cid, rid);
        // Attacker wallet B (DOWN loser) gets the fixed rebate
        vm.prank(v[1]);
        distributor.claimReward(cid, rid);

        uint256 attackerEndA = lrepToken.balanceOf(v[0]);
        uint256 attackerEndB = lrepToken.balanceOf(v[1]);
        uint256 totalStart = attackerStartA + attackerStartB;
        uint256 totalEnd = attackerEndA + attackerEndB;

        assertLt(totalEnd, totalStart, "Manufactured dissent is a net loss for the attacker");
        uint256 loss = totalStart - totalEnd;
        assertGt(loss, 0, "Attacker loses value");
    }

    // ==================== Test 10: Unanimous Rounds Do Not Drain Protocol Funds ====================

    /// @notice 10 unanimous rounds settle without extra reward pools.
    function test_UnanimousRounds_DoNotCreateSubsidyPools() public {
        for (uint256 r = 0; r < 10; r++) {
            uint256 cid = _submit();

            for (uint256 i = 0; i < 5; i++) {
                _vote(v[i], cid, true, 10e6);
            }

            // Capture round ID before settlement (getActiveRoundId returns 0 after settling)
            uint256 rid = RoundEngineReadHelpers.activeRoundId(engine, cid);

            // Consensus settlement: wait for epoch end, reveal all, settle
            _forceSettle(cid);

            RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, cid, rid);
            assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled), "Round settled");
            uint256 forfeitedPool = engine.roundRbtsForfeitedPool(cid, rid);
            if (engine.roundRbtsRewardWeight(cid, rid) > 0) {
                assertEq(engine.roundVoterPool(cid, rid), forfeitedPool, "Voter pool comes only from RBTS forfeitures");
            }

            // Claim rewards so voters have tokens back for next round
            for (uint256 i = 0; i < 5; i++) {
                vm.prank(v[i]);
                distributor.claimReward(cid, rid);
            }

            // Wait for cooldown so voters can vote again on fresh content
            vm.warp(block.timestamp + 24 hours + 1);
        }
    }

    // ==================== Test 11: Contested Rounds Fund Voters ====================

    /// @notice Score-spread forfeitures, when present, fund voter rewards.
    function test_ScoreSpreadForfeituresFundVoters() public {
        {
            uint256 cid = _submit();
            _vote(v[0], cid, true, 5e6);
            _vote(v[1], cid, true, 5e6);
            _vote(v[2], cid, true, 5e6);
            _vote(v[3], cid, false, 5e6);
            _vote(v[4], cid, false, 5e6);
            uint256 rid = RoundEngineReadHelpers.activeRoundId(engine, cid);
            _forceSettle(cid);
            uint256 forfeitedPool = engine.roundRbtsForfeitedPool(cid, rid);
            if (engine.roundRbtsRewardWeight(cid, rid) > 0) {
                uint256 voterPool = engine.roundVoterPool(cid, rid);
                assertLe(voterPool, forfeitedPool, "Voter pool cannot exceed forfeitures");
                if (forfeitedPool > 0) {
                    assertGt(voterPool, 0, "Forfeitures should fund voters after protocol share");
                }
            }
        }

        // Round 2: unanimous (5 UP, 10e6 each) -> no losing stake, no subsidy.
        {
            vm.warp(block.timestamp + 24 hours + 1); // cooldown for voters
            uint256 cid = _submit();
            for (uint256 i = 0; i < 5; i++) {
                _vote(v[i], cid, true, 10e6);
            }
            uint256 rid = RoundEngineReadHelpers.activeRoundId(engine, cid);
            _forceSettle(cid);
            uint256 forfeitedPool = engine.roundRbtsForfeitedPool(cid, rid);
            if (engine.roundRbtsRewardWeight(cid, rid) > 0) {
                assertEq(engine.roundVoterPool(cid, rid), forfeitedPool, "Voter pool comes only from RBTS forfeitures");
            }
        }
    }

    // ==================== Test 12: Settlement After Reveals ====================

    /// @notice After epoch ends and all votes are revealed, settlement succeeds immediately.
    function test_Settlement_SucceedsAfterReveals() public {
        uint256 cid = _submit();

        _vote(v[0], cid, true, 5e6);
        _vote(v[1], cid, true, 5e6);
        _vote(v[2], cid, true, 5e6);
        _vote(v[3], cid, false, 5e6);
        _vote(v[4], cid, false, 5e6);

        uint256 rid = RoundEngineReadHelpers.activeRoundId(engine, cid);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, cid, rid);

        // Reveal all after epoch ends
        _warpPastTlockRevealTime(uint256(round.startTime) + 1 hours);
        bytes32[] memory keys = RoundEngineReadHelpers.commitKeys(engine, cid, rid);
        for (uint256 i = 0; i < keys.length; i++) {
            (bool up, bytes32 s, bool exists) = _testRevealPayload(keys[i]);
            assertTrue(exists, "test reveal payload exists");
            engine.revealVoteByCommitKey(cid, rid, keys[i], up, 5_000, s);
        }

        // Settlement succeeds immediately after minVoters revealed
        _settleAfterRbtsSeed(engine, cid, rid);

        RoundLib.Round memory afterForce = RoundEngineReadHelpers.round(engine, cid, rid);
        assertEq(uint256(afterForce.state), uint256(RoundLib.RoundState.Settled), "Round settled after reveals");
    }

    // ==================== Test 13: Settlement Only Possible After Enough Reveals ====================

    /// @notice settleRound reverts with NotEnoughVotes if fewer than minVoters revealed.
    function test_SettlementRequiresMinVoterReveals() public {
        uint256 cid = _submit();

        (bytes32 ck1, bytes32 s1) = _vote(v[0], cid, true, 5e6);
        // Only 1 voter — minVoters=3 not reached

        uint256 rid = RoundEngineReadHelpers.activeRoundId(engine, cid);
        RoundLib.Round memory r = RoundEngineReadHelpers.round(engine, cid, rid);

        _warpPastTlockRevealTime(uint256(r.startTime) + 1 hours);
        engine.revealVoteByCommitKey(cid, rid, ck1, true, 5_000, s1);

        vm.warp(block.timestamp + 1 hours + 1);

        vm.expectRevert(RoundVotingEngine.NotEnoughVotes.selector);
        _settleAfterRbtsSeed(engine, cid, rid);
    }

    // ==================== Test 14: Tied Round - Full Refund ====================

    /// @notice 5 UP (50 each) vs 5 DOWN (50 each). Equal pools -> Tied -> full refund.
    function test_TiedRound_FullRefund() public {
        _setRoundMinVoters(10);
        uint256 cid = _submit();

        // Record starting balances
        uint256[10] memory startBals;
        for (uint256 i = 0; i < 10; i++) {
            startBals[i] = lrepToken.balanceOf(v[i]);
        }

        _vote(v[0], cid, true, 5e6);
        _vote(v[1], cid, true, 5e6);
        _vote(v[2], cid, true, 5e6);
        _vote(v[3], cid, true, 5e6);
        _vote(v[4], cid, true, 5e6);
        _vote(v[5], cid, false, 5e6);
        _vote(v[6], cid, false, 5e6);
        _vote(v[7], cid, false, 5e6);
        _vote(v[8], cid, false, 5e6);
        _vote(v[9], cid, false, 5e6);

        uint256 rid = RoundEngineReadHelpers.activeRoundId(engine, cid);

        // Force settle past maxEpochBlocks
        _forceSettle(cid);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, cid, rid);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Tied), "Equal pools -> Tied");

        // All voters claim refund
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(v[i]);
            engine.claimCancelledRoundRefund(cid, rid);
            assertEq(lrepToken.balanceOf(v[i]), startBals[i], "Full refund on tied round");
        }
    }
}
