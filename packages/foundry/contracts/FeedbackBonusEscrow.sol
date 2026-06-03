// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { ContentRegistry } from "./ContentRegistry.sol";
import { RoundVotingEngine } from "./RoundVotingEngine.sol";
import { ProtocolConfig } from "./ProtocolConfig.sol";
import { Eip3009Authorization, IReceiveWithAuthorizationToken } from "./interfaces/IEip3009.sol";
import { IFrontendRegistry } from "./interfaces/IFrontendRegistry.sol";
import { IFeedbackRegistry } from "./interfaces/IFeedbackRegistry.sol";
import { IRaterIdentityRegistry } from "./interfaces/IRaterIdentityRegistry.sol";
import { RoundLib } from "./libraries/RoundLib.sol";
import { TokenTransferLib } from "./libraries/TokenTransferLib.sol";

/// @title FeedbackBonusEscrow
/// @notice Holds optional LREP or USDC bonuses for useful rater feedback and pays awarded feedback hashes after a round ends.
contract FeedbackBonusEscrow is Initializable, AccessControlUpgradeable, PausableUpgradeable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 public constant BPS_SCALE = 10_000;
    uint256 public constant DEFAULT_FRONTEND_FEE_BPS = 300;
    uint256 public constant MAX_FRONTEND_FEE_BPS = 500;
    uint256 public constant MIN_FEEDBACK_AWARD_DECISION_SECONDS = 1 days;
    uint8 public constant REWARD_ASSET_LREP = 0;
    uint8 public constant REWARD_ASSET_USDC = 1;
    bytes32 internal constant FEEDBACK_BONUS_AUTHORIZATION_TYPEHASH = keccak256(
        "RateLoopFeedbackBonusAuthorization(uint256 chainId,address escrow,uint256 contentId,uint256 roundId,uint256 amount,uint256 feedbackClosesAt,address awarder,address funder,uint256 validAfter,uint256 validBefore)"
    );

    struct FeedbackBonusPool {
        uint64 id;
        uint64 contentId;
        uint64 roundId;
        uint48 feedbackClosesAt;
        address funder;
        address funderIdentity;
        bytes32 funderIdentityKey;
        address awarder;
        address submitterIdentity;
        bytes32 submitterIdentityKey;
        address raterRegistrySnapshot;
        uint256 fundedAmount;
        uint256 remainingAmount;
        bool forfeited;
        uint16 frontendFeeBps;
        uint8 asset;
    }

    struct AuthorizedFeedbackBonusParams {
        uint256 contentId;
        uint256 roundId;
        uint256 amount;
        uint256 feedbackClosesAt;
        address awarder;
    }

    IERC20 public usdcToken;
    ContentRegistry public registry;
    RoundVotingEngine public votingEngine;
    IRaterIdentityRegistry public raterRegistry;
    IFeedbackRegistry public feedbackRegistry;
    IERC20 public lrepToken;
    uint256 public nextFeedbackBonusPoolId;
    uint16 public defaultFrontendFeeBps;

    mapping(uint256 => FeedbackBonusPool) public feedbackBonusPools;
    mapping(uint256 => mapping(bytes32 => bool)) public identityKeyAwarded;
    mapping(uint256 => mapping(bytes32 => bool)) public feedbackHashAwarded;

    /// @dev Reserved storage gap for future upgrades. Mirrors the pattern used by every other
    ///      upgradeable contract in this protocol so new state can be added without colliding
    ///      with inherited OpenZeppelin storage.
    uint256[49] private __gap;

    event FeedbackBonusPoolCreated(
        uint256 indexed poolId,
        uint256 indexed contentId,
        uint256 indexed roundId,
        address funder,
        address awarder,
        uint256 amount,
        uint256 feedbackClosesAt,
        uint256 frontendFeeBps,
        uint8 asset
    );
    event FeedbackWindowCreated(
        uint256 indexed poolId, uint256 indexed contentId, uint256 indexed roundId, uint256 feedbackClosesAt
    );
    event FeedbackBonusAwarded(
        uint256 indexed poolId,
        uint256 indexed contentId,
        uint256 indexed roundId,
        address recipient,
        bytes32 identityKey,
        bytes32 feedbackHash,
        uint256 grossAmount,
        uint256 recipientAmount,
        address frontend,
        address frontendRecipient,
        uint256 frontendFee
    );
    event FeedbackBonusForfeited(uint256 indexed poolId, address indexed treasury, uint256 amount);
    event FeedbackBonusFunderRefunded(uint256 indexed poolId, address indexed funder, uint256 amount);
    event DefaultFrontendFeeBpsUpdated(uint256 previousFrontendFeeBps, uint256 newFrontendFeeBps);
    event FeedbackRegistryUpdated(address feedbackRegistry);
    event RaterRegistryUpdated(address raterRegistry);
    event VotingEngineUpdated(address votingEngine);
    event NonAssetTokenRecovered(address indexed token, address indexed to, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address lrepToken_,
        address usdcToken_,
        address registry_,
        address votingEngine_,
        address raterRegistry_,
        address feedbackRegistry_
    ) external initializer {
        require(admin != address(0), "Invalid admin");
        require(lrepToken_ != address(0), "Invalid LREP token");
        require(usdcToken_ != address(0), "Invalid token");
        require(registry_ != address(0), "Invalid registry");
        require(votingEngine_ != address(0), "Invalid engine");

        __AccessControl_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CONFIG_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);

        lrepToken = IERC20(lrepToken_);
        usdcToken = IERC20(usdcToken_);
        registry = ContentRegistry(registry_);
        votingEngine = RoundVotingEngine(votingEngine_);
        _validateRaterRegistry(raterRegistry_);
        raterRegistry = IRaterIdentityRegistry(raterRegistry_);
        _setFeedbackRegistry(feedbackRegistry_);
        nextFeedbackBonusPoolId = 1;
        defaultFrontendFeeBps = DEFAULT_FRONTEND_FEE_BPS.toUint16();
    }

    function createFeedbackBonusPool(
        uint256 contentId,
        uint256 roundId,
        uint256 amount,
        uint256 feedbackClosesAt,
        address awarder
    ) external nonReentrant whenNotPaused returns (uint256 poolId) {
        return _createFeedbackBonusPool(contentId, roundId, REWARD_ASSET_USDC, amount, feedbackClosesAt, awarder);
    }

    function createFeedbackBonusPoolWithAsset(
        uint256 contentId,
        uint256 roundId,
        uint8 asset,
        uint256 amount,
        uint256 feedbackClosesAt,
        address awarder
    ) external nonReentrant whenNotPaused returns (uint256 poolId) {
        return _createFeedbackBonusPool(contentId, roundId, asset, amount, feedbackClosesAt, awarder);
    }

    function createFeedbackBonusPoolWithAuthorization(
        AuthorizedFeedbackBonusParams calldata params,
        Eip3009Authorization calldata authorization
    ) external nonReentrant whenNotPaused returns (uint256 poolId) {
        require(authorization.from != address(0), "Invalid funder");
        require(authorization.to == address(this), "Bad payee");
        require(authorization.value == params.amount, "Bad amount");
        require(
            authorization.nonce
                == computeFeedbackBonusAuthorizationNonce(
                    params, authorization.from, authorization.validAfter, authorization.validBefore
                ),
            "Bad nonce"
        );
        _validateFeedbackBonusPool(
            params.contentId, params.roundId, REWARD_ASSET_USDC, params.amount, params.feedbackClosesAt, params.awarder
        );

        uint256 receivedAmount = _receiveUsdcAuthorization(authorization);
        poolId = _storeFeedbackBonusPool(
            params.contentId,
            params.roundId,
            REWARD_ASSET_USDC,
            receivedAmount,
            params.feedbackClosesAt,
            params.awarder,
            authorization.from
        );
    }

    function computeFeedbackBonusAuthorizationNonce(
        AuthorizedFeedbackBonusParams calldata params,
        address funder,
        uint256 validAfter,
        uint256 validBefore
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                FEEDBACK_BONUS_AUTHORIZATION_TYPEHASH,
                block.chainid,
                address(this),
                params.contentId,
                params.roundId,
                params.amount,
                params.feedbackClosesAt,
                params.awarder,
                funder,
                validAfter,
                validBefore
            )
        );
    }

    function _createFeedbackBonusPool(
        uint256 contentId,
        uint256 roundId,
        uint8 asset,
        uint256 amount,
        uint256 feedbackClosesAt,
        address awarder
    ) internal returns (uint256 poolId) {
        _validateFeedbackBonusPool(contentId, roundId, asset, amount, feedbackClosesAt, awarder);
        uint256 receivedAmount = _pullExactToken(_bonusToken(asset), msg.sender, amount);
        poolId =
            _storeFeedbackBonusPool(contentId, roundId, asset, receivedAmount, feedbackClosesAt, awarder, msg.sender);
    }

    function _validateFeedbackBonusPool(
        uint256 contentId,
        uint256 roundId,
        uint8 asset,
        uint256 amount,
        uint256 feedbackClosesAt,
        address awarder
    ) internal view {
        require(amount > 0, "Amount required");
        require(asset == REWARD_ASSET_LREP || asset == REWARD_ASSET_USDC, "Invalid asset");
        require(roundId > 0, "Round required");
        require(awarder != address(0), "Invalid awarder");
        require(feedbackClosesAt > block.timestamp, "Invalid feedback close");
        require(registry.isContentActive(contentId), "Content not active");
        _requireCurrentRegistryVotingEngine();
        _requireTargetRound(contentId, roundId);
    }

    function _storeFeedbackBonusPool(
        uint256 contentId,
        uint256 roundId,
        uint8 asset,
        uint256 receivedAmount,
        uint256 feedbackClosesAt,
        address awarder,
        address funder
    ) internal returns (uint256 poolId) {
        (address funderIdentity, bytes32 funderIdentityKey) = _resolveIdentity(contentId, roundId, funder);
        address submitterIdentity = registry.getSubmitterIdentity(contentId);
        bytes32 submitterIdentityKey = registry.contentSubmitterIdentityKey(contentId);
        if (submitterIdentityKey == bytes32(0) && submitterIdentity != address(0)) {
            (, submitterIdentityKey) = _resolveIdentity(contentId, roundId, submitterIdentity);
        }

        poolId = nextFeedbackBonusPoolId++;
        feedbackBonusPools[poolId] = FeedbackBonusPool({
            id: poolId.toUint64(),
            contentId: contentId.toUint64(),
            roundId: roundId.toUint64(),
            feedbackClosesAt: feedbackClosesAt.toUint48(),
            funder: funder,
            funderIdentity: funderIdentity,
            funderIdentityKey: funderIdentityKey,
            awarder: awarder,
            submitterIdentity: submitterIdentity,
            submitterIdentityKey: submitterIdentityKey,
            raterRegistrySnapshot: _roundRaterRegistryAddress(contentId, roundId),
            fundedAmount: receivedAmount,
            remainingAmount: receivedAmount,
            forfeited: false,
            frontendFeeBps: defaultFrontendFeeBps,
            asset: asset
        });

        emit FeedbackBonusPoolCreated(
            poolId, contentId, roundId, funder, awarder, receivedAmount, feedbackClosesAt, defaultFrontendFeeBps, asset
        );
        emit FeedbackWindowCreated(poolId, contentId, roundId, feedbackClosesAt);
    }

    function awardFeedbackBonus(uint256 poolId, address recipient, bytes32 feedbackHash, uint256 grossAmount)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 recipientAmount)
    {
        FeedbackBonusPool storage pool = _getExistingPool(poolId);
        require(msg.sender == pool.awarder, "Only awarder");
        require(!pool.forfeited, "Pool forfeited");
        require(block.timestamp <= _feedbackBonusAwardDeadline(pool), "Feedback closed");
        require(feedbackHash != bytes32(0), "Feedback hash required");
        require(grossAmount > 0 && grossAmount <= pool.remainingAmount, "Invalid amount");
        require(!feedbackHashAwarded[poolId][feedbackHash], "Feedback already awarded");

        (bytes32 identityKey, address rewardRecipient, bytes32 commitKey, address frontend) =
            _requireRevealedIndependentRater(pool, recipient);
        bytes32 awardIdentityKey = votingEngine.commitIdentityKey(pool.contentId, pool.roundId, commitKey);
        if (awardIdentityKey == bytes32(0)) awardIdentityKey = identityKey;
        require(
            !identityKeyAwarded[poolId][identityKey] && !identityKeyAwarded[poolId][awardIdentityKey],
            "Rater already awarded"
        );
        uint256 feedbackPublishedAt =
            feedbackRegistry.awardableFeedbackPublishedAt(pool.contentId, pool.roundId, commitKey, feedbackHash);
        require(feedbackPublishedAt != 0, "Feedback not revealed");
        require(feedbackPublishedAt <= pool.feedbackClosesAt, "Feedback not timely");

        uint256 frontendFee;
        address frontendRecipient;
        (recipientAmount, frontendFee, frontendRecipient) = _splitAward(pool, commitKey, frontend, grossAmount);

        pool.remainingAmount -= grossAmount;
        identityKeyAwarded[poolId][awardIdentityKey] = true;
        if (awardIdentityKey != identityKey) identityKeyAwarded[poolId][identityKey] = true;
        feedbackHashAwarded[poolId][feedbackHash] = true;

        IERC20 rewardToken = _bonusToken(pool.asset);
        uint256 paidFrontendFee = _routeFrontendFee(rewardToken, frontendRecipient, frontendFee);
        if (paidFrontendFee != frontendFee) {
            recipientAmount += frontendFee;
            frontendFee = 0;
            frontendRecipient = address(0);
        }
        if (recipientAmount > 0) {
            rewardToken.safeTransfer(rewardRecipient, recipientAmount);
        }

        emit FeedbackBonusAwarded(
            poolId,
            pool.contentId,
            pool.roundId,
            rewardRecipient,
            awardIdentityKey,
            feedbackHash,
            grossAmount,
            recipientAmount,
            frontend,
            frontendRecipient,
            frontendFee
        );
    }

    /// @notice Sweep an expired feedback-bonus pool's remaining balance to the protocol treasury.
    /// @dev L-Funds-2: if the protocol treasury is unset (paused/replaced ProtocolConfig),
    ///      fall back to refunding the original funder instead of reverting. The primary intent
    ///      remains treasury-forfeit; the funder-refund branch is a defense-in-depth fallback
    ///      so a transiently-misconfigured ProtocolConfig cannot strand the funds.
    function forfeitExpiredFeedbackBonus(uint256 poolId)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 forfeitedAmount)
    {
        FeedbackBonusPool storage pool = _getExistingPool(poolId);
        require(!pool.forfeited, "Already forfeited");
        require(block.timestamp > _feedbackBonusAwardDeadline(pool), "Not expired");
        forfeitedAmount = pool.remainingAmount;
        require(forfeitedAmount > 0, "No funds");

        pool.forfeited = true;
        pool.remainingAmount = 0;

        address treasury = _protocolTreasury();
        if (treasury != address(0)) {
            _bonusToken(pool.asset).safeTransfer(treasury, forfeitedAmount);
            emit FeedbackBonusForfeited(poolId, treasury, forfeitedAmount);
        } else {
            address funder = pool.funder;
            require(funder != address(0), "No fallback recipient");
            _bonusToken(pool.asset).safeTransfer(funder, forfeitedAmount);
            emit FeedbackBonusFunderRefunded(poolId, funder, forfeitedAmount);
        }
    }

    /// @notice Recover an ERC-20 that is NOT one of the protocol's reward assets (LREP/USDC).
    /// @dev Donations of non-asset tokens to the escrow are otherwise permanently stuck.
    ///      Protocol-asset balances reflect per-pool funded/remaining accounting and are deliberately
    ///      not sweepable through this path. L-Funds-1.
    function recoverNonAssetToken(IERC20 token, address to, uint256 amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        require(address(token) != address(lrepToken), "Cannot recover protocol asset");
        require(address(token) != address(usdcToken), "Cannot recover protocol asset");
        require(to != address(0), "Invalid recipient");
        token.safeTransfer(to, amount);
        emit NonAssetTokenRecovered(address(token), to, amount);
    }

    function feedbackBonusAwardDeadline(uint256 poolId) external view returns (uint256) {
        return _feedbackBonusAwardDeadline(_getExistingPool(poolId));
    }

    function setRaterRegistry(address raterRegistry_) external onlyRole(CONFIG_ROLE) {
        _validateRaterRegistry(raterRegistry_);
        raterRegistry = IRaterIdentityRegistry(raterRegistry_);
        emit RaterRegistryUpdated(raterRegistry_);
    }

    function setFeedbackRegistry(address feedbackRegistry_) external onlyRole(CONFIG_ROLE) {
        _setFeedbackRegistry(feedbackRegistry_);
    }

    function setVotingEngine(address) external view onlyRole(CONFIG_ROLE) {
        revert("Invalid engine");
    }

    function setDefaultFrontendFeeBps(uint256 frontendFeeBps_) external onlyRole(CONFIG_ROLE) {
        require(frontendFeeBps_ <= MAX_FRONTEND_FEE_BPS, "Fee too high");
        uint256 previousFrontendFeeBps = defaultFrontendFeeBps;
        defaultFrontendFeeBps = frontendFeeBps_.toUint16();
        emit DefaultFrontendFeeBpsUpdated(previousFrontendFeeBps, frontendFeeBps_);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _pullExactToken(IERC20 token, address funder, uint256 amount) internal returns (uint256 receivedAmount) {
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(funder, address(this), amount);
        receivedAmount = token.balanceOf(address(this)) - balanceBefore;
        require(receivedAmount == amount, "Fee token unsupported");
    }

    function _receiveUsdcAuthorization(Eip3009Authorization calldata authorization)
        internal
        returns (uint256 receivedAmount)
    {
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
        receivedAmount = authorization.value;
    }

    function _bonusToken(uint8 asset) internal view returns (IERC20 token) {
        if (asset == REWARD_ASSET_LREP) return lrepToken;
        if (asset == REWARD_ASSET_USDC) return usdcToken;
        revert("Invalid asset");
    }

    function _setFeedbackRegistry(address feedbackRegistry_) internal {
        require(feedbackRegistry_ != address(0) && feedbackRegistry_.code.length != 0, "Invalid feedback registry");
        feedbackRegistry = IFeedbackRegistry(feedbackRegistry_);
        emit FeedbackRegistryUpdated(feedbackRegistry_);
    }

    function _requireTargetRound(uint256 contentId, uint256 roundId) internal view {
        uint256 currentRoundId = votingEngine.currentRoundId(contentId);
        if (currentRoundId == 0) {
            require(roundId == 1, "Invalid target round");
            return;
        }

        require(roundId == currentRoundId, "Invalid target round");
        (, RoundLib.RoundState state,,,,,,,,,,,,) = votingEngine.rounds(contentId, roundId);
        require(state == RoundLib.RoundState.Open, "Round not open");
    }

    function _feedbackBonusAwardDeadline(FeedbackBonusPool storage pool) internal view returns (uint256) {
        (uint48 startTime, RoundLib.RoundState state,,,,,,,,, uint48 settledAt,,,) =
            votingEngine.rounds(pool.contentId, pool.roundId);
        uint256 requestedDeadline = pool.feedbackClosesAt;

        if (settledAt != 0 && state != RoundLib.RoundState.Open) {
            uint256 decisionDeadline = uint256(settledAt) + MIN_FEEDBACK_AWARD_DECISION_SECONDS;
            return requestedDeadline > decisionDeadline ? requestedDeadline : decisionDeadline;
        }

        if (startTime != 0 && state == RoundLib.RoundState.Open) {
            return type(uint256).max;
        }

        return requestedDeadline;
    }

    function _requireCurrentRegistryVotingEngine() internal view {
        require(registry.votingEngine() == address(votingEngine), "Stale engine");
    }

    function _requireRevealedIndependentRater(FeedbackBonusPool storage pool, address recipient)
        internal
        view
        returns (bytes32 identityKey, address rewardRecipient, bytes32 commitKey, address frontend)
    {
        require(recipient != address(0), "Invalid recipient");
        (, RoundLib.RoundState state,,,,,,,,,,,,) = votingEngine.rounds(pool.contentId, pool.roundId);
        require(
            state == RoundLib.RoundState.Settled || state == RoundLib.RoundState.Tied
                || state == RoundLib.RoundState.RevealFailed,
            "Round not settled"
        );

        (identityKey, rewardRecipient, commitKey) = _resolveRecipientCommit(pool, recipient);
        require(!_isExcludedRater(pool, identityKey), "Excluded rater");
        require(commitKey != bytes32(0), "No commit");

        (address voter,, address commitFrontend,, bool revealed,,) =
            votingEngine.commitCore(pool.contentId, pool.roundId, commitKey);
        frontend = commitFrontend;
        require(voter != address(0) && revealed, "Vote not revealed");
        require(votingEngine.commitRbtsScoringWeight(pool.contentId, pool.roundId, commitKey) != 0, "Vote not scored");
    }

    function _isExcludedRater(FeedbackBonusPool storage pool, bytes32 identityKey) internal view returns (bool) {
        if (identityKey == bytes32(0)) return true;
        if (identityKey == pool.funderIdentityKey || identityKey == pool.submitterIdentityKey) return true;
        if (identityKey == _identityKeyForRound(pool.contentId, pool.roundId, pool.funder)) return true;
        if (
            pool.funderIdentity != address(0)
                && identityKey == _identityKeyForRound(pool.contentId, pool.roundId, pool.funderIdentity)
        ) {
            return true;
        }
        if (
            pool.submitterIdentity != address(0)
                && identityKey == _identityKeyForRound(pool.contentId, pool.roundId, pool.submitterIdentity)
        ) {
            return true;
        }

        bytes32 currentSubmitterIdentityKey = registry.contentSubmitterIdentityKey(pool.contentId);
        if (currentSubmitterIdentityKey != bytes32(0) && identityKey == currentSubmitterIdentityKey) return true;

        address currentSubmitterIdentity = registry.getSubmitterIdentity(pool.contentId);
        return currentSubmitterIdentity != address(0)
            && identityKey == _identityKeyForRound(pool.contentId, pool.roundId, currentSubmitterIdentity);
    }

    function _splitAward(FeedbackBonusPool storage pool, bytes32 commitKey, address frontend, uint256 grossAmount)
        internal
        view
        returns (uint256 recipientAmount, uint256 frontendFee, address frontendRecipient)
    {
        recipientAmount = grossAmount;
        if (pool.frontendFeeBps == 0 || frontend == address(0)) {
            return (recipientAmount, 0, address(0));
        }

        frontendFee = (grossAmount * pool.frontendFeeBps) / BPS_SCALE;
        if (frontendFee == 0 || frontendFee > grossAmount) {
            return (recipientAmount, 0, address(0));
        }

        frontendRecipient = _resolveFrontendRewardRecipient(pool.contentId, pool.roundId, commitKey, frontend);
        if (frontendRecipient == address(0)) {
            return (recipientAmount, 0, address(0));
        }

        recipientAmount = grossAmount - frontendFee;
    }

    function _resolveFrontendRewardRecipient(uint256 contentId, uint256 roundId, bytes32 commitKey, address frontend)
        internal
        view
        returns (address frontendRecipient)
    {
        if (!votingEngine.frontendEligibleAtCommit(contentId, roundId, commitKey)) {
            return address(0);
        }

        address frontendRegistry = votingEngine.roundFrontendRegistrySnapshot(contentId, roundId);
        if (frontendRegistry == address(0)) {
            return address(0);
        }

        try IFrontendRegistry(frontendRegistry).getFrontendInfo(frontend) returns (
            address operator, uint256, bool, bool
        ) {
            if (operator == address(0)) {
                return address(0);
            }
            // Round-time eligibility gate: a frontend that re-registered after the round
            // settled cannot revive feedback-bonus fees. Subsumes slash/exit checks.
            (,,,,,,,,,, uint48 roundSettledAt,,,) = votingEngine.rounds(contentId, roundId);
            if (_canClaimFeesForRound(frontendRegistry, frontend, roundSettledAt)) {
                frontendRecipient = operator;
            }
        } catch {
            return address(0);
        }
    }

    function _canClaimFeesForRound(address frontendRegistry, address frontend, uint48 roundSettledAt)
        internal
        view
        returns (bool)
    {
        try IFrontendRegistry(frontendRegistry).canClaimFeesForRound(frontend, roundSettledAt) returns (bool can) {
            return can;
        } catch {
            return false;
        }
    }

    function _resolveRecipientCommit(FeedbackBonusPool storage pool, address recipient)
        internal
        view
        returns (bytes32 identityKey, address rewardRecipient, bytes32 commitKey)
    {
        IRaterIdentityRegistry.ResolvedRater memory resolved = _resolveRater(pool.contentId, pool.roundId, recipient);
        identityKey = resolved.identityKey;
        rewardRecipient = resolved.holder == address(0) ? recipient : resolved.holder;

        if (identityKey != bytes32(0)) {
            commitKey = votingEngine.identityCommitKey(pool.contentId, pool.roundId, identityKey);
            if (commitKey != bytes32(0)) {
                address committedHolder = votingEngine.commitIdentityHolder(pool.contentId, pool.roundId, commitKey);
                if (committedHolder != address(0)) {
                    rewardRecipient = committedHolder;
                }
                _requireAwardRecipientMatchesCommit(pool, recipient, commitKey, rewardRecipient);
                return (identityKey, rewardRecipient, commitKey);
            }
        }

        if (rewardRecipient != address(0)) {
            commitKey = votingEngine.holderCommitKey(pool.contentId, pool.roundId, rewardRecipient);
            if (commitKey != bytes32(0)) {
                bytes32 committedIdentityKey = votingEngine.commitIdentityKey(pool.contentId, pool.roundId, commitKey);
                if (committedIdentityKey != bytes32(0)) {
                    identityKey = committedIdentityKey;
                }
                address committedHolder = votingEngine.commitIdentityHolder(pool.contentId, pool.roundId, commitKey);
                if (committedHolder != address(0)) {
                    rewardRecipient = committedHolder;
                }
                return (identityKey, rewardRecipient, commitKey);
            }
        }

        bytes32 commitHash = votingEngine.voterCommitHash(pool.contentId, pool.roundId, recipient);
        if (commitHash != bytes32(0)) {
            commitKey = keccak256(abi.encodePacked(recipient, commitHash));
            bytes32 committedIdentityKey = votingEngine.commitIdentityKey(pool.contentId, pool.roundId, commitKey);
            if (committedIdentityKey != bytes32(0)) {
                identityKey = committedIdentityKey;
            }
            address committedHolder = votingEngine.commitIdentityHolder(pool.contentId, pool.roundId, commitKey);
            if (committedHolder != address(0)) {
                rewardRecipient = committedHolder;
            }
        }
    }

    function _requireAwardRecipientMatchesCommit(
        FeedbackBonusPool storage pool,
        address recipient,
        bytes32 commitKey,
        address rewardRecipient
    ) private view {
        (address committedVoter,,,,,,) = votingEngine.commitCore(pool.contentId, pool.roundId, commitKey);
        require(recipient == committedVoter || recipient == rewardRecipient, "No commit");
    }

    function _resolveIdentity(uint256 contentId, uint256 roundId, address account)
        internal
        view
        returns (address identity, bytes32 identityKey)
    {
        if (account == address(0)) return (address(0), bytes32(0));
        IRaterIdentityRegistry.ResolvedRater memory resolved = _resolveRater(contentId, roundId, account);
        identity = resolved.holder == address(0) ? account : resolved.holder;
        identityKey = resolved.identityKey == bytes32(0) ? _addressIdentityKey(account) : resolved.identityKey;
    }

    function _routeFrontendFee(IERC20 token, address frontendRecipient, uint256 amount)
        internal
        returns (uint256 paidAmount)
    {
        if (amount == 0 || frontendRecipient == address(0)) return 0;
        return TokenTransferLib.tryTransfer(token, frontendRecipient, amount) ? amount : 0;
    }

    function _identityKeyForRound(uint256 contentId, uint256 roundId, address account)
        internal
        view
        returns (bytes32 identityKey)
    {
        if (account == address(0)) return bytes32(0);
        IRaterIdentityRegistry.ResolvedRater memory resolved = _resolveRater(contentId, roundId, account);
        return resolved.identityKey == bytes32(0) ? _addressIdentityKey(account) : resolved.identityKey;
    }

    function _resolveRater(uint256 contentId, uint256 roundId, address account)
        internal
        view
        returns (IRaterIdentityRegistry.ResolvedRater memory resolved)
    {
        if (account == address(0)) return resolved;
        address registryAddress = _roundRaterRegistryAddress(contentId, roundId);
        if (registryAddress != address(0)) {
            resolved = IRaterIdentityRegistry(registryAddress).resolveRater(account);
            if (resolved.identityKey != bytes32(0)) return resolved;
        }

        resolved = IRaterIdentityRegistry.ResolvedRater({
            holder: account,
            identityKey: _addressIdentityKey(account),
            humanNullifier: bytes32(0),
            hasActiveHumanCredential: false,
            delegated: false
        });
    }

    function _roundRaterRegistryAddress(uint256 contentId, uint256 roundId)
        internal
        view
        returns (address registryAddress)
    {
        registryAddress = votingEngine.roundRaterRegistrySnapshot(contentId, roundId);
        if (registryAddress != address(0)) return registryAddress;

        ProtocolConfig cfg = votingEngine.protocolConfig();
        if (address(cfg) != address(0)) {
            registryAddress = cfg.raterRegistry();
        }
        if (registryAddress == address(0)) {
            registryAddress = address(raterRegistry);
        }
    }

    function _addressIdentityKey(address account) internal pure returns (bytes32) {
        if (account == address(0)) return bytes32(0);
        return keccak256(abi.encodePacked("rateloop.address-identity-v1", account));
    }

    function _validateRaterRegistry(address registryAddress) private view {
        require(registryAddress != address(0) && registryAddress.code.length != 0, "Invalid registry");
        IRaterIdentityRegistry identityRegistry = IRaterIdentityRegistry(registryAddress);
        address sample = address(uint160(uint256(keccak256("rateloop.rater-registry.validation"))));
        bytes32 expectedSampleKey = _addressIdentityKey(sample);

        try identityRegistry.addressIdentityKey(address(0)) returns (bytes32 zeroKey) {
            require(zeroKey == bytes32(0), "Invalid registry");
        } catch {
            revert("Invalid registry");
        }
        try identityRegistry.addressIdentityKey(sample) returns (bytes32 sampleKey) {
            require(sampleKey == expectedSampleKey, "Invalid registry");
        } catch {
            revert("Invalid registry");
        }
        try identityRegistry.resolveRater(sample) returns (IRaterIdentityRegistry.ResolvedRater memory resolved) {
            require(resolved.holder == sample, "Invalid registry");
            require(resolved.identityKey == expectedSampleKey, "Invalid registry");
            require(resolved.humanNullifier == bytes32(0), "Invalid registry");
            require(!resolved.hasActiveHumanCredential, "Invalid registry");
            require(!resolved.delegated, "Invalid registry");
        } catch {
            revert("Invalid registry");
        }
        try identityRegistry.hasActiveHumanCredential(sample) returns (bool active) {
            require(!active, "Invalid registry");
        } catch {
            revert("Invalid registry");
        }
    }

    function _protocolTreasury() internal view returns (address treasury) {
        ProtocolConfig cfg = votingEngine.protocolConfig();
        if (address(cfg) != address(0)) {
            treasury = cfg.treasury();
        }
    }

    function _getExistingPool(uint256 poolId) internal view returns (FeedbackBonusPool storage pool) {
        pool = feedbackBonusPools[poolId];
        require(pool.id != 0, "Bonus not found");
    }
}
