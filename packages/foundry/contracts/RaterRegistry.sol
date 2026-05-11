// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IWorldIDRouter} from "./interfaces/IWorldIDRouter.sol";

/// @title RaterRegistry
/// @notice Optional rater metadata, human credentials, trust anchors, and scorer labels for RateLoop.
/// @dev This registry is intentionally non-gating: rating contracts may read it, but base participation
///      must keep working when no profile, credential, or trust signal exists.
contract RaterRegistry is AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant SEEDER_ROLE = keccak256("SEEDER_ROLE");
    bytes32 public constant SCORER_ROLE = keccak256("SCORER_ROLE");
    bytes32 public constant CLUSTER_CHALLENGE_RESOLVER_ROLE = keccak256("CLUSTER_CHALLENGE_RESOLVER_ROLE");

    uint16 public constant BASE_MULTIPLIER_BPS = 10_000;
    uint16 public constant WORLD_ID_MULTIPLIER_BPS = 10_000;
    uint16 public constant MAX_CREDENTIAL_MULTIPLIER_BPS = 12_000;
    uint16 public constant MAX_CLUSTER_DISCOUNT_BPS = 10_000;
    uint16 public constant MAX_TRUST_BOOST_BPS = 12_000;
    uint256 public constant WORLD_ID_GROUP_ID = 1;

    enum RaterType {
        Unknown,
        Human,
        AI,
        Team,
        Hybrid
    }

    enum ClusterScoreChallengeStatus {
        None,
        Open,
        Sustained,
        Rejected
    }

    struct RaterProfile {
        RaterType raterType;
        bytes32 metadataHash;
        uint64 updatedAt;
    }

    struct SelfCredential {
        bool verified;
        bool legacy;
        bool revoked;
        bytes32 nullifierHash;
        bytes32 scope;
        uint64 verifiedAt;
        uint64 expiresAt;
        uint16 multiplierBps;
        bytes32 evidenceHash;
    }

    struct TrustSeed {
        bool active;
        uint64 seededAt;
        uint64 sunsetAt;
        uint16 trustBudgetBps;
        bytes32 seedRoot;
    }

    struct ClusterScore {
        bytes32 clusterId;
        uint16 discountBps;
        uint64 scorerEpoch;
        uint64 updatedAt;
    }

    struct ClusterScoreMetadata {
        bytes32 algorithmHash;
        bytes32 modelVersionHash;
        bytes32 scoreRoot;
        bytes32 evidenceHash;
        uint64 challengeWindowEndsAt;
    }

    struct VersionedClusterScore {
        bytes32 clusterId;
        uint16 discountBps;
        uint64 scorerEpoch;
        uint64 updatedAt;
        bytes32 algorithmHash;
        bytes32 modelVersionHash;
        bytes32 scoreRoot;
        bytes32 evidenceHash;
        uint64 challengeWindowEndsAt;
        bytes32 scoreKey;
    }

    struct ClusterScoreChallenge {
        address challenger;
        address rater;
        uint64 scorerEpoch;
        bytes32 algorithmHash;
        bytes32 modelVersionHash;
        bytes32 scoreKey;
        bytes32 evidenceHash;
        bytes32 resolutionHash;
        uint64 openedAt;
        uint64 resolvedAt;
        ClusterScoreChallengeStatus status;
    }

    struct TrustAttestation {
        address issuer;
        address subject;
        uint256 categoryId;
        uint96 trustBudget;
        uint16 maxBoostBps;
        uint64 expiresAt;
        bytes32 metadataHash;
        uint64 issuedAt;
        bool revoked;
    }

    mapping(address => RaterProfile) private _profiles;
    mapping(address => SelfCredential) private _selfCredentials;
    mapping(bytes32 => address) public selfNullifierOwner;
    mapping(address => TrustSeed) private _trustSeeds;
    mapping(address => ClusterScore) private _clusterScores;
    mapping(address => VersionedClusterScore) private _currentVersionedClusterScores;
    mapping(bytes32 => VersionedClusterScore) private _clusterScoreHistory;
    mapping(uint256 => ClusterScoreChallenge) private _clusterScoreChallenges;
    mapping(bytes32 => TrustAttestation) private _trustAttestations;

    uint256 public nextClusterScoreChallengeId = 1;
    IWorldIDRouter public immutable worldIdRouter;
    bytes32 public immutable worldIdScope;
    uint256 public immutable worldIdExternalNullifierHash;
    uint64 public immutable worldIdCredentialTtl;

    event RaterProfileUpdated(
        address indexed rater, RaterType indexed raterType, bytes32 indexed metadataHash, uint64 updatedAt
    );
    event SelfCredentialAttested(
        address indexed rater,
        bytes32 indexed nullifierHash,
        bytes32 indexed scope,
        bool legacy,
        uint64 verifiedAt,
        uint64 expiresAt,
        uint16 multiplierBps,
        bytes32 evidenceHash
    );
    event SelfCredentialRevoked(address indexed rater, bytes32 indexed nullifierHash);
    event TrustSeedSet(
        address indexed rater, uint64 indexed seededAt, uint64 indexed sunsetAt, uint16 trustBudgetBps, bytes32 seedRoot
    );
    event TrustSeedRevoked(address indexed rater);
    event ClusterScoreUpdated(
        address indexed rater, bytes32 indexed clusterId, uint16 discountBps, uint64 scorerEpoch, uint64 updatedAt
    );
    event VersionedClusterScorePublished(
        address indexed rater,
        uint64 indexed scorerEpoch,
        bytes32 indexed modelVersionHash,
        bytes32 clusterId,
        uint16 discountBps,
        bytes32 algorithmHash,
        bytes32 scoreRoot,
        bytes32 evidenceHash,
        uint64 challengeWindowEndsAt,
        uint64 updatedAt,
        bytes32 scoreKey
    );
    event ClusterScoreChallengeOpened(
        uint256 indexed challengeId,
        address indexed challenger,
        bytes32 indexed scoreKey,
        address rater,
        uint64 scorerEpoch,
        bytes32 algorithmHash,
        bytes32 modelVersionHash,
        bytes32 evidenceHash,
        uint64 openedAt
    );
    event ClusterScoreChallengeResolved(
        uint256 indexed challengeId, ClusterScoreChallengeStatus status, bytes32 resolutionHash, uint64 resolvedAt
    );
    event TrustAttestationSet(
        bytes32 indexed attestationId,
        address indexed issuer,
        address indexed subject,
        uint256 categoryId,
        uint96 trustBudget,
        uint16 maxBoostBps,
        uint64 expiresAt,
        bytes32 metadataHash
    );
    event TrustAttestationRevoked(bytes32 indexed attestationId, address indexed issuer, address indexed subject);

    error InvalidAddress();
    error InvalidCredential();
    error InvalidMultiplier();
    error InvalidTrustAttestation();
    error InvalidClusterScore();
    error InvalidChallenge();
    error NullifierAlreadyAssigned();

    constructor(
        address admin,
        address governance,
        address _worldIdRouter,
        bytes32 _worldIdScope,
        uint256 _worldIdExternalNullifierHash,
        uint64 _worldIdCredentialTtl
    ) {
        if (admin == address(0) || governance == address(0) || _worldIdRouter == address(0)) {
            revert InvalidAddress();
        }
        if (_worldIdScope == bytes32(0) || _worldIdExternalNullifierHash == 0 || _worldIdCredentialTtl == 0) {
            revert InvalidCredential();
        }

        worldIdRouter = IWorldIDRouter(_worldIdRouter);
        worldIdScope = _worldIdScope;
        worldIdExternalNullifierHash = _worldIdExternalNullifierHash;
        worldIdCredentialTtl = _worldIdCredentialTtl;

        _grantRole(DEFAULT_ADMIN_ROLE, governance);
        _grantRole(ADMIN_ROLE, governance);
        _grantRole(SEEDER_ROLE, governance);
        _grantRole(SCORER_ROLE, governance);
        _grantRole(CLUSTER_CHALLENGE_RESOLVER_ROLE, governance);

        if (admin != governance) {
            _grantRole(ADMIN_ROLE, admin);
            _grantRole(SEEDER_ROLE, admin);
            _grantRole(SCORER_ROLE, admin);
            _grantRole(CLUSTER_CHALLENGE_RESOLVER_ROLE, admin);
        }
    }

    /// @notice Self-report the account type and a metadata hash.
    /// @dev Metadata is reputational and indexable, not proof of rater type.
    function setProfile(RaterType raterType, bytes32 metadataHash) external {
        _profiles[msg.sender] =
            RaterProfile({raterType: raterType, metadataHash: metadataHash, updatedAt: uint64(block.timestamp)});

        emit RaterProfileUpdated(msg.sender, raterType, metadataHash, uint64(block.timestamp));
    }

    /// @notice Attach a fresh World ID uniqueness credential to the calling wallet.
    /// @dev The World ID signal is derived from msg.sender, so wallet ownership is proven by the transaction sender.
    function attestSelfCredentialWithProof(uint256 root, uint256 nullifierHash, uint256[8] calldata proof) external {
        if (nullifierHash == 0) revert InvalidCredential();

        bytes32 storedNullifier = bytes32(nullifierHash);
        SelfCredential storage previous = _selfCredentials[msg.sender];
        if (
            previous.verified && !previous.legacy && !previous.revoked && previous.expiresAt > block.timestamp
                && previous.nullifierHash != storedNullifier
        ) {
            revert InvalidCredential();
        }

        address currentOwner = selfNullifierOwner[storedNullifier];
        if (currentOwner != address(0) && currentOwner != msg.sender) revert NullifierAlreadyAssigned();

        uint256 signalHash = worldIdSignalHash(msg.sender);
        worldIdRouter.verifyProof(
            root, WORLD_ID_GROUP_ID, signalHash, nullifierHash, worldIdExternalNullifierHash, proof
        );

        uint256 expiresAt = block.timestamp + worldIdCredentialTtl;
        if (expiresAt > type(uint64).max) revert InvalidCredential();

        bytes32 evidenceHash =
            keccak256(abi.encodePacked("world-id-v3", block.chainid, address(worldIdRouter), root, signalHash));
        _attestSelfCredential(
            msg.sender, storedNullifier, worldIdScope, uint64(expiresAt), WORLD_ID_MULTIPLIER_BPS, evidenceHash, false
        );
    }

    /// @notice Seed a previous Curyo Self-verified account as a temporary graph anchor.
    /// @dev Legacy credentials may omit a nullifier when only the historical address snapshot is available.
    function seedLegacySelfCredential(
        address rater,
        uint64 sunsetAt,
        uint16 multiplierBps,
        uint16 trustBudgetBps,
        bytes32 seedRoot,
        bytes32 evidenceHash
    ) external onlyRole(SEEDER_ROLE) {
        if (sunsetAt <= block.timestamp) revert InvalidCredential();
        _attestSelfCredential(rater, bytes32(0), bytes32(0), sunsetAt, multiplierBps, evidenceHash, true);
        _setTrustSeed(rater, sunsetAt, trustBudgetBps, seedRoot);
    }

    function revokeSelfCredential(address rater) external onlyRole(SEEDER_ROLE) {
        if (rater == address(0)) revert InvalidAddress();
        SelfCredential storage credential = _selfCredentials[rater];
        if (!credential.verified || credential.revoked) revert InvalidCredential();

        credential.revoked = true;
        bytes32 nullifierHash = credential.nullifierHash;
        if (nullifierHash != bytes32(0) && selfNullifierOwner[nullifierHash] == rater) {
            delete selfNullifierOwner[nullifierHash];
        }

        emit SelfCredentialRevoked(rater, nullifierHash);
    }

    function setTrustSeed(address rater, uint64 sunsetAt, uint16 trustBudgetBps, bytes32 seedRoot)
        external
        onlyRole(SEEDER_ROLE)
    {
        _setTrustSeed(rater, sunsetAt, trustBudgetBps, seedRoot);
    }

    function revokeTrustSeed(address rater) external onlyRole(SEEDER_ROLE) {
        if (rater == address(0)) revert InvalidAddress();
        TrustSeed storage seed = _trustSeeds[rater];
        if (!seed.active) revert InvalidCredential();
        seed.active = false;
        emit TrustSeedRevoked(rater);
    }

    function setClusterScore(address rater, bytes32 clusterId, uint16 discountBps, uint64 scorerEpoch)
        external
        onlyRole(SCORER_ROLE)
    {
        ClusterScoreMetadata memory metadata;
        _storeClusterScore(rater, clusterId, discountBps, scorerEpoch, metadata, false);
    }

    function publishClusterScore(
        address rater,
        bytes32 clusterId,
        uint16 discountBps,
        uint64 scorerEpoch,
        ClusterScoreMetadata calldata metadata
    ) external onlyRole(SCORER_ROLE) returns (bytes32 scoreKey) {
        scoreKey = _storeClusterScore(rater, clusterId, discountBps, scorerEpoch, metadata, true);
    }

    function openClusterScoreChallenge(
        address rater,
        uint64 scorerEpoch,
        bytes32 algorithmHash,
        bytes32 modelVersionHash,
        bytes32 evidenceHash
    ) external returns (uint256 challengeId) {
        if (evidenceHash == bytes32(0)) revert InvalidChallenge();

        bytes32 scoreKey = clusterScoreKey(rater, scorerEpoch, algorithmHash, modelVersionHash);
        VersionedClusterScore storage score = _clusterScoreHistory[scoreKey];
        if (score.updatedAt == 0 || score.challengeWindowEndsAt < block.timestamp) revert InvalidChallenge();

        challengeId = nextClusterScoreChallengeId++;
        _clusterScoreChallenges[challengeId] = ClusterScoreChallenge({
            challenger: msg.sender,
            rater: rater,
            scorerEpoch: scorerEpoch,
            algorithmHash: algorithmHash,
            modelVersionHash: modelVersionHash,
            scoreKey: scoreKey,
            evidenceHash: evidenceHash,
            resolutionHash: bytes32(0),
            openedAt: uint64(block.timestamp),
            resolvedAt: 0,
            status: ClusterScoreChallengeStatus.Open
        });

        emit ClusterScoreChallengeOpened(
            challengeId,
            msg.sender,
            scoreKey,
            rater,
            scorerEpoch,
            algorithmHash,
            modelVersionHash,
            evidenceHash,
            uint64(block.timestamp)
        );
    }

    function resolveClusterScoreChallenge(uint256 challengeId, bool sustained, bytes32 resolutionHash)
        external
        onlyRole(CLUSTER_CHALLENGE_RESOLVER_ROLE)
    {
        if (resolutionHash == bytes32(0)) revert InvalidChallenge();
        ClusterScoreChallenge storage challenge = _clusterScoreChallenges[challengeId];
        if (challenge.status != ClusterScoreChallengeStatus.Open) revert InvalidChallenge();

        challenge.status = sustained ? ClusterScoreChallengeStatus.Sustained : ClusterScoreChallengeStatus.Rejected;
        challenge.resolutionHash = resolutionHash;
        challenge.resolvedAt = uint64(block.timestamp);

        emit ClusterScoreChallengeResolved(challengeId, challenge.status, resolutionHash, uint64(block.timestamp));
    }

    function setTrustAttestation(
        address subject,
        uint256 categoryId,
        uint96 trustBudget,
        uint16 maxBoostBps,
        uint64 expiresAt,
        bytes32 metadataHash
    ) external returns (bytes32 attestationId) {
        if (subject == address(0) || subject == msg.sender) revert InvalidTrustAttestation();
        if (trustBudget == 0 || expiresAt <= block.timestamp) revert InvalidTrustAttestation();
        if (maxBoostBps < BASE_MULTIPLIER_BPS || maxBoostBps > MAX_TRUST_BOOST_BPS) revert InvalidMultiplier();

        attestationId = trustAttestationId(msg.sender, subject, categoryId);
        _trustAttestations[attestationId] = TrustAttestation({
            issuer: msg.sender,
            subject: subject,
            categoryId: categoryId,
            trustBudget: trustBudget,
            maxBoostBps: maxBoostBps,
            expiresAt: expiresAt,
            metadataHash: metadataHash,
            issuedAt: uint64(block.timestamp),
            revoked: false
        });

        emit TrustAttestationSet(
            attestationId, msg.sender, subject, categoryId, trustBudget, maxBoostBps, expiresAt, metadataHash
        );
    }

    function revokeTrustAttestation(address subject, uint256 categoryId) external {
        bytes32 attestationId = trustAttestationId(msg.sender, subject, categoryId);
        TrustAttestation storage attestation = _trustAttestations[attestationId];
        if (attestation.issuer != msg.sender || attestation.revoked) revert InvalidTrustAttestation();
        attestation.revoked = true;
        emit TrustAttestationRevoked(attestationId, msg.sender, subject);
    }

    function getProfile(address rater) external view returns (RaterProfile memory) {
        return _profiles[rater];
    }

    function getSelfCredential(address rater) external view returns (SelfCredential memory) {
        return _selfCredentials[rater];
    }

    function getTrustSeed(address rater) external view returns (TrustSeed memory) {
        return _trustSeeds[rater];
    }

    function getClusterScore(address rater) external view returns (ClusterScore memory) {
        return _clusterScores[rater];
    }

    function getVersionedClusterScore(address rater) external view returns (VersionedClusterScore memory) {
        return _currentVersionedClusterScores[rater];
    }

    function getClusterScoreAt(address rater, uint64 scorerEpoch, bytes32 algorithmHash, bytes32 modelVersionHash)
        external
        view
        returns (VersionedClusterScore memory)
    {
        return _clusterScoreHistory[clusterScoreKey(rater, scorerEpoch, algorithmHash, modelVersionHash)];
    }

    function getClusterScoreByKey(bytes32 scoreKey) external view returns (VersionedClusterScore memory) {
        return _clusterScoreHistory[scoreKey];
    }

    function getClusterScoreChallenge(uint256 challengeId) external view returns (ClusterScoreChallenge memory) {
        return _clusterScoreChallenges[challengeId];
    }

    function getTrustAttestation(bytes32 attestationId) external view returns (TrustAttestation memory) {
        return _trustAttestations[attestationId];
    }

    function trustAttestationId(address issuer, address subject, uint256 categoryId) public pure returns (bytes32) {
        return keccak256(abi.encode(issuer, subject, categoryId));
    }

    function clusterScoreKey(address rater, uint64 scorerEpoch, bytes32 algorithmHash, bytes32 modelVersionHash)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(rater, scorerEpoch, algorithmHash, modelVersionHash));
    }

    function worldIdSignalHash(address rater) public pure returns (uint256) {
        return hashToField(abi.encodePacked(rater));
    }

    function hashToField(bytes memory value) public pure returns (uint256) {
        return uint256(keccak256(value)) >> 8;
    }

    function hasActiveSelfCredential(address rater) public view returns (bool) {
        SelfCredential storage credential = _selfCredentials[rater];
        return credential.verified && !credential.revoked && credential.expiresAt > block.timestamp;
    }

    function hasActiveTrustSeed(address rater) public view returns (bool) {
        TrustSeed storage seed = _trustSeeds[rater];
        return seed.active && seed.sunsetAt > block.timestamp;
    }

    function credentialMultiplierBps(address rater) public view returns (uint16) {
        if (!hasActiveSelfCredential(rater)) {
            return BASE_MULTIPLIER_BPS;
        }

        uint16 multiplier = _selfCredentials[rater].multiplierBps;
        return multiplier > BASE_MULTIPLIER_BPS ? multiplier : BASE_MULTIPLIER_BPS;
    }

    function _attestSelfCredential(
        address rater,
        bytes32 nullifierHash,
        bytes32 scope,
        uint64 expiresAt,
        uint16 multiplierBps,
        bytes32 evidenceHash,
        bool legacy
    ) internal {
        if (rater == address(0)) revert InvalidAddress();
        if (expiresAt <= block.timestamp) revert InvalidCredential();
        if (multiplierBps < BASE_MULTIPLIER_BPS || multiplierBps > MAX_CREDENTIAL_MULTIPLIER_BPS) {
            revert InvalidMultiplier();
        }
        if (!legacy && (nullifierHash == bytes32(0) || scope == bytes32(0))) revert InvalidCredential();

        SelfCredential storage previous = _selfCredentials[rater];
        if (previous.nullifierHash != bytes32(0) && previous.nullifierHash != nullifierHash) {
            if (selfNullifierOwner[previous.nullifierHash] == rater) {
                delete selfNullifierOwner[previous.nullifierHash];
            }
        }

        if (nullifierHash != bytes32(0)) {
            address currentOwner = selfNullifierOwner[nullifierHash];
            if (currentOwner != address(0) && currentOwner != rater) revert NullifierAlreadyAssigned();
            selfNullifierOwner[nullifierHash] = rater;
        }

        _selfCredentials[rater] = SelfCredential({
            verified: true,
            legacy: legacy,
            revoked: false,
            nullifierHash: nullifierHash,
            scope: scope,
            verifiedAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            multiplierBps: multiplierBps,
            evidenceHash: evidenceHash
        });

        emit SelfCredentialAttested(
            rater, nullifierHash, scope, legacy, uint64(block.timestamp), expiresAt, multiplierBps, evidenceHash
        );
    }

    function _storeClusterScore(
        address rater,
        bytes32 clusterId,
        uint16 discountBps,
        uint64 scorerEpoch,
        ClusterScoreMetadata memory metadata,
        bool requireMetadata
    ) internal returns (bytes32 scoreKey) {
        if (rater == address(0)) revert InvalidAddress();
        if (discountBps > MAX_CLUSTER_DISCOUNT_BPS) revert InvalidMultiplier();
        if (requireMetadata) {
            if (metadata.algorithmHash == bytes32(0) || metadata.modelVersionHash == bytes32(0)) {
                revert InvalidClusterScore();
            }
            if (metadata.scoreRoot == bytes32(0) && metadata.evidenceHash == bytes32(0)) {
                revert InvalidClusterScore();
            }
            if (metadata.challengeWindowEndsAt <= block.timestamp) revert InvalidClusterScore();
        }

        uint64 updatedAt = uint64(block.timestamp);
        scoreKey = clusterScoreKey(rater, scorerEpoch, metadata.algorithmHash, metadata.modelVersionHash);
        VersionedClusterScore memory versionedScore = VersionedClusterScore({
            clusterId: clusterId,
            discountBps: discountBps,
            scorerEpoch: scorerEpoch,
            updatedAt: updatedAt,
            algorithmHash: metadata.algorithmHash,
            modelVersionHash: metadata.modelVersionHash,
            scoreRoot: metadata.scoreRoot,
            evidenceHash: metadata.evidenceHash,
            challengeWindowEndsAt: metadata.challengeWindowEndsAt,
            scoreKey: scoreKey
        });

        _clusterScores[rater] = ClusterScore({
            clusterId: clusterId, discountBps: discountBps, scorerEpoch: scorerEpoch, updatedAt: updatedAt
        });
        _currentVersionedClusterScores[rater] = versionedScore;
        _clusterScoreHistory[scoreKey] = versionedScore;

        emit ClusterScoreUpdated(rater, clusterId, discountBps, scorerEpoch, updatedAt);

        if (requireMetadata) {
            emit VersionedClusterScorePublished(
                rater,
                scorerEpoch,
                metadata.modelVersionHash,
                clusterId,
                discountBps,
                metadata.algorithmHash,
                metadata.scoreRoot,
                metadata.evidenceHash,
                metadata.challengeWindowEndsAt,
                updatedAt,
                scoreKey
            );
        }
    }

    function _setTrustSeed(address rater, uint64 sunsetAt, uint16 trustBudgetBps, bytes32 seedRoot) internal {
        if (rater == address(0)) revert InvalidAddress();
        if (sunsetAt <= block.timestamp) revert InvalidCredential();

        _trustSeeds[rater] = TrustSeed({
            active: true,
            seededAt: uint64(block.timestamp),
            sunsetAt: sunsetAt,
            trustBudgetBps: trustBudgetBps,
            seedRoot: seedRoot
        });

        emit TrustSeedSet(rater, uint64(block.timestamp), sunsetAt, trustBudgetBps, seedRoot);
    }
}
