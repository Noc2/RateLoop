// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { ContentRegistry } from "./ContentRegistry.sol";
import { ProtocolConfig } from "./ProtocolConfig.sol";
import { RoundLib } from "./libraries/RoundLib.sol";
import { RatingLib } from "./libraries/RatingLib.sol";

/// @title RoundVotingEngineStorage
/// @notice Shared storage layout for RoundVotingEngine and delegatecall settlement modules.
// Proxy storage slots are initialized by RoundVotingEngine.initialize(); Slither cannot see cross-contract init.
// slither-disable-start uninitialized-state,constable-states
abstract contract RoundVotingEngineStorage {
    // M-Crosscutting-1 (audit 2026-05-20): Storage layout history. This contract is
    // `TransparentUpgradeableProxy`-backed (see `script/Deploy.s.sol`). Slot positions matter
    // for any future hot-upgrade. Fresh deployments are unaffected by historical shifts, but
    // any hot-upgrade must still run `forge-upgrade` / OZ Upgrades `validateUpgrade` first.
    IERC20 internal lrepToken;
    ContentRegistry internal registry;
    ProtocolConfig public protocolConfig;

    mapping(uint256 => mapping(uint256 => RoundLib.Round)) internal rounds;
    mapping(uint256 => uint256) public currentRoundId;
    mapping(uint256 => uint256) internal nextRoundId;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => RoundLib.Commit))) internal commits;
    mapping(uint256 => mapping(uint256 => bytes32[])) internal roundCommitHashes;
    mapping(uint256 => mapping(address => uint256)) internal lastVoteTimestamp;
    mapping(uint256 => mapping(uint256 => uint256)) internal roundVoterPool;
    mapping(uint256 => mapping(uint256 => uint256)) internal roundWinningStake;
    mapping(uint256 => mapping(uint256 => bool)) internal roundRbtsScored;
    mapping(uint256 => mapping(uint256 => uint256)) internal roundRbtsRewardWeight;
    mapping(uint256 => mapping(uint256 => uint256)) internal roundRbtsRewardClaimants;
    mapping(uint256 => mapping(uint256 => uint256)) internal roundRbtsParticipationWeight;
    mapping(uint256 => mapping(uint256 => uint256)) internal roundRbtsParticipationClaimants;
    mapping(uint256 => mapping(uint256 => uint256)) internal roundRbtsForfeitedPool;
    mapping(uint256 => mapping(uint256 => uint256)) internal roundRbtsForfeitClaimants;
    mapping(uint256 => mapping(uint256 => uint16)) internal roundRbtsMeanScoreBps;
    mapping(uint256 => mapping(uint256 => bytes32)) internal roundRbtsScoreSeed;
    mapping(uint256 => mapping(uint256 => address)) internal roundRbtsSettlementOracle;
    mapping(uint256 => mapping(uint256 => bytes32)) internal roundRbtsSettlementSnapshotDigest;
    mapping(uint256 => mapping(uint256 => uint256)) internal roundThresholdReachedBlock;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => uint16))) internal commitPredictedUpBps;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => uint256))) internal commitRbtsWeight;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => uint16))) internal commitRbtsScoreBps;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => uint256))) internal commitRbtsRewardWeight;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => uint256))) internal commitRbtsStakeReturned;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => uint256))) internal commitRbtsForfeitedStake;
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) internal cancelledRoundRefundClaimed;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) internal cancelledRoundRefundCommitClaimed;
    mapping(uint256 => bool) public hasCommits;
    uint256 internal accountedLrepBalance;
    mapping(uint256 => mapping(uint256 => RoundLib.RoundConfig)) public roundConfigSnapshot;
    mapping(uint256 => mapping(uint256 => RatingLib.RatingConfig)) internal roundRatingConfigSnapshot;
    mapping(uint256 => mapping(uint256 => uint16)) internal roundReferenceRatingBpsSnapshot;
    mapping(uint256 => mapping(uint256 => mapping(address => bytes32))) internal voterCommitHash;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => bytes32))) internal identityCommitKey;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => bytes32))) internal commitIdentityKey;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => address))) internal commitIdentityHolder;
    mapping(uint256 => mapping(uint256 => mapping(address => bytes32))) internal holderCommitKey;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => uint256))) internal identityRoundStake;
    mapping(uint256 => mapping(uint256 => uint256)) internal roundStakeWithEligibleFrontend;
    mapping(uint256 => mapping(uint256 => mapping(address => uint256))) internal roundPerFrontendStake;
    mapping(uint256 => mapping(uint256 => uint256)) internal roundFrontendPool;
    mapping(uint256 => mapping(uint256 => uint256)) internal roundEligibleFrontendCount;
    mapping(uint256 => mapping(uint256 => address)) public roundRaterRegistrySnapshot;
    mapping(uint256 => mapping(uint256 => address)) internal roundAdvisoryVoteRecorderSnapshot;
    mapping(uint256 => mapping(bytes32 => uint256)) internal lastVoteTimestampByIdentity;
    mapping(uint256 => mapping(uint256 => mapping(uint256 => uint256))) internal epochUnrevealedCount;
    mapping(uint256 => mapping(uint256 => uint256)) internal roundRevealGracePeriodSnapshot;
    mapping(uint256 => mapping(uint256 => bytes32)) internal roundDrandChainHashSnapshot;
    mapping(uint256 => mapping(uint256 => uint64)) internal roundDrandGenesisTimeSnapshot;
    mapping(uint256 => mapping(uint256 => uint64)) internal roundDrandPeriodSnapshot;
    mapping(uint256 => mapping(uint256 => uint256)) internal lastCommitRevealableAfter;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => bool))) internal frontendEligibleAtCommit;
    mapping(uint256 => mapping(uint256 => address)) public roundFrontendRegistrySnapshot;
    mapping(uint256 => mapping(uint256 => uint256)) internal roundUnrevealedCleanupRemaining;
    mapping(uint256 => mapping(uint256 => uint256)) internal roundCleanupIncentivePaid;
    mapping(uint256 => mapping(uint256 => uint64)) internal roundRatingUpEvidence;
    mapping(uint256 => mapping(uint256 => uint64)) internal roundRatingDownEvidence;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => uint48))) internal commitCommittedAt;
    mapping(uint256 contentId => mapping(uint256 roundId => bool)) internal pendingBundleObserverReplay;
    mapping(uint256 => mapping(uint256 => uint16)) internal roundHumanVerifiedCommitCount;
    mapping(uint256 => mapping(uint256 => bytes32)) internal roundRbtsSeedEntropy;
    mapping(uint256 => mapping(uint256 => uint48)) internal roundRbtsScoringClosedAt;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => bytes32))) internal commitRevealEntropy;
    /// @custom:oz-renamed-from roundDeferredCleanupBounty
    mapping(uint256 contentId => mapping(uint256 roundId => uint48)) internal roundClusterPayoutReadyAt;
    uint256 internal _pendingTreasuryForfeitLrep;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => uint8))) internal commitCredentialMask;
    mapping(uint256 => mapping(uint256 => mapping(bytes32 => uint8))) internal commitFreshCredentialMask;
    mapping(uint256 => mapping(uint256 => uint8)) internal roundContentDormantCountSnapshot;
    mapping(uint256 => mapping(uint256 => address)) internal roundConfidentialityEscrowSnapshot;
    mapping(uint256 contentId => mapping(uint256 roundId => bool)) public pendingRatingSettlementReplay;
    address internal rbtsSettlementModule;
    uint256[12] private __gap;
}
// slither-disable-end uninitialized-state,constable-states
