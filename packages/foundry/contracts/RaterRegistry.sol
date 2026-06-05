// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {IWorldIDRouter} from "./interfaces/IWorldIDRouter.sol";
import {IWorldIDVerifier} from "./interfaces/IWorldIDVerifier.sol";
import {IRaterIdentityRegistry} from "./interfaces/IRaterIdentityRegistry.sol";

/// @title RaterRegistry
/// @notice Optional rater metadata, human credentials, public follows, and delegation for RateLoop.
/// @dev This registry is intentionally non-gating: rating contracts may read it, but base participation
///      must keep working when no profile or credential exists.
contract RaterRegistry is Initializable, AccessControlUpgradeable, IRaterIdentityRegistry {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant SEEDER_ROLE = keccak256("SEEDER_ROLE");

    uint256 public constant WORLD_ID_GROUP_ID = 1;
    bytes32 public constant SEEDED_HUMAN_SCOPE = keccak256("rateloop-seeded-human-v1");

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
        SeededHuman,
        WorldIdV4
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

    mapping(address => RaterProfile) private _profiles;
    mapping(address => HumanCredential) private _humanCredentials;
    mapping(address => bytes32) private _canonicalHumanIdentityKey;
    /// @dev Provider-namespaced ownership of nullifier hashes. Previously a single
    ///      mapping was shared across providers, which allowed `SEEDER_ROLE` to
    ///      squat any 32-byte value and block the legitimate owner of the same
    ///      bytes from attesting under a different provider (L-Identity-1).
    mapping(HumanCredentialProvider => mapping(bytes32 => address)) private _humanNullifierOwnerByProvider;
    /// @dev Provider-namespaced revocation flag. Namespaced for the same
    ///      cross-provider collision reason as `_humanNullifierOwnerByProvider`.
    mapping(HumanCredentialProvider => mapping(bytes32 => bool)) private _revokedHumanNullifierByProvider;
    /// @dev RR-6 (2026-05-20 follow-up audit): records the rater whose credential was last
    ///      revoked against this (provider, nullifierHash). Exposed via the indexed `prevOwner`
    ///      field of `HumanNullifierRevocationCleared` so off-chain alerts can fire on a single
    ///      log when a SEEDER recycles a previously-bound nullifier onto a new address.
    mapping(HumanCredentialProvider => mapping(bytes32 => address)) private _lastRevokedOwnerByProvider;
    /// @notice Explicit v4 -> legacy launch identity aliases for World ID migrations that change nullifier bytes.
    mapping(bytes32 => bytes32) public worldIdV4LaunchNullifierAlias;
    mapping(bytes32 => bool) public worldIdV4LaunchNullifierSeen;
    mapping(address => mapping(address => bool)) public isFollowing;
    mapping(address => uint256) public followingCount;
    mapping(address => uint256) public followerCount;
    mapping(address => address) public delegateTo;
    mapping(address => address) public delegateOf;
    mapping(address => address) public pendingDelegateTo;
    mapping(address => address) public pendingDelegateOf;

    IWorldIDRouter public worldIdRouter;
    bytes32 public worldIdScope;
    uint256 public worldIdExternalNullifierHash;
    uint64 public worldIdCredentialTtl;
    bool public worldIdVerifierConfigFrozen;
    /// @dev RR-4 (2026-05-20 follow-up audit): governance-tunable upper bound on the TTL
    ///      SEEDER_ROLE can grant via `seedHumanCredential`. WorldID credentials are already
    ///      clamped via the configured `worldIdCredentialTtl`; this is the symmetric clamp for
    ///      SEEDER-seeded credentials. 0 means "no governance-imposed cap" (i.e., the prior
    ///      behavior in which SEEDER could pass `type(uint64).max`).
    uint64 public maxSeededCredentialTtl;
    IWorldIDVerifier public worldIdV4Verifier;
    uint64 public worldIdV4RpId;
    uint256 public worldIdV4Action;
    uint64 public worldIdV4CredentialTtl;
    uint64 public worldIdV4IssuerSchemaId;
    uint256 public worldIdV4CredentialGenesisIssuedAtMin;
    bool public worldIdV4VerifierConfigFrozen;
    bool public legacyWorldIdAttestationDisabled;

    /// @dev Reserved storage gap for future proxy-safe upgrades.
    uint256[40] private __gap;

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
    event HumanCredentialRevoked(
        address indexed rater, bytes32 indexed nullifierHash, HumanCredentialProvider indexed provider
    );
    /// @notice RR-6 (2026-05-20 follow-up audit): `prevOwner` identifies the rater whose
    ///         credential was last revoked against this (provider, nullifierHash). Off-chain
    ///         alerting can fire on the single log instead of joining against a prior
    ///         `HumanCredentialRevoked` event.
    event HumanNullifierRevocationCleared(
        bytes32 indexed nullifierHash, HumanCredentialProvider indexed provider, address indexed prevOwner
    );
    event WorldIdV4LaunchNullifierAliasSet(bytes32 indexed v4NullifierHash, bytes32 indexed legacyNullifierHash);
    /// @notice M-Identity-2: emitted when SEEDER_ROLE explicitly re-binds a rater's canonical
    ///         identity key. Off-chain consumers MUST re-map any per-identity state keyed off
    ///         the old key (cooldowns, exclusions, profile ownership) when they observe this.
    event CanonicalHumanIdentityKeyRotated(
        address indexed rater, bytes32 indexed previousKey, bytes32 indexed newKey, HumanCredentialProvider provider
    );
    /// @notice RR-1 (2026-05-20 follow-up audit): emitted when a rater's stale canonical key is
    ///         cleared on revocation. Off-chain consumers MUST detach any per-identity state
    ///         keyed off the prior canonical (cooldowns, exclusions, profile ownership) — the
    ///         next attestation will seed a fresh canonical from the new credential's nullifier.
    event CanonicalHumanIdentityKeyCleared(address indexed rater, bytes32 indexed previousKey);
    /// @notice RR-4 (2026-05-20 follow-up audit): governance updated the SEEDER-seeded credential
    ///         TTL cap. `newCap = 0` removes the cap entirely.
    event MaxSeededCredentialTtlUpdated(uint64 previousCap, uint64 newCap);
    event WorldIdVerifierConfigUpdated(
        address indexed router, bytes32 indexed scope, uint256 externalNullifierHash, uint64 credentialTtl
    );
    event WorldIdVerifierConfigLocked(address indexed account);
    event WorldIdV4VerifierConfigUpdated(
        address indexed verifier,
        uint64 indexed rpId,
        uint256 indexed action,
        uint64 credentialTtl,
        uint64 issuerSchemaId,
        uint256 credentialGenesisIssuedAtMin
    );
    event WorldIdV4VerifierConfigLocked(address indexed account);
    event LegacyWorldIdAttestationDisabledSet(address indexed account);
    event ProfileFollowed(address indexed follower, address indexed target, uint64 followedAt);
    event ProfileUnfollowed(address indexed follower, address indexed target, uint64 unfollowedAt);
    event DelegateRequested(address indexed holder, address indexed delegate);
    event DelegateSet(address indexed holder, address indexed delegate);
    event DelegateRemoved(address indexed holder, address indexed previousDelegate);
    event PendingDelegateRemoved(address indexed holder, address indexed previousPendingDelegate);

    error InvalidAddress();
    error InvalidCredential();
    error NullifierAlreadyAssigned();
    error CannotDelegateSelf();
    error CallerIsDelegate();
    error DelegateIsHolder();
    error DelegateAlreadyAssigned();
    error NoDelegateSet();
    error NoPendingDelegate();
    error ActiveHumanCredentialRequiresHumanProfile();
    error WorldIdVerifierConfigFrozen();
    error WorldIdV4VerifierConfigFrozen();
    error WorldIdV4VerifierNotConfigured();
    error LegacyWorldIdAttestationDisabled();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(
        address admin,
        address governance,
        address _worldIdRouter,
        bytes32 _worldIdScope,
        uint256 _worldIdExternalNullifierHash,
        uint64 _worldIdCredentialTtl
    ) {
        _initializeRaterRegistry(
            admin, governance, _worldIdRouter, _worldIdScope, _worldIdExternalNullifierHash, _worldIdCredentialTtl
        );
        _disableInitializers();
    }

    function initialize(
        address admin,
        address governance,
        address _worldIdRouter,
        bytes32 _worldIdScope,
        uint256 _worldIdExternalNullifierHash,
        uint64 _worldIdCredentialTtl
    ) external initializer {
        __AccessControl_init();
        _initializeRaterRegistry(
            admin, governance, _worldIdRouter, _worldIdScope, _worldIdExternalNullifierHash, _worldIdCredentialTtl
        );
    }

    function _initializeRaterRegistry(
        address admin,
        address governance,
        address _worldIdRouter,
        bytes32 _worldIdScope,
        uint256 _worldIdExternalNullifierHash,
        uint64 _worldIdCredentialTtl
    ) private {
        if (admin == address(0) || governance == address(0)) {
            revert InvalidAddress();
        }
        _setWorldIdVerifierConfig(
            _worldIdRouter, _worldIdScope, _worldIdExternalNullifierHash, _worldIdCredentialTtl, true
        );
        maxSeededCredentialTtl = _worldIdCredentialTtl;
        emit MaxSeededCredentialTtlUpdated(0, _worldIdCredentialTtl);

        _grantRole(DEFAULT_ADMIN_ROLE, governance);
        _grantRole(ADMIN_ROLE, governance);
        _grantRole(SEEDER_ROLE, governance);

        if (admin != governance) {
            _grantRole(ADMIN_ROLE, admin);
            _grantRole(SEEDER_ROLE, admin);
        }
    }

    function setWorldIdVerifierConfig(
        address _worldIdRouter,
        bytes32 _worldIdScope,
        uint256 _worldIdExternalNullifierHash,
        uint64 _worldIdCredentialTtl
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (worldIdVerifierConfigFrozen) revert WorldIdVerifierConfigFrozen();
        _setWorldIdVerifierConfig(
            _worldIdRouter, _worldIdScope, _worldIdExternalNullifierHash, _worldIdCredentialTtl, true
        );
    }

    function freezeWorldIdVerifierConfig() external onlyRole(DEFAULT_ADMIN_ROLE) {
        worldIdVerifierConfigFrozen = true;
        emit WorldIdVerifierConfigLocked(msg.sender);
    }

    function setWorldIdV4VerifierConfig(
        address _worldIdV4Verifier,
        uint64 _worldIdV4RpId,
        uint256 _worldIdV4Action,
        uint64 _worldIdV4CredentialTtl,
        uint64 _worldIdV4IssuerSchemaId,
        uint256 _worldIdV4CredentialGenesisIssuedAtMin
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (worldIdV4VerifierConfigFrozen) {
            revert WorldIdV4VerifierConfigFrozen();
        }
        _setWorldIdV4VerifierConfig(
            _worldIdV4Verifier,
            _worldIdV4RpId,
            _worldIdV4Action,
            _worldIdV4CredentialTtl,
            _worldIdV4IssuerSchemaId,
            _worldIdV4CredentialGenesisIssuedAtMin,
            true
        );
    }

    function freezeWorldIdV4VerifierConfig() external onlyRole(DEFAULT_ADMIN_ROLE) {
        worldIdV4VerifierConfigFrozen = true;
        emit WorldIdV4VerifierConfigLocked(msg.sender);
    }

    function _setWorldIdVerifierConfig(
        address _worldIdRouter,
        bytes32 _worldIdScope,
        uint256 _worldIdExternalNullifierHash,
        uint64 _worldIdCredentialTtl,
        bool requireCode
    ) private {
        if (_worldIdRouter == address(0)) revert InvalidAddress();
        if (requireCode && _worldIdRouter.code.length == 0) revert InvalidAddress();
        if (_worldIdScope == bytes32(0) || _worldIdExternalNullifierHash == 0 || _worldIdCredentialTtl == 0) {
            revert InvalidCredential();
        }

        worldIdRouter = IWorldIDRouter(_worldIdRouter);
        worldIdScope = _worldIdScope;
        worldIdExternalNullifierHash = _worldIdExternalNullifierHash;
        worldIdCredentialTtl = _worldIdCredentialTtl;
        emit WorldIdVerifierConfigUpdated(
            _worldIdRouter, _worldIdScope, _worldIdExternalNullifierHash, _worldIdCredentialTtl
        );
    }

    function _setWorldIdV4VerifierConfig(
        address _worldIdV4Verifier,
        uint64 _worldIdV4RpId,
        uint256 _worldIdV4Action,
        uint64 _worldIdV4CredentialTtl,
        uint64 _worldIdV4IssuerSchemaId,
        uint256 _worldIdV4CredentialGenesisIssuedAtMin,
        bool requireCode
    ) private {
        if (_worldIdV4Verifier == address(0)) {
            if (
                _worldIdV4RpId != 0 || _worldIdV4Action != 0 || _worldIdV4CredentialTtl != 0
                    || _worldIdV4IssuerSchemaId != 0 || _worldIdV4CredentialGenesisIssuedAtMin != 0
            ) {
                revert InvalidCredential();
            }

            worldIdV4Verifier = IWorldIDVerifier(address(0));
            worldIdV4RpId = 0;
            worldIdV4Action = 0;
            worldIdV4CredentialTtl = 0;
            worldIdV4IssuerSchemaId = 0;
            worldIdV4CredentialGenesisIssuedAtMin = 0;
            emit WorldIdV4VerifierConfigUpdated(address(0), 0, 0, 0, 0, 0);
            return;
        }

        if (requireCode && _worldIdV4Verifier.code.length == 0) revert InvalidAddress();
        if (
            _worldIdV4RpId == 0 || _worldIdV4Action == 0 || _worldIdV4CredentialTtl == 0
                || _worldIdV4IssuerSchemaId == 0
        ) {
            revert InvalidCredential();
        }

        worldIdV4Verifier = IWorldIDVerifier(_worldIdV4Verifier);
        worldIdV4RpId = _worldIdV4RpId;
        worldIdV4Action = _worldIdV4Action;
        worldIdV4CredentialTtl = _worldIdV4CredentialTtl;
        worldIdV4IssuerSchemaId = _worldIdV4IssuerSchemaId;
        worldIdV4CredentialGenesisIssuedAtMin = _worldIdV4CredentialGenesisIssuedAtMin;
        if (!legacyWorldIdAttestationDisabled) {
            legacyWorldIdAttestationDisabled = true;
            emit LegacyWorldIdAttestationDisabledSet(msg.sender);
        }
        emit WorldIdV4VerifierConfigUpdated(
            _worldIdV4Verifier,
            _worldIdV4RpId,
            _worldIdV4Action,
            _worldIdV4CredentialTtl,
            _worldIdV4IssuerSchemaId,
            _worldIdV4CredentialGenesisIssuedAtMin
        );
    }

    /// @notice Self-report the account type and a metadata hash.
    /// @dev Metadata is reputational and indexable, not proof of rater type.
    function setProfile(RaterType raterType, bytes32 metadataHash) external {
        if (hasActiveHumanCredential(msg.sender) && !_isHumanCredentialCompatibleProfile(raterType)) {
            revert ActiveHumanCredentialRequiresHumanProfile();
        }

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

    /// @notice Request a delegate address to act for the caller's rater identity.
    /// @dev Delegation requires explicit acceptance and does not allow chains.
    function setDelegate(address delegate) external {
        if (delegate == address(0)) revert InvalidAddress();
        if (delegate == msg.sender) revert CannotDelegateSelf();
        if (delegateOf[msg.sender] != address(0)) revert CallerIsDelegate();
        if (_hasCredentialIdentity(delegate)) revert DelegateIsHolder();
        if (delegateOf[delegate] != address(0)) revert DelegateAlreadyAssigned();
        if (pendingDelegateOf[delegate] != address(0)) revert DelegateAlreadyAssigned();
        if (pendingDelegateTo[delegate] != address(0)) revert DelegateAlreadyAssigned();
        if (delegateTo[delegate] != address(0)) revert DelegateAlreadyAssigned();

        _clearInboundDelegation(msg.sender);
        _clearPendingDelegateRequest(msg.sender);

        pendingDelegateTo[msg.sender] = delegate;
        pendingDelegateOf[delegate] = msg.sender;

        emit DelegateRequested(msg.sender, delegate);
    }

    /// @notice Accept a pending delegation request.
    function acceptDelegate() external {
        address holder = pendingDelegateOf[msg.sender];
        if (holder == address(0)) revert NoPendingDelegate();
        if (_hasCredentialIdentity(msg.sender)) revert DelegateIsHolder();
        if (delegateOf[msg.sender] != address(0)) revert DelegateAlreadyAssigned();
        if (pendingDelegateTo[msg.sender] != address(0)) revert DelegateAlreadyAssigned();
        if (delegateTo[msg.sender] != address(0)) revert DelegateAlreadyAssigned();
        if (delegateOf[holder] != address(0)) revert CallerIsDelegate();
        if (pendingDelegateOf[holder] != address(0)) revert CallerIsDelegate();

        address oldDelegate = delegateTo[holder];
        if (oldDelegate != address(0)) {
            delete delegateOf[oldDelegate];
            emit DelegateRemoved(holder, oldDelegate);
        }

        delete pendingDelegateTo[holder];
        delete pendingDelegateOf[msg.sender];

        delegateTo[holder] = msg.sender;
        delegateOf[msg.sender] = holder;

        emit DelegateSet(holder, msg.sender);
    }

    /// @notice Remove active or pending delegation involving the caller.
    function removeDelegate() external {
        address oldDelegate = delegateTo[msg.sender];
        address pendingDelegate = pendingDelegateTo[msg.sender];
        address pendingDelegator = pendingDelegateOf[msg.sender];
        address activeDelegator = delegateOf[msg.sender];
        if (
            oldDelegate == address(0) && pendingDelegate == address(0) && pendingDelegator == address(0)
                && activeDelegator == address(0)
        ) {
            revert NoDelegateSet();
        }

        if (oldDelegate != address(0)) {
            delete delegateTo[msg.sender];
            delete delegateOf[oldDelegate];
            emit DelegateRemoved(msg.sender, oldDelegate);
        }

        if (pendingDelegate != address(0)) {
            delete pendingDelegateTo[msg.sender];
            delete pendingDelegateOf[pendingDelegate];
            emit PendingDelegateRemoved(msg.sender, pendingDelegate);
        }

        if (pendingDelegator != address(0)) {
            delete pendingDelegateOf[msg.sender];
            delete pendingDelegateTo[pendingDelegator];
            emit PendingDelegateRemoved(pendingDelegator, msg.sender);
        }

        if (activeDelegator != address(0)) {
            delete delegateOf[msg.sender];
            delete delegateTo[activeDelegator];
            emit DelegateRemoved(activeDelegator, msg.sender);
        }
    }

    /// @notice Attach a fresh World ID verified-human unit to the calling wallet.
    /// @dev The World ID signal is derived from msg.sender, so wallet ownership is proven by the transaction sender.
    function attestHumanCredentialWithProof(uint256 root, uint256 nullifierHash, uint256[8] calldata proof) external {
        if (legacyWorldIdAttestationDisabled) revert LegacyWorldIdAttestationDisabled();
        if (nullifierHash == 0) revert InvalidCredential();

        bytes32 storedNullifier = bytes32(nullifierHash);
        HumanCredential storage previous = _humanCredentials[msg.sender];
        if (
            previous.verified && !previous.revoked && previous.expiresAt > block.timestamp
                && previous.nullifierHash != storedNullifier
        ) {
            revert InvalidCredential();
        }

        address currentOwner = _humanNullifierOwnerByProvider[
            _humanNullifierSlotProvider(HumanCredentialProvider.WorldId)
        ][storedNullifier];
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

    /// @notice Preview World ID 4.0 uniqueness attestation path. Disabled until governance configures a verifier.
    /// @dev The v4 proof is still bound to msg.sender via RateLoop's stable address signal hash.
    function attestHumanCredentialWithV4Proof(
        uint256 nullifier,
        uint256 nonce,
        uint64 expiresAtMin,
        uint256[5] calldata proof
    ) external {
        if (address(worldIdV4Verifier) == address(0)) revert WorldIdV4VerifierNotConfigured();
        if (nullifier == 0) revert InvalidCredential();

        bytes32 storedNullifier = bytes32(nullifier);
        HumanCredential storage previous = _humanCredentials[msg.sender];
        if (
            previous.verified && !previous.revoked && previous.expiresAt > block.timestamp
                && previous.nullifierHash != storedNullifier
        ) {
            revert InvalidCredential();
        }

        address currentOwner = _humanNullifierOwnerByProvider[
            _humanNullifierSlotProvider(HumanCredentialProvider.WorldIdV4)
        ][storedNullifier];
        if (currentOwner != address(0) && currentOwner != msg.sender) revert NullifierAlreadyAssigned();

        uint256 signalHash = worldIdSignalHash(msg.sender);
        worldIdV4Verifier.verify(
            nullifier,
            worldIdV4Action,
            worldIdV4RpId,
            nonce,
            signalHash,
            expiresAtMin,
            worldIdV4IssuerSchemaId,
            worldIdV4CredentialGenesisIssuedAtMin,
            proof
        );

        if (expiresAtMin <= block.timestamp) revert InvalidCredential();
        uint256 ttlExpiresAt = block.timestamp + worldIdV4CredentialTtl;
        if (ttlExpiresAt > type(uint64).max) revert InvalidCredential();
        uint64 expiresAt = expiresAtMin < ttlExpiresAt ? expiresAtMin : uint64(ttlExpiresAt);

        bytes32 evidenceHash = keccak256(
            abi.encodePacked(
                "world-id-v4-preview",
                block.chainid,
                address(worldIdV4Verifier),
                worldIdV4RpId,
                worldIdV4Action,
                nonce,
                signalHash,
                expiresAtMin
            )
        );
        _attestHumanCredential(
            msg.sender,
            storedNullifier,
            worldIdV4CredentialScope(),
            expiresAt,
            HumanCredentialProvider.WorldIdV4,
            evidenceHash
        );
    }

    /// @notice Seed an approved human credential as the same verified-human unit used by World ID.
    /// @dev Provider provenance is internal metadata; consumers should show this as a generic verified human.
    function seedHumanCredential(address rater, uint64 expiresAt, bytes32 anchorId, bytes32 evidenceHash)
        external
        onlyRole(SEEDER_ROLE)
    {
        // RR-4 (2026-05-20 follow-up audit): clamp SEEDER-seeded TTL to the governance-tunable
        // upper bound. Mirrors the configured `worldIdCredentialTtl` clamp on the WorldID path.
        uint64 cap = maxSeededCredentialTtl;
        if (cap != 0 && expiresAt > uint256(block.timestamp) + uint256(cap)) {
            revert InvalidCredential();
        }
        _attestHumanCredential(
            rater, anchorId, SEEDED_HUMAN_SCOPE, expiresAt, HumanCredentialProvider.SeededHuman, evidenceHash
        );
    }

    /// @notice Set the upper bound on TTL for SEEDER-seeded credentials. `cap = 0` disables the
    ///         cap (back-compat). `cap > 0` rejects any future `seedHumanCredential` call where
    ///         `expiresAt > block.timestamp + cap`.
    /// @dev RR-4 (2026-05-20 follow-up audit). DEFAULT_ADMIN_ROLE gated because the cap is part
    ///      of the identity-system governance surface, alongside SEEDER_ROLE assignment itself.
    function setMaxSeededCredentialTtl(uint64 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint64 previousCap = maxSeededCredentialTtl;
        maxSeededCredentialTtl = cap;
        emit MaxSeededCredentialTtlUpdated(previousCap, cap);
    }

    function revokeHumanCredential(address rater) external onlyRole(SEEDER_ROLE) {
        if (rater == address(0)) revert InvalidAddress();
        HumanCredential storage credential = _humanCredentials[rater];
        if (!credential.verified || credential.revoked) revert InvalidCredential();

        credential.revoked = true;
        bytes32 nullifierHash = credential.nullifierHash;
        HumanCredentialProvider provider = credential.provider;
        if (nullifierHash != bytes32(0) && provider != HumanCredentialProvider.None) {
            _revokeHumanNullifier(provider, nullifierHash, rater);
        }

        // RR-1 (2026-05-20 follow-up audit): the M-Identity-2 sticky-canonical fix preserved
        // `_canonicalHumanIdentityKey[rater]` across credential refreshes so legitimate users
        // keep accumulated per-identity state. But on revocation the rater's identity is
        // *terminated*; leaving the canonical in place lets `clearRevokedHumanNullifier` +
        // re-seed of the same nullifier onto a DIFFERENT rater collide canonical keys between
        // two distinct addresses (profile theft, vote-commit DoS, bonus-award shadowing).
        // Clear it here so the next attestation for this rater re-seeds canonical from the
        // new credential's nullifier on first-attestation.
        _clearCanonicalHumanIdentity(rater);

        emit HumanCredentialRevoked(rater, nullifierHash, provider);
    }

    function clearRevokedHumanNullifier(HumanCredentialProvider provider, bytes32 nullifierHash)
        external
        onlyRole(SEEDER_ROLE)
    {
        if (nullifierHash == bytes32(0)) revert InvalidCredential();
        if (provider == HumanCredentialProvider.None) revert InvalidCredential();
        HumanCredentialProvider slotProvider = _humanNullifierSlotProvider(provider);
        _revokedHumanNullifierByProvider[slotProvider][nullifierHash] = false;
        address prevOwner = _lastRevokedOwnerByProvider[slotProvider][nullifierHash];
        emit HumanNullifierRevocationCleared(nullifierHash, provider, prevOwner);
    }

    /// @notice Link a World ID v4 nullifier to the legacy World ID nullifier used for launch one-human accounting.
    /// @dev The link is intentionally explicit: v3/v4 equivalence cannot be inferred on-chain when nullifier bytes
    ///      change. Launch consumers use this key only for launch bonuses/caps/anchors, not for general identity.
    function setWorldIdV4LaunchNullifierAlias(bytes32 v4NullifierHash, bytes32 legacyNullifierHash)
        external
        onlyRole(SEEDER_ROLE)
    {
        if (v4NullifierHash == bytes32(0) || legacyNullifierHash == bytes32(0)) revert InvalidCredential();
        bytes32 currentAlias = worldIdV4LaunchNullifierAlias[v4NullifierHash];
        if (currentAlias != bytes32(0) && currentAlias != legacyNullifierHash) revert InvalidCredential();
        if (currentAlias == bytes32(0) && worldIdV4LaunchNullifierSeen[v4NullifierHash]) revert InvalidCredential();
        worldIdV4LaunchNullifierAlias[v4NullifierHash] = legacyNullifierHash;
        emit WorldIdV4LaunchNullifierAliasSet(v4NullifierHash, legacyNullifierHash);
    }

    /// @notice M-Identity-2: explicit governance action to re-bind a rater's canonical identity
    ///         key. Replaces the prior silent override that fired on every `SeededHuman`
    ///         attestation. The rater must currently hold the credential whose nullifierHash
    ///         matches `newKey` (we re-use the credential's nullifierHash so the key is bound
    ///         to a verified attestation, not an arbitrary input). Emits
    ///         `CanonicalHumanIdentityKeyRotated` so off-chain consumers can re-map
    ///         per-identity state from the old key.
    /// @dev SEEDER-gated. Intended for legitimate corrective actions after a credential
    ///      revocation / re-attestation cycle; off-chain runbook should pause downstream
    ///      indexers, run the rotation, then re-publish indexer state under the new key.
    function rotateCanonicalIdentityKey(address rater) external onlyRole(SEEDER_ROLE) {
        if (rater == address(0)) revert InvalidAddress();
        HumanCredential memory credential = _humanCredentials[rater];
        if (
            credential.nullifierHash == bytes32(0) || !credential.verified || credential.revoked
                || credential.expiresAt <= block.timestamp
        ) {
            revert InvalidCredential();
        }
        bytes32 newKey = credentialIdentityKey(credential.provider, credential.nullifierHash);
        bytes32 previousKey = _canonicalHumanIdentityKey[rater];
        if (previousKey == newKey) return;
        _canonicalHumanIdentityKey[rater] = newKey;
        emit CanonicalHumanIdentityKeyRotated(rater, previousKey, newKey, credential.provider);
    }

    function getProfile(address rater) external view returns (RaterProfile memory) {
        return _profiles[rater];
    }

    function getHumanCredential(address rater) external view returns (HumanCredential memory) {
        return _humanCredentials[rater];
    }

    /// @notice Returns the verification scope of `rater`'s current human credential, or
    ///         `bytes32(0)` if no verified credential exists.
    /// @dev RR-5 (2026-05-20 follow-up audit): convenience accessor for cross-protocol consumers.
    ///      Today the only valid scopes are `SEEDED_HUMAN_SCOPE` (for SEEDER-seeded credentials)
    ///      and the configured `worldIdScope` (for self-attested WorldID credentials). If this
    ///      registry is ever shared with a sibling protocol, that protocol's consumers MUST
    ///      verify the returned scope against their own expected value before honoring the
    ///      identity -- a credential issued for one scope must not silently authorize another.
    function credentialScope(address rater) external view returns (bytes32) {
        HumanCredential storage credential = _humanCredentials[rater];
        if (!credential.verified || _isCredentialRevoked(credential)) return bytes32(0);
        return credential.scope;
    }

    /// @notice Returns the address that owns a nullifier hash within a credential provider namespace.
    /// @dev `WorldId` and `WorldIdV4` share the same slot because they map to the same canonical
    ///      human identity. `SeededHuman` remains provider-separated so a seeded anchor cannot
    ///      collide with a World ID nullifier of the same bytes (L-Identity-1).
    function humanNullifierOwnerByProvider(HumanCredentialProvider provider, bytes32 nullifierHash)
        external
        view
        returns (address)
    {
        return _humanNullifierOwnerByProvider[_humanNullifierSlotProvider(provider)][nullifierHash];
    }

    /// @notice Returns whether a nullifier hash has been revoked within its credential provider namespace.
    /// @dev `WorldId` and `WorldIdV4` intentionally share revocation state.
    function revokedHumanNullifierByProvider(HumanCredentialProvider provider, bytes32 nullifierHash)
        external
        view
        returns (bool)
    {
        return _revokedHumanNullifierByProvider[_humanNullifierSlotProvider(provider)][nullifierHash];
    }

    function resolveRater(address actor) public view returns (ResolvedRater memory resolved) {
        if (actor == address(0)) return resolved;

        address holder = actor;
        address delegator = delegateOf[actor];
        bool delegated = delegator != address(0);
        if (delegated) holder = delegator;

        (bytes32 identityKey, bytes32 humanNullifier, bool hasActiveCredential) = _identityForHolder(holder);
        return ResolvedRater({
            holder: holder,
            identityKey: identityKey,
            humanNullifier: humanNullifier,
            hasActiveHumanCredential: hasActiveCredential,
            delegated: delegated
        });
    }

    function worldIdSignalHash(address rater) public pure returns (uint256) {
        return hashToField(abi.encodePacked(rater));
    }

    function worldIdV4CredentialScope() public view returns (bytes32) {
        if (worldIdV4RpId == 0 || worldIdV4Action == 0) return bytes32(0);
        return keccak256(abi.encode("world-id-v4", worldIdV4RpId, worldIdV4Action));
    }

    function hashToField(bytes memory value) public pure returns (uint256) {
        return uint256(keccak256(value)) >> 8;
    }

    function addressIdentityKey(address account) public pure returns (bytes32) {
        if (account == address(0)) return bytes32(0);
        return keccak256(abi.encodePacked("rateloop.address-identity-v1", account));
    }

    function credentialIdentityKey(HumanCredentialProvider provider, bytes32 nullifierHash)
        public
        pure
        returns (bytes32)
    {
        if (provider == HumanCredentialProvider.None || nullifierHash == bytes32(0)) return bytes32(0);
        if (provider == HumanCredentialProvider.WorldIdV4) provider = HumanCredentialProvider.WorldId;
        return keccak256(abi.encode("rateloop.human-identity-v1", provider, nullifierHash));
    }

    function launchHumanIdentityKey(HumanCredentialProvider provider, bytes32 nullifierHash)
        public
        view
        returns (bytes32)
    {
        if (provider == HumanCredentialProvider.None || nullifierHash == bytes32(0)) return bytes32(0);
        if (provider == HumanCredentialProvider.WorldIdV4) {
            bytes32 legacyNullifierHash = worldIdV4LaunchNullifierAlias[nullifierHash];
            if (legacyNullifierHash != bytes32(0)) {
                nullifierHash = legacyNullifierHash;
            }
            provider = HumanCredentialProvider.WorldId;
        }
        if (provider == HumanCredentialProvider.WorldId) {
            return keccak256(abi.encode("rateloop.launch-world-id-human-v1", nullifierHash));
        }
        return keccak256(abi.encode(provider, nullifierHash));
    }

    function hasActiveHumanCredential(address rater) public view returns (bool) {
        HumanCredential storage credential = _humanCredentials[rater];
        return credential.verified && !_isCredentialRevoked(credential) && credential.expiresAt > block.timestamp;
    }

    function _isCredentialRevoked(HumanCredential storage credential) private view returns (bool) {
        if (credential.revoked) return true;
        HumanCredentialProvider slotProvider = _humanNullifierSlotProvider(credential.provider);
        return _revokedHumanNullifierByProvider[slotProvider][credential.nullifierHash];
    }

    function _humanNullifierSlotProvider(HumanCredentialProvider provider)
        private
        pure
        returns (HumanCredentialProvider)
    {
        if (provider == HumanCredentialProvider.WorldIdV4) return HumanCredentialProvider.WorldId;
        return provider;
    }

    function _revokeHumanNullifier(HumanCredentialProvider provider, bytes32 nullifierHash, address revokedRater)
        private
    {
        HumanCredentialProvider slotProvider = _humanNullifierSlotProvider(provider);
        address slotOwner = _humanNullifierOwnerByProvider[slotProvider][nullifierHash];
        address lastRevokedOwner = slotOwner == address(0) ? revokedRater : slotOwner;
        if (slotOwner == revokedRater) {
            delete _humanNullifierOwnerByProvider[slotProvider][nullifierHash];
        }

        _revokedHumanNullifierByProvider[slotProvider][nullifierHash] = true;
        _lastRevokedOwnerByProvider[slotProvider][nullifierHash] = lastRevokedOwner;
    }

    function _clearCanonicalHumanIdentity(address rater) private {
        bytes32 previousCanonical = _canonicalHumanIdentityKey[rater];
        if (previousCanonical != bytes32(0)) {
            delete _canonicalHumanIdentityKey[rater];
            emit CanonicalHumanIdentityKeyCleared(rater, previousCanonical);
        }
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
        HumanCredentialProvider slotProvider = _humanNullifierSlotProvider(provider);
        if (_revokedHumanNullifierByProvider[slotProvider][nullifierHash]) revert InvalidCredential();

        HumanCredential storage previous = _humanCredentials[rater];
        // Clean up the previous storage slot when ANY part of the effective composite key
        // changes -- including a provider switch outside the aliased WorldID family. The
        // earlier `previous.nullifierHash != nullifierHash` check alone leaked the old provider's
        // slot, so a later revocation only cleared the new provider and the old provider's
        // namespace stayed assigned to this rater (codex PR #10 review).
        //
        // RR-3 (2026-05-20 follow-up audit): note that on provider switch the old provider's
        // nullifier slot is freed WITHOUT marking the nullifier revoked. This is intentional --
        // the original holder of the underlying credential (e.g. the WorldID identity for that
        // nullifier) can still self-attest under the cleared slot, since the underlying proof is
        // bound to msg.sender. A third party cannot impersonate because they lack the proof.
        // The asymmetry with revokeHumanCredential (which DOES set the revoke flag) is therefore
        // by design, not an oversight.
        if (
            previous.nullifierHash != bytes32(0)
                && (previous.nullifierHash != nullifierHash
                    || _humanNullifierSlotProvider(previous.provider) != slotProvider)
        ) {
            HumanCredentialProvider previousProvider = _humanNullifierSlotProvider(previous.provider);
            bool previousOwnerSlotCleared;
            if (
                previousProvider != HumanCredentialProvider.None
                    && _humanNullifierOwnerByProvider[previousProvider][previous.nullifierHash] == rater
            ) {
                delete _humanNullifierOwnerByProvider[previousProvider][previous.nullifierHash];
                previousOwnerSlotCleared = true;
            }
            if (previousOwnerSlotCleared) {
                bytes32 previousKey = credentialIdentityKey(previousProvider, previous.nullifierHash);
                bytes32 currentCanonical = _canonicalHumanIdentityKey[rater];
                if (currentCanonical == previousKey) {
                    bytes32 newKey = credentialIdentityKey(provider, nullifierHash);
                    _canonicalHumanIdentityKey[rater] = newKey;
                    emit CanonicalHumanIdentityKeyRotated(rater, previousKey, newKey, provider);
                }
            }
        }

        address currentOwner = _humanNullifierOwnerByProvider[slotProvider][nullifierHash];
        if (currentOwner != address(0) && currentOwner != rater) revert NullifierAlreadyAssigned();
        _humanNullifierOwnerByProvider[slotProvider][nullifierHash] = rater;
        // M-Identity-2: only seed the canonical identity key on first attestation. The earlier
        // unconditional `provider == SeededHuman` override let SEEDER silently rotate the
        // canonical key of a user who already had a WorldID-bound identity, severing
        // accumulated per-identity cooldowns / exclusions / profile ownership held against
        // the old key. Re-binding the canonical key after first set now requires an explicit
        // `rotateCanonicalIdentityKey` governance call that emits a migration event so
        // downstream consumers can re-map.
        if (_canonicalHumanIdentityKey[rater] == bytes32(0)) {
            _canonicalHumanIdentityKey[rater] = credentialIdentityKey(provider, nullifierHash);
        }
        if (provider == HumanCredentialProvider.WorldIdV4) {
            worldIdV4LaunchNullifierSeen[nullifierHash] = true;
        }
        _clearInboundDelegation(rater);

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

        _forceHumanCredentialCompatibleProfile(rater);
    }

    function _forceHumanCredentialCompatibleProfile(address rater) internal {
        RaterProfile storage profile = _profiles[rater];
        if (_isHumanCredentialCompatibleProfile(profile.raterType)) return;

        profile.raterType = RaterType.Human;
        profile.updatedAt = uint64(block.timestamp);

        emit RaterProfileUpdated(rater, RaterType.Human, profile.metadataHash, uint64(block.timestamp));
    }

    function _isHumanCredentialCompatibleProfile(RaterType raterType) internal pure returns (bool) {
        return raterType == RaterType.Human || raterType == RaterType.Team || raterType == RaterType.Hybrid;
    }

    function _identityForHolder(address holder)
        internal
        view
        returns (bytes32 identityKey, bytes32 humanNullifier, bool hasActiveCredential)
    {
        HumanCredential storage credential = _humanCredentials[holder];
        if (credential.verified && !_isCredentialRevoked(credential) && credential.nullifierHash != bytes32(0)) {
            humanNullifier = credential.nullifierHash;
            identityKey = _canonicalHumanIdentityKey[holder];
            if (identityKey == bytes32(0)) {
                identityKey = credentialIdentityKey(credential.provider, humanNullifier);
            }
            hasActiveCredential = credential.expiresAt > block.timestamp;
        } else {
            identityKey = addressIdentityKey(holder);
        }
    }

    function _hasCredentialIdentity(address holder) internal view returns (bool) {
        HumanCredential storage credential = _humanCredentials[holder];
        return credential.verified && !_isCredentialRevoked(credential) && credential.nullifierHash != bytes32(0);
    }

    function _clearPendingDelegateRequest(address holder) internal {
        address pendingDelegate = pendingDelegateTo[holder];
        if (pendingDelegate != address(0)) {
            delete pendingDelegateTo[holder];
            delete pendingDelegateOf[pendingDelegate];
            emit PendingDelegateRemoved(holder, pendingDelegate);
        }
    }

    function _clearInboundDelegation(address account) internal {
        address activeDelegator = delegateOf[account];
        if (activeDelegator != address(0)) {
            delete delegateOf[account];
            delete delegateTo[activeDelegator];
            emit DelegateRemoved(activeDelegator, account);
        }

        address pendingDelegator = pendingDelegateOf[account];
        if (pendingDelegator != address(0)) {
            delete pendingDelegateOf[account];
            delete pendingDelegateTo[pendingDelegator];
            emit PendingDelegateRemoved(pendingDelegator, account);
        }
    }
}
