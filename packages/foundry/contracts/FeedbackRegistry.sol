// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { RoundVotingEngine } from "./RoundVotingEngine.sol";
import { RoundLib } from "./libraries/RoundLib.sol";
import { IFeedbackRegistry } from "./interfaces/IFeedbackRegistry.sol";

/// @title FeedbackRegistry
/// @notice Canonical on-chain anchor for rater feedback used by public reads and feedback-bonus awards.
contract FeedbackRegistry is IFeedbackRegistry, Initializable, AccessControlUpgradeable {
    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");
    bytes32 public constant CONTENT_FEEDBACK_HASH_DOMAIN = keccak256("rateloop.content-feedback.v1");

    uint256 public constant MAX_FEEDBACK_TYPE_LENGTH = 32;
    uint256 public constant MAX_FEEDBACK_BODY_LENGTH = 1600;
    uint256 public constant MAX_SOURCE_URL_LENGTH = 2048;

    struct FeedbackRecord {
        bytes32 feedbackHash;
        address author;
        uint48 committedAt;
        uint48 revealedAt;
        RoundVotingEngine votingEngineSnapshot;
    }

    RoundVotingEngine public votingEngine;

    mapping(uint256 => mapping(uint256 => mapping(bytes32 => FeedbackRecord))) public feedbackByCommitKey;

    uint256[49] private __gap;

    event VotingEngineUpdated(address votingEngine);
    event FeedbackPublished(
        uint256 indexed contentId,
        uint256 indexed roundId,
        bytes32 indexed commitKey,
        address author,
        bytes32 feedbackHash,
        string feedbackType,
        string body,
        string sourceUrl,
        bytes32 clientNonce
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address governance, address votingEngine_) external initializer {
        require(admin != address(0), "Invalid admin");
        require(governance != address(0), "Invalid governance");
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, governance);
        _grantRole(CONFIG_ROLE, governance);
        if (admin != governance) {
            _grantRole(CONFIG_ROLE, admin);
        }
        _setVotingEngine(votingEngine_);
    }

    function publishFeedback(
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        string calldata feedbackType,
        string calldata body,
        string calldata sourceUrl,
        bytes32 clientNonce
    ) external {
        RoundVotingEngine engine = votingEngine;
        require(_roundState(engine, contentId, roundId) == RoundLib.RoundState.Open, "Round not open");
        address author = _requireCommitAuthor(engine, contentId, roundId, commitKey);
        require(bytes(feedbackType).length > 0 && bytes(feedbackType).length <= MAX_FEEDBACK_TYPE_LENGTH, "Bad type");
        require(bytes(body).length > 0 && bytes(body).length <= MAX_FEEDBACK_BODY_LENGTH, "Bad body");
        require(bytes(sourceUrl).length <= MAX_SOURCE_URL_LENGTH, "Source too long");

        FeedbackRecord storage record = feedbackByCommitKey[contentId][roundId][commitKey];
        require(record.feedbackHash == bytes32(0), "Feedback already published");
        bytes32 feedbackHash =
            buildContentFeedbackHash(contentId, roundId, author, feedbackType, body, sourceUrl, clientNonce);
        record.feedbackHash = feedbackHash;
        record.author = author;
        record.committedAt = uint48(block.timestamp);
        record.revealedAt = uint48(block.timestamp);
        record.votingEngineSnapshot = engine;

        emit FeedbackPublished(
            contentId, roundId, commitKey, author, feedbackHash, feedbackType, body, sourceUrl, clientNonce
        );
    }

    function isAwardableFeedback(uint256 contentId, uint256 roundId, bytes32 commitKey, bytes32 feedbackHash)
        external
        view
        returns (bool)
    {
        FeedbackRecord storage record = feedbackByCommitKey[contentId][roundId][commitKey];
        return _isAwardableFeedback(record, feedbackHash);
    }

    function awardableFeedbackPublishedAt(uint256 contentId, uint256 roundId, bytes32 commitKey, bytes32 feedbackHash)
        external
        view
        returns (uint256 publishedAt)
    {
        FeedbackRecord storage record = feedbackByCommitKey[contentId][roundId][commitKey];
        if (!_isAwardableFeedback(record, feedbackHash)) return 0;
        return uint256(record.revealedAt);
    }

    function buildContentFeedbackHash(
        uint256 contentId,
        uint256 roundId,
        address author,
        string calldata feedbackType,
        string calldata body,
        string calldata sourceUrl,
        bytes32 clientNonce
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                "rateloop.content-feedback.v1",
                block.chainid,
                contentId,
                roundId,
                author,
                feedbackType,
                keccak256(bytes(body)),
                keccak256(bytes(sourceUrl)),
                clientNonce
            )
        );
    }

    function _setVotingEngine(address votingEngine_) internal {
        require(votingEngine_ != address(0) && votingEngine_.code.length != 0, "Invalid engine");
        votingEngine = RoundVotingEngine(votingEngine_);
        emit VotingEngineUpdated(votingEngine_);
    }

    function _requireCommitAuthor(RoundVotingEngine engine, uint256 contentId, uint256 roundId, bytes32 commitKey)
        internal
        view
        returns (address author)
    {
        (address committedVoter,,,,,,) = engine.commitCore(contentId, roundId, commitKey);
        require(committedVoter != address(0), "No commit");
        if (committedVoter == msg.sender) {
            return msg.sender;
        }

        (, bytes32 senderCommitKey) = engine.voterCommitKey(contentId, roundId, msg.sender);
        require(senderCommitKey == commitKey, "Only commit voter");
        return msg.sender;
    }

    function _roundState(RoundVotingEngine engine, uint256 contentId, uint256 roundId)
        internal
        view
        returns (RoundLib.RoundState state)
    {
        (, state,,,,,,) = engine.roundCore(contentId, roundId);
    }

    function _isAwardableFeedback(FeedbackRecord storage record, bytes32 feedbackHash) private view returns (bool) {
        return record.revealedAt != 0 && record.feedbackHash == feedbackHash;
    }
}
