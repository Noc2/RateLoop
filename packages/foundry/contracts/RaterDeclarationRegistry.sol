// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title RaterDeclarationRegistry
/// @notice Bonded AI rater declarations, optional one-shot probes, drift flags, and community challenges.
/// @dev Declarations are not proof of model identity. They create accountable metadata and a capped
///      tier signal that cluster scoring, payout caps, and frontends can use.
contract RaterDeclarationRegistry is AccessControl, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");
    bytes32 public constant PROBE_ROLE = keccak256("PROBE_ROLE");
    bytes32 public constant CHALLENGE_RESOLVER_ROLE = keccak256("CHALLENGE_RESOLVER_ROLE");

    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant MAX_TIER_MULTIPLIER_BPS = 11_500;
    uint256 public constant MIN_DECLARATION_BOND_LREP_FLOOR = 100e6;
    uint256 public constant MIN_CHALLENGE_BOND_LREP_FLOOR = 25e6;
    uint64 public constant MIN_CHALLENGE_RESOLUTION_WINDOW = 1 days;
    uint64 public constant MAX_CHALLENGE_RESOLUTION_WINDOW = 30 days;
    uint64 public constant DEFAULT_CHALLENGE_RESOLUTION_WINDOW = 7 days;
    uint64 public constant RETIRED_DECLARATION_BOND_LOCK = 62 days;

    bytes32 public constant RATER_DECLARATION_TYPEHASH = keccak256(
        "RaterDeclaration(address rater,address operator,uint8 modelClass,bytes32 modelId,bytes32 provider,bytes32 endpointHint,bytes32 promptTemplateHash,bytes32 retrievalConfigHash,bytes32 toolingHash,uint32 version,uint64 effectiveEpoch,uint64 expiresAtEpoch,uint8 disclosure,uint96 nonce)"
    );

    enum RaterTier {
        A0,
        A1Unverified,
        A1Verified
    }

    enum ChallengeStatus {
        None,
        Open,
        Sustained,
        Rejected,
        Expired
    }

    struct RaterDeclaration {
        address rater;
        address operator;
        uint8 modelClass;
        bytes32 modelId;
        bytes32 provider;
        bytes32 endpointHint;
        bytes32 promptTemplateHash;
        bytes32 retrievalConfigHash;
        bytes32 toolingHash;
        uint32 version;
        uint64 effectiveEpoch;
        uint64 expiresAtEpoch;
        uint8 disclosure;
        uint96 nonce;
    }

    struct StoredDeclaration {
        RaterDeclaration declaration;
        RaterTier tier;
        uint64 declaredAt;
        bool probePending;
        bytes32 declarationHash;
        bytes32 lastProbeResultHash;
    }

    struct ProbeResult {
        bytes32 probeLibraryHash;
        bytes32 resultHash;
        uint16 confidenceBps;
        uint64 recordedAt;
        bool passed;
    }

    struct Challenge {
        address challenger;
        address rater;
        address operator;
        uint32 declarationVersion;
        bytes32 evidenceHash;
        bytes32 resolutionHash;
        uint256 bondAmount;
        uint64 openedAt;
        uint64 expiresAt;
        ChallengeStatus status;
    }

    IERC20 public immutable lrepToken;

    uint256 public minDeclarationBondLrep;
    uint256 public challengeBondLrep;
    uint16 public challengerRewardBps;
    uint64 public challengeResolutionWindow;
    address public treasury;
    uint256 public nextChallengeId = 1;

    mapping(address => uint96) public nonces;
    mapping(address => uint256) public operatorBond;
    mapping(address => uint256) public activeOperatorDeclarations;
    mapping(address => uint256) public operatorBondReserved;
    mapping(address => address) public declarationBondOperator;
    mapping(address => uint256) public declarationBondAmount;
    mapping(address => uint64) public retiredDeclarationBondReleaseAt;
    mapping(address => uint256) public openOperatorChallenges;
    mapping(bytes32 => uint256) public openDeclarationChallenges;
    mapping(uint256 => uint256) public challengeOperatorBondAmount;
    mapping(address => StoredDeclaration) private _declarations;
    mapping(address => ProbeResult) private _latestProbeResults;
    mapping(uint256 => Challenge) private _challenges;

    event DeclarationParametersUpdated(
        uint256 minDeclarationBondLrep, uint256 challengeBondLrep, uint16 challengerRewardBps, address treasury
    );
    event ChallengeResolutionWindowUpdated(uint64 challengeResolutionWindow);
    event OperatorBondDeposited(address indexed operator, address indexed payer, uint256 amount, uint256 totalBond);
    event OperatorBondWithdrawn(address indexed operator, uint256 amount, uint256 remainingBond);
    event DeclarationBondReleased(address indexed rater, address indexed operator);
    event DeclarationSubmitted(
        address indexed rater,
        address indexed operator,
        uint32 indexed version,
        uint64 effectiveEpoch,
        uint64 expiresAtEpoch,
        RaterTier tier,
        bool behaviorChanged,
        bool probePending,
        bytes32 declarationHash,
        uint8 modelClass,
        bytes32 modelId,
        bytes32 provider,
        bytes32 promptTemplateHash,
        bytes32 retrievalConfigHash,
        bytes32 toolingHash,
        uint8 disclosure
    );
    event DeclarationRetired(address indexed rater, address indexed operator, uint32 indexed version);
    event DeclarationExpired(address indexed rater, address indexed operator, uint32 indexed version);
    event ProbeRequested(
        address indexed rater, address indexed operator, uint32 indexed version, bytes32 declarationHash
    );
    event ProbeResultRecorded(
        address indexed rater,
        address indexed operator,
        uint32 indexed version,
        bool passed,
        uint16 confidenceBps,
        bytes32 probeLibraryHash,
        bytes32 resultHash
    );
    event BehavioralDriftFlagged(
        address indexed rater,
        address indexed operator,
        uint32 indexed version,
        uint16 driftScoreBps,
        bytes32 evidenceHash
    );
    event ChallengeOpened(
        uint256 indexed challengeId,
        address indexed challenger,
        address indexed rater,
        address operator,
        uint32 declarationVersion,
        uint256 bondAmount,
        bytes32 evidenceHash
    );
    event ChallengeResolved(
        uint256 indexed challengeId,
        ChallengeStatus status,
        uint256 operatorSlash,
        uint256 challengerReward,
        bytes32 resolutionHash
    );

    error InvalidAddress();
    error InvalidConfig();
    error InvalidDeclaration();
    error InvalidSignature();
    error InsufficientBond();
    error InvalidProbeResult();
    error InvalidChallenge();
    error ActiveDeclarations();
    error OpenChallenges();
    error BondReleasePending();
    error ChallengeResolutionPending();
    error ChallengeResolutionExpired();

    constructor(
        address admin,
        address governance,
        IERC20 lrepToken_,
        address treasury_,
        uint256 minDeclarationBondLrep_,
        uint256 challengeBondLrep_
    ) EIP712("RateLoop Rater Declaration", "1") {
        if (admin == address(0) || governance == address(0) || address(lrepToken_) == address(0)) {
            revert InvalidAddress();
        }
        if (treasury_ == address(0)) revert InvalidAddress();
        if (
            minDeclarationBondLrep_ < MIN_DECLARATION_BOND_LREP_FLOOR
                || challengeBondLrep_ < MIN_CHALLENGE_BOND_LREP_FLOOR
        ) {
            revert InvalidConfig();
        }

        lrepToken = lrepToken_;
        minDeclarationBondLrep = minDeclarationBondLrep_;
        challengeBondLrep = challengeBondLrep_;
        challengerRewardBps = 5_000;
        challengeResolutionWindow = DEFAULT_CHALLENGE_RESOLUTION_WINDOW;
        treasury = treasury_;

        _grantRole(DEFAULT_ADMIN_ROLE, governance);
        _grantRole(CONFIG_ROLE, governance);
        _grantRole(PROBE_ROLE, governance);
        _grantRole(CHALLENGE_RESOLVER_ROLE, governance);

        if (admin != governance) {
            _grantRole(CONFIG_ROLE, admin);
            _grantRole(PROBE_ROLE, admin);
            _grantRole(CHALLENGE_RESOLVER_ROLE, admin);
        }

        emit DeclarationParametersUpdated(minDeclarationBondLrep, challengeBondLrep, challengerRewardBps, treasury);
    }

    function setDeclarationParameters(
        uint256 minDeclarationBondLrep_,
        uint256 challengeBondLrep_,
        uint16 challengerRewardBps_,
        address treasury_
    ) external onlyRole(CONFIG_ROLE) {
        if (challengerRewardBps_ > BPS_DENOMINATOR) revert InvalidConfig();
        if (
            minDeclarationBondLrep_ < MIN_DECLARATION_BOND_LREP_FLOOR
                || challengeBondLrep_ < MIN_CHALLENGE_BOND_LREP_FLOOR
        ) {
            revert InvalidConfig();
        }
        if (treasury_ == address(0)) revert InvalidAddress();

        minDeclarationBondLrep = minDeclarationBondLrep_;
        challengeBondLrep = challengeBondLrep_;
        challengerRewardBps = challengerRewardBps_;
        treasury = treasury_;

        emit DeclarationParametersUpdated(minDeclarationBondLrep_, challengeBondLrep_, challengerRewardBps_, treasury_);
    }

    function setChallengeResolutionWindow(uint64 challengeResolutionWindow_) external onlyRole(CONFIG_ROLE) {
        if (
            challengeResolutionWindow_ < MIN_CHALLENGE_RESOLUTION_WINDOW
                || challengeResolutionWindow_ > MAX_CHALLENGE_RESOLUTION_WINDOW
        ) {
            revert InvalidConfig();
        }

        challengeResolutionWindow = challengeResolutionWindow_;
        emit ChallengeResolutionWindowUpdated(challengeResolutionWindow_);
    }

    function submitDeclaration(
        RaterDeclaration calldata declaration,
        bytes calldata operatorSignature,
        uint256 bondAmount,
        bool requestProbe
    ) external returns (bytes32 declarationHash) {
        if (declaration.rater != msg.sender || declaration.operator == address(0)) {
            revert InvalidDeclaration();
        }
        if (declaration.nonce != nonces[declaration.rater]) revert InvalidDeclaration();
        if (declaration.expiresAtEpoch != 0 && declaration.expiresAtEpoch <= declaration.effectiveEpoch) {
            revert InvalidDeclaration();
        }

        StoredDeclaration storage previous = _declarations[declaration.rater];
        uint32 previousVersion = previous.declaration.version;
        if (declaration.version != previousVersion + 1) revert InvalidDeclaration();

        declarationHash = hashDeclaration(declaration);
        bytes32 digest = _hashTypedDataV4(declarationHash);
        if (ECDSA.recover(digest, operatorSignature) != declaration.operator) revert InvalidSignature();

        if (bondAmount > 0) {
            lrepToken.safeTransferFrom(msg.sender, address(this), bondAmount);
            operatorBond[declaration.operator] += bondAmount;
            emit OperatorBondDeposited(declaration.operator, msg.sender, bondAmount, operatorBond[declaration.operator]);
        }
        if (operatorBond[declaration.operator] < minDeclarationBondLrep) revert InsufficientBond();

        address previousBondOperator = declarationBondOperator[declaration.rater];
        if (
            previousBondOperator != address(0)
                && openDeclarationChallenges[_declarationKey(declaration.rater, previous.declaration.version)] != 0
        ) {
            revert OpenChallenges();
        }

        bool behaviorChanged = _behaviorChanged(previous.declaration, declaration);
        uint256 requiredBondAmount = minDeclarationBondLrep;
        if (previousBondOperator == address(0)) {
            _reserveDeclarationBond(declaration.operator, requiredBondAmount);
            activeOperatorDeclarations[declaration.operator] += 1;
            declarationBondOperator[declaration.rater] = declaration.operator;
            declarationBondAmount[declaration.rater] = requiredBondAmount;
        } else if (previousBondOperator != declaration.operator) {
            _unreserveDeclarationBond(previousBondOperator, declarationBondAmount[declaration.rater]);
            _reserveDeclarationBond(declaration.operator, requiredBondAmount);
            activeOperatorDeclarations[previousBondOperator] -= 1;
            activeOperatorDeclarations[declaration.operator] += 1;
            declarationBondOperator[declaration.rater] = declaration.operator;
            declarationBondAmount[declaration.rater] = requiredBondAmount;
        } else {
            _resizeDeclarationBond(declaration.operator, declarationBondAmount[declaration.rater], requiredBondAmount);
            declarationBondAmount[declaration.rater] = requiredBondAmount;
        }
        retiredDeclarationBondReleaseAt[declaration.rater] = 0;

        nonces[declaration.rater] = declaration.nonce + 1;
        _declarations[declaration.rater] = StoredDeclaration({
            declaration: declaration,
            tier: RaterTier.A1Unverified,
            declaredAt: uint64(block.timestamp),
            probePending: requestProbe && behaviorChanged,
            declarationHash: declarationHash,
            lastProbeResultHash: bytes32(0)
        });

        emit DeclarationSubmitted(
            declaration.rater,
            declaration.operator,
            declaration.version,
            declaration.effectiveEpoch,
            declaration.expiresAtEpoch,
            RaterTier.A1Unverified,
            behaviorChanged,
            requestProbe && behaviorChanged,
            declarationHash,
            declaration.modelClass,
            declaration.modelId,
            declaration.provider,
            declaration.promptTemplateHash,
            declaration.retrievalConfigHash,
            declaration.toolingHash,
            declaration.disclosure
        );

        if (requestProbe && behaviorChanged) {
            emit ProbeRequested(declaration.rater, declaration.operator, declaration.version, declarationHash);
        }
    }

    function retireDeclaration() external {
        StoredDeclaration storage stored = _declarations[msg.sender];
        if (stored.tier == RaterTier.A0 || stored.declaration.rater != msg.sender) revert InvalidDeclaration();
        bytes32 declarationKey = _declarationKey(msg.sender, stored.declaration.version);
        if (openDeclarationChallenges[declarationKey] != 0) revert OpenChallenges();

        address operator = stored.declaration.operator;
        uint32 version = stored.declaration.version;
        stored.tier = RaterTier.A0;
        stored.probePending = false;
        retiredDeclarationBondReleaseAt[msg.sender] = uint64(block.timestamp) + RETIRED_DECLARATION_BOND_LOCK;

        emit DeclarationRetired(msg.sender, operator, version);
    }

    function releaseRetiredDeclarationBond(address rater) external {
        StoredDeclaration storage stored = _declarations[rater];
        address operator = declarationBondOperator[rater];
        uint64 releaseAt = retiredDeclarationBondReleaseAt[rater];
        if (operator == address(0) || stored.tier != RaterTier.A0 || releaseAt == 0) revert InvalidDeclaration();
        if (block.timestamp < releaseAt) revert BondReleasePending();

        _releaseDeclarationBondLock(rater, operator);
    }

    function releaseExpiredDeclarationBond(address rater) external {
        StoredDeclaration storage stored = _declarations[rater];
        RaterDeclaration memory declaration = stored.declaration;
        if (stored.tier == RaterTier.A0 || declaration.rater != rater || declaration.expiresAtEpoch == 0) {
            revert InvalidDeclaration();
        }
        bytes32 declarationKey = _declarationKey(rater, declaration.version);
        if (openDeclarationChallenges[declarationKey] != 0) revert OpenChallenges();

        uint256 releaseAt = uint256(declaration.expiresAtEpoch) + RETIRED_DECLARATION_BOND_LOCK;
        if (block.timestamp < releaseAt) revert BondReleasePending();

        stored.tier = RaterTier.A0;
        stored.probePending = false;
        emit DeclarationExpired(rater, declaration.operator, declaration.version);
        _releaseDeclarationBondLock(rater, declaration.operator);
    }

    function withdrawRetiredOperatorBond(uint256 amount) external {
        if (activeOperatorDeclarations[msg.sender] != 0) revert ActiveDeclarations();
        if (openOperatorChallenges[msg.sender] != 0) revert OpenChallenges();
        if (amount == 0 || amount > operatorBond[msg.sender]) revert InsufficientBond();

        operatorBond[msg.sender] -= amount;
        lrepToken.safeTransfer(msg.sender, amount);

        emit OperatorBondWithdrawn(msg.sender, amount, operatorBond[msg.sender]);
    }

    function recordProbeResult(
        address rater,
        uint32 version,
        bytes32 probeLibraryHash,
        uint16 confidenceBps,
        bool passed,
        bytes32 resultHash
    ) external onlyRole(PROBE_ROLE) {
        if (confidenceBps > BPS_DENOMINATOR || resultHash == bytes32(0)) {
            revert InvalidProbeResult();
        }
        StoredDeclaration storage stored = _declarations[rater];
        if (stored.tier == RaterTier.A0 || stored.declaration.version != version) revert InvalidProbeResult();

        stored.tier = passed ? RaterTier.A1Verified : RaterTier.A1Unverified;
        stored.probePending = false;
        stored.lastProbeResultHash = resultHash;
        _latestProbeResults[rater] = ProbeResult({
            probeLibraryHash: probeLibraryHash,
            resultHash: resultHash,
            confidenceBps: confidenceBps,
            recordedAt: uint64(block.timestamp),
            passed: passed
        });

        emit ProbeResultRecorded(
            rater, stored.declaration.operator, version, passed, confidenceBps, probeLibraryHash, resultHash
        );
    }

    function flagBehavioralDrift(address rater, uint32 version, uint16 driftScoreBps, bytes32 evidenceHash)
        external
        onlyRole(PROBE_ROLE)
    {
        if (driftScoreBps > BPS_DENOMINATOR || evidenceHash == bytes32(0)) revert InvalidProbeResult();
        StoredDeclaration storage stored = _declarations[rater];
        if (stored.tier == RaterTier.A0 || stored.declaration.version != version) revert InvalidProbeResult();

        if (stored.tier == RaterTier.A1Verified) {
            stored.tier = RaterTier.A1Unverified;
        }

        emit BehavioralDriftFlagged(rater, stored.declaration.operator, version, driftScoreBps, evidenceHash);
    }

    function openChallenge(address rater, bytes32 evidenceHash) external returns (uint256 challengeId) {
        if (evidenceHash == bytes32(0)) revert InvalidChallenge();
        StoredDeclaration storage stored = _declarations[rater];
        if (stored.tier == RaterTier.A0) revert InvalidChallenge();
        if (!_declarationIsActive(stored.declaration)) revert InvalidChallenge();
        bytes32 declarationKey = _declarationKey(rater, stored.declaration.version);
        if (openDeclarationChallenges[declarationKey] != 0) revert OpenChallenges();

        lrepToken.safeTransferFrom(msg.sender, address(this), challengeBondLrep);
        openOperatorChallenges[stored.declaration.operator] += 1;
        openDeclarationChallenges[declarationKey] += 1;

        challengeId = nextChallengeId++;
        uint64 expiresAt = uint64(block.timestamp) + challengeResolutionWindow;
        challengeOperatorBondAmount[challengeId] = declarationBondAmount[rater];
        _challenges[challengeId] = Challenge({
            challenger: msg.sender,
            rater: rater,
            operator: stored.declaration.operator,
            declarationVersion: stored.declaration.version,
            evidenceHash: evidenceHash,
            resolutionHash: bytes32(0),
            bondAmount: challengeBondLrep,
            openedAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            status: ChallengeStatus.Open
        });

        emit ChallengeOpened(
            challengeId,
            msg.sender,
            rater,
            stored.declaration.operator,
            stored.declaration.version,
            challengeBondLrep,
            evidenceHash
        );
    }

    function resolveChallenge(uint256 challengeId, bool sustained, uint16 slashBps, bytes32 resolutionHash)
        external
        onlyRole(CHALLENGE_RESOLVER_ROLE)
    {
        if (slashBps > BPS_DENOMINATOR || resolutionHash == bytes32(0)) revert InvalidChallenge();
        Challenge storage challenge = _challenges[challengeId];
        if (challenge.status != ChallengeStatus.Open) revert InvalidChallenge();
        if (block.timestamp >= challenge.expiresAt) revert ChallengeResolutionExpired();

        uint256 operatorSlash;
        uint256 challengerReward;
        challenge.resolutionHash = resolutionHash;

        if (sustained) {
            challenge.status = ChallengeStatus.Sustained;
            operatorSlash = (challengeOperatorBondAmount[challengeId] * slashBps) / BPS_DENOMINATOR;
            if (operatorSlash > operatorBond[challenge.operator]) {
                operatorSlash = operatorBond[challenge.operator];
            }
            operatorBond[challenge.operator] -= operatorSlash;
            challengerReward = (operatorSlash * challengerRewardBps) / BPS_DENOMINATOR;

            StoredDeclaration storage stored = _declarations[challenge.rater];
            if (stored.declaration.version == challenge.declarationVersion && stored.tier != RaterTier.A0) {
                stored.tier = RaterTier.A0;
                stored.probePending = false;
                _releaseDeclarationBondLock(challenge.rater, challenge.operator);
            }

            lrepToken.safeTransfer(challenge.challenger, challenge.bondAmount + challengerReward);
            if (operatorSlash > challengerReward) {
                lrepToken.safeTransfer(treasury, operatorSlash - challengerReward);
            }
        } else {
            challenge.status = ChallengeStatus.Rejected;
            lrepToken.safeTransfer(treasury, challenge.bondAmount);
        }
        _closeChallengeLock(challenge.operator, challenge.rater, challenge.declarationVersion);

        emit ChallengeResolved(challengeId, challenge.status, operatorSlash, challengerReward, resolutionHash);
    }

    function expireChallenge(uint256 challengeId) external {
        Challenge storage challenge = _challenges[challengeId];
        if (challenge.status != ChallengeStatus.Open) revert InvalidChallenge();
        if (block.timestamp < challenge.expiresAt) revert ChallengeResolutionPending();

        challenge.status = ChallengeStatus.Expired;
        challenge.resolutionHash = keccak256("challenge-expired");
        lrepToken.safeTransfer(treasury, challenge.bondAmount);
        _closeChallengeLock(challenge.operator, challenge.rater, challenge.declarationVersion);

        emit ChallengeResolved(challengeId, challenge.status, 0, 0, challenge.resolutionHash);
    }

    function getDeclaration(address rater) external view returns (StoredDeclaration memory) {
        return _declarations[rater];
    }

    function getLatestProbeResult(address rater) external view returns (ProbeResult memory) {
        return _latestProbeResults[rater];
    }

    function getChallenge(uint256 challengeId) external view returns (Challenge memory) {
        return _challenges[challengeId];
    }

    function hashTypedDeclaration(RaterDeclaration calldata declaration) external view returns (bytes32) {
        return _hashTypedDataV4(hashDeclaration(declaration));
    }

    function hashDeclaration(RaterDeclaration calldata declaration) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                RATER_DECLARATION_TYPEHASH,
                declaration.rater,
                declaration.operator,
                declaration.modelClass,
                declaration.modelId,
                declaration.provider,
                declaration.endpointHint,
                declaration.promptTemplateHash,
                declaration.retrievalConfigHash,
                declaration.toolingHash,
                declaration.version,
                declaration.effectiveEpoch,
                declaration.expiresAtEpoch,
                declaration.disclosure,
                declaration.nonce
            )
        );
    }

    function tierMultiplierBps(address rater) external view returns (uint16) {
        StoredDeclaration storage stored = _declarations[rater];
        RaterTier tier = stored.tier;
        if (!_declarationIsActive(stored.declaration)) return BPS_DENOMINATOR;
        if (openDeclarationChallenges[_declarationKey(rater, stored.declaration.version)] != 0) {
            return BPS_DENOMINATOR;
        }
        if (tier == RaterTier.A1Verified) {
            return MAX_TIER_MULTIPLIER_BPS;
        }
        if (tier == RaterTier.A1Unverified) {
            return 10_500;
        }
        return BPS_DENOMINATOR;
    }

    function hasActiveAiDeclaration(address rater) external view returns (bool) {
        StoredDeclaration storage stored = _declarations[rater];
        return stored.tier != RaterTier.A0 && _declarationIsActive(stored.declaration);
    }

    function clusterKey(address rater) external view returns (bytes32) {
        StoredDeclaration storage stored = _declarations[rater];
        if (stored.tier == RaterTier.A0 || !_declarationIsActive(stored.declaration)) {
            return bytes32(0);
        }
        if (openDeclarationChallenges[_declarationKey(rater, stored.declaration.version)] != 0) {
            return bytes32(0);
        }
        return keccak256(abi.encodePacked("rateloop:operator-cluster", stored.declaration.operator));
    }

    function _behaviorChanged(RaterDeclaration memory previous, RaterDeclaration calldata next)
        internal
        pure
        returns (bool)
    {
        if (previous.rater == address(0)) return true;
        return previous.modelClass != next.modelClass || previous.modelId != next.modelId
            || previous.provider != next.provider || previous.promptTemplateHash != next.promptTemplateHash
            || previous.retrievalConfigHash != next.retrievalConfigHash || previous.toolingHash != next.toolingHash;
    }

    function _declarationIsActive(RaterDeclaration memory declaration) internal view returns (bool) {
        if (declaration.rater == address(0)) return false;
        if (declaration.effectiveEpoch > block.timestamp) return false;
        return declaration.expiresAtEpoch == 0 || block.timestamp < declaration.expiresAtEpoch;
    }

    function _releaseDeclarationBondLock(address rater, address operator) internal {
        if (declarationBondOperator[rater] != operator) return;
        _unreserveDeclarationBond(operator, declarationBondAmount[rater]);
        activeOperatorDeclarations[operator] -= 1;
        delete declarationBondOperator[rater];
        delete declarationBondAmount[rater];
        delete retiredDeclarationBondReleaseAt[rater];
        emit DeclarationBondReleased(rater, operator);
    }

    function _reserveDeclarationBond(address operator, uint256 amount) internal {
        uint256 nextReserved = operatorBondReserved[operator] + amount;
        if (operatorBond[operator] < nextReserved) revert InsufficientBond();
        operatorBondReserved[operator] = nextReserved;
    }

    function _unreserveDeclarationBond(address operator, uint256 amount) internal {
        operatorBondReserved[operator] -= amount;
    }

    function _resizeDeclarationBond(address operator, uint256 previousAmount, uint256 nextAmount) internal {
        if (nextAmount == previousAmount) return;
        if (nextAmount > previousAmount) {
            _reserveDeclarationBond(operator, nextAmount - previousAmount);
        } else {
            _unreserveDeclarationBond(operator, previousAmount - nextAmount);
        }
    }

    function _closeChallengeLock(address operator, address rater, uint32 version) internal {
        openOperatorChallenges[operator] -= 1;
        bytes32 declarationKey = _declarationKey(rater, version);
        openDeclarationChallenges[declarationKey] -= 1;
    }

    function _declarationKey(address rater, uint32 version) internal pure returns (bytes32) {
        return keccak256(abi.encode(rater, version));
    }
}
