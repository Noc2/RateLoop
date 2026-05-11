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
        Rejected
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
        ChallengeStatus status;
    }

    IERC20 public immutable lrepToken;

    uint256 public minDeclarationBondLrep;
    uint256 public challengeBondLrep;
    uint16 public challengerRewardBps;
    address public treasury;
    uint256 public nextChallengeId = 1;

    mapping(address => uint96) public nonces;
    mapping(address => uint256) public operatorBond;
    mapping(address => uint256) public activeOperatorDeclarations;
    mapping(address => StoredDeclaration) private _declarations;
    mapping(address => ProbeResult) private _latestProbeResults;
    mapping(uint256 => Challenge) private _challenges;

    event DeclarationParametersUpdated(
        uint256 minDeclarationBondLrep, uint256 challengeBondLrep, uint16 challengerRewardBps, address treasury
    );
    event OperatorBondDeposited(address indexed operator, address indexed payer, uint256 amount, uint256 totalBond);
    event OperatorBondWithdrawn(address indexed operator, uint256 amount, uint256 remainingBond);
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

        bool behaviorChanged = _behaviorChanged(previous.declaration, declaration);
        bool wasActive = previous.tier != RaterTier.A0;
        if (!wasActive) {
            activeOperatorDeclarations[declaration.operator] += 1;
        } else if (previous.declaration.operator != declaration.operator) {
            activeOperatorDeclarations[previous.declaration.operator] -= 1;
            activeOperatorDeclarations[declaration.operator] += 1;
        }

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

        address operator = stored.declaration.operator;
        uint32 version = stored.declaration.version;
        stored.tier = RaterTier.A0;
        stored.probePending = false;
        activeOperatorDeclarations[operator] -= 1;

        emit DeclarationRetired(msg.sender, operator, version);
    }

    function withdrawRetiredOperatorBond(uint256 amount) external {
        if (activeOperatorDeclarations[msg.sender] != 0) revert ActiveDeclarations();
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

        lrepToken.safeTransferFrom(msg.sender, address(this), challengeBondLrep);

        challengeId = nextChallengeId++;
        _challenges[challengeId] = Challenge({
            challenger: msg.sender,
            rater: rater,
            operator: stored.declaration.operator,
            declarationVersion: stored.declaration.version,
            evidenceHash: evidenceHash,
            resolutionHash: bytes32(0),
            bondAmount: challengeBondLrep,
            openedAt: uint64(block.timestamp),
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

        uint256 operatorSlash;
        uint256 challengerReward;
        challenge.resolutionHash = resolutionHash;

        if (sustained) {
            challenge.status = ChallengeStatus.Sustained;
            operatorSlash = (operatorBond[challenge.operator] * slashBps) / BPS_DENOMINATOR;
            operatorBond[challenge.operator] -= operatorSlash;
            challengerReward = (operatorSlash * challengerRewardBps) / BPS_DENOMINATOR;

            StoredDeclaration storage stored = _declarations[challenge.rater];
            if (stored.declaration.version == challenge.declarationVersion && stored.tier != RaterTier.A0) {
                stored.tier = RaterTier.A0;
                stored.probePending = false;
                activeOperatorDeclarations[challenge.operator] -= 1;
            }

            lrepToken.safeTransfer(challenge.challenger, challenge.bondAmount + challengerReward);
            if (operatorSlash > challengerReward) {
                lrepToken.safeTransfer(treasury, operatorSlash - challengerReward);
            }
        } else {
            challenge.status = ChallengeStatus.Rejected;
            lrepToken.safeTransfer(treasury, challenge.bondAmount);
        }

        emit ChallengeResolved(challengeId, challenge.status, operatorSlash, challengerReward, resolutionHash);
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
        if (tier == RaterTier.A1Verified) {
            return MAX_TIER_MULTIPLIER_BPS;
        }
        if (tier == RaterTier.A1Unverified) {
            return 10_500;
        }
        return BPS_DENOMINATOR;
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
}
