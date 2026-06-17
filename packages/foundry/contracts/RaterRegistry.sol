// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { IWorldIDRouter } from "./interfaces/IWorldIDRouter.sol";
import { IWorldIDVerifier } from "./interfaces/IWorldIDVerifier.sol";
import { IRaterIdentityRegistry } from "./interfaces/IRaterIdentityRegistry.sol";
import { IConfidentialityEscrow } from "./interfaces/IConfidentialityEscrow.sol";
import { RaterRegistryWorldIdLib } from "./libraries/RaterRegistryWorldIdLib.sol";

/// @title RaterRegistry
/// @notice Optional rater metadata, human credentials, public follows, and delegation for RateLoop.
/// @dev This registry is intentionally non-gating: rating contracts may read it, but base participation
///      must keep working when no profile or credential exists.
contract RaterRegistry is Initializable, AccessControlUpgradeable, IRaterIdentityRegistry {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant SEEDER_ROLE = keccak256("SEEDER_ROLE");
    bytes32 public constant LAUNCH_CONSUMER_ROLE = keccak256("LAUNCH_CONSUMER_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    uint256 public constant WORLD_ID_GROUP_ID = 1;
    bytes32 public constant SEEDED_HUMAN_SCOPE = keccak256("rateloop-seeded-human-v1");
    uint8 public constant WORLD_CREDENTIAL_SELFIE = 1;
    uint8 public constant WORLD_CREDENTIAL_PASSPORT = 2;
    uint8 public constant WORLD_CREDENTIAL_PROOF_OF_HUMAN = 3;
    uint64 private constant WORLD_ISSUER_SCHEMA_PROOF_OF_HUMAN = 1;
    uint64 private constant WORLD_ISSUER_SCHEMA_SELFIE = 11;
    uint64 private constant WORLD_ISSUER_SCHEMA_PASSPORT = 9303;
    bytes32 public constant DELEGATE_AUTHORIZATION_TYPEHASH =
        keccak256("DelegateAuthorization(address holder,address delegate,uint256 nonce,uint256 deadline)");
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant EIP712_NAME_HASH = keccak256("RateLoop RaterRegistry");
    bytes32 private constant EIP712_VERSION_HASH = keccak256("1");

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
        SeededHuman,
        WorldIdV4,
        WorldId
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

    struct WorldCredential {
        bool verified;
        bool revoked;
        uint8 kind;
        bytes32 nullifierHash;
        bytes32 scope;
        uint64 verifiedAt;
        uint64 expiresAt;
        bytes32 evidenceHash;
    }

    struct HumanPresence {
        bool verified;
        uint8 kind;
        uint64 lastRecheckedAt;
        uint64 freshUntil;
        bytes32 evidenceHash;
    }

    struct WorldIdV4Config {
        IWorldIDVerifier verifier;
        uint64 rpId;
        uint256 action;
        uint64 ttl;
        uint64 issuerSchemaId;
        uint256 credentialGenesisIssuedAtMin;
        bool enabled;
        bool frozen;
    }

    struct IdentityBan {
        uint64 bannedAt;
        uint64 expiresAt;
        bytes32 evidenceHash;
    }

    mapping(address => RaterProfile) private _profiles;
    mapping(address => HumanCredential) private _humanCredentials;
    mapping(address => mapping(uint8 => WorldCredential)) private _worldCredentials;
    mapping(address => mapping(uint8 => HumanPresence)) private _humanPresence;
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
    mapping(uint8 => mapping(bytes32 => address)) private _worldCredentialNullifierOwner;
    mapping(uint8 => mapping(bytes32 => bool)) private _revokedWorldCredentialNullifier;
    mapping(uint8 => mapping(bytes32 => address)) private _worldPresenceNullifierOwner;
    mapping(uint8 => WorldIdV4Config) private _worldCredentialConfigs;
    mapping(uint8 => WorldIdV4Config) private _worldPresenceConfigs;
    mapping(address => mapping(address => bool)) internal isFollowing;
    // Deprecated follow counters retained for proxy-safe upgrades.
    mapping(address => uint256) private followingCount;
    mapping(address => uint256) private followerCount;
    mapping(address => address) public delegateTo;
    mapping(address => address) public delegateOf;
    mapping(address => address) public pendingDelegateTo;
    mapping(address => address) public pendingDelegateOf;

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
    // slither-disable-next-line constable-states
    uint256 public worldIdV4PresenceAction;
    // slither-disable-next-line constable-states
    uint64 public worldIdV4PresenceTtl;
    bool public worldIdV4PresenceConfigFrozen;
    mapping(uint8 => mapping(bytes32 => bool)) private _usedWorldCredentialProof;
    mapping(uint8 => mapping(bytes32 => bool)) private _usedWorldPresenceProof;
    mapping(bytes32 => IdentityBan) private _identityBans;
    address public confidentialityEscrow;
    mapping(bytes32 => bytes32[]) private _identityBanSources;
    mapping(address => uint256) public delegateAuthorizationNonces;
    IWorldIDRouter public worldIdRouter;
    bytes32 public worldIdScope;
    uint256 public worldIdExternalNullifierHash;
    uint64 public worldIdCredentialTtl;
    bool public worldIdVerifierConfigFrozen;
    bool public legacyWorldIdAttestationDisabled;
    /// @dev Reserved storage gap for future proxy-safe upgrades.
    uint256[21] private __gap;

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
    event WorldCredentialVerified(
        address indexed rater,
        uint8 indexed kind,
        bytes32 indexed nullifierHash,
        bytes32 scope,
        uint64 verifiedAt,
        uint64 expiresAt,
        bytes32 evidenceHash
    );
    event WorldCredentialRevoked(address indexed rater, uint8 indexed kind, bytes32 indexed nullifierHash);
    event HumanPresenceVerified(
        address indexed rater,
        uint8 indexed kind,
        bytes32 indexed nullifierHash,
        uint64 lastRecheckedAt,
        uint64 freshUntil,
        bytes32 evidenceHash
    );
    /// @notice RR-6 (2026-05-20 follow-up audit): `prevOwner` identifies the rater whose
    ///         credential was last revoked against this (provider, nullifierHash). Off-chain
    ///         alerting can fire on the single log instead of joining against a prior
    ///         `HumanCredentialRevoked` event.
    event HumanNullifierRevocationCleared(
        bytes32 indexed nullifierHash, HumanCredentialProvider indexed provider, address indexed prevOwner
    );
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
    event LegacyWorldIdAttestationDisabledSet(bool disabled);
    event WorldIdV4VerifierConfigUpdated(
        address indexed verifier,
        uint64 indexed rpId,
        uint256 indexed action,
        uint64 credentialTtl,
        uint64 issuerSchemaId,
        uint256 credentialGenesisIssuedAtMin
    );
    event WorldIdV4VerifierConfigLocked(address indexed account);
    event WorldCredentialV4ConfigUpdated(
        uint8 indexed kind,
        address indexed verifier,
        uint64 indexed rpId,
        uint256 action,
        uint64 credentialTtl,
        uint64 issuerSchemaId,
        uint256 credentialGenesisIssuedAtMin,
        bool enabled
    );
    event WorldCredentialV4ConfigLocked(uint8 indexed kind, address indexed account);
    event WorldPresenceV4ConfigUpdated(
        uint8 indexed kind,
        address indexed verifier,
        uint64 indexed rpId,
        uint256 action,
        uint64 presenceTtl,
        uint64 issuerSchemaId,
        uint256 credentialGenesisIssuedAtMin,
        bool enabled
    );
    event WorldPresenceV4ConfigLocked(uint8 indexed kind, address indexed account);
    event ProfileFollowed(address indexed follower, address indexed target, uint64 followedAt);
    event ProfileUnfollowed(address indexed follower, address indexed target, uint64 unfollowedAt);
    event DelegateRequested(address indexed holder, address indexed delegate);
    event DelegateSet(address indexed holder, address indexed delegate);
    event DelegateRemoved(address indexed holder, address indexed previousDelegate);
    event PendingDelegateRemoved(address indexed holder, address indexed previousPendingDelegate);
    event IdentityBanned(
        HumanCredentialProvider indexed provider,
        bytes32 indexed nullifierHash,
        uint64 expiresAt,
        bool permanent,
        bytes32 evidenceHash,
        string reason
    );
    event IdentityUnbanned(HumanCredentialProvider indexed provider, bytes32 indexed nullifierHash);

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
    error SignatureExpired();
    error InvalidSignature();
    error WorldIdVerifierConfigFrozen();
    error LegacyWorldIdAttestationDisabled();
    error WorldIdV4VerifierConfigFrozen();
    error WorldIdV4PresenceConfigFrozen();
    error WorldIdV4VerifierNotConfigured();
    error UnsupportedCredentialKind();
    error WorldCredentialConfigFrozen();
    error WorldPresenceConfigFrozen();
    error InvalidBan();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(
        address admin,
        address governance,
        address _worldIdV4Verifier,
        uint64 _worldIdV4RpId,
        uint256 _worldIdV4Action,
        uint256 _worldIdV4PresenceAction,
        uint64 _worldIdV4CredentialTtl,
        uint64 _worldIdV4PresenceTtl,
        uint64 _worldIdV4IssuerSchemaId,
        uint256 _worldIdV4CredentialGenesisIssuedAtMin
    ) {
        _initializeRaterRegistry(
            admin,
            governance,
            _worldIdV4Verifier,
            _worldIdV4RpId,
            _worldIdV4Action,
            _worldIdV4PresenceAction,
            _worldIdV4CredentialTtl,
            _worldIdV4PresenceTtl,
            _worldIdV4IssuerSchemaId,
            _worldIdV4CredentialGenesisIssuedAtMin
        );
        _disableInitializers();
    }

    function initialize(
        address admin,
        address governance,
        address _worldIdV4Verifier,
        uint64 _worldIdV4RpId,
        uint256 _worldIdV4Action,
        uint256 _worldIdV4PresenceAction,
        uint64 _worldIdV4CredentialTtl,
        uint64 _worldIdV4PresenceTtl,
        uint64 _worldIdV4IssuerSchemaId,
        uint256 _worldIdV4CredentialGenesisIssuedAtMin
    ) external initializer {
        __AccessControl_init();
        _initializeRaterRegistry(
            admin,
            governance,
            _worldIdV4Verifier,
            _worldIdV4RpId,
            _worldIdV4Action,
            _worldIdV4PresenceAction,
            _worldIdV4CredentialTtl,
            _worldIdV4PresenceTtl,
            _worldIdV4IssuerSchemaId,
            _worldIdV4CredentialGenesisIssuedAtMin
        );
    }

    function initializeWithWorldIdV3(
        address admin,
        address governance,
        address _worldIdRouter,
        bytes32 _worldIdScope,
        uint256 _worldIdExternalNullifierHash,
        uint64 _worldIdCredentialTtl
    ) external initializer {
        __AccessControl_init();
        _initializeRaterRegistryWithWorldIdV3(
            admin, governance, _worldIdRouter, _worldIdScope, _worldIdExternalNullifierHash, _worldIdCredentialTtl
        );
    }

    function _initializeRaterRegistry(
        address admin,
        address governance,
        address _worldIdV4Verifier,
        uint64 _worldIdV4RpId,
        uint256 _worldIdV4Action,
        uint256,
        uint64 _worldIdV4CredentialTtl,
        uint64,
        uint64 _worldIdV4IssuerSchemaId,
        uint256 _worldIdV4CredentialGenesisIssuedAtMin
    ) private {
        if (admin == address(0) || governance == address(0)) {
            revert InvalidAddress();
        }
        _setRoleAdmin(LAUNCH_CONSUMER_ROLE, SEEDER_ROLE);
        _setWorldIdV4VerifierConfig(
            _worldIdV4Verifier,
            _worldIdV4RpId,
            _worldIdV4Action,
            _worldIdV4CredentialTtl,
            _worldIdV4IssuerSchemaId,
            _worldIdV4CredentialGenesisIssuedAtMin,
            true
        );
        maxSeededCredentialTtl = _worldIdV4CredentialTtl;
        emit MaxSeededCredentialTtlUpdated(0, _worldIdV4CredentialTtl);

        _grantRole(DEFAULT_ADMIN_ROLE, governance);
        _grantRole(ADMIN_ROLE, governance);
        _grantRole(SEEDER_ROLE, governance);
        _grantRole(GOVERNANCE_ROLE, governance);

        if (admin != governance) {
            _grantRole(ADMIN_ROLE, admin);
            _grantRole(SEEDER_ROLE, admin);
        }
    }

    function _initializeRaterRegistryWithWorldIdV3(
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
        _setRoleAdmin(LAUNCH_CONSUMER_ROLE, SEEDER_ROLE);
        _setWorldIdVerifierConfig(
            _worldIdRouter, _worldIdScope, _worldIdExternalNullifierHash, _worldIdCredentialTtl, true
        );
        maxSeededCredentialTtl = _worldIdCredentialTtl;
        emit MaxSeededCredentialTtlUpdated(0, _worldIdCredentialTtl);

        _grantRole(DEFAULT_ADMIN_ROLE, governance);
        _grantRole(ADMIN_ROLE, governance);
        _grantRole(SEEDER_ROLE, governance);
        _grantRole(GOVERNANCE_ROLE, governance);

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

    function setLegacyWorldIdAttestationDisabled(bool disabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        legacyWorldIdAttestationDisabled = disabled;
        emit LegacyWorldIdAttestationDisabledSet(disabled);
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

    function setWorldIdV4PresenceConfig(address, uint64, uint256, uint64, uint64, uint256)
        external
        view
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        revert UnsupportedCredentialKind();
    }

    function freezeWorldIdV4VerifierConfig() external onlyRole(DEFAULT_ADMIN_ROLE) {
        worldIdV4VerifierConfigFrozen = true;
        _worldCredentialConfigs[WORLD_CREDENTIAL_PROOF_OF_HUMAN].frozen = true;
        emit WorldIdV4VerifierConfigLocked(msg.sender);
        emit WorldCredentialV4ConfigLocked(WORLD_CREDENTIAL_PROOF_OF_HUMAN, msg.sender);
    }

    function freezeWorldIdV4PresenceConfig() external onlyRole(DEFAULT_ADMIN_ROLE) {
        worldIdV4PresenceConfigFrozen = true;
        emit WorldPresenceV4ConfigLocked(WORLD_CREDENTIAL_PROOF_OF_HUMAN, msg.sender);
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
        _setCredentialV4Config(
            WORLD_CREDENTIAL_PROOF_OF_HUMAN,
            _worldIdV4Verifier,
            _worldIdV4RpId,
            _worldIdV4Action,
            _worldIdV4CredentialTtl,
            _worldIdV4IssuerSchemaId,
            _worldIdV4CredentialGenesisIssuedAtMin,
            _worldIdV4Verifier != address(0),
            requireCode
        );
        WorldIdV4Config storage config = _worldCredentialConfigs[WORLD_CREDENTIAL_PROOF_OF_HUMAN];
        worldIdV4Verifier = config.verifier;
        worldIdV4RpId = config.rpId;
        worldIdV4Action = config.action;
        worldIdV4CredentialTtl = config.ttl;
        worldIdV4IssuerSchemaId = config.issuerSchemaId;
        worldIdV4CredentialGenesisIssuedAtMin = config.credentialGenesisIssuedAtMin;
        emit WorldIdV4VerifierConfigUpdated(
            _worldIdV4Verifier,
            _worldIdV4RpId,
            _worldIdV4Action,
            _worldIdV4CredentialTtl,
            _worldIdV4IssuerSchemaId,
            _worldIdV4CredentialGenesisIssuedAtMin
        );
    }

    function setWorldCredentialV4Config(
        uint8 kind,
        address verifier,
        uint64 rpId,
        uint256 action,
        uint64 credentialTtl,
        uint64 issuerSchemaId,
        uint256 credentialGenesisIssuedAtMin,
        bool enabled
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (kind != WORLD_CREDENTIAL_PROOF_OF_HUMAN) revert UnsupportedCredentialKind();
        if (worldIdV4VerifierConfigFrozen || _worldCredentialConfigs[kind].frozen) {
            revert WorldIdV4VerifierConfigFrozen();
        }
        _setCredentialV4Config(
            kind, verifier, rpId, action, credentialTtl, issuerSchemaId, credentialGenesisIssuedAtMin, enabled, true
        );
        if (kind == WORLD_CREDENTIAL_PROOF_OF_HUMAN) {
            WorldIdV4Config storage config = _worldCredentialConfigs[kind];
            worldIdV4Verifier = config.verifier;
            worldIdV4RpId = config.rpId;
            worldIdV4Action = config.action;
            worldIdV4CredentialTtl = config.ttl;
            worldIdV4IssuerSchemaId = config.issuerSchemaId;
            worldIdV4CredentialGenesisIssuedAtMin = config.credentialGenesisIssuedAtMin;
        }
    }

    function freezeWorldCredentialV4Config(uint8 kind) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (kind != WORLD_CREDENTIAL_PROOF_OF_HUMAN) revert UnsupportedCredentialKind();
        _worldCredentialConfigs[kind].frozen = true;
        worldIdV4VerifierConfigFrozen = true;
        emit WorldIdV4VerifierConfigLocked(msg.sender);
        emit WorldCredentialV4ConfigLocked(kind, msg.sender);
    }

    function setWorldPresenceV4Config(uint8, address, uint64, uint256, uint64, uint64, uint256, bool)
        external
        view
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        revert UnsupportedCredentialKind();
    }

    function freezeWorldPresenceV4Config(uint8) external view onlyRole(DEFAULT_ADMIN_ROLE) {
        revert UnsupportedCredentialKind();
    }

    function setConfidentialityEscrow(address newEscrow) external onlyRole(ADMIN_ROLE) {
        address oldEscrow = confidentialityEscrow;
        if (oldEscrow != address(0) && newEscrow != oldEscrow) {
            revert InvalidAddress();
        }
        (address registry_,) = IConfidentialityEscrow(newEscrow).confidentialityEscrowConfigShape();
        if (registry_ != address(this) && RaterRegistry(registry_).confidentialityEscrow() != newEscrow) {
            revert InvalidAddress();
        }
        confidentialityEscrow = newEscrow;
    }

    /// @notice Applies a protocol-wide identity sanction by credential nullifier.
    /// @dev This is a broader governance sanction power, not a confidentiality-only gate:
    ///      governance must publish `reason` and `evidenceHash`, but the registry does not
    ///      require a ConfidentialityEscrow nexus before writing the ban.
    function banIdentity(
        HumanCredentialProvider provider,
        bytes32 nullifierHash,
        uint64 expiresAt,
        string calldata reason,
        bytes32 evidenceHash
    ) external onlyRole(GOVERNANCE_ROLE) {
        _banCredentialNullifier(provider, nullifierHash, expiresAt, reason, evidenceHash);
    }

    /// @notice Applies the same broader governance sanction to a known credential nullifier.
    /// @dev Kept as a separately named entrypoint for arbitration flows that learn the
    ///      nullifier before or after the current holder is known.
    function banKnownCredentialNullifier(
        HumanCredentialProvider provider,
        bytes32 nullifierHash,
        uint64 expiresAt,
        string calldata reason,
        bytes32 evidenceHash
    ) external onlyRole(GOVERNANCE_ROLE) {
        _banCredentialNullifier(provider, nullifierHash, expiresAt, reason, evidenceHash);
    }

    function _banCredentialNullifier(
        HumanCredentialProvider provider,
        bytes32 nullifierHash,
        uint64 expiresAt,
        string calldata reason,
        bytes32 evidenceHash
    ) private {
        if (provider == HumanCredentialProvider.None || nullifierHash == bytes32(0)) {
            revert InvalidCredential();
        }
        if (bytes(reason).length > 280 || evidenceHash == bytes32(0)) revert InvalidBan();
        bool permanent = expiresAt == type(uint64).max;
        if (!permanent) {
            if (expiresAt == 0) {
                expiresAt = uint64(block.timestamp + 365 days);
            }
            if (expiresAt <= block.timestamp) revert InvalidBan();
        }

        bytes32 credentialKey = credentialIdentityKey(provider, nullifierHash);
        _writeIdentityBan(credentialKey, expiresAt, evidenceHash);
        _writeIdentityBan(launchHumanIdentityKey(provider, nullifierHash), expiresAt, evidenceHash);
        HumanCredentialProvider slotProvider = provider;
        address owner = _humanNullifierOwnerByProvider[slotProvider][nullifierHash];
        if (owner == address(0)) {
            owner = _lastRevokedOwnerByProvider[slotProvider][nullifierHash];
        }
        _writeDerivedIdentityBanForHolder(owner, credentialKey);
        address lastHolder = _lastRevokedOwnerByProvider[slotProvider][nullifierHash];
        if (lastHolder != owner) _writeDerivedIdentityBanForHolder(lastHolder, credentialKey);

        emit IdentityBanned(provider, nullifierHash, expiresAt, permanent, evidenceHash, reason);
    }

    function unbanIdentity(HumanCredentialProvider provider, bytes32 nullifierHash) external onlyRole(GOVERNANCE_ROLE) {
        if (provider == HumanCredentialProvider.None || nullifierHash == bytes32(0)) revert InvalidCredential();
        bytes32 credentialKey = credentialIdentityKey(provider, nullifierHash);
        delete _identityBans[credentialKey];
        delete _identityBans[launchHumanIdentityKey(provider, nullifierHash)];
        HumanCredentialProvider slotProvider = provider;
        address owner = _humanNullifierOwnerByProvider[slotProvider][nullifierHash];
        _clearDerivedIdentityBan(owner, credentialKey);
        address lastHolder = _lastRevokedOwnerByProvider[slotProvider][nullifierHash];
        if (lastHolder != owner) _clearDerivedIdentityBan(lastHolder, credentialKey);
        delete _lastRevokedOwnerByProvider[slotProvider][nullifierHash];
        emit IdentityUnbanned(provider, nullifierHash);
    }

    function _setCredentialV4Config(
        uint8 kind,
        address verifier,
        uint64 rpId,
        uint256 action,
        uint64 ttl,
        uint64 issuerSchemaId,
        uint256 credentialGenesisIssuedAtMin,
        bool enabled,
        bool requireCode
    ) private {
        _setWorldIdV4Config(
            _worldCredentialConfigs[kind],
            verifier,
            rpId,
            action,
            ttl,
            issuerSchemaId,
            credentialGenesisIssuedAtMin,
            enabled,
            requireCode
        );
        emit WorldCredentialV4ConfigUpdated(
            kind, verifier, rpId, action, ttl, issuerSchemaId, credentialGenesisIssuedAtMin, enabled
        );
    }

    function _setWorldIdV4Config(
        WorldIdV4Config storage config,
        address verifier,
        uint64 rpId,
        uint256 action,
        uint64 ttl,
        uint64 issuerSchemaId,
        uint256 credentialGenesisIssuedAtMin,
        bool enabled,
        bool requireCode
    ) private {
        if (!enabled) {
            if (verifier != address(0) || rpId != 0 || action != 0 || ttl != 0 || issuerSchemaId != 0) {
                revert InvalidCredential();
            }
            config.verifier = IWorldIDVerifier(address(0));
            config.rpId = 0;
            config.action = 0;
            config.ttl = 0;
            config.issuerSchemaId = 0;
            config.credentialGenesisIssuedAtMin = 0;
            config.enabled = false;
            return;
        }

        if (verifier == address(0)) revert InvalidAddress();
        if (requireCode && verifier.code.length == 0) revert InvalidAddress();
        if (rpId == 0 || action == 0 || ttl == 0 || issuerSchemaId == 0) revert InvalidCredential();

        config.verifier = IWorldIDVerifier(verifier);
        config.rpId = rpId;
        config.action = action;
        config.ttl = ttl;
        config.issuerSchemaId = issuerSchemaId;
        config.credentialGenesisIssuedAtMin = credentialGenesisIssuedAtMin;
        config.enabled = true;
    }

    /// @notice Self-report the account type and a metadata hash.
    /// @dev Metadata is reputational and indexable, not proof of rater type.
    function setProfile(RaterType raterType, bytes32 metadataHash) external {
        if (hasActiveHumanCredential(msg.sender) && !_isHumanCredentialCompatibleProfile(raterType)) {
            revert ActiveHumanCredentialRequiresHumanProfile();
        }

        _profiles[msg.sender] =
            RaterProfile({ raterType: raterType, metadataHash: metadataHash, updatedAt: uint64(block.timestamp) });

        emit RaterProfileUpdated(msg.sender, raterType, metadataHash, uint64(block.timestamp));
    }

    /// @notice Publicly follow another profile as an on-chain curation signal.
    function followProfile(address target) external {
        if (target == address(0) || target == msg.sender) revert InvalidAddress();
        if (isFollowing[msg.sender][target]) return;

        isFollowing[msg.sender][target] = true;

        emit ProfileFollowed(msg.sender, target, uint64(block.timestamp));
    }

    /// @notice Remove a public profile follow.
    function unfollowProfile(address target) external {
        if (target == address(0) || target == msg.sender) revert InvalidAddress();
        if (!isFollowing[msg.sender][target]) return;

        isFollowing[msg.sender][target] = false;

        emit ProfileUnfollowed(msg.sender, target, uint64(block.timestamp));
    }

    /// @notice Request a delegate address to act for the caller's rater identity.
    /// @dev Delegation requires explicit acceptance and does not allow chains.
    function setDelegate(address delegate) external {
        if (delegate == address(0)) revert InvalidAddress();
        if (delegate == msg.sender) revert CannotDelegateSelf();
        if (isIdentityKeyBanned(addressIdentityKey(delegate))) revert InvalidBan();
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
        _validateDelegateActivation(holder, msg.sender);
        _activateDelegate(holder, msg.sender);
    }

    /// @notice Accept a holder-signed delegation authorization for the caller.
    /// @dev Lets smart-wallet delegates link to an existing human-credential holder in one sponsored call.
    function acceptDelegateWithSig(address holder, uint256 deadline, bytes calldata signature) external {
        if (block.timestamp > deadline) revert SignatureExpired();
        uint256 nonce = delegateAuthorizationNonces[holder];
        bytes32 digest = delegateAuthorizationDigest(holder, msg.sender, nonce, deadline);
        if (ECDSA.recover(digest, signature) != holder) revert InvalidSignature();

        delegateAuthorizationNonces[holder] = nonce + 1;
        _validateDelegateActivation(holder, msg.sender);
        _activateDelegate(holder, msg.sender);
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

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function delegateAuthorizationDigest(address holder, address delegate, uint256 nonce, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        return MessageHashUtils.toTypedDataHash(
            _domainSeparatorV4(),
            keccak256(abi.encode(DELEGATE_AUTHORIZATION_TYPEHASH, holder, delegate, nonce, deadline))
        );
    }

    /// @notice Attach a legacy World ID 3.0 Orb proof-of-human credential to the caller.
    /// @dev The proof is bound to msg.sender via RateLoop's stable address signal hash.
    function attestHumanCredentialWithProof(uint256 root, uint256 nullifierHash, uint256[8] calldata proof) external {
        if (legacyWorldIdAttestationDisabled) revert LegacyWorldIdAttestationDisabled();
        if (address(worldIdRouter) == address(0)) revert InvalidAddress();
        if (nullifierHash == 0) revert InvalidCredential();

        bytes32 storedNullifier = bytes32(nullifierHash);
        HumanCredential storage previous = _humanCredentials[msg.sender];
        if (
            previous.verified && !_isCredentialRevoked(previous) && previous.expiresAt > block.timestamp
                && previous.nullifierHash != storedNullifier
        ) {
            revert InvalidCredential();
        }

        address currentOwner = _humanNullifierOwnerByProvider[HumanCredentialProvider.WorldId][storedNullifier];
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
        emit WorldCredentialVerified(
            msg.sender,
            WORLD_CREDENTIAL_PROOF_OF_HUMAN,
            storedNullifier,
            worldIdScope,
            uint64(block.timestamp),
            uint64(expiresAt),
            evidenceHash
        );
    }

    /// @notice World ID 4.0 Proof-of-Human uniqueness attestation path.
    /// @dev The v4 proof is still bound to msg.sender via RateLoop's stable address signal hash.
    function attestHumanCredentialWithV4Proof(
        uint256 nullifier,
        uint256 nonce,
        uint64 expiresAtMin,
        uint256[5] calldata proof
    ) external {
        _attestHumanCredentialWithV4Proof(nullifier, nonce, expiresAtMin, proof);
    }

    function _attestHumanCredentialWithV4Proof(
        uint256 nullifier,
        uint256 nonce,
        uint64 expiresAtMin,
        uint256[5] calldata proof
    ) private {
        (RaterRegistryWorldIdLib.PendingHumanAttest memory pending, bool isPendingHuman) = RaterRegistryWorldIdLib.attestWorldCredentialWithV4Proof(
            msg.sender,
            WORLD_CREDENTIAL_PROOF_OF_HUMAN,
            nullifier,
            nonce,
            expiresAtMin,
            proof,
            RaterRegistryWorldIdLib.worldIdSignalHash(msg.sender),
            _worldCredentialConfigs,
            _humanCredentials[msg.sender],
            _worldCredentials[msg.sender],
            _humanNullifierOwnerByProvider,
            _worldCredentialNullifierOwner,
            _revokedWorldCredentialNullifier,
            _usedWorldCredentialProof
        );
        if (isPendingHuman) {
            _finalizePendingHumanAttest(msg.sender, WORLD_CREDENTIAL_PROOF_OF_HUMAN, pending);
        }
    }

    function attestWorldCredentialWithV4Proof(
        uint8 kind,
        uint256 nullifier,
        uint256 nonce,
        uint64 expiresAtMin,
        uint256[5] calldata proof
    ) external {
        if (kind != WORLD_CREDENTIAL_PROOF_OF_HUMAN) revert UnsupportedCredentialKind();
        _attestHumanCredentialWithV4Proof(nullifier, nonce, expiresAtMin, proof);
    }

    function attestHumanPresenceWithV4Proof(uint8, uint256, uint256, uint64, uint256[5] calldata) external pure {
        revert UnsupportedCredentialKind();
    }

    function _finalizePendingHumanAttest(
        address rater,
        uint8 kind,
        RaterRegistryWorldIdLib.PendingHumanAttest memory pending
    ) private {
        _attestHumanCredential(
            rater,
            pending.nullifierHash,
            pending.scope,
            pending.expiresAt,
            HumanCredentialProvider.WorldIdV4,
            pending.evidenceHash
        );
        emit WorldCredentialVerified(
            rater,
            kind,
            pending.nullifierHash,
            pending.scope,
            uint64(block.timestamp),
            pending.expiresAt,
            pending.evidenceHash
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

    function revokeWorldCredential(address, uint8) external view onlyRole(SEEDER_ROLE) {
        revert UnsupportedCredentialKind();
    }

    function clearRevokedHumanNullifier(HumanCredentialProvider provider, bytes32 nullifierHash)
        external
        onlyRole(SEEDER_ROLE)
    {
        if (nullifierHash == bytes32(0)) revert InvalidCredential();
        if (provider == HumanCredentialProvider.None) revert InvalidCredential();
        HumanCredentialProvider slotProvider = provider;
        _revokedHumanNullifierByProvider[slotProvider][nullifierHash] = false;
        address prevOwner = _lastRevokedOwnerByProvider[slotProvider][nullifierHash];
        emit HumanNullifierRevocationCleared(nullifierHash, provider, prevOwner);
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

    function getWorldCredential(address rater, uint8 kind) external view returns (WorldCredential memory) {
        if (kind == WORLD_CREDENTIAL_PROOF_OF_HUMAN) {
            HumanCredential memory humanCredential = _humanCredentials[rater];
            return WorldCredential({
                verified: humanCredential.verified,
                revoked: humanCredential.revoked,
                kind: kind,
                nullifierHash: humanCredential.nullifierHash,
                scope: humanCredential.scope,
                verifiedAt: humanCredential.verifiedAt,
                expiresAt: humanCredential.expiresAt,
                evidenceHash: humanCredential.evidenceHash
            });
        }
        return WorldCredential({
            verified: false,
            revoked: false,
            kind: kind,
            nullifierHash: bytes32(0),
            scope: bytes32(0),
            verifiedAt: 0,
            expiresAt: 0,
            evidenceHash: bytes32(0)
        });
    }

    function getHumanPresence(address, uint8 kind) external pure returns (HumanPresence memory presence) {
        presence.kind = kind;
    }

    function worldCredentialV4Config(uint8 kind)
        external
        view
        returns (
            address verifier,
            uint64 rpId,
            uint256 action,
            uint64 ttl,
            uint64 issuerSchemaId,
            uint256 credentialGenesisIssuedAtMin,
            bool enabled,
            bool frozen
        )
    {
        WorldIdV4Config storage config = _worldCredentialConfigs[kind];
        return (
            address(config.verifier),
            config.rpId,
            config.action,
            config.ttl,
            config.issuerSchemaId,
            config.credentialGenesisIssuedAtMin,
            config.enabled,
            config.frozen
        );
    }

    function worldPresenceV4Config(uint8)
        external
        pure
        returns (
            address verifier,
            uint64 rpId,
            uint256 action,
            uint64 ttl,
            uint64 issuerSchemaId,
            uint256 credentialGenesisIssuedAtMin,
            bool enabled,
            bool frozen
        )
    {
        return (address(0), 0, 0, 0, 0, 0, false, false);
    }

    function isIdentityKeyBanned(bytes32 identityKey) public view returns (bool) {
        if (identityKey == bytes32(0)) return false;
        bytes32[] storage sources = _identityBanSources[identityKey];
        uint256 sourceCount = sources.length;
        for (uint256 i = 0; i < sourceCount; i++) {
            if (_isBanActive(_identityBans[sources[i]])) return true;
        }
        return _isBanActive(_identityBans[identityKey]);
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

    function addressIdentityKey(address account) public pure returns (bytes32) {
        if (account == address(0)) return bytes32(0);
        return keccak256(abi.encodePacked("rateloop.address-identity-v1", account));
    }

    function worldIdSignalHash(address rater) public pure returns (uint256) {
        return hashToField(abi.encodePacked(rater));
    }

    function hashToField(bytes memory value) public pure returns (uint256) {
        return uint256(keccak256(value)) >> 8;
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
        pure
        returns (bytes32)
    {
        if (provider == HumanCredentialProvider.None || nullifierHash == bytes32(0)) return bytes32(0);
        if (provider == HumanCredentialProvider.WorldId || provider == HumanCredentialProvider.WorldIdV4) {
            return _worldIdLaunchIdentityKey(nullifierHash);
        }
        return keccak256(abi.encode(provider, nullifierHash));
    }

    function hasActiveHumanCredential(address rater) public view returns (bool) {
        HumanCredential storage credential = _humanCredentials[rater];
        return credential.verified && !_isCredentialRevoked(credential) && credential.expiresAt > block.timestamp;
    }

    function hasActiveCredentialKind(address rater, uint8 kind) public view returns (bool) {
        return kind == WORLD_CREDENTIAL_PROOF_OF_HUMAN && hasActiveHumanCredential(rater);
    }

    function hasRecentCredentialRecheck(address, uint8) public pure returns (bool) {
        return false;
    }

    function credentialStatusBits(address rater) external view returns (uint8 activeMask, uint8 freshMask) {
        if (hasActiveCredentialKind(rater, WORLD_CREDENTIAL_PROOF_OF_HUMAN)) {
            activeMask |= uint8(8);
        }
        freshMask = 0;
    }

    function _isCredentialRevoked(HumanCredential storage credential) private view returns (bool) {
        if (credential.revoked) return true;
        HumanCredentialProvider slotProvider = credential.provider;
        return _revokedHumanNullifierByProvider[slotProvider][credential.nullifierHash];
    }

    function _writeIdentityBan(bytes32 identityKey, uint64 expiresAt, bytes32 evidenceHash) private {
        if (identityKey == bytes32(0)) return;
        delete _identityBanSources[identityKey];
        _identityBans[identityKey] =
            IdentityBan({ bannedAt: uint64(block.timestamp), expiresAt: expiresAt, evidenceHash: evidenceHash });
    }

    function _writeDerivedIdentityBan(bytes32 identityKey, bytes32 sourceKey) private {
        if (identityKey == bytes32(0) || sourceKey == bytes32(0)) return;
        bytes32[] storage sources = _identityBanSources[identityKey];
        uint256 sourceCount = sources.length;
        for (uint256 i = 0; i < sourceCount; i++) {
            if (sources[i] == sourceKey) return;
        }
        sources.push(sourceKey);
    }

    function _clearDerivedIdentityBan(address holder, bytes32 sourceKey) private {
        if (holder == address(0)) return;
        bytes32 identityKey = addressIdentityKey(holder);
        bytes32[] storage sources = _identityBanSources[identityKey];
        uint256 sourceCount = sources.length;
        for (uint256 i = 0; i < sourceCount; i++) {
            if (sources[i] != sourceKey) continue;
            sources[i] = sources[sourceCount - 1];
            sources.pop();
            return;
        }
    }

    function _isBanActive(IdentityBan storage ban) private view returns (bool) {
        if (ban.bannedAt == 0) return false;
        return ban.expiresAt == type(uint64).max || ban.expiresAt > block.timestamp;
    }

    function _propagateActiveBan(address rater, HumanCredentialProvider provider, bytes32 nullifierHash) private {
        bytes32 sourceKey = credentialIdentityKey(provider, nullifierHash);
        IdentityBan storage credentialBan = _identityBans[sourceKey];
        if (!_isBanActive(credentialBan)) return;
        _writeDerivedIdentityBanForHolder(rater, sourceKey);
    }

    function _writeDerivedIdentityBanForHolder(address holder, bytes32 sourceKey) private {
        if (holder == address(0)) return;
        _writeDerivedIdentityBan(addressIdentityKey(holder), sourceKey);
    }

    function _revokeHumanNullifier(HumanCredentialProvider provider, bytes32 nullifierHash, address revokedRater)
        private
    {
        HumanCredentialProvider slotProvider = provider;
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
        HumanCredentialProvider slotProvider = provider;
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
                && (previous.nullifierHash != nullifierHash || previous.provider != slotProvider)
        ) {
            HumanCredentialProvider previousProvider = previous.provider;
            bool previousOwnerSlotCleared;
            if (
                previousProvider != HumanCredentialProvider.None
                    && _humanNullifierOwnerByProvider[previousProvider][previous.nullifierHash] == rater
            ) {
                delete _humanNullifierOwnerByProvider[previousProvider][previous.nullifierHash];
                _lastRevokedOwnerByProvider[previousProvider][previous.nullifierHash] = rater;
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

        _propagateActiveBan(rater, provider, nullifierHash);
        _clearInboundDelegation(rater);

        emit HumanCredentialVerified(
            rater, nullifierHash, scope, provider, uint64(block.timestamp), expiresAt, evidenceHash
        );

        _forceHumanCredentialCompatibleProfile(rater);
    }

    function _worldIdLaunchIdentityKey(bytes32 nullifierHash) private pure returns (bytes32) {
        return keccak256(abi.encode("rateloop.launch-world-id-human-v1", nullifierHash));
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
            if (hasActiveCredential) {
                bytes32 holderAddressKey = addressIdentityKey(holder);
                if (isIdentityKeyBanned(holderAddressKey)) {
                    identityKey = holderAddressKey;
                }
            }
        } else {
            identityKey = addressIdentityKey(holder);
        }
    }

    function _hasCredentialIdentity(address holder) internal view returns (bool) {
        HumanCredential storage credential = _humanCredentials[holder];
        return credential.verified && !_isCredentialRevoked(credential) && credential.nullifierHash != bytes32(0);
    }

    function _domainSeparatorV4() private view returns (bytes32) {
        return keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, EIP712_NAME_HASH, EIP712_VERSION_HASH, block.chainid, address(this))
        );
    }

    function _validateDelegateActivation(address holder, address delegate) private view {
        if (holder == address(0) || delegate == address(0)) revert InvalidAddress();
        if (holder == delegate) revert CannotDelegateSelf();
        if (isIdentityKeyBanned(addressIdentityKey(delegate))) revert InvalidBan();
        if (_hasCredentialIdentity(delegate)) revert DelegateIsHolder();
        if (delegateOf[delegate] != address(0)) revert DelegateAlreadyAssigned();
        if (pendingDelegateTo[delegate] != address(0)) revert DelegateAlreadyAssigned();
        if (delegateTo[delegate] != address(0)) revert DelegateAlreadyAssigned();
        if (delegateOf[holder] != address(0)) revert CallerIsDelegate();
        if (pendingDelegateOf[holder] != address(0)) revert CallerIsDelegate();

        address pendingHolder = pendingDelegateOf[delegate];
        if (pendingHolder != address(0) && pendingHolder != holder) revert DelegateAlreadyAssigned();
    }

    function _activateDelegate(address holder, address delegate) private {
        address oldDelegate = delegateTo[holder];
        if (oldDelegate != address(0)) {
            delete delegateOf[oldDelegate];
            emit DelegateRemoved(holder, oldDelegate);
        }

        _clearPendingDelegateRequest(holder);

        delegateTo[holder] = delegate;
        delegateOf[delegate] = holder;

        emit DelegateSet(holder, delegate);
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
