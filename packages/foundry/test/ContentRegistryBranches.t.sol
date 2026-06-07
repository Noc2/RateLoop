// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test, stdStorage, StdStorage } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { SubmissionMediaValidator } from "../contracts/SubmissionMediaValidator.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { RoundRewardDistributor } from "../contracts/RoundRewardDistributor.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { RatingLib } from "../contracts/libraries/RatingLib.sol";
import { RoundEngineReadHelpers } from "./helpers/RoundEngineReadHelpers.sol";
import { MockCategoryRegistry } from "../contracts/mocks/MockCategoryRegistry.sol";
import { MockQuestionRewardPoolEscrow } from "./mocks/MockQuestionRewardPoolEscrow.sol";
import { VotingTestBase } from "./helpers/VotingTestHelpers.sol";

// =========================================================================
// TEST CONTRACT
// =========================================================================

contract ContentRegistryBranchesTest is VotingTestBase {
    using stdStorage for StdStorage;

    LoopReputation public lrepToken;
    ContentRegistry public registry;
    RoundVotingEngine public votingEngine;
    RoundRewardDistributor public rewardDistributor;
    RaterRegistry public raterRegistry;
    MockCategoryRegistry public mockCategoryRegistry;
    MockQuestionRewardPoolEscrow public mockQuestionRewardPoolEscrow;

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
    address public bonusPool = address(101);
    address public delegate = address(102);

    uint256 public constant T0 = 1000;
    uint256 public constant STAKE = 5e6;

    event ContentDetailsSubmitted(uint256 indexed contentId, string detailsUrl, bytes32 detailsHash);
    bytes32 internal constant QUESTION_CONTENT_ANCHORED_TOPIC =
        keccak256("QuestionContentAnchored(uint256,uint8,uint256,string,bytes32,bytes32)");
    bytes32 internal constant QUESTION_BUNDLE_CONTENT_LINKED_TOPIC =
        keccak256("QuestionBundleContentLinked(uint256,uint256,uint256)");

    struct QuestionReservation {
        string contextUrl;
        string[] imageUrls;
        string videoUrl;
        string title;
        string description;
        string tags;
        uint256 categoryId;
        bytes32 salt;
        address submitterAddress;
        ContentRegistry.SubmissionRewardTerms rewardTerms;
        RoundLib.RoundConfig roundConfig;
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
        votingEngine = RoundVotingEngine(
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

        registry.setVotingEngine(address(votingEngine));
        registry.setBonusPool(bonusPool);
        registry.setTreasury(treasury);
        ProtocolConfig(address(votingEngine.protocolConfig())).setRewardDistributor(address(rewardDistributor));
        ProtocolConfig(address(votingEngine.protocolConfig())).setTreasury(treasury);
        _setTlockRoundConfig(ProtocolConfig(address(votingEngine.protocolConfig())), 1 hours, 7 days, 3, 100);

        raterRegistry = _deployRaterRegistry(owner);
        mockCategoryRegistry = new MockCategoryRegistry();
        mockCategoryRegistry.seedDefaultTestCategories();
        mockQuestionRewardPoolEscrow = new MockQuestionRewardPoolEscrow();
        registry.setCategoryRegistry(address(mockCategoryRegistry));
        registry.setProtocolConfig(address(votingEngine.protocolConfig()));
        registry.setQuestionRewardPoolEscrow(address(mockQuestionRewardPoolEscrow));
        ProtocolConfig(address(votingEngine.protocolConfig())).setCategoryRegistry(address(mockCategoryRegistry));
        ProtocolConfig(address(votingEngine.protocolConfig())).setRaterRegistry(address(raterRegistry));

        lrepToken.mint(owner, 2_000_000e6);
        lrepToken.approve(address(votingEngine), 500_000e6);

        address[9] memory users = [submitter, voter1, voter2, voter3, voter4, voter5, voter6, keeper, delegate];
        for (uint256 i = 0; i < users.length; i++) {
            lrepToken.mint(users[i], 10_000e6);
            if (users[i] != delegate) {
                _seedRaterIdentity(raterRegistry, users[i], bytes32(uint256(uint160(users[i]))));
            }
        }

        vm.stopPrank();
    }

    function test_SetQuestionRewardPoolEscrow_RotationRequiresPause() public {
        MockQuestionRewardPoolEscrow replacementEscrow = new MockQuestionRewardPoolEscrow();

        vm.prank(owner);
        vm.expectRevert("Pause required");
        registry.setQuestionRewardPoolEscrow(address(replacementEscrow));

        assertEq(registry.questionRewardPoolEscrow(), address(mockQuestionRewardPoolEscrow));

        vm.startPrank(owner);
        registry.pause();
        registry.setQuestionRewardPoolEscrow(address(replacementEscrow));
        vm.stopPrank();

        assertEq(registry.questionRewardPoolEscrow(), address(replacementEscrow));
    }

    function test_SetProtocolConfig_UpdatesIdentityRegistry() public {
        ProtocolConfig replacementConfig = _deployProtocolConfig(owner);
        RaterRegistry replacementRaterRegistry = _deployRaterRegistry(owner);

        vm.startPrank(owner);
        replacementConfig.setRaterRegistry(address(replacementRaterRegistry));
        registry.setProtocolConfig(address(replacementConfig));
        vm.stopPrank();

        assertEq(address(registry.protocolConfig()), address(replacementConfig));
    }

    function test_SetCategoryRegistryRejectsNoCodeOrWrongContract() public {
        vm.prank(owner);
        vm.expectRevert("No code");
        registry.setCategoryRegistry(address(0xBEEF));

        vm.prank(owner);
        vm.expectRevert("Invalid category registry");
        registry.setCategoryRegistry(address(mockQuestionRewardPoolEscrow));
    }

    function test_SetProtocolConfigRejectsNoCodeOrWrongContract() public {
        vm.prank(owner);
        vm.expectRevert("No code");
        registry.setProtocolConfig(address(0xBEEF));

        vm.prank(owner);
        vm.expectRevert("Invalid protocol config");
        registry.setProtocolConfig(address(mockQuestionRewardPoolEscrow));
    }

    function _vote(address voter, uint256 contentId, bool isUp) internal {
        _commit(voter, contentId, isUp);
    }

    function _commit(address voter, uint256 contentId, bool isUp) internal returns (bytes32 commitKey, bytes32 salt) {
        return _commitWithStake(voter, contentId, isUp, STAKE);
    }

    function _commitWithStake(address voter, uint256 contentId, bool isUp, uint256 stake)
        internal
        returns (bytes32 commitKey, bytes32 salt)
    {
        return _commitWithStakeToEngine(votingEngine, voter, contentId, isUp, stake);
    }

    function _commitWithStakeToEngine(
        RoundVotingEngine engine,
        address voter,
        uint256 contentId,
        bool isUp,
        uint256 stake
    ) internal returns (bytes32 commitKey, bytes32 salt) {
        salt = keccak256(abi.encodePacked(voter, block.timestamp));
        _openRoundForTest(engine, contentId, voter);
        uint256 roundId = _previewCommitRoundId(engine, contentId);
        uint16 referenceRatingBps = _currentRatingReferenceBps(contentId);
        bytes memory ciphertext = _testCiphertext(isUp, salt, contentId);
        bytes32 commitHash = _commitHash(
            isUp,
            salt,
            voter,
            contentId,
            roundId,
            referenceRatingBps,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ciphertext
        );
        vm.startPrank(voter);
        lrepToken.approve(address(engine), stake);
        uint256 cachedRoundContext1 = _roundContext(roundId, referenceRatingBps);
        engine.commitVote(
            contentId,
            cachedRoundContext1,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            stake,
            address(0)
        );
        vm.stopPrank();
        commitKey = keccak256(abi.encodePacked(voter, commitHash));
    }

    function _reserveQuestionSubmissionWithRewardTerms(
        string memory contextUrl,
        string[] memory imageUrls,
        string memory videoUrl,
        string memory title,
        string memory description,
        string memory tags,
        uint256 categoryId,
        bytes32 salt,
        address submitterAddress,
        uint8 rewardAsset,
        uint256 rewardAmount,
        uint256 requiredVoters,
        uint256 requiredSettledRounds,
        uint256 rewardPoolExpiresAt
    ) internal returns (bytes32 submissionKey) {
        QuestionReservation memory reservation;
        reservation.contextUrl = contextUrl;
        reservation.imageUrls = imageUrls;
        reservation.videoUrl = videoUrl;
        reservation.title = title;
        reservation.description = description;
        reservation.tags = tags;
        reservation.categoryId = categoryId;
        reservation.salt = salt;
        reservation.submitterAddress = submitterAddress;
        reservation.rewardTerms = ContentRegistry.SubmissionRewardTerms({
            asset: rewardAsset,
            amount: rewardAmount,
            requiredVoters: requiredVoters,
            requiredSettledRounds: requiredSettledRounds,
            bountyStartBy: rewardPoolExpiresAt,
            bountyWindowSeconds: rewardPoolExpiresAt == 0 ? 0 : rewardPoolExpiresAt - block.timestamp,
            feedbackWindowSeconds: rewardPoolExpiresAt == 0 ? 0 : rewardPoolExpiresAt - block.timestamp,
            bountyEligibility: 0
        });
        reservation.roundConfig =
            RoundLib.RoundConfig({ epochDuration: 1 hours, maxDuration: 7 days, minVoters: 3, maxVoters: 100 });
        return _reserveQuestionSubmission(reservation);
    }

    function _reserveQuestionSubmissionWithRewardTermsAndRoundConfig(
        string memory contextUrl,
        string[] memory imageUrls,
        string memory videoUrl,
        string memory title,
        string memory description,
        string memory tags,
        uint256 categoryId,
        bytes32 salt,
        address submitterAddress,
        ContentRegistry.SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig
    ) internal returns (bytes32 submissionKey) {
        QuestionReservation memory reservation;
        reservation.contextUrl = contextUrl;
        reservation.imageUrls = imageUrls;
        reservation.videoUrl = videoUrl;
        reservation.title = title;
        reservation.description = description;
        reservation.tags = tags;
        reservation.categoryId = categoryId;
        reservation.salt = salt;
        reservation.submitterAddress = submitterAddress;
        reservation.rewardTerms = rewardTerms;
        reservation.roundConfig = roundConfig;
        return _reserveQuestionSubmission(reservation);
    }

    function _submissionRewardTerms(
        uint8 rewardAsset,
        uint256 rewardAmount,
        uint256 requiredVoters,
        uint256 requiredSettledRounds,
        uint256 rewardPoolExpiresAt
    ) internal view returns (ContentRegistry.SubmissionRewardTerms memory) {
        return ContentRegistry.SubmissionRewardTerms({
            asset: rewardAsset,
            amount: rewardAmount,
            requiredVoters: requiredVoters,
            requiredSettledRounds: requiredSettledRounds,
            bountyStartBy: rewardPoolExpiresAt,
            bountyWindowSeconds: rewardPoolExpiresAt == 0 ? 0 : rewardPoolExpiresAt - block.timestamp,
            feedbackWindowSeconds: rewardPoolExpiresAt == 0 ? 0 : rewardPoolExpiresAt - block.timestamp,
            bountyEligibility: 0
        });
    }

    function _defaultContentRoundConfig() internal pure returns (RoundLib.RoundConfig memory) {
        return RoundLib.RoundConfig({ epochDuration: 1 hours, maxDuration: 7 days, minVoters: 3, maxVoters: 100 });
    }

    function _bundleContentRoundConfig() internal pure returns (RoundLib.RoundConfig memory) {
        return RoundLib.RoundConfig({ epochDuration: 1 hours, maxDuration: 7 days, minVoters: 3, maxVoters: 100 });
    }

    function _submitReservedQuestionBundleForDormancyTest() internal returns (uint256[] memory contentIds) {
        ContentRegistry.BundleQuestionInput[] memory questions = new ContentRegistry.BundleQuestionInput[](2);
        questions[0] = ContentRegistry.BundleQuestionInput({
            contextUrl: "https://example.com/dormant-bundle-a",
            imageUrls: _emptyImageUrls(),
            videoUrl: "",
            title: "Question A?",
            tags: "Products",
            categoryId: 1,
            details: _emptySubmissionDetails(),
            salt: keccak256("dormant-bundle-a"),
            spec: _defaultQuestionSpec()
        });
        questions[1] = ContentRegistry.BundleQuestionInput({
            contextUrl: "https://example.com/dormant-bundle-b",
            imageUrls: _emptyImageUrls(),
            videoUrl: "",
            title: "Question B?",
            tags: "Products",
            categoryId: 1,
            details: _emptySubmissionDetails(),
            salt: keccak256("dormant-bundle-b"),
            spec: _defaultQuestionSpec()
        });
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = _submissionRewardTerms(
            DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            _defaultSubmissionRewardAmount(registry) * 2,
            DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS,
            DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
            block.timestamp + 30 days
        );
        RoundLib.RoundConfig memory roundConfig = _bundleContentRoundConfig();
        bytes32 revealCommitment = _bundleRevealCommitment(questions, rewardTerms, roundConfig, submitter);

        vm.startPrank(submitter);
        registry.reserveSubmission(revealCommitment);
        vm.warp(block.timestamp + 2 seconds);
        (, contentIds) = registry.submitQuestionBundleWithRewardAndRoundConfig(questions, rewardTerms, roundConfig);
        vm.stopPrank();
    }

    function _bundleRevealCommitment(
        ContentRegistry.BundleQuestionInput[] memory questions,
        ContentRegistry.SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig,
        address submitterAddress
    ) internal view returns (bytes32) {
        bytes32[] memory questionHashes = new bytes32[](questions.length);
        for (uint256 i = 0; i < questions.length; i++) {
            uint256 resolvedCategoryId = questions[i].categoryId;
            questionHashes[i] = keccak256(
                abi.encode(
                    QUESTION_BUNDLE_ITEM_DOMAIN,
                    keccak256(abi.encode(questions[i].contextUrl, questions[i].title, questions[i].tags)),
                    keccak256(abi.encode(questions[i].imageUrls, questions[i].videoUrl)),
                    keccak256(abi.encode(questions[i].details.detailsUrl, questions[i].details.detailsHash)),
                    resolvedCategoryId,
                    questions[i].salt,
                    i,
                    questions[i].spec.questionMetadataHash,
                    questions[i].spec.resultSpecHash
                )
            );
        }

        bytes32 bundleHash = keccak256(abi.encode(QUESTION_BUNDLE_DOMAIN, questionHashes));
        return keccak256(
            abi.encode(
                QUESTION_BUNDLE_REVEAL_DOMAIN,
                bundleHash,
                submitterAddress,
                rewardTerms.asset,
                rewardTerms.amount,
                rewardTerms.requiredVoters,
                rewardTerms.requiredSettledRounds,
                rewardTerms.bountyStartBy,
                rewardTerms.bountyWindowSeconds,
                rewardTerms.feedbackWindowSeconds,
                rewardTerms.bountyEligibility,
                roundConfig.epochDuration,
                roundConfig.maxDuration,
                roundConfig.minVoters,
                roundConfig.maxVoters
            )
        );
    }

    function _reserveQuestionSubmission(QuestionReservation memory reservation)
        internal
        returns (bytes32 submissionKey)
    {
        submissionKey = _questionSubmissionKey(
            reservation.contextUrl,
            reservation.imageUrls,
            reservation.videoUrl,
            reservation.title,
            reservation.tags,
            reservation.categoryId,
            _emptySubmissionDetails()
        );
        bytes32 revealCommitment = _questionRevealCommitment(
            submissionKey,
            _submissionMediaHash(reservation.imageUrls, reservation.videoUrl),
            reservation.title,
            reservation.description,
            reservation.tags,
            reservation.categoryId,
            reservation.salt,
            reservation.submitterAddress,
            reservation.rewardTerms,
            reservation.roundConfig
        );
        registry.reserveSubmission(revealCommitment);
    }

    function _settleHealthyRound(uint256 contentId) internal returns (uint256 roundId) {
        return _settleHealthyRoundWithVoters(contentId, voter1, voter2, voter3);
    }

    function _settleHealthyRoundWithVoters(uint256 contentId, address upVoter1, address upVoter2, address downVoter)
        internal
        returns (uint256 roundId)
    {
        (bytes32 ck1, bytes32 salt1) = _commit(upVoter1, contentId, true);
        (bytes32 ck2, bytes32 salt2) = _commit(upVoter2, contentId, true);
        (bytes32 ck3, bytes32 salt3) = _commit(downVoter, contentId, false);

        roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, contentId);
        _warpPastTlockRevealTime(block.timestamp + 1 hours);
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck1, true, 5_000, salt1);
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck2, true, 5_000, salt2);
        votingEngine.revealVoteByCommitKey(contentId, roundId, ck3, false, 5_000, salt3);
        _settleAfterRbtsSeed(votingEngine, contentId, roundId);
    }

    // =========================================================================
    // submitContent BRANCHES
    // =========================================================================

    function test_SubmitQuestion_AllowsImageUrlWithCategory() public {
        string memory url = _uploadedImageUrl("widget-1");
        string memory title = "Does this product look useful?";
        string memory description = "A subjective product review question with a required image link.";
        string memory tags = "Products,Review";
        uint256 categoryId = 1;
        bytes32 salt = keccak256("arbitrary-question-url");

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        (uint256 id, bytes32 submissionKey) =
            _submitQuestionImageWithReservation(registry, url, title, description, tags, categoryId, salt, submitter);
        vm.stopPrank();

        (,,,,,,,,, uint256 storedCategoryId) = registry.contents(id);
        assertEq(storedCategoryId, categoryId);
        assertTrue(registry.submissionKeyUsed(submissionKey));
    }

    function test_SubmitQuestion_AllowsEmptyOptionalMedia() public {
        string memory contextUrl = "https://example.com/context";
        string[] memory imageUrls = _emptyImageUrls();
        bytes32 salt = keccak256("empty-optional-media");

        vm.startPrank(submitter);
        _reserveQuestionSubmissionWithRewardTerms(
            contextUrl,
            imageUrls,
            "",
            "Question?",
            "Context",
            "Products",
            1,
            salt,
            submitter,
            DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            _defaultSubmissionRewardAmount(registry),
            DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS,
            DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
            DEFAULT_SUBMISSION_REWARD_EXPIRES_AT
        );
        vm.warp(block.timestamp + 1);
        uint256 id = registry.submitQuestion(
            contextUrl,
            imageUrls,
            "",
            "Question?",
            "Products",
            1,
            _emptySubmissionDetails(),
            salt,
            _defaultQuestionSpec()
        );
        vm.stopPrank();

        assertEq(id, 1);
    }

    function test_SubmitQuestion_AllowsDetailsUrlAndEmitsHash() public {
        string memory contextUrl = "https://example.com/context";
        string[] memory imageUrls = _emptyImageUrls();
        bytes32 salt = keccak256("question-details");
        ContentRegistry.SubmissionDetails memory details = ContentRegistry.SubmissionDetails({
            detailsUrl: "https://example.com/details/question-details.json",
            detailsHash: keccak256(bytes("long-form details"))
        });

        MediaQuestionReservation memory reservation;
        reservation.registry = registry;
        reservation.contextUrl = contextUrl;
        reservation.imageUrls = imageUrls;
        reservation.videoUrl = "";
        reservation.title = "Question?";
        reservation.tags = "Products";
        reservation.categoryId = 1;
        reservation.details = details;
        reservation.salt = salt;
        reservation.submitter = submitter;

        vm.startPrank(submitter);
        bytes32 submissionKey = _reserveQuestionMediaSubmission(reservation);
        vm.warp(block.timestamp + 1);
        vm.expectEmit(true, false, false, true, address(registry));
        emit ContentDetailsSubmitted(1, details.detailsUrl, details.detailsHash);
        uint256 id = registry.submitQuestion(
            contextUrl, imageUrls, "", "Question?", "Products", 1, details, salt, _defaultQuestionSpec()
        );
        vm.stopPrank();

        assertEq(id, 1);
        assertTrue(registry.submissionKeyUsed(submissionKey));
    }

    function test_QuestionSubmissionKey_IncludesDetails() public pure {
        string memory contextUrl = "https://example.com/context";
        string[] memory imageUrls = _emptyImageUrls();
        bytes32 emptyDetailsKey =
            _questionSubmissionKey(contextUrl, imageUrls, "", "Question?", "Products", 1, _emptySubmissionDetails());
        bytes32 detailsKey = _questionSubmissionKey(
            contextUrl,
            imageUrls,
            "",
            "Question?",
            "Products",
            1,
            ContentRegistry.SubmissionDetails({
                detailsUrl: "https://example.com/details/question-details.json",
                detailsHash: keccak256(bytes("long-form details"))
            })
        );

        assertNotEq(emptyDetailsKey, detailsKey);
    }

    function test_SubmitQuestion_RejectsDetailsUrlWithoutHash() public {
        vm.expectRevert("Details hash required");
        registry.submitQuestion(
            "https://example.com/context",
            _emptyImageUrls(),
            "",
            "Question?",
            "Products",
            1,
            ContentRegistry.SubmissionDetails({
                detailsUrl: "https://example.com/details/question-details.json", detailsHash: bytes32(0)
            }),
            keccak256("details-url-without-hash"),
            _defaultQuestionSpec()
        );
    }

    function test_SubmitQuestion_RejectsDetailsHashWithoutUrl() public {
        vm.expectRevert("Details URL required");
        registry.submitQuestion(
            "https://example.com/context",
            _emptyImageUrls(),
            "",
            "Question?",
            "Products",
            1,
            ContentRegistry.SubmissionDetails({ detailsUrl: "", detailsHash: keccak256(bytes("long-form details")) }),
            keccak256("details-hash-without-url"),
            _defaultQuestionSpec()
        );
    }

    function test_SubmitQuestion_DefaultRewardCoversMaxTurnout() public {
        string memory contextUrl = "https://example.com/default-reward";
        string[] memory imageUrls = _emptyImageUrls();
        bytes32 salt = keccak256("default-reward-covers-max-turnout");

        vm.startPrank(submitter);
        _reserveQuestionSubmissionWithRewardTerms(
            contextUrl,
            imageUrls,
            "",
            "Question?",
            "Context",
            "Products",
            1,
            salt,
            submitter,
            DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            _defaultSubmissionRewardAmount(registry),
            DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS,
            DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
            DEFAULT_SUBMISSION_REWARD_EXPIRES_AT
        );
        vm.warp(block.timestamp + 1);
        registry.submitQuestion(
            contextUrl,
            imageUrls,
            "",
            "Question?",
            "Products",
            1,
            _emptySubmissionDetails(),
            salt,
            _defaultQuestionSpec()
        );
        vm.stopPrank();

        (,,, uint16 maxVoters) = ProtocolConfig(address(votingEngine.protocolConfig())).config();
        assertGe(mockQuestionRewardPoolEscrow.lastAmount(), uint256(maxVoters) * 10_000);
    }

    function test_SubmitQuestion_GenericEvidenceUrl_Reverts() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        vm.expectRevert("Invalid media URL");
        registry.submitQuestion(
            "https://example.com/context",
            _singleImageUrls("https://example.com/reviews/widget-1"),
            "",
            "Question?",
            "Products",
            1,
            _emptySubmissionDetails(),
            bytes32(0),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitQuestion_AllowsContentAddressedExternalImages() public view {
        string[] memory imageUrls = new string[](3);
        imageUrls[0] = "ipfs://bafybeigdyrzt5sfp7udm7hu76u5n3da7z5jhjxvzv35gn4c2kaou6mriya";
        imageUrls[1] = "ar://VZcC2M9fXxTcdGQYQ0lM8dPj7Q8g3F6h3xUR8nW8L4Q";
        imageUrls[2] =
            "https://cdn.example.com/review/image.webp#sha256=0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

        _questionSubmissionKey(
            "https://example.com/context", imageUrls, "", "Question?", "Products", 1, _emptySubmissionDetails()
        );
    }

    function test_SubmitQuestion_AllowsYouTubeVideoWithoutContextUrl() public {
        string memory url = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
        string memory title = "Is this video clear?";
        string memory description = "A subjective video review question.";
        string memory tags = "Video,Review";
        uint256 categoryId = 5;
        bytes32 salt = keccak256("youtube-question-without-context-url");

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        string[] memory imageUrls = _emptyImageUrls();
        bytes32 submissionKey = _reserveQuestionMediaSubmission(
            registry, "", imageUrls, url, title, description, tags, categoryId, salt, submitter
        );
        vm.warp(block.timestamp + 1);
        uint256 id = registry.submitQuestion(
            "", imageUrls, url, title, tags, categoryId, _emptySubmissionDetails(), salt, _defaultQuestionSpec()
        );
        vm.stopPrank();

        (,,,,,,,,, uint256 storedCategoryId) = registry.contents(id);
        assertEq(storedCategoryId, categoryId);
        assertTrue(registry.submissionKeyUsed(submissionKey));
    }

    function test_SubmitQuestion_AllowsSupportedYouTubeVideoShapes() public view {
        _questionSubmissionKey(
            "https://example.com/context",
            _emptyImageUrls(),
            "https://youtu.be/jNQXAC9IVRw?t=1",
            "Question?",
            "Video",
            1,
            _emptySubmissionDetails()
        );
        _questionSubmissionKey(
            "https://example.com/context",
            _emptyImageUrls(),
            "https://www.youtube.com/embed/jNQXAC9IVRw",
            "Question?",
            "Video",
            1,
            _emptySubmissionDetails()
        );
        _questionSubmissionKey(
            "https://example.com/context",
            _emptyImageUrls(),
            "https://youtube.com/watch?feature=share&v=jNQXAC9IVRw",
            "Question?",
            "Video",
            1,
            _emptySubmissionDetails()
        );
    }

    function test_SubmitQuestion_RejectsMalformedYouTubeVideoUrls() public {
        string[] memory urls = new string[](9);
        urls[0] = "https://www.youtube.com/watch?av=jNQXAC9IVRw";
        urls[1] = "https://www.youtube.com/watch?v=";
        urls[2] = "https://youtu.be/";
        urls[3] = "https://www.youtube.com/embed/";
        urls[4] = "https://youtu.be/bad/id";
        urls[5] = "https://youtu.be/a";
        urls[6] = "https://youtu.be/jNQXAC9IVRwx";
        urls[7] = "https://www.youtube.com/watch?v=a";
        urls[8] = "https://www.youtube.com/watch?v=jNQXAC9IVRwx";

        for (uint256 i = 0; i < urls.length; i++) {
            vm.expectRevert("Invalid media URL");
            registry.submitQuestion(
                "https://example.com/context",
                _emptyImageUrls(),
                urls[i],
                "Question?",
                "Video",
                1,
                _emptySubmissionDetails(),
                bytes32(i + 1),
                _defaultQuestionSpec()
            );
        }
    }

    function test_SubmitQuestion_AllowsMultipleOptionalImages() public {
        string[] memory imageUrls = new string[](2);
        imageUrls[0] = _uploadedImageUrl("multi-image-a");
        imageUrls[1] = _uploadedImageUrl("multi-image-b");
        string memory title = "Which product image works better?";
        string memory description = "Compare the two images for usefulness.";
        string memory tags = "Products,Images";
        uint256 categoryId = 1;
        bytes32 salt = keccak256("multi-image-question");

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        bytes32 submissionKey = _reserveQuestionSubmissionWithRewardTerms(
            "https://example.com/context",
            imageUrls,
            "",
            title,
            description,
            tags,
            categoryId,
            salt,
            submitter,
            DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            _defaultSubmissionRewardAmount(registry),
            DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS,
            DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
            DEFAULT_SUBMISSION_REWARD_EXPIRES_AT
        );
        vm.warp(block.timestamp + 1);
        uint256 id = registry.submitQuestion(
            "https://example.com/context",
            imageUrls,
            "",
            title,
            tags,
            categoryId,
            _emptySubmissionDetails(),
            salt,
            _defaultQuestionSpec()
        );
        vm.stopPrank();

        (,, address rawSubmitter,,,,,,, uint64 storedCategoryId) = registry.contents(id);
        assertEq(rawSubmitter, submitter);
        assertEq(storedCategoryId, categoryId);
        assertTrue(registry.submissionKeyUsed(submissionKey));
    }

    function test_SubmitQuestion_EmitsQuestionContentAnchors() public {
        string[] memory imageUrls = new string[](2);
        imageUrls[0] = _uploadedImageUrl("anchor-image-a");
        imageUrls[1] = _uploadedImageUrl("anchor-image-b");
        ContentRegistry.QuestionSpecCommitment memory spec = _defaultQuestionSpec();
        bytes32 salt = keccak256("anchored-question");

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _reserveQuestionSubmissionWithRewardTerms(
            "https://example.com/context",
            imageUrls,
            "",
            "Which product image works better?",
            "Compare the two images for usefulness.",
            "Products,Images",
            1,
            salt,
            submitter,
            DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            _defaultSubmissionRewardAmount(registry),
            DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS,
            DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
            DEFAULT_SUBMISSION_REWARD_EXPIRES_AT
        );
        vm.warp(block.timestamp + 1);
        vm.recordLogs();
        uint256 id = registry.submitQuestion(
            "https://example.com/context",
            imageUrls,
            "",
            "Which product image works better?",
            "Products,Images",
            1,
            _emptySubmissionDetails(),
            salt,
            spec
        );
        Vm.Log[] memory logs = vm.getRecordedLogs();
        vm.stopPrank();

        uint256 anchors;
        address validator = address(registry.submissionMediaValidator());
        assertEq(SubmissionMediaValidator(validator).authorizedEmitter(), address(registry));
        for (uint256 i = 0; i < logs.length; i++) {
            if (
                logs[i].topics.length == 3 && logs[i].topics[0] == QUESTION_CONTENT_ANCHORED_TOPIC
                    && logs[i].topics[1] == bytes32(id) && logs[i].topics[2] == bytes32(uint256(1))
            ) {
                assertEq(logs[i].emitter, validator);
                (uint256 mediaIndex, string memory url, bytes32 questionMetadataHash, bytes32 resultSpecHash) =
                    abi.decode(logs[i].data, (uint256, string, bytes32, bytes32));
                assertEq(mediaIndex, anchors);
                assertEq(url, imageUrls[anchors]);
                assertEq(questionMetadataHash, spec.questionMetadataHash);
                assertEq(resultSpecHash, spec.resultSpecHash);
                anchors++;
            }
        }
        assertEq(anchors, 2);

        vm.prank(submitter);
        vm.expectRevert(SubmissionMediaValidator.UnauthorizedEmitter.selector);
        SubmissionMediaValidator(validator)
            .emitQuestionContentAnchored(id, imageUrls, "", spec.questionMetadataHash, spec.resultSpecHash);
    }

    function test_SubmitQuestion_AllowsRateloopAiUploadedImages() public view {
        _questionSubmissionKey(
            "https://example.com/context",
            _singleImageUrls(
                "https://www.rateloop.ai/api/attachments/images/att_0123456789abcdef.webp#sha256=0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
            ),
            "",
            "Question?",
            "Products",
            1,
            _emptySubmissionDetails()
        );
        _questionSubmissionKey(
            "https://example.com/context",
            _singleImageUrls(
                "https://rateloop.ai/api/attachments/images/att_0123456789abcdef.webp#sha256=0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
            ),
            "",
            "Question?",
            "Products",
            1,
            _emptySubmissionDetails()
        );
    }

    function test_SubmitQuestion_RevertsWhenReservedMediaChanges() public {
        string[] memory reservedImageUrls = new string[](2);
        reservedImageUrls[0] = _uploadedImageUrl("reserved-a");
        reservedImageUrls[1] = _uploadedImageUrl("reserved-b");
        string[] memory changedImageUrls = new string[](2);
        changedImageUrls[0] = reservedImageUrls[0];
        changedImageUrls[1] = _uploadedImageUrl("changed-b");
        string memory title = "Which media set is better?";
        string memory description = "The reservation should bind every image URL.";
        string memory tags = "Products,Images";
        uint256 categoryId = 1;
        bytes32 salt = keccak256("media-change-question");

        vm.startPrank(submitter);
        _reserveQuestionMediaSubmission(
            registry,
            "https://example.com/context",
            reservedImageUrls,
            "",
            title,
            description,
            tags,
            categoryId,
            salt,
            submitter
        );
        vm.warp(block.timestamp + 1);
        vm.expectRevert("Reservation not found");
        registry.submitQuestion(
            "https://example.com/context",
            changedImageUrls,
            "",
            title,
            tags,
            categoryId,
            _emptySubmissionDetails(),
            salt,
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitQuestion_RevertsWhenReservedOptionalMediaChanges() public {
        string memory contextUrl = "https://example.com/context";
        string[] memory reservedImageUrls = _singleImageUrls(_uploadedImageUrl("reserved-preview"));
        string[] memory changedImageUrls = _singleImageUrls(_uploadedImageUrl("changed-preview"));
        string memory title = "Should this context be trusted?";
        string memory description = "The reservation should bind optional preview media.";
        string memory tags = "Context,Images";
        uint256 categoryId = 1;
        bytes32 salt = keccak256("context-media-change-question");

        vm.startPrank(submitter);
        _reserveQuestionSubmissionWithRewardTerms(
            contextUrl,
            reservedImageUrls,
            "",
            title,
            description,
            tags,
            categoryId,
            salt,
            submitter,
            DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            _defaultSubmissionRewardAmount(registry),
            DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS,
            DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
            DEFAULT_SUBMISSION_REWARD_EXPIRES_AT
        );
        vm.warp(block.timestamp + 1);
        vm.expectRevert("Reservation not found");
        registry.submitQuestion(
            contextUrl,
            changedImageUrls,
            "",
            title,
            tags,
            categoryId,
            _emptySubmissionDetails(),
            salt,
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitQuestionWithReward_UsesFlexibleSubmissionBountyTerms() public {
        string memory contextUrl = "https://example.com/flexible-bounty";
        string memory title = "How useful is this comparison?";
        string memory description = "Rate whether voters have enough detail.";
        string memory tags = "Products,Bounty";
        uint256 categoryId = 1;
        bytes32 salt = keccak256("flexible-submission-bounty");
        string[] memory imageUrls = _emptyImageUrls();
        uint256 rewardAmount = _defaultSubmissionRewardAmount(registry);
        uint256 requiredVoters = 5;
        uint256 requiredSettledRounds = 2;
        uint256 rewardPoolExpiresAt = block.timestamp + 14 days;
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = _submissionRewardTerms(
            DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            rewardAmount,
            requiredVoters,
            requiredSettledRounds,
            rewardPoolExpiresAt
        );

        vm.startPrank(submitter);
        lrepToken.approve(address(mockQuestionRewardPoolEscrow), rewardAmount);
        _reserveQuestionSubmissionWithRewardTerms(
            contextUrl,
            imageUrls,
            "",
            title,
            description,
            tags,
            categoryId,
            salt,
            submitter,
            DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            rewardAmount,
            requiredVoters,
            requiredSettledRounds,
            rewardPoolExpiresAt
        );
        vm.warp(block.timestamp + 1);
        uint256 id = registry.submitQuestionWithRewardAndRoundConfig(
            contextUrl,
            imageUrls,
            "",
            title,
            tags,
            categoryId,
            _emptySubmissionDetails(),
            salt,
            rewardTerms,
            _defaultContentRoundConfig(),
            _defaultQuestionSpec()
        );
        vm.stopPrank();

        assertEq(mockQuestionRewardPoolEscrow.lastContentId(), id);
        assertEq(mockQuestionRewardPoolEscrow.lastFunder(), submitter);
        assertEq(mockQuestionRewardPoolEscrow.lastAsset(), DEFAULT_SUBMISSION_REWARD_ASSET_LREP);
        assertEq(mockQuestionRewardPoolEscrow.lastAmount(), rewardAmount);
        assertEq(mockQuestionRewardPoolEscrow.lastRequiredVoters(), requiredVoters);
        assertEq(mockQuestionRewardPoolEscrow.lastRequiredSettledRounds(), requiredSettledRounds);
        assertEq(mockQuestionRewardPoolEscrow.lastBountyStartBy(), rewardTerms.bountyStartBy, "bounty start by");
        assertEq(
            mockQuestionRewardPoolEscrow.lastBountyWindowSeconds(), rewardTerms.bountyWindowSeconds, "bounty window"
        );
        assertEq(
            mockQuestionRewardPoolEscrow.lastFeedbackWindowSeconds(),
            rewardTerms.feedbackWindowSeconds,
            "feedback window"
        );
    }

    function test_SubmitQuestionWithReward_UsesAgentWalletAsEscrowFunder() public {
        address agentWallet = address(0xA11CE);
        string memory contextUrl = "https://example.com/agent-funded-bounty";
        string memory title = "Which vendor should the agent research next?";
        string memory description = "Confirm that the wallet signing the ask funds the reward pool.";
        string memory tags = "Agents,Bounty";
        uint256 categoryId = 1;
        bytes32 salt = keccak256("agent-wallet-submission-bounty");
        string[] memory imageUrls = _emptyImageUrls();
        uint256 rewardAmount = _defaultSubmissionRewardAmount(registry);
        uint256 rewardPoolExpiresAt = block.timestamp + 14 days;
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = _submissionRewardTerms(
            DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            rewardAmount,
            DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS,
            DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
            rewardPoolExpiresAt
        );

        _setAcceptedDelegate(raterRegistry, submitter, agentWallet);

        vm.startPrank(agentWallet);
        lrepToken.approve(address(mockQuestionRewardPoolEscrow), rewardAmount);
        _reserveQuestionSubmissionWithRewardTerms(
            contextUrl,
            imageUrls,
            "",
            title,
            description,
            tags,
            categoryId,
            salt,
            agentWallet,
            DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            rewardAmount,
            DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS,
            DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
            rewardPoolExpiresAt
        );
        vm.warp(block.timestamp + 1);
        uint256 id = registry.submitQuestionWithRewardAndRoundConfig(
            contextUrl,
            imageUrls,
            "",
            title,
            tags,
            categoryId,
            _emptySubmissionDetails(),
            salt,
            rewardTerms,
            _defaultContentRoundConfig(),
            _defaultQuestionSpec()
        );
        vm.stopPrank();

        (,, address storedSubmitter,,,,,,,) = registry.contents(id);
        assertEq(storedSubmitter, agentWallet);
        assertEq(registry.getSubmitterIdentity(id), submitter);
        assertEq(mockQuestionRewardPoolEscrow.lastContentId(), id);
        assertEq(mockQuestionRewardPoolEscrow.lastFunder(), agentWallet);
        assertEq(mockQuestionRewardPoolEscrow.lastAmount(), rewardAmount);
    }

    function test_SubmitQuestionWithRewardAndRoundConfig_StoresConfigAndSnapshotsRound() public {
        string memory contextUrl = "https://example.com/custom-round";
        string memory title = "How quickly should this bounty settle?";
        string memory description = "Check that custom timing sticks to the question.";
        string memory tags = "Products,Bounty";
        uint256 categoryId = 1;
        bytes32 salt = keccak256("custom-round-config");
        string[] memory imageUrls = _emptyImageUrls();
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = ContentRegistry.SubmissionRewardTerms({
            asset: DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            amount: _defaultSubmissionRewardAmount(registry),
            requiredVoters: 5,
            requiredSettledRounds: 2,
            bountyStartBy: block.timestamp + 14 days,
            bountyWindowSeconds: 14 days,
            feedbackWindowSeconds: 14 days,
            bountyEligibility: 0
        });
        RoundLib.RoundConfig memory roundConfig =
            RoundLib.RoundConfig({ epochDuration: 1 hours, maxDuration: 2 hours, minVoters: 4, maxVoters: 5 });

        vm.startPrank(submitter);
        lrepToken.approve(address(mockQuestionRewardPoolEscrow), rewardTerms.amount);
        _reserveQuestionSubmissionWithRewardTermsAndRoundConfig(
            contextUrl, imageUrls, "", title, description, tags, categoryId, salt, submitter, rewardTerms, roundConfig
        );
        vm.warp(block.timestamp + 1);
        uint256 id = registry.submitQuestionWithRewardAndRoundConfig(
            contextUrl,
            imageUrls,
            "",
            title,
            tags,
            categoryId,
            _emptySubmissionDetails(),
            salt,
            rewardTerms,
            roundConfig,
            _defaultQuestionSpec()
        );
        vm.stopPrank();

        RoundLib.RoundConfig memory storedConfig = registry.getContentRoundConfig(id);
        assertEq(storedConfig.epochDuration, roundConfig.epochDuration);
        assertEq(storedConfig.maxDuration, roundConfig.maxDuration);
        assertEq(storedConfig.minVoters, roundConfig.minVoters);
        assertEq(storedConfig.maxVoters, roundConfig.maxVoters);
        assertEq(mockQuestionRewardPoolEscrow.lastRequiredVoters(), rewardTerms.requiredVoters);

        _commit(voter1, id, true);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, id);
        RoundLib.RoundConfig memory snapshottedConfig = RoundEngineReadHelpers.roundConfig(votingEngine, id, roundId);
        assertEq(snapshottedConfig.epochDuration, roundConfig.epochDuration);
        assertEq(snapshottedConfig.maxDuration, roundConfig.maxDuration);
        assertEq(snapshottedConfig.minVoters, roundConfig.minVoters);
        assertEq(snapshottedConfig.maxVoters, roundConfig.maxVoters);
    }

    function test_SubmitQuestionWithRewardAndRoundConfig_RejectsRequiredVotersAboveMaxVoters() public {
        string memory contextUrl = "https://example.com/impossible-round";
        string memory title = "Can this bounty ever qualify?";
        string memory description = "The requested reward voter count exceeds the round cap.";
        string memory tags = "Products,Bounty";
        uint256 categoryId = 1;
        bytes32 salt = keccak256("impossible-round-config");
        string[] memory imageUrls = _emptyImageUrls();
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = ContentRegistry.SubmissionRewardTerms({
            asset: DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            amount: 100e6,
            requiredVoters: 5,
            requiredSettledRounds: 1,
            bountyStartBy: block.timestamp + 14 days,
            bountyWindowSeconds: 14 days,
            feedbackWindowSeconds: 14 days,
            bountyEligibility: 0
        });
        RoundLib.RoundConfig memory roundConfig =
            RoundLib.RoundConfig({ epochDuration: 1 hours, maxDuration: 2 hours, minVoters: 3, maxVoters: 4 });

        vm.startPrank(submitter);
        lrepToken.approve(address(mockQuestionRewardPoolEscrow), rewardTerms.amount);
        _reserveQuestionSubmissionWithRewardTermsAndRoundConfig(
            contextUrl, imageUrls, "", title, description, tags, categoryId, salt, submitter, rewardTerms, roundConfig
        );
        vm.warp(block.timestamp + 1);
        vm.expectRevert("Voters exceed max");
        registry.submitQuestionWithRewardAndRoundConfig(
            contextUrl,
            imageUrls,
            "",
            title,
            tags,
            categoryId,
            _emptySubmissionDetails(),
            salt,
            rewardTerms,
            roundConfig,
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitQuestionWithRoundConfig_BindsReservationToSelectedConfig() public {
        string memory contextUrl = "https://example.com/round-config-commitment";
        string memory title = "Should this resolve with a tight cap?";
        string memory description = "The reservation must bind the selected round settings.";
        string memory tags = "Products,Bounty";
        uint256 categoryId = 1;
        bytes32 salt = keccak256("round-config-commitment");
        string[] memory imageUrls = _emptyImageUrls();
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = ContentRegistry.SubmissionRewardTerms({
            asset: DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            amount: _defaultSubmissionRewardAmount(registry),
            requiredVoters: DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS,
            requiredSettledRounds: DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
            bountyStartBy: DEFAULT_SUBMISSION_REWARD_EXPIRES_AT,
            bountyWindowSeconds: DEFAULT_SUBMISSION_REWARD_EXPIRES_AT,
            feedbackWindowSeconds: DEFAULT_SUBMISSION_REWARD_EXPIRES_AT,
            bountyEligibility: 0
        });
        RoundLib.RoundConfig memory reservedConfig =
            RoundLib.RoundConfig({ epochDuration: 1 hours, maxDuration: 2 hours, minVoters: 3, maxVoters: 4 });
        RoundLib.RoundConfig memory alteredConfig =
            RoundLib.RoundConfig({ epochDuration: 1 hours, maxDuration: 3 hours, minVoters: 3, maxVoters: 4 });

        vm.startPrank(submitter);
        lrepToken.approve(address(mockQuestionRewardPoolEscrow), rewardTerms.amount);
        _reserveQuestionSubmissionWithRewardTermsAndRoundConfig(
            contextUrl,
            imageUrls,
            "",
            title,
            description,
            tags,
            categoryId,
            salt,
            submitter,
            rewardTerms,
            reservedConfig
        );
        vm.warp(block.timestamp + 1);
        vm.expectRevert("Reservation not found");
        registry.submitQuestionWithRewardAndRoundConfig(
            contextUrl,
            imageUrls,
            "",
            title,
            tags,
            categoryId,
            _emptySubmissionDetails(),
            salt,
            rewardTerms,
            alteredConfig,
            _defaultQuestionSpec()
        );

        uint256 id = registry.submitQuestionWithRewardAndRoundConfig(
            contextUrl,
            imageUrls,
            "",
            title,
            tags,
            categoryId,
            _emptySubmissionDetails(),
            salt,
            rewardTerms,
            reservedConfig,
            _defaultQuestionSpec()
        );
        vm.stopPrank();

        RoundLib.RoundConfig memory storedConfig = registry.getContentRoundConfig(id);
        assertEq(storedConfig.maxDuration, reservedConfig.maxDuration);
    }

    function test_SubmitQuestionWithReward_RejectsTooFewSubmissionBountyVoters() public {
        string[] memory imageUrls = _emptyImageUrls();
        uint256 rewardAmount = _defaultSubmissionRewardAmount(registry);

        vm.startPrank(submitter);
        vm.expectRevert("Too few voters");
        registry.submitQuestionWithRewardAndRoundConfig(
            "https://example.com/too-few-voters",
            imageUrls,
            "",
            "Question?",
            "Products",
            1,
            _emptySubmissionDetails(),
            keccak256("too-few-voters"),
            _submissionRewardTerms(
                DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
                rewardAmount,
                2,
                DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
                DEFAULT_SUBMISSION_REWARD_EXPIRES_AT
            ),
            _defaultContentRoundConfig(),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitQuestionWithReward_RejectsTooFewSubmissionBountyRounds() public {
        string[] memory imageUrls = _emptyImageUrls();
        uint256 rewardAmount = _defaultSubmissionRewardAmount(registry);

        vm.startPrank(submitter);
        vm.expectRevert("Too few rounds");
        registry.submitQuestionWithRewardAndRoundConfig(
            "https://example.com/too-few-rounds",
            imageUrls,
            "",
            "Question?",
            "Products",
            1,
            _emptySubmissionDetails(),
            keccak256("too-few-rounds"),
            _submissionRewardTerms(
                DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
                rewardAmount,
                DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS,
                0,
                DEFAULT_SUBMISSION_REWARD_EXPIRES_AT
            ),
            _defaultContentRoundConfig(),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitQuestionWithReward_RejectsRewardBelowFlexibleTerms() public {
        string[] memory imageUrls = _emptyImageUrls();
        uint256 rewardAmount = _defaultSubmissionRewardAmount(registry);

        vm.startPrank(submitter);
        vm.expectRevert("Reward too small");
        registry.submitQuestionWithRewardAndRoundConfig(
            "https://example.com/reward-too-small",
            imageUrls,
            "",
            "Question?",
            "Products",
            1,
            _emptySubmissionDetails(),
            keccak256("reward-too-small"),
            _submissionRewardTerms(
                DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
                rewardAmount,
                rewardAmount + 1,
                DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
                DEFAULT_SUBMISSION_REWARD_EXPIRES_AT
            ),
            _defaultContentRoundConfig(),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitQuestionWithReward_RejectsExpiredSubmissionBounty() public {
        string[] memory imageUrls = _emptyImageUrls();
        uint256 rewardAmount = _defaultSubmissionRewardAmount(registry);

        vm.startPrank(submitter);
        vm.expectRevert("Bad start-by");
        registry.submitQuestionWithRewardAndRoundConfig(
            "https://example.com/expired-bounty",
            imageUrls,
            "",
            "Question?",
            "Products",
            1,
            _emptySubmissionDetails(),
            keccak256("expired-bounty"),
            _submissionRewardTerms(
                DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
                rewardAmount,
                DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS,
                DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
                block.timestamp
            ),
            _defaultContentRoundConfig(),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitQuestionBundleWithReward_RejectsSingleQuestionBundle() public {
        ContentRegistry.BundleQuestionInput[] memory questions = new ContentRegistry.BundleQuestionInput[](1);
        questions[0] = ContentRegistry.BundleQuestionInput({
            contextUrl: "https://example.com/single-bundle",
            imageUrls: _emptyImageUrls(),
            videoUrl: "",
            title: "Question?",
            tags: "Products",
            categoryId: 1,
            details: _emptySubmissionDetails(),
            salt: keccak256("single-bundle"),
            spec: _defaultQuestionSpec()
        });
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = _submissionRewardTerms(
            DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            _defaultSubmissionRewardAmount(registry),
            DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS,
            DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
            DEFAULT_SUBMISSION_REWARD_EXPIRES_AT
        );

        vm.startPrank(submitter);
        vm.expectRevert("Bundle needs multiple questions");
        registry.submitQuestionBundleWithRewardAndRoundConfig(questions, rewardTerms, _defaultContentRoundConfig());
        vm.stopPrank();
    }

    function test_SubmitQuestionBundleWithReward_EmitsContentLinkEvents() public {
        vm.recordLogs();
        uint256[] memory contentIds = _submitReservedQuestionBundleForDormancyTest();
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 matchedLinks;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] != QUESTION_BUNDLE_CONTENT_LINKED_TOPIC) continue;

            assertLt(matchedLinks, contentIds.length);
            assertEq(uint256(logs[i].topics[1]), 1);
            assertEq(uint256(logs[i].topics[2]), contentIds[matchedLinks]);
            assertEq(uint256(logs[i].topics[3]), matchedLinks);
            matchedLinks++;
        }

        assertEq(matchedLinks, contentIds.length);
    }

    function test_SubmitQuestionBundleWithReward_RejectsHighRoundVoterCap() public {
        ContentRegistry.BundleQuestionInput[] memory questions = new ContentRegistry.BundleQuestionInput[](2);
        questions[0] = ContentRegistry.BundleQuestionInput({
            contextUrl: "https://example.com/bundle-cap-a",
            imageUrls: _emptyImageUrls(),
            videoUrl: "",
            title: "Question A?",
            tags: "Products",
            categoryId: 1,
            details: _emptySubmissionDetails(),
            salt: keccak256("bundle-cap-a"),
            spec: _defaultQuestionSpec()
        });
        questions[1] = ContentRegistry.BundleQuestionInput({
            contextUrl: "https://example.com/bundle-cap-b",
            imageUrls: _emptyImageUrls(),
            videoUrl: "",
            title: "Question B?",
            tags: "Products",
            categoryId: 1,
            details: _emptySubmissionDetails(),
            salt: keccak256("bundle-cap-b"),
            spec: _defaultQuestionSpec()
        });
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = _submissionRewardTerms(
            DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            _defaultSubmissionRewardAmount(registry),
            DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS,
            DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
            block.timestamp + 30 days
        );
        RoundLib.RoundConfig memory roundConfig =
            RoundLib.RoundConfig({ epochDuration: 1 hours, maxDuration: 7 days, minVoters: 3, maxVoters: 101 });

        vm.startPrank(submitter);
        vm.expectRevert();
        registry.submitQuestionBundleWithRewardAndRoundConfig(questions, rewardTerms, roundConfig);
        vm.stopPrank();
    }

    function test_SubmitQuestionBundleWithReward_RejectsCompletersAboveRoundVoterCap() public {
        ContentRegistry.BundleQuestionInput[] memory questions = new ContentRegistry.BundleQuestionInput[](2);
        questions[0] = ContentRegistry.BundleQuestionInput({
            contextUrl: "https://example.com/bundle-completers-a",
            imageUrls: _emptyImageUrls(),
            videoUrl: "",
            title: "Question A?",
            tags: "Products",
            categoryId: 1,
            details: _emptySubmissionDetails(),
            salt: keccak256("bundle-completers-a"),
            spec: _defaultQuestionSpec()
        });
        questions[1] = ContentRegistry.BundleQuestionInput({
            contextUrl: "https://example.com/bundle-completers-b",
            imageUrls: _emptyImageUrls(),
            videoUrl: "",
            title: "Question B?",
            tags: "Products",
            categoryId: 1,
            details: _emptySubmissionDetails(),
            salt: keccak256("bundle-completers-b"),
            spec: _defaultQuestionSpec()
        });
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = _submissionRewardTerms(
            DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            _defaultSubmissionRewardAmount(registry),
            DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS + 2,
            DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
            block.timestamp + 30 days
        );
        RoundLib.RoundConfig memory roundConfig =
            RoundLib.RoundConfig({ epochDuration: 1 hours, maxDuration: 7 days, minVoters: 3, maxVoters: 4 });

        vm.startPrank(submitter);
        vm.expectRevert();
        registry.submitQuestionBundleWithRewardAndRoundConfig(questions, rewardTerms, roundConfig);
        vm.stopPrank();
    }

    function test_SubmitQuestionBundleWithReward_AllowsMultipleSettledRounds() public {
        ContentRegistry.BundleQuestionInput[] memory questions = new ContentRegistry.BundleQuestionInput[](2);
        questions[0] = ContentRegistry.BundleQuestionInput({
            contextUrl: "https://example.com/bundle-rounds-a",
            imageUrls: _emptyImageUrls(),
            videoUrl: "",
            title: "Question A?",
            tags: "Products",
            categoryId: 1,
            details: _emptySubmissionDetails(),
            salt: keccak256("bundle-rounds-a"),
            spec: _defaultQuestionSpec()
        });
        questions[1] = ContentRegistry.BundleQuestionInput({
            contextUrl: "https://example.com/bundle-rounds-b",
            imageUrls: _emptyImageUrls(),
            videoUrl: "",
            title: "Question B?",
            tags: "Products",
            categoryId: 1,
            details: _emptySubmissionDetails(),
            salt: keccak256("bundle-rounds-b"),
            spec: _defaultQuestionSpec()
        });
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = _submissionRewardTerms(
            DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            _defaultSubmissionRewardAmount(registry) * 2,
            DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS,
            DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS + 1,
            block.timestamp + 30 days
        );

        vm.startPrank(submitter);
        vm.expectRevert("Reservation not found");
        registry.submitQuestionBundleWithRewardAndRoundConfig(questions, rewardTerms, _bundleContentRoundConfig());
        vm.stopPrank();
    }

    function test_SubmitQuestionBundleWithReward_AllowsSameTextWithDifferentMedia() public {
        ContentRegistry.BundleQuestionInput[] memory questions = new ContentRegistry.BundleQuestionInput[](2);
        questions[0] = ContentRegistry.BundleQuestionInput({
            contextUrl: "https://example.com/bundle-media-variant",
            imageUrls: _singleImageUrls(_uploadedImageUrl("bundle-media-variant-a")),
            videoUrl: "",
            title: "Question?",
            tags: "Products",
            categoryId: 1,
            details: _emptySubmissionDetails(),
            salt: keccak256("bundle-media-variant-a"),
            spec: _defaultQuestionSpec()
        });
        questions[1] = ContentRegistry.BundleQuestionInput({
            contextUrl: "https://example.com/bundle-media-variant",
            imageUrls: _singleImageUrls(_uploadedImageUrl("bundle-media-variant-b")),
            videoUrl: "",
            title: "Question?",
            tags: "Products",
            categoryId: 1,
            details: _emptySubmissionDetails(),
            salt: keccak256("bundle-media-variant-b"),
            spec: _defaultQuestionSpec()
        });
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = _submissionRewardTerms(
            DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            _defaultSubmissionRewardAmount(registry) * 2,
            DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS,
            DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
            block.timestamp + 30 days
        );
        RoundLib.RoundConfig memory roundConfig = _bundleContentRoundConfig();
        bytes32 firstSubmissionKey = _questionSubmissionKey(
            questions[0].contextUrl,
            questions[0].imageUrls,
            questions[0].videoUrl,
            questions[0].title,
            questions[0].tags,
            questions[0].categoryId,
            _emptySubmissionDetails()
        );
        bytes32 secondSubmissionKey = _questionSubmissionKey(
            questions[1].contextUrl,
            questions[1].imageUrls,
            questions[1].videoUrl,
            questions[1].title,
            questions[1].tags,
            questions[1].categoryId,
            _emptySubmissionDetails()
        );

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), rewardTerms.amount);
        registry.reserveSubmission(_bundleRevealCommitment(questions, rewardTerms, roundConfig, submitter));
        vm.warp(block.timestamp + 1);
        (, uint256[] memory contentIds) =
            registry.submitQuestionBundleWithRewardAndRoundConfig(questions, rewardTerms, roundConfig);
        vm.stopPrank();

        assertEq(contentIds.length, 2);
        assertTrue(firstSubmissionKey != secondSubmissionKey, "different media variants get different submission keys");
    }

    function test_SubmitQuestionBundleWithReward_RejectsExactMediaDuplicate() public {
        string[] memory imageUrls = _singleImageUrls(_uploadedImageUrl("bundle-media-duplicate"));
        ContentRegistry.BundleQuestionInput[] memory questions = new ContentRegistry.BundleQuestionInput[](2);
        questions[0] = ContentRegistry.BundleQuestionInput({
            contextUrl: "https://example.com/bundle-media-duplicate",
            imageUrls: imageUrls,
            videoUrl: "",
            title: "Question?",
            tags: "Products",
            categoryId: 1,
            details: _emptySubmissionDetails(),
            salt: keccak256("bundle-media-duplicate-a"),
            spec: _defaultQuestionSpec()
        });
        questions[1] = ContentRegistry.BundleQuestionInput({
            contextUrl: "https://example.com/bundle-media-duplicate",
            imageUrls: imageUrls,
            videoUrl: "",
            title: "Question?",
            tags: "Products",
            categoryId: 1,
            details: _emptySubmissionDetails(),
            salt: keccak256("bundle-media-duplicate-b"),
            spec: _defaultQuestionSpec()
        });
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = _submissionRewardTerms(
            DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            _defaultSubmissionRewardAmount(registry) * 2,
            DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS,
            DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
            block.timestamp + 30 days
        );
        RoundLib.RoundConfig memory roundConfig = _bundleContentRoundConfig();

        vm.startPrank(submitter);
        registry.reserveSubmission(_bundleRevealCommitment(questions, rewardTerms, roundConfig, submitter));
        vm.warp(block.timestamp + 1);
        vm.expectRevert("Question already submitted");
        registry.submitQuestionBundleWithRewardAndRoundConfig(questions, rewardTerms, roundConfig);
        vm.stopPrank();
    }

    function test_SubmitQuestionBundleWithReward_RequiresBountyClose() public {
        ContentRegistry.BundleQuestionInput[] memory questions = new ContentRegistry.BundleQuestionInput[](2);
        questions[0] = ContentRegistry.BundleQuestionInput({
            contextUrl: "https://example.com/bundle-expiry-a",
            imageUrls: _emptyImageUrls(),
            videoUrl: "",
            title: "Question A?",
            tags: "Products",
            categoryId: 1,
            details: _emptySubmissionDetails(),
            salt: keccak256("bundle-expiry-a"),
            spec: _defaultQuestionSpec()
        });
        questions[1] = ContentRegistry.BundleQuestionInput({
            contextUrl: "https://example.com/bundle-expiry-b",
            imageUrls: _emptyImageUrls(),
            videoUrl: "",
            title: "Question B?",
            tags: "Products",
            categoryId: 1,
            details: _emptySubmissionDetails(),
            salt: keccak256("bundle-expiry-b"),
            spec: _defaultQuestionSpec()
        });
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = _submissionRewardTerms(
            DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            _defaultSubmissionRewardAmount(registry) * 2,
            DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS,
            DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
            0
        );

        vm.startPrank(submitter);
        vm.expectRevert("Bundle bounty window required");
        registry.submitQuestionBundleWithRewardAndRoundConfig(questions, rewardTerms, _bundleContentRoundConfig());
        vm.stopPrank();
    }

    function test_SubmitQuestionWithReward_RequiresReservationForMatchingBountyTerms() public {
        string memory contextUrl = "https://example.com/bounty-terms-mismatch";
        string memory title = "Question?";
        string memory description = "Context voters should consider";
        string memory tags = "Products";
        uint256 categoryId = 1;
        bytes32 salt = keccak256("bounty-terms-mismatch");
        string[] memory imageUrls = _emptyImageUrls();
        uint256 rewardAmount = _defaultSubmissionRewardAmount(registry);

        vm.startPrank(submitter);
        _reserveQuestionSubmissionWithRewardTerms(
            contextUrl,
            imageUrls,
            "",
            title,
            description,
            tags,
            categoryId,
            salt,
            submitter,
            DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            rewardAmount,
            DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS,
            DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
            DEFAULT_SUBMISSION_REWARD_EXPIRES_AT
        );
        vm.warp(block.timestamp + 1);
        vm.expectRevert("Reservation not found");
        registry.submitQuestionWithRewardAndRoundConfig(
            contextUrl,
            imageUrls,
            "",
            title,
            tags,
            categoryId,
            _emptySubmissionDetails(),
            salt,
            _submissionRewardTerms(
                DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
                rewardAmount,
                DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS + 1,
                DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
                DEFAULT_SUBMISSION_REWARD_EXPIRES_AT
            ),
            _defaultContentRoundConfig(),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitQuestion_RejectsMixedImagesAndVideo() public {
        string[] memory imageUrls = new string[](1);
        imageUrls[0] = _uploadedImageUrl("mixed-video-image");

        vm.expectRevert("Choose images or video");
        registry.submitQuestion(
            "https://example.com/context",
            imageUrls,
            "https://www.youtube.com/watch?v=jNQXAC9IVRw",
            "Question?",
            "Media",
            5,
            _emptySubmissionDetails(),
            keccak256("mixed-images-video"),
            _defaultQuestionSpec()
        );
    }

    function test_SubmitQuestion_RejectsTooManyImages() public {
        string[] memory imageUrls = new string[](5);
        for (uint256 i = 0; i < imageUrls.length; i++) {
            imageUrls[i] = _uploadedImageUrl(string.concat("too-many-", vm.toString(i)));
        }

        vm.expectRevert("Too many images");
        registry.submitQuestion(
            "https://example.com/context",
            imageUrls,
            "",
            "Question?",
            "Media",
            5,
            _emptySubmissionDetails(),
            keccak256("too-many-images"),
            _defaultQuestionSpec()
        );
    }

    function test_SubmitContent_IdentityRegistryConfigured_AllowsUnverifiedSubmitter() public {
        address noIdSubmitter = address(0xDEAD);
        vm.prank(owner);
        lrepToken.mint(noIdSubmitter, 10_000e6);

        vm.startPrank(noIdSubmitter);
        lrepToken.approve(address(registry), 10e6);
        NoMediaQuestionText memory question =
            NoMediaQuestionText({ url: "https://example.com/no-id", title: "goal", tags: "tags" });
        bytes32 salt = _contentSubmissionSalt(question.url, noIdSubmitter);
        _reserveNoMediaQuestionSubmission(registry, question, 1, salt, noIdSubmitter);
        vm.warp(block.timestamp + 1);
        uint256 id = _submitNoMediaQuestion(registry, question, 1, salt);
        vm.stopPrank();

        assertEq(registry.getSubmitterIdentity(id), noIdSubmitter);
        assertEq(registry.contentSubmitterIdentityKey(id), raterRegistry.addressIdentityKey(noIdSubmitter));
    }

    function test_SubmitContent_IdentityRegistryConfigured_SucceedsWithSeededIdentity() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        uint256 id = _submitContentWithReservation(registry, "https://example.com/1", "goal", "goal", "tags", 0);
        vm.stopPrank();
        assertEq(id, 1);
    }

    function test_SubmitContent_SnapshotsCanonicalSubmitterIdentityForDelegate() public {
        _setAcceptedDelegate(raterRegistry, submitter, delegate);

        vm.startPrank(delegate);
        lrepToken.approve(address(registry), 10e6);
        uint256 id =
            _submitContentWithReservation(registry, "https://example.com/delegate-submit", "goal", "goal", "tags", 0);
        vm.stopPrank();

        (,, address rawSubmitter,,,,,,,) = registry.contents(id);
        assertEq(rawSubmitter, delegate, "raw submitter should remain delegate wallet");
        assertEq(registry.getSubmitterIdentity(id), submitter, "submitter identity should snapshot the holder");
    }

    function test_SubmitContent_RawDelegateSubmitterCannotVoteAfterReassignment() public {
        _setAcceptedDelegate(raterRegistry, submitter, delegate);

        vm.startPrank(delegate);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(
            registry, "https://example.com/delegate-reassigned-vote", "goal", "goal", "tags", 0
        );
        vm.stopPrank();

        vm.prank(submitter);
        raterRegistry.removeDelegate();
        _setAcceptedDelegate(raterRegistry, voter4, delegate);

        vm.expectRevert(RoundVotingEngine.SelfVote.selector);
        vm.prank(delegate);
        votingEngine.openRound(1);
    }

    function test_SubmitContent_RaterRegistryNotConfigured_Succeeds() public {
        vm.startPrank(owner);
        ContentRegistry registryImpl2 = new ContentRegistry();
        ContentRegistry reg2 = ContentRegistry(
            address(
                new ERC1967Proxy(
                    address(registryImpl2),
                    abi.encodeCall(ContentRegistry.initializeWithTreasury, (owner, owner, owner, address(lrepToken)))
                )
            )
        );
        MockCategoryRegistry mockCategoryRegistry2 = new MockCategoryRegistry();
        mockCategoryRegistry2.seedDefaultTestCategories();
        reg2.setCategoryRegistry(address(mockCategoryRegistry2));
        reg2.setQuestionRewardPoolEscrow(address(mockQuestionRewardPoolEscrow));
        vm.stopPrank();

        vm.startPrank(submitter);
        lrepToken.approve(address(reg2), 10e6);
        NoMediaQuestionText memory question =
            NoMediaQuestionText({ url: "https://example.com/no-config", title: "goal", tags: "tags" });
        bytes32 salt = _contentSubmissionSalt(question.url, submitter);
        bytes32 submissionKey = _questionSubmissionKey(
            question.url, _emptyImageUrls(), "", question.title, question.tags, 1, _emptySubmissionDetails()
        );
        bytes32 revealCommitment = _defaultQuestionRevealCommitment(
            reg2, submissionKey, _emptyImageUrls(), "", question.title, question.tags, 1, salt, submitter
        );
        lrepToken.approve(address(mockQuestionRewardPoolEscrow), DEFAULT_SUBMISSION_REWARD_POOL);
        reg2.reserveSubmission(revealCommitment);
        vm.warp(block.timestamp + 1);
        uint256 id = _submitNoMediaQuestion(reg2, question, 1, salt);
        vm.stopPrank();

        assertEq(reg2.getSubmitterIdentity(id), submitter);
        assertEq(
            reg2.contentSubmitterIdentityKey(id), keccak256(abi.encodePacked("rateloop.address-identity-v1", submitter))
        );
    }

    function test_SubmitContent_NonHttpsUrl_Reverts() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        vm.expectRevert("Invalid URL");
        registry.submitQuestion(
            "https://example.com/context",
            _singleImageUrls("javascript:alert(1)"),
            "",
            "goal",
            "tags",
            1,
            _emptySubmissionDetails(),
            bytes32(0),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitContent_HttpUrl_Reverts() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        vm.expectRevert("Invalid URL");
        registry.submitQuestion(
            "https://example.com/context",
            _singleImageUrls("http://example.com/1.jpg"),
            "",
            "goal",
            "tags",
            1,
            _emptySubmissionDetails(),
            bytes32(0),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitContent_UrlWithWhitespace_Reverts() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        vm.expectRevert("Invalid URL");
        registry.submitQuestion(
            "https://example.com/context",
            _singleImageUrls("https://example.com/ bad.jpg"),
            "",
            "goal",
            "tags",
            1,
            _emptySubmissionDetails(),
            bytes32(0),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitContent_UrlWithUserinfo_Reverts() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        vm.expectRevert("Invalid URL");
        registry.submitQuestion(
            "https://safe.com@evil.com/context",
            _singleImageUrls(_uploadedImageUrl("valid-image-userinfo")),
            "",
            "goal",
            "tags",
            1,
            _emptySubmissionDetails(),
            bytes32(0),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitContent_UrlWithBackslash_Reverts() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        vm.expectRevert("Invalid URL");
        registry.submitQuestion(
            "https://example.com/context",
            _singleImageUrls("https://safe.com\\@evil.com/1.jpg"),
            "",
            "goal",
            "tags",
            1,
            _emptySubmissionDetails(),
            bytes32(0),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitContent_UrlWithPercentEncodedHost_Reverts() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        vm.expectRevert("Invalid URL");
        registry.submitQuestion(
            "https://goo%67le.com/context",
            _singleImageUrls(_uploadedImageUrl("valid-image-percent-host")),
            "",
            "goal",
            "tags",
            1,
            _emptySubmissionDetails(),
            bytes32(0),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitContent_UrlWithUnsafePrintableCharacter_Reverts() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        vm.expectRevert("Invalid URL");
        registry.submitQuestion(
            "https://example.com/<script>",
            _singleImageUrls(_uploadedImageUrl("valid-image-unsafe-context")),
            "",
            "goal",
            "tags",
            1,
            _emptySubmissionDetails(),
            bytes32(0),
            _defaultQuestionSpec()
        );

        vm.expectRevert("Invalid URL");
        registry.submitQuestion(
            "https://example.com/context",
            _singleImageUrls("https://example.com/\"quote\".jpg"),
            "",
            "goal",
            "tags",
            1,
            _emptySubmissionDetails(),
            bytes32(0),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitContent_UrlWithInvalidPercentEncoding_Reverts() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        vm.expectRevert("Invalid URL");
        registry.submitQuestion(
            "https://example.com/context",
            _singleImageUrls("https://example.com/bad%zz.jpg"),
            "",
            "goal",
            "tags",
            1,
            _emptySubmissionDetails(),
            bytes32(0),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitContent_UrlWithEmptyHost_Reverts() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        vm.expectRevert("Invalid URL");
        registry.submitQuestion(
            "https:///context",
            _singleImageUrls(_uploadedImageUrl("valid-image-empty-host")),
            "",
            "goal",
            "tags",
            1,
            _emptySubmissionDetails(),
            bytes32(0),
            _defaultQuestionSpec()
        );
        vm.expectRevert("Invalid URL");
        registry.submitQuestion(
            "https://example.com/context",
            _singleImageUrls("https:///1.jpg"),
            "",
            "goal",
            "tags",
            1,
            _emptySubmissionDetails(),
            bytes32(0),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitContent_UploadedImageWithoutDigest_Reverts() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        vm.expectRevert("Invalid media URL");
        registry.submitQuestion(
            "https://example.com/context",
            _singleImageUrls("https://www.rateloop.ai/api/attachments/images/att_0123456789abcdef.webp"),
            "",
            "goal",
            "tags",
            1,
            _emptySubmissionDetails(),
            bytes32(0),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitContent_UploadedImageWithQuery_Reverts() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        vm.expectRevert("Invalid media URL");
        registry.submitQuestion(
            "https://example.com/context",
            _singleImageUrls(string.concat(_uploadedImageUrl("valid-image-with-query"), "?download=1")),
            "",
            "goal",
            "tags",
            1,
            _emptySubmissionDetails(),
            bytes32(0),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitContent_CategoryNotRegistered_Reverts() public {
        vm.prank(owner);
        registry.setCategoryRegistry(address(mockCategoryRegistry));
        mockCategoryRegistry.setSlug(99, "example.com");

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        vm.expectRevert("Category not registered");
        registry.submitQuestion(
            "https://example.com/context",
            _singleImageUrls(_uploadedImageUrl("valid-image-unregistered-category")),
            "",
            "goal",
            "tags",
            99,
            _emptySubmissionDetails(),
            bytes32(0),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitContent_RevertsWhenNextContentIdExceedsUint64() public {
        stdstore.target(address(registry)).sig("nextContentId()").checked_write(uint256(type(uint64).max) + 1);

        string memory url = "https://example.com/overflow-content-id";
        string memory title = "goal";
        string memory description = "goal";
        string memory tags = "tags";
        bytes32 salt = keccak256("overflow-content-id");

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        string memory imageUrl = _submissionImageUrl(url);
        string[] memory imageUrls = _singleImageUrls(imageUrl);
        _reserveQuestionSubmissionWithRewardTerms(
            "https://example.com/context",
            imageUrls,
            "",
            title,
            description,
            tags,
            1,
            salt,
            submitter,
            DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            _defaultSubmissionRewardAmount(registry),
            DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS,
            DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
            DEFAULT_SUBMISSION_REWARD_EXPIRES_AT
        );
        vm.warp(block.timestamp + 1);
        vm.expectRevert();
        registry.submitQuestion(
            "https://example.com/context",
            imageUrls,
            "",
            title,
            tags,
            1,
            _emptySubmissionDetails(),
            salt,
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitContent_RevertsWhenResolvedCategoryIdExceedsUint64() public {
        uint256 oversizedCategoryId = uint256(type(uint64).max) + 1;
        mockCategoryRegistry.setSlug(oversizedCategoryId, "overflow-category.example");
        mockCategoryRegistry.setCategoryExists(oversizedCategoryId, true);

        string memory url = "https://overflow-category.example/item";
        string memory title = "goal";
        string memory description = "goal";
        string memory tags = "tags";
        bytes32 salt = keccak256("overflow-category-id");

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        string memory imageUrl = _submissionImageUrl(url);
        string[] memory imageUrls = _singleImageUrls(imageUrl);
        _reserveQuestionSubmissionWithRewardTerms(
            "https://example.com/context",
            imageUrls,
            "",
            title,
            description,
            tags,
            oversizedCategoryId,
            salt,
            submitter,
            DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            _defaultSubmissionRewardAmount(registry),
            DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS,
            DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
            DEFAULT_SUBMISSION_REWARD_EXPIRES_AT
        );
        vm.warp(block.timestamp + 1);
        vm.expectRevert();
        registry.submitQuestion(
            "https://example.com/context",
            imageUrls,
            "",
            title,
            tags,
            oversizedCategoryId,
            _emptySubmissionDetails(),
            salt,
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitContent_DoesNotCreateSubmitterStakeOrReward() public {
        uint256 balBefore = lrepToken.balanceOf(submitter);
        vm.startPrank(submitter);
        _submitContentWithReservation(registry, "https://example.com/no-submitter-upside", "goal", "goal", "tags", 0);
        vm.stopPrank();

        uint256 balAfter = lrepToken.balanceOf(submitter);
        assertEq(balAfter, balBefore, "mock bounty escrow does not pull funds in branch tests");
    }

    function test_SubmitContent_UrlTooLong_Reverts() public {
        string memory longUrl =
            _validLengthUrl(2049, bytes("https://www.rateloop.ai/api/attachments/images/att_"), bytes(".webp"));

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        vm.expectRevert("Invalid URL");
        registry.submitQuestion(
            "https://example.com/context",
            _singleImageUrls(longUrl),
            "",
            "goal",
            "tags",
            1,
            _emptySubmissionDetails(),
            bytes32(0),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitQuestion_AllowsMaxLengthContextUrl() public view {
        string memory maxUrl = _validLengthUrl(2048, bytes("https://"), bytes(".example.com/context"));

        _questionSubmissionKey(
            maxUrl,
            _singleImageUrls(_uploadedImageUrl("max-length-context")),
            "",
            "Question?",
            "tags",
            1,
            _emptySubmissionDetails()
        );
    }

    function test_SubmitQuestion_AllowsPercentEncodedPath() public view {
        _questionSubmissionKey(
            "https://example.com/a%20b", _emptyImageUrls(), "", "Question?", "tags", 1, _emptySubmissionDetails()
        );
    }

    function test_SubmitQuestion_VideoUrlTooLong_Reverts() public {
        string memory longVideoUrl = _validLengthUrl(2049, bytes("https://youtu.be/"), bytes("a"));

        vm.expectRevert("Invalid URL");
        registry.submitQuestion(
            "https://example.com/context",
            _emptyImageUrls(),
            longVideoUrl,
            "Question?",
            "tags",
            1,
            _emptySubmissionDetails(),
            keccak256("video-url-too-long"),
            _defaultQuestionSpec()
        );
    }

    function _validLengthUrl(uint256 length, bytes memory prefix, bytes memory suffix)
        internal
        pure
        returns (string memory)
    {
        require(length >= prefix.length + suffix.length, "Invalid test URL length");
        bytes memory out = new bytes(length);
        for (uint256 i = 0; i < prefix.length; i++) {
            out[i] = prefix[i];
        }
        uint256 suffixOffset = length - suffix.length;
        for (uint256 i = prefix.length; i < suffixOffset; i++) {
            out[i] = "a";
        }
        for (uint256 i = 0; i < suffix.length; i++) {
            out[suffixOffset + i] = suffix[i];
        }
        return string(out);
    }

    function test_SubmitContent_TitleTooLong_Reverts() public {
        uint256 maxQuestionLength = 121;
        bytes memory longGoal = new bytes(maxQuestionLength);
        for (uint256 i = 0; i < maxQuestionLength; i++) {
            longGoal[i] = "a";
        }

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        vm.expectRevert("Question too long");
        registry.submitQuestion(
            "https://example.com/context",
            _singleImageUrls(_uploadedImageUrl("valid-image-long-title")),
            "",
            string(longGoal),
            "tags",
            1,
            _emptySubmissionDetails(),
            bytes32(0),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitContent_TagsTooLong_Reverts() public {
        bytes memory longTags = new bytes(257);
        for (uint256 i = 0; i < longTags.length; i++) {
            longTags[i] = "a";
        }

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        vm.expectRevert("Tags too long");
        registry.submitQuestion(
            "https://example.com/context",
            _singleImageUrls(_uploadedImageUrl("valid-image-long-tags")),
            "",
            "goal",
            string(longTags),
            1,
            _emptySubmissionDetails(),
            bytes32(0),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitContent_DuplicateUrl_Reverts() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 20e6);
        _submitContentWithReservation(registry, "https://example.com/1", "goal", "goal", "tags", 0);
        vm.expectRevert("Question already submitted");
        registry.submitQuestion(
            "https://example.com/1",
            _emptyImageUrls(),
            "",
            "goal",
            "tags",
            1,
            _emptySubmissionDetails(),
            keccak256("dup1-salt"),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitContent_DuplicateMediaVariant_Reverts() public {
        string memory url = "https://example.com/media-duplicate";
        string memory title = "goal";
        string memory description = "goal";
        string memory tags = "tags";
        string[] memory imageUrls = _singleImageUrls(_uploadedImageUrl("media-duplicate"));

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 20e6);
        _reserveQuestionMediaSubmission(
            registry, url, imageUrls, "", title, description, tags, 1, keccak256("media-duplicate-a"), submitter
        );
        vm.warp(block.timestamp + 1);
        registry.submitQuestion(
            url,
            imageUrls,
            "",
            title,
            tags,
            1,
            _emptySubmissionDetails(),
            keccak256("media-duplicate-a"),
            _defaultQuestionSpec()
        );

        vm.expectRevert("Question already submitted");
        registry.submitQuestion(
            url,
            imageUrls,
            "",
            title,
            tags,
            1,
            _emptySubmissionDetails(),
            keccak256("media-duplicate-b"),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitContent_AllowsSameQuestionTextWithDifferentMedia() public {
        string memory url = "https://example.com/media-variant";
        string memory title = "goal";
        string memory description = "goal";
        string memory tags = "tags";
        string[] memory firstImageUrls = _singleImageUrls(_uploadedImageUrl("media-variant-a"));
        string[] memory secondImageUrls = _singleImageUrls(_uploadedImageUrl("media-variant-b"));

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 20e6);
        bytes32 firstSubmissionKey = _reserveQuestionMediaSubmission(
            registry, url, firstImageUrls, "", title, description, tags, 1, keccak256("media-variant-a"), submitter
        );
        vm.warp(block.timestamp + 1);
        uint256 firstContentId = registry.submitQuestion(
            url,
            firstImageUrls,
            "",
            title,
            tags,
            1,
            _emptySubmissionDetails(),
            keccak256("media-variant-a"),
            _defaultQuestionSpec()
        );

        bytes32 secondSubmissionKey = _reserveQuestionMediaSubmission(
            registry, url, secondImageUrls, "", title, description, tags, 1, keccak256("media-variant-b"), submitter
        );
        vm.warp(block.timestamp + 1);
        uint256 secondContentId = registry.submitQuestion(
            url,
            secondImageUrls,
            "",
            title,
            tags,
            1,
            _emptySubmissionDetails(),
            keccak256("media-variant-b"),
            _defaultQuestionSpec()
        );
        vm.stopPrank();

        assertTrue(firstSubmissionKey != secondSubmissionKey, "media variants use distinct submission keys");
        assertEq(firstContentId, 1);
        assertEq(secondContentId, 2);
    }

    function test_SubmitContent_EmptyUrl_Reverts() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        vm.expectRevert("Context or media required");
        registry.submitQuestion(
            "", _emptyImageUrls(), "", "goal", "tags", 1, _emptySubmissionDetails(), bytes32(0), _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitContent_AllowsImageWithoutContextUrl() public {
        string[] memory imageUrls = _singleImageUrls(_uploadedImageUrl("image-only-context"));
        bytes32 salt = keccak256("image-only-context");

        vm.startPrank(submitter);
        _reserveQuestionMediaSubmission(registry, "", imageUrls, "", "goal", "goal", "tags", 1, salt, submitter);
        vm.warp(block.timestamp + 1);
        uint256 contentId = registry.submitQuestion(
            "", imageUrls, "", "goal", "tags", 1, _emptySubmissionDetails(), salt, _defaultQuestionSpec()
        );
        vm.stopPrank();

        assertEq(contentId, 1);
        (uint64 id,,,,, ContentRegistry.ContentStatus status,,,,) = registry.contents(contentId);
        assertEq(id, uint64(contentId));
        assertEq(uint256(status), uint256(ContentRegistry.ContentStatus.Active));
    }

    function test_SubmitContent_EmptyTitle_Reverts() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        vm.expectRevert("Question required");
        registry.submitQuestion(
            "https://example.com/context",
            _singleImageUrls(_uploadedImageUrl("valid-image-empty-title")),
            "",
            "",
            "tags",
            1,
            _emptySubmissionDetails(),
            bytes32(0),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitContent_EmptyTags_Reverts() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        vm.expectRevert("Tags required");
        registry.submitQuestion(
            "https://example.com/context",
            _singleImageUrls(_uploadedImageUrl("valid-image-empty-tags")),
            "",
            "goal",
            "",
            1,
            _emptySubmissionDetails(),
            bytes32(0),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    // =========================================================================
    // cancelContent BRANCHES
    // =========================================================================

    function test_CancelContent_NotSubmitter_Reverts() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/1", "goal", "goal", "tags", 0);
        vm.stopPrank();

        vm.prank(voter1);
        vm.expectRevert("Not submitter");
        registry.cancelContent(1);
    }

    function test_CancelContent_UsesCurrentCanonicalSubmitterIdentity() public {
        _setAcceptedDelegate(raterRegistry, submitter, delegate);

        vm.startPrank(delegate);
        lrepToken.approve(address(registry), 10e6);
        uint256 contentId =
            _submitContentWithReservation(registry, "https://example.com/delegated-cancel", "goal", "goal", "tags", 0);
        vm.stopPrank();

        vm.prank(submitter);
        raterRegistry.removeDelegate();

        vm.prank(delegate);
        vm.expectRevert("Not submitter");
        registry.cancelContent(contentId);

        vm.prank(submitter);
        registry.cancelContent(contentId);
    }

    function test_CancelContent_AllowsStoredSubmitterAfterIdentityRebind() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        uint256 contentId =
            _submitContentWithReservation(registry, "https://example.com/reminted-cancel", "goal", "goal", "tags", 0);
        vm.stopPrank();

        address remintedSubmitter = address(0xBEEF);
        bytes32 anchor = bytes32(uint256(uint160(submitter)));
        vm.startPrank(owner);
        raterRegistry.revokeHumanCredential(submitter);
        raterRegistry.clearRevokedHumanNullifier(RaterRegistry.HumanCredentialProvider.SeededHuman, anchor);
        _seedRaterIdentity(raterRegistry, remintedSubmitter, anchor);
        vm.stopPrank();

        vm.prank(submitter);
        registry.cancelContent(contentId);

        (,,,,, ContentRegistry.ContentStatus status,,,,) = registry.contents(contentId);
        assertEq(uint256(status), uint256(ContentRegistry.ContentStatus.Cancelled));
    }

    function test_CancelContent_NotActive_Reverts() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/1", "goal", "goal", "tags", 0);
        registry.cancelContent(1);

        vm.expectRevert("Not active");
        registry.cancelContent(1);
        vm.stopPrank();
    }

    function test_CancelContent_AllowsEmptyOpenedRoundWithoutCommits() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/open-then-cancel", "goal", "goal", "tags", 0);
        vm.stopPrank();

        vm.prank(voter1);
        votingEngine.openRound(1);

        vm.prank(submitter);
        registry.cancelContent(1);

        (,,,,, ContentRegistry.ContentStatus status,,,,) = registry.contents(1);
        assertEq(uint256(status), uint256(ContentRegistry.ContentStatus.Cancelled), "empty open round can be cancelled");
        assertFalse(votingEngine.hasCommits(1), "open round records no commits");
    }

    function test_CancelContent_HasVotes_Reverts() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/1", "goal", "goal", "tags", 0);
        vm.stopPrank();

        // Add a vote
        _vote(voter1, 1, true);

        vm.prank(submitter);
        vm.expectRevert("Content has votes");
        registry.cancelContent(1);
    }

    function test_CancelContent_RemembersVotesAfterVotingEngineRotation() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/rotated-engine", "goal", "goal", "tags", 0);
        vm.stopPrank();

        _vote(voter1, 1, true);
        RoundVotingEngine replacementEngine = _deployReplacementVotingEngine();

        vm.startPrank(owner);
        registry.pause();
        registry.setVotingEngine(address(replacementEngine));
        registry.unpause();
        vm.stopPrank();

        vm.prank(submitter);
        vm.expectRevert("Content has votes");
        registry.cancelContent(1);
    }

    function test_SetVotingEngine_OldTrackedRoundCanSettleRegistryStatePostRotation() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/in-flight-engine", "goal", "goal", "tags", 0);
        vm.stopPrank();

        (bytes32 ck1, bytes32 salt1) = _commit(voter1, 1, true);
        (bytes32 ck2, bytes32 salt2) = _commit(voter2, 1, true);
        (bytes32 ck3, bytes32 salt3) = _commit(voter3, 1, false);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, 1);

        RoundVotingEngine replacementEngine = _deployReplacementVotingEngine();
        vm.startPrank(owner);
        registry.pause();
        registry.setVotingEngine(address(replacementEngine));
        registry.unpause();
        vm.stopPrank();

        uint16 ratingBefore = registry.getRating(1);
        vm.prank(address(votingEngine));
        vm.expectRevert(ContentRegistry.OnlyVotingEngine.selector);
        registry.updateActivity(1);

        _warpPastTlockRevealTime(block.timestamp + 1 hours);
        votingEngine.revealVoteByCommitKey(1, roundId, ck1, true, 5_000, salt1);
        votingEngine.revealVoteByCommitKey(1, roundId, ck2, true, 5_000, salt2);
        votingEngine.revealVoteByCommitKey(1, roundId, ck3, false, 5_000, salt3);
        _settleAfterRbtsSeed(votingEngine, 1, roundId);

        assertGt(registry.getRating(1), ratingBefore, "tracked old engine settlement updates rating");
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert("Dormancy period not elapsed");
        registry.markDormant(1);
    }

    function test_SetVotingEngine_ReplacementCannotCommitWhileTrackedOldRoundOpen() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/tracked-open-engine", "goal", "goal", "tags", 0);
        vm.stopPrank();

        _commit(voter1, 1, true);

        RoundVotingEngine replacementEngine = _deployReplacementVotingEngine();
        vm.startPrank(owner);
        _setTlockRoundConfig(ProtocolConfig(address(replacementEngine.protocolConfig())), 1 hours, 7 days, 3, 100);
        ProtocolConfig(address(replacementEngine.protocolConfig())).setRaterRegistry(address(raterRegistry));
        registry.pause();
        registry.setVotingEngine(address(replacementEngine));
        registry.unpause();
        vm.stopPrank();

        _openRoundForTest(replacementEngine, 1, voter2);
        bytes32 salt = keccak256(abi.encodePacked(voter2, block.timestamp));
        uint16 referenceRatingBps = _currentRatingReferenceBps(1);
        bytes memory ciphertext = _testCiphertext(true, salt, 1);
        bytes32 commitHash = _commitHash(
            true, salt, voter2, 1, referenceRatingBps, _tlockCommitTargetRound(), _tlockDrandChainHash(), ciphertext
        );

        vm.startPrank(voter2);
        lrepToken.approve(address(replacementEngine), STAKE);
        uint256 roundContext = _roundContext(_previewCommitRoundId(replacementEngine, 1), referenceRatingBps);
        vm.expectRevert(ContentRegistry.ActiveRoundOnPreviousEngine.selector);
        replacementEngine.commitVote(
            1,
            roundContext,
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }

    function test_SetVotingEngine_OldEngineCanSettleAfterReplacementSettlement() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/out-of-order-engine", "goal", "goal", "tags", 0);
        vm.stopPrank();

        (bytes32 ck1, bytes32 salt1) = _commit(voter1, 1, true);
        (bytes32 ck2, bytes32 salt2) = _commit(voter2, 1, true);
        (bytes32 ck3, bytes32 salt3) = _commit(voter3, 1, false);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, 1);

        RoundVotingEngine replacementEngine = _deployReplacementVotingEngine();
        vm.startPrank(owner);
        registry.pause();
        registry.setVotingEngine(address(replacementEngine));
        registry.unpause();
        vm.stopPrank();

        RatingLib.RatingState memory replacementState = registry.getRatingState(1);
        replacementState.ratingBps = 5200;
        replacementState.conservativeRatingBps = 5200;
        replacementState.settledRounds += 1;
        replacementState.lastUpdatedAt = uint48(block.timestamp);
        vm.prank(address(replacementEngine));
        registry.updateRatingState(1, 1, 5000, replacementState);

        _warpPastTlockRevealTime(block.timestamp + 1 hours);
        votingEngine.revealVoteByCommitKey(1, roundId, ck1, true, 5_000, salt1);
        votingEngine.revealVoteByCommitKey(1, roundId, ck2, true, 5_000, salt2);
        votingEngine.revealVoteByCommitKey(1, roundId, ck3, false, 5_000, salt3);

        _settleAfterRbtsSeed(votingEngine, 1, roundId);

        assertEq(registry.getRating(1), 5200);
        assertEq(
            uint8(RoundEngineReadHelpers.round(votingEngine, 1, roundId).state), uint8(RoundLib.RoundState.Settled)
        );

        vm.warp(T0 + 30 days + 30 minutes);
        registry.markDormant(1);
        (,,,,, ContentRegistry.ContentStatus status,,,,) = registry.contents(1);
        assertEq(uint256(status), uint256(ContentRegistry.ContentStatus.Dormant));
    }

    function test_SetVotingEngine_OldEngineRecordMeaningfulActivity_RevertsOnFreshContent_AfterRotation() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 20e6);
        _submitContentWithReservation(registry, "https://example.com/old-engine-tracked", "g", "g", "t", 0);
        _submitContentWithReservation(registry, "https://example.com/old-engine-untracked", "g", "g", "t", 0);
        vm.stopPrank();

        _commit(voter1, 1, true);

        RoundVotingEngine replacementEngine = _deployReplacementVotingEngine();
        vm.startPrank(owner);
        registry.pause();
        registry.setVotingEngine(address(replacementEngine));
        registry.unpause();
        vm.stopPrank();

        vm.prank(address(votingEngine));
        registry.recordMeaningfulActivity(1);

        vm.prank(address(votingEngine));
        vm.expectRevert(ContentRegistry.OnlyVotingEngine.selector);
        registry.recordMeaningfulActivity(2);
    }

    function test_CancelContent_VotingEngineNotSet_AllowsCancel() public {
        // Deploy a fresh registry without votingEngine
        vm.startPrank(owner);
        ContentRegistry registryImpl2 = new ContentRegistry();
        ContentRegistry reg2 = ContentRegistry(
            address(
                new ERC1967Proxy(
                    address(registryImpl2),
                    abi.encodeCall(ContentRegistry.initializeWithTreasury, (owner, owner, owner, address(lrepToken)))
                )
            )
        );
        reg2.setBonusPool(bonusPool);
        MockCategoryRegistry mockCategoryRegistry2 = new MockCategoryRegistry();
        mockCategoryRegistry2.seedDefaultTestCategories();
        reg2.setCategoryRegistry(address(mockCategoryRegistry2));
        // DON'T set votingEngine
        vm.stopPrank();

        vm.startPrank(submitter);
        lrepToken.approve(address(reg2), 10e6);
        _submitContentWithReservation(reg2, "https://example.com/1", "goal", "goal", "tags", 0);
        reg2.cancelContent(1);
        vm.stopPrank();

        (,,,,, ContentRegistry.ContentStatus status,,,,) = reg2.contents(1);
        assertEq(uint256(status), uint256(ContentRegistry.ContentStatus.Cancelled));
    }

    function test_CancelContent_DoesNotChargeDeprecatedFee() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/1", "goal", "goal", "tags", 0);

        uint256 bonusBefore = lrepToken.balanceOf(bonusPool);
        registry.cancelContent(1);
        vm.stopPrank();

        uint256 bonusAfter = lrepToken.balanceOf(bonusPool);
        assertEq(bonusAfter - bonusBefore, 0);
    }

    function test_CancelContent_DeprecatedFeeNotSentToTreasury() public {
        vm.prank(owner);
        registry.setBonusPool(treasury);

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/treasury", "goal", "goal", "tags", 0);

        uint256 treasuryBefore = lrepToken.balanceOf(treasury);
        registry.cancelContent(1);
        vm.stopPrank();

        uint256 treasuryAfter = lrepToken.balanceOf(treasury);
        assertEq(treasuryAfter - treasuryBefore, 0);
    }

    function _deployReplacementVotingEngine() internal returns (RoundVotingEngine replacementEngine) {
        vm.startPrank(owner);
        replacementEngine = RoundVotingEngine(
            address(
                new ERC1967Proxy(
                    address(new RoundVotingEngine()),
                    abi.encodeCall(
                        RoundVotingEngine.initialize,
                        (owner, address(lrepToken), address(registry), address(_deployProtocolConfig(owner)))
                    )
                )
            )
        );
        vm.stopPrank();
    }

    // =========================================================================
    // Engine deauthorization (M-Identity-1) regression
    // =========================================================================

    function test_SetVotingEngine_OldEngine_UpdateRatingState_RevertsOnFreshContent_AfterRotation() public {
        // Submit content that the old engine has touched (commit), and a second piece of content
        // the old engine has never settled. Pre-fix the second case is the security hole: the
        // per-content stale check defaults to "not stale" for unsettled content, so the
        // deauthorized engine could write rating state. Post-fix the call must revert
        // immediately because the caller is no longer canonical.
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/old-engine-fresh", "g", "g", "t", 0);
        vm.stopPrank();
        uint256 freshContentId = 1;

        RoundVotingEngine replacementEngine = _deployReplacementVotingEngine();
        vm.startPrank(owner);
        registry.pause();
        registry.setVotingEngine(address(replacementEngine));
        registry.unpause();
        vm.stopPrank();

        // The old engine attempts to write rating state on a content the new engine has not
        // touched yet. Under the buggy pre-fix behavior this would succeed (per-content
        // generation defaults to zero, so the stale check passes). Under the fix it reverts.
        RatingLib.RatingState memory attackerState;
        attackerState.ratingBps = 7500;
        attackerState.conservativeRatingBps = 7500;
        attackerState.lastUpdatedAt = uint48(block.timestamp);

        vm.prank(address(votingEngine));
        vm.expectRevert(ContentRegistry.OnlyVotingEngine.selector);
        registry.updateRatingState(freshContentId, 1, 5000, attackerState);

        // Sanity: the canonical (replacement) engine can still write to the same content.
        vm.prank(address(replacementEngine));
        registry.updateRatingState(freshContentId, 1, 5000, attackerState);
        assertEq(registry.getRating(freshContentId), 7500);
    }

    function test_SetVotingEngine_OldEngine_UpdateActivity_RevertsAfterRotation() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/old-engine-activity", "g", "g", "t", 0);
        vm.stopPrank();

        RoundVotingEngine replacementEngine = _deployReplacementVotingEngine();
        vm.startPrank(owner);
        registry.pause();
        registry.setVotingEngine(address(replacementEngine));
        registry.unpause();
        vm.stopPrank();

        vm.prank(address(votingEngine));
        vm.expectRevert(ContentRegistry.OnlyVotingEngine.selector);
        registry.updateActivity(1);

        vm.prank(address(votingEngine));
        vm.expectRevert(ContentRegistry.OnlyVotingEngine.selector);
        registry.recordMeaningfulActivity(1);
    }

    function test_RevokeVotingEngine_ClearsAuthorizationAndEmitsEvent() public {
        // Set up replacement engine so we have a non-canonical engine to revoke.
        RoundVotingEngine replacementEngine = _deployReplacementVotingEngine();
        vm.startPrank(owner);
        registry.pause();
        registry.setVotingEngine(address(replacementEngine));
        registry.unpause();
        vm.stopPrank();

        address oldEngine = address(votingEngine);

        vm.expectEmit(true, true, true, true, address(registry));
        emit ContentRegistry.VotingEngineRevoked(oldEngine);
        vm.prank(owner);
        registry.revokeVotingEngine(oldEngine);

        // After revoke, the old engine cannot call back even on content the replacement
        // engine has never touched.
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/revoked-engine", "g", "g", "t", 0);
        vm.stopPrank();

        vm.prank(oldEngine);
        vm.expectRevert(ContentRegistry.OnlyVotingEngine.selector);
        registry.updateActivity(1);

        RatingLib.RatingState memory attackerState;
        attackerState.ratingBps = 7500;
        attackerState.conservativeRatingBps = 7500;
        attackerState.lastUpdatedAt = uint48(block.timestamp);
        vm.prank(oldEngine);
        vm.expectRevert(ContentRegistry.OnlyVotingEngine.selector);
        registry.updateRatingState(1, 1, 5000, attackerState);
    }

    function test_RevokeVotingEngine_RejectsCanonicalEngine() public {
        vm.prank(owner);
        vm.expectRevert("Cannot revoke canonical engine");
        registry.revokeVotingEngine(address(votingEngine));
    }

    function test_RevokeVotingEngine_RejectsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert("Invalid address");
        registry.revokeVotingEngine(address(0));
    }

    function test_RevokeVotingEngine_RejectsUnauthorizedEngine() public {
        vm.prank(owner);
        vm.expectRevert("Engine not authorized");
        registry.revokeVotingEngine(address(0xBEEF));
    }

    function test_RevokeVotingEngine_RequiresConfigRole() public {
        RoundVotingEngine replacementEngine = _deployReplacementVotingEngine();
        vm.startPrank(owner);
        registry.pause();
        registry.setVotingEngine(address(replacementEngine));
        registry.unpause();
        vm.stopPrank();

        vm.prank(address(0xC0FFEE));
        vm.expectRevert();
        registry.revokeVotingEngine(address(votingEngine));
    }

    // =========================================================================
    // markDormant BRANCHES
    // =========================================================================

    function test_MarkDormant_PeriodNotElapsed_Reverts() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/1", "goal", "goal", "tags", 0);
        vm.stopPrank();

        vm.expectRevert("Dormancy period not elapsed");
        registry.markDormant(1);
    }

    function test_MarkDormant_BundledContent_Reverts() public {
        uint256[] memory contentIds = _submitReservedQuestionBundleForDormancyTest();

        vm.warp(block.timestamp + 31 days);

        vm.expectRevert("Bundled content");
        registry.markDormant(contentIds[0]);
    }

    function test_MarkDormant_VotingEngineNotSet_AllowsDormant() public {
        vm.startPrank(owner);
        ContentRegistry registryImpl2 = new ContentRegistry();
        ContentRegistry reg2 = ContentRegistry(
            address(
                new ERC1967Proxy(
                    address(registryImpl2),
                    abi.encodeCall(ContentRegistry.initializeWithTreasury, (owner, owner, owner, address(lrepToken)))
                )
            )
        );
        MockCategoryRegistry mockCategoryRegistry2 = new MockCategoryRegistry();
        mockCategoryRegistry2.seedDefaultTestCategories();
        reg2.setCategoryRegistry(address(mockCategoryRegistry2));
        // DON'T set votingEngine
        vm.stopPrank();

        vm.startPrank(submitter);
        lrepToken.approve(address(reg2), 10e6);
        _submitContentWithReservation(reg2, "https://example.com/1", "goal", "goal", "tags", 0);
        vm.stopPrank();

        vm.warp(T0 + 31 days);
        reg2.markDormant(1);

        (,,,,, ContentRegistry.ContentStatus status,,,,) = reg2.contents(1);
        assertEq(uint256(status), uint256(ContentRegistry.ContentStatus.Dormant));
    }

    function test_MarkDormant_Success() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/1", "goal", "goal", "tags", 0);
        vm.stopPrank();

        vm.warp(T0 + 31 days);
        registry.markDormant(1);

        (,,,,, ContentRegistry.ContentStatus status,,,,) = registry.contents(1);
        assertEq(uint256(status), uint256(ContentRegistry.ContentStatus.Dormant));
    }

    function test_VoteCommit_UpdatesLastActivityAt() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/activity", "goal", "goal", "tags", 0);
        vm.stopPrank();

        vm.warp(T0 + 29 days);
        _vote(voter1, 1, true);

        (,,,, uint256 lastActivityAt,,,,,) = registry.contents(1);
        assertEq(lastActivityAt, block.timestamp, "Commit should refresh lastActivityAt");
    }

    function test_MarkDormant_SubQuorumRound_AllVotesRevealed_AllowsDormant() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/open-round", "goal", "goal", "tags", 0);
        vm.stopPrank();

        (bytes32 commitKey, bytes32 salt) = _commit(voter1, 1, true);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, 1);

        _warpPastTlockRevealTime(block.timestamp + 1 hours);
        votingEngine.revealVoteByCommitKey(1, roundId, commitKey, true, 5_000, salt);

        assertEq(RoundEngineReadHelpers.activeRoundId(votingEngine, 1), roundId, "Round should still be open");
        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, 1, roundId);
        assertEq(round.voteCount, round.revealedCount, "All votes are revealed");

        vm.warp(T0 + 31 days);
        registry.markDormant(1);

        (,,,,, ContentRegistry.ContentStatus status,,,,) = registry.contents(1);
        assertEq(uint256(status), uint256(ContentRegistry.ContentStatus.Dormant));
    }

    function test_MarkDormant_AfterEngineRotationWithSubQuorumHistoricalVotes_AllowsDormant() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/rotated-open-round", "goal", "goal", "tags", 0);
        vm.stopPrank();

        _commit(voter1, 1, true);

        RoundVotingEngine replacementEngine = _deployReplacementVotingEngine();
        vm.startPrank(owner);
        registry.pause();
        registry.setVotingEngine(address(replacementEngine));
        registry.unpause();
        vm.stopPrank();

        vm.warp(T0 + 31 days);
        registry.markDormant(1);

        (,,,,, ContentRegistry.ContentStatus status,,,,) = registry.contents(1);
        assertEq(uint256(status), uint256(ContentRegistry.ContentStatus.Dormant));
    }

    function test_MarkDormant_AfterRotatedOldRoundCancelled_AllowsDormant() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(
            registry, "https://example.com/rotated-cancelled-round", "goal", "goal", "tags", 0
        );
        vm.stopPrank();

        _commit(voter1, 1, true);
        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, 1);

        RoundVotingEngine replacementEngine = _deployReplacementVotingEngine();
        vm.startPrank(owner);
        registry.pause();
        registry.setVotingEngine(address(replacementEngine));
        registry.unpause();
        vm.stopPrank();

        vm.warp(T0 + 7 days + 1);
        votingEngine.cancelExpiredRound(1, roundId);

        vm.warp(T0 + 31 days);
        registry.markDormant(1);

        (,,,,, ContentRegistry.ContentStatus status,,,,) = registry.contents(1);
        assertEq(uint256(status), uint256(ContentRegistry.ContentStatus.Dormant));
    }

    function test_MarkDormant_AfterRotationChecksCurrentEngineOpenRound() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(
            registry, "https://example.com/rotated-current-open-round", "goal", "goal", "tags", 0
        );
        vm.stopPrank();

        _commit(voter1, 1, true);
        uint256 oldRoundId = RoundEngineReadHelpers.activeRoundId(votingEngine, 1);

        RoundVotingEngine replacementEngine = _deployReplacementVotingEngine();
        vm.startPrank(owner);
        _setTlockRoundConfig(ProtocolConfig(address(replacementEngine.protocolConfig())), 1 hours, 7 days, 3, 100);
        ProtocolConfig(address(replacementEngine.protocolConfig())).setRaterRegistry(address(raterRegistry));
        registry.pause();
        registry.setVotingEngine(address(replacementEngine));
        registry.unpause();
        vm.stopPrank();

        vm.warp(T0 + 7 days + 1);
        votingEngine.cancelExpiredRound(1, oldRoundId);
        _commitWithStakeToEngine(replacementEngine, voter2, 1, true, STAKE);
        _commitWithStakeToEngine(replacementEngine, voter3, 1, true, STAKE);
        _commitWithStakeToEngine(replacementEngine, voter4, 1, false, STAKE);

        vm.warp(T0 + 31 days);
        vm.expectRevert("Content has active round");
        registry.markDormant(1);
    }

    function test_MarkDormant_CancelledRound_UsesDormancyAnchor() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/recent-vote", "goal", "goal", "tags", 0);
        vm.stopPrank();

        vm.warp(T0 + 29 days);
        _vote(voter1, 1, true);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, 1);
        vm.warp(T0 + 29 days + 7 days + 1);
        votingEngine.cancelExpiredRound(1, roundId);

        registry.markDormant(1);

        (,,,,, ContentRegistry.ContentStatus status,,,,) = registry.contents(1);
        assertEq(uint256(status), uint256(ContentRegistry.ContentStatus.Dormant));
    }

    function test_MarkDormant_ZeroStakeOpenRound_AllowsDormant() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/zero-stake-open", "goal", "goal", "tags", 0);
        vm.stopPrank();

        vm.warp(T0 + 31 days);
        vm.prank(voter1);
        votingEngine.openRound(1);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, 1);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(votingEngine, 1, roundId);
        assertEq(uint256(round.state), uint256(RoundLib.RoundState.Open));
        assertEq(round.voteCount, 0);
        assertEq(round.totalStake, 0);

        registry.markDormant(1);

        (,,,,, ContentRegistry.ContentStatus status,,,,) = registry.contents(1);
        assertEq(uint256(status), uint256(ContentRegistry.ContentStatus.Dormant));
    }

    function test_MarkDormant_ZeroStakeOpenRound_EligibilityPathAllowsDormant() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(
            registry, "https://example.com/zero-stake-open-eligible", "goal", "goal", "tags", 0
        );
        vm.stopPrank();

        vm.warp(T0 + 31 days);
        vm.prank(voter1);
        votingEngine.openRound(1);

        registry.markDormant(1);
        (,,,,, ContentRegistry.ContentStatus status,,,,) = registry.contents(1);
        assertEq(uint256(status), uint256(ContentRegistry.ContentStatus.Dormant));
    }

    function test_CommitVote_DormancyEligibleContent_CanStartNewRoundAfterCancellation() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/dormancy-guard", "goal", "goal", "tags", 0);
        vm.stopPrank();

        vm.warp(T0 + 29 days);
        _vote(voter1, 1, true);

        uint256 roundId = RoundEngineReadHelpers.activeRoundId(votingEngine, 1);
        vm.warp(T0 + 29 days + 7 days + 1);
        votingEngine.cancelExpiredRound(1, roundId);

        bytes32 salt = keccak256(abi.encodePacked(voter2, block.timestamp));
        _openRoundForTest(votingEngine, 1, voter2);
        uint256 nextRoundId = _previewCommitRoundId(votingEngine, 1);
        uint64 targetRound = _tlockCommitTargetRound(votingEngine, 1);
        bytes32 drandChainHash = _tlockDrandChainHash();
        bytes memory ciphertext = _testCiphertext(true, salt, 1, targetRound, drandChainHash);
        bytes32 commitHash = _commitHash(
            true, salt, voter2, 1, nextRoundId, _defaultRatingReferenceBps(), targetRound, drandChainHash, ciphertext
        );

        vm.startPrank(voter2);
        lrepToken.approve(address(votingEngine), STAKE);
        votingEngine.commitVote(
            1,
            _roundContext(nextRoundId, _defaultRatingReferenceBps()),
            targetRound,
            drandChainHash,
            commitHash,
            ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();

        uint256 newRoundId = RoundEngineReadHelpers.activeRoundId(votingEngine, 1);
        assertEq(newRoundId, roundId + 1, "active content should remain voteable after dormancy window");
        RoundLib.Round memory newRound = RoundEngineReadHelpers.round(votingEngine, 1, newRoundId);
        assertEq(uint256(newRound.state), uint256(RoundLib.RoundState.Open));
        assertEq(newRound.voteCount, 1);
    }

    function test_MarkDormant_ReleasesUrlForResubmission() public {
        string memory url = "https://example.com/dormant-url";
        string memory title = "goal";
        string memory description = "goal";
        string memory tags = "tags";

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 20e6);
        _submitContentWithReservation(registry, url, title, description, tags, 0);
        vm.stopPrank();

        // Mark dormant after 31 days
        vm.warp(T0 + 31 days);
        registry.markDormant(1);

        vm.warp(T0 + 32 days + 1);
        registry.releaseDormantSubmissionKey(1);

        // Should be able to resubmit the same URL
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, url, title, description, tags, 0);
        vm.stopPrank();

        // New content created with same URL
        (,,,,, ContentRegistry.ContentStatus status,,,,) = registry.contents(2);
        assertEq(uint256(status), uint256(ContentRegistry.ContentStatus.Active));

        vm.expectRevert("No submission key");
        registry.releaseDormantSubmissionKey(1);

        bytes32 submissionKey =
            _questionSubmissionKey(url, _emptyImageUrls(), "", title, tags, 1, _emptySubmissionDetails());
        assertTrue(registry.submissionKeyUsed(submissionKey), "active resubmission keeps canonical key reserved");
    }

    function test_ReviveContent_ReservesUrlAgain() public {
        string memory url = "https://example.com/revive-url";

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, url, "goal", "goal", "tags", 0);
        vm.stopPrank();

        vm.warp(T0 + 31 days);
        registry.markDormant(1);

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 5e6);
        registry.reviveContent(1);
        vm.stopPrank();

        vm.startPrank(voter2);
        lrepToken.approve(address(registry), 10e6);
        vm.expectRevert("Question already submitted");
        registry.submitQuestion(
            url,
            _emptyImageUrls(),
            "",
            "goal",
            "tags",
            1,
            _emptySubmissionDetails(),
            keccak256("revive-conflict-salt"),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_ReviveContent_AllowsStoredSubmitterAfterIdentityRebind() public {
        string memory url = "https://example.com/reminted-revive";

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        uint256 contentId = _submitContentWithReservation(registry, url, "goal", "goal", "tags", 0);
        vm.stopPrank();

        vm.warp(T0 + 31 days);
        registry.markDormant(contentId);

        address remintedSubmitter = address(0xCAFE);
        bytes32 anchor = bytes32(uint256(uint160(submitter)));
        vm.startPrank(owner);
        raterRegistry.revokeHumanCredential(submitter);
        raterRegistry.clearRevokedHumanNullifier(RaterRegistry.HumanCredentialProvider.SeededHuman, anchor);
        _seedRaterIdentity(raterRegistry, remintedSubmitter, anchor);
        vm.stopPrank();

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 5e6);
        registry.reviveContent(contentId);
        vm.stopPrank();

        (,,,,, ContentRegistry.ContentStatus status,, address reviver,,) = registry.contents(contentId);
        assertEq(uint256(status), uint256(ContentRegistry.ContentStatus.Active));
        assertEq(reviver, submitter);
    }

    function test_ReviveContent_RevertsWhenUrlWasResubmitted() public {
        string memory url = "https://example.com/revive-conflict";

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, url, "goal", "goal", "tags", 0);
        vm.stopPrank();

        vm.warp(T0 + 31 days);
        registry.markDormant(1);

        vm.warp(T0 + 32 days + 1);
        registry.releaseDormantSubmissionKey(1);

        vm.startPrank(voter1);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, url, "goal2", "goal2", "tags2", 0);
        vm.stopPrank();

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 5e6);
        vm.expectRevert("Dormant key released");
        registry.reviveContent(1);
        vm.stopPrank();
    }

    // =========================================================================
    // initializeWithTreasury BRANCHES
    // =========================================================================

    function test_InitializeWithTreasury_ConfiguresTreasuryAuthority() public {
        address governance = address(0xB0B);
        address newTreasuryOperator = address(0xBEEF);

        vm.startPrank(owner);
        ContentRegistry registryImpl2 = new ContentRegistry();
        ContentRegistry reg2 = ContentRegistry(
            address(
                new ERC1967Proxy(
                    address(registryImpl2),
                    abi.encodeCall(
                        ContentRegistry.initializeWithTreasury, (owner, governance, treasury, address(lrepToken))
                    )
                )
            )
        );
        vm.stopPrank();

        assertEq(reg2.treasury(), treasury);
        assertEq(reg2.bonusPool(), treasury);
        assertTrue(reg2.hasRole(reg2.DEFAULT_ADMIN_ROLE(), governance));
        assertTrue(reg2.hasRole(reg2.TREASURY_ADMIN_ROLE(), governance));
        assertTrue(reg2.hasRole(reg2.TREASURY_ADMIN_ROLE(), treasury));
        assertTrue(reg2.hasRole(reg2.TREASURY_ROLE(), treasury));
        assertFalse(reg2.hasRole(reg2.TREASURY_ROLE(), governance));
        assertEq(reg2.getRoleAdmin(reg2.TREASURY_ROLE()), reg2.TREASURY_ADMIN_ROLE());
        assertEq(reg2.getRoleAdmin(reg2.TREASURY_ADMIN_ROLE()), reg2.DEFAULT_ADMIN_ROLE());

        bytes32 treasuryRole = reg2.TREASURY_ROLE();
        bytes32 treasuryAdminRole = reg2.TREASURY_ADMIN_ROLE();
        vm.prank(governance);
        reg2.grantRole(treasuryRole, newTreasuryOperator);

        assertTrue(reg2.hasRole(treasuryRole, newTreasuryOperator));

        vm.startPrank(treasury);
        vm.expectRevert();
        reg2.revokeRole(treasuryAdminRole, governance);
        vm.stopPrank();

        vm.prank(governance);
        reg2.revokeRole(treasuryAdminRole, governance);
        assertFalse(reg2.hasRole(treasuryAdminRole, governance));

        vm.prank(governance);
        reg2.grantRole(treasuryAdminRole, governance);
        assertTrue(reg2.hasRole(treasuryAdminRole, governance));
    }

    function test_SubmitContent_SeededCategory_Succeeds() public {
        vm.prank(owner);
        registry.setCategoryRegistry(address(mockCategoryRegistry));
        mockCategoryRegistry.setSlug(1, "example.com");
        mockCategoryRegistry.setCategoryExists(1, true);

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        uint256 id = _submitContentWithReservation(registry, "https://example.com/1", "goal", "goal", "tags", 1);
        vm.stopPrank();
        assertEq(id, 1);
        (,,,,,,,,, uint256 categoryId) = registry.contents(1);
        assertEq(categoryId, 1);
    }

    function test_SubmitContent_CategoryRegistryConfigured_AutoResolvesCategoryFromUrl() public {
        vm.prank(owner);
        registry.setCategoryRegistry(address(mockCategoryRegistry));
        mockCategoryRegistry.setSlug(7, "example.com");
        mockCategoryRegistry.setCategoryExists(7, true);

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        uint256 id = _submitContentWithReservation(registry, "https://example.com/auto", "goal", "goal", "tags", 0);
        vm.stopPrank();

        assertEq(id, 1);
        (,,,,,,,,, uint256 categoryId) = registry.contents(id);
        assertEq(categoryId, 1, "media questions use the explicit category selected by the submitter");
    }

    function test_MarkDormant_PhantomContentId_Reverts() public {
        vm.warp(block.timestamp + 31 days);
        vm.expectRevert("Content does not exist");
        registry.markDormant(999999);
    }

    // --- Security fix: salt != 0 required on submissions ---

    function test_SubmitQuestion_RequiresNonZeroSalt() public {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        // All other inputs valid; salt=0 should revert with "Salt required" now that
        // the check runs after URL/category/submissionKey validation.
        vm.expectRevert("Salt required");
        registry.submitQuestion(
            "https://example.com/salt-required",
            _emptyImageUrls(),
            "",
            "Question?",
            "tag",
            1,
            _emptySubmissionDetails(),
            bytes32(0),
            _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    // --- Security fix: reservations are scoped by submitter ---

    function test_ReserveSubmission_SameHashDifferentSubmittersBothSucceed() public {
        bytes32 hash = keccak256("front-run-demo");
        // First submitter reserves the hash.
        vm.prank(submitter);
        registry.reserveSubmission(hash);
        // A different submitter should NOT collide on the same hash -- the mapping is
        // keyed by (hash, msg.sender) so each caller has their own namespace.
        vm.prank(voter1);
        registry.reserveSubmission(hash);
        // Both submitters can cancel their own reservation without affecting the other.
        vm.prank(submitter);
        registry.cancelReservedSubmission(hash);
        vm.prank(voter1);
        registry.cancelReservedSubmission(hash);
    }
}
