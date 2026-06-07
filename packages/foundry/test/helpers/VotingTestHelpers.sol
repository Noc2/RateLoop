// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import { Vm, VmSafe } from "forge-std/Vm.sol";
import { Base64 } from "@openzeppelin/contracts/utils/Base64.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ContentRegistry } from "../../contracts/ContentRegistry.sol";
import { ProtocolConfig } from "../../contracts/ProtocolConfig.sol";
import { RaterRegistry } from "../../contracts/RaterRegistry.sol";
import { RoundVotingEngine } from "../../contracts/RoundVotingEngine.sol";
import { RatingLib } from "../../contracts/libraries/RatingLib.sol";
import { RoundLib } from "../../contracts/libraries/RoundLib.sol";
import { MockWorldIDVerifier } from "../../contracts/mocks/MockWorldIDVerifier.sol";
import { MockQuestionRewardPoolEscrow } from "../mocks/MockQuestionRewardPoolEscrow.sol";
import { RoundEngineReadHelpers } from "./RoundEngineReadHelpers.sol";

function deployInitializedProtocolConfig(address admin) returns (ProtocolConfig protocolConfig) {
    return deployInitializedProtocolConfig(admin, admin);
}

function deployInitializedProtocolConfig(address admin, address governance) returns (ProtocolConfig protocolConfig) {
    ProtocolConfig implementation = new ProtocolConfig();
    protocolConfig = ProtocolConfig(
        address(
            new ERC1967Proxy(address(implementation), abi.encodeCall(ProtocolConfig.initialize, (admin, governance)))
        )
    );
}

abstract contract ContentSubmissionTestBase {
    Vm internal constant HEVM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    ContentRegistry internal activeTlockContentRegistry;
    uint8 internal constant DEFAULT_SUBMISSION_REWARD_ASSET_LREP = 0;
    uint256 internal constant DEFAULT_SUBMISSION_REWARD_POOL = 1e6;
    uint256 internal constant DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS = 3;
    uint256 internal constant DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS = 1;
    uint256 internal constant DEFAULT_SUBMISSION_REWARD_BOUNTY_START_BY = 0;
    uint256 internal constant DEFAULT_SUBMISSION_REWARD_BOUNTY_WINDOW_SECONDS = 0;
    uint256 internal constant DEFAULT_SUBMISSION_REWARD_FEEDBACK_WINDOW_SECONDS = 0;
    uint256 internal constant DEFAULT_SUBMISSION_REWARD_EXPIRES_AT = DEFAULT_SUBMISSION_REWARD_BOUNTY_START_BY;
    bytes32 internal constant DEFAULT_QUESTION_METADATA_HASH = keccak256("rateloop.generic.question.metadata.v1");
    bytes32 internal constant DEFAULT_RESULT_SPEC_HASH = keccak256("rateloop.generic.result.spec.v1");
    bytes32 internal constant QUESTION_CONTEXT_DOMAIN = keccak256("rateloop-question-context-v5");
    bytes32 internal constant QUESTION_REVEAL_DOMAIN = keccak256("rateloop-question-reveal-v7");
    bytes32 internal constant QUESTION_BUNDLE_ITEM_DOMAIN = keccak256("rateloop-question-bundle-item-v5");
    bytes32 internal constant QUESTION_BUNDLE_DOMAIN = keccak256("rateloop-question-bundle-v5");
    bytes32 internal constant QUESTION_BUNDLE_REVEAL_DOMAIN = keccak256("rateloop-question-bundle-reveal-v6");

    struct NoMediaQuestionText {
        string url;
        string title;
        string tags;
    }

    struct MediaQuestionReservation {
        ContentRegistry registry;
        string contextUrl;
        string[] imageUrls;
        string videoUrl;
        string title;
        string tags;
        uint256 categoryId;
        ContentRegistry.SubmissionDetails details;
        bytes32 salt;
        address submitter;
    }

    function _emptySubmissionDetails() internal pure returns (ContentRegistry.SubmissionDetails memory) {
        return ContentRegistry.SubmissionDetails({ detailsUrl: "", detailsHash: bytes32(0) });
    }

    function _submitContentWithReservation(
        ContentRegistry registry,
        string memory url,
        string memory title,
        string memory,
        string memory tags,
        uint256 categoryId
    ) internal returns (uint256 contentId) {
        activeTlockContentRegistry = registry;
        (VmSafe.CallerMode mode, address msgSender,) = HEVM.readCallers();
        bool stopNormalizedPrank = mode == VmSafe.CallerMode.Prank;
        address submitter = _submissionCallerAddress(mode, msgSender);
        uint256 submissionCategoryId = categoryId == 0 ? 1 : categoryId;
        bytes32 salt = _contentSubmissionSalt(url, submitter);
        NoMediaQuestionText memory question;
        question.url = url;
        question.title = title;
        question.tags = tags;

        _reserveNoMediaQuestionSubmission(registry, question, submissionCategoryId, salt, submitter);
        HEVM.warp(block.timestamp + 1);
        contentId = _submitNoMediaQuestion(registry, question, submissionCategoryId, salt);

        if (stopNormalizedPrank) {
            HEVM.stopPrank();
        }
    }

    function _submissionCallerAddress(VmSafe.CallerMode mode, address msgSender) internal view returns (address) {
        if (mode == VmSafe.CallerMode.None) return address(this);
        return msgSender != address(0) ? msgSender : address(this);
    }

    function _contentSubmissionSalt(string memory url, address submitter) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(url, submitter, block.timestamp, block.number, gasleft()));
    }

    function _reserveNoMediaQuestionSubmission(
        ContentRegistry registry,
        NoMediaQuestionText memory question,
        uint256 categoryId,
        bytes32 salt,
        address submitter
    ) internal {
        _reserveQuestionMediaSubmission(
            registry,
            question.url,
            _emptyImageUrls(),
            "",
            question.title,
            "",
            question.tags,
            categoryId,
            salt,
            submitter
        );
    }

    function _submitNoMediaQuestion(
        ContentRegistry registry,
        NoMediaQuestionText memory question,
        uint256 categoryId,
        bytes32 salt
    ) internal returns (uint256) {
        return registry.submitQuestion(
            question.url,
            _emptyImageUrls(),
            "",
            question.title,
            question.tags,
            categoryId,
            _emptySubmissionDetails(),
            salt,
            _defaultQuestionSpec()
        );
    }

    function _reserveQuestionMediaSubmission(
        ContentRegistry registry,
        string memory contextUrl,
        string[] memory imageUrls,
        string memory videoUrl,
        string memory title,
        string memory,
        string memory tags,
        uint256 categoryId,
        bytes32 salt,
        address submitter
    ) internal returns (bytes32 submissionKey) {
        return _reserveQuestionMediaSubmission(
            registry, contextUrl, imageUrls, videoUrl, title, tags, categoryId, salt, submitter
        );
    }

    function _reserveQuestionMediaSubmission(
        ContentRegistry registry,
        string memory contextUrl,
        string[] memory imageUrls,
        string memory videoUrl,
        string memory title,
        string memory tags,
        uint256 categoryId,
        bytes32 salt,
        address submitter
    ) internal returns (bytes32 submissionKey) {
        MediaQuestionReservation memory reservation = MediaQuestionReservation({
            registry: registry,
            contextUrl: contextUrl,
            imageUrls: imageUrls,
            videoUrl: videoUrl,
            title: title,
            tags: tags,
            categoryId: categoryId,
            details: _emptySubmissionDetails(),
            salt: salt,
            submitter: submitter
        });
        return _reserveQuestionMediaSubmission(reservation);
    }

    function _reserveQuestionMediaSubmission(MediaQuestionReservation memory reservation)
        internal
        returns (bytes32 submissionKey)
    {
        (VmSafe.CallerMode mode, address msgSender, address txOrigin) = HEVM.readCallers();
        bool hasActivePrank = mode == VmSafe.CallerMode.Prank || mode == VmSafe.CallerMode.RecurrentPrank;
        if (hasActivePrank) {
            HEVM.stopPrank();
        }
        _ensureActiveProtocolConfig(reservation.registry);
        _ensureDefaultSubmitterIdentity(reservation.registry, reservation.submitter);
        address rewardEscrow = _ensureDefaultQuestionRewardPoolEscrow(reservation.registry);
        if (hasActivePrank) {
            HEVM.startPrank(msgSender, txOrigin);
        }
        submissionKey = _questionSubmissionKey(
            reservation.contextUrl,
            reservation.imageUrls,
            reservation.videoUrl,
            reservation.title,
            reservation.tags,
            reservation.categoryId,
            reservation.details
        );
        uint256 rewardAmount = _defaultSubmissionRewardAmount(reservation.registry);
        bytes32 revealCommitment = _questionReservationRevealCommitment(reservation, submissionKey, rewardAmount);
        IERC20(reservation.registry.lrepToken()).approve(rewardEscrow, rewardAmount);
        reservation.registry.reserveSubmission(revealCommitment);
    }

    function _questionReservationRevealCommitment(
        MediaQuestionReservation memory reservation,
        bytes32 submissionKey,
        uint256 rewardAmount
    ) internal view returns (bytes32) {
        ContentRegistry.SubmissionRewardTerms memory rewardTerms =
            ContentRegistry.SubmissionRewardTerms({
                asset: DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
                amount: rewardAmount,
                requiredVoters: DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS,
                requiredSettledRounds: DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
                bountyStartBy: DEFAULT_SUBMISSION_REWARD_BOUNTY_START_BY,
                bountyWindowSeconds: DEFAULT_SUBMISSION_REWARD_BOUNTY_WINDOW_SECONDS,
                feedbackWindowSeconds: DEFAULT_SUBMISSION_REWARD_FEEDBACK_WINDOW_SECONDS,
                bountyEligibility: 0
            });
        return _questionRevealCommitment(
            submissionKey,
            _submissionMediaHash(reservation.imageUrls, reservation.videoUrl),
            reservation.title,
            reservation.tags,
            reservation.details,
            reservation.categoryId,
            reservation.salt,
            reservation.submitter,
            rewardTerms,
            _defaultQuestionRoundConfig(reservation.registry),
            _defaultQuestionSpec()
        );
    }

    function _defaultQuestionRevealCommitment(
        ContentRegistry registry,
        bytes32 submissionKey,
        string[] memory imageUrls,
        string memory videoUrl,
        string memory title,
        string memory tags,
        uint256 categoryId,
        bytes32 salt,
        address submitter
    ) internal view returns (bytes32) {
        return _defaultQuestionRevealCommitment(
            registry, submissionKey, imageUrls, videoUrl, title, "", tags, categoryId, salt, submitter
        );
    }

    function _defaultQuestionRevealCommitment(
        ContentRegistry registry,
        bytes32 submissionKey,
        string[] memory imageUrls,
        string memory videoUrl,
        string memory title,
        string memory,
        string memory tags,
        uint256 categoryId,
        bytes32 salt,
        address submitter
    ) internal view returns (bytes32) {
        uint256 rewardAmount = _defaultSubmissionRewardAmount(registry);
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = ContentRegistry.SubmissionRewardTerms({
            asset: DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            amount: rewardAmount,
            requiredVoters: DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS,
            requiredSettledRounds: DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
            bountyStartBy: DEFAULT_SUBMISSION_REWARD_BOUNTY_START_BY,
            bountyWindowSeconds: DEFAULT_SUBMISSION_REWARD_BOUNTY_WINDOW_SECONDS,
            feedbackWindowSeconds: DEFAULT_SUBMISSION_REWARD_FEEDBACK_WINDOW_SECONDS,
            bountyEligibility: 0
        });
        return _questionRevealCommitment(
            submissionKey,
            _submissionMediaHash(imageUrls, videoUrl),
            title,
            tags,
            _emptySubmissionDetails(),
            categoryId,
            salt,
            submitter,
            rewardTerms,
            _defaultQuestionRoundConfig(registry),
            _defaultQuestionSpec()
        );
    }

    function _questionRevealCommitment(
        bytes32 submissionKey,
        bytes32 mediaHash,
        string memory title,
        string memory,
        string memory tags,
        uint256 categoryId,
        bytes32 salt,
        address submitter,
        ContentRegistry.SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig,
        ContentRegistry.QuestionSpecCommitment memory spec
    ) internal pure returns (bytes32) {
        return _questionRevealCommitment(
            submissionKey, mediaHash, title, tags, categoryId, salt, submitter, rewardTerms, roundConfig, spec
        );
    }

    function _questionRevealCommitment(
        bytes32 submissionKey,
        bytes32 mediaHash,
        string memory title,
        string memory tags,
        uint256 categoryId,
        bytes32 salt,
        address submitter,
        ContentRegistry.SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig,
        ContentRegistry.QuestionSpecCommitment memory spec
    ) internal pure returns (bytes32) {
        return _questionRevealCommitment(
            submissionKey,
            mediaHash,
            title,
            tags,
            _emptySubmissionDetails(),
            categoryId,
            salt,
            submitter,
            rewardTerms,
            roundConfig,
            spec
        );
    }

    function _questionRevealCommitment(
        bytes32 submissionKey,
        bytes32 mediaHash,
        string memory title,
        string memory,
        string memory tags,
        ContentRegistry.SubmissionDetails memory details,
        uint256 categoryId,
        bytes32 salt,
        address submitter,
        ContentRegistry.SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig,
        ContentRegistry.QuestionSpecCommitment memory spec
    ) internal pure returns (bytes32) {
        return _questionRevealCommitment(
            submissionKey, mediaHash, title, tags, details, categoryId, salt, submitter, rewardTerms, roundConfig, spec
        );
    }

    function _questionRevealCommitment(
        bytes32 submissionKey,
        bytes32 mediaHash,
        string memory title,
        string memory tags,
        ContentRegistry.SubmissionDetails memory details,
        uint256 categoryId,
        bytes32 salt,
        address submitter,
        ContentRegistry.SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig,
        ContentRegistry.QuestionSpecCommitment memory spec
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                QUESTION_REVEAL_DOMAIN,
                submissionKey,
                mediaHash,
                keccak256(abi.encode(title, tags)),
                keccak256(abi.encode(details.detailsUrl, details.detailsHash)),
                categoryId,
                salt,
                submitter,
                _hashSubmissionRewardTerms(rewardTerms),
                keccak256(
                    abi.encode(
                        roundConfig.epochDuration, roundConfig.maxDuration, roundConfig.minVoters, roundConfig.maxVoters
                    )
                ),
                spec.questionMetadataHash,
                spec.resultSpecHash
            )
        );
    }

    function _questionRevealCommitment(
        bytes32 submissionKey,
        bytes32 mediaHash,
        string memory title,
        string memory,
        string memory tags,
        uint256 categoryId,
        bytes32 salt,
        address submitter,
        ContentRegistry.SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig
    ) internal pure returns (bytes32) {
        return _questionRevealCommitment(
            submissionKey, mediaHash, title, tags, categoryId, salt, submitter, rewardTerms, roundConfig
        );
    }

    function _questionRevealCommitment(
        bytes32 submissionKey,
        bytes32 mediaHash,
        string memory title,
        string memory tags,
        uint256 categoryId,
        bytes32 salt,
        address submitter,
        ContentRegistry.SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig
    ) internal pure returns (bytes32) {
        return _questionRevealCommitment(
            submissionKey,
            mediaHash,
            title,
            tags,
            _emptySubmissionDetails(),
            categoryId,
            salt,
            submitter,
            rewardTerms,
            roundConfig,
            _defaultQuestionSpec()
        );
    }

    function _defaultQuestionRoundConfig(ContentRegistry registry)
        internal
        view
        returns (RoundLib.RoundConfig memory cfg)
    {
        ProtocolConfig protocolConfig = registry.protocolConfig();
        if (address(protocolConfig) != address(0)) {
            (cfg.epochDuration, cfg.maxDuration, cfg.minVoters, cfg.maxVoters) = protocolConfig.config();
            return cfg;
        }
        cfg = RoundLib.RoundConfig({
            epochDuration: uint32(20 minutes),
            maxDuration: uint32(20 minutes),
            minVoters: uint16(3),
            maxVoters: uint16(100)
        });
    }

    function _submissionMediaHash(string[] memory imageUrls, string memory videoUrl) internal pure returns (bytes32) {
        return keccak256(abi.encode(imageUrls, videoUrl));
    }

    function _questionSubmissionKey(
        string memory contextUrl,
        string[] memory imageUrls,
        string memory videoUrl,
        string memory title,
        string memory,
        string memory tags,
        uint256 resolvedCategoryId,
        ContentRegistry.SubmissionDetails memory details
    ) internal pure returns (bytes32) {
        return _questionSubmissionKey(contextUrl, imageUrls, videoUrl, title, tags, resolvedCategoryId, details);
    }

    function _questionSubmissionKey(
        string memory contextUrl,
        string[] memory imageUrls,
        string memory videoUrl,
        string memory title,
        string memory tags,
        uint256 resolvedCategoryId,
        ContentRegistry.SubmissionDetails memory details
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                QUESTION_CONTEXT_DOMAIN,
                resolvedCategoryId,
                _submissionMediaHash(imageUrls, videoUrl),
                keccak256(abi.encode(details.detailsUrl, details.detailsHash)),
                contextUrl,
                title,
                tags
            )
        );
    }

    function _submitQuestionImageWithReservation(
        ContentRegistry registry,
        string memory imageUrl,
        string memory title,
        string memory,
        string memory tags,
        uint256 categoryId,
        bytes32 salt,
        address submitter
    ) internal returns (uint256 contentId, bytes32 submissionKey) {
        string[] memory imageUrls = _singleImageUrls(imageUrl);
        submissionKey = _reserveQuestionMediaSubmission(
            registry, imageUrl, imageUrls, "", title, "", tags, categoryId, salt, submitter
        );
        HEVM.warp(block.timestamp + 1);
        contentId = registry.submitQuestion(
            imageUrl, imageUrls, "", title, tags, categoryId, _emptySubmissionDetails(), salt, _defaultQuestionSpec()
        );
    }

    function _defaultQuestionSpec() internal pure returns (ContentRegistry.QuestionSpecCommitment memory) {
        return ContentRegistry.QuestionSpecCommitment({
            questionMetadataHash: DEFAULT_QUESTION_METADATA_HASH, resultSpecHash: DEFAULT_RESULT_SPEC_HASH
        });
    }

    function _defaultSubmissionRewardAmount(ContentRegistry registry) internal view returns (uint256) {
        ProtocolConfig config = registry.protocolConfig();
        uint256 minimum = DEFAULT_SUBMISSION_REWARD_POOL;
        uint16 maxVoters = 100;
        if (address(config) != address(0)) {
            uint256 configuredMinimum = config.minSubmissionLrepPool();
            if (configuredMinimum != 0) minimum = configuredMinimum;
            (,,, maxVoters) = config.config();
        }
        uint256 maxTurnoutMinimum = uint256(maxVoters) * DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS * 10_000;
        return minimum > maxTurnoutMinimum ? minimum : maxTurnoutMinimum;
    }

    function _defaultSubmissionRewardTerms(ContentRegistry registry)
        internal
        view
        returns (ContentRegistry.SubmissionRewardTerms memory)
    {
        uint256 rewardAmount = _defaultSubmissionRewardAmount(registry);
        return ContentRegistry.SubmissionRewardTerms({
            asset: DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
            amount: rewardAmount,
            requiredVoters: DEFAULT_SUBMISSION_REWARD_REQUIRED_VOTERS,
            requiredSettledRounds: DEFAULT_SUBMISSION_REWARD_SETTLED_ROUNDS,
            bountyStartBy: DEFAULT_SUBMISSION_REWARD_BOUNTY_START_BY,
            bountyWindowSeconds: DEFAULT_SUBMISSION_REWARD_BOUNTY_WINDOW_SECONDS,
            feedbackWindowSeconds: DEFAULT_SUBMISSION_REWARD_FEEDBACK_WINDOW_SECONDS,
            bountyEligibility: 0
        });
    }

    function _hashSubmissionRewardTerms(ContentRegistry.SubmissionRewardTerms memory rewardTerms)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                rewardTerms.asset,
                rewardTerms.amount,
                rewardTerms.requiredVoters,
                rewardTerms.requiredSettledRounds,
                rewardTerms.bountyStartBy,
                rewardTerms.bountyWindowSeconds,
                rewardTerms.feedbackWindowSeconds,
                rewardTerms.bountyEligibility
            )
        );
    }

    function _activeSubmissionProtocolConfig() internal view virtual returns (ProtocolConfig) {
        return ProtocolConfig(address(0));
    }

    function _ensureActiveProtocolConfig(ContentRegistry registry) internal {
        ProtocolConfig desiredConfig = _activeSubmissionProtocolConfig();
        if (address(desiredConfig) == address(0) || address(registry.protocolConfig()) == address(desiredConfig)) {
            return;
        }

        bytes32 configRole = registry.CONFIG_ROLE();
        address[8] memory candidates = [
            address(this), address(1), address(2), address(0xA), address(0xB), address(0xAA), address(0xBB), address(10)
        ];
        for (uint256 i = 0; i < candidates.length; i++) {
            if (registry.hasRole(configRole, candidates[i])) {
                HEVM.prank(candidates[i]);
                registry.setProtocolConfig(address(desiredConfig));
                return;
            }
        }
    }

    function _ensureDefaultSubmitterIdentity(ContentRegistry, address) internal pure {
        // Address-key identity fallback is sufficient for generic reservation tests.
    }

    function _ensureDefaultQuestionRewardPoolEscrow(ContentRegistry registry) internal returns (address rewardEscrow) {
        rewardEscrow = registry.questionRewardPoolEscrow();
        if (rewardEscrow != address(0)) return rewardEscrow;

        MockQuestionRewardPoolEscrow mockRewardPoolEscrow = new MockQuestionRewardPoolEscrow();
        bytes32 configRole = registry.CONFIG_ROLE();
        address[8] memory candidates = [
            address(this), address(1), address(2), address(0xA), address(0xB), address(0xAA), address(0xBB), address(10)
        ];
        for (uint256 i = 0; i < candidates.length; i++) {
            if (registry.hasRole(configRole, candidates[i])) {
                HEVM.prank(candidates[i]);
                registry.setQuestionRewardPoolEscrow(address(mockRewardPoolEscrow));
                return address(mockRewardPoolEscrow);
            }
        }
        revert("Bounty escrow not set");
    }

    function _singleImageUrls(string memory imageUrl) internal pure returns (string[] memory imageUrls) {
        imageUrls = new string[](1);
        imageUrls[0] = imageUrl;
    }

    function _emptyImageUrls() internal pure returns (string[] memory imageUrls) {
        imageUrls = new string[](0);
    }

    function _submissionImageUrl(string memory url) internal pure returns (string memory) {
        return _uploadedImageUrl(bytes(url).length == 0 ? "default-test-image" : url);
    }

    function _uploadedImageUrl(string memory seed) internal pure returns (string memory) {
        return string.concat(
            "https://www.rateloop.ai/api/attachments/images/att_",
            Strings.toHexString(uint256(keccak256(bytes(seed)))),
            ".webp#sha256=0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        );
    }
}

/// @dev Base contract with shared helpers for commit-reveal tests.
///      Inherit from this instead of `Test` to get `_testCiphertext`, `_commitHash`, `_commitKey`.
abstract contract VotingTestBase is Test, ContentSubmissionTestBase {
    struct TestCommitArtifacts {
        bytes ciphertext;
        uint256 roundId;
        uint16 roundReferenceRatingBps;
        uint64 targetRound;
        bytes32 drandChainHash;
        bytes32 ciphertextHash;
        bytes32 commitHash;
        bytes32 commitKey;
    }

    struct DirectTestCommitRequest {
        RoundVotingEngine engine;
        IERC20 lrepToken;
        address voter;
        uint256 contentId;
        bool isUp;
        uint256 stake;
        address frontend;
        bytes32 salt;
    }

    struct TestRevealPayload {
        bool exists;
        bool isUp;
        bytes32 salt;
    }

    mapping(bytes32 => TestRevealPayload) internal testRevealPayloads;

    bytes32 internal constant DEFAULT_DRAND_CHAIN_HASH =
        0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971;
    uint64 internal constant DEFAULT_DRAND_GENESIS_TIME = 1;
    uint64 internal constant DEFAULT_DRAND_PERIOD = 3;
    uint256 internal constant DEFAULT_TLOCK_EPOCH_DURATION = 20 minutes;
    bytes internal constant TEST_AGE_HEADER_RAW = "-----BEGIN AGE ENCRYPTED FILE-----";
    bytes internal constant TEST_AGE_HEADER = "-----BEGIN AGE ENCRYPTED FILE-----\n";
    bytes internal constant TEST_AGE_FOOTER = "-----END AGE ENCRYPTED FILE-----\n";
    bytes internal constant TEST_AGE_VERSION = "age-encryption.org/v1\n";
    bytes internal constant TEST_TLOCK_LINE_PREFIX = "-> tlock ";
    bytes internal constant TEST_MAC_LINE_PREFIX = "--- ";
    bytes internal constant TEST_PAYLOAD_LINE_PREFIX = "payload ";
    uint256 internal constant TEST_AGE_LINE_CHUNK_SIZE = 64;
    uint256 internal constant ROUND_WINNING_STAKE_SLOT = 10;
    uint256 internal constant ROUND_RBTS_FORFEITED_POOL_SLOT = 16;
    uint256 internal constant COMMIT_RBTS_FORFEITED_STAKE_SLOT = 26;
    uint256 internal constant ROUND_ADVISORY_VOTE_RECORDER_SNAPSHOT_SLOT = 45;
    uint256 internal constant ROUND_REVEAL_GRACE_PERIOD_SNAPSHOT_SLOT = 48;
    uint256 internal constant ROUND_RATING_UP_EVIDENCE_SLOT = 57;
    uint256 internal constant ROUND_RATING_DOWN_EVIDENCE_SLOT = 58;
    uint256 internal constant ROUND_HAS_HUMAN_VERIFIED_COMMIT_SLOT = 61;
    ProtocolConfig internal activeTlockProtocolConfig;
    bytes32 internal activeTlockDrandChainHash = DEFAULT_DRAND_CHAIN_HASH;
    uint64 internal activeTlockDrandGenesisTime = DEFAULT_DRAND_GENESIS_TIME;
    uint64 internal activeTlockDrandPeriod = DEFAULT_DRAND_PERIOD;
    uint256 internal activeTlockEpochDuration = DEFAULT_TLOCK_EPOCH_DURATION;

    function _doubleUintMappingSlot(uint256 baseSlot, uint256 key1, uint256 key2) internal pure returns (bytes32) {
        return keccak256(abi.encode(key2, keccak256(abi.encode(key1, baseSlot))));
    }

    function _tripleUintBytes32MappingSlot(uint256 baseSlot, uint256 key1, uint256 key2, bytes32 key3)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(key3, keccak256(abi.encode(key2, keccak256(abi.encode(key1, baseSlot))))));
    }

    function _roundRbtsForfeitedPool(RoundVotingEngine engine, uint256 contentId, uint256 roundId)
        internal
        view
        returns (uint256)
    {
        return uint256(
            HEVM.load(address(engine), _doubleUintMappingSlot(ROUND_RBTS_FORFEITED_POOL_SLOT, contentId, roundId))
        );
    }

    function _roundWinningStake(RoundVotingEngine engine, uint256 contentId, uint256 roundId)
        internal
        view
        returns (uint256)
    {
        return uint256(HEVM.load(address(engine), _doubleUintMappingSlot(ROUND_WINNING_STAKE_SLOT, contentId, roundId)));
    }

    function _roundAdvisoryVoteRecorderSnapshot(RoundVotingEngine engine, uint256 contentId, uint256 roundId)
        internal
        view
        returns (address)
    {
        return address(
            uint160(
                uint256(
                    HEVM.load(
                        address(engine),
                        _doubleUintMappingSlot(ROUND_ADVISORY_VOTE_RECORDER_SNAPSHOT_SLOT, contentId, roundId)
                    )
                )
            )
        );
    }

    function _roundRevealGracePeriodSnapshot(RoundVotingEngine engine, uint256 contentId, uint256 roundId)
        internal
        view
        returns (uint256)
    {
        return uint256(
            HEVM.load(
                address(engine), _doubleUintMappingSlot(ROUND_REVEAL_GRACE_PERIOD_SNAPSHOT_SLOT, contentId, roundId)
            )
        );
    }

    function _commitRbtsForfeitedStake(RoundVotingEngine engine, uint256 contentId, uint256 roundId, bytes32 commitKey)
        internal
        view
        returns (uint256)
    {
        return uint256(
            HEVM.load(
                address(engine),
                _tripleUintBytes32MappingSlot(COMMIT_RBTS_FORFEITED_STAKE_SLOT, contentId, roundId, commitKey)
            )
        );
    }

    function _roundRatingUpEvidence(RoundVotingEngine engine, uint256 contentId, uint256 roundId)
        internal
        view
        returns (uint64)
    {
        return uint64(
            uint256(
                HEVM.load(address(engine), _doubleUintMappingSlot(ROUND_RATING_UP_EVIDENCE_SLOT, contentId, roundId))
            )
        );
    }

    function _roundRatingDownEvidence(RoundVotingEngine engine, uint256 contentId, uint256 roundId)
        internal
        view
        returns (uint64)
    {
        return uint64(
            uint256(
                HEVM.load(address(engine), _doubleUintMappingSlot(ROUND_RATING_DOWN_EVIDENCE_SLOT, contentId, roundId))
            )
        );
    }

    function _roundHasHumanVerifiedCommit(RoundVotingEngine engine, uint256 contentId, uint256 roundId)
        internal
        view
        returns (bool)
    {
        return uint256(
            HEVM.load(address(engine), _doubleUintMappingSlot(ROUND_HAS_HUMAN_VERIFIED_COMMIT_SLOT, contentId, roundId))
        ) != 0;
    }

    function _deployProtocolConfig(address admin) internal returns (ProtocolConfig protocolConfig) {
        return _deployProtocolConfig(admin, admin);
    }

    function _deployProtocolConfig(address admin, address governance) internal returns (ProtocolConfig protocolConfig) {
        protocolConfig = deployInitializedProtocolConfig(admin, governance);
        activeTlockProtocolConfig = protocolConfig;
        activeTlockEpochDuration = DEFAULT_TLOCK_EPOCH_DURATION;
        (VmSafe.CallerMode mode, address msgSender,) = HEVM.readCallers();
        if (mode == VmSafe.CallerMode.None && msgSender != governance) {
            vm.prank(governance);
        }
        _setTlockDrandConfig(protocolConfig, DEFAULT_DRAND_CHAIN_HASH, DEFAULT_DRAND_GENESIS_TIME, DEFAULT_DRAND_PERIOD);
    }

    function _deployRaterRegistry(address admin) internal returns (RaterRegistry raterRegistry) {
        return _deployRaterRegistry(admin, admin);
    }

    function _deployRaterRegistry(address admin, address governance) internal returns (RaterRegistry raterRegistry) {
        raterRegistry = new RaterRegistry(
            admin,
            governance,
            address(new MockWorldIDVerifier()),
            42,
            uint256(keccak256("rateloop-human-credential-v4")),
            uint256(keccak256("rateloop-human-presence-v1")),
            365 days,
            15 minutes,
            7,
            0
        );
    }

    function _seedRaterIdentity(RaterRegistry raterRegistry, address account, bytes32 anchorId) internal {
        raterRegistry.seedHumanCredential(account, uint64(block.timestamp + 365 days), anchorId, keccak256("test-seed"));
    }

    function _setAcceptedDelegate(RaterRegistry raterRegistry, address holder, address delegate) internal {
        (VmSafe.CallerMode mode, address msgSender, address txOrigin) = HEVM.readCallers();
        bool hasActivePrank = mode == VmSafe.CallerMode.Prank || mode == VmSafe.CallerMode.RecurrentPrank;
        if (hasActivePrank) {
            HEVM.stopPrank();
        }
        HEVM.prank(holder);
        raterRegistry.setDelegate(delegate);
        HEVM.prank(delegate);
        raterRegistry.acceptDelegate();
        if (hasActivePrank) {
            HEVM.startPrank(msgSender, txOrigin);
        }
    }

    function _setTlockRoundConfig(
        ProtocolConfig protocolConfig,
        uint256 epochDuration,
        uint256 maxDuration,
        uint256 minVoters,
        uint256 maxVoters
    ) internal {
        protocolConfig.setConfig(epochDuration, maxDuration, minVoters, maxVoters);
        activeTlockProtocolConfig = protocolConfig;
        activeTlockEpochDuration = epochDuration;
    }

    function _setTlockDrandConfig(ProtocolConfig protocolConfig, bytes32 chainHash, uint64 genesisTime, uint64 period)
        internal
    {
        protocolConfig.setDrandConfig(chainHash, genesisTime, period);
        activeTlockProtocolConfig = protocolConfig;
        activeTlockDrandChainHash = chainHash;
        activeTlockDrandGenesisTime = genesisTime;
        activeTlockDrandPeriod = period;
    }

    /// @dev Build a structurally valid AGE/tlock envelope for tests. It is not a real decryptable tlock ciphertext.
    function _testCiphertext(bool isUp, bytes32 salt, uint256 contentId) internal view returns (bytes memory) {
        return _testCiphertext(isUp, salt, contentId, _tlockCommitTargetRound(), _tlockDrandChainHash());
    }

    /// @dev Build a structurally valid test ciphertext that embeds caller-supplied tlock metadata for branch tests.
    function _testCiphertext(bool isUp, bytes32 salt, uint256 contentId, uint64 targetRound, bytes32 drandChainHash)
        internal
        pure
        returns (bytes memory)
    {
        return _testCiphertextWithFiller(isUp, salt, contentId, targetRound, drandChainHash, 0);
    }

    function _testCiphertextWithFiller(
        bool isUp,
        bytes32 salt,
        uint256 contentId,
        uint64 targetRound,
        bytes32 drandChainHash,
        uint256 fillerLength
    ) internal pure returns (bytes memory ciphertext) {
        return _armoredTestCiphertext(
            _testCiphertextPayload(isUp, salt, contentId, targetRound, drandChainHash, fillerLength), true
        );
    }

    function _testCiphertextPayload(
        bool isUp,
        bytes32 salt,
        uint256 contentId,
        uint64 targetRound,
        bytes32 drandChainHash,
        uint256 fillerLength
    ) internal pure returns (bytes memory decodedPayload) {
        contentId; // Content binding lives in the commit hash, so the test payload only needs direction + salt.

        bytes memory targetRoundBytes = bytes(Strings.toString(targetRound));
        bytes memory chainHashHex = _bytes32Hex(drandChainHash);
        bytes memory saltHex = _bytes32Hex(salt);
        bytes memory filler = _filledBytes(fillerLength, bytes1("A"));
        bytes memory recipientBody = abi.encodePacked(
            bytes32(uint256(targetRound)),
            drandChainHash,
            bytes16(keccak256(abi.encodePacked(salt, fillerLength, isUp ? bytes1("u") : bytes1("d"))))
        );
        bytes memory encodedRecipientBody = _chunkedUnpaddedBase64(recipientBody);
        bytes memory encodedMac =
            _unpaddedBase64(abi.encodePacked(keccak256(abi.encodePacked(targetRound, drandChainHash, salt))));

        return abi.encodePacked(
            TEST_AGE_VERSION,
            TEST_TLOCK_LINE_PREFIX,
            targetRoundBytes,
            " ",
            chainHashHex,
            "\n",
            encodedRecipientBody,
            TEST_MAC_LINE_PREFIX,
            encodedMac,
            "\n",
            TEST_PAYLOAD_LINE_PREFIX,
            isUp ? bytes1("u") : bytes1("d"),
            ":",
            saltHex,
            "\n",
            filler
        );
    }

    /// @dev Build commit hash bound to the exact voter and ciphertext bytes used at commit time.
    function _commitHash(bool isUp, bytes32 salt, address voter, uint256 contentId) internal view returns (bytes32) {
        bytes memory ciphertext = _testCiphertext(isUp, salt, contentId);
        return _commitHash(
            isUp,
            salt,
            voter,
            contentId,
            _defaultTestCommitRoundId(contentId),
            _currentRatingReferenceBps(contentId),
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ciphertext
        );
    }

    /// @dev Legacy helper for tests that do not submit/reveal the commit.
    function _commitHash(bool isUp, bytes32 salt, uint256 contentId) internal view returns (bytes32) {
        return _commitHash(isUp, salt, address(this), contentId);
    }

    /// @dev Build commit hash for a caller-supplied ciphertext.
    function _commitHash(bool isUp, bytes32 salt, address voter, uint256 contentId, bytes memory ciphertext)
        internal
        view
        returns (bytes32)
    {
        return _commitHash(
            isUp,
            salt,
            voter,
            contentId,
            _defaultTestCommitRoundId(contentId),
            _currentRatingReferenceBps(contentId),
            _tlockCommitTargetRound(),
            _tlockDrandChainHash(),
            ciphertext
        );
    }

    /// @dev Legacy helper for tests that do not submit/reveal the commit.
    function _commitHash(bool isUp, bytes32 salt, uint256 contentId, bytes memory ciphertext)
        internal
        view
        returns (bytes32)
    {
        return _commitHash(isUp, salt, address(this), contentId, ciphertext);
    }

    function _buildTestCommitArtifacts(address voter, bool isUp, bytes32 salt, uint256 contentId)
        internal
        view
        returns (TestCommitArtifacts memory artifacts)
    {
        artifacts.roundId = _defaultTestCommitRoundId(contentId);
        artifacts.roundReferenceRatingBps = _currentRatingReferenceBps(contentId);
        artifacts.targetRound = _tlockCommitTargetRound();
        artifacts.drandChainHash = _tlockDrandChainHash();
        artifacts.ciphertext = _testCiphertext(isUp, salt, contentId, artifacts.targetRound, artifacts.drandChainHash);
        artifacts.ciphertextHash = keccak256(artifacts.ciphertext);
        artifacts.commitHash = _commitHash(
            isUp,
            salt,
            voter,
            contentId,
            artifacts.roundId,
            artifacts.roundReferenceRatingBps,
            artifacts.targetRound,
            artifacts.drandChainHash,
            artifacts.ciphertext
        );
        artifacts.commitKey = _commitKey(voter, artifacts.commitHash);
    }

    function _commitTestVote(DirectTestCommitRequest memory request) internal returns (bytes32 commitKey) {
        _openRoundForTest(request.engine, request.contentId, request.voter);
        TestCommitArtifacts memory artifacts = _buildTestCommitArtifacts(
            address(request.engine), request.voter, request.isUp, request.salt, request.contentId
        );
        uint256 currentRoundId = request.engine.currentRoundId(request.contentId);
        if (currentRoundId != 0 && currentRoundId != artifacts.roundId) {
            artifacts.roundId = currentRoundId;
            uint16 roundReferenceRatingBps =
                _roundReferenceRatingBpsForRound(request.engine, request.contentId, currentRoundId);
            if (roundReferenceRatingBps != 0) {
                artifacts.roundReferenceRatingBps = roundReferenceRatingBps;
            }
            artifacts.commitHash = _commitHash(
                request.isUp,
                request.salt,
                request.voter,
                request.contentId,
                artifacts.roundId,
                artifacts.roundReferenceRatingBps,
                artifacts.targetRound,
                artifacts.drandChainHash,
                artifacts.ciphertext
            );
            artifacts.commitKey = _commitKey(request.voter, artifacts.commitHash);
        }

        vm.startPrank(request.voter);
        request.lrepToken.approve(address(request.engine), request.stake);
        request.engine
            .commitVote(
                request.contentId,
                _roundContext(artifacts.roundId, artifacts.roundReferenceRatingBps),
                artifacts.targetRound,
                artifacts.drandChainHash,
                artifacts.commitHash,
                artifacts.ciphertext,
                request.stake,
                request.frontend
            );
        vm.stopPrank();

        _rememberTestReveal(artifacts.commitKey, request.isUp, request.salt);
        return artifacts.commitKey;
    }

    function _openRoundForTest(RoundVotingEngine engine, uint256 contentId, address opener) internal {
        vm.prank(opener);
        engine.openRound(contentId);
    }

    function _rememberTestReveal(bytes32 commitKey, bool isUp, bytes32 salt) internal {
        testRevealPayloads[commitKey] = TestRevealPayload({ exists: true, isUp: isUp, salt: salt });
    }

    function _testRevealPayload(bytes32 commitKey) internal view returns (bool isUp, bytes32 salt, bool exists) {
        TestRevealPayload memory payload = testRevealPayloads[commitKey];
        return (payload.isUp, payload.salt, payload.exists);
    }

    function _tlockCommitTargetRound() internal view returns (uint64) {
        return _roundAtOrAfter(block.timestamp + _tlockEpochDuration(), _tlockDrandGenesisTime(), _tlockDrandPeriod());
    }

    function _tlockCommitTargetRound(RoundVotingEngine engine, uint256 contentId) internal view returns (uint64) {
        return _tlockTargetRoundAt(_commitEpochEnd(engine, contentId));
    }

    function _commitEpochEnd(RoundVotingEngine engine, uint256 contentId) internal view returns (uint256) {
        uint256 roundId = _previewCommitRoundId(engine, contentId);
        (uint48 startTime,,,,,,) = engine.roundCore(contentId, roundId);
        uint256 epochDuration = _tlockEpochDuration();
        if (startTime == 0) {
            return block.timestamp + epochDuration;
        }

        uint256 elapsed = block.timestamp - uint256(startTime);
        uint256 epochIdx = elapsed / epochDuration;
        return uint256(startTime) + (epochIdx + 1) * epochDuration;
    }

    function _tlockTargetRoundAt(uint256 revealableAfter) internal view returns (uint64) {
        return _roundAtOrAfter(revealableAfter, _tlockDrandGenesisTime(), _tlockDrandPeriod());
    }

    function _tlockRoundTimestamp(uint64 targetRound) internal view returns (uint256) {
        if (targetRound == 0) return 0;
        return uint256(_tlockDrandGenesisTime()) + (uint256(targetRound) - 1) * uint256(_tlockDrandPeriod());
    }

    function _warpPastTlockRevealTime(uint256 revealableAfter) internal {
        uint64 targetRound = _tlockTargetRoundAt(revealableAfter);
        uint256 revealableAt = _tlockRoundTimestamp(targetRound);
        if (block.timestamp <= revealableAt) {
            vm.warp(revealableAt + 1);
        }
    }

    function _settleAfterRbtsSeed(RoundVotingEngine engine, uint256 contentId, uint256 roundId) internal {
        uint256 seedBlock = block.number + 1;
        vm.roll(seedBlock);
        engine.settleRound(contentId, roundId);
        RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, contentId, roundId);
        if (round.state != RoundLib.RoundState.Open) return;
        vm.roll(seedBlock + 1);
        engine.settleRound(contentId, roundId);
    }

    function _tlockDrandChainHash() internal view virtual returns (bytes32) {
        return activeTlockDrandChainHash;
    }

    function _tlockDrandGenesisTime() internal view virtual returns (uint64) {
        return activeTlockDrandGenesisTime;
    }

    function _tlockDrandPeriod() internal view virtual returns (uint64) {
        return activeTlockDrandPeriod;
    }

    function _activeSubmissionProtocolConfig() internal view override returns (ProtocolConfig) {
        return activeTlockProtocolConfig;
    }

    function _tlockEpochDuration() internal view virtual returns (uint256) {
        return activeTlockEpochDuration;
    }

    function _roundAt(uint256 timestamp, uint64 genesisTime, uint64 period) internal pure returns (uint64) {
        if (period == 0 || timestamp < genesisTime) return 0;
        return uint64(((timestamp - genesisTime) / period) + 1);
    }

    function _roundAtOrAfter(uint256 timestamp, uint64 genesisTime, uint64 period) internal pure returns (uint64) {
        if (period == 0 || timestamp < genesisTime) return 0;
        uint256 elapsed = timestamp - genesisTime;
        return uint64(((elapsed + uint256(period) - 1) / uint256(period)) + 1);
    }

    function _commitHash(
        bool isUp,
        bytes32 salt,
        address voter,
        uint256 contentId,
        uint64 targetRound,
        bytes32 drandChainHash,
        bytes memory ciphertext
    ) internal view returns (bytes32) {
        return _commitHash(
            isUp,
            salt,
            voter,
            contentId,
            _defaultTestCommitRoundId(contentId),
            _currentRatingReferenceBps(contentId),
            targetRound,
            drandChainHash,
            ciphertext
        );
    }

    /// @dev Legacy helper for tests that do not submit/reveal the commit.
    function _commitHash(
        bool isUp,
        bytes32 salt,
        uint256 contentId,
        uint64 targetRound,
        bytes32 drandChainHash,
        bytes memory ciphertext
    ) internal view returns (bytes32) {
        return _commitHash(isUp, salt, address(this), contentId, targetRound, drandChainHash, ciphertext);
    }

    function _commitHash(
        bool isUp,
        bytes32 salt,
        address voter,
        uint256 contentId,
        uint16 roundReferenceRatingBps,
        uint64 targetRound,
        bytes32 drandChainHash,
        bytes memory ciphertext
    ) internal pure returns (bytes32) {
        return _commitHash(
            isUp, salt, voter, contentId, 1, roundReferenceRatingBps, targetRound, drandChainHash, ciphertext
        );
    }

    function _commitHash(
        bool isUp,
        bytes32 salt,
        address voter,
        uint256 contentId,
        uint256 roundId,
        uint16 roundReferenceRatingBps,
        uint64 targetRound,
        bytes32 drandChainHash,
        bytes memory ciphertext
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                isUp,
                uint16(5_000),
                salt,
                voter,
                contentId,
                roundId,
                roundReferenceRatingBps,
                targetRound,
                drandChainHash,
                keccak256(ciphertext)
            )
        );
    }

    /// @dev Legacy helper for tests that do not submit/reveal the commit.
    function _commitHash(
        bool isUp,
        bytes32 salt,
        uint256 contentId,
        uint16 roundReferenceRatingBps,
        uint64 targetRound,
        bytes32 drandChainHash,
        bytes memory ciphertext
    ) internal pure returns (bytes32) {
        return _commitHash(
            isUp, salt, address(0), contentId, 1, roundReferenceRatingBps, targetRound, drandChainHash, ciphertext
        );
    }

    function _buildTestCommitArtifacts(address engine, address voter, bool isUp, bytes32 salt, uint256 contentId)
        internal
        view
        returns (TestCommitArtifacts memory artifacts)
    {
        artifacts = _buildTestCommitArtifacts(voter, isUp, salt, contentId);
        artifacts.roundId = _previewTestCommitRoundId(engine, contentId);
        if (engine != address(0)) {
            artifacts.targetRound = _tlockCommitTargetRound(RoundVotingEngine(engine), contentId);
            artifacts.ciphertext =
                _testCiphertext(isUp, salt, contentId, artifacts.targetRound, artifacts.drandChainHash);
        }
        artifacts.commitHash = _commitHash(
            isUp,
            salt,
            voter,
            contentId,
            artifacts.roundId,
            artifacts.roundReferenceRatingBps,
            artifacts.targetRound,
            artifacts.drandChainHash,
            artifacts.ciphertext
        );
        artifacts.commitKey = _commitKey(voter, artifacts.commitHash);
    }

    function _previewTestCommitRoundId(address engine, uint256 contentId) internal view returns (uint256) {
        if (engine != address(0)) {
            return _previewCommitRoundId(RoundVotingEngine(engine), contentId);
        }

        return _defaultTestCommitRoundId(contentId);
    }

    function _previewCommitRoundId(RoundVotingEngine engine, uint256 contentId)
        internal
        view
        returns (uint256 roundId)
    {
        (roundId,) = engine.previewCommitContext(contentId);
    }

    function _previewCommitReferenceRatingBps(RoundVotingEngine engine, uint256 contentId)
        internal
        view
        returns (uint16 referenceRatingBps)
    {
        (, referenceRatingBps) = engine.previewCommitContext(contentId);
    }

    function _defaultTestCommitRoundId(uint256) internal view virtual returns (uint256) {
        return 1;
    }

    function _currentRatingReferenceBps(uint256 contentId) internal view returns (uint16) {
        if (address(activeTlockContentRegistry) == address(0)) {
            return RatingLib.DEFAULT_RATING_BPS;
        }

        return activeTlockContentRegistry.getRating(contentId);
    }

    function _defaultRatingReferenceBps() internal pure returns (uint16) {
        return RatingLib.DEFAULT_RATING_BPS;
    }

    function _roundContext(uint256 roundId, uint16 referenceRatingBps) internal pure returns (uint256) {
        return (roundId << 16) | uint256(referenceRatingBps);
    }

    function _decodeTestCiphertext(bytes memory ciphertext) internal pure returns (bool isUp, bytes32 salt) {
        bytes memory decodedPayload = _decodeTestAgePayload(ciphertext);
        uint256 lineStart = _findMarker(decodedPayload, TEST_PAYLOAD_LINE_PREFIX);
        if (lineStart == type(uint256).max) revert("Missing test-payload");

        uint256 offset = lineStart + TEST_PAYLOAD_LINE_PREFIX.length;
        bytes1 direction = decodedPayload[offset];
        if (direction == bytes1("u")) {
            isUp = true;
        } else if (direction == bytes1("d")) {
            isUp = false;
        } else {
            revert("Invalid test-direction");
        }

        if (offset + 66 >= decodedPayload.length || decodedPayload[offset + 1] != bytes1(":")) {
            revert("Invalid test-direction");
        }
        salt = _readHexBytes32(decodedPayload, offset + 2);
    }

    function _decodeTestAgePayload(bytes memory ciphertext) private pure returns (bytes memory) {
        if (!_hasPrefix(ciphertext, TEST_AGE_HEADER) || !_hasSuffix(ciphertext, TEST_AGE_FOOTER)) {
            revert("Invalid test ciphertext");
        }

        uint256 payloadStart = TEST_AGE_HEADER.length;
        uint256 payloadEnd = ciphertext.length - TEST_AGE_FOOTER.length;
        return _decodeBase64(ciphertext, payloadStart, payloadEnd);
    }

    function _findMarker(bytes memory haystack, bytes memory needle) private pure returns (uint256) {
        if (needle.length == 0 || haystack.length < needle.length) return type(uint256).max;

        for (uint256 i = 0; i <= haystack.length - needle.length; i++) {
            bool matches = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    matches = false;
                    break;
                }
            }
            if (matches) return i;
        }

        return type(uint256).max;
    }

    function _readHexBytes32(bytes memory data, uint256 start) private pure returns (bytes32) {
        if (start + 64 > data.length) revert("Invalid test-salt length");

        uint256 value = 0;
        for (uint256 i = 0; i < 64; i++) {
            value = (value << 4) | _hexNibble(data[start + i]);
        }

        return bytes32(value);
    }

    function _hexNibble(bytes1 ch) private pure returns (uint256) {
        uint8 code = uint8(ch);
        if (code >= uint8(bytes1("0")) && code <= uint8(bytes1("9"))) return code - uint8(bytes1("0"));
        if (code >= uint8(bytes1("a")) && code <= uint8(bytes1("f"))) return 10 + code - uint8(bytes1("a"));
        if (code >= uint8(bytes1("A")) && code <= uint8(bytes1("F"))) return 10 + code - uint8(bytes1("A"));
        revert("Invalid hex nibble");
    }

    function _copyBytes(bytes memory target, uint256 offset, bytes memory source) private pure returns (uint256) {
        for (uint256 i = 0; i < source.length; i++) {
            target[offset + i] = source[i];
        }
        return offset + source.length;
    }

    function _writeHexBytes32(bytes memory target, uint256 offset, bytes32 value) private pure {
        for (uint256 i = 0; i < 32; i++) {
            uint8 byteValue = uint8(value[i]);
            target[offset + (i * 2)] = _hexChar(byteValue >> 4);
            target[offset + (i * 2) + 1] = _hexChar(byteValue & 0x0f);
        }
    }

    function _hexChar(uint8 nibble) private pure returns (bytes1) {
        return nibble < 10 ? bytes1(nibble + uint8(bytes1("0"))) : bytes1(nibble + 87);
    }

    function _bytes32Hex(bytes32 value) internal pure returns (bytes memory encoded) {
        encoded = new bytes(64);
        _writeHexBytes32(encoded, 0, value);
    }

    function _filledBytes(uint256 length, bytes1 fill) private pure returns (bytes memory buffer) {
        buffer = new bytes(length);
        for (uint256 i = 0; i < length; i++) {
            buffer[i] = fill;
        }
    }

    function _armoredTestCiphertext(bytes memory decodedPayload, bool newlineAfterHeader)
        internal
        pure
        returns (bytes memory)
    {
        bytes memory encodedPayload = _chunkBase64(bytes(Base64.encode(decodedPayload)));
        if (newlineAfterHeader) {
            return abi.encodePacked(TEST_AGE_HEADER, encodedPayload, "\n", TEST_AGE_FOOTER);
        }
        return abi.encodePacked(TEST_AGE_HEADER_RAW, encodedPayload, "\n", TEST_AGE_FOOTER);
    }

    function _chunkedUnpaddedBase64(bytes memory raw) private pure returns (bytes memory) {
        return abi.encodePacked(_chunkBase64(_unpaddedBase64(raw)), "\n");
    }

    function _unpaddedBase64(bytes memory raw) private pure returns (bytes memory encoded) {
        encoded = bytes(Base64.encode(raw));
        uint256 trimmedLength = encoded.length;
        while (trimmedLength > 0 && encoded[trimmedLength - 1] == bytes1("=")) {
            trimmedLength--;
        }

        bytes memory trimmed = new bytes(trimmedLength);
        for (uint256 i = 0; i < trimmedLength; i++) {
            trimmed[i] = encoded[i];
        }
        return trimmed;
    }

    function _chunkBase64(bytes memory encoded) private pure returns (bytes memory chunked) {
        if (encoded.length == 0) return bytes("");

        uint256 lineCount = (encoded.length + TEST_AGE_LINE_CHUNK_SIZE - 1) / TEST_AGE_LINE_CHUNK_SIZE;
        chunked = new bytes(encoded.length + (lineCount - 1));

        uint256 src = 0;
        uint256 dst = 0;
        while (src < encoded.length) {
            uint256 lineLength = encoded.length - src;
            if (lineLength > TEST_AGE_LINE_CHUNK_SIZE) {
                lineLength = TEST_AGE_LINE_CHUNK_SIZE;
            }

            for (uint256 i = 0; i < lineLength; i++) {
                chunked[dst++] = encoded[src++];
            }

            if (src < encoded.length) {
                chunked[dst++] = bytes1("\n");
            }
        }
    }

    function _hasPrefix(bytes memory data, bytes memory prefix) private pure returns (bool) {
        if (data.length < prefix.length) return false;
        for (uint256 i = 0; i < prefix.length; i++) {
            if (data[i] != prefix[i]) return false;
        }
        return true;
    }

    function _hasSuffix(bytes memory data, bytes memory suffix) private pure returns (bool) {
        if (data.length < suffix.length) return false;
        uint256 start = data.length - suffix.length;
        for (uint256 i = 0; i < suffix.length; i++) {
            if (data[start + i] != suffix[i]) return false;
        }
        return true;
    }

    function _decodeBase64(bytes memory data, uint256 start, uint256 end) private pure returns (bytes memory out) {
        bytes memory clean = _stripBase64Whitespace(data, start, end);
        if (clean.length == 0 || clean.length % 4 != 0) revert("Invalid test ciphertext");

        uint256 padding = 0;
        if (clean[clean.length - 1] == "=") padding++;
        if (clean.length > 1 && clean[clean.length - 2] == "=") padding++;

        out = new bytes((clean.length / 4) * 3 - padding);
        uint256 outIndex = 0;

        for (uint256 i = 0; i < clean.length; i += 4) {
            bytes1 third = clean[i + 2];
            bytes1 fourth = clean[i + 3];
            if (third == "=" && fourth != "=") revert("Invalid test ciphertext");

            uint24 chunk = (uint24(_base64Value(clean[i])) << 18) | (uint24(_base64Value(clean[i + 1])) << 12);
            if (third != "=") {
                chunk |= uint24(_base64Value(third)) << 6;
            }
            if (fourth != "=") {
                chunk |= uint24(_base64Value(fourth));
            }

            out[outIndex++] = bytes1(uint8(chunk >> 16));
            if (third != "=") {
                out[outIndex++] = bytes1(uint8(chunk >> 8));
            }
            if (fourth != "=") {
                out[outIndex++] = bytes1(uint8(chunk));
            }
        }
    }

    function _stripBase64Whitespace(bytes memory data, uint256 start, uint256 end)
        private
        pure
        returns (bytes memory clean)
    {
        uint256 cleanLength = 0;
        for (uint256 i = start; i < end; i++) {
            bytes1 ch = data[i];
            if (ch == 0x0a || ch == 0x0d) continue;
            if (!_isBase64Char(ch) && ch != "=") revert("Invalid test ciphertext");
            cleanLength++;
        }

        clean = new bytes(cleanLength);
        uint256 outIndex = 0;
        for (uint256 i = start; i < end; i++) {
            bytes1 ch = data[i];
            if (ch == 0x0a || ch == 0x0d) continue;
            clean[outIndex++] = ch;
        }
    }

    function _base64Value(bytes1 ch) private pure returns (uint8) {
        uint8 code = uint8(ch);
        if (code >= 65 && code <= 90) return code - 65;
        if (code >= 97 && code <= 122) return 26 + code - 97;
        if (code >= 48 && code <= 57) return 52 + code - 48;
        if (code == 43) return 62;
        if (code == 47) return 63;
        revert("Invalid test ciphertext");
    }

    function _isBase64Char(bytes1 ch) private pure returns (bool) {
        uint8 code = uint8(ch);
        return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code == 43
            || code == 47;
    }

    /// @dev Build commit key: keccak256(abi.encodePacked(voter, commitHash)).
    function _commitKey(address voter, bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(voter, hash));
    }

    function _roundRbtsScored(RoundVotingEngine engine, uint256 contentId, uint256 roundId)
        internal
        view
        returns (bool scored)
    {
        (scored,,,,) = engine.rbtsRoundState(contentId, roundId);
    }

    function _roundRbtsScoringClosed(RoundVotingEngine engine, uint256 contentId, uint256 roundId)
        internal
        view
        returns (bool closed)
    {
        (,,,,, closed,) = engine.advisoryRoundContext(contentId, roundId, 0);
    }

    function _roundReferenceRatingBpsForRound(RoundVotingEngine engine, uint256 contentId, uint256 roundId)
        internal
        view
        returns (uint16 referenceRatingBps)
    {
        (referenceRatingBps,,,,,,) = engine.advisoryRoundContext(contentId, roundId, 0);
    }

    function _targetRoundRevealableTimestamp(
        RoundVotingEngine engine,
        uint256 contentId,
        uint256 roundId,
        uint64 targetRound
    ) internal view returns (uint256 targetRevealableAt) {
        (, targetRevealableAt,,,,,) = engine.advisoryRoundContext(contentId, roundId, targetRound);
    }

    function _roundDrandConfig(RoundVotingEngine engine, uint256 contentId, uint256 roundId)
        internal
        view
        returns (bytes32 chainHash, uint64 genesisTime, uint64 period)
    {
        (,, chainHash, genesisTime, period,,) = engine.advisoryRoundContext(contentId, roundId, 0);
    }

    function _roundRbtsScoreSeed(RoundVotingEngine engine, uint256 contentId, uint256 roundId)
        internal
        view
        returns (bytes32 scoreSeed)
    {
        (, scoreSeed,,,) = engine.rbtsRoundState(contentId, roundId);
    }

    function _roundRbtsRewardWeight(RoundVotingEngine engine, uint256 contentId, uint256 roundId)
        internal
        view
        returns (uint256 rewardWeight)
    {
        (,, rewardWeight,,) = engine.rbtsRoundState(contentId, roundId);
    }

    function _roundRbtsRewardClaimants(RoundVotingEngine engine, uint256 contentId, uint256 roundId)
        internal
        view
        returns (uint256 rewardClaimants)
    {
        (,,, rewardClaimants,) = engine.rbtsRoundState(contentId, roundId);
    }

    function _roundVoterPool(RoundVotingEngine engine, uint256 contentId, uint256 roundId)
        internal
        view
        returns (uint256 voterPool)
    {
        (,,,, voterPool) = engine.rbtsRoundState(contentId, roundId);
    }

    function _lastCommitRevealableAfter(RoundVotingEngine engine, uint256 contentId, uint256 roundId)
        internal
        view
        returns (uint256 lastRevealableAfter)
    {
        (, lastRevealableAfter,,) = engine.roundLifecycleState(contentId, roundId);
    }

    function _roundUnrevealedCleanupRemaining(RoundVotingEngine engine, uint256 contentId, uint256 roundId)
        internal
        view
        returns (uint256 cleanupRemaining)
    {
        (,, cleanupRemaining,) = engine.roundLifecycleState(contentId, roundId);
    }

    function _roundClusterPayoutReadyAt(RoundVotingEngine engine, uint256 contentId, uint256 roundId)
        internal
        view
        returns (uint48 readyAt)
    {
        (,,, readyAt) = engine.roundLifecycleState(contentId, roundId);
    }

    function _commitPredictedUpBps(RoundVotingEngine engine, uint256 contentId, uint256 roundId, bytes32 commitKey)
        internal
        view
        returns (uint16 predictedUpBps)
    {
        (predictedUpBps,,,,) = engine.rbtsCommitState(contentId, roundId, commitKey);
    }

    function _commitRbtsScoreBps(RoundVotingEngine engine, uint256 contentId, uint256 roundId, bytes32 commitKey)
        internal
        view
        returns (uint16 scoreBps)
    {
        (, scoreBps,,,) = engine.rbtsCommitState(contentId, roundId, commitKey);
    }

    function _commitRbtsScoringWeight(RoundVotingEngine engine, uint256 contentId, uint256 roundId, bytes32 commitKey)
        internal
        view
        returns (uint256 scoringWeight)
    {
        (,, scoringWeight,,) = engine.rbtsCommitState(contentId, roundId, commitKey);
    }

    function _commitRbtsRewardWeight(RoundVotingEngine engine, uint256 contentId, uint256 roundId, bytes32 commitKey)
        internal
        view
        returns (uint256 rewardWeight)
    {
        (,,, rewardWeight,) = engine.rbtsCommitState(contentId, roundId, commitKey);
    }

    function _commitRbtsStakeReturned(RoundVotingEngine engine, uint256 contentId, uint256 roundId, bytes32 commitKey)
        internal
        view
        returns (uint256 stakeReturned)
    {
        (,,,, stakeReturned) = engine.rbtsCommitState(contentId, roundId, commitKey);
    }

    function _roundFrontendPool(RoundVotingEngine engine, uint256 contentId, uint256 roundId)
        internal
        view
        returns (uint256 totalFrontendPool)
    {
        (totalFrontendPool,,,) = engine.frontendFeeState(contentId, roundId, address(0));
    }

    function _roundStakeWithEligibleFrontend(RoundVotingEngine engine, uint256 contentId, uint256 roundId)
        internal
        view
        returns (uint256 totalEligibleStake)
    {
        (,, totalEligibleStake,) = engine.frontendFeeState(contentId, roundId, address(0));
    }

    function _voterCommitHash(RoundVotingEngine engine, uint256 contentId, uint256 roundId, address voter)
        internal
        view
        returns (bytes32 commitHash)
    {
        (commitHash,) = engine.voterCommitKey(contentId, roundId, voter);
    }

    function _identityCommitKey(RoundVotingEngine engine, uint256 contentId, uint256 roundId, bytes32 identityKey)
        internal
        view
        returns (bytes32 commitKey)
    {
        (commitKey,,) = engine.identityCommitState(contentId, roundId, identityKey, address(0));
    }

    function _holderCommitKey(RoundVotingEngine engine, uint256 contentId, uint256 roundId, address holder)
        internal
        view
        returns (bytes32 commitKey)
    {
        (, commitKey,) = engine.identityCommitState(contentId, roundId, bytes32(0), holder);
    }

    function _identityRoundStake(RoundVotingEngine engine, uint256 contentId, uint256 roundId, bytes32 identityKey)
        internal
        view
        returns (uint256 stake)
    {
        (,, stake) = engine.identityCommitState(contentId, roundId, identityKey, address(0));
    }

    function _commitIdentityKey(RoundVotingEngine engine, uint256 contentId, uint256 roundId, bytes32 commitKey)
        internal
        view
        returns (bytes32 identityKey)
    {
        (identityKey,,,,,) = engine.commitIdentityState(contentId, roundId, commitKey);
    }

    function _commitIdentityHolder(RoundVotingEngine engine, uint256 contentId, uint256 roundId, bytes32 commitKey)
        internal
        view
        returns (address holder)
    {
        (, holder,,,,) = engine.commitIdentityState(contentId, roundId, commitKey);
    }

    function _commitCommittedAt(RoundVotingEngine engine, uint256 contentId, uint256 roundId, bytes32 commitKey)
        internal
        view
        returns (uint48 committedAt)
    {
        (,, committedAt,,,) = engine.commitIdentityState(contentId, roundId, commitKey);
    }

    function _commitCredentialMask(RoundVotingEngine engine, uint256 contentId, uint256 roundId, bytes32 commitKey)
        internal
        view
        returns (uint8 credentialMask)
    {
        (,,, credentialMask,,) = engine.commitIdentityState(contentId, roundId, commitKey);
    }

    function _commitFreshCredentialMask(RoundVotingEngine engine, uint256 contentId, uint256 roundId, bytes32 commitKey)
        internal
        view
        returns (uint8 freshCredentialMask)
    {
        (,,,, freshCredentialMask,) = engine.commitIdentityState(contentId, roundId, commitKey);
    }

    function _commitFrontendEligible(RoundVotingEngine engine, uint256 contentId, uint256 roundId, bytes32 commitKey)
        internal
        view
        returns (bool frontendEligible)
    {
        (,,,,, frontendEligible) = engine.commitIdentityState(contentId, roundId, commitKey);
    }
}
