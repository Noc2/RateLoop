// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IClusterPayoutOracle} from "./interfaces/IClusterPayoutOracle.sol";
import {IFrontendRegistry} from "./interfaces/IFrontendRegistry.sol";
import {IRoundPayoutSnapshotConsumer} from "./interfaces/IRoundPayoutSnapshotConsumer.sol";

/// @title ClusterPayoutOracle
/// @notice Optimistic oracle for correlation epoch snapshots and per-round effective weights.
/// @dev Fully bonded frontend operators can propose deterministic scorer outputs. Finalized roots gate
///      USDC/LREP payouts and delayed public rating updates. The oracle is
///      intentionally not a fully per-snapshot economically secured oracle: proposers are accountable through the
///      FrontendRegistry's global LREP bond, public artifacts, challenge windows, governance arbitration, slashing,
///      reputation, and future fee loss. Challenge bonds are a USDC anti-spam mechanism.
contract ClusterPayoutOracle is IClusterPayoutOracle, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");

    bytes32 public constant CORRELATION_EPOCH_DOMAIN = keccak256("rateloop.correlation.epoch.v1");
    bytes32 public constant CORRELATION_EPOCH_COVERAGE_DOMAIN = keccak256("rateloop.correlation.epoch.coverage.v1");
    bytes32 public constant CORRELATION_EPOCH_SOURCE_SET_DOMAIN = keccak256("rateloop.correlation.epoch.source-set.v1");
    bytes32 public constant CORRELATION_EPOCH_REJECTED_ROOT_DOMAIN =
        keccak256("rateloop.correlation.epoch.rejected-root.v1");
    bytes32 public constant ROUND_SNAPSHOT_DOMAIN = keccak256("rateloop.correlation.round-payout.v1");
    bytes32 public constant PAYOUT_WEIGHT_DOMAIN = keccak256("rateloop.correlation.payout-weight.v1");

    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint8 public constant PAYOUT_DOMAIN_QUESTION_REWARD = 1;
    uint8 public constant PAYOUT_DOMAIN_LAUNCH_CREDIT = 2;
    uint8 public constant PAYOUT_DOMAIN_PUBLIC_RATING = 3;
    uint8 public constant PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD = 4;
    uint64 public constant DEFAULT_CHALLENGE_WINDOW = 2 hours;
    uint64 public constant MAX_CHALLENGE_WINDOW = 3 days;
    uint256 public constant DEFAULT_CHALLENGE_BOND = 5e6;
    uint256 public constant MIN_CHALLENGE_BOND = 1e6;
    /// @dev Challenge bonds are anti-spam only, not payout-value coverage. Keep governance
    ///      rotations bounded so a bad config cannot price honest challengers out.
    uint256 public constant MAX_CHALLENGE_BOND = 100e6;
    uint256 public constant MAX_CORRELATION_EPOCH_SOURCES = 256;
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
    /// @notice M-Oracle-1: the registered consumer has not yet signalled that the round is
    ///         source-ready (settled and/or has at least one credit pending). Blocks gas-only
    ///         slot-squat proposals that would otherwise censor honest payouts.
    error SourceNotReady();

    struct CorrelationEpochSnapshot {
        uint64 epochId;
        uint64 fromRoundId;
        uint64 toRoundId;
        uint64 proposedAt;
        uint64 challengeWindowAtProposal;
        uint64 finalizedAt;
        address proposer;
        address frontendOperator;
        address challenger;
        bytes32 clusterRoot;
        bytes32 parameterHash;
        bytes32 artifactHash;
        string artifactURI;
        SnapshotStatus status;
        uint256 bond;
        uint256 challengeBondAtProposal;
        address proposalTimeSnapshotProposer;
    }

    struct RoundPayoutProposal {
        RoundPayoutSnapshot snapshot;
        uint64 proposedAt;
        uint64 challengeWindowAtProposal;
        address consumer;
        address proposer;
        address frontendOperator;
        address challenger;
        bytes32 artifactHash;
        string artifactURI;
        // Accumulates challenge bonds posted against this proposal (paid out to proposer on
        // dismissal, to challenger on rejection). Zero after finalize / reject.
        uint256 bond;
        uint256 challengeBondAtProposal;
        bytes32 correlationEpochDigest;
        address proposalTimeSnapshotProposer;
    }

    uint64 public challengeWindow;
    uint256 public challengeBond;
    address public bondRecipient;
    IERC20 public immutable challengeBondToken;
    IFrontendRegistry public frontendRegistry;

    mapping(uint256 => CorrelationEpochSnapshot) private correlationEpochSnapshots;
    mapping(bytes32 => RoundPayoutProposal) private roundPayoutProposals;
    mapping(uint8 => address) public roundPayoutSnapshotConsumer;
    mapping(uint256 => bytes32) public correlationEpochCoverageDigest;
    mapping(uint256 => bytes32) public correlationEpochSourceSetDigest;
    mapping(uint256 => mapping(bytes32 => bytes32)) public correlationEpochSnapshotCoverageDigest;
    mapping(address => uint256) public pendingBondWithdrawals;
    mapping(bytes32 => bool) public rejectedRoundPayoutSnapshotConsumed;
    /// @notice Exact rejected round-payout proposal payloads. Used when the arbiter rejects bad
    ///         metadata around a deterministic weightRoot without burning the root itself.
    mapping(bytes32 => mapping(bytes32 => bool)) public rejectedRoundPayoutSnapshotDigests;
    mapping(bytes32 => mapping(bytes32 => bool)) public rejectedRoundPayoutSnapshotRoots;
    /// @notice Exact rejected correlation-epoch proposal payloads. Used when the arbiter rejects
    ///         bad metadata around a deterministic clusterRoot without burning the root itself.
    mapping(uint256 => mapping(bytes32 => bool)) public rejectedCorrelationEpochSnapshotDigests;
    /// @notice Tracks rejected correlation-epoch clusterRoots so an identical re-proposal
    ///         is blocked at proposeCorrelationEpoch — mirrors rejectedRoundPayoutSnapshotRoots
    ///         for the correlation-epoch path (L-Oracle-4).
    mapping(uint256 => mapping(bytes32 => bool)) public rejectedCorrelationEpochRoots;
    /// @notice Canonical rejected correlation roots keyed by range/source set/root, independent
    ///         of caller-chosen epochId.
    mapping(bytes32 => bool) public rejectedCorrelationEpochRootKeys;

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
        address indexed proposer,
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
        address proposer,
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

    constructor(address admin, address newFrontendRegistry, address newChallengeBondToken) {
        if (admin == address(0) || newChallengeBondToken == address(0) || newChallengeBondToken.code.length == 0) {
            revert InvalidAddress();
        }
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
        if (newChallengeBond < MIN_CHALLENGE_BOND || newChallengeBond > MAX_CHALLENGE_BOND) revert InvalidBond();
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
        bool supportsDomain;
        try IRoundPayoutSnapshotConsumer(consumer).supportsRoundPayoutSnapshotDomain(domain) returns (bool supported) {
            supportsDomain = supported;
        } catch {
            revert InvalidAddress();
        }
        if (!supportsDomain) revert InvalidAddress();
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
        string calldata artifactURI,
        CorrelationEpochSourceRef[] calldata sourceRefs
    ) external payable {
        if (
            epochId == 0 || toRoundId < fromRoundId || clusterRoot == bytes32(0) || parameterHash == bytes32(0)
                || artifactHash == bytes32(0)
        ) {
            revert InvalidSnapshot();
        }
        if (msg.value != 0) revert InvalidBond();
        address frontendOperator = _requireEligibleFrontendProposer();
        CorrelationEpochSnapshot storage existing = correlationEpochSnapshots[epochId];
        if (existing.status != SnapshotStatus.None && existing.status != SnapshotStatus.Rejected) {
            revert SnapshotExists();
        }
        if (rejectedCorrelationEpochRoots[epochId][clusterRoot]) revert InvalidSnapshot();
        (bytes32 coverageDigest, bytes32 sourceSetDigest) =
            _requireCorrelationEpochSourcesReady(epochId, fromRoundId, toRoundId, sourceRefs);
        bytes32 proposalDigest = _correlationEpochDigest(
            epochId,
            fromRoundId,
            toRoundId,
            clusterRoot,
            parameterHash,
            artifactHash,
            keccak256(bytes(artifactURI)),
            coverageDigest
        );
        if (rejectedCorrelationEpochSnapshotDigests[epochId][proposalDigest]) revert InvalidSnapshot();
        // L-Oracle-4: block identical re-proposal of a previously rejected clusterRoot.
        if (rejectedCorrelationEpochRootKeys[correlationEpochRootKey(sourceSetDigest, clusterRoot)]) {
            revert InvalidSnapshot();
        }
        address proposalTimeSnapshotProposer = frontendRegistry.snapshotProposerForFrontend(frontendOperator);
        correlationEpochCoverageDigest[epochId] = coverageDigest;
        correlationEpochSourceSetDigest[epochId] = sourceSetDigest;

        correlationEpochSnapshots[epochId] = CorrelationEpochSnapshot({
            epochId: epochId,
            fromRoundId: fromRoundId,
            toRoundId: toRoundId,
            proposedAt: block.timestamp.toUint64(),
            challengeWindowAtProposal: challengeWindow,
            finalizedAt: 0,
            proposer: msg.sender,
            frontendOperator: frontendOperator,
            challenger: address(0),
            clusterRoot: clusterRoot,
            parameterHash: parameterHash,
            artifactHash: artifactHash,
            artifactURI: artifactURI,
            status: SnapshotStatus.Proposed,
            bond: 0,
            challengeBondAtProposal: challengeBond,
            proposalTimeSnapshotProposer: proposalTimeSnapshotProposer
        });

        emit CorrelationEpochProposed(
            epochId,
            fromRoundId,
            toRoundId,
            frontendOperator,
            msg.sender,
            clusterRoot,
            parameterHash,
            artifactHash,
            artifactURI
        );
    }

    function challengeCorrelationEpoch(uint64 epochId, bytes32 reasonHash) external payable nonReentrant {
        if (msg.value != 0) revert InvalidBond();
        CorrelationEpochSnapshot storage snapshot = correlationEpochSnapshots[epochId];
        if (snapshot.status == SnapshotStatus.None) revert SnapshotNotFound();
        if (snapshot.status != SnapshotStatus.Proposed) revert SnapshotNotFinalizable();
        if (block.timestamp >= _challengeDeadline(snapshot.proposedAt, snapshot.challengeWindowAtProposal)) {
            revert SnapshotNotFinalizable();
        }
        _requireDisinterestedChallenger(
            msg.sender, snapshot.proposer, snapshot.frontendOperator, snapshot.proposalTimeSnapshotProposer
        );
        uint256 bond = snapshot.challengeBondAtProposal;
        // CEI: write state before pulling the bond so a malicious bond token cannot
        // observe a half-applied challenge mid-call.
        snapshot.status = SnapshotStatus.Challenged;
        snapshot.challenger = msg.sender;
        snapshot.bond += bond;
        _pullExactChallengeBond(msg.sender, bond);
        emit CorrelationEpochChallenged(epochId, msg.sender, reasonHash);
    }

    function finalizeCorrelationEpoch(uint64 epochId) external {
        CorrelationEpochSnapshot storage snapshot = correlationEpochSnapshots[epochId];
        if (snapshot.status == SnapshotStatus.None) revert SnapshotNotFound();
        if (snapshot.status == SnapshotStatus.Challenged) revert SnapshotChallenged();
        if (
            snapshot.status != SnapshotStatus.Proposed
                || block.timestamp < _challengeDeadline(snapshot.proposedAt, snapshot.challengeWindowAtProposal)
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
        _rejectCorrelationEpoch(epochId, reasonHash, false);
    }

    /// @notice Reject a pre-finalized correlation epoch and explicitly blacklist its clusterRoot.
    /// @dev Use only when the root itself is invalid. Metadata-only rejections should use
    ///      `rejectCorrelationEpoch` so the deterministic root can be re-proposed with corrected
    ///      surrounding fields.
    function rejectCorrelationEpochRoot(uint64 epochId, bytes32 reasonHash) external onlyRole(ARBITER_ROLE) {
        _rejectCorrelationEpoch(epochId, reasonHash, true);
    }

    function _rejectCorrelationEpoch(uint64 epochId, bytes32 reasonHash, bool rejectRoot) private {
        CorrelationEpochSnapshot storage snapshot = correlationEpochSnapshots[epochId];
        if (snapshot.status == SnapshotStatus.None) revert SnapshotNotFound();
        if (snapshot.status == SnapshotStatus.Finalized) revert SnapshotFinalized();
        snapshot.status = SnapshotStatus.Rejected;
        rejectedCorrelationEpochSnapshotDigests[epochId][_correlationEpochDigest(snapshot)] = true;
        // Metadata-only rejection clears bad surrounding fields without burning the deterministic
        // root. The explicit root path is reserved for invalid scorer output.
        if (rejectRoot) {
            _rejectCorrelationEpochRoot(snapshot);
        }
        address challenger = snapshot.challenger;
        uint256 bond = snapshot.bond;
        snapshot.bond = 0;
        if (bond > 0) _creditBond(challenger == address(0) ? bondRecipient : challenger, bond);
        emit CorrelationEpochRejected(epochId, msg.sender, reasonHash);
    }

    function rejectFinalizedCorrelationEpoch(uint64 epochId, bytes32 reasonHash) external onlyRole(ARBITER_ROLE) {
        _rejectFinalizedCorrelationEpoch(epochId, reasonHash, false);
    }

    /// @notice Reject a finalized correlation epoch and explicitly blacklist its clusterRoot.
    /// @dev Use only when the finalized root itself is invalid. Metadata-only rejections should use
    ///      `rejectFinalizedCorrelationEpoch` so the deterministic root can be re-proposed with
    ///      corrected surrounding fields.
    function rejectFinalizedCorrelationEpochRoot(uint64 epochId, bytes32 reasonHash) external onlyRole(ARBITER_ROLE) {
        _rejectFinalizedCorrelationEpoch(epochId, reasonHash, true);
    }

    function _rejectFinalizedCorrelationEpoch(uint64 epochId, bytes32 reasonHash, bool rejectRoot) private {
        CorrelationEpochSnapshot storage snapshot = correlationEpochSnapshots[epochId];
        if (snapshot.status == SnapshotStatus.None) revert SnapshotNotFound();
        if (snapshot.status != SnapshotStatus.Finalized) revert SnapshotNotFinalizable();
        if (block.timestamp > uint256(snapshot.finalizedAt) + uint256(FINALIZATION_VETO_WINDOW)) {
            revert SnapshotNotFinalizable();
        }

        snapshot.status = SnapshotStatus.Rejected;
        rejectedCorrelationEpochSnapshotDigests[epochId][_correlationEpochDigest(snapshot)] = true;
        if (rejectRoot) {
            _rejectCorrelationEpochRoot(snapshot);
        }
        emit CorrelationEpochRejected(epochId, msg.sender, reasonHash);
    }

    function proposeRoundPayoutSnapshot(RoundPayoutSnapshotInput calldata input) external payable {
        _validateRoundPayoutInput(input);
        if (msg.value != 0) revert InvalidBond();
        address frontendOperator = _requireEligibleFrontendProposer();
        CorrelationEpochSnapshot storage epoch = correlationEpochSnapshots[input.correlationEpochId];
        if (epoch.status != SnapshotStatus.Proposed && epoch.status != SnapshotStatus.Finalized) {
            revert SnapshotNotFinalizable();
        }
        if (input.roundId < epoch.fromRoundId || input.roundId > epoch.toRoundId) revert InvalidSnapshot();
        if (input.artifactHash != epoch.artifactHash) revert InvalidSnapshot();

        bytes32 snapshotKey = roundPayoutSnapshotKey(input.domain, input.rewardPoolId, input.contentId, input.roundId);
        bytes32 coverageDigest = correlationEpochCoverageDigest[input.correlationEpochId];
        if (
            coverageDigest == bytes32(0)
                || correlationEpochSnapshotCoverageDigest[input.correlationEpochId][snapshotKey] != coverageDigest
        ) {
            revert InvalidSnapshot();
        }
        if (rejectedRoundPayoutSnapshotRoots[snapshotKey][input.weightRoot]) revert InvalidSnapshot();
        bytes32 correlationEpochDigest = _correlationEpochDigest(epoch);
        if (rejectedRoundPayoutSnapshotDigests[
                snapshotKey
            ][_roundPayoutSnapshotInputDigest(snapshotKey, input, correlationEpochDigest)]) {
            revert InvalidSnapshot();
        }
        RoundPayoutProposal storage existing = roundPayoutProposals[snapshotKey];
        if (existing.snapshot.status != SnapshotStatus.None && existing.snapshot.status != SnapshotStatus.Rejected) {
            if (_isLiveCorrelationEpoch(existing.correlationEpochDigest, existing.snapshot.correlationEpochId)) {
                if (existing.snapshot.status == SnapshotStatus.Finalized) {
                    (bool consumed, bool consumedKnown) = _roundPayoutSnapshotConsumptionStatus(existing);
                    if (consumedKnown && consumed) revert SnapshotConsumed();
                    revert SnapshotExists();
                } else {
                    revert SnapshotExists();
                }
            } else {
                if (existing.snapshot.status == SnapshotStatus.Finalized) {
                    (bool consumed, bool consumedKnown) = _roundPayoutSnapshotConsumptionStatus(existing);
                    if (consumedKnown && consumed) revert SnapshotConsumed();
                }
                _rejectStaleRoundPayoutSnapshot(snapshotKey, existing);
            }
        }
        if (existing.snapshot.status == SnapshotStatus.Rejected && rejectedRoundPayoutSnapshotConsumed[snapshotKey]) {
            revert SnapshotConsumed();
        }
        address consumer = roundPayoutSnapshotConsumer[input.domain];
        if (consumer == address(0)) revert InvalidAddress();
        address proposalTimeSnapshotProposer = frontendRegistry.snapshotProposerForFrontend(frontendOperator);

        // M-Oracle-1: require the consumer to signal source readiness before accepting the
        // proposal. Without this gate any eligible frontend can squat the snapshot slot for a
        // future round at gas cost only and stall payouts for the duration of the challenge
        // window plus arbiter response time. A reverting / non-conforming consumer view is
        // treated as not-ready so a misconfigured consumer cannot itself become a DoS vector.
        try IRoundPayoutSnapshotConsumer(consumer)
            .roundPayoutSnapshotSourceReadyAt(
                input.domain, input.rewardPoolId, input.contentId, input.roundId
            ) returns (
            uint64 sourceReadyAt
        ) {
            if (sourceReadyAt == 0 || uint256(sourceReadyAt) > block.timestamp) revert SourceNotReady();
        } catch {
            revert SourceNotReady();
        }

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
            challengeWindowAtProposal: challengeWindow,
            consumer: consumer,
            proposer: msg.sender,
            frontendOperator: frontendOperator,
            challenger: address(0),
            artifactHash: input.artifactHash,
            artifactURI: input.artifactURI,
            bond: 0,
            challengeBondAtProposal: challengeBond,
            correlationEpochDigest: correlationEpochDigest,
            proposalTimeSnapshotProposer: proposalTimeSnapshotProposer
        });

        emit RoundPayoutSnapshotProposed(
            snapshotKey,
            input.domain,
            input.rewardPoolId,
            input.contentId,
            input.roundId,
            input.correlationEpochId,
            frontendOperator,
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
        if (!_isLiveCorrelationEpoch(proposal.correlationEpochDigest, proposal.snapshot.correlationEpochId)) {
            revert SnapshotNotFinalizable();
        }
        if (block.timestamp >= _challengeDeadline(proposal.proposedAt, proposal.challengeWindowAtProposal)) {
            revert SnapshotNotFinalizable();
        }
        _requireDisinterestedChallenger(
            msg.sender, proposal.proposer, proposal.frontendOperator, proposal.proposalTimeSnapshotProposer
        );
        uint256 bond = proposal.challengeBondAtProposal;
        // CEI: write state before pulling the bond so a malicious bond token cannot
        // observe a half-applied challenge mid-call.
        proposal.snapshot.status = SnapshotStatus.Challenged;
        proposal.challenger = msg.sender;
        proposal.bond += bond;
        _pullExactChallengeBond(msg.sender, bond);
        emit RoundPayoutSnapshotChallenged(snapshotKey, msg.sender, reasonHash);
    }

    function finalizeRoundPayoutSnapshot(bytes32 snapshotKey) external {
        RoundPayoutProposal storage proposal = roundPayoutProposals[snapshotKey];
        if (proposal.snapshot.status == SnapshotStatus.None) revert SnapshotNotFound();
        if (proposal.snapshot.status == SnapshotStatus.Challenged) revert SnapshotChallenged();
        if (
            proposal.snapshot.status != SnapshotStatus.Proposed
                || block.timestamp < _challengeDeadline(proposal.proposedAt, proposal.challengeWindowAtProposal)
        ) {
            revert SnapshotNotFinalizable();
        }
        _requireCurrentCorrelationEpoch(proposal.correlationEpochDigest, proposal.snapshot.correlationEpochId);
        proposal.snapshot.status = SnapshotStatus.Finalized;
        proposal.snapshot.finalizedAt = block.timestamp.toUint64();
        // Return the proposer's own bond plus any challenge bonds awarded to them on finalization.
        _creditBond(proposal.proposer, proposal.bond);
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
        _requireCurrentCorrelationEpoch(proposal.correlationEpochDigest, proposal.snapshot.correlationEpochId);
        proposal.snapshot.status = SnapshotStatus.Finalized;
        proposal.snapshot.finalizedAt = block.timestamp.toUint64();
        _creditBond(proposal.proposer, proposal.bond);
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
        _rejectRoundPayoutSnapshot(snapshotKey, reasonHash, false);
    }

    /// @notice Reject a pre-finalized round payout snapshot and explicitly blacklist its weightRoot.
    /// @dev Use only when the root itself is invalid. Metadata-only rejections should use
    ///      `rejectRoundPayoutSnapshot` so the deterministic root can be re-proposed with corrected
    ///      surrounding fields.
    function rejectRoundPayoutSnapshotRoot(bytes32 snapshotKey, bytes32 reasonHash) external onlyRole(ARBITER_ROLE) {
        _rejectRoundPayoutSnapshot(snapshotKey, reasonHash, true);
    }

    function _rejectRoundPayoutSnapshot(bytes32 snapshotKey, bytes32 reasonHash, bool rejectRoot) private {
        RoundPayoutProposal storage proposal = roundPayoutProposals[snapshotKey];
        if (proposal.snapshot.status == SnapshotStatus.None) revert SnapshotNotFound();
        if (proposal.snapshot.status == SnapshotStatus.Finalized) revert SnapshotFinalized();
        proposal.snapshot.status = SnapshotStatus.Rejected;
        rejectedRoundPayoutSnapshotDigests[snapshotKey][_roundPayoutSnapshotProposalDigest(proposal)] = true;
        if (rejectRoot) {
            rejectedRoundPayoutSnapshotRoots[snapshotKey][proposal.snapshot.weightRoot] = true;
        }
        address challenger = proposal.challenger;
        uint256 bond = proposal.bond;
        proposal.bond = 0;
        if (bond > 0) _creditBond(challenger == address(0) ? bondRecipient : challenger, bond);
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
        _rejectFinalizedRoundPayoutSnapshot(snapshotKey, reasonHash, false);
    }

    /// @notice Reject a finalized round payout snapshot and explicitly blacklist its weightRoot.
    /// @dev Use only when the finalized root itself is invalid. Metadata-only rejections should use
    ///      `rejectFinalizedRoundPayoutSnapshot` so the deterministic root can be re-proposed with
    ///      corrected surrounding fields when the consumer has not consumed it.
    function rejectFinalizedRoundPayoutSnapshotRoot(bytes32 snapshotKey, bytes32 reasonHash)
        external
        onlyRole(ARBITER_ROLE)
    {
        _rejectFinalizedRoundPayoutSnapshot(snapshotKey, reasonHash, true);
    }

    function _rejectFinalizedRoundPayoutSnapshot(bytes32 snapshotKey, bytes32 reasonHash, bool rejectRoot) private {
        RoundPayoutProposal storage proposal = roundPayoutProposals[snapshotKey];
        RoundPayoutSnapshot memory snapshot = proposal.snapshot;
        if (snapshot.status == SnapshotStatus.None) revert SnapshotNotFound();
        if (snapshot.status != SnapshotStatus.Finalized) revert SnapshotNotFinalizable();
        address consumer = proposal.consumer;
        if (consumer == address(0)) revert InvalidAddress();

        bool withinVetoWindow = block.timestamp <= uint256(snapshot.finalizedAt) + uint256(FINALIZATION_VETO_WINDOW);
        // L-Oracle-B + L-Oracle-2: wrap the consumer call in try/catch so a broken / removed
        // consumer cannot trap the arbiter. Track `consumed` AND `consumedKnown` separately.
        // The catch path defaults to `consumed = true` to block out-of-veto rejection of
        // potentially-paid snapshots, but `consumedKnown = false` keeps us from permanently
        // killing the (key, weightRoot) slot via `rejectedRoundPayoutSnapshotConsumed` when we
        // don't actually know the consumer's state.
        bool consumed = false;
        bool consumedKnown = false;
        try IRoundPayoutSnapshotConsumer(consumer)
            .isRoundPayoutSnapshotConsumed(
                snapshot.domain, snapshot.rewardPoolId, snapshot.contentId, snapshot.roundId
            ) returns (
            bool isConsumed
        ) {
            consumed = isConsumed;
            consumedKnown = true;
        } catch {
            consumed = true;
        }
        if (!withinVetoWindow) {
            // Outside the veto window the rejection is only safe if the consumer has not yet paid
            // any claim against this snapshot's merkle root. A catch-path default of
            // `consumed=true` with `consumedKnown=false` must not block rejection when the
            // consumer view is broken or removed.
            if (consumedKnown && consumed) {
                revert SnapshotConsumed();
            }
        }

        proposal.snapshot.status = SnapshotStatus.Rejected;
        rejectedRoundPayoutSnapshotDigests[snapshotKey][_roundPayoutSnapshotProposalDigest(proposal)] = true;
        if (rejectRoot) {
            rejectedRoundPayoutSnapshotRoots[snapshotKey][snapshot.weightRoot] = true;
        }
        // L-Oracle-2: only mark the slot as permanently consumed-rejected when the consumer
        // call SUCCEEDED and returned true. The catch path's defensive default must not flag
        // the slot as dead.
        if (consumed && consumedKnown) {
            rejectedRoundPayoutSnapshotConsumed[snapshotKey] = true;
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

    function _pullExactChallengeBond(address challenger, uint256 bond) private {
        if (bond == 0) return;
        uint256 balanceBefore = challengeBondToken.balanceOf(address(this));
        challengeBondToken.safeTransferFrom(challenger, address(this), bond);
        if (challengeBondToken.balanceOf(address(this)) - balanceBefore != bond) revert InvalidBond();
    }

    function correlationEpochSnapshot(uint64 epochId) external view returns (CorrelationEpochSnapshot memory) {
        return correlationEpochSnapshots[epochId];
    }

    function correlationEpochProposalDigest(uint64 epochId) external view returns (bytes32) {
        CorrelationEpochSnapshot storage snapshot = correlationEpochSnapshots[epochId];
        if (snapshot.status == SnapshotStatus.None) revert SnapshotNotFound();
        return _correlationEpochDigest(snapshot);
    }

    function roundPayoutSnapshotKey(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(ROUND_SNAPSHOT_DOMAIN, domain, rewardPoolId, contentId, roundId));
    }

    function correlationEpochRootKey(bytes32 sourceSetDigest, bytes32 clusterRoot) public pure returns (bytes32) {
        return keccak256(abi.encode(CORRELATION_EPOCH_REJECTED_ROOT_DOMAIN, sourceSetDigest, clusterRoot));
    }

    function isRoundPayoutSnapshotFinalized(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        view
        returns (bool)
    {
        bytes32 snapshotKey = roundPayoutSnapshotKey(domain, rewardPoolId, contentId, roundId);
        RoundPayoutProposal memory proposal = roundPayoutProposals[snapshotKey];
        return proposal.snapshot.status == SnapshotStatus.Finalized
            && _isCurrentCorrelationEpoch(proposal.correlationEpochDigest, proposal.snapshot.correlationEpochId);
    }

    function getRoundPayoutSnapshot(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        view
        returns (RoundPayoutSnapshot memory)
    {
        bytes32 snapshotKey = roundPayoutSnapshotKey(domain, rewardPoolId, contentId, roundId);
        RoundPayoutProposal memory proposal = roundPayoutProposals[snapshotKey];
        RoundPayoutSnapshot memory snapshot = proposal.snapshot;
        if (snapshot.status == SnapshotStatus.None) revert SnapshotNotFound();
        if (
            _isLiveRoundPayoutStatus(snapshot.status)
                && !_isLiveCorrelationEpoch(proposal.correlationEpochDigest, snapshot.correlationEpochId)
        ) {
            snapshot.status = SnapshotStatus.Rejected;
        }
        return snapshot;
    }

    function roundPayoutSnapshotConsumerFor(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        view
        returns (address)
    {
        bytes32 snapshotKey = roundPayoutSnapshotKey(domain, rewardPoolId, contentId, roundId);
        return roundPayoutProposals[snapshotKey].consumer;
    }

    function roundPayoutSnapshotProposedAt(uint8 domain, uint256 rewardPoolId, uint256 contentId, uint256 roundId)
        external
        view
        returns (uint64)
    {
        bytes32 snapshotKey = roundPayoutSnapshotKey(domain, rewardPoolId, contentId, roundId);
        return roundPayoutProposals[snapshotKey].proposedAt;
    }

    function roundPayoutSnapshotProposalDigest(bytes32 snapshotKey) external view returns (bytes32) {
        RoundPayoutProposal storage proposal = roundPayoutProposals[snapshotKey];
        if (proposal.snapshot.status == SnapshotStatus.None) revert SnapshotNotFound();
        return _roundPayoutSnapshotProposalDigest(proposal);
    }

    function roundPayoutProposal(bytes32 snapshotKey) external view returns (RoundPayoutProposal memory) {
        return roundPayoutProposals[snapshotKey];
    }

    function verifyPayoutWeight(PayoutWeight calldata payout, bytes32[] calldata proof) external view returns (bool) {
        bytes32 snapshotKey =
            roundPayoutSnapshotKey(payout.domain, payout.rewardPoolId, payout.contentId, payout.roundId);
        RoundPayoutProposal memory proposal = roundPayoutProposals[snapshotKey];
        if (msg.sender != proposal.consumer) return false;
        RoundPayoutSnapshot memory snapshot = proposal.snapshot;
        if (snapshot.status != SnapshotStatus.Finalized) return false;
        if (!_isCurrentCorrelationEpoch(proposal.correlationEpochDigest, snapshot.correlationEpochId)) return false;
        if (snapshot.totalClaimWeight == 0 || snapshot.weightRoot == bytes32(0)) return false;
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

    function _roundPayoutSnapshotInputDigest(
        bytes32 snapshotKey,
        RoundPayoutSnapshotInput calldata input,
        bytes32 correlationEpochDigest
    ) private pure returns (bytes32) {
        return _roundPayoutSnapshotDigest(
            snapshotKey,
            input.domain,
            input.correlationEpochId,
            input.rawEligibleVoters,
            input.effectiveParticipantUnits,
            input.rewardPoolId,
            input.contentId,
            input.roundId,
            input.totalClaimWeight,
            input.weightRoot,
            input.reasonRoot,
            input.artifactHash,
            keccak256(bytes(input.artifactURI)),
            correlationEpochDigest
        );
    }

    function _roundPayoutSnapshotProposalDigest(RoundPayoutProposal storage proposal) private view returns (bytes32) {
        RoundPayoutSnapshot storage snapshot = proposal.snapshot;
        return _roundPayoutSnapshotDigest(
            snapshot.snapshotKey,
            snapshot.domain,
            snapshot.correlationEpochId,
            snapshot.rawEligibleVoters,
            snapshot.effectiveParticipantUnits,
            snapshot.rewardPoolId,
            snapshot.contentId,
            snapshot.roundId,
            snapshot.totalClaimWeight,
            snapshot.weightRoot,
            snapshot.reasonRoot,
            proposal.artifactHash,
            keccak256(bytes(proposal.artifactURI)),
            proposal.correlationEpochDigest
        );
    }

    function _roundPayoutSnapshotConsumptionStatus(RoundPayoutProposal storage proposal)
        private
        view
        returns (bool consumed, bool consumedKnown)
    {
        address consumer = proposal.consumer;
        if (consumer == address(0)) return (true, false);
        RoundPayoutSnapshot storage snapshot = proposal.snapshot;
        try IRoundPayoutSnapshotConsumer(consumer)
            .isRoundPayoutSnapshotConsumed(
                snapshot.domain, snapshot.rewardPoolId, snapshot.contentId, snapshot.roundId
            ) returns (
            bool isConsumed
        ) {
            return (isConsumed, true);
        } catch {
            return (true, false);
        }
    }

    function _rejectStaleRoundPayoutSnapshot(bytes32 snapshotKey, RoundPayoutProposal storage proposal) private {
        rejectedRoundPayoutSnapshotDigests[snapshotKey][_roundPayoutSnapshotProposalDigest(proposal)] = true;
        address challenger = proposal.challenger;
        uint256 bond = proposal.bond;
        proposal.snapshot.status = SnapshotStatus.Rejected;
        proposal.bond = 0;
        if (bond > 0) _creditBond(challenger == address(0) ? bondRecipient : challenger, bond);
    }

    function _roundPayoutSnapshotDigest(
        bytes32 snapshotKey,
        uint8 domain,
        uint64 correlationEpochId,
        uint32 rawEligibleVoters,
        uint32 effectiveParticipantUnits,
        uint256 rewardPoolId,
        uint256 contentId,
        uint256 roundId,
        uint256 totalClaimWeight,
        bytes32 weightRoot,
        bytes32 reasonRoot,
        bytes32 artifactHash,
        bytes32 artifactUriHash,
        bytes32 correlationEpochDigest
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ROUND_SNAPSHOT_DOMAIN,
                snapshotKey,
                domain,
                correlationEpochId,
                rawEligibleVoters,
                effectiveParticipantUnits,
                rewardPoolId,
                contentId,
                roundId,
                totalClaimWeight,
                weightRoot,
                reasonRoot,
                artifactHash,
                artifactUriHash,
                correlationEpochDigest
            )
        );
    }

    function _validateRoundPayoutInput(RoundPayoutSnapshotInput calldata input) private pure {
        if (
            !_isPayoutDomain(input.domain) || input.contentId == 0 || input.roundId == 0
                || input.correlationEpochId == 0 || input.artifactHash == bytes32(0)
                || input.effectiveParticipantUnits > uint256(input.rawEligibleVoters) * BPS_DENOMINATOR
        ) {
            revert InvalidSnapshot();
        }
        if (input.domain == PAYOUT_DOMAIN_PUBLIC_RATING && input.totalClaimWeight == 0) revert InvalidSnapshot();
        bool emptyPayout = input.totalClaimWeight == 0;
        if (emptyPayout) {
            if (input.effectiveParticipantUnits != 0 || input.weightRoot != bytes32(0)) revert InvalidSnapshot();
        } else {
            if (input.effectiveParticipantUnits == 0 || input.weightRoot == bytes32(0)) revert InvalidSnapshot();
        }
        if (
            (input.domain == PAYOUT_DOMAIN_QUESTION_REWARD || input.domain == PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD)
                && input.rewardPoolId == 0
        ) revert InvalidSnapshot();
        if (input.domain == PAYOUT_DOMAIN_LAUNCH_CREDIT && input.rewardPoolId != 0) revert InvalidSnapshot();
        if (input.domain == PAYOUT_DOMAIN_PUBLIC_RATING && input.rewardPoolId != 0) revert InvalidSnapshot();
    }

    function _requireCorrelationEpochSourcesReady(
        uint64 epochId,
        uint64 fromRoundId,
        uint64 toRoundId,
        CorrelationEpochSourceRef[] calldata sourceRefs
    ) private returns (bytes32 coverageDigest, bytes32 sourceSetDigest) {
        uint256 sourceCount = sourceRefs.length;
        if (sourceCount == 0 || sourceCount > MAX_CORRELATION_EPOCH_SOURCES) revert InvalidSnapshot();

        bytes32[] memory snapshotKeys = new bytes32[](sourceCount);

        for (uint256 i; i < sourceCount;) {
            CorrelationEpochSourceRef calldata sourceRef = sourceRefs[i];
            _validateCorrelationEpochSourceShape(sourceRef);
            if (sourceRef.roundId < fromRoundId || sourceRef.roundId > toRoundId) revert InvalidSnapshot();

            bytes32 snapshotKey = roundPayoutSnapshotKey(
                sourceRef.domain, sourceRef.rewardPoolId, sourceRef.contentId, sourceRef.roundId
            );
            address consumer = roundPayoutSnapshotConsumer[sourceRef.domain];
            if (consumer == address(0)) revert InvalidAddress();
            try IRoundPayoutSnapshotConsumer(consumer)
                .roundPayoutSnapshotSourceReadyAt(
                    sourceRef.domain, sourceRef.rewardPoolId, sourceRef.contentId, sourceRef.roundId
                ) returns (
                uint64 sourceReadyAt
            ) {
                if (sourceReadyAt == 0 || uint256(sourceReadyAt) > block.timestamp) revert SourceNotReady();
            } catch {
                revert SourceNotReady();
            }

            _insertSortedUniqueSnapshotKey(snapshotKeys, i, snapshotKey);
            unchecked {
                ++i;
            }
        }

        coverageDigest =
            keccak256(abi.encode(CORRELATION_EPOCH_COVERAGE_DOMAIN, epochId, fromRoundId, toRoundId, sourceCount));
        sourceSetDigest = keccak256(abi.encode(CORRELATION_EPOCH_SOURCE_SET_DOMAIN, sourceCount));
        for (uint256 i; i < sourceCount;) {
            bytes32 snapshotKey = snapshotKeys[i];
            coverageDigest = keccak256(abi.encode(coverageDigest, snapshotKey));
            sourceSetDigest = keccak256(abi.encode(sourceSetDigest, snapshotKey));
            unchecked {
                ++i;
            }
        }
        for (uint256 i; i < sourceCount;) {
            correlationEpochSnapshotCoverageDigest[epochId][snapshotKeys[i]] = coverageDigest;
            unchecked {
                ++i;
            }
        }
    }

    function _insertSortedUniqueSnapshotKey(bytes32[] memory snapshotKeys, uint256 length, bytes32 snapshotKey)
        private
        pure
    {
        uint256 insertAt = length;
        while (insertAt > 0 && uint256(snapshotKeys[insertAt - 1]) > uint256(snapshotKey)) {
            snapshotKeys[insertAt] = snapshotKeys[insertAt - 1];
            unchecked {
                --insertAt;
            }
        }
        if (insertAt > 0 && snapshotKeys[insertAt - 1] == snapshotKey) revert InvalidSnapshot();
        if (insertAt < length && snapshotKeys[insertAt] == snapshotKey) revert InvalidSnapshot();
        snapshotKeys[insertAt] = snapshotKey;
    }

    function _validateCorrelationEpochSourceShape(CorrelationEpochSourceRef calldata sourceRef) private pure {
        if (!_isPayoutDomain(sourceRef.domain) || sourceRef.contentId == 0 || sourceRef.roundId == 0) {
            revert InvalidSnapshot();
        }
        if (
            (sourceRef.domain == PAYOUT_DOMAIN_QUESTION_REWARD
                    || sourceRef.domain == PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD) && sourceRef.rewardPoolId == 0
        ) revert InvalidSnapshot();
        if (sourceRef.domain == PAYOUT_DOMAIN_LAUNCH_CREDIT && sourceRef.rewardPoolId != 0) revert InvalidSnapshot();
        if (sourceRef.domain == PAYOUT_DOMAIN_PUBLIC_RATING && sourceRef.rewardPoolId != 0) revert InvalidSnapshot();
    }

    function _isPayoutDomain(uint8 domain) private pure returns (bool) {
        return domain == PAYOUT_DOMAIN_QUESTION_REWARD || domain == PAYOUT_DOMAIN_LAUNCH_CREDIT
            || domain == PAYOUT_DOMAIN_PUBLIC_RATING || domain == PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD;
    }

    function _challengeDeadline(uint64 proposedAt, uint64 window) private pure returns (uint256) {
        return uint256(proposedAt) + uint256(window);
    }

    function _requireCurrentCorrelationEpoch(bytes32 expectedDigest, uint64 epochId) private view {
        if (!_isCurrentCorrelationEpoch(expectedDigest, epochId)) revert SnapshotNotFinalizable();
    }

    function _isCurrentCorrelationEpoch(bytes32 expectedDigest, uint64 epochId) private view returns (bool) {
        CorrelationEpochSnapshot storage snapshot = correlationEpochSnapshots[epochId];
        return snapshot.status == SnapshotStatus.Finalized && _correlationEpochDigest(snapshot) == expectedDigest;
    }

    function _isLiveCorrelationEpoch(bytes32 expectedDigest, uint64 epochId) private view returns (bool) {
        CorrelationEpochSnapshot storage snapshot = correlationEpochSnapshots[epochId];
        return _isLiveRoundPayoutStatus(snapshot.status) && _correlationEpochDigest(snapshot) == expectedDigest;
    }

    function _isLiveRoundPayoutStatus(SnapshotStatus status) private pure returns (bool) {
        return
            status == SnapshotStatus.Proposed || status == SnapshotStatus.Challenged
                || status == SnapshotStatus.Finalized;
    }

    function _correlationEpochDigest(CorrelationEpochSnapshot storage snapshot) private view returns (bytes32) {
        return _correlationEpochDigest(
            snapshot.epochId,
            snapshot.fromRoundId,
            snapshot.toRoundId,
            snapshot.clusterRoot,
            snapshot.parameterHash,
            snapshot.artifactHash,
            keccak256(bytes(snapshot.artifactURI)),
            correlationEpochCoverageDigest[snapshot.epochId]
        );
    }

    function _correlationEpochDigest(
        uint64 epochId,
        uint64 fromRoundId,
        uint64 toRoundId,
        bytes32 clusterRoot,
        bytes32 parameterHash,
        bytes32 artifactHash,
        bytes32 artifactUriHash,
        bytes32 coverageDigest
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                CORRELATION_EPOCH_DOMAIN,
                epochId,
                fromRoundId,
                toRoundId,
                clusterRoot,
                parameterHash,
                artifactHash,
                artifactUriHash,
                coverageDigest
            )
        );
    }

    function _rejectCorrelationEpochRoot(CorrelationEpochSnapshot storage snapshot) private {
        rejectedCorrelationEpochRoots[snapshot.epochId][snapshot.clusterRoot] = true;
        rejectedCorrelationEpochRootKeys[
            correlationEpochRootKey(correlationEpochSourceSetDigest[snapshot.epochId], snapshot.clusterRoot)
        ] = true;
    }

    function _requireDisinterestedChallenger(
        address challenger,
        address proposer,
        address frontendOperator,
        address proposalTimeSnapshotProposer
    ) private pure {
        if (
            challenger == proposer || challenger == frontendOperator
                || (proposalTimeSnapshotProposer != address(0) && challenger == proposalTimeSnapshotProposer)
        ) {
            revert InvalidSnapshot();
        }
    }

    function _creditBond(address to, uint256 amount) private {
        if (amount == 0) return;
        pendingBondWithdrawals[to] += amount;
        emit BondWithdrawalCredited(to, amount);
    }

    function _setFrontendRegistry(address newFrontendRegistry) private {
        if (newFrontendRegistry == address(0)) revert InvalidAddress();
        if (newFrontendRegistry.code.length == 0) revert InvalidAddress();
        try IFrontendRegistry(newFrontendRegistry).STAKE_AMOUNT() returns (uint256 stakeAmount) {
            if (stakeAmount == 0) revert InvalidAddress();
        } catch {
            revert InvalidAddress();
        }
        try IFrontendRegistry(newFrontendRegistry).isEligible(address(0)) returns (bool) {}
        catch {
            revert InvalidAddress();
        }
        try IFrontendRegistry(newFrontendRegistry).authorizedSnapshotFrontend(address(0)) returns (address) {}
        catch {
            revert InvalidAddress();
        }
        try IFrontendRegistry(newFrontendRegistry).snapshotProposerForFrontend(address(0)) returns (address) {}
        catch {
            revert InvalidAddress();
        }
        try IFrontendRegistry(newFrontendRegistry).isAuthorizedSnapshotProposer(address(0), address(0)) returns (
            bool
        ) {}
        catch {
            revert InvalidAddress();
        }
        frontendRegistry = IFrontendRegistry(newFrontendRegistry);
        emit FrontendRegistryUpdated(newFrontendRegistry);
    }

    function _requireEligibleFrontendProposer() private view returns (address frontendOperator) {
        try frontendRegistry.authorizedSnapshotFrontend(msg.sender) returns (address resolvedFrontend) {
            if (resolvedFrontend == address(0)) revert FrontendNotEligible();
            return resolvedFrontend;
        } catch {
            revert FrontendNotEligible();
        }
    }
}
