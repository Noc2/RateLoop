// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import { ContentRegistry } from "./ContentRegistry.sol";
import { FeedbackBonusEscrow } from "./FeedbackBonusEscrow.sol";
import { Eip3009Authorization, IReceiveWithAuthorizationToken } from "./interfaces/IEip3009.sol";
import { IConfidentialityEscrow } from "./interfaces/IConfidentialityEscrow.sol";
import { RoundLib } from "./libraries/RoundLib.sol";

interface IFeedbackBonusEscrowConfigShape {
    function registry() external view returns (ContentRegistry);
    function usdcToken() external view returns (IERC20);
    function votingEngine() external view returns (address);
}

contract X402QuestionSubmitter is Ownable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint8 internal constant REWARD_ASSET_USDC = 1;
    bytes32 internal constant X402_QUESTION_PAYMENT_DOMAIN = keccak256("rateloop-x402-question-payment-v3");
    bytes32 internal constant X402_QUESTION_ONE_SHOT_PAYMENT_DOMAIN =
        keccak256("rateloop-x402-question-one-shot-payment-v4");

    struct FeedbackBonusTerms {
        uint256 amount;
        uint256 feedbackClosesAt;
        address awarder;
    }

    ContentRegistry public immutable registry;
    IERC20 public immutable usdcToken;
    address public questionRewardPoolEscrow;
    address public feedbackBonusEscrow;

    event X402QuestionSubmitted(
        uint256 indexed contentId, address indexed submitter, bytes32 indexed paymentNonce, uint256 amount
    );
    event X402FeedbackBonusAttached(
        uint256 indexed contentId,
        uint256 indexed feedbackBonusPoolId,
        address indexed funder,
        uint256 amount,
        uint256 feedbackClosesAt,
        address awarder
    );
    event QuestionRewardPoolEscrowUpdated(address indexed previousEscrow, address indexed currentEscrow);
    event FeedbackBonusEscrowUpdated(address indexed previousEscrow, address indexed currentEscrow);

    constructor(
        ContentRegistry _registry,
        address _usdcToken,
        address _questionRewardPoolEscrow,
        address _feedbackBonusEscrow,
        address initialOwner
    ) Ownable(initialOwner) {
        require(address(_registry) != address(0), "Invalid registry");
        require(_usdcToken != address(0), "Invalid USDC");
        require(_questionRewardPoolEscrow != address(0), "Invalid escrow");
        registry = _registry;
        usdcToken = IERC20(_usdcToken);
        questionRewardPoolEscrow = _questionRewardPoolEscrow;
        if (_feedbackBonusEscrow != address(0)) _requireFeedbackBonusEscrowShape(_feedbackBonusEscrow);
        feedbackBonusEscrow = _feedbackBonusEscrow;
    }

    function setQuestionRewardPoolEscrow(address newEscrow) external onlyOwner {
        require(newEscrow != address(0), "Invalid escrow");
        require(registry.questionRewardPoolEscrow() == newEscrow, "Stale escrow");
        _setQuestionRewardPoolEscrow(newEscrow);
    }

    function setFeedbackBonusEscrow(address newEscrow) external onlyOwner {
        _requireFeedbackBonusEscrowShape(newEscrow);
        _setFeedbackBonusEscrow(newEscrow);
    }

    /// @notice Recover ERC-20 tokens accidentally sent to this contract.
    /// @dev Owner-only. The gateway has no business holding any token balance between
    ///      payment and forward — any residue is by definition a mistake.
    function rescueToken(IERC20 token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "zero recipient");
        token.safeTransfer(to, amount);
    }

    function submitQuestionWithX402Payment(
        string memory contextUrl,
        string[] memory imageUrls,
        string memory videoUrl,
        string memory title,
        string memory tags,
        uint256 categoryId,
        ContentRegistry.SubmissionDetails memory details,
        bytes32 salt,
        ContentRegistry.SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig,
        ContentRegistry.QuestionSpecCommitment memory spec,
        Eip3009Authorization calldata paymentAuthorization
    ) external nonReentrant returns (uint256 contentId) {
        return _submitQuestionWithX402Payment(
            contextUrl,
            imageUrls,
            videoUrl,
            title,
            tags,
            categoryId,
            details,
            salt,
            rewardTerms,
            roundConfig,
            spec,
            IConfidentialityEscrow.ConfidentialityConfig({ gated: false, bondAsset: 0, bondAmount: 0, flags: 0 }),
            paymentAuthorization
        );
    }

    function submitQuestionWithX402Payment(
        string memory contextUrl,
        string[] memory imageUrls,
        string memory videoUrl,
        string memory title,
        string memory tags,
        uint256 categoryId,
        ContentRegistry.SubmissionDetails memory details,
        bytes32 salt,
        ContentRegistry.SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig,
        ContentRegistry.QuestionSpecCommitment memory spec,
        IConfidentialityEscrow.ConfidentialityConfig memory confidentiality,
        Eip3009Authorization calldata paymentAuthorization
    ) public nonReentrant returns (uint256 contentId) {
        return _submitQuestionWithX402Payment(
            contextUrl,
            imageUrls,
            videoUrl,
            title,
            tags,
            categoryId,
            details,
            salt,
            rewardTerms,
            roundConfig,
            spec,
            confidentiality,
            paymentAuthorization
        );
    }

    function submitQuestionWithX402OneShotPayment(
        string memory contextUrl,
        string[] memory imageUrls,
        string memory videoUrl,
        string memory title,
        string memory tags,
        uint256 categoryId,
        ContentRegistry.SubmissionDetails memory details,
        bytes32 salt,
        ContentRegistry.SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig,
        ContentRegistry.QuestionSpecCommitment memory spec,
        FeedbackBonusTerms memory feedbackBonusTerms,
        Eip3009Authorization calldata paymentAuthorization
    ) external nonReentrant returns (uint256 contentId, uint256 feedbackBonusPoolId) {
        return _submitQuestionWithX402OneShotPayment(
            contextUrl,
            imageUrls,
            videoUrl,
            title,
            tags,
            categoryId,
            details,
            salt,
            rewardTerms,
            roundConfig,
            spec,
            IConfidentialityEscrow.ConfidentialityConfig({ gated: false, bondAsset: 0, bondAmount: 0, flags: 0 }),
            feedbackBonusTerms,
            paymentAuthorization
        );
    }

    function submitQuestionWithX402OneShotPayment(
        string memory contextUrl,
        string[] memory imageUrls,
        string memory videoUrl,
        string memory title,
        string memory tags,
        uint256 categoryId,
        ContentRegistry.SubmissionDetails memory details,
        bytes32 salt,
        ContentRegistry.SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig,
        ContentRegistry.QuestionSpecCommitment memory spec,
        IConfidentialityEscrow.ConfidentialityConfig memory confidentiality,
        FeedbackBonusTerms memory feedbackBonusTerms,
        Eip3009Authorization calldata paymentAuthorization
    ) public nonReentrant returns (uint256 contentId, uint256 feedbackBonusPoolId) {
        return _submitQuestionWithX402OneShotPayment(
            contextUrl,
            imageUrls,
            videoUrl,
            title,
            tags,
            categoryId,
            details,
            salt,
            rewardTerms,
            roundConfig,
            spec,
            confidentiality,
            feedbackBonusTerms,
            paymentAuthorization
        );
    }

    function _submitQuestionWithX402Payment(
        string memory contextUrl,
        string[] memory imageUrls,
        string memory videoUrl,
        string memory title,
        string memory tags,
        uint256 categoryId,
        ContentRegistry.SubmissionDetails memory details,
        bytes32 salt,
        ContentRegistry.SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig,
        ContentRegistry.QuestionSpecCommitment memory spec,
        IConfidentialityEscrow.ConfidentialityConfig memory confidentiality,
        Eip3009Authorization calldata paymentAuthorization
    ) internal returns (uint256 contentId) {
        require(rewardTerms.asset == REWARD_ASSET_USDC, "USDC required");
        require(paymentAuthorization.from != address(0), "Invalid payer");
        require(paymentAuthorization.to == address(this), "Bad payee");
        require(paymentAuthorization.value == rewardTerms.amount, "Bad amount");
        require(
            paymentAuthorization.nonce
                == computeX402QuestionPaymentNonce(
                    ContentRegistry.SubmissionMetadata({
                        url: contextUrl, title: title, tags: tags, categoryId: categoryId
                    }),
                    imageUrls,
                    videoUrl,
                    details,
                    salt,
                    rewardTerms,
                    roundConfig,
                    spec,
                    confidentiality,
                    paymentAuthorization.from,
                    paymentAuthorization.to,
                    paymentAuthorization.value,
                    paymentAuthorization.validAfter,
                    paymentAuthorization.validBefore
                ),
            "Bad nonce"
        );

        require(registry.questionRewardPoolEscrow() == questionRewardPoolEscrow, "Stale escrow");

        uint256 balanceBefore = usdcToken.balanceOf(address(this));
        // slither-disable-next-line reentrancy-balance
        IReceiveWithAuthorizationToken(address(usdcToken))
            .receiveWithAuthorization(
                paymentAuthorization.from,
                paymentAuthorization.to,
                paymentAuthorization.value,
                paymentAuthorization.validAfter,
                paymentAuthorization.validBefore,
                paymentAuthorization.nonce,
                paymentAuthorization.v,
                paymentAuthorization.r,
                paymentAuthorization.s
            );
        uint256 receivedAmount = usdcToken.balanceOf(address(this)) - balanceBefore;
        require(receivedAmount == paymentAuthorization.value, "Bad token");
        usdcToken.forceApprove(questionRewardPoolEscrow, paymentAuthorization.value);

        contentId = registry.submitQuestionFromX402Gateway(
            contextUrl,
            imageUrls,
            videoUrl,
            title,
            tags,
            categoryId,
            details,
            salt,
            rewardTerms,
            roundConfig,
            spec,
            paymentAuthorization.from,
            confidentiality
        );

        // The external entrypoints are nonReentrant; this asserts the gateway swept
        // the exact authorization into the configured protocol escrow.
        // slither-disable-next-line reentrancy-balance
        require(usdcToken.balanceOf(address(this)) == balanceBefore, "Residual token");
        emit X402QuestionSubmitted(
            contentId, paymentAuthorization.from, paymentAuthorization.nonce, paymentAuthorization.value
        );
    }

    function _submitQuestionWithX402OneShotPayment(
        string memory contextUrl,
        string[] memory imageUrls,
        string memory videoUrl,
        string memory title,
        string memory tags,
        uint256 categoryId,
        ContentRegistry.SubmissionDetails memory details,
        bytes32 salt,
        ContentRegistry.SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig,
        ContentRegistry.QuestionSpecCommitment memory spec,
        IConfidentialityEscrow.ConfidentialityConfig memory confidentiality,
        FeedbackBonusTerms memory feedbackBonusTerms,
        Eip3009Authorization calldata paymentAuthorization
    ) internal returns (uint256 contentId, uint256 feedbackBonusPoolId) {
        require(rewardTerms.asset == REWARD_ASSET_USDC, "USDC required");
        uint256 totalAmount = rewardTerms.amount + feedbackBonusTerms.amount;
        require(paymentAuthorization.from != address(0), "Invalid payer");
        require(paymentAuthorization.to == address(this), "Bad payee");
        require(paymentAuthorization.value == totalAmount, "Bad amount");
        require(
            paymentAuthorization.nonce
                == computeX402QuestionOneShotPaymentNonce(
                    ContentRegistry.SubmissionMetadata({
                        url: contextUrl, title: title, tags: tags, categoryId: categoryId
                    }),
                    imageUrls,
                    videoUrl,
                    details,
                    salt,
                    rewardTerms,
                    roundConfig,
                    spec,
                    confidentiality,
                    feedbackBonusTerms,
                    paymentAuthorization.from,
                    paymentAuthorization.to,
                    paymentAuthorization.value,
                    paymentAuthorization.validAfter,
                    paymentAuthorization.validBefore
                ),
            "Bad nonce"
        );

        require(registry.questionRewardPoolEscrow() == questionRewardPoolEscrow, "Stale escrow");
        address configuredFeedbackEscrow = feedbackBonusEscrow;
        if (feedbackBonusTerms.amount != 0) {
            require(configuredFeedbackEscrow != address(0), "Feedback escrow unset");
        }

        uint256 balanceBefore = usdcToken.balanceOf(address(this));
        // slither-disable-next-line reentrancy-balance
        IReceiveWithAuthorizationToken(address(usdcToken))
            .receiveWithAuthorization(
                paymentAuthorization.from,
                paymentAuthorization.to,
                paymentAuthorization.value,
                paymentAuthorization.validAfter,
                paymentAuthorization.validBefore,
                paymentAuthorization.nonce,
                paymentAuthorization.v,
                paymentAuthorization.r,
                paymentAuthorization.s
            );
        uint256 receivedAmount = usdcToken.balanceOf(address(this)) - balanceBefore;
        require(receivedAmount == paymentAuthorization.value, "Bad token");
        usdcToken.forceApprove(questionRewardPoolEscrow, rewardTerms.amount);

        contentId = registry.submitQuestionFromX402Gateway(
            contextUrl,
            imageUrls,
            videoUrl,
            title,
            tags,
            categoryId,
            details,
            salt,
            rewardTerms,
            roundConfig,
            spec,
            paymentAuthorization.from,
            confidentiality
        );

        if (feedbackBonusTerms.amount != 0) {
            uint256 roundId = registry.nextVotingRoundId(contentId);
            usdcToken.forceApprove(configuredFeedbackEscrow, feedbackBonusTerms.amount);
            feedbackBonusPoolId = FeedbackBonusEscrow(configuredFeedbackEscrow)
                .createFeedbackBonusPoolFromGateway(
                    contentId,
                    roundId,
                    feedbackBonusTerms.amount,
                    feedbackBonusTerms.feedbackClosesAt,
                    feedbackBonusTerms.awarder,
                    paymentAuthorization.from
                );
            emit X402FeedbackBonusAttached(
                contentId,
                feedbackBonusPoolId,
                paymentAuthorization.from,
                feedbackBonusTerms.amount,
                feedbackBonusTerms.feedbackClosesAt,
                feedbackBonusTerms.awarder
            );
        }

        // The external entrypoints are nonReentrant; this asserts the gateway swept
        // the exact authorization into the configured protocol escrows.
        // slither-disable-next-line reentrancy-balance
        require(usdcToken.balanceOf(address(this)) == balanceBefore, "Residual token");
        emit X402QuestionSubmitted(
            contentId, paymentAuthorization.from, paymentAuthorization.nonce, paymentAuthorization.value
        );
    }

    function computeX402QuestionPaymentNonce(
        ContentRegistry.SubmissionMetadata memory metadata,
        string[] memory imageUrls,
        string memory videoUrl,
        ContentRegistry.SubmissionDetails memory details,
        bytes32 salt,
        ContentRegistry.SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig,
        ContentRegistry.QuestionSpecCommitment memory spec,
        address payer,
        address payee,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore
    ) public view returns (bytes32) {
        return computeX402QuestionPaymentNonce(
            metadata,
            imageUrls,
            videoUrl,
            details,
            salt,
            rewardTerms,
            roundConfig,
            spec,
            IConfidentialityEscrow.ConfidentialityConfig({ gated: false, bondAsset: 0, bondAmount: 0, flags: 0 }),
            payer,
            payee,
            value,
            validAfter,
            validBefore
        );
    }

    function computeX402QuestionPaymentNonce(
        ContentRegistry.SubmissionMetadata memory metadata,
        string[] memory imageUrls,
        string memory videoUrl,
        ContentRegistry.SubmissionDetails memory details,
        bytes32 salt,
        ContentRegistry.SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig,
        ContentRegistry.QuestionSpecCommitment memory spec,
        IConfidentialityEscrow.ConfidentialityConfig memory confidentiality,
        address payer,
        address payee,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                X402_QUESTION_PAYMENT_DOMAIN,
                block.chainid,
                address(registry),
                questionRewardPoolEscrow,
                address(this),
                payer,
                payee,
                value,
                validAfter,
                validBefore,
                _hashSubmissionPayload(metadata, imageUrls, videoUrl, details, salt),
                _hashRewardTerms(rewardTerms),
                _hashRoundConfig(roundConfig),
                _hashConfidentiality(confidentiality),
                spec.questionMetadataHash,
                spec.resultSpecHash
            )
        );
    }

    function computeX402QuestionOneShotPaymentNonce(
        ContentRegistry.SubmissionMetadata memory metadata,
        string[] memory imageUrls,
        string memory videoUrl,
        ContentRegistry.SubmissionDetails memory details,
        bytes32 salt,
        ContentRegistry.SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig,
        ContentRegistry.QuestionSpecCommitment memory spec,
        FeedbackBonusTerms memory feedbackBonusTerms,
        address payer,
        address payee,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore
    ) public view returns (bytes32) {
        return computeX402QuestionOneShotPaymentNonce(
            metadata,
            imageUrls,
            videoUrl,
            details,
            salt,
            rewardTerms,
            roundConfig,
            spec,
            IConfidentialityEscrow.ConfidentialityConfig({ gated: false, bondAsset: 0, bondAmount: 0, flags: 0 }),
            feedbackBonusTerms,
            payer,
            payee,
            value,
            validAfter,
            validBefore
        );
    }

    function computeX402QuestionOneShotPaymentNonce(
        ContentRegistry.SubmissionMetadata memory metadata,
        string[] memory imageUrls,
        string memory videoUrl,
        ContentRegistry.SubmissionDetails memory details,
        bytes32 salt,
        ContentRegistry.SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig,
        ContentRegistry.QuestionSpecCommitment memory spec,
        IConfidentialityEscrow.ConfidentialityConfig memory confidentiality,
        FeedbackBonusTerms memory feedbackBonusTerms,
        address payer,
        address payee,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                X402_QUESTION_ONE_SHOT_PAYMENT_DOMAIN,
                block.chainid,
                address(registry),
                questionRewardPoolEscrow,
                feedbackBonusEscrow,
                address(this),
                payer,
                payee,
                value,
                validAfter,
                validBefore,
                _hashSubmissionPayload(metadata, imageUrls, videoUrl, details, salt),
                _hashRewardTerms(rewardTerms),
                _hashRoundConfig(roundConfig),
                _hashConfidentiality(confidentiality),
                _hashFeedbackBonusTerms(feedbackBonusTerms),
                spec.questionMetadataHash,
                spec.resultSpecHash
            )
        );
    }

    function _hashSubmissionPayload(
        ContentRegistry.SubmissionMetadata memory metadata,
        string[] memory imageUrls,
        string memory videoUrl,
        ContentRegistry.SubmissionDetails memory details,
        bytes32 salt
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(bytes(metadata.url)),
                _hashStringArray(imageUrls),
                keccak256(bytes(videoUrl)),
                keccak256(bytes(details.detailsUrl)),
                details.detailsHash,
                keccak256(bytes(metadata.title)),
                keccak256(bytes(metadata.tags)),
                metadata.categoryId,
                salt
            )
        );
    }

    function _hashRewardTerms(ContentRegistry.SubmissionRewardTerms memory rewardTerms) private pure returns (bytes32) {
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

    function _hashRoundConfig(RoundLib.RoundConfig memory roundConfig) private pure returns (bytes32) {
        return keccak256(
            abi.encode(roundConfig.epochDuration, roundConfig.maxDuration, roundConfig.minVoters, roundConfig.maxVoters)
        );
    }

    function _hashConfidentiality(IConfidentialityEscrow.ConfidentialityConfig memory confidentiality)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                confidentiality.gated, confidentiality.bondAsset, confidentiality.bondAmount, confidentiality.flags
            )
        );
    }

    function _hashFeedbackBonusTerms(FeedbackBonusTerms memory feedbackBonusTerms) private pure returns (bytes32) {
        return keccak256(
            abi.encode(feedbackBonusTerms.amount, feedbackBonusTerms.feedbackClosesAt, feedbackBonusTerms.awarder)
        );
    }

    function _hashStringArray(string[] memory values) private pure returns (bytes32) {
        bytes32[] memory valueHashes = new bytes32[](values.length);
        for (uint256 i = 0; i < values.length;) {
            valueHashes[i] = keccak256(bytes(values[i]));
            unchecked {
                ++i;
            }
        }
        return keccak256(abi.encodePacked(valueHashes));
    }

    function _setQuestionRewardPoolEscrow(address newEscrow) private {
        require(newEscrow != address(0), "Invalid escrow");
        address previousEscrow = questionRewardPoolEscrow;
        questionRewardPoolEscrow = newEscrow;
        emit QuestionRewardPoolEscrowUpdated(previousEscrow, newEscrow);
    }

    function _feedbackBonusEscrowConfigMatches(address candidate) private view returns (bool) {
        IFeedbackBonusEscrowConfigShape escrow = IFeedbackBonusEscrowConfigShape(candidate);

        try escrow.registry() returns (ContentRegistry escrowRegistry) {
            if (address(escrowRegistry) != address(registry)) return false;
        } catch {
            return false;
        }

        try escrow.usdcToken() returns (IERC20 escrowUsdcToken) {
            if (address(escrowUsdcToken) != address(usdcToken)) return false;
        } catch {
            return false;
        }

        try escrow.votingEngine() returns (address escrowVotingEngine) {
            return escrowVotingEngine == registry.votingEngine();
        } catch {
            return false;
        }
    }

    function _requireFeedbackBonusEscrowShape(address newEscrow) private view {
        require(newEscrow != address(0), "Invalid escrow");
        require(newEscrow.code.length != 0, "Invalid escrow");
        require(_feedbackBonusEscrowConfigMatches(newEscrow), "Stale escrow");
    }

    function _setFeedbackBonusEscrow(address newEscrow) private {
        require(newEscrow != address(0), "Invalid escrow");
        address previousEscrow = feedbackBonusEscrow;
        feedbackBonusEscrow = newEscrow;
        emit FeedbackBonusEscrowUpdated(previousEscrow, newEscrow);
    }
}
