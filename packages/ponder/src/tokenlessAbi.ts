import type { Abi } from "viem";

const roundComponents = [
  { name: "funder", type: "address" },
  { name: "contentId", type: "bytes32" },
  { name: "termsHash", type: "bytes32" },
  { name: "beaconNetworkHash", type: "bytes32" },
  { name: "feeRecipient", type: "address" },
  { name: "bountyAmount", type: "uint256" },
  { name: "feeAmount", type: "uint256" },
  { name: "attemptReserve", type: "uint256" },
  { name: "attemptCompensation", type: "uint256" },
  { name: "compensationPerRecipient", type: "uint256" },
  { name: "totalAccuracyScore", type: "uint256" },
  { name: "totalPaid", type: "uint256" },
  { name: "commitDeadline", type: "uint64" },
  { name: "revealDeadline", type: "uint64" },
  { name: "beaconFailureDeadline", type: "uint64" },
  { name: "beaconRound", type: "uint64" },
  { name: "claimGracePeriod", type: "uint64" },
  { name: "claimDeadline", type: "uint64" },
  { name: "minimumReveals", type: "uint32" },
  { name: "maximumCommits", type: "uint32" },
  { name: "requiredTier", type: "uint32" },
  { name: "commitCount", type: "uint32" },
  { name: "revealCount", type: "uint32" },
  { name: "frozenRevealCount", type: "uint32" },
  { name: "aggregateCursor", type: "uint32" },
  { name: "weightCursor", type: "uint32" },
  { name: "upVotes", type: "uint32" },
  { name: "state", type: "uint8" },
  { name: "staleReturned", type: "bool" },
] as const;

const commitComponents = [
  { name: "roundId", type: "uint256" },
  { name: "voteKey", type: "address" },
  { name: "sealedCommitment", type: "bytes32" },
  { name: "sealedPayloadHash", type: "bytes32" },
  { name: "payoutCommitment", type: "bytes32" },
  { name: "responseHash", type: "bytes32" },
  { name: "accuracyScore", type: "uint256" },
  { name: "predictedUpBps", type: "uint16" },
  { name: "vote", type: "uint8" },
  { name: "revealed", type: "bool" },
  { name: "claimed", type: "bool" },
] as const;

export const tokenlessPanelAbi = [
  {
    type: "event",
    name: "RoundCreated",
    inputs: [
      { name: "roundId", type: "uint256", indexed: true },
      { name: "funder", type: "address", indexed: true },
      { name: "contentId", type: "bytes32", indexed: true },
      { name: "termsHash", type: "bytes32", indexed: false },
      { name: "bountyAmount", type: "uint256", indexed: false },
      { name: "feeAmount", type: "uint256", indexed: false },
      { name: "attemptReserve", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "CommitAccepted",
    inputs: [
      { name: "roundId", type: "uint256", indexed: true },
      { name: "commitKey", type: "bytes32", indexed: true },
      { name: "nullifier", type: "bytes32", indexed: true },
      { name: "sealedPayload", type: "bytes", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RevealAccepted",
    inputs: [
      { name: "roundId", type: "uint256", indexed: true },
      { name: "commitKey", type: "bytes32", indexed: true },
      { name: "vote", type: "uint8", indexed: false },
      { name: "predictedUpBps", type: "uint16", indexed: false },
      { name: "responseHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SettlementBegun",
    inputs: [
      { name: "roundId", type: "uint256", indexed: true },
      { name: "frozenRevealCount", type: "uint32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SettlementProgressed",
    inputs: [
      { name: "roundId", type: "uint256", indexed: true },
      { name: "state", type: "uint8", indexed: true },
      { name: "cursor", type: "uint32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RoundFinalized",
    inputs: [
      { name: "roundId", type: "uint256", indexed: true },
      { name: "totalAccuracyScore", type: "uint256", indexed: false },
      { name: "claimDeadline", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RoundTerminal",
    inputs: [
      { name: "roundId", type: "uint256", indexed: true },
      { name: "state", type: "uint8", indexed: true },
      { name: "funderRefund", type: "uint256", indexed: false },
      { name: "compensation", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { name: "roundId", type: "uint256", indexed: true },
      { name: "commitKey", type: "bytes32", indexed: true },
      { name: "payoutAddress", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "StaleSharesReturned",
    inputs: [
      { name: "roundId", type: "uint256", indexed: true },
      { name: "funder", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "getRound",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }],
    outputs: [{ name: "round", type: "tuple", components: roundComponents }],
  },
  {
    type: "function",
    name: "getCommit",
    stateMutability: "view",
    inputs: [{ name: "commitKey", type: "bytes32" }],
    outputs: [{ name: "record", type: "tuple", components: commitComponents }],
  },
  {
    type: "function",
    name: "roundRevealKey",
    stateMutability: "view",
    inputs: [
      { name: "roundId", type: "uint256" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ name: "commitKey", type: "bytes32" }],
  },
] as const satisfies Abi;

export const credentialIssuerAbi = [
  {
    type: "event",
    name: "SignerRotated",
    inputs: [
      { name: "previousEpoch", type: "uint64", indexed: true },
      { name: "newEpoch", type: "uint64", indexed: true },
      { name: "newSigner", type: "address", indexed: true },
      { name: "emergency", type: "bool", indexed: false },
      { name: "previousEpochAcceptedUntil", type: "uint64", indexed: false },
    ],
  },
] as const satisfies Abi;
