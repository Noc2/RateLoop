// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IWorldIDRouter} from "./interfaces/IWorldIDRouter.sol";

/// @title RaterRegistry
/// @notice Optional rater metadata, human credentials, trust anchors, and social follows for RateLoop.
/// @dev This registry is intentionally non-gating: rating contracts may read it, but base participation
///      must keep working when no profile, credential, or trust signal exists.
contract RaterRegistry is AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant SEEDER_ROLE = keccak256("SEEDER_ROLE");

    uint16 public constant BASE_MULTIPLIER_BPS = 10_000;
    uint16 public constant MAX_TRUST_BOOST_BPS = 12_000;
    uint256 public constant WORLD_ID_GROUP_ID = 1;
    bytes32 public constant CURYO_SELF_VERIFIED_SCOPE = keccak256("rateloop-curyo-self-verified-v1");

    enum RaterType {
        Unknown,
        Human,
        AI,
        Team,
        Hybrid
    }

    struct RaterProfile {
        RaterType raterType;
        bytes32 metadataHash;
        uint64 updatedAt;
    }

    enum HumanCredentialProvider {
        None,
        WorldId,
        CuryoSelfVerifiedSeed
    }

    struct HumanCredential {
        bool verified;
        bool revoked;
        HumanCredentialProvider provider;
        bytes32 nullifierHash;
        bytes32 scope;
        uint64 verifiedAt;
        uint64 expiresAt;
        bytes32 evidenceHash;
    }

    struct TrustSeed {
        bool active;
        uint64 seededAt;
        uint64 sunsetAt;
        bytes32 seedRoot;
    }

    struct TrustAttestation {
        address issuer;
        address subject;
        uint256 categoryId;
        uint16 maxBoostBps;
        uint64 expiresAt;
        bytes32 metadataHash;
        uint64 issuedAt;
        bool revoked;
    }

    mapping(address => RaterProfile) private _profiles;
    mapping(address => HumanCredential) private _humanCredentials;
    mapping(bytes32 => address) public humanNullifierOwner;
    mapping(address => TrustSeed) private _trustSeeds;
    mapping(bytes32 => TrustAttestation) private _trustAttestations;
    mapping(address => mapping(address => bool)) public isFollowing;
    mapping(address => uint256) public followingCount;
    mapping(address => uint256) public followerCount;

    IWorldIDRouter public immutable worldIdRouter;
    bytes32 public immutable worldIdScope;
    uint256 public immutable worldIdExternalNullifierHash;
    uint64 public immutable worldIdCredentialTtl;

    event RaterProfileUpdated(
        address indexed rater, RaterType indexed raterType, bytes32 indexed metadataHash, uint64 updatedAt
    );
    event HumanCredentialVerified(
        address indexed rater,
        bytes32 indexed nullifierHash,
        bytes32 indexed scope,
        HumanCredentialProvider provider,
        uint64 verifiedAt,
        uint64 expiresAt,
        bytes32 evidenceHash
    );
    event HumanCredentialRevoked(address indexed rater, bytes32 indexed nullifierHash);
    event TrustSeedSet(address indexed rater, uint64 indexed seededAt, uint64 indexed sunsetAt, bytes32 seedRoot);
    event TrustSeedRevoked(address indexed rater);
    event TrustAttestationSet(
        bytes32 indexed attestationId,
        address indexed issuer,
        address indexed subject,
        uint256 categoryId,
        uint16 maxBoostBps,
        uint64 expiresAt,
        bytes32 metadataHash
    );
    event TrustAttestationRevoked(bytes32 indexed attestationId, address indexed issuer, address indexed subject);
    event ProfileFollowed(address indexed follower, address indexed target, uint64 followedAt);
    event ProfileUnfollowed(address indexed follower, address indexed target, uint64 unfollowedAt);

    error InvalidAddress();
    error InvalidCredential();
    error InvalidMultiplier();
    error InvalidTrustAttestation();
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

        if (admin != governance) {
            _grantRole(ADMIN_ROLE, admin);
            _grantRole(SEEDER_ROLE, admin);
        }
    }

    /// @notice Self-report the account type and a metadata hash.
    /// @dev Metadata is reputational and indexable, not proof of rater type.
    function setProfile(RaterType raterType, bytes32 metadataHash) external {
        _profiles[msg.sender] =
            RaterProfile({raterType: raterType, metadataHash: metadataHash, updatedAt: uint64(block.timestamp)});

        emit RaterProfileUpdated(msg.sender, raterType, metadataHash, uint64(block.timestamp));
    }

    /// @notice Publicly follow another profile as an on-chain curation signal.
    function followProfile(address target) external {
        if (target == address(0) || target == msg.sender) revert InvalidAddress();
        if (isFollowing[msg.sender][target]) return;

        isFollowing[msg.sender][target] = true;
        followingCount[msg.sender] += 1;
        followerCount[target] += 1;

        emit ProfileFollowed(msg.sender, target, uint64(block.timestamp));
    }

    /// @notice Remove a public profile follow.
    function unfollowProfile(address target) external {
        if (target == address(0) || target == msg.sender) revert InvalidAddress();
        if (!isFollowing[msg.sender][target]) return;

        isFollowing[msg.sender][target] = false;
        followingCount[msg.sender] -= 1;
        followerCount[target] -= 1;

        emit ProfileUnfollowed(msg.sender, target, uint64(block.timestamp));
    }

    /// @notice Attach a fresh World ID verified-human unit to the calling wallet.
    /// @dev The World ID signal is derived from msg.sender, so wallet ownership is proven by the transaction sender.
    function attestHumanCredentialWithProof(uint256 root, uint256 nullifierHash, uint256[8] calldata proof) external {
        if (nullifierHash == 0) revert InvalidCredential();

        bytes32 storedNullifier = bytes32(nullifierHash);
        HumanCredential storage previous = _humanCredentials[msg.sender];
        if (
            previous.verified && !previous.revoked && previous.expiresAt > block.timestamp
                && previous.nullifierHash != storedNullifier
        ) {
            revert InvalidCredential();
        }

        address currentOwner = humanNullifierOwner[storedNullifier];
        if (currentOwner != address(0) && currentOwner != msg.sender) revert NullifierAlreadyAssigned();

        uint256 signalHash = worldIdSignalHash(msg.sender);
        worldIdRouter.verifyProof(
            root, WORLD_ID_GROUP_ID, signalHash, nullifierHash, worldIdExternalNullifierHash, proof
        );

        uint256 expiresAt = block.timestamp + worldIdCredentialTtl;
        if (expiresAt > type(uint64).max) revert InvalidCredential();

        bytes32 evidenceHash =
            keccak256(abi.encodePacked("world-id-v3", block.chainid, address(worldIdRouter), root, signalHash));
        _attestHumanCredential(
            msg.sender, storedNullifier, worldIdScope, uint64(expiresAt), HumanCredentialProvider.WorldId, evidenceHash
        );
    }

    /// @notice Seed a previous Curyo Self.xyz verified account as the same verified-human unit used by World ID.
    /// @dev Provider provenance is internal metadata; consumers should show this as a generic verified human.
    function seedHumanCredential(address rater, uint64 expiresAt, bytes32 anchorId, bytes32 evidenceHash)
        external
        onlyRole(SEEDER_ROLE)
    {
        _attestHumanCredential(
            rater,
            anchorId,
            CURYO_SELF_VERIFIED_SCOPE,
            expiresAt,
            HumanCredentialProvider.CuryoSelfVerifiedSeed,
            evidenceHash
        );
    }

    function revokeHumanCredential(address rater) external onlyRole(SEEDER_ROLE) {
        if (rater == address(0)) revert InvalidAddress();
        HumanCredential storage credential = _humanCredentials[rater];
        if (!credential.verified || credential.revoked) revert InvalidCredential();

        credential.revoked = true;
        bytes32 nullifierHash = credential.nullifierHash;
        if (nullifierHash != bytes32(0) && humanNullifierOwner[nullifierHash] == rater) {
            delete humanNullifierOwner[nullifierHash];
        }

        emit HumanCredentialRevoked(rater, nullifierHash);
    }

    function setTrustSeed(address rater, uint64 sunsetAt, bytes32 seedRoot) external onlyRole(SEEDER_ROLE) {
        _setTrustSeed(rater, sunsetAt, seedRoot);
    }

    function revokeTrustSeed(address rater) external onlyRole(SEEDER_ROLE) {
        if (rater == address(0)) revert InvalidAddress();
        TrustSeed storage seed = _trustSeeds[rater];
        if (!seed.active) revert InvalidCredential();
        seed.active = false;
        emit TrustSeedRevoked(rater);
    }

    function setTrustAttestation(
        address subject,
        uint256 categoryId,
        uint16 maxBoostBps,
        uint64 expiresAt,
        bytes32 metadataHash
    ) external returns (bytes32 attestationId) {
        if (subject == address(0) || subject == msg.sender) revert InvalidTrustAttestation();
        if (expiresAt <= block.timestamp) revert InvalidTrustAttestation();
        if (maxBoostBps < BASE_MULTIPLIER_BPS || maxBoostBps > MAX_TRUST_BOOST_BPS) revert InvalidMultiplier();

        attestationId = trustAttestationId(msg.sender, subject, categoryId);
        _trustAttestations[attestationId] = TrustAttestation({
            issuer: msg.sender,
            subject: subject,
            categoryId: categoryId,
            maxBoostBps: maxBoostBps,
            expiresAt: expiresAt,
            metadataHash: metadataHash,
            issuedAt: uint64(block.timestamp),
            revoked: false
        });

        emit TrustAttestationSet(attestationId, msg.sender, subject, categoryId, maxBoostBps, expiresAt, metadataHash);
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

    function getHumanCredential(address rater) external view returns (HumanCredential memory) {
        return _humanCredentials[rater];
    }

    function getTrustSeed(address rater) external view returns (TrustSeed memory) {
        return _trustSeeds[rater];
    }

    function getTrustAttestation(bytes32 attestationId) external view returns (TrustAttestation memory) {
        return _trustAttestations[attestationId];
    }

    function trustAttestationId(address issuer, address subject, uint256 categoryId) public pure returns (bytes32) {
        return keccak256(abi.encode(issuer, subject, categoryId));
    }

    function worldIdSignalHash(address rater) public pure returns (uint256) {
        return hashToField(abi.encodePacked(rater));
    }

    function hashToField(bytes memory value) public pure returns (uint256) {
        return uint256(keccak256(value)) >> 8;
    }

    function hasActiveHumanCredential(address rater) public view returns (bool) {
        HumanCredential storage credential = _humanCredentials[rater];
        return credential.verified && !credential.revoked && credential.expiresAt > block.timestamp;
    }

    function hasActiveTrustSeed(address rater) public view returns (bool) {
        TrustSeed storage seed = _trustSeeds[rater];
        return seed.active && seed.sunsetAt > block.timestamp;
    }

    function _attestHumanCredential(
        address rater,
        bytes32 nullifierHash,
        bytes32 scope,
        uint64 expiresAt,
        HumanCredentialProvider provider,
        bytes32 evidenceHash
    ) internal {
        if (rater == address(0)) revert InvalidAddress();
        if (expiresAt <= block.timestamp) revert InvalidCredential();
        if (provider == HumanCredentialProvider.None) revert InvalidCredential();
        if (nullifierHash == bytes32(0) || scope == bytes32(0)) revert InvalidCredential();

        HumanCredential storage previous = _humanCredentials[rater];
        if (previous.nullifierHash != bytes32(0) && previous.nullifierHash != nullifierHash) {
            if (humanNullifierOwner[previous.nullifierHash] == rater) {
                delete humanNullifierOwner[previous.nullifierHash];
            }
        }

        address currentOwner = humanNullifierOwner[nullifierHash];
        if (currentOwner != address(0) && currentOwner != rater) revert NullifierAlreadyAssigned();
        humanNullifierOwner[nullifierHash] = rater;

        _humanCredentials[rater] = HumanCredential({
            verified: true,
            revoked: false,
            provider: provider,
            nullifierHash: nullifierHash,
            scope: scope,
            verifiedAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            evidenceHash: evidenceHash
        });

        emit HumanCredentialVerified(
            rater, nullifierHash, scope, provider, uint64(block.timestamp), expiresAt, evidenceHash
        );
    }

    function _setTrustSeed(address rater, uint64 sunsetAt, bytes32 seedRoot) internal {
        if (rater == address(0)) revert InvalidAddress();
        if (sunsetAt <= block.timestamp) revert InvalidCredential();

        _trustSeeds[rater] =
            TrustSeed({active: true, seededAt: uint64(block.timestamp), sunsetAt: sunsetAt, seedRoot: seedRoot});

        emit TrustSeedSet(rater, uint64(block.timestamp), sunsetAt, seedRoot);
    }
}
