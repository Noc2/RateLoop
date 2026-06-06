// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { MockCategoryRegistry } from "../contracts/mocks/MockCategoryRegistry.sol";
import { RoundEngineReadHelpers } from "./helpers/RoundEngineReadHelpers.sol";
import { VotingTestBase } from "./helpers/VotingTestHelpers.sol";
import { MockRaterIdentityRegistry } from "./mocks/MockRaterIdentityRegistry.sol";

contract RoundVotingEngineDormancyTest is VotingTestBase {
    LoopReputation public lrepToken;
    ContentRegistry public registry;
    RoundVotingEngine public engine;
    MockRaterIdentityRegistry public raterIdentityRegistry;

    address public owner = address(1);
    address public submitter = address(2);
    address public voter1 = address(3);
    address public voter2 = address(4);
    address public voter3 = address(5);
    address public voter4 = address(6);

    uint256 public constant STAKE = 5e6;
    uint256 public constant T0 = 1_000_000;

    function setUp() public {
        vm.warp(T0);
        vm.startPrank(owner);

        lrepToken = new LoopReputation(owner, owner);
        lrepToken.grantRole(lrepToken.MINTER_ROLE(), owner);

        ContentRegistry registryImpl = new ContentRegistry();
        RoundVotingEngine engineImpl = new RoundVotingEngine();

        registry = ContentRegistry(
            address(
                new ERC1967Proxy(
                    address(registryImpl),
                    abi.encodeCall(ContentRegistry.initializeWithTreasury, (owner, owner, owner, address(lrepToken)))
                )
            )
        );

        engine = RoundVotingEngine(
            address(
                new ERC1967Proxy(
                    address(engineImpl),
                    abi.encodeCall(
                        RoundVotingEngine.initialize,
                        (owner, address(lrepToken), address(registry), address(_deployProtocolConfig(owner)))
                    )
                )
            )
        );

        registry.setVotingEngine(address(engine));

        MockCategoryRegistry mockCategoryRegistry = new MockCategoryRegistry();
        mockCategoryRegistry.seedDefaultTestCategories();
        registry.setCategoryRegistry(address(mockCategoryRegistry));
        raterIdentityRegistry = new MockRaterIdentityRegistry();
        ProtocolConfig(address(engine.protocolConfig())).setRaterRegistry(address(raterIdentityRegistry));

        _setTlockRoundConfig(ProtocolConfig(address(engine.protocolConfig())), 1 hours, 7 days, 3, 100);

        address[5] memory users = [submitter, voter1, voter2, voter3, voter4];
        for (uint256 i = 0; i < users.length; i++) {
            lrepToken.mint(users[i], 10_000e6);
        }

        vm.stopPrank();
    }

    function test_CommitAfterRevealFailedGrace_StartsNewRoundBeforeDormancyWindowElapses() public {
        uint256 contentId = _submitContent();

        raterIdentityRegistry.setHolder(voter1);

        _commit(voter1, contentId, true);
        _commit(voter2, contentId, false);
        _commit(voter3, contentId, true);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        vm.warp(round.startTime + 7 days + ProtocolConfig(address(engine.protocolConfig())).revealGracePeriod() + 1);

        _commit(voter4, contentId, true);

        RoundLib.Round memory failedRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        uint256 newRoundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        assertEq(uint256(failedRound.state), uint256(RoundLib.RoundState.RevealFailed));
        assertEq(newRoundId, roundId + 1, "new commits should still roll into a fresh round before dormancy");
    }

    function test_CommitAfterRevealFailedGrace_StartsNewRoundAfterDormancyWindowElapses() public {
        uint256 contentId = _submitContent();

        raterIdentityRegistry.setHolder(voter1);

        _commit(voter1, contentId, true);
        _commit(voter2, contentId, false);
        _commit(voter3, contentId, true);

        bytes32 salt = keccak256(abi.encodePacked(voter4, block.timestamp, contentId));

        vm.warp(T0 + 31 days);
        _openRoundForTest(engine, contentId, voter4);
        TestCommitArtifacts memory artifacts = _buildTestCommitArtifacts(address(engine), voter4, true, salt, contentId);
        vm.startPrank(voter4);
        lrepToken.approve(address(engine), STAKE);
        engine.commitVote(
            contentId,
            _roundContext(artifacts.roundId, artifacts.roundReferenceRatingBps),
            artifacts.targetRound,
            artifacts.drandChainHash,
            artifacts.commitHash,
            artifacts.ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();

        uint256 newRoundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        assertEq(newRoundId, 2, "dormancy eligibility should not block fresh voting rounds");
        RoundLib.Round memory oldRound = RoundEngineReadHelpers.round(engine, contentId, 1);
        assertEq(uint256(oldRound.state), uint256(RoundLib.RoundState.RevealFailed));
        RoundLib.Round memory openRound = RoundEngineReadHelpers.round(engine, contentId, newRoundId);
        assertEq(uint256(openRound.state), uint256(RoundLib.RoundState.Open));
        assertEq(openRound.voteCount, 1);
    }

    function test_CommitAfterExpiredBelowQuorum_StartsNewRoundAfterDormancyWindowElapses() public {
        uint256 contentId = _submitContent();

        _commit(voter1, contentId, true);
        _commit(voter2, contentId, false);

        bytes32 salt = keccak256(abi.encodePacked(voter3, block.timestamp, contentId));

        vm.warp(T0 + 31 days);
        _openRoundForTest(engine, contentId, voter3);
        TestCommitArtifacts memory artifacts = _buildTestCommitArtifacts(address(engine), voter3, true, salt, contentId);
        vm.startPrank(voter3);
        lrepToken.approve(address(engine), STAKE);
        engine.commitVote(
            contentId,
            _roundContext(artifacts.roundId, artifacts.roundReferenceRatingBps),
            artifacts.targetRound,
            artifacts.drandChainHash,
            artifacts.commitHash,
            artifacts.ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        assertEq(roundId, 2, "expired below-quorum round should roll forward despite dormancy eligibility");
        RoundLib.Round memory cancelledRound = RoundEngineReadHelpers.round(engine, contentId, 1);
        assertEq(uint256(cancelledRound.state), uint256(RoundLib.RoundState.Cancelled));
        RoundLib.Round memory openRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(openRound.state), uint256(RoundLib.RoundState.Open));
        assertEq(openRound.voteCount, 1);
    }

    function test_MarkDormant_IgnoresRefundableSubQuorumRound() public {
        uint256 contentId = _submitContent();

        _commit(voter1, contentId, true);
        assertFalse(engine.isDormancyBlocked(contentId), "single sub-quorum vote should not preserve active status");

        vm.warp(T0 + 31 days);
        registry.markDormant(contentId);

        (,,,,, ContentRegistry.ContentStatus status,,,,) = registry.contents(contentId);
        assertEq(uint256(status), uint256(ContentRegistry.ContentStatus.Dormant));
    }

    function test_MarkDormant_AllSybilQuorumRoundCannotRevealAfterDormancy() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 salt1, uint256 roundId) = _commitWithKey(voter1, contentId, true);
        _commitWithKey(voter2, contentId, false);
        _commitWithKey(voter3, contentId, true);
        assertFalse(engine.isDormancyBlocked(contentId), "all-sybil round stays refund-cancellable");

        vm.warp(T0 + 31 days);
        registry.markDormant(contentId);

        vm.expectRevert(RoundVotingEngine.ContentNotActive.selector);
        engine.revealVoteByCommitKey(contentId, roundId, ck1, true, 5_000, salt1);

        engine.cancelExpiredRound(contentId, roundId);
        RoundLib.Round memory cancelledRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(cancelledRound.state), uint256(RoundLib.RoundState.Cancelled));
    }

    function test_ReviveAfterAllSybilQuorumRound_StartsFreshRound() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 salt1, uint256 staleRoundId) = _commitWithKey(voter1, contentId, true);
        _commitWithKey(voter2, contentId, false);
        _commitWithKey(voter3, contentId, true);

        vm.warp(T0 + 31 days);
        registry.markDormant(contentId);

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 5e6);
        registry.reviveContent(contentId);
        vm.stopPrank();

        vm.expectRevert(RoundVotingEngine.ContentNotActive.selector);
        engine.revealVoteByCommitKey(contentId, staleRoundId, ck1, true, 5_000, salt1);

        _commit(voter4, contentId, true);

        RoundLib.Round memory staleRound = RoundEngineReadHelpers.round(engine, contentId, staleRoundId);
        assertEq(uint256(staleRound.state), uint256(RoundLib.RoundState.Cancelled));
        uint256 freshRoundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        assertEq(freshRoundId, staleRoundId + 1);
        RoundLib.Round memory freshRound = RoundEngineReadHelpers.round(engine, contentId, freshRoundId);
        assertEq(uint256(freshRound.state), uint256(RoundLib.RoundState.Open));
        assertEq(freshRound.voteCount, 1);
    }

    function test_CommitVoteAgainstRevivedStaleRoundReverts() public {
        ProtocolConfig config = ProtocolConfig(address(engine.protocolConfig()));
        vm.prank(owner);
        config.setConfig(1 hours, 60 days, 3, 100);
        uint256 contentId = _submitContent();

        _commitWithKey(voter1, contentId, true);
        _commitWithKey(voter2, contentId, false);
        (,, uint256 staleRoundId) = _commitWithKey(voter3, contentId, true);

        vm.warp(T0 + 31 days);
        registry.markDormant(contentId);

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 5e6);
        registry.reviveContent(contentId);
        vm.stopPrank();

        bytes32 salt = keccak256(abi.encodePacked(voter4, block.timestamp, contentId));
        TestCommitArtifacts memory artifacts = _buildTestCommitArtifacts(voter4, true, salt, contentId);

        vm.startPrank(voter4);
        lrepToken.approve(address(engine), STAKE);
        vm.expectRevert(RoundVotingEngine.ContentNotActive.selector);
        engine.commitVote(
            contentId,
            _roundContext(staleRoundId, artifacts.roundReferenceRatingBps),
            artifacts.targetRound,
            artifacts.drandChainHash,
            artifacts.commitHash,
            artifacts.ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();

        RoundLib.Round memory staleRound = RoundEngineReadHelpers.round(engine, contentId, staleRoundId);
        assertEq(staleRound.voteCount, 3);
    }

    function test_ReviveAfterEmptyOpenRound_StartsFreshRound() public {
        uint256 contentId = _submitContent();

        _openRoundForTest(engine, contentId, voter1);
        assertEq(RoundEngineReadHelpers.activeRoundId(engine, contentId), 1);

        vm.warp(T0 + 31 days);
        registry.markDormant(contentId);

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 5e6);
        registry.reviveContent(contentId);
        vm.stopPrank();

        assertEq(engine.currentRoundId(contentId), 1, "latest slot keeps the stale empty round");
        assertEq(RoundEngineReadHelpers.activeRoundId(engine, contentId), 0, "stale empty round is no longer usable");

        _commit(voter2, contentId, true);

        assertEq(RoundEngineReadHelpers.activeRoundId(engine, contentId), 2);
        RoundLib.Round memory staleRound = RoundEngineReadHelpers.round(engine, contentId, 1);
        assertEq(uint256(staleRound.state), uint256(RoundLib.RoundState.Cancelled));
        RoundLib.Round memory openRound = RoundEngineReadHelpers.round(engine, contentId, 2);
        assertEq(uint256(openRound.state), uint256(RoundLib.RoundState.Open));
        assertEq(openRound.voteCount, 1);
    }

    function _submitContent() internal returns (uint256 contentId) {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/dormancy", "test goal", "test goal", "test", 0);
        vm.stopPrank();
        return 1;
    }

    function _commit(address voter, uint256 contentId, bool isUp) internal {
        _commitWithKey(voter, contentId, isUp);
    }

    function _commitWithKey(address voter, uint256 contentId, bool isUp)
        internal
        returns (bytes32 commitKey, bytes32 salt, uint256 roundId)
    {
        salt = keccak256(abi.encodePacked(voter, block.timestamp));
        commitKey = _commitTestVote(
            DirectTestCommitRequest({
                engine: engine,
                lrepToken: lrepToken,
                voter: voter,
                contentId: contentId,
                isUp: isUp,
                stake: STAKE,
                frontend: address(0),
                salt: salt
            })
        );
        roundId = engine.currentRoundId(contentId);
    }
}
