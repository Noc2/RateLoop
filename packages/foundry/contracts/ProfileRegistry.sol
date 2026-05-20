// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { IProfileRegistry } from "./interfaces/IProfileRegistry.sol";
import { IRaterIdentityRegistry } from "./interfaces/IRaterIdentityRegistry.sol";

/// @title ProfileRegistry
/// @notice Manages on-chain user profiles with unique names and public self-reported context
/// @dev Users can set their profile name (unique) and public self-reported audience context. No stake required.
contract ProfileRegistry is IProfileRegistry, Initializable, AccessControlUpgradeable {
    // --- Access Control Roles ---
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    /// @dev Dedicated moderation role used to release names. Separated from ADMIN_ROLE so the temporary
    ///      deploy admin cannot wipe usernames before role renouncement (L-Identity-2). Role admin is
    ///      DEFAULT_ADMIN_ROLE, which is held by governance.
    bytes32 public constant MODERATOR_ROLE = keccak256("MODERATOR_ROLE");

    // --- Constants ---
    uint256 public constant MIN_NAME_LENGTH = 3;
    uint256 public constant MAX_NAME_LENGTH = 20;
    uint256 public constant MAX_SELF_REPORT_LENGTH = 1600;

    struct StoredProfile {
        string name;
        string selfReport;
        uint256 createdAt;
        uint256 updatedAt;
    }

    // --- State ---
    mapping(address => StoredProfile) private _profiles;
    mapping(address => uint32) private _avatarAccents;
    mapping(bytes32 => address) private _nameToAddress; // lowercase name hash => owner
    address[] private _registeredAddresses;
    IRaterIdentityRegistry public raterRegistry;
    mapping(address => bytes32) private _profileIdentityKeys;
    mapping(bytes32 => address) private _profileOwnerByIdentityKey;

    /// @dev Reserved storage gap for future upgrades
    uint256[47] private __gap;

    // --- Events ---
    event ProfileCreated(address indexed user, string name, string selfReport);
    event ProfileUpdated(address indexed user, string name, string selfReport);
    event AvatarAccentUpdated(address indexed user, uint24 rgb);
    event AvatarAccentCleared(address indexed user);
    event RaterRegistryUpdated(address raterRegistry);
    event ProfileNameReleased(address indexed user, string name);
    /// @notice Emitted when a moderator releases a profile name. Includes the name hash and the releaser
    ///         address so moderation actions are auditable on-chain (L-Identity-2).
    event NameReleased(address indexed user, bytes32 nameHash, address indexed releaser);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize the profile registry contract.
    /// @param _admin Address with temporary admin role for initial wiring.
    /// @param _governance Address with permanent governance roles (timelock).
    function initialize(address _admin, address _governance) public initializer {
        __AccessControl_init();

        require(_admin != address(0), "Invalid admin");
        require(_governance != address(0), "Invalid governance");

        // Governance gets all permanent roles
        _grantRole(DEFAULT_ADMIN_ROLE, _governance);
        _grantRole(ADMIN_ROLE, _governance);
        // MODERATOR_ROLE is intentionally only granted to governance: the temporary deploy admin
        // must not be able to release names before role renouncement (L-Identity-2).
        _grantRole(MODERATOR_ROLE, _governance);

        // Admin gets only ADMIN_ROLE for initial cross-contract wiring
        if (_admin != _governance) {
            _grantRole(ADMIN_ROLE, _admin);
        }
    }

    // --- Admin Functions ---

    /// @notice Set or clear the optional rater registry used as a profile continuity signal.
    /// @param _raterRegistry The rater registry contract address, or zero to disable credential lookups.
    function setRaterRegistry(address _raterRegistry) external onlyRole(ADMIN_ROLE) {
        if (_raterRegistry != address(0)) {
            require(_raterRegistry.code.length != 0, "No code");
            try IRaterIdentityRegistry(_raterRegistry).resolveRater(address(this)) returns (
                IRaterIdentityRegistry.ResolvedRater memory
            ) { }
            catch {
                revert("Invalid registry");
            }
        }
        raterRegistry = IRaterIdentityRegistry(_raterRegistry);
        emit RaterRegistryUpdated(_raterRegistry);
    }

    /// @notice Release a profile name so it can be claimed again after the user loses eligibility.
    /// @dev Gated by MODERATOR_ROLE (granted only to governance) so the temporary deploy admin cannot
    ///      wipe usernames before role renouncement (L-Identity-2).
    /// @param user The profile owner whose name should be released.
    function releaseName(address user) external onlyRole(MODERATOR_ROLE) {
        require(user != address(0), "Invalid address");

        StoredProfile storage profile = _profiles[user];
        require(profile.createdAt != 0 && bytes(profile.name).length > 0, "No name to release");

        string memory releasedName = profile.name;
        bytes32 nameHash = _normalizeAndHash(releasedName);
        if (_nameToAddress[nameHash] == user) {
            delete _nameToAddress[nameHash];
        }

        profile.name = "";
        profile.updatedAt = block.timestamp;

        emit ProfileNameReleased(user, releasedName);
        emit NameReleased(user, nameHash, msg.sender);
        emit ProfileUpdated(user, "", profile.selfReport);
    }

    // --- Public Functions ---

    /// @inheritdoc IProfileRegistry
    function setProfile(string calldata name, string calldata selfReport) external override {
        bytes32 identityKey = _optionalDirectHumanIdentityKey(msg.sender);
        if (identityKey != bytes32(0)) {
            _migrateProfileForIdentityKey(msg.sender, identityKey);
        }

        require(bytes(name).length >= MIN_NAME_LENGTH, "Name too short");
        require(bytes(name).length <= MAX_NAME_LENGTH, "Name too long");
        require(bytes(selfReport).length <= MAX_SELF_REPORT_LENGTH, "Self-report too long");
        require(_isValidName(name), "Invalid name format");

        bytes32 nameHash = _normalizeAndHash(name);
        address existingOwner = _nameToAddress[nameHash];

        // Check uniqueness (allow if same user is updating)
        require(existingOwner == address(0) || existingOwner == msg.sender, "Name already taken");

        StoredProfile storage profile = _profiles[msg.sender];
        bool isNewProfile = profile.createdAt == 0;

        // If user had a different name before, release it
        if (!isNewProfile && bytes(profile.name).length > 0) {
            bytes32 oldNameHash = _normalizeAndHash(profile.name);
            if (oldNameHash != nameHash) {
                delete _nameToAddress[oldNameHash];
            }
        }

        // Update or create profile
        profile.name = name;
        profile.selfReport = selfReport;
        profile.updatedAt = block.timestamp;

        if (isNewProfile) {
            profile.createdAt = block.timestamp;
            _registeredAddresses.push(msg.sender);
            emit ProfileCreated(msg.sender, name, selfReport);
        } else {
            emit ProfileUpdated(msg.sender, name, selfReport);
        }

        // Register name ownership
        _nameToAddress[nameHash] = msg.sender;
        bytes32 previousIdentityKey = _profileIdentityKeys[msg.sender];
        if (previousIdentityKey != bytes32(0) && previousIdentityKey != identityKey) {
            if (_profileOwnerByIdentityKey[previousIdentityKey] == msg.sender) {
                delete _profileOwnerByIdentityKey[previousIdentityKey];
            }
        }

        _profileIdentityKeys[msg.sender] = identityKey;
        if (identityKey != bytes32(0)) {
            _profileOwnerByIdentityKey[identityKey] = msg.sender;
        }
    }

    /// @inheritdoc IProfileRegistry
    function setAvatarAccent(uint24 rgb) external override {
        _avatarAccents[msg.sender] = uint32(rgb) + 1;
        emit AvatarAccentUpdated(msg.sender, rgb);
    }

    /// @inheritdoc IProfileRegistry
    function clearAvatarAccent() external override {
        delete _avatarAccents[msg.sender];
        emit AvatarAccentCleared(msg.sender);
    }

    // --- View Functions ---

    /// @inheritdoc IProfileRegistry
    function getProfile(address user) external view override returns (Profile memory) {
        StoredProfile storage profile = _profiles[user];
        return Profile({
            name: profile.name,
            selfReport: profile.selfReport,
            createdAt: profile.createdAt,
            updatedAt: profile.updatedAt
        });
    }

    /// @inheritdoc IProfileRegistry
    function getAvatarAccent(address user) external view override returns (bool enabled, uint24 rgb) {
        uint32 packedAccent = _avatarAccents[user];
        if (packedAccent == 0) {
            return (false, 0);
        }

        return (true, uint24(packedAccent - 1));
    }

    /// @inheritdoc IProfileRegistry
    function isNameTaken(string calldata name) external view override returns (bool) {
        if (bytes(name).length < MIN_NAME_LENGTH) return false;
        bytes32 nameHash = _normalizeAndHash(name);
        return _nameToAddress[nameHash] != address(0);
    }

    /// @inheritdoc IProfileRegistry
    function hasProfile(address user) external view override returns (bool) {
        return _profiles[user].createdAt > 0;
    }

    /// @inheritdoc IProfileRegistry
    function getAddressByName(string calldata name) external view override returns (address) {
        bytes32 nameHash = _normalizeAndHash(name);
        return _nameToAddress[nameHash];
    }

    /// @notice Get registered addresses with pagination
    /// @param offset The starting index
    /// @param limit The maximum number of addresses to return
    /// @return addresses The paginated array of registered addresses
    /// @return total The total number of registered addresses
    function getRegisteredAddressesPaginated(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory addresses, uint256 total)
    {
        if (limit == 0) {
            return (new address[](0), _activeRegisteredAddressCount());
        }

        address[] memory page = new address[](limit);
        uint256 collected;
        uint256 registeredLength = _registeredAddresses.length;
        for (uint256 i = 0; i < registeredLength; i++) {
            address candidate = _registeredAddresses[i];
            if (_profiles[candidate].createdAt == 0) continue;

            if (total >= offset && collected < limit) {
                page[collected] = candidate;
                collected++;
            }
            total++;
        }

        addresses = new address[](collected);
        for (uint256 i = 0; i < collected; i++) {
            addresses[i] = page[i];
        }
    }

    function _activeRegisteredAddressCount() internal view returns (uint256 total) {
        uint256 registeredLength = _registeredAddresses.length;
        for (uint256 i = 0; i < registeredLength; i++) {
            if (_profiles[_registeredAddresses[i]].createdAt > 0) total++;
        }
    }

    // --- Internal Functions ---

    function _optionalDirectHumanIdentityKey(address user) internal view returns (bytes32 identityKey) {
        IRaterIdentityRegistry registry = raterRegistry;
        if (address(registry) == address(0)) return bytes32(0);

        IRaterIdentityRegistry.ResolvedRater memory resolved = registry.resolveRater(user);
        if (resolved.holder != user || resolved.humanNullifier == bytes32(0)) return bytes32(0);
        return resolved.identityKey;
    }

    function _migrateProfileForIdentityKey(address user, bytes32 identityKey) internal {
        address previousOwner = _profileOwnerByIdentityKey[identityKey];
        if (previousOwner == address(0) || previousOwner == user) return;

        StoredProfile storage previous = _profiles[previousOwner];
        string memory previousName = previous.name;
        bytes32 previousNameHash = bytes(previousName).length == 0 ? bytes32(0) : _normalizeAndHash(previousName);
        bool canMoveProfile = previous.createdAt != 0 && _profiles[user].createdAt == 0;

        if (canMoveProfile) {
            StoredProfile storage migrated = _profiles[user];
            migrated.name = previousName;
            migrated.selfReport = previous.selfReport;
            migrated.createdAt = previous.createdAt;
            migrated.updatedAt = previous.updatedAt;
            uint32 accent = _avatarAccents[previousOwner];
            if (accent != 0) {
                _avatarAccents[user] = accent;
                delete _avatarAccents[previousOwner];
            }
            _registeredAddresses.push(user);
            if (previousNameHash != bytes32(0)) {
                _nameToAddress[previousNameHash] = user;
            }
        } else if (previousNameHash != bytes32(0) && _nameToAddress[previousNameHash] == previousOwner) {
            delete _nameToAddress[previousNameHash];
        }

        delete _profiles[previousOwner];
        delete _profileIdentityKeys[previousOwner];
        _profileOwnerByIdentityKey[identityKey] = user;
    }

    /// @notice Validate name format (alphanumeric and underscore only)
    function _isValidName(string memory name) internal pure returns (bool) {
        bytes memory nameBytes = bytes(name);
        for (uint256 i = 0; i < nameBytes.length; i++) {
            bytes1 char = nameBytes[i];
            bool isLowercase = (char >= 0x61 && char <= 0x7A); // a-z
            bool isUppercase = (char >= 0x41 && char <= 0x5A); // A-Z
            bool isDigit = (char >= 0x30 && char <= 0x39); // 0-9
            bool isUnderscore = (char == 0x5F); // _
            if (!isLowercase && !isUppercase && !isDigit && !isUnderscore) {
                return false;
            }
        }
        return true;
    }

    /// @notice Normalize name to lowercase and hash for comparison
    function _normalizeAndHash(string memory name) internal pure returns (bytes32) {
        bytes memory nameBytes = bytes(name);
        bytes memory lowercased = new bytes(nameBytes.length);
        for (uint256 i = 0; i < nameBytes.length; i++) {
            bytes1 char = nameBytes[i];
            // Convert uppercase to lowercase
            if (char >= 0x41 && char <= 0x5A) {
                lowercased[i] = bytes1(uint8(char) + 32);
            } else {
                lowercased[i] = char;
            }
        }
        return keccak256(lowercased);
    }
}
