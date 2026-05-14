// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IClusterPayoutOracle } from "./interfaces/IClusterPayoutOracle.sol";

/// @title ClusterPayoutOracle
/// @notice Optimistic oracle for correlation epoch snapshots and per-round payout weights.
/// @dev Anyone can propose deterministic scorer outputs. Finalized roots gate USDC/LREP payouts,
///      but they do not affect voting settlement or the public rating result.
contract ClusterPayoutOracle is IClusterPayoutOracle, AccessControl {
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
    uint256 public constant DEFAULT_PROPOSAL_BOND = 0.01 ether;

    error InvalidAddress();
    error InvalidBond();
    error InvalidSnapshot();
    error SnapshotExists();
    error SnapshotNotFound();
    error SnapshotNotFinalizable();
    error SnapshotChallenged();
    error SnapshotFinalized();
    error InvalidProof();
    error TransferFailed();

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
        address proposer;
        address challenger;
        bytes32 artifactHash;
        string artifactURI;
        uint256 bond;
    }

    uint64 public challengeWindow;
    uint256 public proposalBond;
    address public bondRecipient;

    mapping(uint256 => CorrelationEpochSnapshot) private correlationEpochSnapshots;
    mapping(bytes32 => RoundPayoutProposal) private roundPayoutProposals;
    mapping(address => uint256) public pendingBondWithdrawals;

    event OracleConfigUpdated(uint64 challengeWindow, uint256 proposalBond, address bondRecipient);
    event BondWithdrawalCredited(address indexed recipient, uint256 amount);
    event BondWithdrawn(address indexed account, address indexed recipient, uint256 amount);
    event CorrelationEpochProposed(
        uint64 indexed epochId,
        uint64 fromRoundId,
        uint64 toRoundId,
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

    constructor(address admin) {
        if (admin == address(0)) revert InvalidAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CONFIG_ROLE, admin);
        _grantRole(ARBITER_ROLE, admin);
        challengeWindow = DEFAULT_CHALLENGE_WINDOW;
        proposalBond = DEFAULT_PROPOSAL_BOND;
        bondRecipient = admin;
        emit OracleConfigUpdated(DEFAULT_CHALLENGE_WINDOW, DEFAULT_PROPOSAL_BOND, admin);
    }

    receive() external payable { }

    function setOracleConfig(uint64 newChallengeWindow, uint256 newProposalBond, address newBondRecipient)
        external
        onlyRole(CONFIG_ROLE)
    {
        if (newChallengeWindow == 0) revert InvalidSnapshot();
        if (newBondRecipient == address(0)) revert InvalidAddress();
        challengeWindow = newChallengeWindow;
        proposalBond = newProposalBond;
        bondRecipient = newBondRecipient;
        emit OracleConfigUpdated(newChallengeWindow, newProposalBond, newBondRecipient);
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
        if (msg.value < proposalBond) revert InvalidBond();
        CorrelationEpochSnapshot storage existing = correlationEpochSnapshots[epochId];
        if (existing.status != SnapshotStatus.None && existing.status != SnapshotStatus.Rejected) {
            revert SnapshotExists();
        }

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
            bond: msg.value
        });

        emit CorrelationEpochProposed(
            epochId, fromRoundId, toRoundId, msg.sender, clusterRoot, parameterHash, artifactHash, artifactURI
        );
    }

    function challengeCorrelationEpoch(uint64 epochId, bytes32 reasonHash) external payable {
        CorrelationEpochSnapshot storage snapshot = correlationEpochSnapshots[epochId];
        if (snapshot.status == SnapshotStatus.None) revert SnapshotNotFound();
        if (snapshot.status != SnapshotStatus.Proposed) revert SnapshotNotFinalizable();
        if (block.timestamp >= uint256(snapshot.proposedAt) + uint256(challengeWindow)) {
            revert SnapshotNotFinalizable();
        }
        if (msg.value < proposalBond) revert InvalidBond();
        snapshot.status = SnapshotStatus.Challenged;
        snapshot.challenger = msg.sender;
        snapshot.bond += msg.value;
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
        address challenger = snapshot.challenger;
        uint256 bond = snapshot.bond;
        snapshot.bond = 0;
        if (bond > 0) _creditBond(challenger == address(0) ? bondRecipient : challenger, bond);
        emit CorrelationEpochRejected(epochId, msg.sender, reasonHash);
    }

    function proposeRoundPayoutSnapshot(RoundPayoutSnapshotInput calldata input) external payable {
        _validateRoundPayoutInput(input);
        if (msg.value < proposalBond) revert InvalidBond();
        CorrelationEpochSnapshot storage epoch = correlationEpochSnapshots[input.correlationEpochId];
        if (epoch.status != SnapshotStatus.Finalized) revert SnapshotNotFinalizable();
        if (input.roundId < epoch.fromRoundId || input.roundId > epoch.toRoundId) revert InvalidSnapshot();

        bytes32 snapshotKey = roundPayoutSnapshotKey(input.domain, input.rewardPoolId, input.contentId, input.roundId);
        RoundPayoutProposal storage existing = roundPayoutProposals[snapshotKey];
        if (existing.snapshot.status != SnapshotStatus.None && existing.snapshot.status != SnapshotStatus.Rejected) {
            revert SnapshotExists();
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
            proposer: msg.sender,
            challenger: address(0),
            artifactHash: input.artifactHash,
            artifactURI: input.artifactURI,
            bond: msg.value
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

    function challengeRoundPayoutSnapshot(bytes32 snapshotKey, bytes32 reasonHash) external payable {
        RoundPayoutProposal storage proposal = roundPayoutProposals[snapshotKey];
        if (proposal.snapshot.status == SnapshotStatus.None) revert SnapshotNotFound();
        if (proposal.snapshot.status != SnapshotStatus.Proposed) revert SnapshotNotFinalizable();
        if (block.timestamp >= uint256(proposal.proposedAt) + uint256(challengeWindow)) {
            revert SnapshotNotFinalizable();
        }
        if (msg.value < proposalBond) revert InvalidBond();
        proposal.snapshot.status = SnapshotStatus.Challenged;
        proposal.challenger = msg.sender;
        proposal.bond += msg.value;
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
        RoundPayoutProposal storage proposal = roundPayoutProposals[snapshotKey];
        if (proposal.snapshot.status == SnapshotStatus.None) revert SnapshotNotFound();
        if (proposal.snapshot.status == SnapshotStatus.Finalized) revert SnapshotFinalized();
        proposal.snapshot.status = SnapshotStatus.Rejected;
        address challenger = proposal.challenger;
        uint256 bond = proposal.bond;
        proposal.bond = 0;
        if (bond > 0) _creditBond(challenger == address(0) ? bondRecipient : challenger, bond);
        emit RoundPayoutSnapshotRejected(snapshotKey, msg.sender, reasonHash);
    }

    function withdrawBondCredit() external returns (uint256 amount) {
        return withdrawBondCreditTo(payable(msg.sender));
    }

    function withdrawBondCreditTo(address payable recipient) public returns (uint256 amount) {
        if (recipient == address(0)) revert InvalidAddress();
        amount = pendingBondWithdrawals[msg.sender];
        if (amount == 0) revert InvalidBond();
        pendingBondWithdrawals[msg.sender] = 0;

        (bool ok,) = recipient.call{ value: amount }("");
        if (!ok) {
            pendingBondWithdrawals[msg.sender] = amount;
            revert TransferFailed();
        }
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
            input.domain != PAYOUT_DOMAIN_QUESTION_REWARD && input.domain != PAYOUT_DOMAIN_LAUNCH_CREDIT
                || input.contentId == 0 || input.roundId == 0 || input.correlationEpochId == 0
                || input.weightRoot == bytes32(0) || input.totalClaimWeight == 0
                || input.effectiveParticipantUnits > uint256(input.rawEligibleVoters) * BPS_DENOMINATOR
        ) {
            revert InvalidSnapshot();
        }
        if (input.domain == PAYOUT_DOMAIN_QUESTION_REWARD && input.rewardPoolId == 0) revert InvalidSnapshot();
        if (input.domain == PAYOUT_DOMAIN_LAUNCH_CREDIT && input.rewardPoolId != 0) revert InvalidSnapshot();
    }

    function _creditBond(address to, uint256 amount) private {
        if (amount == 0) return;
        pendingBondWithdrawals[to] += amount;
        emit BondWithdrawalCredited(to, amount);
    }
}
