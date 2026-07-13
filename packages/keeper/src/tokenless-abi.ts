import { parseAbi } from "viem";

// Package-local minimal ABI until the first tokenless-v2 deployment generates
// @rateloop/contracts/tokenless. Keep this limited to permissionless keeper calls.
export const TokenlessPanelAbi = parseAbi([
  "event CommitAccepted(uint256 indexed roundId,bytes32 indexed commitKey,bytes32 indexed nullifier,bytes sealedPayload)",
  "function nextRoundId() view returns (uint256)",
  "function credentialIssuer() view returns (address)",
  "function getRound(uint256 roundId) view returns ((address funder,bytes32 contentId,bytes32 termsHash,bytes32 beaconNetworkHash,address feeRecipient,uint256 bountyAmount,uint256 feeAmount,uint256 attemptReserve,uint256 attemptCompensation,uint256 compensationPerRecipient,uint256 totalAccuracyScore,uint256 totalPaid,uint64 commitDeadline,uint64 revealDeadline,uint64 beaconFailureDeadline,uint64 beaconRound,uint64 claimGracePeriod,uint256 claimDeadline,uint32 minimumReveals,uint32 maximumCommits,bytes32 admissionPolicyHash,uint32 commitCount,uint32 revealCount,uint32 frozenRevealCount,uint32 aggregateCursor,uint32 weightCursor,uint32 upVotes,uint8 state,bool staleReturned))",
  "function getCommit(bytes32 commitKey) view returns ((uint256 roundId,address voteKey,bytes32 sealedCommitment,bytes32 sealedPayloadHash,bytes32 payoutCommitment,bytes32 responseHash,uint256 accuracyScore,uint16 predictedUpBps,uint8 vote,bool revealed,bool claimed))",
  "function openReveal(uint256 roundId)",
  "function reveal(uint256 roundId,address voteKey,uint8 vote,uint16 predictedUpBps,bytes32 responseHash,address payoutAddress,bytes32 salt)",
  "function beginSettlement(uint256 roundId)",
  "function processAggregate(uint256 roundId,uint32 cursor,uint32 count)",
  "function processWeights(uint256 roundId,uint32 cursor,uint32 count)",
  "function finalizeSettlement(uint256 roundId)",
  "function claim(bytes32 commitKey,address payoutAddress,bytes32 salt) returns (uint256 amount)",
  "function claimCompensation(bytes32 commitKey,address payoutAddress,bytes32 salt) returns (uint256 amount)",
  "function returnStaleShares(uint256 roundId) returns (uint256 amount)",
]);
