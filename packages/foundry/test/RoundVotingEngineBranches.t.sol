// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { Base64 } from "@openzeppelin/contracts/utils/Base64.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { AdvisoryVoteRecorder } from "../contracts/AdvisoryVoteRecorder.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { RoundRewardDistributor } from "../contracts/RoundRewardDistributor.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { RoundEngineReadHelpers } from "./helpers/RoundEngineReadHelpers.sol";
import { TlockVoteLib } from "../contracts/libraries/TlockVoteLib.sol";
import { VotePreflightLib } from "../contracts/libraries/VotePreflightLib.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { ParticipationPool } from "../contracts/ParticipationPool.sol";
import { FrontendRegistry } from "../contracts/FrontendRegistry.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { MockRaterIdentityRegistry } from "./mocks/MockRaterIdentityRegistry.sol";
import { VotingTestBase } from "./helpers/VotingTestHelpers.sol";
import { MockCategoryRegistry } from "../contracts/mocks/MockCategoryRegistry.sol";

// =========================================================================
// TEST CONTRACT
// =========================================================================

contract RoundVotingEngineBranchesTest is VotingTestBase {
    LoopReputation public lrepToken;
    ContentRegistry public registry;
    AdvisoryVoteRecorder public advisoryRecorder;
    RoundVotingEngine public engine;
    RoundRewardDistributor public rewardDistributor;
    MockRaterIdentityRegistry public mockRaterIdentityRegistry;
    ParticipationPool public participationPool;
    FrontendRegistry public frontendRegistry;
    address internal protocolConfigAddress;

    address public owner = address(1);
    address public submitter = address(2);
    address public voter1 = address(3);
    address public voter2 = address(4);
    address public voter3 = address(5);
    address public voter4 = address(6);
    address public voter5 = address(7);
    address public voter6 = address(8);
    address public keeper = address(9);
    address public treasury = address(100);
    address public frontend1 = address(200);
    address public delegate1 = address(201);

    uint256 public constant STAKE = 5e6; // 5 LREP
    uint256 public constant T0 = 1_000_000; // setUp warp time
    uint256 public constant EPOCH = 1 hours; // epochDuration
    uint8 internal constant COMMIT_STATUS_OPEN = 0;
    uint8 internal constant COMMIT_STATUS_STARTS_NEXT_ROUND = 1;
    uint8 internal constant COMMIT_STATUS_ROUND_FULL = 2;
    uint8 internal constant COMMIT_STATUS_WAITING_FOR_SETTLEMENT = 3;
    uint8 internal constant COMMIT_STATUS_WAITING_FOR_REVEAL_GRACE = 4;
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

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
        return EPOCH;
    }

    function setUp() public {
        vm.warp(T0);
        vm.startPrank(owner);

        lrepToken = new LoopReputation(owner, owner);
        lrepToken.grantRole(lrepToken.MINTER_ROLE(), owner);

        ContentRegistry registryImpl = new ContentRegistry();
        RoundVotingEngine engineImpl = new RoundVotingEngine();
        RoundRewardDistributor distImpl = new RoundRewardDistributor();

        registry = ContentRegistry(
            address(
                new ERC1967Proxy(
                    address(registryImpl),
                    abi.encodeCall(ContentRegistry.initializeWithTreasury, (owner, owner, owner, address(lrepToken)))
                )
            )
        );

        // Foundry tests use structurally valid AGE/tlock envelopes here rather than real decryptable ciphertexts.
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
        protocolConfigAddress = address(engine.protocolConfig());
        advisoryRecorder = new AdvisoryVoteRecorder(address(engine), address(registry), owner);
        ProtocolConfig(protocolConfigAddress).setAdvisoryVoteRecorder(address(advisoryRecorder));

        rewardDistributor = RoundRewardDistributor(
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
        registry.setProtocolConfig(protocolConfigAddress);
        MockCategoryRegistry mockCategoryRegistry = new MockCategoryRegistry();
        mockCategoryRegistry.seedDefaultTestCategories();
        registry.setCategoryRegistry(address(mockCategoryRegistry));
        ProtocolConfig(protocolConfigAddress).setRewardDistributor(address(rewardDistributor));
        ProtocolConfig(protocolConfigAddress).setCategoryRegistry(address(mockCategoryRegistry));
        ProtocolConfig(protocolConfigAddress).setTreasury(treasury);
        _setTlockDrandConfig(
            ProtocolConfig(protocolConfigAddress),
            DEFAULT_DRAND_CHAIN_HASH,
            DEFAULT_DRAND_GENESIS_TIME,
            DEFAULT_DRAND_PERIOD
        );

        // epochDuration=1h, maxDuration=7d, minVoters=3, maxVoters=1000
        _setTlockRoundConfig(ProtocolConfig(protocolConfigAddress), 1 hours, 7 days, 3, 1000);

        mockRaterIdentityRegistry = new MockRaterIdentityRegistry();

        FrontendRegistry frImpl = new FrontendRegistry();
        frontendRegistry = FrontendRegistry(
            address(
                new ERC1967Proxy(
                    address(frImpl), abi.encodeCall(FrontendRegistry.initialize, (owner, owner, address(lrepToken)))
                )
            )
        );
        frontendRegistry.setVotingEngine(address(engine));
        frontendRegistry.addFeeCreditor(address(rewardDistributor));
        mockRaterIdentityRegistry.setHolder(frontend1);
        ProtocolConfig(protocolConfigAddress).setFrontendRegistry(address(frontendRegistry));
        ProtocolConfig(protocolConfigAddress).setRaterRegistry(address(mockRaterIdentityRegistry));

        participationPool = new ParticipationPool(address(lrepToken), owner);
        participationPool.setAuthorizedCaller(address(rewardDistributor), true);
        participationPool.setAuthorizedCaller(address(registry), true);
        ProtocolConfig(protocolConfigAddress).setParticipationPool(address(participationPool));

        lrepToken.mint(owner, 2_000_000e6);
        lrepToken.approve(address(participationPool), 500_000e6);
        participationPool.depositPool(500_000e6);
        lrepToken.approve(address(engine), 500_000e6);

        address[9] memory users = [submitter, voter1, voter2, voter3, voter4, voter5, voter6, frontend1, delegate1];
        for (uint256 i = 0; i < users.length; i++) {
            lrepToken.mint(users[i], 10_000e6);
        }

        vm.stopPrank();
    }

    // =========================================================================
    // TEST HELPERS
    // =========================================================================

    function _previewCommitAvailability(uint256 contentId)
        internal
        view
        returns (bool canCommit, uint8 status, uint256 roundId, uint16 referenceRatingBps, bool willStartNewRound)
    {
        uint256 currentRoundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        uint256 previewRoundId = engine.previewCommitRoundId(contentId);
        if (currentRoundId == 0 || previewRoundId != currentRoundId) {
            status = COMMIT_STATUS_STARTS_NEXT_ROUND;
        } else {
            RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, currentRoundId);
            RoundLib.RoundConfig memory cfg = RoundEngineReadHelpers.roundConfig(engine, contentId, currentRoundId);
            uint16 revealQuorum = cfg.minVoters < 3 ? 3 : cfg.minVoters;
            if (round.thresholdReachedAt != 0 || round.revealedCount >= revealQuorum) {
                status = COMMIT_STATUS_WAITING_FOR_SETTLEMENT;
            } else if (round.voteCount >= cfg.maxVoters) {
                status = COMMIT_STATUS_ROUND_FULL;
            } else if (round.startTime > 0 && block.timestamp >= uint256(round.startTime) + cfg.maxDuration) {
                status = COMMIT_STATUS_WAITING_FOR_REVEAL_GRACE;
            } else {
                status = COMMIT_STATUS_OPEN;
            }
        }
        canCommit = status == COMMIT_STATUS_OPEN || status == COMMIT_STATUS_STARTS_NEXT_ROUND;
        roundId = previewRoundId;
        referenceRatingBps = engine.previewCommitReferenceRatingBps(contentId);
        willStartNewRound = status == COMMIT_STATUS_STARTS_NEXT_ROUND;
    }

    /// @dev Commit a vote in test mode and return (commitKey, salt).
    function _commit(address voter, uint256 contentId, bool isUp, uint256 stake)
        internal
        returns (bytes32 commitKey, bytes32 salt)
    {
        salt = keccak256(abi.encodePacked(voter, block.timestamp));
        commitKey = _commitTestVote(
            DirectTestCommitRequest({
                engine: engine,
                lrepToken: lrepToken,
                voter: voter,
                contentId: contentId,
                isUp: isUp,
                stake: stake,
                frontend: address(0),
                salt: salt
            })
        );
    }

    /// @dev Commit with a specific frontend address.
    function _commitWithFrontend(address voter, uint256 contentId, bool isUp, uint256 stake, address frontend)
        internal
        returns (bytes32 commitKey, bytes32 salt)
    {
        salt = keccak256(abi.encodePacked(voter, block.timestamp));
        commitKey = _commitTestVote(
            DirectTestCommitRequest({
                engine: engine,
                lrepToken: lrepToken,
                voter: voter,
                contentId: contentId,
                isUp: isUp,
                stake: stake,
                frontend: frontend,
                salt: salt
            })
        );
    }

    /// @dev Reveal a vote by commit key. Permissionless — no prank needed.
    function _reveal(uint256 contentId, uint256 roundId, bytes32 commitKey, bool isUp, bytes32 salt) internal {
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, isUp, 5_000, salt);
    }

    function _predictionBps(uint256 index, bool isUp) internal pure returns (uint16) {
        uint16[3] memory upPredictions = [uint16(7_000), uint16(6_000), uint16(5_500)];
        uint16[3] memory downPredictions = [uint16(4_000), uint16(3_500), uint16(3_000)];
        return isUp ? upPredictions[index % upPredictions.length] : downPredictions[index % downPredictions.length];
    }

    function _revealPrediction(
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        bool isUp,
        uint16 predictedUpBps,
        bytes32 salt
    ) internal {
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, isUp, predictedUpBps, salt);
    }

    function _settleRoundAfterRbtsSeed(uint256 contentId, uint256 roundId) internal {
        vm.roll(block.number + 1);
        engine.settleRound(contentId, roundId);
    }

    function _installRaterRegistry() internal returns (RaterRegistry raterRegistry) {
        raterRegistry = new RaterRegistry(owner, owner, address(0x1234), bytes32("rate-loop"), 1, 365 days);
        vm.prank(owner);
        ProtocolConfig(protocolConfigAddress).setRaterRegistry(address(raterRegistry));
    }

    function _commitPrediction(address voter, uint256 contentId, uint16 predictedRatingBps, uint256 stake)
        internal
        returns (bytes32 commitKey, bytes32 salt)
    {
        return _commitPrediction(voter, contentId, predictedRatingBps >= 5_000, predictedRatingBps, stake);
    }

    function _commitPrediction(address voter, uint256 contentId, bool isUp, uint16 predictedUpBps, uint256 stake)
        internal
        returns (bytes32 commitKey, bytes32 salt)
    {
        return _commitPredictionWithFrontend(voter, contentId, isUp, predictedUpBps, stake, address(0));
    }

    function _commitPredictionWithFrontend(
        address voter,
        uint256 contentId,
        bool isUp,
        uint16 predictedUpBps,
        uint256 stake,
        address frontend
    ) internal returns (bytes32 commitKey, bytes32 salt) {
        salt = keccak256(abi.encodePacked(voter, isUp, predictedUpBps, block.timestamp));
        uint256 roundId = engine.previewCommitRoundId(contentId);
        uint16 referenceRatingBps = engine.previewCommitReferenceRatingBps(contentId);
        uint64 targetRound = _tlockCommitTargetRound(engine, contentId);
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes memory ciphertext = _testCiphertext(isUp, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = TlockVoteLib.buildExpectedRbtsCommitHash(
            isUp,
            predictedUpBps,
            salt,
            voter,
            contentId,
            roundId,
            referenceRatingBps,
            targetRound,
            drandChainHash,
            ciphertext
        );

        commitKey = _commitKey(voter, commitHash);

        vm.startPrank(voter);
        lrepToken.approve(address(engine), stake);
        engine.commitVote(
            contentId,
            _roundContext(roundId, referenceRatingBps),
            targetRound,
            drandChainHash,
            commitHash,
            ciphertext,
            stake,
            frontend
        );
        vm.stopPrank();
    }

    function _commitWithTargetRound(
        address voter,
        uint256 contentId,
        bool isUp,
        uint256 stake,
        uint64 targetRound,
        string memory saltTag
    ) internal returns (bytes32 commitKey, bytes32 salt) {
        uint16 predictedUpBps = 5_000;
        salt = keccak256(abi.encodePacked(voter, isUp, targetRound, block.timestamp, saltTag));
        uint256 roundId = engine.previewCommitRoundId(contentId);
        uint16 referenceRatingBps = engine.previewCommitReferenceRatingBps(contentId);
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes memory ciphertext = _testCiphertext(isUp, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = TlockVoteLib.buildExpectedRbtsCommitHash(
            isUp,
            predictedUpBps,
            salt,
            voter,
            contentId,
            roundId,
            referenceRatingBps,
            targetRound,
            drandChainHash,
            ciphertext
        );

        commitKey = _commitKey(voter, commitHash);

        vm.startPrank(voter);
        lrepToken.approve(address(engine), stake);
        engine.commitVote(
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
    }

    function _recordAdvisory(address voter, uint256 contentId, string memory saltTag)
        internal
        returns (bytes32 advisoryCommitKey, bytes32 salt)
    {
        return _recordAdvisoryWithTargetRound(voter, contentId, saltTag, _tlockCommitTargetRound(engine, contentId));
    }

    function _openStakedRound(address voter, uint256 contentId, string memory saltTag)
        internal
        returns (uint64 targetRound)
    {
        targetRound = _tlockCommitTargetRound(engine, contentId);
        _commitWithTargetRound(voter, contentId, true, STAKE, targetRound, saltTag);
    }

    function _openStakedRoundWithTarget(address voter, uint256 contentId, uint64 targetRound, string memory saltTag)
        internal
    {
        _commitWithTargetRound(voter, contentId, true, STAKE, targetRound, saltTag);
    }

    function _recordAdvisoryWithTargetRound(address voter, uint256 contentId, string memory saltTag, uint64 targetRound)
        internal
        returns (bytes32 advisoryCommitKey, bytes32 salt)
    {
        uint256 roundId = engine.previewCommitRoundId(contentId);
        uint16 referenceRatingBps = engine.previewCommitReferenceRatingBps(contentId);
        bytes32 drandChainHash = _tlockDrandChainHash();
        salt = keccak256(abi.encodePacked(voter, block.timestamp, saltTag));
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = _commitHash(
            true, salt, voter, contentId, roundId, referenceRatingBps, targetRound, drandChainHash, ciphertext
        );

        vm.prank(voter);
        advisoryCommitKey = advisoryRecorder.recordAdvisoryVote(
            contentId, _roundContext(roundId, referenceRatingBps), targetRound, drandChainHash, commitHash, ciphertext
        );
    }

    function _expectCommitVoteRevert(
        address voter,
        uint256 contentId,
        bool isUp,
        uint256 stake,
        string memory saltTag,
        bytes4 selector
    ) internal {
        uint256 roundId = engine.previewCommitRoundId(contentId);
        uint16 referenceRatingBps = engine.previewCommitReferenceRatingBps(contentId);
        uint64 targetRound = _tlockCommitTargetRound(engine, contentId);
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 salt = keccak256(abi.encodePacked(voter, isUp, block.timestamp, saltTag));
        bytes memory ciphertext = _testCiphertext(isUp, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = TlockVoteLib.buildExpectedRbtsCommitHash(
            isUp, 5_000, salt, voter, contentId, roundId, referenceRatingBps, targetRound, drandChainHash, ciphertext
        );

        vm.startPrank(voter);
        lrepToken.approve(address(engine), stake);
        vm.expectRevert(selector);
        engine.commitVote(
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
    }

    function _expectAdvisoryRevert(address voter, uint256 contentId, string memory saltTag, bytes4 selector) internal {
        uint256 roundId = engine.previewCommitRoundId(contentId);
        uint16 referenceRatingBps = engine.previewCommitReferenceRatingBps(contentId);
        uint64 targetRound = _tlockCommitTargetRound(engine, contentId);
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 salt = keccak256(abi.encodePacked(voter, block.timestamp, saltTag));
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = _commitHash(
            true, salt, voter, contentId, roundId, referenceRatingBps, targetRound, drandChainHash, ciphertext
        );

        vm.prank(voter);
        vm.expectRevert(selector);
        advisoryRecorder.recordAdvisoryVote(
            contentId, _roundContext(roundId, referenceRatingBps), targetRound, drandChainHash, commitHash, ciphertext
        );
    }

    function _signPermit(uint256 privateKey, address tokenOwner, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, tokenOwner, address(engine), value, lrepToken.nonces(tokenOwner), deadline)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", lrepToken.DOMAIN_SEPARATOR(), structHash));
        return vm.sign(privateKey, digest);
    }

    function _commitWithPermit(uint256 privateKey, uint256 contentId, bool isUp, uint256 stake)
        internal
        returns (bytes32 commitKey, bytes32 salt)
    {
        address permitVoter = vm.addr(privateKey);
        salt = keccak256(abi.encodePacked(permitVoter, block.timestamp, "permit"));
        TestCommitArtifacts memory artifacts =
            _buildTestCommitArtifacts(address(engine), permitVoter, isUp, salt, contentId);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(privateKey, permitVoter, stake, deadline);

        vm.prank(permitVoter);
        engine.commitVoteWithPermit(
            contentId,
            _roundContext(artifacts.roundId, artifacts.roundReferenceRatingBps),
            artifacts.targetRound,
            artifacts.drandChainHash,
            artifacts.commitHash,
            artifacts.ciphertext,
            stake,
            address(0),
            deadline,
            v,
            r,
            s
        );

        return (artifacts.commitKey, salt);
    }

    function _maxAgeCiphertext() internal view returns (bytes memory ciphertext) {
        uint256 totalLength = 2_048;
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 salt = bytes32(uint256(1));
        bytes memory bestFit;
        bytes memory exactMatch;

        (exactMatch, bestFit) = _searchArmoredCiphertext(totalLength, targetRound, drandChainHash, salt, true);
        if (exactMatch.length > 0) return exactMatch;

        (exactMatch, ciphertext) = _searchArmoredCiphertext(totalLength, targetRound, drandChainHash, salt, false);
        if (exactMatch.length > 0) return exactMatch;
        if (ciphertext.length > bestFit.length) return ciphertext;
        if (bestFit.length == 0) revert("Unable to build max ciphertext");
        return bestFit;
    }

    function _searchArmoredCiphertext(
        uint256 totalLength,
        uint64 targetRound,
        bytes32 drandChainHash,
        bytes32 salt,
        bool newlineAfterHeader
    ) internal pure returns (bytes memory exactMatch, bytes memory bestFit) {
        uint256 coarseStep = 32;
        uint256 filler = 0;

        while (filler <= totalLength) {
            bytes memory payload = _testCiphertextPayload(true, salt, 0, targetRound, drandChainHash, filler);
            bytes memory candidate = _armoredTestCiphertext(payload, newlineAfterHeader);
            if (candidate.length == totalLength) return (candidate, bestFit);
            if (candidate.length < totalLength && candidate.length > bestFit.length) {
                bestFit = candidate;
            }
            if (candidate.length > totalLength) break;
            filler += coarseStep;
        }

        uint256 start = filler > coarseStep ? filler - coarseStep : 0;
        uint256 end = filler > totalLength ? totalLength : filler;

        for (uint256 fine = start; fine <= end; fine++) {
            bytes memory payload = _testCiphertextPayload(true, salt, 0, targetRound, drandChainHash, fine);
            bytes memory candidate = _armoredTestCiphertext(payload, newlineAfterHeader);
            if (candidate.length == totalLength) return (candidate, bestFit);
            if (candidate.length < totalLength && candidate.length > bestFit.length) {
                bestFit = candidate;
            }
        }
    }

    /// @dev Submit content as `submitter` and return contentId.
    function _submitContent() internal returns (uint256 contentId) {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/1", "test goal", "test goal", "test", 0);
        vm.stopPrank();
        contentId = 1;
    }

    /// @dev Submit content with a custom URL.
    function _submitContentWithUrl(string memory url) internal returns (uint256) {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, url, "test goal", "test goal", "test", 0);
        vm.stopPrank();
        return registry.nextContentId() - 1;
    }

    function _submitContentWithRoundConfig(string memory url, RoundLib.RoundConfig memory roundConfig)
        internal
        returns (uint256 contentId)
    {
        string[] memory imageUrls = _emptyImageUrls();
        string memory videoUrl = "";
        string memory title = "test goal";
        string memory description = "test goal";
        string memory tags = "test";
        uint256 categoryId = 1;

        address rewardEscrow = _ensureDefaultQuestionRewardPoolEscrow(registry);
        uint256 rewardAmount = _defaultSubmissionRewardAmount(registry);
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = _defaultSubmissionRewardTerms(registry);

        vm.startPrank(submitter);
        lrepToken.approve(rewardEscrow, rewardAmount);

        (, bytes32 submissionKey) =
            registry.previewQuestionSubmissionKey(url, imageUrls, videoUrl, title, description, tags, categoryId);
        bytes32 salt = _contentSubmissionSalt(url, submitter);
        bytes32 revealCommitment = _questionRevealCommitment(
            submissionKey,
            _submissionMediaHash(imageUrls, videoUrl),
            title,
            description,
            tags,
            categoryId,
            salt,
            submitter,
            rewardTerms,
            roundConfig,
            _defaultQuestionSpec()
        );

        registry.reserveSubmission(revealCommitment);
        vm.warp(block.timestamp + 1);
        contentId = registry.submitQuestionWithRewardAndRoundConfig(
            url,
            imageUrls,
            videoUrl,
            title,
            description,
            tags,
            categoryId,
            salt,
            rewardTerms,
            roundConfig,
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    /// @dev Register a frontend operator.
    function _registerFrontend(address fe) internal {
        mockRaterIdentityRegistry.setHolder(fe);
        vm.startPrank(fe);
        lrepToken.approve(address(frontendRegistry), 1000e6);
        frontendRegistry.register();
        vm.stopPrank();
    }

    /// @dev Full 3-voter round lifecycle: commit all epoch-1, warp past epoch, then reveal all.
    function _setupThreeVoterRound(bool v1Up, bool v2Up, bool v3Up)
        internal
        returns (uint256 contentId, uint256 roundId)
    {
        contentId = _submitContent();

        bytes32[3] memory commitKeys;
        bytes32[3] memory salts;
        uint16[3] memory predictions = [_predictionBps(0, v1Up), _predictionBps(1, v2Up), _predictionBps(2, v3Up)];
        (commitKeys[0], salts[0]) = _commitPrediction(voter1, contentId, v1Up, predictions[0], STAKE);
        (commitKeys[1], salts[1]) = _commitPrediction(voter2, contentId, v2Up, predictions[1], STAKE);
        (commitKeys[2], salts[2]) = _commitPrediction(voter3, contentId, v3Up, predictions[2], STAKE);

        roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Warp past epoch end so votes become revealable
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r0.startTime) + EPOCH);

        _revealPrediction(contentId, roundId, commitKeys[0], v1Up, predictions[0], salts[0]);
        _revealPrediction(contentId, roundId, commitKeys[1], v2Up, predictions[1], salts[1]);
        _revealPrediction(contentId, roundId, commitKeys[2], v3Up, predictions[2], salts[2]);
    }

    // =========================================================================
    // 1. BASIC ROUND LIFECYCLE: commit -> reveal -> settle (3 voters, epoch 1)
    // =========================================================================

    function test_PreviewCommitAvailability_NoRound_StartsNextRound() public {
        uint256 contentId = _submitContent();

        (bool canCommit, uint8 status, uint256 roundId, uint16 referenceRatingBps, bool willStartNewRound) =
            _previewCommitAvailability(contentId);

        assertTrue(canCommit);
        assertEq(status, COMMIT_STATUS_STARTS_NEXT_ROUND);
        assertEq(roundId, 1);
        assertEq(referenceRatingBps, _defaultRatingReferenceBps());
        assertTrue(willStartNewRound);
    }

    function test_PreviewCommitAvailability_OpenRound_AcceptsCurrentRound() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);

        (bool canCommit, uint8 status, uint256 roundId, uint16 referenceRatingBps, bool willStartNewRound) =
            _previewCommitAvailability(contentId);

        assertTrue(canCommit);
        assertEq(status, COMMIT_STATUS_OPEN);
        assertEq(roundId, 1);
        assertEq(referenceRatingBps, _defaultRatingReferenceBps());
        assertFalse(willStartNewRound);
    }

    function test_PreviewCommitAvailability_ExpiredAllSybilQuorum_StartsNextRound() public {
        uint256 contentId = _submitContent();

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, true, STAKE);
        _commit(voter3, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertFalse(engine.roundHasHumanVerifiedCommit(contentId, roundId));

        vm.warp(uint256(r0.startTime) + 7 days + 1);

        (bool canCommit, uint8 status, uint256 nextPreviewRoundId,, bool willStartNewRound) =
            _previewCommitAvailability(contentId);

        assertTrue(canCommit);
        assertEq(status, COMMIT_STATUS_STARTS_NEXT_ROUND);
        assertEq(nextPreviewRoundId, 2);
        assertEq(engine.previewCommitRoundId(contentId), 2);
        assertTrue(willStartNewRound);

        _commit(voter4, contentId, true, STAKE);

        RoundLib.Round memory cancelledRound = RoundEngineReadHelpers.round(engine, contentId, 1);
        assertEq(uint256(cancelledRound.state), uint256(RoundLib.RoundState.Cancelled));
        RoundLib.Round memory openRound = RoundEngineReadHelpers.round(engine, contentId, 2);
        assertEq(uint256(openRound.state), uint256(RoundLib.RoundState.Open));
        assertEq(openRound.voteCount, 1);
    }

    function test_PreviewCommitAvailability_RoundFull_BlocksCurrentRound() public {
        RoundLib.RoundConfig memory roundConfig =
            RoundLib.RoundConfig({ epochDuration: 1 hours, maxDuration: 7 days, minVoters: 3, maxVoters: 3 });
        uint256 contentId = _submitContentWithRoundConfig("https://example.com/full-round", roundConfig);

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, true, STAKE);
        _commit(voter3, contentId, false, STAKE);

        (bool canCommit, uint8 status, uint256 roundId,, bool willStartNewRound) = _previewCommitAvailability(contentId);

        assertFalse(canCommit);
        assertEq(status, COMMIT_STATUS_ROUND_FULL);
        assertEq(roundId, 1);
        assertFalse(willStartNewRound);
    }

    function test_PreviewCommitAvailability_ThresholdReached_WaitsForSettlement() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);

        (bool canCommit, uint8 status, uint256 previewRoundId,, bool willStartNewRound) =
            _previewCommitAvailability(contentId);

        assertFalse(canCommit);
        assertEq(status, COMMIT_STATUS_WAITING_FOR_SETTLEMENT);
        assertEq(previewRoundId, roundId);
        assertFalse(willStartNewRound);
    }

    function test_PreviewCommitAvailability_ExpiredHumanQuorum_WaitsForRevealGrace() public {
        mockRaterIdentityRegistry.setHolder(voter1);
        mockRaterIdentityRegistry.setHolder(voter2);
        mockRaterIdentityRegistry.setHolder(voter3);
        uint256 contentId = _submitContent();

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, true, STAKE);
        _commit(voter3, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertTrue(engine.roundHasHumanVerifiedCommit(contentId, roundId));

        vm.warp(uint256(r0.startTime) + 7 days + 1);

        (bool canCommit, uint8 status, uint256 previewRoundId,, bool willStartNewRound) =
            _previewCommitAvailability(contentId);

        assertFalse(canCommit);
        assertEq(status, COMMIT_STATUS_WAITING_FOR_REVEAL_GRACE);
        assertEq(previewRoundId, roundId);
        assertFalse(willStartNewRound);
    }

    function test_CommitVoteWithPermit_Succeeds() public {
        uint256 permitVoterKey = 0xA11CE;
        address permitVoter = vm.addr(permitVoterKey);
        vm.prank(owner);
        lrepToken.mint(permitVoter, 10_000e6);

        uint256 contentId = _submitContent();
        (bytes32 commitKey,) = _commitWithPermit(permitVoterKey, contentId, true, STAKE);

        RoundLib.Commit memory commit = RoundEngineReadHelpers.commit(engine, contentId, 1, commitKey);
        assertEq(commit.stakeAmount, STAKE);
        assertEq(lrepToken.nonces(permitVoter), 1);
        assertEq(lrepToken.allowance(permitVoter, address(engine)), 0);
        assertEq(lrepToken.balanceOf(address(engine)), STAKE);
    }

    function test_CommitVoteWithPermit_InvalidSignerReverts() public {
        uint256 permitVoterKey = 0xB0B;
        uint256 wrongKey = 0xCAFE;
        address permitVoter = vm.addr(permitVoterKey);
        vm.prank(owner);
        lrepToken.mint(permitVoter, 10_000e6);

        uint256 contentId = _submitContent();
        bytes32 salt = keccak256(abi.encodePacked(permitVoter, block.timestamp, "invalid-permit"));
        TestCommitArtifacts memory artifacts =
            _buildTestCommitArtifacts(address(engine), permitVoter, true, salt, contentId);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(wrongKey, permitVoter, STAKE, deadline);

        vm.prank(permitVoter);
        vm.expectRevert();
        engine.commitVoteWithPermit(
            contentId,
            _roundContext(artifacts.roundId, artifacts.roundReferenceRatingBps),
            artifacts.targetRound,
            artifacts.drandChainHash,
            artifacts.commitHash,
            artifacts.ciphertext,
            STAKE,
            address(0),
            deadline,
            v,
            r,
            s
        );
    }

    function test_CommitVoteWithPermit_ExpiredPermitReverts() public {
        uint256 permitVoterKey = 0xC0FFEE;
        address permitVoter = vm.addr(permitVoterKey);
        vm.prank(owner);
        lrepToken.mint(permitVoter, 10_000e6);

        uint256 contentId = _submitContent();
        bytes32 salt = keccak256(abi.encodePacked(permitVoter, block.timestamp, "expired-permit"));
        TestCommitArtifacts memory artifacts =
            _buildTestCommitArtifacts(address(engine), permitVoter, true, salt, contentId);
        uint256 deadline = block.timestamp - 1;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(permitVoterKey, permitVoter, STAKE, deadline);

        vm.prank(permitVoter);
        vm.expectRevert();
        engine.commitVoteWithPermit(
            contentId,
            _roundContext(artifacts.roundId, artifacts.roundReferenceRatingBps),
            artifacts.targetRound,
            artifacts.drandChainHash,
            artifacts.commitHash,
            artifacts.ciphertext,
            STAKE,
            address(0),
            deadline,
            v,
            r,
            s
        );
    }

    function test_BasicLifecycle_ThreeVoters_UpWins() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);

        _settleRoundAfterRbtsSeed(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
        assertTrue(round.upWins);
        assertGt(round.settledAt, 0);
    }

    function test_VerifiedHumanDoesNotBoostStakeWeight() public {
        RaterRegistry raterRegistry = _installRaterRegistry();

        vm.prank(owner);
        raterRegistry.seedHumanCredential(
            voter1, uint64(block.timestamp + 30 days), keccak256("curyo-voter-1"), keccak256("curyo-evidence")
        );

        uint256 contentId = _submitContent();
        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, 4e6);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, false, 4e6);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, true, 4e6);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r0.startTime) + EPOCH);

        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, false, s2);
        _reveal(contentId, roundId, ck3, true, s3);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(round.weightedUpPool, 8e6, "verified human status does not boost weight");
    }

    function test_RbtsLifecycle_SettlesBinaryRatingAndScoresRewards() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commitPrediction(voter1, contentId, true, 8_000, 10e6);
        (bytes32 ck2, bytes32 s2) = _commitPrediction(voter2, contentId, false, 5_000, 3e6);
        (bytes32 ck3, bytes32 s3) = _commitPrediction(voter3, contentId, true, 6_500, 3e6);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r0.startTime) + EPOCH);

        engine.revealVoteByCommitKey(contentId, roundId, ck1, true, 8_000, s1);
        engine.revealVoteByCommitKey(contentId, roundId, ck2, false, 5_000, s2);
        engine.revealVoteByCommitKey(contentId, roundId, ck3, true, 6_500, s3);
        assertEq(engine.roundRatingUpEvidence(contentId, roundId), 3_300_000, "rating uses bounded up signal evidence");
        assertEq(
            engine.roundRatingDownEvidence(contentId, roundId), 1_300_000, "rating uses bounded down signal evidence"
        );

        (bool scored, uint256 rewardWeight, uint256 forfeitedPool) = engine.roundRbtsStats(contentId, roundId);
        assertFalse(scored, "RBTS scores are stored at settlement");
        assertEq(rewardWeight, 0, "reward weight starts empty");
        assertEq(forfeitedPool, 0, "forfeited pool starts empty");

        _settleRoundAfterRbtsSeed(contentId, roundId);

        assertGt(registry.getRating(contentId), 5_000, "binary up majority moves rating up");
        (scored, rewardWeight, forfeitedPool) = engine.roundRbtsStats(contentId, roundId);
        assertTrue(scored, "RBTS scored");
        assertGt(rewardWeight, 0, "positive RBTS reward weight");
        assertGt(forfeitedPool, 0, "imperfect scores forfeit some stake");
        assertGt(engine.commitRbtsScoreBps(contentId, roundId, ck1), 0, "ck1 scored");
    }

    function test_RbtsSeedRequiresBlockAfterRevealThreshold() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commitPrediction(voter1, contentId, true, 8_000, 10e6);
        (bytes32 ck2, bytes32 s2) = _commitPrediction(voter2, contentId, false, 5_000, 3e6);
        (bytes32 ck3, bytes32 s3) = _commitPrediction(voter3, contentId, true, 6_500, 3e6);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r0.startTime) + EPOCH);

        engine.revealVoteByCommitKey(contentId, roundId, ck1, true, 8_000, s1);
        engine.revealVoteByCommitKey(contentId, roundId, ck2, false, 5_000, s2);
        engine.revealVoteByCommitKey(contentId, roundId, ck3, true, 6_500, s3);

        vm.expectRevert(RoundVotingEngine.RevealGraceActive.selector);
        engine.settleRound(contentId, roundId);

        _settleRoundAfterRbtsSeed(contentId, roundId);
        RoundLib.Round memory settledRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(settledRound.state), uint256(RoundLib.RoundState.Settled));
    }

    function test_RbtsExpiredSeedCanBeRefreshed() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commitPrediction(voter1, contentId, true, 8_000, 10e6);
        (bytes32 ck2, bytes32 s2) = _commitPrediction(voter2, contentId, false, 5_000, 3e6);
        (bytes32 ck3, bytes32 s3) = _commitPrediction(voter3, contentId, true, 6_500, 3e6);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r0.startTime) + EPOCH);

        engine.revealVoteByCommitKey(contentId, roundId, ck1, true, 8_000, s1);
        engine.revealVoteByCommitKey(contentId, roundId, ck2, false, 5_000, s2);
        engine.revealVoteByCommitKey(contentId, roundId, ck3, true, 6_500, s3);

        bytes32 originalMarker = engine.roundRbtsSeedEntropy(contentId, roundId);
        uint256 seedBlock = uint256(originalMarker) ^ (uint256(1) << 255);
        vm.roll(seedBlock + 257);

        vm.expectRevert(RoundVotingEngine.RevealGraceActive.selector);
        engine.settleRound(contentId, roundId);

        engine.refreshRbtsSeed(contentId, roundId);
        bytes32 refreshedMarker = engine.roundRbtsSeedEntropy(contentId, roundId);
        assertNotEq(refreshedMarker, originalMarker, "refresh captures a fresh seed block");
        assertEq(uint256(refreshedMarker) ^ (uint256(1) << 255), block.number, "refresh uses the current block");

        _settleRoundAfterRbtsSeed(contentId, roundId);
        RoundLib.Round memory settledRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(settledRound.state), uint256(RoundLib.RoundState.Settled));
    }

    function test_RbtsScoringSeed_UsesCapturedEntropyAndCommittedSet() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commitPrediction(voter1, contentId, true, 8_000, 10e6);
        (bytes32 ck2, bytes32 s2) = _commitPrediction(voter2, contentId, false, 5_000, 3e6);
        (bytes32 ck3, bytes32 s3) = _commitPrediction(voter3, contentId, true, 6_500, 3e6);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r0.startTime) + EPOCH);

        engine.revealVoteByCommitKey(contentId, roundId, ck1, true, 8_000, s1);
        engine.revealVoteByCommitKey(contentId, roundId, ck2, false, 5_000, s2);
        engine.revealVoteByCommitKey(contentId, roundId, ck3, true, 6_500, s3);

        bytes32 seedBlockMarker = engine.roundRbtsSeedEntropy(contentId, roundId);
        assertNotEq(seedBlockMarker, bytes32(0), "threshold reveal captures RBTS seed block");
        vm.recordLogs();
        _settleRoundAfterRbtsSeed(contentId, roundId);

        uint256 seedBlock = uint256(seedBlockMarker) ^ (uint256(1) << 255);
        bytes32 settlementEntropy = keccak256(
            abi.encode(
                "rateloop.rbts.delayed-seed.v1",
                block.chainid,
                address(engine),
                contentId,
                roundId,
                seedBlock,
                blockhash(seedBlock)
            )
        );

        bytes32 revealedSetHash;
        revealedSetHash = keccak256(abi.encodePacked(revealedSetHash, ck1));
        revealedSetHash = keccak256(abi.encodePacked(revealedSetHash, ck2));
        revealedSetHash = keccak256(abi.encodePacked(revealedSetHash, ck3));
        bytes32 expectedSeed = keccak256(
            abi.encode(
                block.chainid, address(engine), contentId, roundId, uint256(3), revealedSetHash, settlementEntropy
            )
        );

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 expectedTopic =
            keccak256("RbtsRewardsScored(uint256,uint256,bytes32,uint256,uint256,uint256,uint256,uint16)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (
                logs[i].emitter == address(engine) && logs[i].topics.length == 3 && logs[i].topics[0] == expectedTopic
                    && uint256(logs[i].topics[1]) == contentId && uint256(logs[i].topics[2]) == roundId
            ) {
                (bytes32 scoreSeed,,,,,) =
                    abi.decode(logs[i].data, (bytes32, uint256, uint256, uint256, uint256, uint16));
                assertEq(scoreSeed, expectedSeed, "score seed must use captured entropy");
                found = true;
                break;
            }
        }
        assertTrue(found, "RbtsRewardsScored event not emitted");
    }

    function test_RbtsScoringSeed_IgnoresSettlementPrevrandao() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commitPrediction(voter1, contentId, true, 8_000, 10e6);
        (bytes32 ck2, bytes32 s2) = _commitPrediction(voter2, contentId, false, 5_000, 3e6);
        (bytes32 ck3, bytes32 s3) = _commitPrediction(voter3, contentId, true, 6_500, 3e6);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r0.startTime) + EPOCH);

        engine.revealVoteByCommitKey(contentId, roundId, ck1, true, 8_000, s1);
        engine.revealVoteByCommitKey(contentId, roundId, ck2, false, 5_000, s2);
        engine.revealVoteByCommitKey(contentId, roundId, ck3, true, 6_500, s3);

        bytes32 seedBlockMarker = engine.roundRbtsSeedEntropy(contentId, roundId);
        assertNotEq(seedBlockMarker, bytes32(0), "threshold reveal captures RBTS seed block");

        bytes32 settlementPrevrandao = keccak256("settlement-prevrandao");
        vm.prevrandao(settlementPrevrandao);
        vm.recordLogs();
        _settleRoundAfterRbtsSeed(contentId, roundId);

        uint256 seedBlock = uint256(seedBlockMarker) ^ (uint256(1) << 255);
        bytes32 capturedEntropy = keccak256(
            abi.encode(
                "rateloop.rbts.delayed-seed.v1",
                block.chainid,
                address(engine),
                contentId,
                roundId,
                seedBlock,
                blockhash(seedBlock)
            )
        );

        bytes32 revealedSetHash;
        revealedSetHash = keccak256(abi.encodePacked(revealedSetHash, ck1));
        revealedSetHash = keccak256(abi.encodePacked(revealedSetHash, ck2));
        revealedSetHash = keccak256(abi.encodePacked(revealedSetHash, ck3));
        bytes32 expectedSeed = keccak256(
            abi.encode(block.chainid, address(engine), contentId, roundId, uint256(3), revealedSetHash, capturedEntropy)
        );
        bytes32 settlementSeed = keccak256(
            abi.encode(
                block.chainid, address(engine), contentId, roundId, uint256(3), revealedSetHash, settlementPrevrandao
            )
        );
        assertNotEq(expectedSeed, settlementSeed, "test setup needs distinct settlement entropy");
        assertEq(engine.roundRbtsSeedEntropy(contentId, roundId), capturedEntropy, "settlement finalizes delayed seed");

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 expectedTopic =
            keccak256("RbtsRewardsScored(uint256,uint256,bytes32,uint256,uint256,uint256,uint256,uint16)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (
                logs[i].emitter == address(engine) && logs[i].topics.length == 3 && logs[i].topics[0] == expectedTopic
                    && uint256(logs[i].topics[1]) == contentId && uint256(logs[i].topics[2]) == roundId
            ) {
                (bytes32 scoreSeed,,,,,) =
                    abi.decode(logs[i].data, (bytes32, uint256, uint256, uint256, uint256, uint16));
                assertEq(scoreSeed, expectedSeed, "score seed must ignore settlement prevrandao");
                found = true;
                break;
            }
        }
        assertTrue(found, "RbtsRewardsScored event not emitted");
    }

    function test_RbtsZeroStakeCommitRejectedByCountedVoting() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        bytes32 commitHash = _commitHash(true, salt, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);
        uint256 roundContext = _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(voter3);
        vm.expectRevert(RoundVotingEngine.InvalidStake.selector);
        engine.commitVote(
            contentId,
            roundContext,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            0,
            address(0)
        );
    }

    function test_RbtsBelowMinimumStakeCommitRejectedByCountedVoting() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        bytes32 commitHash = _commitHash(true, salt, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);
        uint256 roundContext = _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(voter4);
        vm.expectRevert(RoundVotingEngine.InvalidStake.selector);
        engine.commitVote(
            contentId,
            roundContext,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            999_999,
            address(0)
        );
    }

    function test_RbtsSettlementRequiresThreeReveals() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commitPrediction(voter1, contentId, true, 8_000, STAKE);
        (bytes32 ck2, bytes32 s2) = _commitPrediction(voter2, contentId, true, 5_000, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r0.startTime) + EPOCH);

        engine.revealVoteByCommitKey(contentId, roundId, ck1, true, 8_000, s1);
        engine.revealVoteByCommitKey(contentId, roundId, ck2, true, 5_000, s2);

        vm.expectRevert(RoundVotingEngine.NotEnoughVotes.selector);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Open));
        assertFalse(engine.roundRbtsScored(contentId, roundId), "RBTS not scored below n=3");
    }

    function test_RbtsRewardsScorePredictionAgainstPeerSignals() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commitPrediction(voter1, contentId, true, 5_750, STAKE);
        (bytes32 ck2, bytes32 s2) = _commitPrediction(voter2, contentId, false, 7_250, STAKE);
        (bytes32 ck3, bytes32 s3) = _commitPrediction(voter3, contentId, true, 6_500, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r0.startTime) + EPOCH);

        engine.revealVoteByCommitKey(contentId, roundId, ck1, true, 5_750, s1);
        engine.revealVoteByCommitKey(contentId, roundId, ck2, false, 7_250, s2);
        engine.revealVoteByCommitKey(contentId, roundId, ck3, true, 6_500, s3);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        assertGt(registry.getRating(contentId), 5_000, "binary signal remains public rating input");
        assertEq(engine.commitPredictedUpBps(contentId, roundId, ck2), 7_250, "crowd prediction stored");
        assertGt(engine.commitRbtsScoreBps(contentId, roundId, ck1), 0, "ck1 RBTS score");
        assertGt(engine.commitRbtsScoreBps(contentId, roundId, ck2), 0, "ck2 RBTS score");
        assertGt(engine.commitRbtsScoreBps(contentId, roundId, ck3), 0, "ck3 RBTS score");
    }

    function test_RbtsRevealRejectsWrongPrediction() public {
        uint256 contentId = _submitContent();
        (bytes32 commitKey, bytes32 salt) = _commitPrediction(voter1, contentId, 7_000, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory r0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(r0.startTime) + EPOCH);

        vm.expectRevert();
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, true, 7_001, salt);
    }

    function test_BasicLifecycle_ThreeVoters_DownWins() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, false, false);

        _settleRoundAfterRbtsSeed(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
        assertFalse(round.upWins);
    }

    function test_BasicLifecycle_VoteCountersUpdated() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(round.voteCount, 2);
        assertEq(round.totalStake, STAKE * 2);

        // Warp past epoch and reveal
        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, false, s2);

        round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(round.revealedCount, 2);
        assertEq(round.upPool, STAKE);
        assertEq(round.downPool, STAKE);
        assertEq(round.upCount, 1);
        assertEq(round.downCount, 1);
    }

    function test_BasicLifecycle_CommitHashTracked() public {
        uint256 contentId = _submitContent();

        bool isUp = true;
        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        bytes32 commitHash = _commitHash(isUp, salt, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);

        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext1 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        engine.commitVote(
            contentId,
            cachedRoundContext1,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        assertEq(engine.voterCommitHash(contentId, roundId, voter1), commitHash);
        assertTrue(engine.voterCommitHash(contentId, roundId, voter1) != bytes32(0));
    }

    function test_CommitVote_RevertsWhenPreviewedRoundIsStale() public {
        uint256 contentId = _submitContent();
        TestCommitArtifacts memory staleCommit = _buildTestCommitArtifacts(
            address(engine), voter4, true, keccak256(abi.encodePacked(voter4, "stale-round")), contentId
        );

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, true, STAKE);
        _commit(voter3, contentId, false, STAKE);

        vm.warp(block.timestamp + 8 days);

        vm.startPrank(voter4);
        lrepToken.approve(address(engine), STAKE);
        vm.expectRevert(RoundVotingEngine.InvalidCommitHash.selector);
        engine.commitVote(
            contentId,
            _roundContext(staleCommit.roundId, staleCommit.roundReferenceRatingBps),
            staleCommit.targetRound,
            staleCommit.drandChainHash,
            staleCommit.commitHash,
            staleCommit.ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }

    function test_BasicLifecycle_HasCommitsTurnsTrue() public {
        uint256 contentId = _submitContent();
        assertFalse(engine.hasCommits(contentId));

        _commit(voter1, contentId, true, STAKE);
        assertTrue(engine.hasCommits(contentId));

        _commit(voter2, contentId, false, STAKE);
        assertTrue(engine.hasCommits(contentId));
    }

    function test_BasicLifecycle_VoterPoolAndWinningStake() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);

        _settleRoundAfterRbtsSeed(contentId, roundId);

        uint256 voterPool = engine.roundVoterPool(contentId, roundId);
        uint256 winningStake = engine.roundWinningStake(contentId, roundId);
        assertGt(voterPool, 0);
        assertGt(winningStake, 0);
    }

    function test_BasicLifecycle_SettlementSetsTimestamp() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);

        _settleRoundAfterRbtsSeed(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertGt(round.settledAt, 0);
    }

    // =========================================================================
    // 2. ROUND EXPIRY / CANCELLATION (minVoters not reached)
    // =========================================================================

    function test_CancelExpired_SucceedsAfterMaxDuration() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        // Only 2 commits — minVoters=3 not reached

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Warp past 7-day max duration
        vm.warp(block.timestamp + 7 days + 1);

        engine.cancelExpiredRound(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Cancelled));
    }

    function test_CommitAfterExpiredBelowQuorum_StartsNewRound() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        vm.warp(uint256(round.startTime) + 7 days + 1);

        _commit(voter3, contentId, true, STAKE);

        RoundLib.Round memory cancelledRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        uint256 newRoundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        assertEq(uint256(cancelledRound.state), uint256(RoundLib.RoundState.Cancelled));
        assertEq(newRoundId, roundId + 1, "new commits roll into a fresh round after below-quorum expiry");
        assertTrue(engine.voterCommitHash(contentId, newRoundId, voter3) != bytes32(0));
    }

    function test_CancelExpired_RevertsBeforeExpiry() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Only 1 day elapsed
        vm.warp(block.timestamp + 1 days);

        vm.expectRevert(RoundVotingEngine.RoundNotExpired.selector);
        engine.cancelExpiredRound(contentId, roundId);
    }

    function test_CancelExpired_RevertsIfThresholdAlreadyReached() public {
        uint256 contentId = _submitContent();

        // L-Vote-4: cancel-lockout requires both commit quorum AND ≥1 HRC-verified commit.
        // Mark voter1 as HRC so the lockout engages.
        mockRaterIdentityRegistry.setHolder(voter1);

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Warp past epoch and reveal all (threshold reached)
        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, false, s3);

        // Warp past max duration — but threshold was reached so cancel should fail
        vm.warp(block.timestamp + 7 days + 1);

        vm.expectRevert(RoundVotingEngine.ThresholdReached.selector);
        engine.cancelExpiredRound(contentId, roundId);
    }

    function test_CancelExpired_RevertsIfCommitQuorumReachedWithoutReveals() public {
        uint256 contentId = _submitContent();

        // L-Vote-4: cancel-lockout requires both commit quorum AND ≥1 HRC-verified commit.
        mockRaterIdentityRegistry.setHolder(voter1);

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        vm.warp(block.timestamp + 7 days + 1);

        vm.expectRevert(RoundVotingEngine.ThresholdReached.selector);
        engine.cancelExpiredRound(contentId, roundId);
    }

    /// @notice L-Vote-4: if no HRC voter participates, an expired round at commit quorum is
    ///         still refund-cancellable. Sybils cannot grief honest content into a RevealFailed
    ///         cycle at 3× min-stake.
    function test_CancelExpired_AllSybilQuorum_Cancellable() public {
        uint256 contentId = _submitContent();

        // No HRC seeding — all 3 voters are non-HRC.
        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        vm.warp(block.timestamp + 7 days + 1);

        // No HRC commit -> cancel-lockout does not engage even at commit quorum 3.
        engine.cancelExpiredRound(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Cancelled));
        assertFalse(engine.roundHasHumanVerifiedCommit(contentId, roundId));
    }

    function test_CancelExpired_AllSybilRevealQuorum_SettlementWins() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, false, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        RoundLib.Round memory startRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(startRound.startTime) + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, false, s2);
        _reveal(contentId, roundId, ck3, true, s3);

        vm.warp(block.timestamp + 7 days + 1);
        vm.expectRevert(RoundVotingEngine.ThresholdReached.selector);
        engine.cancelExpiredRound(contentId, roundId);

        _settleRoundAfterRbtsSeed(contentId, roundId);
        RoundLib.Round memory settledRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(settledRound.state), uint256(RoundLib.RoundState.Settled));
        assertFalse(engine.roundHasHumanVerifiedCommit(contentId, roundId));
    }

    /// @notice L-Vote-4: once any HRC voter has committed, subsequent non-HRC sybil commits
    ///         still engage the cancel-lockout. The flag is sticky for the round.
    function test_CancelExpired_HrcThenSybils_LockoutStillEngages() public {
        uint256 contentId = _submitContent();

        // voter1 is HRC, voters 2/3 are not.
        mockRaterIdentityRegistry.setHolder(voter1);
        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        assertTrue(engine.roundHasHumanVerifiedCommit(contentId, roundId));

        vm.warp(block.timestamp + 7 days + 1);

        vm.expectRevert(RoundVotingEngine.ThresholdReached.selector);
        engine.cancelExpiredRound(contentId, roundId);
    }

    function test_CancelExpired_RevertsIfRoundNotOpen() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        vm.expectRevert(RoundVotingEngine.RoundNotOpen.selector);
        engine.cancelExpiredRound(contentId, roundId);
    }

    // =========================================================================
    // 3. CANNOT COMMIT TWICE TO THE SAME ROUND
    // =========================================================================

    function test_CommitTwice_SameRound_Reverts() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);

        // voter1 tries to commit again within the same round (cooldown also applies)
        // The cooldown check fires first; warp past cooldown to isolate AlreadyCommitted
        // Actually: hasCommitted check fires before cooldown is re-checked on second call
        // In the contract: cooldown check fires FIRST (lastVoteTimestamp > 0 and within 24h)
        // So we need to check CooldownActive fires first
        vm.startPrank(voter1);
        bytes32 salt2 = keccak256(abi.encodePacked(voter1, block.timestamp + 1));
        bytes32 commitHash2 = _commitHash(true, salt2, contentId);
        bytes memory ciphertext2 = _testCiphertext(true, salt2, contentId);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext2 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.expectRevert(RoundVotingEngine.CooldownActive.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext2,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash2,
            ciphertext2,
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }

    function test_CommitTwice_AfterCooldown_SameRound_RevertsAlreadyCommitted() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);

        // Warp past 24h cooldown — but round is still open and voter already committed
        vm.warp(block.timestamp + 25 hours);

        vm.startPrank(voter1);
        bytes32 salt2 = keccak256(abi.encodePacked(voter1, block.timestamp));
        bytes32 commitHash2 = _commitHash(true, salt2, contentId);
        bytes memory ciphertext2 = _testCiphertext(true, salt2, contentId);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext3 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.expectRevert(RoundVotingEngine.AlreadyCommitted.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext3,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash2,
            ciphertext2,
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }

    function test_CommitAfterDelegateAddressIdentityChurn_RevertsAlreadyCommitted() public {
        uint256 contentId = _submitContent();
        vm.prank(voter1);
        mockRaterIdentityRegistry.setDelegate(delegate1);
        _commit(delegate1, contentId, true, STAKE);

        mockRaterIdentityRegistry.mint(voter1, 42);
        vm.warp(block.timestamp + 25 hours);

        _expectCommitVoteRevert(
            voter1,
            contentId,
            false,
            STAKE,
            "direct-after-delegate-identity-churn",
            RoundVotingEngine.AlreadyCommitted.selector
        );
    }

    function test_DelegateCommitAfterHolderAddressIdentityChurn_RevertsAlreadyCommitted() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);

        mockRaterIdentityRegistry.mint(voter1, 42);
        vm.prank(voter1);
        mockRaterIdentityRegistry.setDelegate(delegate1);
        vm.warp(block.timestamp + 25 hours);

        _expectCommitVoteRevert(
            delegate1,
            contentId,
            false,
            STAKE,
            "delegate-after-direct-identity-churn",
            RoundVotingEngine.AlreadyCommitted.selector
        );
    }

    function test_CommitSameNullifierAfterRemint_SameRound_RevertsAlreadyCommitted() public {
        vm.prank(owner);
        ProtocolConfig(protocolConfigAddress).setRaterRegistry(address(mockRaterIdentityRegistry));

        mockRaterIdentityRegistry.mint(submitter, 9_001);
        mockRaterIdentityRegistry.mint(voter1, 42);

        uint256 contentId = _submitContent();
        (bytes32 originalCommitKey,) = _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        mockRaterIdentityRegistry.revokeHumanCredential(voter1);
        mockRaterIdentityRegistry.resetNullifier(42);
        mockRaterIdentityRegistry.mint(voter2, 42);

        vm.warp(block.timestamp + 25 hours);

        bytes32 salt2 = keccak256(abi.encodePacked(voter2, block.timestamp, "remint"));
        bytes32 commitHash2 = _commitHash(false, salt2, contentId);
        bytes memory ciphertext2 = _testCiphertext(false, salt2, contentId);

        vm.startPrank(voter2);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext4 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.expectRevert(RoundVotingEngine.AlreadyCommitted.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext4,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash2,
            ciphertext2,
            STAKE,
            address(0)
        );
        vm.stopPrank();

        assertEq(engine.identityCommitKey(contentId, roundId, bytes32(uint256(42))), originalCommitKey);
    }

    function test_CommitSameNullifierAfterRemint_NewRoundRespectsCooldown() public {
        vm.prank(owner);
        ProtocolConfig(protocolConfigAddress).setRaterRegistry(address(mockRaterIdentityRegistry));

        mockRaterIdentityRegistry.mint(submitter, 9_001);
        mockRaterIdentityRegistry.mint(voter1, 42);
        mockRaterIdentityRegistry.mint(voter2, 43);
        mockRaterIdentityRegistry.mint(voter3, 44);

        uint256 contentId = _submitContent();
        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, false, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, false, s3);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        mockRaterIdentityRegistry.revokeHumanCredential(voter1);
        mockRaterIdentityRegistry.resetNullifier(42);
        mockRaterIdentityRegistry.mint(voter4, 42);

        bytes32 salt2 = keccak256(abi.encodePacked(voter4, block.timestamp, "remint-cooldown"));
        bytes32 commitHash2 = _commitHash(false, salt2, contentId);
        bytes memory ciphertext2 = _testCiphertext(false, salt2, contentId);

        vm.startPrank(voter4);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext =
            _roundContext(engine.previewCommitRoundId(contentId), registry.getRating(contentId));
        vm.expectRevert(RoundVotingEngine.CooldownActive.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash2,
            ciphertext2,
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }

    // =========================================================================
    // 4. CANNOT REVEAL BEFORE EPOCH ENDS (EpochNotEnded)
    // =========================================================================

    function test_Reveal_BeforeEpochEnd_Reverts() public {
        uint256 contentId = _submitContent();

        (bytes32 commitKey, bytes32 salt) = _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Do NOT warp — epoch has not ended yet
        vm.expectRevert(RoundVotingEngine.EpochNotEnded.selector);
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, true, 5_000, salt);
    }

    function test_Reveal_ExactlyAtEpochEnd_Succeeds() public {
        uint256 contentId = _submitContent();

        (bytes32 commitKey, bytes32 salt) = _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Warp to exactly one second after epoch end
        _warpPastTlockRevealTime(block.timestamp + EPOCH);

        // Should not revert
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, true, 5_000, salt);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(round.revealedCount, 1);
    }

    // =========================================================================
    // 5. WRONG HASH ON REVEAL (HashMismatch)
    // =========================================================================

    function test_Reveal_WrongIsUp_HashMismatch() public {
        uint256 contentId = _submitContent();

        // Commit as isUp=true
        (bytes32 commitKey, bytes32 salt) = _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);

        // Reveal with isUp=false (wrong direction — hash won't match)
        vm.expectRevert(RoundVotingEngine.HashMismatch.selector);
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, false, 5_000, salt);
    }

    function test_Reveal_WrongSalt_HashMismatch() public {
        uint256 contentId = _submitContent();

        (bytes32 commitKey,) = _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);

        bytes32 wrongSalt = keccak256("wrong");
        vm.expectRevert(RoundVotingEngine.HashMismatch.selector);
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, true, 5_000, wrongSalt);
    }

    function test_Reveal_TamperedCiphertext_HashMismatch() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        bytes memory honestCiphertext = _testCiphertext(true, salt, contentId);
        bytes memory tamperedCiphertext = _testCiphertext(false, salt, contentId);
        bytes32 commitHash = _commitHash(true, salt, contentId, honestCiphertext);

        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext5 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        engine.commitVote(
            contentId,
            cachedRoundContext5,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            tamperedCiphertext,
            STAKE,
            address(0)
        );

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        bytes32 commitKey = keccak256(abi.encodePacked(voter1, commitHash));

        _warpPastTlockRevealTime(block.timestamp + EPOCH);

        vm.expectRevert(RoundVotingEngine.HashMismatch.selector);
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, true, 5_000, salt);
    }

    function test_Reveal_BeforeCommittedDrandRound_Reverts() public {
        // Align epoch end to a drand boundary so +1 is still inside the accepted target window.
        vm.warp(T0 + 2);
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        uint64 targetRound = _tlockCommitTargetRound() + 1;
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, _tlockDrandChainHash());
        bytes32 commitHash = _commitHash(true, salt, voter1, contentId, targetRound, _tlockDrandChainHash(), ciphertext);

        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext6 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        engine.commitVote(
            contentId,
            cachedRoundContext6,
            targetRound,
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        bytes32 commitKey = _commitKey(voter1, commitHash);
        (, uint64 storedTargetRound,, uint256 revealableAfter,,) =
            engine.commitRevealData(contentId, roundId, commitKey);
        uint256 targetRoundRevealableAt = _tlockRoundTimestamp(storedTargetRound);
        assertEq(
            revealableAfter > targetRoundRevealableAt ? revealableAfter : targetRoundRevealableAt,
            targetRoundRevealableAt
        );

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        vm.expectRevert(RoundVotingEngine.EpochNotEnded.selector);
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, true, 5_000, salt);

        vm.warp(_tlockRoundTimestamp(targetRound));
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, true, 5_000, salt);
    }

    function test_Reveal_NonExistentCommitKey_Reverts() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);

        bytes32 badKey = keccak256("bogus");
        vm.expectRevert(RoundVotingEngine.TargetRoundOutOfWindow.selector);
        engine.revealVoteByCommitKey(contentId, roundId, badKey, true, 5_000, bytes32(0));
    }

    function test_Reveal_AlreadyRevealed_Reverts() public {
        uint256 contentId = _submitContent();

        (bytes32 commitKey, bytes32 salt) = _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(contentId, roundId, commitKey, true, salt);

        // Try to reveal again
        vm.expectRevert(RoundVotingEngine.AlreadyRevealed.selector);
        engine.revealVoteByCommitKey(contentId, roundId, commitKey, true, 5_000, salt);
    }

    // =========================================================================
    // 6. IMMEDIATE SETTLEMENT AFTER THRESHOLD
    // =========================================================================

    function test_Settle_ImmediatelyAfterThreshold_Succeeds() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Warp past epoch and reveal all
        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, false, s3);

        // Settlement succeeds once the delayed RBTS seed block is available.
        _settleRoundAfterRbtsSeed(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
    }

    function test_Settle_AfterDelay_Succeeds() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);

        // Settlement succeeds once the delayed RBTS seed block is available.
        _settleRoundAfterRbtsSeed(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
    }

    function test_Settle_NotEnoughVoters_Reverts() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, false, STAKE);
        // Only 2 voters, minVoters=3

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, false, s2);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);

        vm.expectRevert(RoundVotingEngine.NotEnoughVotes.selector);
        _settleRoundAfterRbtsSeed(contentId, roundId);
    }

    function test_Settle_RoundNotOpen_Reverts() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        // Try to settle again
        vm.expectRevert(RoundVotingEngine.RoundNotOpen.selector);
        _settleRoundAfterRbtsSeed(contentId, roundId);
    }

    // =========================================================================
    // 7. TIED ROUND (equal weighted pools)
    // =========================================================================

    function test_TiedRound_EqualPools_StateIsTied() public {
        uint256 contentId = _submitContent();

        // 1 UP, 1 DOWN with same stake and same epoch weight -> equal weighted pools
        // We need at least 3 voters for minVoters. Use 2 UP + 2 DOWN but same stake.
        // To get tied: 2 UP voters at STAKE + 1 DOWN voter at 2*STAKE, or simply 1 UP + 1 DOWN
        // with minVoters=3 we need at least 3 reveals. Let's do 2 UP + 2 DOWN for a tie with equal stakes.
        // But minVoters=3 so we need 3 reveals.
        // Tie: 1.5 UP vs 1.5 DOWN effectively -- let's do STAKE on each side * matching counts.
        // Simplest: voter1 UP STAKE, voter2 DOWN STAKE, voter3 UP STAKE... that's 2 UP 1 DOWN no tie.
        // For a tie with 3 voters: voter1 UP 2*STAKE, voter2 DOWN 2*STAKE + voter3 UP 2*STAKE... no.
        // Tie means weightedUpPool == weightedDownPool. All epoch-1 (weight=100%).
        // We need sum(UP stakes) == sum(DOWN stakes).
        // 3 voters: voter1 UP 2e6, voter2 DOWN 3e6, voter3 UP 1e6 -> up=3e6, down=3e6 -> TIE.
        uint256 s1 = 2e6;
        uint256 s2 = 3e6;
        uint256 s3 = 1e6;

        (bytes32 ck1, bytes32 salt1) = _commit(voter1, contentId, true, s1);
        (bytes32 ck2, bytes32 salt2) = _commit(voter2, contentId, false, s2);
        (bytes32 ck3, bytes32 salt3) = _commit(voter3, contentId, true, s3);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(contentId, roundId, ck1, true, salt1);
        _reveal(contentId, roundId, ck2, false, salt2);
        _reveal(contentId, roundId, ck3, true, salt3);

        _settleRoundAfterRbtsSeed(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Tied));
    }

    function test_TiedRound_EvenStake_ThreeVoters() public {
        uint256 contentId = _submitContent();

        // voter1 UP 2*STAKE, voter2 DOWN STAKE, voter3 DOWN STAKE -> up pool = 2*STAKE, down pool = 2*STAKE => TIE
        uint256 upStake = 2 * STAKE;
        uint256 downStake = STAKE;

        (bytes32 ck1, bytes32 salt1) = _commit(voter1, contentId, true, upStake);
        (bytes32 ck2, bytes32 salt2) = _commit(voter2, contentId, false, downStake);
        (bytes32 ck3, bytes32 salt3) = _commit(voter3, contentId, false, downStake);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(contentId, roundId, ck1, true, salt1);
        _reveal(contentId, roundId, ck2, false, salt2);
        _reveal(contentId, roundId, ck3, false, salt3);

        _settleRoundAfterRbtsSeed(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Tied));
    }

    // =========================================================================
    // 8. CANCELLED ROUND REFUND
    // =========================================================================

    function test_CancelledRefund_ClaimSucceeds() public {
        uint256 contentId = _submitContent();

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        vm.warp(block.timestamp + 7 days + 1);
        engine.cancelExpiredRound(contentId, roundId);

        uint256 balBefore = lrepToken.balanceOf(voter1);
        vm.prank(voter1);
        engine.claimCancelledRoundRefund(contentId, roundId);
        uint256 balAfter = lrepToken.balanceOf(voter1);

        assertEq(balAfter - balBefore, STAKE);
    }

    function test_CancelledRefund_CannotClaimTwice() public {
        uint256 contentId = _submitContent();

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        vm.warp(block.timestamp + 7 days + 1);
        engine.cancelExpiredRound(contentId, roundId);

        vm.prank(voter1);
        engine.claimCancelledRoundRefund(contentId, roundId);

        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.AlreadyClaimed.selector);
        engine.claimCancelledRoundRefund(contentId, roundId);
    }

    function test_CancelledRefund_NonParticipantReverts() public {
        uint256 contentId = _submitContent();

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        vm.warp(block.timestamp + 7 days + 1);
        engine.cancelExpiredRound(contentId, roundId);

        vm.prank(voter3);
        vm.expectRevert(RoundVotingEngine.NoCommit.selector);
        engine.claimCancelledRoundRefund(contentId, roundId);
    }

    function test_CancelledRefund_RequiresCancelledOrTiedState() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Round is still Open — should revert
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.RoundNotCancelledOrTied.selector);
        engine.claimCancelledRoundRefund(contentId, roundId);
    }

    function test_TiedRefund_ClaimSucceeds() public {
        uint256 contentId = _submitContent();

        // 2 UP 2 DOWN same stake -> tie (4 voters, all equal weight)
        uint256 up = STAKE;
        uint256 dn = STAKE;
        _commit(voter1, contentId, true, up);
        _commit(voter2, contentId, false, dn);
        // Use a different stake to force a 3-voter tie: up=STAKE, down=STAKE via voter2, voter3
        // Actually equal total: voter1 UP STAKE, voter2 DOWN STAKE is a 2-voter situation.
        // We need 3. Use voter1 UP 2*STAKE, voter2 DOWN STAKE, voter3 DOWN STAKE.
        _commit(voter3, contentId, true, up);
        // up = 2*STAKE, down = STAKE -> NOT tied. Redo.

        // Reset contentId for a fresh tied scenario
        // voter4 is our 3rd voter for this content
        // Already committed 3 (voter1, voter2, voter3) above with 2UP 1DOWN -> not tied
        // Let's use a second content for clarity
        uint256 cid2 = _submitContentWithUrl("https://example.com/tied");

        uint256 tieStake = 2e6;
        _commit(voter4, cid2, true, tieStake);
        _commit(voter5, cid2, false, tieStake);
        _commit(voter6, cid2, true, tieStake);
        // up = 2*tieStake, down = tieStake -> NOT tied

        // Use content 3 with truly equal pools
        uint256 cid3 = _submitContentWithUrl("https://example.com/tied2");
        uint256 stakeUp = 2e6;
        uint256 stakeDown = 3e6;
        uint256 stakeUp2 = 1e6;

        (bytes32 xck1, bytes32 xs1) = _commit(voter1, cid3, true, stakeUp);
        (bytes32 xck2, bytes32 xs2) = _commit(voter2, cid3, false, stakeDown);
        (bytes32 xck3, bytes32 xs3) = _commit(voter3, cid3, true, stakeUp2);

        uint256 xRoundId = RoundEngineReadHelpers.activeRoundId(engine, cid3);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(cid3, xRoundId, xck1, true, xs1);
        _reveal(cid3, xRoundId, xck2, false, xs2);
        _reveal(cid3, xRoundId, xck3, true, xs3);

        _settleRoundAfterRbtsSeed(cid3, xRoundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, cid3, xRoundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Tied));

        // voter1 claims refund from tied round
        uint256 balBefore = lrepToken.balanceOf(voter1);
        vm.prank(voter1);
        engine.claimCancelledRoundRefund(cid3, xRoundId);
        uint256 balAfter = lrepToken.balanceOf(voter1);

        assertEq(balAfter - balBefore, stakeUp);
    }

    // =========================================================================
    // 9. FRONTEND FEE CLAIMING
    // =========================================================================

    function test_FrontendFee_EligibleFrontend_FeeAccumulated() public {
        _registerFrontend(frontend1);

        uint256 contentId = _submitContent();

        uint16 p1 = _predictionBps(0, true);
        uint16 p2 = _predictionBps(1, true);
        uint16 p3 = _predictionBps(2, false);
        (bytes32 ck1, bytes32 s1) = _commitPredictionWithFrontend(voter1, contentId, true, p1, STAKE, frontend1);
        (bytes32 ck2, bytes32 s2) = _commitPrediction(voter2, contentId, true, p2, STAKE);
        (bytes32 ck3, bytes32 s3) = _commitPrediction(voter3, contentId, false, p3, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Reveal after epoch
        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _revealPrediction(contentId, roundId, ck1, true, p1, s1);
        _revealPrediction(contentId, roundId, ck2, true, p2, s2);
        _revealPrediction(contentId, roundId, ck3, false, p3, s3);

        _settleRoundAfterRbtsSeed(contentId, roundId);
        uint256 feesBefore = frontendRegistry.getAccumulatedFees(frontend1);
        vm.prank(frontend1);
        rewardDistributor.claimFrontendFee(contentId, roundId, frontend1);
        uint256 feesAfter = frontendRegistry.getAccumulatedFees(frontend1);

        assertGt(feesAfter - feesBefore, 0);
    }

    function test_FrontendFee_ClaimSucceeds() public {
        _registerFrontend(frontend1);

        uint256 contentId = _submitContent();

        uint16 p1 = _predictionBps(0, true);
        uint16 p2 = _predictionBps(1, true);
        uint16 p3 = _predictionBps(2, false);
        (bytes32 ck1, bytes32 s1) = _commitPredictionWithFrontend(voter1, contentId, true, p1, STAKE, frontend1);
        (bytes32 ck2, bytes32 s2) = _commitPrediction(voter2, contentId, true, p2, STAKE);
        (bytes32 ck3, bytes32 s3) = _commitPrediction(voter3, contentId, false, p3, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _revealPrediction(contentId, roundId, ck1, true, p1, s1);
        _revealPrediction(contentId, roundId, ck2, true, p2, s2);
        _revealPrediction(contentId, roundId, ck3, false, p3, s3);

        _settleRoundAfterRbtsSeed(contentId, roundId);

        uint256 feesBefore = frontendRegistry.getAccumulatedFees(frontend1);
        vm.prank(frontend1);
        rewardDistributor.claimFrontendFee(contentId, roundId, frontend1);
        uint256 feesAfter = frontendRegistry.getAccumulatedFees(frontend1);

        assertGt(feesAfter - feesBefore, 0);
    }

    function test_FrontendFee_CannotClaimTwice() public {
        _registerFrontend(frontend1);

        uint256 contentId = _submitContent();

        uint16 p1 = _predictionBps(0, true);
        uint16 p2 = _predictionBps(1, true);
        uint16 p3 = _predictionBps(2, false);
        (bytes32 ck1, bytes32 s1) = _commitPredictionWithFrontend(voter1, contentId, true, p1, STAKE, frontend1);
        (bytes32 ck2, bytes32 s2) = _commitPrediction(voter2, contentId, true, p2, STAKE);
        (bytes32 ck3, bytes32 s3) = _commitPrediction(voter3, contentId, false, p3, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _revealPrediction(contentId, roundId, ck1, true, p1, s1);
        _revealPrediction(contentId, roundId, ck2, true, p2, s2);
        _revealPrediction(contentId, roundId, ck3, false, p3, s3);

        _settleRoundAfterRbtsSeed(contentId, roundId);

        vm.prank(frontend1);
        rewardDistributor.claimFrontendFee(contentId, roundId, frontend1);

        vm.expectRevert(RoundVotingEngine.AlreadyClaimed.selector);
        vm.prank(frontend1);
        rewardDistributor.claimFrontendFee(contentId, roundId, frontend1);
    }

    function test_FrontendFee_IneligibleFrontend_NotTracked() public {
        // Register, then start exit so the frontend is ineligible at commit time
        vm.startPrank(frontend1);
        lrepToken.approve(address(frontendRegistry), 1000e6);
        frontendRegistry.register();
        frontendRegistry.requestDeregister();
        vm.stopPrank();

        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commitWithFrontend(voter1, contentId, true, STAKE, frontend1);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, false, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, false, s3);

        _settleRoundAfterRbtsSeed(contentId, roundId);

        vm.expectRevert(RoundRewardDistributor.NoPool.selector);
        vm.prank(frontend1);
        rewardDistributor.claimFrontendFee(contentId, roundId, frontend1);
    }

    function test_FrontendFee_ClaimReverts_RoundNotSettled() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        vm.expectRevert(RoundRewardDistributor.RoundNotSettled.selector);
        rewardDistributor.claimFrontendFee(contentId, roundId, frontend1);
    }

    function test_FrontendFee_ClaimReverts_NoPool() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        // No frontend pool (no eligible frontends were used)
        vm.expectRevert(RoundRewardDistributor.NoPool.selector);
        rewardDistributor.claimFrontendFee(contentId, roundId, frontend1);
    }

    // =========================================================================
    // 10. processUnrevealedVotes
    // =========================================================================

    function test_ProcessUnrevealed_SettledRoundAddsExpiredUnrevealedVotesToReserve() public {
        _registerFrontend(frontend1);
        uint256 contentId = _submitContent();

        // voter1 commits but never reveals. After per-commit reveal grace, the honest revealed
        // quorum settles and voter1's stake is cleaned into the reserve.
        _commit(voter1, contentId, true, STAKE);

        // voter2, voter3, voter4 commit and reveal (3 = minVoters)
        (bytes32 ck2, bytes32 s2) = _commitWithFrontend(voter2, contentId, true, STAKE, frontend1);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, false, STAKE);
        (bytes32 ck4, bytes32 s4) = _commit(voter4, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        uint256 revealGracePeriod = ProtocolConfig(protocolConfigAddress).revealGracePeriod();

        // Warp past the tlock-backed revealable timestamp + reveal grace period.
        vm.warp(engine.lastCommitRevealableAfter(contentId, roundId) + revealGracePeriod + 1);

        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, false, s3);
        _reveal(contentId, roundId, ck4, true, s4);

        _settleRoundAfterRbtsSeed(contentId, roundId);
        RoundLib.Round memory settledRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(settledRound.state), uint256(RoundLib.RoundState.Settled));
        assertEq(engine.roundUnrevealedCleanupRemaining(contentId, roundId), 1);

        vm.expectRevert(RoundRewardDistributor.UnrevealedCleanupPending.selector);
        vm.prank(voter2);
        rewardDistributor.claimReward(contentId, roundId);

        vm.expectRevert(RoundRewardDistributor.UnrevealedCleanupPending.selector);
        vm.prank(voter2);
        rewardDistributor.claimParticipationReward(contentId, roundId);

        vm.expectRevert(RoundRewardDistributor.UnrevealedCleanupPending.selector);
        vm.prank(frontend1);
        rewardDistributor.claimFrontendFee(contentId, roundId, frontend1);

        uint256 treasuryBefore = lrepToken.balanceOf(treasury);
        uint256 keeperBefore = lrepToken.balanceOf(keeper);
        vm.prank(keeper);
        engine.processUnrevealedVotes(contentId, roundId, 0, 0);
        uint256 treasuryAfter = lrepToken.balanceOf(treasury);
        uint256 keeperAfter = lrepToken.balanceOf(keeper);

        assertEq(engine.roundUnrevealedCleanupRemaining(contentId, roundId), 0);
        assertEq(keeperAfter - keeperBefore, STAKE / 100, "cleanup caller receives 1% incentive");
        assertEq(
            treasuryAfter - treasuryBefore,
            STAKE - (STAKE / 100),
            "settled unrevealed stake less incentive routes to treasury"
        );

        vm.prank(voter2);
        assertGt(rewardDistributor.claimParticipationReward(contentId, roundId), 0);

        uint256 feesBefore = frontendRegistry.getAccumulatedFees(frontend1);
        vm.prank(frontend1);
        rewardDistributor.claimFrontendFee(contentId, roundId, frontend1);
        assertGt(frontendRegistry.getAccumulatedFees(frontend1), feesBefore);
    }

    function test_ProcessUnrevealed_SettledRoundProcessesExpiredVotesInBatches() public {
        uint256 contentId = _submitContent();

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, true, STAKE);
        (bytes32 ck4, bytes32 s4) = _commit(voter4, contentId, true, STAKE);
        (bytes32 ck5, bytes32 s5) = _commit(voter5, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        uint256 revealGracePeriod = ProtocolConfig(protocolConfigAddress).revealGracePeriod();
        vm.warp(engine.lastCommitRevealableAfter(contentId, roundId) + revealGracePeriod + 1);
        _reveal(contentId, roundId, ck3, true, s3);
        _reveal(contentId, roundId, ck4, true, s4);
        _reveal(contentId, roundId, ck5, false, s5);

        _settleRoundAfterRbtsSeed(contentId, roundId);
        assertEq(engine.roundUnrevealedCleanupRemaining(contentId, roundId), 2);

        uint256 treasuryBefore = lrepToken.balanceOf(treasury);
        uint256 keeperBefore = lrepToken.balanceOf(keeper);
        vm.prank(keeper);
        engine.processUnrevealedVotes(contentId, roundId, 0, 1);
        assertEq(lrepToken.balanceOf(treasury) - treasuryBefore, STAKE - (STAKE / 100));
        assertEq(lrepToken.balanceOf(keeper) - keeperBefore, STAKE / 100);
        assertEq(engine.roundUnrevealedCleanupRemaining(contentId, roundId), 1);

        vm.prank(keeper);
        engine.processUnrevealedVotes(contentId, roundId, 1, 1);
        assertEq(lrepToken.balanceOf(treasury) - treasuryBefore, STAKE * 2 - ((STAKE * 2) / 100));
        assertEq(lrepToken.balanceOf(keeper) - keeperBefore, (STAKE * 2) / 100);
        assertEq(engine.roundUnrevealedCleanupRemaining(contentId, roundId), 0);
    }

    function test_ProcessUnrevealed_RefundsCurrentEpochVotes() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Warp past epoch 1 (absolute time) — voter1/2/3 votes become revealable
        RoundLib.Round memory rPU2start = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(rPU2start.startTime) + EPOCH);
        // Commit voter4 in epoch 2 before threshold is reached. This keeps the
        // current-epoch unrevealed path without relying on post-threshold commits.
        _commit(voter4, contentId, true, STAKE);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, false, s3);

        // settledAt is in epoch 2 while voter4's revealableAfter is epoch 2 end => REFUNDED
        _settleRoundAfterRbtsSeed(contentId, roundId);

        uint256 voter4BalBefore = lrepToken.balanceOf(voter4);
        vm.prank(keeper);
        engine.processUnrevealedVotes(contentId, roundId, 0, 0);
        uint256 voter4BalAfter = lrepToken.balanceOf(voter4);

        // voter4 committed in epoch 3; their epoch hadn't ended at settlement => refunded
        assertEq(voter4BalAfter - voter4BalBefore, STAKE);
    }

    function test_ProcessUnrevealed_RefundOnlyCleanupPaysNoKeeperBounty() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        RoundLib.Round memory rStart = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(rStart.startTime) + EPOCH);
        // voter4 commits in epoch 2; their epoch will not have ended at settledAt, so on
        // processUnrevealedVotes their stake is REFUNDED rather than forfeited.
        _commit(voter4, contentId, true, STAKE);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, false, s3);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        uint256 keeperBefore = lrepToken.balanceOf(keeper);
        uint256 voter4Before = lrepToken.balanceOf(voter4);
        uint256 treasuryBefore = lrepToken.balanceOf(treasury);

        vm.prank(keeper);
        engine.processUnrevealedVotes(contentId, roundId, 0, 0);

        // Refund still happens.
        assertEq(lrepToken.balanceOf(voter4) - voter4Before, STAKE, "voter4 refunded");
        assertEq(lrepToken.balanceOf(keeper), keeperBefore, "keeper not paid");
        assertEq(lrepToken.balanceOf(treasury), treasuryBefore, "refund-only cleanup must not pay treasury");
    }

    function test_ProcessUnrevealed_SettledCleanupPaysIncentiveOncePerForfeiture() public {
        uint256 contentId = _submitContent();

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, true, STAKE);
        (bytes32 ck4, bytes32 s4) = _commit(voter4, contentId, true, STAKE);
        (bytes32 ck5, bytes32 s5) = _commit(voter5, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        uint256 revealGracePeriod = ProtocolConfig(protocolConfigAddress).revealGracePeriod();
        vm.warp(engine.lastCommitRevealableAfter(contentId, roundId) + revealGracePeriod + 1);
        _reveal(contentId, roundId, ck3, true, s3);
        _reveal(contentId, roundId, ck4, true, s4);
        _reveal(contentId, roundId, ck5, false, s5);

        _settleRoundAfterRbtsSeed(contentId, roundId);

        uint256 keeperBalBefore = lrepToken.balanceOf(keeper);

        vm.prank(keeper);
        engine.processUnrevealedVotes(contentId, roundId, 0, 1);
        uint256 afterFirstBatch = lrepToken.balanceOf(keeper);

        vm.prank(keeper);
        engine.processUnrevealedVotes(contentId, roundId, 1, 1);
        uint256 afterSecondBatch = lrepToken.balanceOf(keeper);

        assertEq(afterFirstBatch - keeperBalBefore, STAKE / 100, "first forfeiture pays incentive");
        assertEq(afterSecondBatch - keeperBalBefore, (STAKE * 2) / 100, "second forfeiture pays incentive once");
    }

    function test_ProcessUnrevealed_CleanupIncentiveCapAppliesAcrossBatches() public {
        uint256 contentId = _submitContent();
        uint256 highStake = 10e6;

        address[] memory unrevealedVoters = new address[](60);
        for (uint256 i = 0; i < unrevealedVoters.length; ++i) {
            unrevealedVoters[i] = address(uint160(1_000 + i));
            mockRaterIdentityRegistry.setHolder(unrevealedVoters[i]);
            vm.prank(owner);
            lrepToken.mint(unrevealedVoters[i], highStake);
            _commit(unrevealedVoters[i], contentId, true, highStake);
        }

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        uint256 revealGracePeriod = ProtocolConfig(protocolConfigAddress).revealGracePeriod();
        vm.warp(engine.lastCommitRevealableAfter(contentId, roundId) + revealGracePeriod + 1);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, false, s3);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        uint256 keeperBefore = lrepToken.balanceOf(keeper);
        uint256 treasuryBefore = lrepToken.balanceOf(treasury);
        for (uint256 i = 0; i < unrevealedVoters.length; ++i) {
            vm.prank(keeper);
            engine.processUnrevealedVotes(contentId, roundId, i, 1);
        }

        assertEq(lrepToken.balanceOf(keeper) - keeperBefore, 5e6, "round cleanup incentive is capped");
        assertEq(
            lrepToken.balanceOf(treasury) - treasuryBefore,
            highStake * unrevealedVoters.length - 5e6,
            "remaining stake routes to treasury"
        );
        assertEq(engine.roundUnrevealedCleanupRemaining(contentId, roundId), 0, "cleanup queue clears");
    }

    function test_ProcessUnrevealed_RevertsIfRoundOpen() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        vm.expectRevert(RoundVotingEngine.RoundNotSettledOrTied.selector);
        engine.processUnrevealedVotes(contentId, roundId, 0, 0);
    }

    function test_ProcessUnrevealed_AllRevealed_Reverts() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        // All votes revealed — NothingProcessed revert prevents no-op keeper reward drain
        vm.expectRevert(RoundVotingEngine.NothingProcessed.selector);
        engine.processUnrevealedVotes(contentId, roundId, 0, 0);
    }

    function test_ProcessUnrevealed_IndexOutOfBounds_Reverts() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        // startIndex > commitKeys.length
        vm.expectRevert(RoundVotingEngine.IndexOutOfBounds.selector);
        engine.processUnrevealedVotes(contentId, roundId, 999, 1);
    }

    function test_ProcessUnrevealed_TiedRound_RefundsCurrentEpochUnrevealed() public {
        // Set up a tied round with a current-epoch unrevealed vote.
        uint256 contentId = _submitContent();

        // 3-voter tie: up=2e6, down=3e6, up=1e6
        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, 2e6);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, false, 3e6);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, true, 1e6);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Warp past epoch 1 and add voter4 in epoch 2 before revealing.
        RoundLib.Round memory rTied = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(rTied.startTime) + EPOCH);
        _commit(voter4, contentId, true, STAKE);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, false, s2);
        _reveal(contentId, roundId, ck3, true, s3);
        // voter4's vote is NOT revealed

        _settleRoundAfterRbtsSeed(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Tied));

        uint256 voter4Before = lrepToken.balanceOf(voter4);
        engine.processUnrevealedVotes(contentId, roundId, 0, 0);
        uint256 voter4After = lrepToken.balanceOf(voter4);

        assertEq(voter4After - voter4Before, STAKE, "current-epoch tied-round stake refunds");
    }

    function test_FinalizeRevealFailedRound_SucceedsAfterFinalRevealGrace() public {
        uint256 contentId = _submitContent();

        mockRaterIdentityRegistry.setHolder(voter1);
        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        uint256 finalDeadline = round.startTime + 7 days + ProtocolConfig(protocolConfigAddress).revealGracePeriod();

        vm.warp(finalDeadline - 1);
        vm.expectRevert(RoundVotingEngine.RevealGraceActive.selector);
        engine.finalizeRevealFailedRound(contentId, roundId);

        vm.warp(finalDeadline);
        engine.finalizeRevealFailedRound(contentId, roundId);
        assertEq(engine.roundUnrevealedCleanupRemaining(contentId, roundId), 3, "reveal-failed cleanup is queued");

        RoundLib.Round memory failedRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(failedRound.state), uint256(RoundLib.RoundState.RevealFailed));

        uint256 voter1BalBefore = lrepToken.balanceOf(voter1);
        vm.expectRevert(RoundVotingEngine.RoundNotOpen.selector);
        _reveal(contentId, roundId, ck1, true, s1);

        vm.expectRevert(RoundVotingEngine.VoteNotRevealed.selector);
        vm.prank(voter1);
        engine.claimCancelledRoundRefund(contentId, roundId);
        assertEq(lrepToken.balanceOf(voter1), voter1BalBefore, "late reveals are not accepted after reveal failure");
    }

    function test_FinalizeRevealFailed_AllSybilQuorum_StaysCancellable() public {
        uint256 contentId = _submitContent();

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        uint256 finalDeadline = round.startTime + 7 days + ProtocolConfig(protocolConfigAddress).revealGracePeriod();

        vm.warp(finalDeadline);
        vm.expectRevert(RoundVotingEngine.RevealGraceActive.selector);
        engine.finalizeRevealFailedRound(contentId, roundId);

        engine.cancelExpiredRound(contentId, roundId);
        RoundLib.Round memory cancelledRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(cancelledRound.state), uint256(RoundLib.RoundState.Cancelled));
        assertFalse(engine.roundHasHumanVerifiedCommit(contentId, roundId));
    }

    function test_RevealFailed_RefundsRevealedAndForfeitsUnrevealed() public {
        uint256 contentId = _submitContent();

        mockRaterIdentityRegistry.setHolder(voter1);
        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);

        uint256 finalDeadline = round.startTime + 7 days + ProtocolConfig(protocolConfigAddress).revealGracePeriod() + 1;
        vm.warp(finalDeadline);
        engine.finalizeRevealFailedRound(contentId, roundId);

        uint256 voter1BalBefore = lrepToken.balanceOf(voter1);
        vm.prank(voter1);
        engine.claimCancelledRoundRefund(contentId, roundId);
        assertEq(lrepToken.balanceOf(voter1) - voter1BalBefore, STAKE, "revealed voters recover stake");

        vm.expectRevert(RoundVotingEngine.VoteNotRevealed.selector);
        vm.prank(voter2);
        engine.claimCancelledRoundRefund(contentId, roundId);

        uint256 treasuryBefore = lrepToken.balanceOf(treasury);
        uint256 keeperBefore = lrepToken.balanceOf(keeper);
        vm.prank(keeper);
        engine.processUnrevealedVotes(contentId, roundId, 0, 0);
        uint256 treasuryAfter = lrepToken.balanceOf(treasury);
        uint256 keeperAfter = lrepToken.balanceOf(keeper);
        uint256 incentive = (STAKE * 2) / 100;
        assertEq(engine.roundUnrevealedCleanupRemaining(contentId, roundId), 0, "cleanup queue clears");
        assertEq(keeperAfter - keeperBefore, incentive, "cleanup caller receives 1% incentive");
        assertEq(treasuryAfter - treasuryBefore, STAKE * 2 - incentive, "remaining stakes forfeit");
    }

    function test_CommitAfterRevealFailedGrace_StartsNewRound() public {
        uint256 contentId = _submitContent();

        mockRaterIdentityRegistry.setHolder(voter1);

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        vm.warp(round.startTime + 7 days + ProtocolConfig(protocolConfigAddress).revealGracePeriod() + 1);

        _commit(voter4, contentId, true, STAKE);

        RoundLib.Round memory failedRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        uint256 newRoundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        assertEq(uint256(failedRound.state), uint256(RoundLib.RoundState.RevealFailed));
        assertEq(newRoundId, roundId + 1, "new commits roll into a fresh round after reveal failure");
    }

    function test_RoundKeepsAcceptingVotesBeforeMaxDurationEvenIfEarlyRevealGracePassed() public {
        uint256 contentId = _submitContent();

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);
        _commit(voter3, contentId, true, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);

        vm.warp(round.startTime + EPOCH + ProtocolConfig(protocolConfigAddress).revealGracePeriod() + 1);

        _commit(voter4, contentId, true, STAKE);

        uint256 activeRoundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory sameRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(activeRoundId, roundId, "round should stay open until maxDuration ends");
        assertEq(uint256(sameRound.state), uint256(RoundLib.RoundState.Open), "round remains open");
        assertEq(sameRound.voteCount, 4, "late vote should join the existing round");
    }

    // =========================================================================
    // ADDITIONAL BRANCH COVERAGE
    // =========================================================================

    function test_Commit_ZeroStakeRejected() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        bytes32 commitHash = _commitHash(true, salt, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);

        vm.prank(voter1);
        lrepToken.approve(address(engine), 0);
        uint256 cachedRoundContext7 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.InvalidStake.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext7,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            0,
            address(0)
        );
    }

    function test_AdvisoryVoteRequiresExistingStakedRoundWithoutVoteStakeAccounting() public {
        uint256 contentId = _submitContent();
        _expectAdvisoryRevert(voter1, contentId, "advisory-no-staked-round", RoundVotingEngine.RoundNotOpen.selector);
        AdvisoryVoteRecorder.AdvisoryCommitAvailability memory noStakedAvailability =
            advisoryRecorder.advisoryCommitAvailability(contentId);
        assertFalse(noStakedAvailability.canCommit, "fresh content is not advisory-voteable");
        assertEq(
            uint256(noStakedAvailability.status),
            uint256(AdvisoryVoteRecorder.AdvisoryCommitAvailabilityStatus.NoStakedRound),
            "fresh content reports missing staked round"
        );
        assertEq(noStakedAvailability.roundId, 0, "fresh content has no advisory round");

        uint64 targetRound = _openStakedRound(voter2, contentId, "advisory-staked-open");
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        uint16 referenceRatingBps = engine.previewCommitReferenceRatingBps(contentId);
        uint256 roundContext = _roundContext(roundId, referenceRatingBps);
        RoundLib.Round memory previewedRound = RoundEngineReadHelpers.round(engine, contentId, roundId);
        AdvisoryVoteRecorder.AdvisoryCommitAvailability memory availability =
            advisoryRecorder.advisoryCommitAvailability(contentId);
        assertTrue(availability.canCommit, "staked blind round is advisory-voteable");
        assertEq(
            uint256(availability.status),
            uint256(AdvisoryVoteRecorder.AdvisoryCommitAvailabilityStatus.Available),
            "staked blind round reports available"
        );
        assertEq(availability.roundId, roundId, "availability round matches active round");
        assertEq(availability.roundReferenceRatingBps, referenceRatingBps, "availability reference rating matches");
        assertEq(
            availability.epochEnd, uint256(previewedRound.startTime) + EPOCH, "availability anchors to first epoch end"
        );
        assertEq(availability.drandChainHash, _tlockDrandChainHash(), "availability exposes drand chain hash");
        assertEq(availability.drandGenesisTime, _tlockDrandGenesisTime(), "availability exposes drand genesis");
        assertEq(availability.drandPeriod, _tlockDrandPeriod(), "availability exposes drand period");
        assertEq(
            availability.minTargetRound,
            _tlockTargetRoundAt(availability.epochEnd),
            "availability exposes min target round"
        );
        assertEq(
            availability.maxTargetRound,
            _roundAt(
                availability.epochEnd + 2 * uint256(_tlockDrandPeriod()), _tlockDrandGenesisTime(), _tlockDrandPeriod()
            ),
            "availability exposes max target round"
        );
        assertGe(targetRound, availability.minTargetRound, "opened target is inside advisory range");
        assertLe(targetRound, availability.maxTargetRound, "opened target is inside advisory range");

        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp, "advisory"));
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = _commitHash(
            true, salt, voter1, contentId, roundId, referenceRatingBps, targetRound, drandChainHash, ciphertext
        );

        vm.prank(voter1);
        bytes32 advisoryCommitKey = advisoryRecorder.recordAdvisoryVote(
            contentId, roundContext, targetRound, drandChainHash, commitHash, ciphertext
        );

        assertEq(RoundEngineReadHelpers.activeRoundId(engine, contentId), roundId, "advisory vote uses open round");
        assertEq(advisoryRecorder.roundAdvisoryCommitCount(contentId, roundId), 1, "advisory commit indexed");
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertGt(round.startTime, 0, "round start snapshotted");
        assertEq(round.voteCount, 1, "advisory commit is not a counted vote");
        assertEq(round.totalStake, STAKE, "advisory commit has no stake");

        vm.expectRevert(AdvisoryVoteRecorder.EpochNotEnded.selector);
        advisoryRecorder.revealAdvisoryVote(advisoryCommitKey, true, 5_000, salt);

        round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(round.voteCount, 1, "only staked commit counts");
        assertEq(round.totalStake, STAKE, "only staked commit contributes stake");

        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH);
        advisoryRecorder.revealAdvisoryVote(advisoryCommitKey, true, 5_000, salt);
        (,,,,, bool revealed,,,,) = advisoryRecorder.advisoryCommitCore(advisoryCommitKey);
        assertTrue(revealed, "advisory vote revealed");
        round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(round.revealedCount, 0, "advisory reveal does not count toward quorum");
    }

    function test_AdvisoryVoteAfterExpiredBelowQuorum_RevertsWithoutRollingStaleRound() public {
        vm.prank(owner);
        _setTlockRoundConfig(ProtocolConfig(protocolConfigAddress), 1 hours, 1 hours, 3, 1000);

        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);

        uint256 staleRoundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory staleRound = RoundEngineReadHelpers.round(engine, contentId, staleRoundId);
        vm.warp(uint256(staleRound.startTime) + 1 hours);

        _expectAdvisoryRevert(
            voter3, contentId, "advisory-does-not-roll-stale", RoundVotingEngine.InvalidCommitHash.selector
        );

        staleRound = RoundEngineReadHelpers.round(engine, contentId, staleRoundId);
        assertEq(uint256(staleRound.state), uint256(RoundLib.RoundState.Open), "advisory does not roll stale round");
        assertEq(RoundEngineReadHelpers.activeRoundId(engine, contentId), staleRoundId, "no new round opened");
        assertEq(advisoryRecorder.roundAdvisoryCommitCount(contentId, staleRoundId), 0, "advisory not indexed");
    }

    function test_AdvisoryVoteAtBlindEpochBoundary_RevertsWhileRoundOpen() public {
        vm.prank(owner);
        _setTlockRoundConfig(ProtocolConfig(protocolConfigAddress), 1 hours, 7 days, 3, 1000);

        uint256 contentId = _submitContent();
        _openStakedRound(voter2, contentId, "advisory-boundary-open");
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);

        vm.warp(uint256(round.startTime) + 1 hours - 1);
        _recordAdvisory(voter1, contentId, "advisory-before-boundary");
        assertEq(advisoryRecorder.roundAdvisoryCommitCount(contentId, roundId), 1, "pre-boundary advisory accepted");

        vm.warp(uint256(round.startTime) + 1 hours);
        AdvisoryVoteRecorder.AdvisoryCommitAvailability memory boundaryAvailability =
            advisoryRecorder.advisoryCommitAvailability(contentId);
        assertFalse(boundaryAvailability.canCommit, "advisory closes at first epoch boundary");
        assertEq(
            uint256(boundaryAvailability.status),
            uint256(AdvisoryVoteRecorder.AdvisoryCommitAvailabilityStatus.OutsideBlindEpoch),
            "boundary reports outside blind epoch"
        );
        _expectAdvisoryRevert(voter3, contentId, "advisory-at-boundary", RoundVotingEngine.RoundNotOpen.selector);
        assertEq(advisoryRecorder.roundAdvisoryCommitCount(contentId, roundId), 1, "boundary advisory rejected");
    }

    function test_AdvisoryVoteDormantContent_RevertsWithoutOpeningRound() public {
        uint256 contentId = _submitContent();
        vm.warp(block.timestamp + 31 days);
        registry.markDormant(contentId);

        uint256 roundId = engine.previewCommitRoundId(contentId);
        uint16 referenceRatingBps = engine.previewCommitReferenceRatingBps(contentId);
        uint64 targetRound = _tlockCommitTargetRound(engine, contentId);
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp, "dormant-advisory"));
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = _commitHash(
            true, salt, voter1, contentId, roundId, referenceRatingBps, targetRound, drandChainHash, ciphertext
        );

        vm.prank(voter1);
        vm.expectRevert(VotePreflightLib.ContentNotActive.selector);
        advisoryRecorder.recordAdvisoryVote(
            contentId, _roundContext(roundId, referenceRatingBps), targetRound, drandChainHash, commitHash, ciphertext
        );

        assertEq(RoundEngineReadHelpers.activeRoundId(engine, contentId), 0, "no round opened");
    }

    function test_AdvisoryPreRoundUsesShortCustomRoundConfig() public {
        RoundLib.RoundConfig memory roundConfig =
            RoundLib.RoundConfig({ epochDuration: 2 minutes, maxDuration: 2 minutes, minVoters: 3, maxVoters: 1000 });
        uint256 contentId = _submitContentWithRoundConfig("https://example.com/advisory-short", roundConfig);

        uint256 recordedAt = block.timestamp;
        uint64 targetRound = _tlockTargetRoundAt(recordedAt + roundConfig.epochDuration);
        _openStakedRoundWithTarget(voter2, contentId, targetRound, "advisory-short-staked-open");
        (bytes32 advisoryCommitKey, bytes32 advisorySalt) =
            _recordAdvisoryWithTargetRound(voter1, contentId, "advisory-short", targetRound);

        (,,,, uint48 revealableAfter,,,,,) = advisoryRecorder.advisoryCommitCore(advisoryCommitKey);
        assertGe(revealableAfter, recordedAt + roundConfig.epochDuration, "uses custom short epoch floor");
        assertLt(revealableAfter, recordedAt + EPOCH, "does not inherit global one-hour epoch");

        vm.warp(uint256(revealableAfter) + 1);

        advisoryRecorder.revealAdvisoryVote(advisoryCommitKey, true, 5_000, advisorySalt);
        (,,,,, bool revealed,,,,) = advisoryRecorder.advisoryCommitCore(advisoryCommitKey);
        assertTrue(revealed, "advisory can reveal on the custom short epoch");
    }

    function test_AdvisoryPreRoundUsesLongCustomRoundConfig() public {
        RoundLib.RoundConfig memory roundConfig =
            RoundLib.RoundConfig({ epochDuration: 3 days, maxDuration: 3 days, minVoters: 3, maxVoters: 1000 });
        uint256 contentId = _submitContentWithRoundConfig("https://example.com/advisory-long", roundConfig);

        uint256 recordedAt = block.timestamp;
        uint64 targetRound = _tlockTargetRoundAt(recordedAt + roundConfig.epochDuration);
        _openStakedRoundWithTarget(voter2, contentId, targetRound, "advisory-long-staked-open");
        (bytes32 advisoryCommitKey,) = _recordAdvisoryWithTargetRound(voter1, contentId, "advisory-long", targetRound);

        (,,,, uint48 revealableAfter,,,,,) = advisoryRecorder.advisoryCommitCore(advisoryCommitKey);
        assertGe(revealableAfter, recordedAt + roundConfig.epochDuration, "uses custom long epoch floor");
        assertGt(revealableAfter, recordedAt + EPOCH, "does not leak on the global one-hour epoch");
    }

    function test_AdvisoryRevealAfterRealReveal_Succeeds() public {
        uint256 contentId = _submitContent();
        uint64 targetRound = _tlockCommitTargetRound();
        (bytes32 commitKey, bytes32 salt) =
            _commitWithTargetRound(voter2, contentId, true, STAKE, targetRound, "real-before-advisory");
        (bytes32 advisoryCommitKey, bytes32 advisorySalt) =
            _recordAdvisoryWithTargetRound(voter1, contentId, "advisory-after-real", targetRound);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        vm.warp(_tlockRoundTimestamp(targetRound) + 1);
        _reveal(contentId, roundId, commitKey, true, salt);

        advisoryRecorder.revealAdvisoryVote(advisoryCommitKey, true, 5_000, advisorySalt);
        (,,,,, bool revealed,,,,) = advisoryRecorder.advisoryCommitCore(advisoryCommitKey);
        assertTrue(revealed, "advisory reveal remains available after real reveals");
    }

    function test_RealCommitAfterAdvisoryCommit_Reverts() public {
        uint256 contentId = _submitContent();
        _openStakedRound(voter2, contentId, "real-after-advisory-open");
        _recordAdvisory(voter1, contentId, "advisory-first");

        uint256 roundId = engine.previewCommitRoundId(contentId);
        uint16 referenceRatingBps = engine.previewCommitReferenceRatingBps(contentId);
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp, "real-after-advisory"));
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = _commitHash(
            true, salt, voter1, contentId, roundId, referenceRatingBps, targetRound, drandChainHash, ciphertext
        );

        vm.startPrank(voter1);
        lrepToken.approve(address(engine), STAKE);
        vm.expectRevert(RoundVotingEngine.AlreadyCommitted.selector);
        engine.commitVote(
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
    }

    function test_RealCommitAfterDelegateAdvisoryIdentityChurn_RevertsAlreadyCommitted() public {
        uint256 contentId = _submitContent();
        _openStakedRound(voter2, contentId, "delegate-advisory-open");
        vm.prank(voter1);
        mockRaterIdentityRegistry.setDelegate(delegate1);
        _recordAdvisory(delegate1, contentId, "delegate-advisory-before-identity");

        mockRaterIdentityRegistry.mint(voter1, 42);
        vm.warp(block.timestamp + 25 hours);

        _expectCommitVoteRevert(
            voter1,
            contentId,
            false,
            STAKE,
            "real-after-delegate-advisory-identity-churn",
            RoundVotingEngine.AlreadyCommitted.selector
        );
    }

    function test_AdvisoryAfterDelegateRealCommitIdentityChurn_RevertsAlreadyCommitted() public {
        uint256 contentId = _submitContent();
        vm.prank(voter1);
        mockRaterIdentityRegistry.setDelegate(delegate1);
        _commit(delegate1, contentId, true, STAKE);

        mockRaterIdentityRegistry.mint(voter1, 42);
        vm.warp(block.timestamp + 25 hours);

        _expectAdvisoryRevert(
            voter1,
            contentId,
            "advisory-after-delegate-real-identity-churn",
            AdvisoryVoteRecorder.AlreadyCommitted.selector
        );
    }

    function test_RealCommitAfterAdvisoryVoteCooldown_Reverts() public {
        uint256 contentId = _submitContent();
        uint64 openedTargetRound = _tlockCommitTargetRound(engine, contentId);
        (bytes32 ck2, bytes32 s2) =
            _commitWithTargetRound(voter2, contentId, true, STAKE, openedTargetRound, "advisory-cooldown-open");
        _recordAdvisoryWithTargetRound(voter1, contentId, "advisory-cooldown", openedTargetRound);

        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, true, STAKE);
        (bytes32 ck4, bytes32 s4) = _commit(voter4, contentId, false, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, true, s3);
        _reveal(contentId, roundId, ck4, false, s4);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        uint256 nextRoundId = engine.previewCommitRoundId(contentId);
        uint16 referenceRatingBps = engine.previewCommitReferenceRatingBps(contentId);
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp, "real-after-advisory-cooldown"));
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = _commitHash(
            true, salt, voter1, contentId, nextRoundId, referenceRatingBps, targetRound, drandChainHash, ciphertext
        );

        vm.startPrank(voter1);
        lrepToken.approve(address(engine), STAKE);
        vm.expectRevert(RoundVotingEngine.CooldownActive.selector);
        engine.commitVote(
            contentId,
            _roundContext(nextRoundId, referenceRatingBps),
            targetRound,
            drandChainHash,
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }

    function test_AdvisoryVoteCannotRevealAfterSettlement() public {
        uint256 contentId = _submitContent();
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, true, STAKE);
        (bytes32 advisoryCommitKey, bytes32 advisorySalt) = _recordAdvisory(voter1, contentId, "late-advisory");

        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, true, STAKE);
        (bytes32 ck4, bytes32 s4) = _commit(voter4, contentId, false, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(round.startTime) + EPOCH);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, true, s3);
        _reveal(contentId, roundId, ck4, false, s4);
        vm.warp(block.timestamp + 60 minutes + 1);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        vm.expectRevert(AdvisoryVoteRecorder.RoundNotOpen.selector);
        advisoryRecorder.revealAdvisoryVote(advisoryCommitKey, true, 5_000, advisorySalt);
    }

    function test_AdvisoryVoteCapsCommitsAtRoundMaxVoters() public {
        vm.prank(owner);
        _setTlockRoundConfig(ProtocolConfig(protocolConfigAddress), 1 hours, 7 days, 3, 3);

        uint256 contentId = _submitContent();
        _openStakedRound(voter4, contentId, "advisory-cap-open");
        _recordAdvisory(voter1, contentId, "advisory-cap-1");
        _recordAdvisory(voter2, contentId, "advisory-cap-2");
        _recordAdvisory(voter3, contentId, "advisory-cap-3");

        uint256 roundId = engine.previewCommitRoundId(contentId);
        uint16 referenceRatingBps = engine.previewCommitReferenceRatingBps(contentId);
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 salt = keccak256(abi.encodePacked(voter5, block.timestamp, "advisory-cap-4"));
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = _commitHash(
            true, salt, voter5, contentId, roundId, referenceRatingBps, targetRound, drandChainHash, ciphertext
        );

        vm.prank(voter5);
        vm.expectRevert(AdvisoryVoteRecorder.MaxAdvisoryVotersReached.selector);
        advisoryRecorder.recordAdvisoryVote(
            contentId, _roundContext(roundId, referenceRatingBps), targetRound, drandChainHash, commitHash, ciphertext
        );
    }

    function test_AdvisoryVoteUsesCorePreflightAndRaterIdentityDedupe() public {
        vm.startPrank(owner);
        ProtocolConfig(protocolConfigAddress).setRaterRegistry(address(mockRaterIdentityRegistry));
        vm.stopPrank();
        mockRaterIdentityRegistry.mint(submitter, 9_001);
        mockRaterIdentityRegistry.mint(voter1, 42);

        uint256 contentId = _submitContent();
        _openStakedRound(voter2, contentId, "advisory-preflight-open");
        uint256 roundId = engine.previewCommitRoundId(contentId);
        uint16 referenceRatingBps = engine.previewCommitReferenceRatingBps(contentId);
        uint256 roundContext = _roundContext(roundId, referenceRatingBps);
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();

        bytes32 submitterSalt = keccak256(abi.encodePacked(submitter, block.timestamp, "advisory-self"));
        bytes memory submitterCiphertext = _testCiphertext(true, submitterSalt, contentId, targetRound, drandChainHash);
        bytes32 submitterCommitHash = _commitHash(
            true,
            submitterSalt,
            submitter,
            contentId,
            roundId,
            referenceRatingBps,
            targetRound,
            drandChainHash,
            submitterCiphertext
        );

        vm.prank(submitter);
        vm.expectRevert(VotePreflightLib.SelfVote.selector);
        advisoryRecorder.recordAdvisoryVote(
            contentId, roundContext, targetRound, drandChainHash, submitterCommitHash, submitterCiphertext
        );

        bytes32 voterSalt = keccak256(abi.encodePacked(voter1, block.timestamp, "advisory-voter-id"));
        bytes memory voterCiphertext = _testCiphertext(true, voterSalt, contentId, targetRound, drandChainHash);
        bytes32 voterCommitHash = _commitHash(
            true,
            voterSalt,
            voter1,
            contentId,
            roundId,
            referenceRatingBps,
            targetRound,
            drandChainHash,
            voterCiphertext
        );

        vm.prank(voter1);
        advisoryRecorder.recordAdvisoryVote(
            contentId, roundContext, targetRound, drandChainHash, voterCommitHash, voterCiphertext
        );

        vm.prank(voter1);
        mockRaterIdentityRegistry.setDelegate(delegate1);
        vm.warp(block.timestamp + 1 days);
        bytes32 delegateSalt = keccak256(abi.encodePacked(delegate1, block.timestamp, "advisory-voter-id"));
        bytes memory delegateCiphertext = _testCiphertext(true, delegateSalt, contentId, targetRound, drandChainHash);
        bytes32 delegateCommitHash = _commitHash(
            true,
            delegateSalt,
            delegate1,
            contentId,
            roundId,
            referenceRatingBps,
            targetRound,
            drandChainHash,
            delegateCiphertext
        );

        vm.prank(delegate1);
        vm.expectRevert(AdvisoryVoteRecorder.AlreadyCommitted.selector);
        advisoryRecorder.recordAdvisoryVote(
            contentId, roundContext, targetRound, drandChainHash, delegateCommitHash, delegateCiphertext
        );
    }

    function test_AdvisoryAfterDelegateAddressIdentityChurn_RevertsAlreadyCommitted() public {
        uint256 contentId = _submitContent();
        _openStakedRound(voter2, contentId, "delegate-before-human-open");
        vm.prank(voter1);
        mockRaterIdentityRegistry.setDelegate(delegate1);
        _recordAdvisory(delegate1, contentId, "delegate-before-human");

        mockRaterIdentityRegistry.mint(voter1, 42);
        vm.warp(block.timestamp + 25 hours);

        _expectAdvisoryRevert(
            voter1,
            contentId,
            "direct-after-delegate-advisory-identity-churn",
            AdvisoryVoteRecorder.AlreadyCommitted.selector
        );
    }

    function test_DelegateAdvisoryAfterHolderAddressIdentityChurn_RevertsAlreadyCommitted() public {
        uint256 contentId = _submitContent();
        _openStakedRound(voter2, contentId, "holder-before-human-open");
        _recordAdvisory(voter1, contentId, "holder-before-human");

        mockRaterIdentityRegistry.mint(voter1, 42);
        vm.prank(voter1);
        mockRaterIdentityRegistry.setDelegate(delegate1);
        vm.warp(block.timestamp + 25 hours);

        _expectAdvisoryRevert(
            delegate1,
            contentId,
            "delegate-after-holder-advisory-identity-churn",
            AdvisoryVoteRecorder.AlreadyCommitted.selector
        );
    }

    function test_AdvisoryVoteRespectsCountedVoteCooldown() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);

        uint256 roundId = engine.previewCommitRoundId(contentId);
        uint16 referenceRatingBps = engine.previewCommitReferenceRatingBps(contentId);
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp, "advisory-cooldown"));
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = _commitHash(
            true, salt, voter1, contentId, roundId, referenceRatingBps, targetRound, drandChainHash, ciphertext
        );

        vm.prank(voter1);
        vm.expectRevert(VotePreflightLib.CooldownActive.selector);
        advisoryRecorder.recordAdvisoryVote(
            contentId, _roundContext(roundId, referenceRatingBps), targetRound, drandChainHash, commitHash, ciphertext
        );

        vm.warp(block.timestamp + 1 days);
        vm.prank(voter1);
        vm.expectRevert(AdvisoryVoteRecorder.AlreadyCommitted.selector);
        advisoryRecorder.recordAdvisoryVote(
            contentId, _roundContext(roundId, referenceRatingBps), targetRound, drandChainHash, commitHash, ciphertext
        );
    }

    function test_Commit_InvalidStake_AboveMax_Reverts() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        bytes32 commitHash = _commitHash(true, salt, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);

        vm.prank(voter1);
        lrepToken.approve(address(engine), 11e6);
        uint256 cachedRoundContext8 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.InvalidStake.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext8,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            11e6,
            address(0)
        );
    }

    function test_Commit_ContentNotActive_Reverts() public {
        uint256 contentId = _submitContent();

        vm.prank(owner);
        registry.setBonusPool(address(100));
        vm.prank(submitter);
        registry.cancelContent(contentId);

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        bytes32 commitHash = _commitHash(true, salt, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);

        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext9 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.ContentNotActive.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext9,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );
    }

    function test_Commit_SelfVote_SubmitterReverts() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(submitter, block.timestamp));
        bytes32 commitHash = _commitHash(true, salt, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);

        vm.prank(submitter);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext10 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(submitter);
        vm.expectRevert(RoundVotingEngine.SelfVote.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext10,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );
    }

    function test_Commit_SelfVote_DelegateSubmittedContentRevertsForHolderAndDelegate() public {
        vm.prank(owner);
        ProtocolConfig(protocolConfigAddress).setRaterRegistry(address(mockRaterIdentityRegistry));

        mockRaterIdentityRegistry.setHolder(submitter);
        vm.prank(submitter);
        mockRaterIdentityRegistry.setDelegate(delegate1);

        uint256 contentId;
        vm.startPrank(delegate1);
        lrepToken.approve(address(registry), 10e6);
        contentId = _submitContentWithReservation(
            registry, "https://example.com/delegate-self-vote", "goal", "goal", "tags", 0
        );
        vm.stopPrank();

        bytes32 saltDelegate = keccak256(abi.encodePacked(delegate1, block.timestamp, "delegate"));
        bytes memory ciphertextDelegate = _testCiphertext(false, saltDelegate, contentId);
        bytes32 commitHashDelegate = _commitHash(false, saltDelegate, contentId, ciphertextDelegate);

        vm.prank(delegate1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext11 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(delegate1);
        vm.expectRevert(RoundVotingEngine.SelfVote.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext11,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHashDelegate,
            ciphertextDelegate,
            STAKE,
            address(0)
        );

        vm.prank(submitter);
        mockRaterIdentityRegistry.removeDelegate();

        bytes32 saltHolder = keccak256(abi.encodePacked(submitter, block.timestamp, "holder"));
        bytes memory ciphertextHolder = _testCiphertext(true, saltHolder, contentId);
        bytes32 commitHashHolder = _commitHash(true, saltHolder, contentId, ciphertextHolder);

        vm.prank(submitter);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext12 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(submitter);
        vm.expectRevert(RoundVotingEngine.SelfVote.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext12,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHashHolder,
            ciphertextHolder,
            STAKE,
            address(0)
        );
    }

    function test_Commit_CooldownActive_Reverts() public {
        uint256 contentId = _submitContent();

        // voter1 commits — starts 24h cooldown
        _commit(voter1, contentId, true, STAKE);

        // voter1 immediately tries to commit again (within 24h) — should get CooldownActive
        vm.startPrank(voter1);
        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp + 1));
        bytes32 commitHash = _commitHash(false, salt, contentId);
        bytes memory ciphertext = _testCiphertext(false, salt, contentId);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext13 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.expectRevert(RoundVotingEngine.CooldownActive.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext13,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }

    function test_Commit_AfterExpiredRound_StartsNewRound() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        uint256 expiredRoundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Warp past 7-day max duration
        vm.warp(block.timestamp + 8 days);

        bytes32 salt = keccak256(abi.encodePacked(voter2, block.timestamp));
        bytes32 commitHash = _commitHash(true, salt, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);

        vm.prank(voter2);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext14 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(voter2);
        engine.commitVote(
            contentId,
            cachedRoundContext14,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );

        RoundLib.Round memory cancelledRound = RoundEngineReadHelpers.round(engine, contentId, expiredRoundId);
        uint256 newRoundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        assertEq(uint256(cancelledRound.state), uint256(RoundLib.RoundState.Cancelled));
        assertEq(newRoundId, expiredRoundId + 1);
        assertEq(engine.voterCommitHash(contentId, newRoundId, voter2), commitHash);
    }

    function test_Commit_EmptyCiphertext_Reverts() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        bytes32 commitHash = _commitHash(true, salt, contentId);

        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext15 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.InvalidCiphertext.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext15,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            "",
            STAKE,
            address(0)
        );
    }

    function test_Commit_OversizedCiphertext_Reverts() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        bytes32 commitHash = _commitHash(true, salt, contentId);
        bytes memory hugeCiphertext = new bytes(2_049); // exceeds MAX_CIPHERTEXT_SIZE

        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext16 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.CiphertextTooLarge.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext16,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            hugeCiphertext,
            STAKE,
            address(0)
        );
    }

    function test_Commit_MaxCiphertextSize_Accepted() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        bytes memory maxCiphertext = _maxAgeCiphertext();
        assertLe(maxCiphertext.length, 2_048);
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 commitHash = _commitHash(true, salt, contentId, targetRound, drandChainHash, maxCiphertext);

        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext17 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        engine.commitVote(
            contentId, cachedRoundContext17, targetRound, drandChainHash, commitHash, maxCiphertext, STAKE, address(0)
        );
    }

    function test_Commit_MalformedArmor_Reverts() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        bytes memory malformed = hex"deadbeef";
        bytes32 commitHash = _commitHash(true, salt, contentId, malformed);

        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext18 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.InvalidCiphertext.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext18,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            malformed,
            STAKE,
            address(0)
        );
    }

    function test_Commit_ShallowPseudoTlockEnvelope_Reverts() public {
        uint256 contentId = _submitContent();
        bytes32 salt = bytes32(0);
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();

        bytes memory shallowPayload = abi.encodePacked(
            TEST_AGE_VERSION,
            TEST_TLOCK_LINE_PREFIX,
            bytes(Strings.toString(targetRound)),
            " ",
            _bytes32Hex(drandChainHash),
            "\n",
            TEST_PAYLOAD_LINE_PREFIX,
            "u:",
            _bytes32Hex(salt),
            "\n",
            TEST_MAC_LINE_PREFIX,
            "bWFj\n"
        );
        bytes memory ciphertext = _armoredTestCiphertext(shallowPayload, true);
        bytes32 commitHash = _commitHash(true, salt, contentId, targetRound, drandChainHash, ciphertext);

        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext19 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.InvalidCiphertext.selector);
        engine.commitVote(
            contentId, cachedRoundContext19, targetRound, drandChainHash, commitHash, ciphertext, STAKE, address(0)
        );
    }

    function test_Commit_UnchunkedArmorLine_Reverts() public {
        uint256 contentId = _submitContent();
        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes memory decodedPayload = _testCiphertextPayload(true, salt, contentId, targetRound, drandChainHash, 0);
        bytes memory ciphertext =
            abi.encodePacked(TEST_AGE_HEADER, bytes(Base64.encode(decodedPayload)), "\n", TEST_AGE_FOOTER);
        bytes32 commitHash = _commitHash(true, salt, contentId, targetRound, drandChainHash, ciphertext);

        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext20 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.InvalidCiphertext.selector);
        engine.commitVote(
            contentId, cachedRoundContext20, targetRound, drandChainHash, commitHash, ciphertext, STAKE, address(0)
        );
    }

    function test_Commit_WrongChainHash_Reverts() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        uint64 targetRound = _tlockCommitTargetRound();
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, bytes32(uint256(1)));
        bytes32 commitHash = _commitHash(true, salt, contentId, targetRound, bytes32(uint256(1)), ciphertext);

        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext21 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.DrandChainHashMismatch.selector);
        engine.commitVote(
            contentId, cachedRoundContext21, targetRound, bytes32(uint256(1)), commitHash, ciphertext, STAKE, address(0)
        );
    }

    function test_Commit_TargetRoundBeforeWindow_Reverts() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();
        uint64 badTargetRound = targetRound == 0 ? 0 : targetRound - 1;
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, badTargetRound, drandChainHash);
        bytes32 commitHash = _commitHash(true, salt, contentId, badTargetRound, drandChainHash, ciphertext);

        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext22 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.TargetRoundOutOfWindow.selector);
        engine.commitVote(
            contentId, cachedRoundContext22, badTargetRound, drandChainHash, commitHash, ciphertext, STAKE, address(0)
        );
    }

    function test_Commit_TargetRoundBeforeCeilWindow_Reverts() public {
        uint64 customPeriod = 7;
        vm.prank(owner);
        _setTlockDrandConfig(
            ProtocolConfig(protocolConfigAddress), DEFAULT_DRAND_CHAIN_HASH, DEFAULT_DRAND_GENESIS_TIME, customPeriod
        );
        uint256 contentId = _submitContent();
        uint256 revealableAfter = block.timestamp + EPOCH;
        bytes32 drandChainHash = DEFAULT_DRAND_CHAIN_HASH;

        uint64 floorTargetRound = _roundAt(revealableAfter, DEFAULT_DRAND_GENESIS_TIME, customPeriod);
        uint256 floorTargetRoundTimestamp =
            uint256(DEFAULT_DRAND_GENESIS_TIME) + (uint256(floorTargetRound) - 1) * uint256(customPeriod);
        assertLt(floorTargetRoundTimestamp, revealableAfter, "floor target would decrypt before epoch end");

        bytes32 badSalt = keccak256(abi.encodePacked(voter1, block.timestamp, "floor target"));
        bytes memory badCiphertext = _testCiphertext(true, badSalt, contentId, floorTargetRound, drandChainHash);
        bytes32 badCommitHash =
            _commitHash(true, badSalt, voter1, contentId, floorTargetRound, drandChainHash, badCiphertext);

        vm.startPrank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext23 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.expectRevert(RoundVotingEngine.TargetRoundOutOfWindow.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext23,
            floorTargetRound,
            drandChainHash,
            badCommitHash,
            badCiphertext,
            STAKE,
            address(0)
        );

        uint64 ceilTargetRound = floorTargetRound + 1;
        uint256 ceilTargetRoundTimestamp =
            uint256(DEFAULT_DRAND_GENESIS_TIME) + (uint256(ceilTargetRound) - 1) * uint256(customPeriod);
        assertGe(ceilTargetRoundTimestamp, revealableAfter, "ceil target preserves blind epoch");

        bytes32 goodSalt = keccak256(abi.encodePacked(voter1, block.timestamp, "ceil target"));
        bytes memory goodCiphertext = _testCiphertext(true, goodSalt, contentId, ceilTargetRound, drandChainHash);
        bytes32 goodCommitHash =
            _commitHash(true, goodSalt, voter1, contentId, ceilTargetRound, drandChainHash, goodCiphertext);
        uint256 cachedRoundContext24 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        engine.commitVote(
            contentId,
            cachedRoundContext24,
            ceilTargetRound,
            drandChainHash,
            goodCommitHash,
            goodCiphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }

    function test_Commit_TargetRoundAfterWindow_Reverts() public {
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp));
        uint64 targetRound = _tlockCommitTargetRound();
        bytes32 drandChainHash = _tlockDrandChainHash();
        uint64 badTargetRound = targetRound + 10_000;
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, badTargetRound, drandChainHash);
        bytes32 commitHash = _commitHash(true, salt, contentId, badTargetRound, drandChainHash, ciphertext);

        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext25 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.TargetRoundOutOfWindow.selector);
        engine.commitVote(
            contentId, cachedRoundContext25, badTargetRound, drandChainHash, commitHash, ciphertext, STAKE, address(0)
        );
    }

    function test_Commit_TargetRoundAtTwoPeriodTolerance_Accepts() public {
        uint256 contentId = _submitContent();

        uint256 revealableAfter = block.timestamp + EPOCH;
        uint64 targetRound =
            _roundAt(revealableAfter + 2 * uint256(_tlockDrandPeriod()), _tlockDrandGenesisTime(), _tlockDrandPeriod());
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp, "two period target"));
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, targetRound, drandChainHash);
        bytes32 commitHash = _commitHash(true, salt, voter1, contentId, targetRound, drandChainHash, ciphertext);

        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 roundContext = _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        engine.commitVote(
            contentId, roundContext, targetRound, drandChainHash, commitHash, ciphertext, STAKE, address(0)
        );
    }

    function test_Commit_TargetRoundCannotDelayLongCustomEpoch_Reverts() public {
        vm.prank(owner);
        _setTlockRoundConfig(ProtocolConfig(protocolConfigAddress), 7 days, 7 days, 3, 200);
        uint256 contentId = _submitContent();

        bytes32 salt = keccak256(abi.encodePacked(voter1, block.timestamp, "long target drift"));
        bytes32 drandChainHash = _tlockDrandChainHash();
        uint64 badTargetRound = _tlockTargetRoundAt(block.timestamp + 14 days);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId, badTargetRound, drandChainHash);
        bytes32 commitHash = _commitHash(true, salt, contentId, badTargetRound, drandChainHash, ciphertext);

        vm.prank(voter1);
        lrepToken.approve(address(engine), STAKE);
        uint256 roundContext = _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(voter1);
        vm.expectRevert(RoundVotingEngine.TargetRoundOutOfWindow.selector);
        engine.commitVote(
            contentId, roundContext, badTargetRound, drandChainHash, commitHash, ciphertext, STAKE, address(0)
        );
    }

    function test_Commit_MaxVotersReached_Reverts() public {
        vm.prank(owner);
        // maxVoters=3 — after 3 commits the 4th is rejected
        _setTlockRoundConfig(ProtocolConfig(protocolConfigAddress), 1 hours, 7 days, 3, 3);

        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, true, STAKE);
        _commit(voter3, contentId, false, STAKE);

        bytes32 salt = keccak256(abi.encodePacked(voter4, block.timestamp));
        bytes32 commitHash = _commitHash(true, salt, contentId);
        bytes memory ciphertext = _testCiphertext(true, salt, contentId);

        vm.prank(voter4);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext26 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.prank(voter4);
        vm.expectRevert(RoundVotingEngine.MaxVotersReached.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext26,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );
    }

    function test_GetActiveRoundId_ReturnsZeroWithNoRound() public {
        uint256 contentId = _submitContent();
        assertEq(RoundEngineReadHelpers.activeRoundId(engine, contentId), 0);
    }

    function test_GetActiveRoundId_ReturnsCorrectId() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        assertEq(RoundEngineReadHelpers.activeRoundId(engine, contentId), 1);
    }

    function test_GetActiveRoundId_ReturnsZeroAfterSettlement() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);
        _settleRoundAfterRbtsSeed(contentId, roundId);
        assertEq(RoundEngineReadHelpers.activeRoundId(engine, contentId), 0);
    }

    function test_NewRoundCreatedAfterSettlement() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        // Wait past 24h cooldown then voter1 can commit again
        vm.warp(block.timestamp + 25 hours);
        _commit(voter1, contentId, true, STAKE);

        uint256 newRoundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        assertEq(newRoundId, roundId + 1);
    }

    function test_ThresholdReachedAt_SetOnMinVotersReveal() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);

        // Before 3rd reveal, thresholdReachedAt should be 0
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(round.thresholdReachedAt, 0);

        uint256 beforeThirdReveal = block.timestamp;
        _reveal(contentId, roundId, ck3, false, s3);

        round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(round.thresholdReachedAt, beforeThirdReveal);
    }

    function test_CommitVote_RevertsAfterRevealThresholdReached() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, false, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, false, s3);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertGt(round.thresholdReachedAt, 0);

        bytes32 salt4 = keccak256(abi.encodePacked(voter4, block.timestamp, "late-direct"));
        TestCommitArtifacts memory lateCommit = _buildTestCommitArtifacts(voter4, true, salt4, contentId);

        vm.startPrank(voter4);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext27 =
            _roundContext(engine.previewCommitRoundId(contentId), lateCommit.roundReferenceRatingBps);
        vm.expectRevert(RoundVotingEngine.ThresholdReached.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext27,
            lateCommit.targetRound,
            lateCommit.drandChainHash,
            lateCommit.commitHash,
            lateCommit.ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }

    function test_EpochWeighting_Epoch2Voters_ReducedWeight() public {
        uint256 contentId = _submitContent();

        // voter1 commits in epoch 1
        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        // Warp past first epoch — voter2 commits in epoch 2
        RoundLib.Round memory rEW0 = RoundEngineReadHelpers.round(engine, contentId, roundId);
        _warpPastTlockRevealTime(uint256(rEW0.startTime) + EPOCH);

        uint256 epoch2RevealableAfter = block.timestamp + EPOCH;
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, true, STAKE);
        (bytes32 ck3, bytes32 s3) = _commit(voter3, contentId, true, STAKE);

        // Warp past the epoch-2 commits' ceil tlock target.
        _warpPastTlockRevealTime(epoch2RevealableAfter);

        _reveal(contentId, roundId, ck1, false, s1);
        _reveal(contentId, roundId, ck2, true, s2);
        _reveal(contentId, roundId, ck3, true, s3);

        // UP gets 2 voters at 25% weight = 2 * STAKE * 0.25 = 0.5 * STAKE weighted
        // DOWN gets 1 voter at 100% weight = STAKE weighted
        // => DOWN wins despite fewer voters due to epoch-1 weight advantage

        _settleRoundAfterRbtsSeed(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
        // DOWN should win: weightedDownPool = STAKE * 10000/10000 = STAKE
        // weightedUpPool = STAKE * 2500/10000 * 2 = STAKE/2
        assertFalse(round.upWins);
    }

    function test_ConsensusSettlement_UnanimousUpWins() public {
        uint256 contentId = _submitContent();

        // All UP, no DOWN -> unanimous
        uint16 p1 = _predictionBps(0, true);
        uint16 p2 = _predictionBps(1, true);
        uint16 p3 = _predictionBps(2, true);
        (bytes32 ck1, bytes32 s1) = _commitPrediction(voter1, contentId, true, p1, STAKE);
        (bytes32 ck2, bytes32 s2) = _commitPrediction(voter2, contentId, true, p2, STAKE);
        (bytes32 ck3, bytes32 s3) = _commitPrediction(voter3, contentId, true, p3, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _revealPrediction(contentId, roundId, ck1, true, p1, s1);
        _revealPrediction(contentId, roundId, ck2, true, p2, s2);
        _revealPrediction(contentId, roundId, ck3, true, p3, s3);

        _settleRoundAfterRbtsSeed(contentId, roundId);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Settled));
        assertTrue(round.upWins);

        // No consensus subsidy; any voter pool comes from RBTS score-spread forfeiture.
        uint256 voterPool = engine.roundVoterPool(contentId, roundId);
        assertGt(voterPool, 0);
    }

    function test_CooldownActive_SucceedsAfter24h() public {
        uint256 contentId = _submitContent();

        // voter1 commits — starts 24h cooldown
        _commit(voter1, contentId, true, STAKE);

        // Within 24h — voter1 cannot commit again
        vm.startPrank(voter1);
        bytes32 salt1 = keccak256(abi.encodePacked(voter1, block.timestamp + 1));
        bytes32 commitHash1 = _commitHash(false, salt1, contentId);
        bytes memory ciphertext1 = _testCiphertext(false, salt1, contentId);
        lrepToken.approve(address(engine), STAKE);
        uint256 cachedRoundContext28 =
            _roundContext(engine.previewCommitRoundId(contentId), _defaultRatingReferenceBps());
        vm.expectRevert(RoundVotingEngine.CooldownActive.selector);
        engine.commitVote(
            contentId,
            cachedRoundContext28,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash1,
            ciphertext1,
            STAKE,
            address(0)
        );
        vm.stopPrank();

        // Warp past 24h cooldown — second round possible
        uint256 cid2 = _submitContentWithUrl("https://example.com/cooldown-test");
        vm.warp(block.timestamp + 25 hours);

        // voter1 can now commit to a different content
        _commit(voter1, cid2, true, STAKE);
        uint256 rid2 = RoundEngineReadHelpers.activeRoundId(engine, cid2);
        assertTrue(engine.voterCommitHash(cid2, rid2, voter1) != bytes32(0));
    }

    function test_Cooldown_AfterRoundSettles_VoterCanRecommit() public {
        (uint256 contentId, uint256 roundId) = _setupThreeVoterRound(true, true, false);
        _settleRoundAfterRbtsSeed(contentId, roundId);

        // Warp past 24h cooldown
        vm.warp(block.timestamp + 25 hours);

        // voter1 can now commit to a new round
        _commit(voter1, contentId, true, STAKE);
        uint256 newRoundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        assertEq(newRoundId, roundId + 1);
        assertTrue(engine.voterCommitHash(contentId, newRoundId, voter1) != bytes32(0));
    }

    function test_GetRound_ReturnsCorrectData() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);

        assertEq(round.voteCount, 2);
        assertEq(round.totalStake, STAKE * 2);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Open));
        assertGt(round.startTime, 0);
    }

    function test_GetCommit_ReturnsCorrectData() public {
        uint256 contentId = _submitContent();

        (bytes32 commitKey,) = _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        RoundLib.Commit memory commit = RoundEngineReadHelpers.commit(engine, contentId, roundId, commitKey);
        assertEq(commit.voter, voter1);
        assertEq(commit.stakeAmount, STAKE);
        assertFalse(commit.revealed);
        assertEq(commit.epochIndex, 0); // epoch 1 -> index 0
    }

    function test_GetRoundCommitHashes_ReturnsAllKeys() public {
        uint256 contentId = _submitContent();

        _commit(voter1, contentId, true, STAKE);
        _commit(voter2, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        bytes32[] memory keys = RoundEngineReadHelpers.commitKeys(engine, contentId, roundId);
        assertEq(keys.length, 2);
    }

    // computeCurrentEpochEnd tests removed — function removed for contract size.

    function test_RevealUpdatesWeightedPools() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        (bytes32 ck2, bytes32 s2) = _commit(voter2, contentId, false, STAKE);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);

        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        // epoch-1 weight = 100% -> weightedUpPool = STAKE
        assertEq(round.weightedUpPool, STAKE);
        assertEq(round.weightedDownPool, 0);

        _reveal(contentId, roundId, ck2, false, s2);

        round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        assertEq(round.weightedUpPool, STAKE);
        assertEq(round.weightedDownPool, STAKE);
    }

    function test_MultipleContentIds_IndependentRounds() public {
        uint256 cid1 = _submitContent();
        uint256 cid2 = _submitContentWithUrl("https://example.com/2");

        _commit(voter1, cid1, true, STAKE);
        _commit(voter2, cid2, false, STAKE);

        assertEq(RoundEngineReadHelpers.activeRoundId(engine, cid1), 1);
        assertEq(RoundEngineReadHelpers.activeRoundId(engine, cid2), 1);

        RoundLib.Round memory r1 = RoundEngineReadHelpers.round(engine, cid1, 1);
        RoundLib.Round memory r2 = RoundEngineReadHelpers.round(engine, cid2, 1);

        assertEq(r1.voteCount, 1);
        assertEq(r2.voteCount, 1);
    }

    function test_HasUnrevealedVotes_TrueWhenUnrevealed() public {
        uint256 contentId = _submitContent();
        _commit(voter1, contentId, true, STAKE);
        assertTrue(_hasUnrevealedVotes(contentId));
    }

    function test_HasUnrevealedVotes_FalseAfterAllRevealed() public {
        uint256 contentId = _submitContent();

        (bytes32 ck1, bytes32 s1) = _commit(voter1, contentId, true, STAKE);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);

        _warpPastTlockRevealTime(block.timestamp + EPOCH);
        _reveal(contentId, roundId, ck1, true, s1);

        assertFalse(_hasUnrevealedVotes(contentId));
    }

    function test_HasUnrevealedVotes_FalseWithNoRound() public {
        uint256 contentId = _submitContent();
        assertFalse(_hasUnrevealedVotes(contentId));
    }

    function _hasUnrevealedVotes(uint256 contentId) internal view returns (bool) {
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(engine, contentId);
        if (roundId == 0) return false;
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        return round.voteCount > round.revealedCount;
    }
}
