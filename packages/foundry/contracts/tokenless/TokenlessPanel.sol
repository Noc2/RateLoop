// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { ICredentialIssuer } from "./interfaces/ICredentialIssuer.sol";
import { TokenlessScoring } from "./libraries/TokenlessScoring.sol";

/// @title TokenlessPanel
/// @notice Greenfield, immutable USDC custody and deterministic binary-panel settlement core.
/// @dev There is deliberately no owner, operator, pause, setter, sweep, payout root, or upgrade path.
///      The issuer can authorize future commits only; its state is never consulted after acceptance.
contract TokenlessPanel is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_FEE_BPS = 2_000;
    uint8 public constant SCORING_VERSION = 1;

    bytes32 public constant VOUCHER_TYPEHASH = keccak256(
        "Voucher(address voteKey,bytes32 contentId,uint256 roundId,bytes32 nullifier,uint32 tierId,uint64 issuerEpoch,uint64 expiresAt)"
    );
    bytes32 public constant COMMIT_TYPEHASH = keccak256(
        "Commit(uint256 roundId,bytes32 sealedCommitment,bytes32 sealedPayloadHash,bytes32 payoutCommitment,bytes32 nullifier)"
    );
    bytes32 public constant REVEAL_TYPEHASH = keccak256(
        "Reveal(uint256 roundId,address voteKey,uint8 vote,uint16 predictedUpBps,bytes32 responseHash,address payoutAddress,bytes32 salt)"
    );

    enum RoundState {
        Open,
        Revealable,
        Aggregating,
        Weighting,
        Finalized,
        ZeroCommitRefund,
        UnderQuorumCompensation,
        BeaconFailureCompensation
    }

    struct Voucher {
        address voteKey;
        bytes32 contentId;
        uint256 roundId;
        bytes32 nullifier;
        uint32 tierId;
        uint64 issuerEpoch;
        uint64 expiresAt;
    }

    struct RoundTerms {
        bytes32 contentId;
        bytes32 termsHash;
        bytes32 beaconNetworkHash;
        uint256 bountyAmount;
        uint256 feeAmount;
        uint256 attemptReserve;
        uint256 attemptCompensation;
        uint32 minimumReveals;
        uint32 maximumCommits;
        uint32 requiredTier;
        uint64 commitDeadline;
        uint64 revealDeadline;
        uint64 beaconFailureDeadline;
        uint64 beaconRound;
        uint64 claimGracePeriod;
        address feeRecipient;
    }

    struct Round {
        address funder;
        bytes32 contentId;
        bytes32 termsHash;
        bytes32 beaconNetworkHash;
        address feeRecipient;
        uint256 bountyAmount;
        uint256 feeAmount;
        uint256 attemptReserve;
        uint256 attemptCompensation;
        uint256 compensationPerRecipient;
        uint256 totalAccuracyScore;
        uint256 totalPaid;
        uint64 commitDeadline;
        uint64 revealDeadline;
        uint64 beaconFailureDeadline;
        uint64 beaconRound;
        uint64 claimGracePeriod;
        uint64 claimDeadline;
        uint32 minimumReveals;
        uint32 maximumCommits;
        uint32 requiredTier;
        uint32 commitCount;
        uint32 revealCount;
        uint32 frozenRevealCount;
        uint32 aggregateCursor;
        uint32 weightCursor;
        uint32 upVotes;
        RoundState state;
        bool staleReturned;
    }

    struct CommitRecord {
        uint256 roundId;
        address voteKey;
        bytes32 sealedCommitment;
        bytes32 sealedPayloadHash;
        bytes32 payoutCommitment;
        bytes32 responseHash;
        uint256 accuracyScore;
        uint16 predictedUpBps;
        uint8 vote;
        bool revealed;
        bool claimed;
    }

    IERC20 public immutable usdc;
    ICredentialIssuer public immutable credentialIssuer;

    uint256 public nextRoundId = 1;
    mapping(uint256 roundId => Round round) private _rounds;
    mapping(uint256 roundId => bytes32[] commitKeys) private _roundCommitKeys;
    mapping(uint256 roundId => bytes32[] revealKeys) private _roundRevealKeys;
    mapping(bytes32 commitKey => CommitRecord record) private _commits;
    mapping(bytes32 nullifier => bool used) public nullifierUsed;

    event RoundCreated(
        uint256 indexed roundId,
        address indexed funder,
        bytes32 indexed contentId,
        bytes32 termsHash,
        uint256 bountyAmount,
        uint256 feeAmount,
        uint256 attemptReserve
    );
    /// @dev `sealedPayload` is the public tlock ciphertext. Its signed hash is retained in state.
    event CommitAccepted(
        uint256 indexed roundId, bytes32 indexed commitKey, bytes32 indexed nullifier, bytes sealedPayload
    );
    event RevealAccepted(
        uint256 indexed roundId, bytes32 indexed commitKey, uint8 vote, uint16 predictedUpBps, bytes32 responseHash
    );
    event SettlementBegun(uint256 indexed roundId, uint32 frozenRevealCount);
    event SettlementProgressed(uint256 indexed roundId, RoundState indexed state, uint32 cursor);
    event RoundFinalized(uint256 indexed roundId, uint256 totalAccuracyScore, uint64 claimDeadline);
    event RoundTerminal(uint256 indexed roundId, RoundState indexed state, uint256 funderRefund, uint256 compensation);
    event Claimed(uint256 indexed roundId, bytes32 indexed commitKey, address indexed payoutAddress, uint256 amount);
    event StaleSharesReturned(uint256 indexed roundId, address indexed funder, uint256 amount);

    error InvalidAddress();
    error InvalidTerms();
    error InvalidState();
    error InvalidDeadline();
    error InvalidVoucher();
    error InvalidSignature();
    error InvalidCommitment();
    error InvalidPrediction();
    error CapacityReached();
    error NullifierAlreadyUsed();
    error CommitAlreadyExists();
    error CommitNotFound();
    error AlreadyClaimed();
    error NotClaimable();
    error Unauthorized();
    error CursorMismatch();
    error NothingToProcess();
    error ClaimWindowOpen();
    error TransferAmountMismatch();

    constructor(address usdc_, address credentialIssuer_) EIP712("RateLoop Tokenless Panel", "1") {
        if (
            usdc_ == address(0) || usdc_.code.length == 0 || credentialIssuer_ == address(0)
                || credentialIssuer_.code.length == 0
        ) revert InvalidAddress();
        usdc = IERC20(usdc_);
        credentialIssuer = ICredentialIssuer(credentialIssuer_);
    }

    function createRound(RoundTerms calldata terms) external nonReentrant returns (uint256 roundId) {
        return _createRound(terms, msg.sender, msg.sender);
    }

    /// @notice Fund a round while assigning every refund and cancellation right to `funder`.
    /// @dev This narrow entry point lets a stateless payment adapter pull an authorization,
    ///      deposit it, and disappear from the lifecycle without becoming a funds custodian.
    function createRoundFor(RoundTerms calldata terms, address funder)
        external
        nonReentrant
        returns (uint256 roundId)
    {
        if (funder == address(0)) revert InvalidAddress();
        return _createRound(terms, msg.sender, funder);
    }

    function _createRound(RoundTerms calldata terms, address payer, address funder)
        private
        returns (uint256 roundId)
    {
        _validateTerms(terms);

        roundId = nextRoundId++;
        Round storage round = _rounds[roundId];
        round.funder = funder;
        round.contentId = terms.contentId;
        round.termsHash = terms.termsHash;
        round.beaconNetworkHash = terms.beaconNetworkHash;
        round.feeRecipient = terms.feeRecipient;
        round.bountyAmount = terms.bountyAmount;
        round.feeAmount = terms.feeAmount;
        round.attemptReserve = terms.attemptReserve;
        round.attemptCompensation = terms.attemptCompensation;
        round.minimumReveals = terms.minimumReveals;
        round.maximumCommits = terms.maximumCommits;
        round.requiredTier = terms.requiredTier;
        round.commitDeadline = terms.commitDeadline;
        round.revealDeadline = terms.revealDeadline;
        round.beaconFailureDeadline = terms.beaconFailureDeadline;
        round.beaconRound = terms.beaconRound;
        round.claimGracePeriod = terms.claimGracePeriod;

        uint256 amount = terms.bountyAmount + terms.feeAmount + terms.attemptReserve;
        uint256 beforeBalance = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(payer, address(this), amount);
        if (usdc.balanceOf(address(this)) - beforeBalance != amount) revert TransferAmountMismatch();

        emit RoundCreated(
            roundId,
            funder,
            terms.contentId,
            terms.termsHash,
            terms.bountyAmount,
            terms.feeAmount,
            terms.attemptReserve
        );
    }

    /// @notice Accept a voucher-bound commit from any relayer; `msg.sender` has no protocol meaning.
    function commit(
        Voucher calldata voucher,
        bytes32 sealedCommitment,
        bytes calldata sealedPayload,
        bytes32 payoutCommitment,
        bytes calldata voucherSignature,
        bytes calldata voteKeySignature
    ) external {
        Round storage round = _rounds[voucher.roundId];
        if (round.funder == address(0) || round.state != RoundState.Open) revert InvalidState();
        if (block.timestamp > round.commitDeadline) revert InvalidDeadline();
        if (round.commitCount >= round.maximumCommits) revert CapacityReached();
        if (
            voucher.voteKey == address(0) || voucher.contentId != round.contentId || voucher.nullifier == bytes32(0)
                || voucher.tierId < round.requiredTier || voucher.expiresAt < block.timestamp
                || sealedCommitment == bytes32(0) || sealedPayload.length == 0 || payoutCommitment == bytes32(0)
        ) revert InvalidVoucher();
        if (nullifierUsed[voucher.nullifier]) revert NullifierAlreadyUsed();

        bytes32 commitKey = commitKeyFor(voucher.roundId, voucher.voteKey);
        if (_commits[commitKey].voteKey != address(0)) revert CommitAlreadyExists();
        if (!credentialIssuer.isValidVoucherSignature(voucher.issuerEpoch, voucherDigest(voucher), voucherSignature)) {
            revert InvalidSignature();
        }

        bytes32 sealedPayloadHash = keccak256(sealedPayload);
        bytes32 digest =
            commitDigest(voucher.roundId, sealedCommitment, sealedPayloadHash, payoutCommitment, voucher.nullifier);
        (address recovered, ECDSA.RecoverError signatureError,) = ECDSA.tryRecoverCalldata(digest, voteKeySignature);
        if (signatureError != ECDSA.RecoverError.NoError || recovered != voucher.voteKey) revert InvalidSignature();

        nullifierUsed[voucher.nullifier] = true;
        round.commitCount += 1;
        _roundCommitKeys[voucher.roundId].push(commitKey);
        _commits[commitKey] = CommitRecord({
            roundId: voucher.roundId,
            voteKey: voucher.voteKey,
            sealedCommitment: sealedCommitment,
            sealedPayloadHash: sealedPayloadHash,
            payoutCommitment: payoutCommitment,
            responseHash: 0,
            accuracyScore: 0,
            predictedUpBps: 0,
            vote: 0,
            revealed: false,
            claimed: false
        });

        emit CommitAccepted(voucher.roundId, commitKey, voucher.nullifier, sealedPayload);
    }

    function openReveal(uint256 roundId) external {
        Round storage round = _rounds[roundId];
        if (round.state != RoundState.Open) revert InvalidState();
        if (block.timestamp <= round.commitDeadline || block.timestamp > round.revealDeadline) {
            revert InvalidDeadline();
        }
        round.state = RoundState.Revealable;
    }

    function reveal(
        uint256 roundId,
        address voteKey,
        uint8 vote,
        uint16 predictedUpBps,
        bytes32 responseHash,
        address payoutAddress,
        bytes32 salt
    ) external {
        Round storage round = _rounds[roundId];
        if (round.state == RoundState.Open) {
            if (block.timestamp <= round.commitDeadline) revert InvalidDeadline();
            round.state = RoundState.Revealable;
        }
        if (round.state != RoundState.Revealable) revert InvalidState();
        if (block.timestamp > round.revealDeadline) revert InvalidDeadline();
        if (vote > 1 || !TokenlessScoring.isPredictionBucket(predictedUpBps)) revert InvalidPrediction();
        if (payoutAddress == address(0)) revert InvalidAddress();

        bytes32 commitKey = commitKeyFor(roundId, voteKey);
        CommitRecord storage record = _commits[commitKey];
        if (record.voteKey == address(0)) revert CommitNotFound();
        if (record.revealed) revert InvalidState();
        if (record.payoutCommitment != payoutCommitmentFor(payoutAddress, salt)) revert InvalidCommitment();
        if (
            record.sealedCommitment
                != revealCommitment(roundId, voteKey, vote, predictedUpBps, responseHash, payoutAddress, salt)
        ) revert InvalidCommitment();

        record.vote = vote;
        record.predictedUpBps = predictedUpBps;
        record.responseHash = responseHash;
        record.revealed = true;
        round.revealCount += 1;
        _roundRevealKeys[roundId].push(commitKey);

        emit RevealAccepted(roundId, commitKey, vote, predictedUpBps, responseHash);
    }

    /// @notice Freeze the reveal set or enter a deterministic refund/compensation terminal path.
    function beginSettlement(uint256 roundId) external nonReentrant {
        Round storage round = _rounds[roundId];
        if (round.state != RoundState.Open && round.state != RoundState.Revealable) revert InvalidState();
        if (block.timestamp <= round.revealDeadline) revert InvalidDeadline();

        if (round.commitCount == 0) {
            _terminalRefund(roundId, round, RoundState.ZeroCommitRefund, 0, 0);
            return;
        }
        if (round.revealCount < round.minimumReveals) {
            if (round.revealCount == 0) {
                if (block.timestamp <= round.beaconFailureDeadline) revert InvalidDeadline();
                _terminalCompensation(roundId, round, RoundState.BeaconFailureCompensation, round.commitCount);
            } else {
                _terminalCompensation(roundId, round, RoundState.UnderQuorumCompensation, round.revealCount);
            }
            return;
        }

        round.frozenRevealCount = round.revealCount;
        round.state = RoundState.Aggregating;
        emit SettlementBegun(roundId, round.frozenRevealCount);
    }

    function processAggregate(uint256 roundId, uint32 cursor, uint32 count) external {
        Round storage round = _rounds[roundId];
        if (round.state != RoundState.Aggregating) revert InvalidState();
        if (cursor != round.aggregateCursor) revert CursorMismatch();
        if (count == 0) revert NothingToProcess();

        uint32 end = cursor + count;
        if (end > round.frozenRevealCount) end = round.frozenRevealCount;
        for (uint32 i = cursor; i < end; ++i) {
            round.upVotes += _commits[_roundRevealKeys[roundId][i]].vote;
        }
        round.aggregateCursor = end;
        if (end == round.frozenRevealCount) round.state = RoundState.Weighting;
        emit SettlementProgressed(roundId, round.state, end);
    }

    function processWeights(uint256 roundId, uint32 cursor, uint32 count) external {
        Round storage round = _rounds[roundId];
        if (round.state != RoundState.Weighting) revert InvalidState();
        if (cursor != round.weightCursor) revert CursorMismatch();
        if (count == 0) revert NothingToProcess();

        uint32 end = cursor + count;
        if (end > round.frozenRevealCount) end = round.frozenRevealCount;
        for (uint32 i = cursor; i < end; ++i) {
            CommitRecord storage record = _commits[_roundRevealKeys[roundId][i]];
            uint256 score = TokenlessScoring.accuracyScore(
                record.vote, record.predictedUpBps, round.upVotes, round.frozenRevealCount
            );
            record.accuracyScore = score;
            round.totalAccuracyScore += score;
        }
        round.weightCursor = end;
        emit SettlementProgressed(roundId, round.state, end);
    }

    function finalizeSettlement(uint256 roundId) external nonReentrant {
        Round storage round = _rounds[roundId];
        if (round.state != RoundState.Weighting || round.weightCursor != round.frozenRevealCount) {
            revert InvalidState();
        }

        round.state = RoundState.Finalized;
        round.claimDeadline = uint64(block.timestamp) + round.claimGracePeriod;
        usdc.safeTransfer(round.funder, round.attemptReserve);
        if (round.feeAmount != 0) usdc.safeTransfer(round.feeRecipient, round.feeAmount);

        emit RoundFinalized(roundId, round.totalAccuracyScore, round.claimDeadline);
    }

    /// @notice Claim a finalized payout. Anyone may execute; committed material fixes the recipient.
    function claim(bytes32 commitKey, address payoutAddress, bytes32 salt)
        external
        nonReentrant
        returns (uint256 amount)
    {
        CommitRecord storage record = _commits[commitKey];
        if (record.voteKey == address(0)) revert CommitNotFound();
        Round storage round = _rounds[record.roundId];
        if (round.state != RoundState.Finalized || !record.revealed || block.timestamp > round.claimDeadline) {
            revert NotClaimable();
        }
        amount = _claim(record, round, payoutAddress, salt, false);
        emit Claimed(record.roundId, commitKey, payoutAddress, amount);
    }

    /// @notice Claim capped accepted-work compensation after an incomplete panel.
    function claimCompensation(bytes32 commitKey, address payoutAddress, bytes32 salt)
        external
        nonReentrant
        returns (uint256 amount)
    {
        CommitRecord storage record = _commits[commitKey];
        if (record.voteKey == address(0)) revert CommitNotFound();
        Round storage round = _rounds[record.roundId];
        bool eligible = round.state == RoundState.BeaconFailureCompensation
            || (round.state == RoundState.UnderQuorumCompensation && record.revealed);
        if (!eligible || block.timestamp > round.claimDeadline) revert NotClaimable();

        amount = _claim(record, round, payoutAddress, salt, true);
        emit Claimed(record.roundId, commitKey, payoutAddress, amount);
    }

    /// @notice Return payout dust and stale unclaimed shares after the disclosed claim window.
    function returnStaleShares(uint256 roundId) external nonReentrant returns (uint256 amount) {
        Round storage round = _rounds[roundId];
        bool terminal = round.state == RoundState.Finalized || round.state == RoundState.UnderQuorumCompensation
            || round.state == RoundState.BeaconFailureCompensation;
        if (!terminal || round.staleReturned) revert InvalidState();
        if (block.timestamp <= round.claimDeadline) revert ClaimWindowOpen();

        round.staleReturned = true;
        uint256 allocation = round.state == RoundState.Finalized
            ? round.bountyAmount
            : round.compensationPerRecipient
                * (round.state == RoundState.UnderQuorumCompensation ? round.revealCount : round.commitCount);
        amount = allocation - round.totalPaid;
        if (amount != 0) usdc.safeTransfer(round.funder, amount);
        emit StaleSharesReturned(roundId, round.funder, amount);
    }

    /// @notice Funder escape before any work is accepted. Impossible after the first commit.
    function cancelEmptyRound(uint256 roundId) external nonReentrant {
        Round storage round = _rounds[roundId];
        if (msg.sender != round.funder) revert Unauthorized();
        if (round.state != RoundState.Open || round.commitCount != 0) revert InvalidState();
        _terminalRefund(roundId, round, RoundState.ZeroCommitRefund, 0, 0);
    }

    function getRound(uint256 roundId) external view returns (Round memory) {
        return _rounds[roundId];
    }

    function getCommit(bytes32 commitKey) external view returns (CommitRecord memory) {
        return _commits[commitKey];
    }

    function roundCommitKey(uint256 roundId, uint256 index) external view returns (bytes32) {
        return _roundCommitKeys[roundId][index];
    }

    function roundRevealKey(uint256 roundId, uint256 index) external view returns (bytes32) {
        return _roundRevealKeys[roundId][index];
    }

    function commitKeyFor(uint256 roundId, address voteKey) public pure returns (bytes32) {
        return keccak256(abi.encode(roundId, voteKey));
    }

    function payoutCommitmentFor(address payoutAddress, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(payoutAddress, salt));
    }

    function revealCommitment(
        uint256 roundId,
        address voteKey,
        uint8 vote,
        uint16 predictedUpBps,
        bytes32 responseHash,
        address payoutAddress,
        bytes32 salt
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(REVEAL_TYPEHASH, roundId, voteKey, vote, predictedUpBps, responseHash, payoutAddress, salt)
        );
    }

    function voucherDigest(Voucher calldata voucher) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    VOUCHER_TYPEHASH,
                    voucher.voteKey,
                    voucher.contentId,
                    voucher.roundId,
                    voucher.nullifier,
                    voucher.tierId,
                    voucher.issuerEpoch,
                    voucher.expiresAt
                )
            )
        );
    }

    function commitDigest(
        uint256 roundId,
        bytes32 sealedCommitment,
        bytes32 sealedPayloadHash,
        bytes32 payoutCommitment,
        bytes32 nullifier
    ) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(COMMIT_TYPEHASH, roundId, sealedCommitment, sealedPayloadHash, payoutCommitment, nullifier)
            )
        );
    }

    function previewPayout(bytes32 commitKey) external view returns (uint256) {
        CommitRecord storage record = _commits[commitKey];
        if (record.voteKey == address(0)) revert CommitNotFound();
        Round storage round = _rounds[record.roundId];
        if (round.state != RoundState.Finalized || !record.revealed) return 0;
        return _finalizedPayout(record, round);
    }

    function _claim(
        CommitRecord storage record,
        Round storage round,
        address payoutAddress,
        bytes32 salt,
        bool compensation
    ) private returns (uint256 amount) {
        if (record.claimed) revert AlreadyClaimed();
        if (payoutAddress == address(0) || record.payoutCommitment != payoutCommitmentFor(payoutAddress, salt)) {
            revert InvalidCommitment();
        }

        record.claimed = true;
        amount = compensation ? round.compensationPerRecipient : _finalizedPayout(record, round);
        round.totalPaid += amount;
        usdc.safeTransfer(payoutAddress, amount);
    }

    function _finalizedPayout(CommitRecord storage record, Round storage round) private view returns (uint256) {
        (uint256 basePool, uint256 bonusPool) = TokenlessScoring.pools(round.bountyAmount);
        uint256 baseShare = basePool / round.frozenRevealCount;
        uint256 bonusShare = round.totalAccuracyScore == 0
            ? bonusPool / round.frozenRevealCount
            : (bonusPool * record.accuracyScore) / round.totalAccuracyScore;
        return baseShare + bonusShare;
    }

    function _terminalCompensation(uint256 roundId, Round storage round, RoundState terminalState, uint32 recipients)
        private
    {
        uint256 totalCompensation = round.attemptCompensation * recipients;
        round.compensationPerRecipient = round.attemptCompensation;
        round.state = terminalState;
        round.claimDeadline = uint64(block.timestamp) + round.claimGracePeriod;

        uint256 funderRefund = round.bountyAmount + round.feeAmount + round.attemptReserve - totalCompensation;
        usdc.safeTransfer(round.funder, funderRefund);
        emit RoundTerminal(roundId, terminalState, funderRefund, totalCompensation);
    }

    function _terminalRefund(
        uint256 roundId,
        Round storage round,
        RoundState terminalState,
        uint256 compensation,
        uint256 retained
    ) private {
        round.state = terminalState;
        uint256 funderRefund = round.bountyAmount + round.feeAmount + round.attemptReserve - compensation - retained;
        usdc.safeTransfer(round.funder, funderRefund);
        emit RoundTerminal(roundId, terminalState, funderRefund, compensation);
    }

    function _validateTerms(RoundTerms calldata terms) private view {
        if (
            terms.contentId == bytes32(0) || terms.termsHash == bytes32(0) || terms.beaconNetworkHash == bytes32(0)
                || terms.beaconRound == 0 || terms.bountyAmount == 0
        ) {
            revert InvalidTerms();
        }
        if (
            terms.minimumReveals == 0 || terms.maximumCommits < terms.minimumReveals || terms.attemptCompensation == 0
                || terms.attemptReserve < terms.attemptCompensation * terms.maximumCommits
        ) revert InvalidTerms();
        if (
            terms.commitDeadline <= block.timestamp || terms.revealDeadline <= terms.commitDeadline
                || terms.beaconFailureDeadline < terms.revealDeadline || terms.claimGracePeriod == 0
        ) revert InvalidDeadline();
        if (terms.feeAmount > (terms.bountyAmount * MAX_FEE_BPS) / 10_000) revert InvalidTerms();
        if (terms.feeAmount != 0 && terms.feeRecipient == address(0)) revert InvalidAddress();
    }
}
