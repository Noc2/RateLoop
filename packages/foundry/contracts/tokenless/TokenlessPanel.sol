// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IBeaconVerifier } from "./interfaces/IBeaconVerifier.sol";
import { ICredentialIssuer } from "./interfaces/ICredentialIssuer.sol";
import { TokenlessRbts } from "./libraries/TokenlessRbts.sol";

/// @title TokenlessPanel
/// @notice Greenfield, immutable USDC custody and deterministic binary-panel settlement core.
/// @dev There is deliberately no owner, operator, pause, setter, sweep, payout root, or upgrade path.
///      The issuer can authorize future commits only; its state is never consulted after acceptance.
contract TokenlessPanel is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_FEE_BPS = 2_000;
    uint16 public constant BASE_PAY_BPS = 8_000;
    uint32 public constant MAXIMUM_COMMITS = 500;
    uint32 internal constant MAX_SEALED_PAYLOAD_BYTES = 16_384;
    uint64 public constant MAX_CLAIM_GRACE_PERIOD = 365 days;
    uint8 public constant SCORING_VERSION = 2;

    // Minimum operational windows and maximum custody-liveness horizons measured from creation.
    // The horizons bound how long a valid commit can wait before settlement becomes reachable, so
    // malformed or hostile terms cannot strand the bounty, attempt reserve, and accepted-work path.
    uint64 public constant MIN_COMMIT_WINDOW = 5 minutes;
    uint64 public constant MIN_REVEAL_WINDOW = 5 minutes;
    uint64 public constant MIN_BEACON_GRACE = 6 hours;
    uint64 public constant MAX_REVEAL_HORIZON = 90 days;
    uint64 public constant MAX_BEACON_FAILURE_HORIZON = 120 days;

    // OP Stack sequencer batches have a 3,600-L1-block sequencing window. At Ethereum's
    // 12-second slots that is nominally 12 hours; use twice that duration before selecting
    // scoring entropy. The post-closure property therefore assumes Ethereum produces at
    // least 3,600 canonical L1 blocks during this pinned 24-hour margin.
    uint64 public constant SCORING_BEACON_SAFETY_MARGIN = 24 hours;

    // The immutable deployment accepts only drand quicknet-t. Pinning the schedule makes
    // both disclosure and scoring timing independently checkable from the signed terms.
    bytes32 public constant QUICKNET_T_NETWORK_HASH =
        0xcc9c398442737cbd141526600919edd69f1d6f9b4adb67e4d912fbc64341a9a5;
    uint64 public constant QUICKNET_T_GENESIS = 1_689_232_296;
    uint64 public constant QUICKNET_T_PERIOD = 3;

    bytes32 public constant VOUCHER_TYPEHASH = keccak256(
        "Voucher(address voteKey,bytes32 contentId,uint256 roundId,bytes32 nullifier,bytes32 admissionPolicyHash,uint64 issuerEpoch,uint64 expiresAt)"
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
        AwaitingSeed,
        Scoring,
        Finalized,
        ZeroCommitRefund,
        UnderQuorumCompensation,
        BeaconFailureCompensation
    }

    enum ScoringMode {
        Pending,
        Rbts,
        BaseOnlyBeaconUnavailable
    }

    struct Voucher {
        address voteKey;
        bytes32 contentId;
        uint256 roundId;
        bytes32 nullifier;
        bytes32 admissionPolicyHash;
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
        bytes32 admissionPolicyHash;
        uint64 commitDeadline;
        uint64 revealDeadline;
        uint64 beaconFailureDeadline;
        /// @dev Tlock disclosure round, whose timestamp must be after the commit deadline.
        uint64 beaconRound;
        /// @dev Independent scoring-entropy round, whose timestamp must be after the reveal deadline.
        uint64 scoringBeaconRound;
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
        uint256 fixedBasePay;
        uint256 maximumBonus;
        uint256 compensationPerRecipient;
        uint256 totalRbtsScoreBps;
        uint256 totalFinalizedLiability;
        uint256 totalPaid;
        bytes32 revealSetXor;
        uint256 revealSetSum;
        bytes32 scoringSeed;
        bytes32 beaconEntropy;
        uint64 commitDeadline;
        uint64 revealDeadline;
        uint64 beaconFailureDeadline;
        uint64 beaconRound;
        uint64 scoringBeaconRound;
        uint64 claimGracePeriod;
        uint256 claimDeadline;
        uint32 minimumReveals;
        uint32 maximumCommits;
        bytes32 admissionPolicyHash;
        uint32 commitCount;
        uint32 revealCount;
        uint32 compensatedRevealCount;
        uint32 frozenRevealCount;
        uint32 aggregateCursor;
        uint32 scoreCursor;
        uint32 upVotes;
        RoundState state;
        ScoringMode scoringMode;
        bool staleReturned;
    }

    struct CommitRecord {
        uint256 roundId;
        address voteKey;
        bytes32 sealedCommitment;
        bytes32 sealedPayloadHash;
        bytes32 payoutCommitment;
        bytes32 responseHash;
        bytes32 referenceCommitKey;
        bytes32 peerCommitKey;
        uint256 finalizedPayout;
        uint16 predictedUpBps;
        uint16 informationScoreBps;
        uint16 predictionScoreBps;
        uint16 rbtsScoreBps;
        uint8 vote;
        bool revealed;
        bool claimed;
    }

    IERC20 public immutable usdc;
    ICredentialIssuer public immutable credentialIssuer;
    IBeaconVerifier public immutable beaconVerifier;

    uint256 public nextRoundId = 1;
    mapping(uint256 roundId => Round round) private _rounds;
    mapping(uint256 roundId => bytes32[] commitKeys) private _roundCommitKeys;
    mapping(uint256 roundId => bytes32[] revealKeys) private _roundRevealKeys;
    mapping(bytes32 commitKey => CommitRecord record) private _commits;
    mapping(bytes32 nullifier => bool used) public nullifierUsed;
    mapping(address recipient => uint256 amount) public withdrawableCredit;
    uint256 public totalWithdrawableCredit;

    event RoundCreated(
        uint256 indexed roundId,
        address indexed funder,
        bytes32 indexed contentId,
        bytes32 termsHash,
        bytes32 admissionPolicyHash,
        uint256 bountyAmount,
        uint256 feeAmount,
        uint256 attemptReserve,
        uint256 fixedBasePay,
        uint256 maximumBonus,
        uint8 scoringVersion
    );
    /// @dev `sealedPayload` is the public tlock ciphertext. Its signed hash is retained in state.
    event CommitAccepted(
        uint256 indexed roundId, bytes32 indexed commitKey, bytes32 indexed nullifier, bytes sealedPayload
    );
    event RevealAccepted(
        uint256 indexed roundId,
        bytes32 indexed commitKey,
        uint8 vote,
        uint16 predictedUpBps,
        bytes32 responseHash,
        bool scoringEligible
    );
    event SettlementBegun(uint256 indexed roundId, uint32 frozenRevealCount, uint64 scoringBeaconRound);
    event SettlementProgressed(uint256 indexed roundId, RoundState indexed state, uint32 cursor);
    event ScoringSeedFinalized(
        uint256 indexed roundId,
        ScoringMode indexed mode,
        uint64 scoringBeaconRound,
        bytes32 entropy,
        bytes32 scoringSeed,
        bytes32 revealSetXor,
        uint256 revealSetSum
    );
    event RevealScored(
        uint256 indexed roundId,
        bytes32 indexed commitKey,
        bytes32 referenceCommitKey,
        bytes32 peerCommitKey,
        uint16 informationScoreBps,
        uint16 predictionScoreBps,
        uint16 rbtsScoreBps,
        uint256 finalizedPayout
    );
    event RoundFinalized(
        uint256 indexed roundId,
        ScoringMode indexed mode,
        uint256 totalRbtsScoreBps,
        uint256 totalFinalizedLiability,
        uint256 funderRefund,
        uint256 claimDeadline
    );
    event RoundTerminal(uint256 indexed roundId, RoundState indexed state, uint256 funderRefund, uint256 compensation);
    event Claimed(uint256 indexed roundId, bytes32 indexed commitKey, address indexed payoutAddress, uint256 amount);
    event StaleSharesReturned(uint256 indexed roundId, address indexed funder, uint256 amount);
    event CreditAccrued(uint256 indexed roundId, address indexed recipient, uint256 amount);
    event CreditWithdrawn(address indexed recipient, address indexed destination, uint256 amount);

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
    error NoCredit();
    error InvalidBeaconProof();

    constructor(address usdc_, address credentialIssuer_, address beaconVerifier_)
        EIP712("RateLoop Tokenless Panel", "1")
    {
        if (
            usdc_ == address(0) || usdc_.code.length == 0 || credentialIssuer_ == address(0)
                || credentialIssuer_.code.length == 0 || beaconVerifier_ == address(0)
                || beaconVerifier_.code.length == 0
        ) revert InvalidAddress();
        usdc = IERC20(usdc_);
        credentialIssuer = ICredentialIssuer(credentialIssuer_);
        beaconVerifier = IBeaconVerifier(beaconVerifier_);
    }

    function createRound(RoundTerms calldata terms) external nonReentrant returns (uint256 roundId) {
        return _createRound(terms, msg.sender, msg.sender);
    }

    /// @notice Fund a round while assigning every refund and cancellation right to `funder`.
    function createRoundFor(RoundTerms calldata terms, address funder) external nonReentrant returns (uint256 roundId) {
        if (funder == address(0)) revert InvalidAddress();
        return _createRound(terms, msg.sender, funder);
    }

    function _createRound(RoundTerms calldata terms, address payer, address funder) private returns (uint256 roundId) {
        (uint256 fixedBasePay, uint256 maximumBonus) = _validateTerms(terms);

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
        round.fixedBasePay = fixedBasePay;
        round.maximumBonus = maximumBonus;
        round.minimumReveals = terms.minimumReveals;
        round.maximumCommits = terms.maximumCommits;
        round.admissionPolicyHash = terms.admissionPolicyHash;
        round.commitDeadline = terms.commitDeadline;
        round.revealDeadline = terms.revealDeadline;
        round.beaconFailureDeadline = terms.beaconFailureDeadline;
        round.beaconRound = terms.beaconRound;
        round.scoringBeaconRound = terms.scoringBeaconRound;
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
            terms.admissionPolicyHash,
            terms.bountyAmount,
            terms.feeAmount,
            terms.attemptReserve,
            fixedBasePay,
            maximumBonus,
            SCORING_VERSION
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
                || voucher.admissionPolicyHash != round.admissionPolicyHash || voucher.expiresAt < block.timestamp
                || sealedCommitment == bytes32(0) || sealedPayload.length == 0
                || sealedPayload.length > MAX_SEALED_PAYLOAD_BYTES || payoutCommitment == bytes32(0)
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
            referenceCommitKey: 0,
            peerCommitKey: 0,
            finalizedPayout: 0,
            predictedUpBps: 0,
            informationScoreBps: 0,
            predictionScoreBps: 0,
            rbtsScoreBps: 0,
            vote: 0,
            revealed: false,
            claimed: false
        });

        emit CommitAccepted(voucher.roundId, commitKey, voucher.nullifier, sealedPayload);
    }

    function openReveal(uint256 roundId) external {
        Round storage round = _rounds[roundId];
        if (round.state != RoundState.Open) revert InvalidState();
        if (block.timestamp <= round.commitDeadline || block.timestamp > round.beaconFailureDeadline) {
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
        if (block.timestamp > round.beaconFailureDeadline) revert InvalidDeadline();
        bool scoringEligible = block.timestamp <= round.revealDeadline;
        // Once the disclosed scoring window has closed with quorum, settlement can proceed
        // immediately and there is no incomplete-panel path left to compensate. Reject any
        // later opening instead of accepting work that healthy settlement would not pay.
        if (!scoringEligible && round.revealCount >= round.minimumReveals) {
            revert InvalidState();
        }
        if (vote > 1 || !TokenlessRbts.isValidUserPrediction(predictedUpBps)) revert InvalidPrediction();
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
        // Every accepted opening earns fixed accepted-work compensation, but only reveals at or
        // before the disclosed reveal deadline enter the frozen scoring set (quorum, majority
        // verdict, peer assignment, and RBTS). Late openings remain available only while the
        // timely scoring set is under quorum and therefore cannot change scored evidence.
        round.compensatedRevealCount += 1;
        if (scoringEligible) {
            round.revealCount += 1;
            _roundRevealKeys[roundId].push(commitKey);
        }

        emit RevealAccepted(roundId, commitKey, vote, predictedUpBps, responseHash, scoringEligible);
    }

    /// @notice Freeze the reveal set or enter a deterministic refund/compensation terminal path.
    function beginSettlement(uint256 roundId) external nonReentrant {
        Round storage round = _rounds[roundId];
        if (round.state != RoundState.Open && round.state != RoundState.Revealable) revert InvalidState();
        if (block.timestamp <= round.revealDeadline) revert InvalidDeadline();

        if (round.commitCount == 0) {
            _terminalRefund(roundId, round, RoundState.ZeroCommitRefund);
            return;
        }
        if (round.revealCount < round.minimumReveals) {
            if (block.timestamp <= round.beaconFailureDeadline) revert InvalidDeadline();
            // Quorum is measured on the timely scoring set, but every valid revealer (timely or
            // late) is compensated for accepted work. A beacon failure is the case where nobody
            // revealed at all; any valid opening moves the round to under-quorum compensation.
            if (round.compensatedRevealCount == 0) {
                _terminalCompensation(roundId, round, RoundState.BeaconFailureCompensation, 0);
            } else {
                _terminalCompensation(roundId, round, RoundState.UnderQuorumCompensation, round.compensatedRevealCount);
            }
            return;
        }

        round.frozenRevealCount = round.revealCount;
        round.state = RoundState.Aggregating;
        emit SettlementBegun(roundId, round.frozenRevealCount, round.scoringBeaconRound);
    }

    /// @notice Paginate the public vote aggregate and order-independent frozen-set commitment.
    function processAggregate(uint256 roundId, uint32 cursor, uint32 count) external {
        Round storage round = _rounds[roundId];
        if (round.state != RoundState.Aggregating) revert InvalidState();
        if (cursor != round.aggregateCursor) revert CursorMismatch();
        if (count == 0) revert NothingToProcess();

        uint32 end = _batchEnd(cursor, count, round.frozenRevealCount);
        for (uint32 i = cursor; i < end; ++i) {
            bytes32 commitKey = _roundRevealKeys[roundId][i];
            round.upVotes += _commits[commitKey].vote;
            (round.revealSetXor, round.revealSetSum) =
                TokenlessRbts.accumulateRevealSet(round.revealSetXor, round.revealSetSum, commitKey);
        }
        round.aggregateCursor = end;
        if (end == round.frozenRevealCount) round.state = RoundState.AwaitingSeed;
        emit SettlementProgressed(roundId, round.state, end);
    }

    /// @notice Verify the round's frozen public-beacon output and derive the canonical scoring order.
    /// @dev The immutable verifier must bind the randomness to the exact network hash and scoring beacon round.
    ///      Invalid or unavailable proofs never substitute caller-selected entropy.
    function finalizeScoringSeed(uint256 roundId, bytes32 randomness, bytes calldata proof) external {
        Round storage round = _rounds[roundId];
        if (round.state != RoundState.AwaitingSeed) revert InvalidState();
        if (
            block.timestamp < _quicknetTimestamp(round.scoringBeaconRound)
                || block.timestamp > round.beaconFailureDeadline
        ) revert InvalidDeadline();
        if (randomness == bytes32(0)) revert InvalidBeaconProof();

        bool verified;
        try beaconVerifier.verifyBeacon(round.beaconNetworkHash, round.scoringBeaconRound, randomness, proof) returns (
            bool valid
        ) {
            verified = valid;
        } catch { }
        if (!verified) revert InvalidBeaconProof();

        round.scoringMode = ScoringMode.Rbts;
        round.beaconEntropy = randomness;
        round.scoringSeed = TokenlessRbts.scoringSeed(
            block.chainid,
            address(this),
            roundId,
            round.frozenRevealCount,
            round.revealSetXor,
            round.revealSetSum,
            randomness
        );

        // Sort the frozen keys once in O(n log n). Scoring pages can then select the
        // next and next-next reports in O(1), replacing the former O(n^2) scan.
        bytes32[] memory canonicalKeys = _roundRevealKeys[roundId];
        TokenlessRbts.sortCanonical(round.scoringSeed, canonicalKeys);
        for (uint32 i; i < round.frozenRevealCount; ++i) {
            _roundRevealKeys[roundId][i] = canonicalKeys[i];
        }
        round.state = RoundState.Scoring;
        emit ScoringSeedFinalized(
            roundId,
            round.scoringMode,
            round.scoringBeaconRound,
            randomness,
            round.scoringSeed,
            round.revealSetXor,
            round.revealSetSum
        );
    }

    /// @notice Enter the deterministic fixed-base path after the frozen beacon has missed its deadline.
    /// @dev Permissionless and bounded. The caller supplies no replacement entropy and every unused
    ///      quality bonus returns to the funder during normal finalization.
    function finalizeScoringFallback(uint256 roundId) external {
        Round storage round = _rounds[roundId];
        if (round.state != RoundState.AwaitingSeed) revert InvalidState();
        if (block.timestamp <= round.beaconFailureDeadline) revert InvalidDeadline();

        round.scoringMode = ScoringMode.BaseOnlyBeaconUnavailable;
        round.state = RoundState.Scoring;
        emit ScoringSeedFinalized(
            roundId,
            round.scoringMode,
            round.scoringBeaconRound,
            bytes32(0),
            bytes32(0),
            round.revealSetXor,
            round.revealSetSum
        );
    }

    /// @notice Paginate deterministic RBTS evidence and exact per-report liabilities.
    function processScores(uint256 roundId, uint32 cursor, uint32 count) external {
        Round storage round = _rounds[roundId];
        if (round.state != RoundState.Scoring) revert InvalidState();
        if (cursor != round.scoreCursor) revert CursorMismatch();
        if (count == 0) revert NothingToProcess();

        uint32 end = _batchEnd(cursor, count, round.frozenRevealCount);
        bytes32[] memory revealedCommitKeys;
        if (round.scoringMode == ScoringMode.Rbts) revealedCommitKeys = _roundRevealKeys[roundId];

        for (uint32 i = cursor; i < end; ++i) {
            bytes32 commitKey = _roundRevealKeys[roundId][i];
            CommitRecord storage record = _commits[commitKey];
            TokenlessRbts.Score memory result;

            if (round.scoringMode == ScoringMode.Rbts) {
                record.referenceCommitKey = revealedCommitKeys[(uint256(i) + 1) % round.frozenRevealCount];
                record.peerCommitKey = revealedCommitKeys[(uint256(i) + 2) % round.frozenRevealCount];
                CommitRecord storage referenceRecord = _commits[record.referenceCommitKey];
                CommitRecord storage peerRecord = _commits[record.peerCommitKey];
                result = TokenlessRbts.score(
                    record.vote, record.predictedUpBps, referenceRecord.predictedUpBps, peerRecord.vote
                );
                record.informationScoreBps = result.informationScoreBps;
                record.predictionScoreBps = result.predictionScoreBps;
                record.rbtsScoreBps = result.scoreBps;
            }

            record.finalizedPayout = round.fixedBasePay + ((round.maximumBonus * uint256(result.scoreBps)) / 10_000);
            round.totalRbtsScoreBps += result.scoreBps;
            round.totalFinalizedLiability += record.finalizedPayout;
            emit RevealScored(
                roundId,
                commitKey,
                record.referenceCommitKey,
                record.peerCommitKey,
                record.informationScoreBps,
                record.predictionScoreBps,
                record.rbtsScoreBps,
                record.finalizedPayout
            );
        }

        round.scoreCursor = end;
        emit SettlementProgressed(roundId, round.state, end);
    }

    function finalizeSettlement(uint256 roundId) external nonReentrant {
        Round storage round = _rounds[roundId];
        if (round.state != RoundState.Scoring || round.scoreCursor != round.frozenRevealCount) revert InvalidState();

        round.state = RoundState.Finalized;
        round.claimDeadline = block.timestamp + round.claimGracePeriod;
        uint256 funderRefund = round.attemptReserve + round.bountyAmount - round.totalFinalizedLiability;
        _accrueCredit(roundId, round.funder, funderRefund);
        _accrueCredit(roundId, round.feeRecipient, round.feeAmount);

        emit RoundFinalized(
            roundId,
            round.scoringMode,
            round.totalRbtsScoreBps,
            round.totalFinalizedLiability,
            funderRefund,
            round.claimDeadline
        );
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
        bool eligible =
            (round.state == RoundState.BeaconFailureCompensation || round.state == RoundState.UnderQuorumCompensation)
                && record.revealed;
        if (!eligible || block.timestamp > round.claimDeadline) revert NotClaimable();

        amount = _claim(record, round, payoutAddress, salt, true);
        emit Claimed(record.roundId, commitKey, payoutAddress, amount);
    }

    /// @notice Return stale unclaimed liabilities after the disclosed claim window.
    function returnStaleShares(uint256 roundId) external nonReentrant returns (uint256 amount) {
        Round storage round = _rounds[roundId];
        bool terminal = round.state == RoundState.Finalized || round.state == RoundState.UnderQuorumCompensation
            || round.state == RoundState.BeaconFailureCompensation;
        if (!terminal || round.staleReturned) revert InvalidState();
        if (block.timestamp <= round.claimDeadline) revert ClaimWindowOpen();

        round.staleReturned = true;
        uint256 allocation = round.state == RoundState.Finalized
            ? round.totalFinalizedLiability
            : round.compensationPerRecipient * round.compensatedRevealCount;
        amount = allocation - round.totalPaid;
        _accrueCredit(roundId, round.funder, amount);
        emit StaleSharesReturned(roundId, round.funder, amount);
    }

    /// @notice Withdraw caller-owned refund, fee, or stale-return credit to a caller-selected destination.
    function withdrawCredit(address destination) external nonReentrant returns (uint256 amount) {
        if (destination == address(0)) revert InvalidAddress();
        amount = withdrawableCredit[msg.sender];
        if (amount == 0) revert NoCredit();

        withdrawableCredit[msg.sender] = 0;
        totalWithdrawableCredit -= amount;
        _transferExact(destination, amount);

        emit CreditWithdrawn(msg.sender, destination, amount);
    }

    /// @notice Funder escape before any work is accepted. Impossible after the first commit.
    function cancelEmptyRound(uint256 roundId) external nonReentrant {
        Round storage round = _rounds[roundId];
        if (msg.sender != round.funder) revert Unauthorized();
        if (round.state != RoundState.Open || round.commitCount != 0) revert InvalidState();
        _terminalRefund(roundId, round, RoundState.ZeroCommitRefund);
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
                    voucher.admissionPolicyHash,
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
        return record.finalizedPayout;
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
        amount = compensation ? round.compensationPerRecipient : record.finalizedPayout;
        round.totalPaid += amount;
        _transferExact(payoutAddress, amount);
    }

    function _terminalCompensation(uint256 roundId, Round storage round, RoundState terminalState, uint32 recipients)
        private
    {
        uint256 totalCompensation = round.attemptCompensation * recipients;
        round.compensationPerRecipient = round.attemptCompensation;
        round.state = terminalState;
        round.claimDeadline = block.timestamp + round.claimGracePeriod;

        uint256 funderRefund = round.bountyAmount + round.feeAmount + round.attemptReserve - totalCompensation;
        _accrueCredit(roundId, round.funder, funderRefund);
        emit RoundTerminal(roundId, terminalState, funderRefund, totalCompensation);
    }

    function _terminalRefund(uint256 roundId, Round storage round, RoundState terminalState) private {
        round.state = terminalState;
        uint256 funderRefund = round.bountyAmount + round.feeAmount + round.attemptReserve;
        _accrueCredit(roundId, round.funder, funderRefund);
        emit RoundTerminal(roundId, terminalState, funderRefund, 0);
    }

    function _accrueCredit(uint256 roundId, address recipient, uint256 amount) private {
        if (amount == 0) return;
        withdrawableCredit[recipient] += amount;
        totalWithdrawableCredit += amount;
        emit CreditAccrued(roundId, recipient, amount);
    }

    function _transferExact(address recipient, uint256 amount) private {
        uint256 beforeBalance = usdc.balanceOf(address(this));
        usdc.safeTransfer(recipient, amount);
        if (beforeBalance - usdc.balanceOf(address(this)) != amount) revert TransferAmountMismatch();
    }

    function _batchEnd(uint32 cursor, uint32 count, uint32 maximum) private pure returns (uint32 end) {
        uint256 candidate = uint256(cursor) + count;
        end = candidate > maximum ? maximum : uint32(candidate);
    }

    function _validateTerms(RoundTerms calldata terms)
        private
        view
        returns (uint256 fixedBasePay, uint256 maximumBonus)
    {
        if (
            terms.contentId == bytes32(0) || terms.termsHash == bytes32(0)
                || terms.beaconNetworkHash != QUICKNET_T_NETWORK_HASH || terms.admissionPolicyHash == bytes32(0)
                || terms.beaconRound == 0 || terms.scoringBeaconRound == 0 || terms.bountyAmount == 0
        ) revert InvalidTerms();
        if (
            terms.minimumReveals < 3 || terms.maximumCommits < terms.minimumReveals
                || terms.maximumCommits > MAXIMUM_COMMITS
        ) revert InvalidTerms();

        uint256 maximumSeatPay = terms.bountyAmount / terms.maximumCommits;
        fixedBasePay = (maximumSeatPay * BASE_PAY_BPS) / 10_000;
        maximumBonus = maximumSeatPay - fixedBasePay;
        if (
            fixedBasePay == 0 || maximumBonus == 0 || terms.attemptCompensation != fixedBasePay
                || terms.attemptReserve < fixedBasePay * terms.maximumCommits
        ) revert InvalidTerms();
        uint64 expectedDisclosureBeaconRound = _firstQuicknetRoundAfter(terms.commitDeadline);
        uint256 protectedScoringCutoff = uint256(terms.revealDeadline) + SCORING_BEACON_SAFETY_MARGIN;
        uint64 expectedScoringBeaconRound = _firstQuicknetRoundAfter(protectedScoringCutoff);
        uint256 scoringBeaconTimestamp = _quicknetTimestamp(expectedScoringBeaconRound);
        if (
            uint256(terms.commitDeadline) < block.timestamp + MIN_COMMIT_WINDOW
                || uint256(terms.revealDeadline) < uint256(terms.commitDeadline) + MIN_REVEAL_WINDOW
                || terms.beaconRound != expectedDisclosureBeaconRound
                || terms.scoringBeaconRound != expectedScoringBeaconRound
                || uint256(terms.beaconFailureDeadline) < scoringBeaconTimestamp + MIN_BEACON_GRACE
                || terms.claimGracePeriod == 0 || terms.claimGracePeriod > MAX_CLAIM_GRACE_PERIOD
        ) revert InvalidDeadline();
        if (
            uint256(terms.revealDeadline) > block.timestamp + MAX_REVEAL_HORIZON
                || uint256(terms.beaconFailureDeadline) > block.timestamp + MAX_BEACON_FAILURE_HORIZON
        ) revert InvalidDeadline();
        if (terms.feeAmount > (terms.bountyAmount * MAX_FEE_BPS) / 10_000) revert InvalidTerms();
        if (terms.feeAmount != 0 && terms.feeRecipient == address(0)) revert InvalidAddress();
    }

    function _quicknetTimestamp(uint64 beaconRound_) private pure returns (uint256) {
        return uint256(QUICKNET_T_GENESIS) + (uint256(beaconRound_) - 1) * QUICKNET_T_PERIOD;
    }

    function _firstQuicknetRoundAfter(uint256 timestamp) private pure returns (uint64) {
        if (timestamp < QUICKNET_T_GENESIS) return 1;
        return uint64((timestamp - QUICKNET_T_GENESIS) / QUICKNET_T_PERIOD + 2);
    }
}
