// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { ICredentialIssuer } from "./interfaces/ICredentialIssuer.sol";

/// @title TokenlessFeedbackBonus
/// @notice Optional, separately funded USDC awards chosen by the human who requested the feedback.
/// @dev A bonus is independent of any guaranteed base bounty and works for public, private, paid,
///      or otherwise-unpaid reviews. The credential issuer can admit future responses only. Once a
///      response is registered, no operator, issuer, or administrator can redirect its payout.
contract TokenlessFeedbackBonus is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint64 public constant MAX_AWARD_WINDOW = 365 days;

    bytes32 public constant VOUCHER_TYPEHASH = keccak256(
        "Voucher(address voteKey,bytes32 reviewId,bytes32 contentId,uint256 poolId,bytes32 nullifier,bytes32 admissionPolicyHash,uint64 issuerEpoch,uint64 expiresAt)"
    );
    bytes32 public constant FEEDBACK_TYPEHASH =
        keccak256("Feedback(uint256 poolId,bytes32 responseHash,bytes32 payoutCommitment,bytes32 nullifier)");

    struct PoolTerms {
        bytes32 reviewId;
        bytes32 contentId;
        bytes32 admissionPolicyHash;
        uint256 amount;
        uint64 feedbackDeadline;
        uint64 awardDeadline;
    }

    struct Pool {
        bytes32 reviewId;
        bytes32 contentId;
        bytes32 admissionPolicyHash;
        address funder;
        address awarder;
        uint256 depositedAmount;
        uint256 awardedAmount;
        uint64 feedbackDeadline;
        uint64 awardDeadline;
        bool refunded;
    }

    struct Voucher {
        address voteKey;
        bytes32 reviewId;
        bytes32 contentId;
        uint256 poolId;
        bytes32 nullifier;
        bytes32 admissionPolicyHash;
        uint64 issuerEpoch;
        uint64 expiresAt;
    }

    struct FeedbackRecord {
        address voteKey;
        bytes32 responseHash;
        bytes32 payoutCommitment;
        uint64 registeredAt;
        uint256 awardAmount;
        bool awarded;
        bool claimed;
    }

    IERC20 public immutable usdc;
    ICredentialIssuer public immutable credentialIssuer;

    uint256 public nextPoolId = 1;
    mapping(uint256 poolId => Pool pool) private _pools;
    /// @dev Keyed by `poolKeyFor(requester, reviewId)`, not the raw review ID, so pool uniqueness
    ///      is bound to the authenticated paying requester (msg.sender at creation). A globally
    ///      caller-chosen review ID can therefore no longer be squatted to brick a legitimate pool.
    mapping(bytes32 poolKey => uint256 poolId) public reviewPoolId;
    mapping(bytes32 feedbackKey => FeedbackRecord record) private _feedback;
    mapping(bytes32 nullifier => bool used) public nullifierUsed;
    mapping(uint256 poolId => mapping(bytes32 responseHash => bool awarded)) public responseAwarded;

    event PoolCreated(
        uint256 indexed poolId,
        bytes32 indexed reviewId,
        bytes32 indexed contentId,
        bytes32 admissionPolicyHash,
        address payer,
        address funder,
        address awarder,
        uint256 amount,
        uint64 feedbackDeadline,
        uint64 awardDeadline
    );
    event FeedbackRegistered(
        uint256 indexed poolId,
        bytes32 indexed feedbackKey,
        bytes32 indexed responseHash,
        address voteKey,
        bytes32 payoutCommitment
    );
    event FeedbackAwarded(
        uint256 indexed poolId,
        bytes32 indexed feedbackKey,
        bytes32 indexed responseHash,
        address voteKey,
        bytes32 payoutCommitment,
        uint256 amount
    );
    event FeedbackAwardClaimed(
        uint256 indexed poolId, bytes32 indexed feedbackKey, address indexed payoutAddress, uint256 amount
    );
    event RemainderRefunded(uint256 indexed poolId, address indexed funder, uint256 amount);

    error InvalidAddress();
    error InvalidAmount();
    error InvalidDeadline();
    error InvalidPool();
    error InvalidTerms();
    error InvalidVoucher();
    error InvalidSignature();
    error InvalidFeedback();
    error PoolAlreadyExists();
    error Unauthorized();
    error FeedbackWindowClosed();
    error AwardWindowClosed();
    error FeedbackWindowOpen();
    error NullifierAlreadyUsed();
    error FeedbackAlreadyRegistered();
    error AlreadyAwarded();
    error AwardNotClaimable();
    error NothingToRefund();
    error TransferAmountMismatch();

    constructor(address usdc_, address credentialIssuer_) EIP712("RateLoop Tokenless Feedback Bonus", "1") {
        if (
            usdc_ == address(0) || usdc_.code.length == 0 || credentialIssuer_ == address(0)
                || credentialIssuer_.code.length == 0
        ) revert InvalidAddress();
        usdc = IERC20(usdc_);
        credentialIssuer = ICredentialIssuer(credentialIssuer_);
    }

    /// @notice Fund a bonus whose unawarded remainder returns to the caller.
    /// @dev Passing address(0) makes the requester/funder the immutable human awarder.
    function createPool(PoolTerms calldata terms, address designatedAwarder)
        external
        nonReentrant
        returns (uint256 poolId)
    {
        address awarder = designatedAwarder == address(0) ? msg.sender : designatedAwarder;
        return _createPool(terms, msg.sender, msg.sender, awarder);
    }

    /// @notice Pay for a bonus while freezing a distinct refund recipient and human awarder.
    /// @dev Used by purpose-bound prepaid funding. The caller can fund but cannot change either
    ///      recipient after creation and receives no award authority unless explicitly designated.
    function createPoolFor(PoolTerms calldata terms, address funder, address awarder)
        external
        nonReentrant
        returns (uint256 poolId)
    {
        if (funder == address(0) || awarder == address(0)) revert InvalidAddress();
        return _createPool(terms, msg.sender, funder, awarder);
    }

    function _createPool(PoolTerms calldata terms, address payer, address funder, address awarder)
        private
        returns (uint256 poolId)
    {
        if (terms.reviewId == bytes32(0) || terms.contentId == bytes32(0) || terms.admissionPolicyHash == bytes32(0)) revert InvalidTerms();
        if (terms.amount == 0) revert InvalidAmount();
        if (
            terms.feedbackDeadline <= block.timestamp || terms.awardDeadline <= terms.feedbackDeadline
                || uint256(terms.awardDeadline) > uint256(terms.feedbackDeadline) + MAX_AWARD_WINDOW
        ) revert InvalidDeadline();
        bytes32 poolKey = poolKeyFor(payer, terms.reviewId);
        if (reviewPoolId[poolKey] != 0) revert PoolAlreadyExists();

        poolId = nextPoolId++;
        _pools[poolId] = Pool({
            reviewId: terms.reviewId,
            contentId: terms.contentId,
            admissionPolicyHash: terms.admissionPolicyHash,
            funder: funder,
            awarder: awarder,
            depositedAmount: terms.amount,
            awardedAmount: 0,
            feedbackDeadline: terms.feedbackDeadline,
            awardDeadline: terms.awardDeadline,
            refunded: false
        });
        reviewPoolId[poolKey] = poolId;

        uint256 beforeBalance = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(payer, address(this), terms.amount);
        if (usdc.balanceOf(address(this)) - beforeBalance != terms.amount) revert TransferAmountMismatch();

        emit PoolCreated(
            poolId,
            terms.reviewId,
            terms.contentId,
            terms.admissionPolicyHash,
            payer,
            funder,
            awarder,
            terms.amount,
            terms.feedbackDeadline,
            terms.awardDeadline
        );
    }

    /// @notice Register one eligible response without disclosing its contents.
    /// @dev Any relayer may submit the two signatures. Paid eligibility must already have been
    ///      completed before the issuer creates the pool-specific voucher.
    function registerFeedback(
        Voucher calldata voucher,
        bytes32 responseHash,
        bytes32 payoutCommitment,
        bytes calldata voucherSignature,
        bytes calldata voteKeySignature
    ) external nonReentrant {
        Pool storage pool = _pools[voucher.poolId];
        if (pool.funder == address(0)) revert InvalidPool();
        if (block.timestamp > pool.feedbackDeadline) revert FeedbackWindowClosed();
        if (
            voucher.voteKey == address(0) || voucher.reviewId != pool.reviewId || voucher.contentId != pool.contentId
                || voucher.nullifier == bytes32(0) || voucher.admissionPolicyHash != pool.admissionPolicyHash
                || voucher.expiresAt < block.timestamp || responseHash == bytes32(0) || payoutCommitment == bytes32(0)
        ) revert InvalidVoucher();
        if (nullifierUsed[voucher.nullifier]) revert NullifierAlreadyUsed();
        bytes32 feedbackKey = feedbackKeyFor(voucher.poolId, voucher.voteKey);
        if (_feedback[feedbackKey].voteKey != address(0)) revert FeedbackAlreadyRegistered();
        if (!credentialIssuer.isValidVoucherSignature(voucher.issuerEpoch, voucherDigest(voucher), voucherSignature)) {
            revert InvalidSignature();
        }
        bytes32 digest = feedbackDigest(voucher.poolId, responseHash, payoutCommitment, voucher.nullifier);
        (address recovered, ECDSA.RecoverError signatureError,) = ECDSA.tryRecoverCalldata(digest, voteKeySignature);
        if (signatureError != ECDSA.RecoverError.NoError || recovered != voucher.voteKey) revert InvalidSignature();

        nullifierUsed[voucher.nullifier] = true;
        _feedback[feedbackKey] = FeedbackRecord({
            voteKey: voucher.voteKey,
            responseHash: responseHash,
            payoutCommitment: payoutCommitment,
            registeredAt: uint64(block.timestamp),
            awardAmount: 0,
            awarded: false,
            claimed: false
        });
        emit FeedbackRegistered(voucher.poolId, feedbackKey, responseHash, voucher.voteKey, payoutCommitment);
    }

    /// @notice Award any selected eligible feedback after the response window closes.
    function award(uint256 poolId, address voteKey, uint256 amount) external nonReentrant {
        Pool storage pool = _pools[poolId];
        if (pool.funder == address(0)) revert InvalidPool();
        if (msg.sender != pool.awarder) revert Unauthorized();
        if (block.timestamp <= pool.feedbackDeadline) revert FeedbackWindowOpen();
        if (block.timestamp > pool.awardDeadline || pool.refunded) revert AwardWindowClosed();
        if (amount == 0 || amount > pool.depositedAmount - pool.awardedAmount) revert InvalidAmount();

        bytes32 feedbackKey = feedbackKeyFor(poolId, voteKey);
        FeedbackRecord storage feedback = _feedback[feedbackKey];
        if (feedback.voteKey != voteKey || feedback.responseHash == bytes32(0)) revert InvalidFeedback();
        if (feedback.awarded || responseAwarded[poolId][feedback.responseHash]) revert AlreadyAwarded();

        feedback.awarded = true;
        feedback.awardAmount = amount;
        responseAwarded[poolId][feedback.responseHash] = true;
        pool.awardedAmount += amount;

        emit FeedbackAwarded(poolId, feedbackKey, feedback.responseHash, voteKey, feedback.payoutCommitment, amount);
    }

    /// @notice Resolve an awarded payout to the address committed by the feedback author.
    /// @dev Anyone may relay the claim after learning the preimage. Award selection never exposes the
    ///      payout address or salt to the awarder, agent, or platform and an award remains claimable
    ///      after the pool's award/refund windows close.
    function claimAward(uint256 poolId, address voteKey, address payoutAddress, bytes32 payoutSalt)
        external
        nonReentrant
        returns (uint256 amount)
    {
        if (payoutAddress == address(0)) revert InvalidAddress();
        bytes32 feedbackKey = feedbackKeyFor(poolId, voteKey);
        FeedbackRecord storage feedback = _feedback[feedbackKey];
        if (!feedback.awarded || feedback.claimed || feedback.awardAmount == 0) revert AwardNotClaimable();
        if (feedback.payoutCommitment != payoutCommitmentFor(payoutAddress, payoutSalt)) revert InvalidFeedback();

        feedback.claimed = true;
        amount = feedback.awardAmount;
        _transferExact(payoutAddress, amount);
        emit FeedbackAwardClaimed(poolId, feedbackKey, payoutAddress, amount);
    }

    /// @notice Return the unawarded remainder to the immutable funder after the disclosed deadline.
    function refundRemainder(uint256 poolId) external nonReentrant returns (uint256 amount) {
        Pool storage pool = _pools[poolId];
        if (pool.funder == address(0)) revert InvalidPool();
        if (block.timestamp <= pool.awardDeadline) revert AwardWindowClosed();
        if (pool.refunded) revert NothingToRefund();

        amount = pool.depositedAmount - pool.awardedAmount;
        if (amount == 0) revert NothingToRefund();
        pool.refunded = true;
        _transferExact(pool.funder, amount);

        emit RemainderRefunded(poolId, pool.funder, amount);
    }

    /// @notice Namespaced pool-uniqueness key binding a review ID to the paying requester.
    /// @dev `requester` is the account that funds the pool (msg.sender at creation). Because pool
    ///      identity is namespaced by that authenticated account, an attacker who learns or
    ///      predicts a legitimate review ID cannot front-run and permanently block it.
    function poolKeyFor(address requester, bytes32 reviewId) public pure returns (bytes32) {
        return keccak256(abi.encode(requester, reviewId));
    }

    function feedbackKeyFor(uint256 poolId, address voteKey) public pure returns (bytes32) {
        return keccak256(abi.encode(poolId, voteKey));
    }

    function payoutCommitmentFor(address payoutAddress, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(payoutAddress, salt));
    }

    function voucherDigest(Voucher calldata voucher) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    VOUCHER_TYPEHASH,
                    voucher.voteKey,
                    voucher.reviewId,
                    voucher.contentId,
                    voucher.poolId,
                    voucher.nullifier,
                    voucher.admissionPolicyHash,
                    voucher.issuerEpoch,
                    voucher.expiresAt
                )
            )
        );
    }

    function feedbackDigest(uint256 poolId, bytes32 responseHash, bytes32 payoutCommitment, bytes32 nullifier)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(FEEDBACK_TYPEHASH, poolId, responseHash, payoutCommitment, nullifier))
        );
    }

    function getPool(uint256 poolId) external view returns (Pool memory) {
        return _pools[poolId];
    }

    function getFeedback(uint256 poolId, address voteKey) external view returns (FeedbackRecord memory) {
        return _feedback[feedbackKeyFor(poolId, voteKey)];
    }

    function remainingAmount(uint256 poolId) external view returns (uint256) {
        Pool storage pool = _pools[poolId];
        if (pool.funder == address(0)) revert InvalidPool();
        return pool.refunded ? 0 : pool.depositedAmount - pool.awardedAmount;
    }

    function _transferExact(address recipient, uint256 amount) private {
        uint256 beforeContractBalance = usdc.balanceOf(address(this));
        uint256 beforeRecipientBalance = usdc.balanceOf(recipient);
        usdc.safeTransfer(recipient, amount);
        if (
            beforeContractBalance - usdc.balanceOf(address(this)) != amount
                || usdc.balanceOf(recipient) - beforeRecipientBalance != amount
        ) revert TransferAmountMismatch();
    }
}
