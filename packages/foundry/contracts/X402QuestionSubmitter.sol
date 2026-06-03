// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import { ContentRegistry } from "./ContentRegistry.sol";
import { Eip3009Authorization, IReceiveWithAuthorizationToken } from "./interfaces/IEip3009.sol";
import { RoundLib } from "./libraries/RoundLib.sol";

contract X402QuestionSubmitter is Ownable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint8 internal constant REWARD_ASSET_USDC = 1;
    bytes32 internal constant X402_QUESTION_PAYMENT_DOMAIN = keccak256("rateloop-x402-question-payment-v2");

    ContentRegistry public immutable registry;
    IERC20 public immutable usdcToken;
    address public immutable questionRewardPoolEscrow;

    event X402QuestionSubmitted(
        uint256 indexed contentId, address indexed submitter, bytes32 indexed paymentNonce, uint256 amount
    );

    constructor(ContentRegistry _registry, address _usdcToken, address _questionRewardPoolEscrow, address initialOwner)
        Ownable(initialOwner)
    {
        require(address(_registry) != address(0), "Invalid registry");
        require(_usdcToken != address(0), "Invalid USDC");
        require(_questionRewardPoolEscrow != address(0), "Invalid escrow");
        registry = _registry;
        usdcToken = IERC20(_usdcToken);
        questionRewardPoolEscrow = _questionRewardPoolEscrow;
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
        string memory description,
        string memory tags,
        uint256 categoryId,
        bytes32 salt,
        ContentRegistry.SubmissionRewardTerms memory rewardTerms,
        RoundLib.RoundConfig memory roundConfig,
        ContentRegistry.QuestionSpecCommitment memory spec,
        Eip3009Authorization calldata paymentAuthorization
    ) external nonReentrant returns (uint256 contentId) {
        require(rewardTerms.asset == REWARD_ASSET_USDC, "USDC required");
        require(paymentAuthorization.from != address(0), "Invalid payer");
        require(paymentAuthorization.to == address(this), "Bad payee");
        require(paymentAuthorization.value == rewardTerms.amount, "Bad amount");
        require(
            paymentAuthorization.nonce
                == computeX402QuestionPaymentNonce(
                    ContentRegistry.SubmissionMetadata({
                        url: contextUrl, title: title, description: description, tags: tags, categoryId: categoryId
                    }),
                    imageUrls,
                    videoUrl,
                    salt,
                    rewardTerms,
                    roundConfig,
                    spec,
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
            description,
            tags,
            categoryId,
            salt,
            rewardTerms,
            roundConfig,
            spec,
            paymentAuthorization.from
        );

        emit X402QuestionSubmitted(
            contentId, paymentAuthorization.from, paymentAuthorization.nonce, paymentAuthorization.value
        );
    }

    function computeX402QuestionPaymentNonce(
        ContentRegistry.SubmissionMetadata memory metadata,
        string[] memory imageUrls,
        string memory videoUrl,
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
                _hashSubmissionPayload(metadata, imageUrls, videoUrl, salt),
                _hashRewardTerms(rewardTerms),
                _hashRoundConfig(roundConfig),
                spec.questionMetadataHash,
                spec.resultSpecHash
            )
        );
    }

    function _hashSubmissionPayload(
        ContentRegistry.SubmissionMetadata memory metadata,
        string[] memory imageUrls,
        string memory videoUrl,
        bytes32 salt
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(bytes(metadata.url)),
                _hashStringArray(imageUrls),
                keccak256(bytes(videoUrl)),
                keccak256(bytes(metadata.title)),
                keccak256(bytes(metadata.description)),
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
}
