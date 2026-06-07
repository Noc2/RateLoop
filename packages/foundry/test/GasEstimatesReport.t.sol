// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test, console2, Vm } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { RoundIntegrationTest } from "./RoundIntegration.t.sol";
import { AdvisoryVoteRecorder } from "../contracts/AdvisoryVoteRecorder.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { RoundRewardDistributor } from "../contracts/RoundRewardDistributor.sol";
import { FrontendRegistry } from "../contracts/FrontendRegistry.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { MockCategoryRegistry } from "../contracts/mocks/MockCategoryRegistry.sol";
import { MockWorldIDVerifier } from "../contracts/mocks/MockWorldIDVerifier.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockVotingEngineForFrontendGas {
    address public immutable protocolConfig;

    constructor(address protocolConfig_) {
        protocolConfig = protocolConfig_;
    }

    function transferReward(address, uint256) external { }
}

contract MockRewardDistributorForFrontendGas {
    bytes32 public constant RATELOOP_REWARD_DISTRIBUTOR_MARKER = keccak256("rateloop.round-reward-distributor.v1");
    address public immutable votingEngine;

    constructor(address votingEngine_) {
        votingEngine = votingEngine_;
    }
}

contract MockFeeCreditorProtocolConfigForFrontendGas {
    mapping(address => mapping(address => bool)) public rewardDistributorForEngine;

    function setRewardDistributorForEngine(address distributor, address engine, bool authorized) external {
        rewardDistributorForEngine[distributor][engine] = authorized;
    }

    function isRewardDistributorForEngine(address distributor, address engine) external view returns (bool) {
        return rewardDistributorForEngine[distributor][engine];
    }
}

contract UserTransactionGasEstimatesTest is RoundIntegrationTest {
    bytes32 internal constant VOTE_COMMITTED_TOPIC =
        keccak256("VoteCommitted(uint256,uint256,address,bytes32,uint16,uint64,bytes32,uint256,bytes32,bytes)");
    bytes32 internal constant ADVISORY_VOTE_RECORDED_TOPIC = keccak256(
        "AdvisoryVoteRecorded(uint256,uint256,address,bytes32,bytes32,uint16,uint64,bytes32,bytes32,bytes)"
    );

    function _voteTransferPayload(uint256 contentId, TestCommitArtifacts memory artifacts, address frontend)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(
            contentId,
            _roundContext(artifacts.roundId, artifacts.roundReferenceRatingBps),
            artifacts.commitHash,
            artifacts.ciphertext,
            frontend,
            artifacts.targetRound,
            artifacts.drandChainHash
        );
    }

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

    function _calldataNonzeroBytes(bytes memory callData) internal pure returns (uint256 nonzeroBytes) {
        for (uint256 i = 0; i < callData.length; i++) {
            if (callData[i] != 0) nonzeroBytes++;
        }
    }

    function _calldataIntrinsicGas(bytes memory callData) internal pure returns (uint256) {
        uint256 nonzeroBytes = _calldataNonzeroBytes(callData);
        return nonzeroBytes * 16 + (callData.length - nonzeroBytes) * 4;
    }

    function _eventDataBytes(address emitter, bytes32 topic0) internal view returns (uint256) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == emitter && logs[i].topics.length > 0 && logs[i].topics[0] == topic0) {
                return logs[i].data.length;
            }
        }
        return 0;
    }

    function _logSubmitRevealCalldata(bytes memory callData) internal pure {
        console2.log("submit_content_reveal_calldata_bytes", callData.length);
        console2.log("submit_content_reveal_calldata_nonzero_bytes", _calldataNonzeroBytes(callData));
        console2.log("submit_content_reveal_calldata_intrinsic_gas", _calldataIntrinsicGas(callData));
    }

    function _logVoteCommitPayload(bytes memory callData, bytes memory ciphertext, uint256 eventDataBytes)
        internal
        pure
    {
        console2.log("vote_commit_calldata_bytes", callData.length);
        console2.log("vote_commit_calldata_nonzero_bytes", _calldataNonzeroBytes(callData));
        console2.log("vote_commit_calldata_intrinsic_gas", _calldataIntrinsicGas(callData));
        console2.log("vote_commit_ciphertext_bytes", ciphertext.length);
        console2.log("vote_commit_event_data_bytes", eventDataBytes);
    }

    function _logAdvisoryCommitPayload(bytes memory callData, bytes memory ciphertext, uint256 eventDataBytes)
        internal
        pure
    {
        console2.log("advisory_commit_calldata_bytes", callData.length);
        console2.log("advisory_commit_calldata_nonzero_bytes", _calldataNonzeroBytes(callData));
        console2.log("advisory_commit_calldata_intrinsic_gas", _calldataIntrinsicGas(callData));
        console2.log("advisory_commit_ciphertext_bytes", ciphertext.length);
        console2.log("advisory_commit_event_data_bytes", eventDataBytes);
    }

    function testGasEstimate_approveForSubmit_logs() public {
        vm.pauseGasMetering();
        uint256 gasUsed =
            _measureCallAs(submitter, address(lrepToken), abi.encodeCall(IERC20.approve, (address(registry), 10e6)));
        console2.log("approve_for_submit_gas", gasUsed);
    }

    function testGasEstimate_submitContent_logs() public {
        vm.pauseGasMetering();
        uint256 rewardAmount = _defaultSubmissionRewardAmount(registry);
        _ensureDefaultSubmitterIdentity(registry, submitter);
        address rewardEscrow = _ensureDefaultQuestionRewardPoolEscrow(registry);
        vm.startPrank(submitter);
        lrepToken.approve(rewardEscrow, rewardAmount);
        vm.stopPrank();

        string memory imageUrl = _submissionImageUrl("gas-report");
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
        bytes memory revealCallData = abi.encodeWithSignature(
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
        );
        uint256 revealGasUsed = _measureCallAs(submitter, address(registry), revealCallData);
        console2.log("reserve_submission_gas", reserveGasUsed);
        console2.log("submit_content_reveal_gas", revealGasUsed);
        console2.log("submit_content_total_gas", reserveGasUsed + revealGasUsed);
        _logSubmitRevealCalldata(revealCallData);
    }

    function testGasEstimate_voteApprovePlusCommit_logs() public {
        vm.pauseGasMetering();
        uint256 contentId = _submitContent();
        uint16 roundReferenceRatingBps = _previewCommitReferenceRatingBps(votingEngine, contentId);
        bytes32 salt = keccak256(abi.encodePacked(voter1, contentId, true, uint256(1000)));
        bytes32 commitHash = _commitHash(true, salt, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);
        _openRoundForTest(votingEngine, contentId, voter1);

        vm.startPrank(voter1);
        lrepToken.approve(address(votingEngine), STAKE);
        vm.stopPrank();

        bytes memory callData = abi.encodeWithSelector(
            bytes4(keccak256("commitVote(uint256,uint256,uint64,bytes32,bytes32,bytes,uint256,address)")),
            contentId,
            _roundContext(_previewCommitRoundId(votingEngine, contentId), roundReferenceRatingBps),
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );
        vm.recordLogs();
        uint256 gasUsed = _measureCallAs(voter1, address(votingEngine), callData);
        uint256 eventDataBytes = _eventDataBytes(address(votingEngine), VOTE_COMMITTED_TOPIC);
        console2.log("vote_approve_plus_commit_gas", gasUsed);
        _logVoteCommitPayload(callData, ciphertext, eventDataBytes);
    }

    function testGasEstimate_recordAdvisoryVote_logs() public {
        vm.pauseGasMetering();
        AdvisoryVoteRecorder advisoryRecorder =
            new AdvisoryVoteRecorder(address(votingEngine), address(registry), owner);
        ProtocolConfig config = ProtocolConfig(address(votingEngine.protocolConfig()));
        vm.prank(owner);
        config.setAdvisoryVoteRecorder(address(advisoryRecorder));

        uint256 contentId = _submitContent();
        _commitTestVote(
            DirectTestCommitRequest({
                engine: votingEngine,
                lrepToken: lrepToken,
                voter: voter1,
                contentId: contentId,
                isUp: true,
                stake: STAKE,
                frontend: address(0),
                salt: keccak256(abi.encodePacked(voter1, contentId, "advisory-open"))
            })
        );

        bytes32 salt = keccak256(abi.encodePacked(voter2, contentId, "advisory-gas"));
        TestCommitArtifacts memory artifacts =
            _buildTestCommitArtifacts(address(votingEngine), voter2, true, salt, contentId);
        bytes memory callData = abi.encodeCall(
            AdvisoryVoteRecorder.recordAdvisoryVote,
            (
                contentId,
                _roundContext(artifacts.roundId, artifacts.roundReferenceRatingBps),
                artifacts.targetRound,
                artifacts.drandChainHash,
                artifacts.commitHash,
                artifacts.ciphertext
            )
        );

        vm.recordLogs();
        uint256 gasUsed = _measureCallAs(voter2, address(advisoryRecorder), callData);
        uint256 eventDataBytes = _eventDataBytes(address(advisoryRecorder), ADVISORY_VOTE_RECORDED_TOPIC);
        console2.log("advisory_commit_gas", gasUsed);
        _logAdvisoryCommitPayload(callData, artifacts.ciphertext, eventDataBytes);
    }

    function testGasEstimate_revealVote_logs() public {
        vm.pauseGasMetering();
        uint256 contentId = _submitContent();
        bytes32 salt = keccak256(abi.encodePacked(voter1, contentId, true, uint256(1001)));
        bytes32 commitKey = _commitTestVote(
            DirectTestCommitRequest({
                engine: votingEngine,
                lrepToken: lrepToken,
                voter: voter1,
                contentId: contentId,
                isUp: true,
                stake: STAKE,
                frontend: address(0),
                salt: salt
            })
        );

        uint256 roundId = votingEngine.currentRoundId(contentId);
        _warpPastTlockRevealTime(block.timestamp + EPOCH_DURATION);

        uint256 gasUsed = _measureCall(
            address(votingEngine),
            abi.encodeCall(RoundVotingEngine.revealVoteByCommitKey, (contentId, roundId, commitKey, true, 5_000, salt))
        );
        console2.log("reveal_vote_gas", gasUsed);
    }

    function testGasEstimate_settleRound_logs() public {
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

        _commitAllThenReveal(voters, contentId, directions, STAKE);
        uint256 roundId = votingEngine.currentRoundId(contentId);

        vm.roll(block.number + 1);
        uint256 gasUsed =
            _measureCall(address(votingEngine), abi.encodeCall(RoundVotingEngine.settleRound, (contentId, roundId)));
        console2.log("settle_round_gas", gasUsed);
    }

    function testGasEstimate_claimReward_logs() public {
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
        console2.log("claim_reward_gas", gasUsed);
    }
}

contract FrontendTransactionGasEstimatesTest is Test {
    FrontendRegistry public registry;
    LoopReputation public lrepToken;
    MockVotingEngineForFrontendGas public votingEngine;
    MockRewardDistributorForFrontendGas public rewardDistributor;
    MockFeeCreditorProtocolConfigForFrontendGas public protocolConfig;

    address public admin = address(1);
    address public frontend = address(3);
    address public feeCreditor;

    uint256 public constant STAKE = 1000e6;

    function setUp() public {
        vm.startPrank(admin);
        lrepToken = new LoopReputation(admin, admin);
        lrepToken.grantRole(lrepToken.MINTER_ROLE(), admin);

        protocolConfig = new MockFeeCreditorProtocolConfigForFrontendGas();
        votingEngine = new MockVotingEngineForFrontendGas(address(protocolConfig));
        rewardDistributor = new MockRewardDistributorForFrontendGas(address(votingEngine));
        feeCreditor = address(rewardDistributor);
        protocolConfig.setRewardDistributorForEngine(feeCreditor, address(votingEngine), true);

        FrontendRegistry impl = new FrontendRegistry();
        registry = FrontendRegistry(
            address(
                new ERC1967Proxy(
                    address(impl), abi.encodeCall(FrontendRegistry.initialize, (admin, admin, address(lrepToken)))
                )
            )
        );

        registry.setVotingEngine(address(votingEngine));
        registry.addFeeCreditor(feeCreditor);

        lrepToken.mint(frontend, 10_000e6);
        lrepToken.mint(address(registry), 1_000_000e6);
        vm.stopPrank();
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

    function testGasEstimate_frontendApproveStakeAllowance_logs() public {
        vm.pauseGasMetering();
        uint256 gasUsed =
            _measureCallAs(frontend, address(lrepToken), abi.encodeCall(IERC20.approve, (address(registry), STAKE)));
        console2.log("frontend_approve_stake_allowance_gas", gasUsed);
    }

    function testGasEstimate_frontendRegister_logs() public {
        vm.pauseGasMetering();
        vm.startPrank(frontend);
        lrepToken.approve(address(registry), STAKE);
        vm.stopPrank();

        uint256 gasUsed = _measureCallAs(frontend, address(registry), abi.encodeCall(FrontendRegistry.register, ()));
        console2.log("frontend_register_gas", gasUsed);
    }

    function testGasEstimate_frontendClaimFees_logs() public {
        vm.pauseGasMetering();
        vm.startPrank(frontend);
        lrepToken.approve(address(registry), STAKE);
        registry.register();
        vm.stopPrank();

        vm.prank(feeCreditor);
        registry.creditFees(frontend, 200e6);

        uint256 gasUsed = _measureCallAs(frontend, address(registry), abi.encodeCall(FrontendRegistry.claimFees, ()));
        console2.log("frontend_claim_fees_gas", gasUsed);
    }
}

contract IdentityTransactionGasEstimatesTest is Test {
    RaterRegistry public raterRegistry;

    address public admin = address(1);
    address public user1 = address(4);
    address public delegate = address(5);

    bytes32 public constant ANCHOR_1 = bytes32(uint256(111111));

    function setUp() public {
        vm.startPrank(admin);
        raterRegistry = new RaterRegistry(
            admin,
            admin,
            address(new MockWorldIDVerifier()),
            42,
            uint256(keccak256("rateloop-human-credential-v4")),
            uint256(keccak256("rateloop-human-presence-v1")),
            365 days,
            15 minutes,
            7,
            0
        );
        vm.stopPrank();
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

    function testGasEstimate_seedHumanCredential_logs() public {
        vm.pauseGasMetering();
        uint256 gasUsed = _measureCallAs(
            admin,
            address(raterRegistry),
            abi.encodeCall(
                RaterRegistry.seedHumanCredential, (user1, uint64(block.timestamp + 365 days), ANCHOR_1, bytes32(0))
            )
        );
        console2.log("rater_registry_seed_human_credential_gas", gasUsed);
    }

    function testGasEstimate_requestDelegate_logs() public {
        vm.pauseGasMetering();
        vm.prank(admin);
        raterRegistry.seedHumanCredential(user1, uint64(block.timestamp + 365 days), ANCHOR_1, bytes32(0));

        uint256 gasUsed =
            _measureCallAs(user1, address(raterRegistry), abi.encodeCall(RaterRegistry.setDelegate, (delegate)));
        console2.log("rater_registry_request_delegate_gas", gasUsed);
    }
}
