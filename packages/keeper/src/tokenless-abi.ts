import { parseAbi } from "viem";

// Package-local minimal ABI until the first tokenless-v4 deployment generates
// @rateloop/contracts/tokenless. Keep this limited to permissionless keeper calls.
// The getRound tuple must remain byte-for-byte aligned with TokenlessPanel.Round.
export const TokenlessPanelAbi = parseAbi([
  "error AlreadyClaimed()",
  "error ClaimWindowOpen()",
  "error CursorMismatch()",
  "error InvalidDeadline()",
  "error InvalidState()",
  "error NotClaimable()",
  "event CommitAccepted(uint256 indexed roundId,bytes32 indexed commitKey,bytes32 indexed nullifier,bytes sealedPayload)",
  "function nextRoundId() view returns (uint256)",
  "function usdc() view returns (address)",
  "function credentialIssuer() view returns (address)",
  "function SCORING_VERSION() view returns (uint8)",
  "function BASE_PAY_BPS() view returns (uint16)",
  "function MAXIMUM_COMMITS() view returns (uint32)",
  "function getRound(uint256 roundId) view returns ((address funder,bytes32 contentId,bytes32 termsHash,bytes32 beaconNetworkHash,address feeRecipient,uint256 bountyAmount,uint256 feeAmount,uint256 attemptReserve,uint256 attemptCompensation,uint256 fixedBasePay,uint256 maximumBonus,uint256 compensationPerRecipient,uint256 totalRbtsScoreBps,uint256 totalFinalizedLiability,uint256 totalPaid,uint256 entropyBlock,bytes32 revealSetXor,uint256 revealSetSum,bytes32 scoringSeed,uint64 commitDeadline,uint64 revealDeadline,uint64 beaconFailureDeadline,uint64 beaconRound,uint64 claimGracePeriod,uint256 claimDeadline,uint32 minimumReveals,uint32 maximumCommits,bytes32 admissionPolicyHash,uint32 commitCount,uint32 revealCount,uint32 compensatedRevealCount,uint32 frozenRevealCount,uint32 aggregateCursor,uint32 scoreCursor,uint32 upVotes,uint8 state,uint8 scoringMode,bool staleReturned))",
  "function getCommit(bytes32 commitKey) view returns ((uint256 roundId,address voteKey,bytes32 sealedCommitment,bytes32 sealedPayloadHash,bytes32 payoutCommitment,bytes32 responseHash,bytes32 referenceCommitKey,bytes32 peerCommitKey,uint256 finalizedPayout,uint16 predictedUpBps,uint16 informationScoreBps,uint16 predictionScoreBps,uint16 rbtsScoreBps,uint8 vote,bool revealed,bool claimed))",
  "function openReveal(uint256 roundId)",
  "function reveal(uint256 roundId,address voteKey,uint8 vote,uint16 predictedUpBps,bytes32 responseHash,address payoutAddress,bytes32 salt)",
  "function beginSettlement(uint256 roundId)",
  "function processAggregate(uint256 roundId,uint32 cursor,uint32 count)",
  "function finalizeScoringSeed(uint256 roundId)",
  "function processScores(uint256 roundId,uint32 cursor,uint32 count)",
  "function finalizeSettlement(uint256 roundId)",
  "function claim(bytes32 commitKey,address payoutAddress,bytes32 salt) returns (uint256 amount)",
  "function claimCompensation(bytes32 commitKey,address payoutAddress,bytes32 salt) returns (uint256 amount)",
  "function returnStaleShares(uint256 roundId) returns (uint256 amount)",
]);

export const TokenlessFeedbackBonusAbi = parseAbi([
  "function usdc() view returns (address)",
  "function credentialIssuer() view returns (address)",
  "function nextPoolId() view returns (uint256)",
  "function getPool(uint256 poolId) view returns ((bytes32 reviewId,bytes32 contentId,bytes32 admissionPolicyHash,address funder,address awarder,uint256 depositedAmount,uint256 awardedAmount,uint64 feedbackDeadline,uint64 awardDeadline,bool refunded))",
  "function getFeedback(uint256 poolId,address voteKey) view returns ((address voteKey,bytes32 responseHash,bytes32 payoutCommitment,uint64 registeredAt,uint256 awardAmount,bool awarded,bool claimed))",
  "function remainingAmount(uint256 poolId) view returns (uint256)",
  "function claimAward(uint256 poolId,address voteKey,address payoutAddress,bytes32 payoutSalt) returns (uint256 amount)",
  "function refundRemainder(uint256 poolId) returns (uint256 amount)",
]);

export const TokenlessX402PanelSubmitterAbi = parseAbi([
  "function usdc() view returns (address)",
  "function panel() view returns (address)",
]);
