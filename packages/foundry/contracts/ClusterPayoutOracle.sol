// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IClusterPayoutOracle } from "./interfaces/IClusterPayoutOracle.sol";
import { IFrontendRegistry } from "./interfaces/IFrontendRegistry.sol";
import { IRoundPayoutSnapshotConsumer } from "./interfaces/IRoundPayoutSnapshotConsumer.sol";

/// @title ClusterPayoutOracle
/// @notice Optimistic oracle for correlation epoch snapshots and per-round payout weights.
/// @dev Fully bonded frontend operators can propose deterministic scorer outputs. Finalized roots gate
///      USDC/LREP payouts, but they do not affect voting settlement or the public rating result. The oracle is
///      intentionally not a fully per-snapshot economically secured oracle: proposers are accountable through the
///      FrontendRegistry's global LREP bond, public artifacts, challenge windows, governance arbitration, slashing,
///      reputation, and future fee loss. Challenge bonds are a USDC anti-spam mechanism.
contract ClusterPayoutOracle is IClusterPayoutOracle, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");

    bytes32 public constant CORRELATION_EPOCH_DOMAIN = keccak256("rateloop.correlation.epoch.v1");
    bytes32 public constant ROUND_SNAPSHOT_DOMAIN = keccak256("rateloop.correlation.round-payout.v1");
    bytes32 public constant PAYOUT_WEIGHT_DOMAIN = keccak256("rateloop.correlation.payout-weight.v1");

    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint8 public constant PAYOUT_DOMAIN_QUESTION_REWARD = 1;
    uint8 public constant PAYOUT_DOMAIN_LAUNCH_CREDIT = 2;
    uint64 public constant DEFAULT_CHALLENGE_WINDOW = 12 hours;
    uint64 public constant MAX_CHALLENGE_WINDOW = 3 days;
    uint256 public constant DEFAULT_CHALLENGE_BOND = 5e6;
    uint256 public constant MIN_CHALLENGE_BOND = 1e6;
    /// @dev Window after a round payout snapshot is finalized during which the arbiter can still
    ///      reject it, even if a consumer has already paid one or more claims against the cached
    ///      merkle root. Existing paid leaves stay paid (the consumer flips a `qualified` /
    ///      `earnedRewardCreditRecorded` flag); the rejection blocks all FUTURE claims because
    ///      the consumers' per-claim path calls `verifyPayoutWeight`, which returns false once the
    ///      snapshot status moves off `Finalized`. M-Oracle-2 from 2026-05-16 audit.
    uint64 public constant FINALIZATION_VETO_WINDOW = 7 days;

    error InvalidAddress();
    error InvalidBond();
    error InvalidSnapshot();
    error FrontendNotEligible();
    error SnapshotExists();
    error SnapshotNotFound();
    error SnapshotNotFinalizable();
    error SnapshotChallenged();
    error SnapshotFinalized();
    error SnapshotConsumed();
    error InvalidProof();

    struct CorrelationEpochSnapshot {
        uint64 epochId;
        uint64 fromRoundId;
        uint64 toRoundId;
        uint64 proposedAt;
        uint64 finalizedAt;
        address proposer;
        address challenger;
        bytes32 clusterRoot;
        bytes32 parameterHash;
        bytes32 artifactHash;
        string artifactURI;
        SnapshotStatus status;
        uint256 bond;
    }

    struct RoundPayoutProposal {
        RoundPayoutSnapshot snapshot;
        uint64 proposedAt;
        address consumer;
        address proposer;
        address challenger;
        bytes32 artifactHash;
        string artifactURI;
        // Accumulates challenge bonds posted against this proposal (paid out to proposer on
        // dismissal, to challenger on rejection). Zero after finalize / reject.
        uint256 bond;
        // Bond the proposer posted at proposal time. Today always zero (proposals are unbonded),
        // but the slot is reserved so that a future proposer-bond mechanism (see M-Oracle-1
        // mitigation) is auditable and clawback-able via rejectFinalizedRoundPayoutSnapshot.
        // L-Integrations-1 from 2026-05-16 audit.
        uint256 proposerBond;
    }

    uint64 public challengeWindow;
    uint256 public challengeBond;
    address public bondRecipient;
    IERC20 public immutable challengeBondToken;
    IFrontendRegistry public frontendRegistry;

    mapping(uint256 => CorrelationEpochSnapshot) private correlationEpochSnapshots;
    mapping(bytes32 => RoundPayoutProposal) private roundPayoutProposals;
    mapping(uint8 => address) public roundPayoutSnapshotConsumer;
    mapping(address => uint256) public pendingBondWithdrawals;
    mapping(bytes32 => bool) public rejectedRoundPayoutSnapshotConsumed;
    mapping(bytes32 => mapping(bytes32 => bool)) public rejectedRoundPayoutSnapshotRoots;
    /// @notice Tracks rejected correlation-epoch clusterRoots so an identical re-proposal
    ///         is blocked at proposeCorrelationEpoch — mirrors rejectedRoundPayoutSnapshotRoots
    ///         for the correlation-epoch path (L-Oracle-4).
    mapping(uint256 => mapping(bytes32 => bool)) public rejectedCorrelationEpochRoots;

    event OracleConfigUpdated(uint64 challengeWindow, uint256 challengeBond, address bondRecipient);
    event FrontendRegistryUpdated(address indexed frontendRegistry);
    event RoundPayoutSnapshotConsumerUpdated(uint8 indexed domain, address indexed consumer);
    event BondWithdrawalCredited(address indexed recipient, uint256 amount);
    event BondWithdrawn(address indexed account, address indexed recipient, uint256 amount);
    event CorrelationEpochProposed(
        uint64 indexed epochId,
        uint64 fromRoundId,
        uint64 toRoundId,
        address indexed frontendOperator,
        bytes32 clusterRoot,
        bytes32 parameterHash,
        bytes32 artifactHash,
        string artifactURI
    );
    event CorrelationEpochChallenged(uint64 indexed epochId, address indexed challenger, bytes32 reasonHash);
    event CorrelationEpochFinalized(uint64 indexed epochId, bytes32 clusterRoot, bytes32 parameterHash);
    event CorrelationEpochChallengeDismissed(uint64 indexed epochId, address indexed arbiter, bytes32 reasonHash);
    event CorrelationEpochRejected(uint64 indexed epochId, address indexed arbiter, bytes32 reasonHash);
    event RoundPayoutSnapshotProposed(
        bytes32 indexed snapshotKey,
        uint8 indexed domain,
        uint256 indexed rewardPoolId,
        uint256 contentId,
        uint256 roundId,
        uint64 correlationEpochId,
        address frontendOperator,
        uint32 rawEligibleVoters,
        uint32 effectiveParticipantUnits,
        uint256 totalClaimWeight,
        bytes32 weightRoot,
        bytes32 reasonRoot,
        bytes32 artifactHash,
        string artifactURI
    );
    event RoundPayoutSnapshotChallenged(bytes32 indexed snapshotKey, address indexed challenger, bytes32 reasonHash);
    event RoundPayoutSnapshotFinalized(
        bytes32 indexed snapshotKey,
        uint8 indexed domain,
        uint256 indexed rewardPoolId,
        uint256 contentId,
        uint256 roundId,
        uint64 correlationEpochId
    );
    event RoundPayoutSnapshotChallengeDismissed(
        bytes32 indexed snapshotKey, address indexed arbiter, bytes32 reasonHash
    );
    event RoundPayoutSnapshotRejected(bytes32 indexed snapshotKey, address indexed arbiter, bytes32 reasonHash);
    /// @notice Emitted when rejectFinalizedRoundPayoutSnapshot could not fully claw back the
    ///         proposer's bond (because the proposer already withdrew some/all of their pending
    ///         balance). Governance can act on this off-chain to recover residual liability.
    ///         L-Integrations-1 from 2026-05-16 audit.
    event ProposerBondUnrecoverable(bytes32 indexed snapshotKey, address indexed proposer, uint256 missingAmount);

    constructor(address admin, address newFrontendRegistry, address newChallengeBondToken) {
        if (admin == address(0) || newChallengeBondToken == address(0)) revert InvalidAddress();
        challengeBondToken = IERC20(newChallengeBondToken);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CONFIG_ROLE, admin);
        _grantRole(ARBITER_ROLE, admin);
        challengeWindow = DEFAULT_CHALLENGE_WINDOW;
        challengeBond = DEFAULT_CHALLENGE_BOND;
        bondRecipient = admin;
        _setFrontendRegistry(newFrontendRegistry);
        emit OracleConfigUpdated(DEFAULT_CHALLENGE_WINDOW, DEFAULT_CHALLENGE_BOND, admin);
    }

    // N-5: Intentionally no receive() function. The contract holds no ETH balance;
    // plain ETH sends already revert on missing receive(). A receive() { revert }
    // would signal an intent that selfdestruct force-feed can violate, but no logic
    // here reads address(this).balance so any forced ETH is dead weight rather than
    // a state-corrupting input.

    function setOracleConfig(uint64 newChallengeWindow, uint256 newChallengeBond, address newBondRecipient)
        external
        onlyRole(CONFIG_ROLE)
    {
        if (newChallengeWindow == 0 || newChallengeWindow > MAX_CHALLENGE_WINDOW) revert InvalidSnapshot();
        if (newBondRecipient == address(0)) revert InvalidAddress();
        if (newChallengeBond < MIN_CHALLENGE_BOND) revert InvalidBond();
        challengeWindow = newChallengeWindow;
        challengeBond = newChallengeBond;
        bondRecipient = newBondRecipient;
        emit OracleConfigUpdated(newChallengeWindow, newChallengeBond, newBondRecipient);
    }

    function setFrontendRegistry(address newFrontendRegistry) external onlyRole(CONFIG_ROLE) {
        _setFrontendRegistry(newFrontendRegistry);
    }

    function setRoundPayoutSnapshotConsumer(uint8 domain, address consumer) external onlyRole(CONFIG_ROLE) {
        if (!_isPayoutDomain(domain)) revert InvalidSnapshot();
        if (consumer == address(0) || consumer.code.length == 0) revert InvalidAddress();
        roundPayoutSnapshotConsumer[domain] = consumer;
        emit RoundPayoutSnapshotConsumerUpdated(domain, consumer);
    }

    function proposeCorrelationEpoch(
        uint64 epochId,
        uint64 fromRoundId,
        uint64 toRoundId,
        bytes32 clusterRoot,
        bytes32 parameterHash,
        bytes32 artifactHash,
        string calldata artifactURI
    ) external payable {
        if (epochId == 0 || toRoundId < fromRoundId || clusterRoot == bytes32(0) || parameterHash == bytes32(0)) {
            revert InvalidSnapshot();
        }
        if (msg.value != 0) revert InvalidBond();
        _requireEligibleFrontendProposer();
        CorrelationEpochSnapshot storage existing = correlationEpochSnapshots[epochId];
        if (existing.status != SnapshotStatus.None && existing.status != SnapshotStatus.Rejected) {
            revert SnapshotExists();
        }
        // L-Oracle-4: block identical re-proposal of a previously rejected clusterRoot.
        if (rejectedCorrelationEpochRoots[epochId][clusterRoot]) revert InvalidSnapshot();

        correlationEpochSnapshots[epochId] = CorrelationEpochSnapshot({
            epochId: epochId,
            fromRoundId: fromRoundId,
            toRoundId: toRoundId,
            proposedAt: block.timestamp.toUint64(),
            finalizedAt: 0,
            proposer: msg.sender,
            challenger: address(0),
            clusterRoot: clusterRoot,
            parameterHash: parameterHash,
            artifactHash: artifactHash,
            artifactURI: artifactURI,
            status: SnapshotStatus.Proposed,
            bond: 0
        });

        emit CorrelationEpochProposed(
            epochId, fromRoundId, toRoundId, msg.sender, clusterRoot, parameterHash, artifactHash, artifactURI
        );
    }

    function challengeCorrelationEpoch(uint64 epochId, bytes32 reasonHash) external payable nonReentrant {
        if (msg.value != 0) revert InvalidBond();
        CorrelationEpochSnapshot storage snapshot = correlationEpochSnapshots[epochId];
        if (snapshot.status == SnapshotStatus.None) revert SnapshotNotFound();
        if (snapshot.status != SnapshotStatus.Proposed) revert SnapshotNotFinalizable();
        if (block.timestamp >= uint256(snapshot.proposedAt) + uint256(challengeWindow)) {
            revert SnapshotNotFinalizable();
        }
        uint256 bond = challengeBond;
        // CEI: write state before pulling the bond so a malicious bond token cannot
        // observe a half-applied challenge mid-call.
        snapshot.status = SnapshotStatus.Challenged;
        snapshot.challenger = msg.sender;
        snapshot.bond += bond;
        if (bond > 0) challengeBondToken.safeTransferFrom(msg.sender, address(this), bond);
        emit CorrelationEpochChallenged(epochId, msg.sender, reasonHash);
    }

    function finalizeCorrelationEpoch(uint64 epochId) external {
        CorrelationEpochSnapshot storage snapshot = correlationEpochSnapshots[epochId];
        if (snapshot.status == SnapshotStatus.None) revert SnapshotNotFound();
        if (snapshot.status == SnapshotStatus.Challenged) revert SnapshotChallenged();
        if (
            snapshot.status != SnapshotStatus.Proposed
                || block.timestamp < uint256(snapshot.proposedAt) + uint256(challengeWindow)
        ) {
            revert SnapshotNotFinalizable();
        }
        snapshot.status = SnapshotStatus.Finalized;
        snapshot.finalizedAt = block.timestamp.toUint64();
        _creditBond(snapshot.proposer, snapshot.bond);
        snapshot.bond = 0;
        emit CorrelationEpochFinalized(epochId, snapshot.clusterRoot, snapshot.parameterHash);
    }

    function finalizeChallengedCorrelationEpoch(uint64 epochId, bytes32 reasonHash) external onlyRole(ARBITER_ROLE) {
        CorrelationEpochSnapshot storage snapshot = correlationEpochSnapshots[epochId];
        if (snapshot.status == SnapshotStatus.None) revert SnapshotNotFound();
        if (snapshot.status != SnapshotStatus.Challenged) revert SnapshotNotFinalizable();
        snapshot.status = SnapshotStatus.Finalized;
        snapshot.finalizedAt = block.timestamp.toUint64();
        _creditBond(snapshot.proposer, snapshot.bond);
        snapshot.bond = 0;
        emit CorrelationEpochChallengeDismissed(epochId, msg.sender, reasonHash);
        emit CorrelationEpochFinalized(epochId, snapshot.clusterRoot, snapshot.parameterHash);
    }

    function rejectCorrelationEpoch(uint64 epochId, bytes32 reasonHash) external onlyRole(ARBITER_ROLE) {
        CorrelationEpochSnapshot storage snapshot = correlationEpochSnapshots[epochId];
        if (snapshot.status == SnapshotStatus.None) revert SnapshotNotFound();
        if (snapshot.status == SnapshotStatus.Finalized) revert SnapshotFinalized();
        snapshot.status = SnapshotStatus.Rejected;
        // L-Oracle-4: blacklist the rejected root so identical re-proposal reverts.
        rejectedCorrelationEpochRoots[epochId][snapshot.clusterRoot] = true;
        address challenger = snapshot.challenger;
        uint256 bond = snapshot.bond;
        snapshot.bond = 0;
        if (bond > 0) _creditBond(challenger == address(0) ? bondRecipient : challenger, bond);
        emit CorrelationEpochRejected(epochId, msg.sender, reasonHash);
    }

    function proposeRoundPayoutSnapshot(RoundPayoutSnapshotInput calldata input) external payable {
        _validateRoundPayoutInput(input);
        if (msg.value != 0) revert InvalidBond();
        _requireEligibleFrontendProposer();
        CorrelationEpochSnapshot storage epoch = correlationEpochSnapshots[input.correlationEpochId];
        if (epoch.status != SnapshotStatus.Finalized) revert SnapshotNotFinalizable();
        if (input.roundId < epoch.fromRoundId || input.roundId > epoch.toRoundId) revert InvalidSnapshot();

        bytes32 snapshotKey = roundPayoutSnapshotKey(input.domain, input.rewardPoolId, input.contentId, input.roundId);
        if (rejectedRoundPayoutSnapshotRoots[snapshotKey][input.weightRoot]) revert InvalidSnapshot();
        RoundPayoutProposal storage existing = roundPayoutProposals[snapshotKey];
        if (existing.snapshot.status != SnapshotStatus.None && existing.snapshot.status != SnapshotStatus.Rejected) {
            revert SnapshotExists();
        }
        if (existing.snapshot.status == SnapshotStatus.Rejected && rejectedRoundPayoutSnapshotConsumed[snapshotKey]) {
            revert SnapshotConsumed();
        }
        address consumer = roundPayoutSnapshotConsumer[input.domain];
        if (consumer == address(0)) revert InvalidAddress();

        roundPayoutProposals[snapshotKey] = RoundPayoutProposal({
            snapshot: RoundPayoutSnapshot({
                snapshotKey: snapshotKey,
                domain: input.domain,
                correlationEpochId: input.correlationEpochId,
                finalizedAt: 0,
                rawEligibleVoters: input.rawEligibleVoters,
                effectiveParticipantUnits: input.effectiveParticipantUnits,
                rewardPoolId: input.rewardPoolId,
                contentId: input.contentId,
                roundId: input.roundId,
                totalClaimWeight: input.totalClaimWeight,
                weightRoot: input.weightRoot,
                reasonRoot: input.reasonRoot,
                status: SnapshotStatus.Proposed
            }),
            proposedAt: block.timestamp.toUint64(),
            consumer: consumer,
            proposer: msg.sender,
            challenger: address(0),
            artifactHash: input.artifactHash,
            artifactURI: input.artifactURI,
            bond: 0,
            proposerBond: 0
        });

        emit RoundPayoutSnapshotProposed(
            snapshotKey,
            input.domain,
            input.rewardPoolId,
            input.contentId,
            input.roundId,
            input.correlationEpochId,
            msg.sender,
            input.rawEligibleVoters,
            input.effectiveParticipantUnits,
            input.totalClaimWeight,
            input.weightRoot,
            input.reasonRoot,
            input.artifactHash,
            input.artifactURI
        );
    }

    function challengeRoundPayoutSnapshot(bytes32 snapshotKey, bytes32 reasonHash) external payable nonReentrant {
        if (msg.value != 0) revert InvalidBond();
        RoundPayoutProposal storage proposal = roundPayoutProposals[snapshotKey];
        if (proposal.snapshot.status == SnapshotStatus.None) revert SnapshotNotFound();
        if (proposal.snapshot.status != SnapshotStatus.Proposed) revert SnapshotNotFinalizable();
        if (block.timestamp >= uint256(proposal.proposedAt) + uint256(challengeWindow)) {
            revert SnapshotNotFinalizable();
        }
        uint256 bond = challengeBond;
        // CEI: write state before pulling the bond so a malicious bond token cannot
        // observe a half-applied challenge mid-call.
        proposal.snapshot.status = SnapshotStatus.Challenged;
        proposal.challenger = msg.sender;
        proposal.bond += bond;
        if (bond > 0) challengeBondToken.safeTransferFrom(msg.sender, address(this), bond);
        emit RoundPayoutSnapshotChallenged(snapshotKey, msg.sender, reasonHash);
    }

    function finalizeRoundPayoutSnapshot(bytes32 snapshotKey) external {
        RoundPayoutProposal storage proposal = roundPayoutProposals[snapshotKey];
        if (proposal.snapshot.status == SnapshotStatus.None) revert SnapshotNotFound();
        if (proposal.snapshot.status == SnapshotStatus.Challenged) revert SnapshotChallenged();
        if (
            proposal.snapshot.status != SnapshotStatus.Proposed
                || block.timestamp < uint256(proposal.proposedAt) + uint256(challengeWindow)
        ) {
            revert SnapshotNotFinalizable();
        }
        proposal.snapshot.status = SnapshotStatus.Finalized;
        proposal.snapshot.finalizedAt = block.timestamp.toUint64();
        // Return the proposer's own bond plus any challenge bonds awarded to them on finalization.
        // proposerBond is retained on the proposal slot so a later rejectFinalizedRoundPayoutSnapshot
        // can attempt to claw it back (L-Integrations-1).
        _creditBond(proposal.proposer, proposal.bond + proposal.proposerBond);
        proposal.bond = 0;
        emit RoundPayoutSnapshotFinalized(
            snapshotKey,
            proposal.snapshot.domain,
            proposal.snapshot.rewardPoolId,
            proposal.snapshot.contentId,
            proposal.snapshot.roundId,
            proposal.snapshot.correlationEpochId
        );
    }

    function finalizeChallengedRoundPayoutSnapshot(bytes32 snapshotKey, bytes32 reasonHash)
        external
        onlyRole(ARBITER_ROLE)
    {
        RoundPayoutProposal storage proposal = roundPayoutProposals[snapshotKey];
        if (proposal.snapshot.status == SnapshotStatus.None) revert SnapshotNotFound();
        if (proposal.snapshot.status != SnapshotStatus.Challenged) revert SnapshotNotFinalizable();
        proposal.snapshot.status = SnapshotStatus.Finalized;
        proposal.snapshot.finalizedAt = block.timestamp.toUint64();
        // See finalizeRoundPayoutSnapshot for the proposerBond rationale (L-Integrations-1).
        _creditBond(proposal.proposer, proposal.bond + proposal.proposerBond);
        proposal.bond = 0;
        emit RoundPayoutSnapshotChallengeDismissed(snapshotKey, msg.sender, reasonHash);
        emit RoundPayoutSnapshotFinalized(
            snapshotKey,
            proposal.snapshot.domain,
            proposal.snapshot.rewardPoolId,
            proposal.snapshot.contentId,
            proposal.snapshot.roundId,
            proposal.snapshot.correlationEpochId
        );
    }

    function rejectRoundPayoutSnapshot(bytes32 snapshotKey, bytes32 reasonHash) external onlyRole(ARBITER_ROLE) {
        RoundPayoutProposal storage proposal = roundPayoutProposals[snapshotKey];
        if (proposal.snapshot.status == SnapshotStatus.None) revert SnapshotNotFound();
        if (proposal.snapshot.status == SnapshotStatus.Finalized) revert SnapshotFinalized();
        proposal.snapshot.status = SnapshotStatus.Rejected;
        rejectedRoundPayoutSnapshotRoots[snapshotKey][proposal.snapshot.weightRoot] = true;
        address challenger = proposal.challenger;
        uint256 bond = proposal.bond;
        proposal.bond = 0;
        if (bond > 0) _creditBond(challenger == address(0) ? bondRecipient : challenger, bond);
        // L-Integrations-1: the proposer's bond (if any) is forfeited on pre-finalize rejection
        // and routed to bondRecipient. Today proposerBond is zero so this is a no-op.
        uint256 proposerBondAmount = proposal.proposerBond;
        if (proposerBondAmount > 0) {
            proposal.proposerBond = 0;
            _creditBond(bondRecipient, proposerBondAmount);
        }
        emit RoundPayoutSnapshotRejected(snapshotKey, msg.sender, reasonHash);
    }

    /// @notice Reject a finalized round payout snapshot. Allowed in two cases:
    ///         (a) the consumer reports the snapshot has not yet been consumed (fast-path, no time
    ///             limit — already-paid leaves are not possible);
    ///         (b) the rejection happens within `FINALIZATION_VETO_WINDOW` after finalization, even
    ///             if the consumer reports the snapshot consumed. Already-paid leaves stay paid;
    ///             future claims revert because `verifyPayoutWeight` returns false for non-finalized
    ///             snapshots. M-Oracle-2 from 2026-05-16 audit.
    function rejectFinalizedRoundPayoutSnapshot(bytes32 snapshotKey, bytes32 reasonHash)
        external
        onlyRole(ARBITER_ROLE)
    {
        RoundPayoutProposal storage proposal = roundPayoutProposals[snapshotKey];
        RoundPayoutSnapshot memory snapshot = proposal.snapshot;
        if (snapshot.status == SnapshotStatus.None) revert SnapshotNotFound();
        if (snapshot.status != SnapshotStatus.Finalized) revert SnapshotNotFinalizable();
        address consumer = proposal.consumer;
        if (consumer == address(0)) revert InvalidAddress();

        bool withinVetoWindow = block.timestamp <= uint256(snapshot.finalizedAt) + uint256(FINALIZATION_VETO_WINDOW);
        bool consumed = IRoundPayoutSnapshotConsumer(consumer)
            .isRoundPayoutSnapshotConsumed(snapshot.domain, snapshot.rewardPoolId, snapshot.contentId, snapshot.roundId);
        if (!withinVetoWindow) {
            // Outside the veto window the rejection is only safe if the consumer has not yet paid
            // any claim against this snapshot's merkle root.
            if (consumed) {
                revert SnapshotConsumed();
            }
        }

        proposal.snapshot.status = SnapshotStatus.Rejected;
        rejectedRoundPayoutSnapshotRoots[snapshotKey][snapshot.weightRoot] = true;
        if (consumed) {
            rejectedRoundPayoutSnapshotConsumed[snapshotKey] = true;
        }
        // L-Integrations-1: attempt to claw back the proposer's bond. Today proposerBond is always
        // zero so this is a no-op; the logic is here so a future proposer-bond mechanism is
        // automatically accountable on post-finalization rejection. If the proposer already
        // withdrew (partial or full), emit ProposerBondUnrecoverable for governance follow-up
        // rather than reverting and stranding the rejection.
        uint256 proposerBondAmount = proposal.proposerBond;
        if (proposerBondAmount > 0) {
            address proposer = proposal.proposer;
            uint256 available = pendingBondWithdrawals[proposer];
            uint256 clawback = available < proposerBondAmount ? available : proposerBondAmount;
            if (clawback > 0) {
                pendingBondWithdrawals[proposer] = available - clawback;
                _creditBond(bondRecipient, clawback);
            }
            uint256 missing = proposerBondAmount - clawback;
            if (missing > 0) {
                emit ProposerBondUnrecoverable(snapshotKey, proposer, missing);
            }
            proposal.proposerBond = 0;
        }
        emit RoundPayoutSnapshotRejected(snapshotKey, msg.sender, reasonHash);
    }

    function withdrawBondCredit() external nonReentrant returns (uint256 amount) {
        return _withdrawBondCreditTo(msg.sender);
    }

    function withdrawBondCreditTo(address recipient) external nonReentrant returns (uint256 amount) {
        return _withdrawBondCreditTo(recipient);
    }

    function _withdrawBondCreditTo(address recipient) private returns (uint256 amount) {
        if (recipient == address(0)) revert InvalidAddress();
        amount = pendingBondWithdrawals[msg.sender];
        if (amount == 0) revert InvalidBond();
        pendingBondWithdrawals[msg.sender] = 0;
        challengeBondToken.safeTransfer(recipient, amount);
        emit BondWithdrawn(msg.sender, recipient, amount);
    }

    function correlationEpochSnapshot(uint64 epochId) external view returns (CorrelationEpochSnapshot memory) {
        return correlationEpochSnapshots[epochId];
    }

    function roundPayoutSnapshotKey(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(ROUND_SNAPSHOT_DOMAIN, domain, rewardPoolId, contentId, roundId));
    }

    function isRoundPayoutSnapshotFinalized(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        view
        returns (bool)
    {
        bytes32 snapshotKey = roundPayoutSnapshotKey(domain, rewardPoolId, contentId, roundId);
        return roundPayoutProposals[snapshotKey].snapshot.status == SnapshotStatus.Finalized;
    }

    function getRoundPayoutSnapshot(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        view
        returns (RoundPayoutSnapshot memory)
    {
        bytes32 snapshotKey = roundPayoutSnapshotKey(domain, rewardPoolId, contentId, roundId);
        RoundPayoutSnapshot memory snapshot = roundPayoutProposals[snapshotKey].snapshot;
        if (snapshot.status == SnapshotStatus.None) revert SnapshotNotFound();
        return snapshot;
    }

    function roundPayoutProposal(bytes32 snapshotKey) external view returns (RoundPayoutProposal memory) {
        return roundPayoutProposals[snapshotKey];
    }

    function verifyPayoutWeight(PayoutWeight calldata payout, bytes32[] calldata proof) external view returns (bool) {
        bytes32 snapshotKey =
            roundPayoutSnapshotKey(payout.domain, payout.rewardPoolId, payout.contentId, payout.roundId);
        RoundPayoutSnapshot memory snapshot = roundPayoutProposals[snapshotKey].snapshot;
        if (snapshot.status != SnapshotStatus.Finalized) return false;
        if (payout.independenceBps > BPS_DENOMINATOR) return false;
        if (payout.effectiveWeight > payout.baseWeight) return false;

        bytes32 leaf = payoutWeightLeaf(payout);
        return MerkleProof.verifyCalldata(proof, snapshot.weightRoot, leaf);
    }

    function payoutWeightLeaf(PayoutWeight calldata payout) public view returns (bytes32) {
        return keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        PAYOUT_WEIGHT_DOMAIN,
                        block.chainid,
                        address(this),
                        payout.domain,
                        payout.rewardPoolId,
                        payout.contentId,
                        payout.roundId,
                        payout.commitKey,
                        payout.identityKey,
                        payout.account,
                        payout.baseWeight,
                        payout.independenceBps,
                        payout.effectiveWeight,
                        payout.reasonHash
                    )
                )
            )
        );
    }

    function _validateRoundPayoutInput(RoundPayoutSnapshotInput calldata input) private pure {
        if (
            !_isPayoutDomain(input.domain) || input.contentId == 0 || input.roundId == 0
                || input.correlationEpochId == 0 || input.weightRoot == bytes32(0) || input.totalClaimWeight == 0
                || input.effectiveParticipantUnits > uint256(input.rawEligibleVoters) * BPS_DENOMINATOR
        ) {
            revert InvalidSnapshot();
        }
        if (input.domain == PAYOUT_DOMAIN_QUESTION_REWARD && input.rewardPoolId == 0) revert InvalidSnapshot();
        if (input.domain == PAYOUT_DOMAIN_LAUNCH_CREDIT && input.rewardPoolId != 0) revert InvalidSnapshot();
    }

    function _isPayoutDomain(uint8 domain) private pure returns (bool) {
        return domain == PAYOUT_DOMAIN_QUESTION_REWARD || domain == PAYOUT_DOMAIN_LAUNCH_CREDIT;
    }

    function _creditBond(address to, uint256 amount) private {
        if (amount == 0) return;
        pendingBondWithdrawals[to] += amount;
        emit BondWithdrawalCredited(to, amount);
    }

    function _setFrontendRegistry(address newFrontendRegistry) private {
        if (newFrontendRegistry == address(0)) revert InvalidAddress();
        frontendRegistry = IFrontendRegistry(newFrontendRegistry);
        emit FrontendRegistryUpdated(newFrontendRegistry);
    }

    function _requireEligibleFrontendProposer() private view {
        try frontendRegistry.isEligible(msg.sender) returns (bool eligible) {
            if (!eligible) revert FrontendNotEligible();
        } catch {
            revert FrontendNotEligible();
        }
    }
}
