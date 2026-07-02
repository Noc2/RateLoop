// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { RoundIntegrationTest } from "./RoundIntegration.t.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { RoundRewardDistributor } from "../contracts/RoundRewardDistributor.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { RoundEngineReadHelpers } from "./helpers/RoundEngineReadHelpers.sol";
import { FrontendRegistry } from "../contracts/FrontendRegistry.sol";

contract GasBudgetTest is RoundIntegrationTest {
    // Content submission validates media/category metadata, emits reconstruction anchors, and
    // opens the first rewardable round so all duration semantics share the creation timestamp.
    uint256 internal constant MAX_SUBMIT_CONTENT_GAS = 1_800_000;
    // commitVote validates the full armored AGE envelope and emits ciphertext for indexed availability,
    // while storing only compact hash/tlock metadata on-chain.
    uint256 internal constant MAX_COMMIT_VOTE_GAS = 2_700_000;
    uint256 internal constant MAX_REVEAL_VOTE_GAS = 320_000;
    uint256 internal constant WORLD_CHAIN_BLOCK_GAS_LIMIT = 30_000_000;
    // Settlement records cluster-payout source readiness for clean rounds, adding one bounded SSTORE.
    uint256 internal constant MAX_SETTLE_ROUND_GAS = 775_000;
    uint256 internal constant MAX_SETTLE_ROUND_MAX_EPOCH_SCAN_GAS = 5_900_000;
    // Cleanup now also accounts RBTS score-spread economics and bounded keeper/treasury routing.
    uint256 internal constant MAX_PROCESS_UNREVEALED_GAS = 325_000;
    uint256 internal constant MAX_CANCEL_EXPIRED_ROUND_GAS = 60_000;
    uint256 internal constant MAX_CLAIM_REWARD_GAS = 270_000;
    uint256 internal constant MAX_CLAIM_FRONTEND_FEE_GAS = 250_000;
    uint256 private gasRoundContentNonce;

    function _measureCall(address target, bytes memory callData) internal returns (uint256 gasUsed) {
        vm.resumeGasMetering();
        uint256 gasBefore = gasleft();
        (bool success,) = target.call(callData);
        gasUsed = gasBefore - gasleft();
        vm.pauseGasMetering();
        assertTrue(success, "measured call reverted");
    }

    function _measureCallAs(address caller, address target, bytes memory callData) internal returns (uint256 gasUsed) {
        vm.pauseGasMetering();
        vm.startPrank(caller);
        vm.resumeGasMetering();
        uint256 gasBefore = gasleft();
        (bool success,) = target.call(callData);
        gasUsed = gasBefore - gasleft();
        vm.pauseGasMetering();
        vm.stopPrank();
        assertTrue(success, "measured pranked call reverted");
    }

    function _votersAndDirections(uint256 voterCount)
        internal
        returns (address[] memory voters, bool[] memory directions)
    {
        voters = new address[](voterCount);
        directions = new bool[](voterCount);
        uint256 upVoters = voterCount / 2 + 1;
        for (uint256 i = 0; i < voterCount; i++) {
            voters[i] = address(uint160(10_000 + i));
            directions[i] = i < upVoters;
            vm.startPrank(owner);
            lrepToken.mint(voters[i], STAKE);
            _seedRaterIdentity(raterRegistry, voters[i], bytes32(uint256(uint160(voters[i]))));
            vm.stopPrank();
        }
    }

    function _gasRoundConfig(uint16 maxVoters) internal pure returns (RoundLib.RoundConfig memory) {
        return RoundLib.RoundConfig({
            epochDuration: uint32(EPOCH_DURATION),
            maxDuration: uint32(EPOCH_DURATION),
            minVoters: 3,
            maxVoters: maxVoters
        });
    }

    function _gasRoundRevealCommitment(
        string memory url,
        bytes32 salt,
        ContentRegistry.SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig
    ) internal view returns (bytes32) {
        string[] memory imageUrls = _emptyImageUrls();
        return _questionRevealCommitment(
            _questionSubmissionKey(url, imageUrls, "", "test goal", "test", 1, _emptySubmissionDetails()),
            _submissionMediaHash(imageUrls, ""),
            "test goal",
            "test",
            _emptySubmissionDetails(),
            1,
            salt,
            submitter,
            rewardTerms,
            roundConfig,
            _defaultQuestionSpec()
        );
    }

    function _submitGasRoundReveal(
        string memory url,
        bytes32 salt,
        ContentRegistry.SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig
    ) internal returns (uint256 contentId) {
        string[] memory imageUrls = _emptyImageUrls();
        contentId = registry.submitQuestionWithRewardAndRoundConfig(
            url,
            imageUrls,
            "",
            "test goal",
            "test",
            1,
            _emptySubmissionDetails(),
            salt,
            rewardTerms,
            roundConfig,
            _defaultQuestionSpec(),
            _defaultConfidentialityConfig()
        );
    }

    function _submitContentWithGasRoundConfig(uint16 maxVoters) internal returns (uint256 contentId) {
        gasRoundContentNonce++;
        string memory url =
            string(abi.encodePacked("https://example.com/gas-round-", vm.toString(gasRoundContentNonce)));
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = _defaultSubmissionRewardTerms(registry);
        RoundLib.RoundConfig memory roundConfig = _gasRoundConfig(maxVoters);

        address rewardEscrow = _ensureDefaultQuestionRewardPoolEscrow(registry);
        uint256 rewardAmount = _defaultSubmissionRewardAmount(registry);

        vm.startPrank(submitter);
        lrepToken.approve(rewardEscrow, rewardAmount);

        bytes32 salt = _contentSubmissionSalt(url, submitter);

        registry.reserveSubmission(_gasRoundRevealCommitment(url, salt, rewardTerms, roundConfig));
        vm.warp(block.timestamp + 1);
        contentId = _submitGasRoundReveal(url, salt, rewardTerms, roundConfig);
        vm.stopPrank();
    }

    function _measureSettleRoundGas(uint16 voterCount) internal returns (uint256 gasUsed) {
        uint256 contentId = voterCount > 100 ? _submitContentWithGasRoundConfig(voterCount) : _submitContent();
        (address[] memory voters, bool[] memory directions) = _votersAndDirections(voterCount);

        _commitAllThenReveal(voters, contentId, directions, STAKE);
        uint256 roundId = _getActiveOrLatestRoundId(contentId);

        _installAndAssertRoundIntegrationClusterPayoutOracle();
        vm.roll(block.number + 1);
        gasUsed =
            _measureCall(address(votingEngine), abi.encodeCall(RoundVotingEngine.settleRound, (contentId, roundId)));
    }

    function testGas_submitContent_underBudget() public {
        vm.pauseGasMetering();
        uint256 rewardAmount = _defaultSubmissionRewardAmount(registry);
        _ensureDefaultSubmitterIdentity(registry, submitter);
        address rewardEscrow = _ensureDefaultQuestionRewardPoolEscrow(registry);
        vm.startPrank(submitter);
        lrepToken.approve(rewardEscrow, rewardAmount);
        vm.stopPrank();

        string memory imageUrl = _submissionImageUrl("gas-submit");
        string[] memory imageUrls = _singleImageUrls(imageUrl);
        bytes32 submissionKey = _questionSubmissionKey(
            "https://example.com/context", imageUrls, "", "test goal", "test", 1, _emptySubmissionDetails()
        );
        bytes32 salt =
            keccak256(abi.encode(imageUrl, "test goal", "test", uint256(1), submitter, block.timestamp, block.number));
        bytes32 revealCommitment = _defaultQuestionRevealCommitment(
            registry, submissionKey, imageUrls, "", "test goal", "test goal", "test", 1, salt, submitter
        );

        uint256 reserveGasUsed = _measureCallAs(
            submitter, address(registry), abi.encodeCall(ContentRegistry.reserveSubmission, (revealCommitment))
        );
        vm.warp(block.timestamp + 1);
        uint256 revealGasUsed = _measureCallAs(
            submitter,
            address(registry),
            abi.encodeWithSignature(
                "submitQuestion(string,string[],string,string,string,uint256,(string,bytes32),bytes32,(bytes32,bytes32))",
                "https://example.com/context",
                imageUrls,
                "",
                "test goal",
                "test",
                1,
                _emptySubmissionDetails(),
                salt,
                _defaultQuestionSpec()
            )
        );
        uint256 gasUsed = reserveGasUsed + revealGasUsed;

        assertLe(gasUsed, MAX_SUBMIT_CONTENT_GAS, "submitContent gas budget exceeded");
    }

    function testGas_commitVote_underBudget() public {
        vm.pauseGasMetering();
        uint256 contentId = _submitContent();
        uint16 roundReferenceRatingBps = _previewCommitReferenceRatingBps(votingEngine, contentId);
        bytes32 salt = keccak256(abi.encodePacked(voter1, contentId, true, uint256(1)));
        bytes32 commitHash = _commitHash(true, salt, voter1, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);
        _openRoundForTest(votingEngine, contentId, voter1);

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        vm.stopPrank();

        uint256 gasUsed = _measureCallAs(
            voter1,
            address(votingEngine),
            abi.encodeWithSelector(
                bytes4(keccak256("commitVote(uint256,uint256,uint64,bytes32,bytes32,bytes,uint256,address)")),
                contentId,
                _roundContext(_previewCommitRoundId(votingEngine, contentId), roundReferenceRatingBps),
                _tlockCommitTargetRound(),
                _tlockDrandChainHash(),
                commitHash,
                ciphertext,
                STAKE,
                address(0)
            )
        );

        assertLe(gasUsed, MAX_COMMIT_VOTE_GAS, "commitVote gas budget exceeded");
    }

    function testGas_revealVoteByCommitKey_underBudget() public {
        vm.pauseGasMetering();
        uint256 contentId = _submitContent();
        bytes32 salt = keccak256(abi.encodePacked(voter1, contentId, true, uint256(2)));
        bytes32 commitHash = _commitHash(true, salt, voter1, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);

        _openRoundForTest(votingEngine, contentId, voter1);
        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext1 =
            _roundContext(_previewCommitRoundId(votingEngine, contentId), _defaultRatingReferenceBps());
        votingEngine.commitVote(
            contentId,
            cachedRoundContext1,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        _warpPastTlockRevealTime(block.timestamp + EPOCH_DURATION);

        uint256 gasUsed = _measureCall(
            address(votingEngine),
            abi.encodeCall(
                RoundVotingEngine.revealVoteByCommitKey,
                (contentId, roundId, _commitKey(voter1, commitHash), true, 5_000, salt)
            )
        );

        assertLe(gasUsed, MAX_REVEAL_VOTE_GAS, "revealVoteByCommitKey gas budget exceeded");
    }

    function testGas_settleRound_underBudget() public {
        vm.pauseGasMetering();
        uint256 gasUsed = _measureSettleRoundGas(3);

        assertLe(gasUsed, MAX_SETTLE_ROUND_GAS, "settleRound gas budget exceeded");
        assertLe(gasUsed, WORLD_CHAIN_BLOCK_GAS_LIMIT, "settleRound 3-voter block gas limit exceeded");
    }

    function testGas_settleRound_100Voters_underWorldChainBlockLimit() public {
        vm.pauseGasMetering();
        uint256 gasUsed = _measureSettleRoundGas(100);

        assertLe(gasUsed, WORLD_CHAIN_BLOCK_GAS_LIMIT, "settleRound 100-voter block gas limit exceeded");
    }

    function testGas_settleRound_200Voters_underWorldChainBlockLimit() public {
        vm.pauseGasMetering();
        uint256 gasUsed = _measureSettleRoundGas(200);

        assertLe(gasUsed, WORLD_CHAIN_BLOCK_GAS_LIMIT, "settleRound 200-voter block gas limit exceeded");
    }

    function testGas_settleRound_maxEpochScan_underBudget() public {
        vm.pauseGasMetering();

        ProtocolConfig config = ProtocolConfig(address(votingEngine.protocolConfig()));
        vm.startPrank(owner);
        _setTlockRoundConfig(config, 5 minutes, 5 minutes, 3, 100);
        vm.stopPrank();

        uint256 contentId = _submitContent();

        address[] memory voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory directions = new bool[](3);
        directions[0] = true;
        directions[1] = false;
        directions[2] = true;

        _commitAllThenReveal(voters, contentId, directions, STAKE);
        uint256 roundId = _getActiveOrLatestRoundId(contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);

        uint256 maxEpochEnd = uint256(round.startTime) + 5 minutes;
        vm.warp(maxEpochEnd + config.revealGracePeriod() + 1);
        _installAndAssertRoundIntegrationClusterPayoutOracle();
        vm.roll(block.number + 1);

        uint256 gasUsed =
            _measureCall(address(votingEngine), abi.encodeCall(RoundVotingEngine.settleRound, (contentId, roundId)));

        assertLe(gasUsed, MAX_SETTLE_ROUND_MAX_EPOCH_SCAN_GAS, "settleRound worst-case epoch scan gas budget exceeded");
    }

    function testGas_processUnrevealedVotes_underBudget() public {
        vm.pauseGasMetering();
        uint256 contentId = _submitContent();

        bytes32 s1 = keccak256(abi.encodePacked(voter1, contentId, true, uint256(1)));
        bytes32 s2 = keccak256(abi.encodePacked(voter2, contentId, true, uint256(2)));
        bytes32 s3 = keccak256(abi.encodePacked(voter3, contentId, false, uint256(3)));
        bytes32 s4 = keccak256(abi.encodePacked(voter4, contentId, false, uint256(4)));
        (, bytes32 ck1) = _commitWithSalt(voter1, contentId, true, STAKE, s1);
        (, bytes32 ck2) = _commitWithSalt(voter2, contentId, true, STAKE, s2);
        (, bytes32 ck3) = _commitWithSalt(voter3, contentId, false, STAKE, s3);
        _commitWithSalt(voter4, contentId, false, STAKE, s4);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);

        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH_DURATION);
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck1, true, 5_000, s1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck2, true, 5_000, s2);
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck3, false, 5_000, s3);

        vm.warp(
            _lastCommitRevealableAfter(votingEngine, contentId, roundId)
                + ProtocolConfig(address(votingEngine.protocolConfig())).revealGracePeriod() + 1
        );
        _installAndAssertRoundIntegrationClusterPayoutOracle();
        vm.roll(block.number + 1);
        votingEngine.settleRound(contentId, roundId);

        uint256 gasUsed = _measureCall(
            address(votingEngine), abi.encodeCall(RoundVotingEngine.processUnrevealedVotes, (contentId, roundId, 0, 10))
        );

        assertLe(gasUsed, MAX_PROCESS_UNREVEALED_GAS, "processUnrevealedVotes gas budget exceeded");
    }

    function testGas_cancelExpiredRound_underBudget() public {
        vm.pauseGasMetering();
        uint256 contentId = _submitContent();
        bytes32 salt = keccak256(abi.encodePacked(voter1, contentId, true, uint256(4)));
        bytes32 commitHash = _commitHash(true, salt, voter1, contentId);

        _openRoundForTest(votingEngine, contentId, voter1);
        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        uint256 cachedRoundContext5 =
            _roundContext(_previewCommitRoundId(votingEngine, contentId), _defaultRatingReferenceBps());
        votingEngine.commitVote(
            contentId,
            cachedRoundContext5,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            _testCiphertext(true, salt, contentId),
            STAKE,
            address(0)
        );
        vm.stopPrank();

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, contentId, roundId);
        vm.warp(uint256(round.startTime) + EPOCH_DURATION + 1);

        uint256 gasUsed = _measureCall(
            address(votingEngine), abi.encodeCall(RoundVotingEngine.cancelExpiredRound, (contentId, roundId))
        );

        assertLe(gasUsed, MAX_CANCEL_EXPIRED_ROUND_GAS, "cancelExpiredRound gas budget exceeded");
    }

    function testGas_claimReward_underBudget() public {
        vm.pauseGasMetering();
        uint256 contentId = _submitContent();

        address[] memory voters = new address[](3);
        voters[0] = voter1;
        voters[1] = voter2;
        voters[2] = voter3;
        bool[] memory directions = new bool[](3);
        directions[0] = true;
        directions[1] = true;
        directions[2] = false;

        uint256 roundId = _settleRoundWith(voters, contentId, directions, STAKE);

        uint256 gasUsed = _measureCallAs(
            voter1, address(rewardDistributor), abi.encodeCall(RoundRewardDistributor.claimReward, (contentId, roundId))
        );

        assertLe(gasUsed, MAX_CLAIM_REWARD_GAS, "claimReward gas budget exceeded");
    }

    function testGas_claimFrontendFee_underBudget() public {
        vm.pauseGasMetering();
        (, address frontendOp) = _setupFrontendRegistry();
        (uint256 contentId, uint256 roundId) = _settleRoundWithFrontend(frontendOp);

        uint256 gasUsed = _measureCallAs(
            frontendOp,
            address(rewardDistributor),
            abi.encodeCall(RoundRewardDistributor.claimFrontendFee, (contentId, roundId, frontendOp))
        );

        assertLe(gasUsed, MAX_CLAIM_FRONTEND_FEE_GAS, "claimFrontendFee gas budget exceeded");
    }
}
