// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { ContentRegistry } from "./ContentRegistry.sol";
import { ProtocolConfig } from "./ProtocolConfig.sol";
import { RaterRegistry } from "./RaterRegistry.sol";
import { Eip3009Authorization, IReceiveWithAuthorizationToken } from "./interfaces/IEip3009.sol";
import { IConfidentialityEscrow } from "./interfaces/IConfidentialityEscrow.sol";
import { IRaterIdentityRegistry } from "./interfaces/IRaterIdentityRegistry.sol";
import { RoundLib } from "./libraries/RoundLib.sol";

interface IConfidentialityRoundState {
    function currentRoundId(uint256 contentId) external view returns (uint256);
    function roundCore(uint256 contentId, uint256 roundId)
        external
        view
        returns (
            uint48 startTime,
            RoundLib.RoundState state,
            uint16 voteCount,
            uint16 revealedCount,
            uint64 totalStake,
            uint48 thresholdReachedAt,
            uint48 settledAt
        );
}

/// @title ConfidentialityEscrow
/// @notice Holds per-rater confidentiality bonds for gated question context.
contract ConfidentialityEscrow is
    IConfidentialityEscrow,
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardTransient
{
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant ACCESS_RECORDER_ROLE = keccak256("ACCESS_RECORDER_ROLE");

    uint8 public constant BOND_ASSET_LREP = 0;
    uint8 public constant BOND_ASSET_USDC = 1;
    uint8 public constant CONFIDENTIALITY_FLAG_PRIVATE_FOREVER = 1;
    uint256 public constant MIN_NONZERO_BOND = 1e6;
    uint256 public constant DEFAULT_MAX_BOND = 100e6;
    uint256 public constant ABSOLUTE_MAX_BOND = 1_000e6;
    uint256 public constant REPORTER_BOUNTY_BPS = 5_000;
    uint256 public constant BPS_SCALE = 10_000;
    uint256 public constant MAX_SLASH_REASON_LENGTH = 280;
    uint256 public constant DEFAULT_EVIDENCE_WINDOW = 21 days;
    uint256 public constant MIN_EVIDENCE_WINDOW = 7 days;
    uint256 public constant MAX_EVIDENCE_WINDOW = 30 days;
    uint256 public constant DEFAULT_MAX_BOND_LOCK_DURATION = 120 days;
    uint256 public constant MIN_MAX_BOND_LOCK_DURATION = 30 days;
    uint256 public constant MAX_MAX_BOND_LOCK_DURATION = 180 days;
    uint256 public constant MAX_LOG_ROOT_EPOCH_LENGTH = 32;
    uint256 public constant MAX_LOG_ROOT_ARTIFACT_URI_LENGTH = 512;

    struct BondPosition {
        address poster;
        uint64 postedAt;
        uint64 amount;
        bool slashed;
        bool released;
    }

    struct LogRootAnchor {
        bytes32 merkleRoot;
        bytes32 artifactHash;
        bytes32 artifactUriHash;
        address publisher;
        uint64 publishedAt;
    }

    IERC20 public lrepToken;
    IERC20 public usdcToken;
    ContentRegistry public registry;
    ProtocolConfig public protocolConfig;
    address public confiscationRecipient;
    uint256 public maxBond;
    uint256 public evidenceWindow;
    uint256 public maxBondLockDuration;

    mapping(uint256 => ConfidentialityConfig) private _configs;
    mapping(uint256 => bool) public configured;
    mapping(uint256 => mapping(bytes32 => BondPosition)) public bonds;
    mapping(uint8 => mapping(bytes32 => bool)) public nullifierHasBond;
    mapping(bytes32 => LogRootAnchor) public logRootAnchors;

    uint256[39] private __gap;

    event ConfidentialityConfigured(
        uint256 indexed contentId, bool gated, uint8 indexed bondAsset, uint64 bondAmount, uint8 flags
    );
    event BondPosted(
        uint256 indexed contentId, bytes32 indexed identityKey, address indexed poster, uint8 asset, uint256 amount
    );
    event BondReleased(uint256 indexed contentId, bytes32 indexed identityKey, address indexed poster, uint256 amount);
    event BondSlashed(
        uint256 indexed contentId,
        bytes32 indexed identityKey,
        address indexed poster,
        address reporterRecipient,
        uint256 reporterAmount,
        uint256 confiscatedAmount,
        bytes32 evidenceHash,
        string reason
    );
    event ConfiscationRecipientUpdated(address indexed previousRecipient, address indexed newRecipient);
    event BondBoundsUpdated(uint256 maxBond, uint256 evidenceWindow, uint256 maxBondLockDuration);
    event ConfidentialityNexusRecorded(uint256 indexed contentId, address indexed holder, address indexed recorder);
    event ConfidentialityLogRootPublished(
        bytes32 indexed epochHash,
        bytes32 indexed merkleRoot,
        address indexed publisher,
        string epoch,
        bytes32 artifactHash,
        string artifactUri
    );

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address governance,
        address lrepToken_,
        address usdcToken_,
        address registry_,
        address protocolConfig_,
        address confiscationRecipient_
    ) external initializer {
        if (
            admin == address(0) || governance == address(0) || lrepToken_ == address(0) || usdcToken_ == address(0)
                || registry_ == address(0) || protocolConfig_ == address(0) || confiscationRecipient_ == address(0)
        ) {
            revert("Invalid address");
        }
        __AccessControl_init();
        __Pausable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, governance);
        _grantRole(CONFIG_ROLE, governance);
        _grantRole(PAUSER_ROLE, governance);
        _grantRole(GOVERNANCE_ROLE, governance);
        _grantRole(ACCESS_RECORDER_ROLE, governance);
        _grantRole(CONFIG_ROLE, registry_);
        if (admin != governance) {
            _grantRole(CONFIG_ROLE, admin);
            _grantRole(PAUSER_ROLE, admin);
            _grantRole(ACCESS_RECORDER_ROLE, admin);
        }

        lrepToken = IERC20(lrepToken_);
        usdcToken = IERC20(usdcToken_);
        registry = ContentRegistry(registry_);
        protocolConfig = ProtocolConfig(protocolConfig_);
        confiscationRecipient = confiscationRecipient_;
        maxBond = DEFAULT_MAX_BOND;
        evidenceWindow = DEFAULT_EVIDENCE_WINDOW;
        maxBondLockDuration = DEFAULT_MAX_BOND_LOCK_DURATION;
    }

    function confidentialityEscrowConfigShape() external view returns (address registry_, address protocolConfig_) {
        return (protocolConfig.raterRegistry(), address(protocolConfig));
    }

    function setPaused(bool value) external onlyRole(PAUSER_ROLE) {
        if (value) _pause();
        else _unpause();
    }

    function setConfiscationRecipient(address newRecipient) external onlyRole(CONFIG_ROLE) {
        if (newRecipient == address(0)) revert("Invalid address");
        address previous = confiscationRecipient;
        confiscationRecipient = newRecipient;
        emit ConfiscationRecipientUpdated(previous, newRecipient);
    }

    function setBondBounds(uint256 maxBond_, uint256 evidenceWindow_, uint256 maxBondLockDuration_)
        external
        onlyRole(CONFIG_ROLE)
    {
        if (maxBond_ < MIN_NONZERO_BOND || maxBond_ > ABSOLUTE_MAX_BOND) revert("Invalid max bond");
        if (evidenceWindow_ < MIN_EVIDENCE_WINDOW || evidenceWindow_ > MAX_EVIDENCE_WINDOW) {
            revert("Invalid evidence window");
        }
        if (maxBondLockDuration_ < MIN_MAX_BOND_LOCK_DURATION || maxBondLockDuration_ > MAX_MAX_BOND_LOCK_DURATION) {
            revert("Invalid lock duration");
        }
        maxBond = maxBond_;
        evidenceWindow = evidenceWindow_;
        maxBondLockDuration = maxBondLockDuration_;
        emit BondBoundsUpdated(maxBond_, evidenceWindow_, maxBondLockDuration_);
    }

    function configure(uint256 contentId, ConfidentialityConfig calldata config)
        external
        onlyRole(CONFIG_ROLE)
        whenNotPaused
    {
        if (msg.sender != address(registry)) revert("Invalid registry");
        if (configured[contentId]) revert("Already configured");
        if (contentId == 0) revert("Invalid content");
        if (config.bondAsset != BOND_ASSET_LREP && config.bondAsset != BOND_ASSET_USDC) revert("Invalid asset");
        if (config.bondAmount != 0 && (config.bondAmount < MIN_NONZERO_BOND || config.bondAmount > maxBond)) {
            revert("Invalid bond");
        }
        if (!config.gated && config.bondAmount != 0) revert("Ungated bond");
        if (config.flags > CONFIDENTIALITY_FLAG_PRIVATE_FOREVER) revert("Invalid flags");
        if (!config.gated && config.flags != 0) revert("Ungated flags");

        configured[contentId] = true;
        _configs[contentId] = config;
        emit ConfidentialityConfigured(contentId, config.gated, config.bondAsset, config.bondAmount, config.flags);
    }

    function postBond(uint256 contentId) external nonReentrant whenNotPaused returns (bytes32 identityKey) {
        (ConfidentialityConfig memory config, IRaterIdentityRegistry.ResolvedRater memory resolved) =
            _validateBondPost(contentId, msg.sender);
        _receiveExactBond(_bondToken(config.bondAsset), msg.sender, config.bondAmount);
        identityKey = _recordBond(contentId, msg.sender, config, resolved);
    }

    function postBondWithPermit(uint256 contentId, uint256 permitDeadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
        whenNotPaused
        returns (bytes32 identityKey)
    {
        ConfidentialityConfig memory config = _configs[contentId];
        if (config.bondAsset != BOND_ASSET_LREP) revert("Permit asset");
        try IERC20Permit(address(lrepToken))
            .permit(msg.sender, address(this), config.bondAmount, permitDeadline, v, r, s) { }
            catch { }
        IRaterIdentityRegistry.ResolvedRater memory resolved;
        (config, resolved) = _validateBondPost(contentId, msg.sender);
        _receiveExactBond(lrepToken, msg.sender, config.bondAmount);
        identityKey = _recordBond(contentId, msg.sender, config, resolved);
    }

    function postBondWithAuthorization(uint256 contentId, Eip3009Authorization calldata authorization)
        external
        nonReentrant
        whenNotPaused
        returns (bytes32 identityKey)
    {
        ConfidentialityConfig memory config = _configs[contentId];
        if (config.bondAsset != BOND_ASSET_USDC) revert("Authorization asset");
        if (
            authorization.from != msg.sender || authorization.to != address(this)
                || authorization.value != config.bondAmount
        ) {
            revert("Bad authorization");
        }
        IRaterIdentityRegistry.ResolvedRater memory resolved;
        (config, resolved) = _validateBondPost(contentId, msg.sender);
        uint256 balanceBefore = usdcToken.balanceOf(address(this));
        // slither-disable-next-line reentrancy-balance
        IReceiveWithAuthorizationToken(address(usdcToken))
            .receiveWithAuthorization(
                authorization.from,
                authorization.to,
                authorization.value,
                authorization.validAfter,
                authorization.validBefore,
                authorization.nonce,
                authorization.v,
                authorization.r,
                authorization.s
            );
        if (usdcToken.balanceOf(address(this)) - balanceBefore != config.bondAmount) revert("Bad token");
        identityKey = _recordBond(contentId, msg.sender, config, resolved);
    }

    function releaseBond(uint256 contentId, bytes32 identityKey)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 amount)
    {
        BondPosition storage position = bonds[contentId][identityKey];
        if (position.poster == address(0) || position.released || position.slashed) revert("No active bond");
        if (!_isBondReleasable(contentId, position.postedAt)) revert("Bond locked");
        position.released = true;
        amount = position.amount;
        IERC20 token = _bondToken(_configs[contentId].bondAsset);
        token.safeTransfer(position.poster, amount);
        emit BondReleased(contentId, identityKey, position.poster, amount);
    }

    function recordConfidentialityNexusForRegistry(uint256 contentId, address holder, address registryAddress)
        external
    {
        if (!registry.isVotingEngineAuthorizedForConfidentialityNexus(contentId, msg.sender)) {
            revert("Not voting engine");
        }
        _recordConfidentialityNexus(contentId, holder, msg.sender, registryAddress);
    }

    function recordAccessNexus(uint256 contentId, address holder)
        external
        onlyRole(ACCESS_RECORDER_ROLE)
        whenNotPaused
    {
        _recordConfidentialityNexus(contentId, holder, msg.sender, protocolConfig.raterRegistry());
    }

    function publishLogRoot(
        string calldata epoch,
        bytes32 merkleRoot,
        bytes32 artifactHash,
        string calldata artifactUri
    ) external onlyRole(ACCESS_RECORDER_ROLE) whenNotPaused {
        uint256 epochLength = bytes(epoch).length;
        if (epochLength == 0 || epochLength > MAX_LOG_ROOT_EPOCH_LENGTH) revert("Invalid epoch");
        if (artifactHash == bytes32(0)) revert("Invalid artifact");
        if (bytes(artifactUri).length > MAX_LOG_ROOT_ARTIFACT_URI_LENGTH) revert("Invalid artifact URI");
        bytes32 epochHash = keccak256(bytes(epoch));
        bytes32 artifactUriHash = keccak256(bytes(artifactUri));
        LogRootAnchor storage anchor = logRootAnchors[epochHash];
        if (anchor.artifactHash != bytes32(0)) {
            if (
                anchor.merkleRoot != merkleRoot || anchor.artifactHash != artifactHash
                    || anchor.artifactUriHash != artifactUriHash
            ) {
                revert("Log root sealed");
            }
            return;
        }
        anchor.merkleRoot = merkleRoot;
        anchor.artifactHash = artifactHash;
        anchor.artifactUriHash = artifactUriHash;
        anchor.publisher = msg.sender;
        anchor.publishedAt = block.timestamp.toUint64();
        emit ConfidentialityLogRootPublished(epochHash, merkleRoot, msg.sender, epoch, artifactHash, artifactUri);
    }

    function _recordConfidentialityNexus(uint256 contentId, address holder, address recorder, address registryAddress)
        private
    {
        if (!_configs[contentId].gated) return;
        _markNullifierBonded(holder, registryAddress);
        emit ConfidentialityNexusRecorded(contentId, holder, recorder);
    }

    function slashBond(
        uint256 contentId,
        bytes32 identityKey,
        string calldata reason,
        bytes32 evidenceHash,
        address reporterRecipient
    )
        external
        onlyRole(GOVERNANCE_ROLE)
        nonReentrant
        whenNotPaused
        returns (uint256 reporterAmount, uint256 confiscatedAmount)
    {
        if (bytes(reason).length == 0 || bytes(reason).length > MAX_SLASH_REASON_LENGTH) {
            revert("Invalid reason");
        }
        if (evidenceHash == bytes32(0)) revert("Invalid evidence");
        if (reporterRecipient == address(0) || confiscationRecipient == address(0)) revert("Invalid recipient");
        BondPosition storage position = bonds[contentId][identityKey];
        if (position.poster == address(0) || position.released || position.slashed) revert("No active bond");

        position.slashed = true;
        uint256 amount = position.amount;
        reporterAmount = (amount * REPORTER_BOUNTY_BPS) / BPS_SCALE;
        confiscatedAmount = amount - reporterAmount;
        IERC20 token = _bondToken(_configs[contentId].bondAsset);
        token.safeTransfer(reporterRecipient, reporterAmount);
        token.safeTransfer(confiscationRecipient, confiscatedAmount);
        emit BondSlashed(
            contentId,
            identityKey,
            position.poster,
            reporterRecipient,
            reporterAmount,
            confiscatedAmount,
            evidenceHash,
            reason
        );
    }

    function hasActiveBond(uint256 contentId, bytes32 identityKey) external view returns (bool) {
        BondPosition storage position = bonds[contentId][identityKey];
        return position.poster != address(0) && !position.released && !position.slashed;
    }

    function confidentialityConfig(uint256 contentId) external view returns (ConfidentialityConfig memory config) {
        return _configs[contentId];
    }

    function hasConfidentialityNexus(uint8 provider, bytes32 nullifierHash) external view returns (bool) {
        if (provider == 0 || nullifierHash == bytes32(0)) return false;
        return nullifierHasBond[provider][nullifierHash];
    }

    function _validateBondPost(uint256 contentId, address poster)
        private
        view
        returns (ConfidentialityConfig memory config, IRaterIdentityRegistry.ResolvedRater memory resolved)
    {
        config = _configs[contentId];
        if (!config.gated) revert("Not gated");
        if (config.bondAmount == 0) revert("No bond required");
        resolved = _resolveRater(poster);
        if (resolved.identityKey == bytes32(0) || !resolved.hasActiveHumanCredential) revert("Credential required");
        if (
            _isIdentityBanned(resolved.identityKey) || _isIdentityBanned(_addressIdentityKey(poster))
                || _isIdentityBanned(_addressIdentityKey(resolved.holder))
        ) {
            revert("Identity banned");
        }

        BondPosition storage position = bonds[contentId][resolved.identityKey];
        if (position.poster != address(0) && !position.released && !position.slashed) revert("Bond exists");
    }

    function _receiveExactBond(IERC20 token, address from, uint256 amount) private {
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(from, address(this), amount);
        if (token.balanceOf(address(this)) - balanceBefore != amount) revert("Bad token");
    }

    function _recordBond(
        uint256 contentId,
        address poster,
        ConfidentialityConfig memory config,
        IRaterIdentityRegistry.ResolvedRater memory resolved
    ) private returns (bytes32 identityKey) {
        BondPosition storage position = bonds[contentId][resolved.identityKey];
        position.poster = poster;
        position.postedAt = block.timestamp.toUint64();
        position.amount = config.bondAmount;
        position.slashed = false;
        position.released = false;
        _markNullifierBonded(resolved.holder, protocolConfig.raterRegistry());
        emit BondPosted(contentId, resolved.identityKey, poster, config.bondAsset, config.bondAmount);
        return resolved.identityKey;
    }

    function _resolveRater(address actor) private view returns (IRaterIdentityRegistry.ResolvedRater memory resolved) {
        address registryAddress = protocolConfig.raterRegistry();
        if (registryAddress != address(0)) {
            try IRaterIdentityRegistry(registryAddress).resolveRater(actor) returns (
                IRaterIdentityRegistry.ResolvedRater memory candidate
            ) {
                if (candidate.identityKey != bytes32(0) && candidate.holder != address(0)) return candidate;
            } catch { }
        }
        resolved = IRaterIdentityRegistry.ResolvedRater({
            holder: actor,
            identityKey: keccak256(abi.encodePacked("rateloop.address-identity-v1", actor)),
            humanNullifier: bytes32(0),
            hasActiveHumanCredential: false,
            delegated: false
        });
    }

    function _addressIdentityKey(address account) private pure returns (bytes32) {
        if (account == address(0)) return bytes32(0);
        return keccak256(abi.encodePacked("rateloop.address-identity-v1", account));
    }

    function _markNullifierBonded(address holder, address registryAddress) private {
        if (registryAddress == address(0)) {
            registryAddress = protocolConfig.raterRegistry();
        }
        if (registryAddress == address(0) || holder == address(0)) return;
        try RaterRegistry(registryAddress).getHumanCredential(holder) returns (
            RaterRegistry.HumanCredential memory credential
        ) {
            if (
                credential.provider != RaterRegistry.HumanCredentialProvider.None
                    && credential.nullifierHash != bytes32(0)
            ) {
                nullifierHasBond[uint8(credential.provider)][credential.nullifierHash] = true;
            }
        } catch { }
    }

    function _isIdentityBanned(bytes32 identityKey) private view returns (bool) {
        address registryAddress = protocolConfig.raterRegistry();
        if (registryAddress == address(0)) return false;
        try RaterRegistry(registryAddress).isIdentityKeyBanned(identityKey) returns (bool banned) {
            return banned;
        } catch {
            return false;
        }
    }

    function _isBondReleasable(uint256 contentId, uint64 postedAt) private view returns (bool) {
        uint256 earliest = uint256(postedAt) + evidenceWindow;
        if (block.timestamp < earliest) return false;
        if (block.timestamp >= uint256(postedAt) + maxBondLockDuration + evidenceWindow) return true;
        if (!_isContentActive(contentId)) return true;
        return _currentRoundTerminal(contentId);
    }

    function _isContentActive(uint256 contentId) private view returns (bool) {
        try registry.isContentActive(contentId) returns (bool active) {
            return active;
        } catch {
            return false;
        }
    }

    function _currentRoundTerminal(uint256 contentId) private view returns (bool) {
        address engine = registry.votingEngine();
        if (engine == address(0)) return false;
        try IConfidentialityRoundState(engine).currentRoundId(contentId) returns (uint256 roundId) {
            if (roundId == 0) return false;
            try IConfidentialityRoundState(engine).roundCore(contentId, roundId) returns (
                uint48, RoundLib.RoundState state, uint16 voteCount, uint16, uint64 totalStake, uint48, uint48
            ) {
                if (state == RoundLib.RoundState.Open && voteCount == 0 && totalStake == 0) return true;
                return state == RoundLib.RoundState.Settled || state == RoundLib.RoundState.Cancelled
                    || state == RoundLib.RoundState.Tied || state == RoundLib.RoundState.RevealFailed;
            } catch {
                return false;
            }
        } catch {
            return false;
        }
    }

    function _bondToken(uint8 asset) private view returns (IERC20) {
        if (asset == BOND_ASSET_LREP) return lrepToken;
        if (asset == BOND_ASSET_USDC) return usdcToken;
        revert("Invalid asset");
    }
}
