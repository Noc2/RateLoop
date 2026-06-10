import {
  concat,
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { canonicalJsonHash } from "./json";

export const PAYOUT_DOMAIN_QUESTION_REWARD = 1;
export const PAYOUT_DOMAIN_LAUNCH_CREDIT = 2;
export const CORRELATION_CANONICAL_JSON_VERSION = "rateloop-canonical-json-v1";
export const CORRELATION_ELIGIBILITY_SPEC_VERSION =
  "rateloop-correlation-eligibility-v1";
export const CORRELATION_FEATURE_SPEC_VERSION =
  "rateloop-correlation-features-v1";
export const PAYOUT_WEIGHT_DOMAIN = keccak256(
  toBytes("rateloop.correlation.payout-weight.v1"),
);
export const BPS_DENOMINATOR = 10_000n;

export interface CorrelationScoringParams {
  minUnverifiedMaturityVotes: number;
  unverifiedFloorBps: number;
  verifiedFloorBps: number;
  maxClusterSizeWithoutDiscount: number;
  scorerVersion: string;
  eligibilitySpecVersion: string;
  canonicalJsonVersion: string;
  featureSpecVersion: string;
}

export interface CorrelationVoteInput {
  account: Address;
  identityKey: Hex;
  commitKey: Hex;
  baseWeight: bigint;
  verifiedHuman: boolean;
  historicalVoteCount: number;
  features: readonly string[];
}

export interface PayoutWeightLeafInput {
  domain: number;
  rewardPoolId: bigint;
  contentId: bigint;
  roundId: bigint;
  commitKey: Hex;
  identityKey: Hex;
  account: Address;
  baseWeight: bigint;
  independenceBps: number;
  effectiveWeight: bigint;
  reasonHash: Hex;
}

export interface ScoredPayoutWeight extends PayoutWeightLeafInput {
  clusterId: Hex;
  verifiedHuman: boolean;
  leaf: Hex;
  reasons: readonly string[];
}

export interface RoundPayoutScoringResult {
  rawEligibleVoters: number;
  effectiveParticipantUnits: number;
  totalClaimWeight: bigint;
  weightRoot: Hex;
  reasonRoot: Hex;
  leaves: readonly ScoredPayoutWeight[];
  parameterHash: Hex;
}

class DisjointSet {
  private parent: number[];
  private rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.rank = Array.from({ length: size }, () => 0);
  }

  find(index: number): number {
    const parent = this.parent[index] ?? index;
    if (parent === index) return index;
    const root = this.find(parent);
    this.parent[index] = root;
    return root;
  }

  union(left: number, right: number): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    const leftRank = this.rank[leftRoot] ?? 0;
    const rightRank = this.rank[rightRoot] ?? 0;
    if (leftRank < rightRank) {
      this.parent[leftRoot] = rightRoot;
      return;
    }
    if (leftRank > rightRank) {
      this.parent[rightRoot] = leftRoot;
      return;
    }
    this.parent[rightRoot] = leftRoot;
    this.rank[leftRoot] = leftRank + 1;
  }
}

export function defaultCorrelationScoringParams(): CorrelationScoringParams {
  return {
    minUnverifiedMaturityVotes: 5,
    unverifiedFloorBps: 2_500,
    verifiedFloorBps: 6_000,
    maxClusterSizeWithoutDiscount: 1,
    scorerVersion: "rateloop-correlation-epoch-v1",
    eligibilitySpecVersion: CORRELATION_ELIGIBILITY_SPEC_VERSION,
    canonicalJsonVersion: CORRELATION_CANONICAL_JSON_VERSION,
    featureSpecVersion: CORRELATION_FEATURE_SPEC_VERSION,
  };
}

export function correlationParameterHash(
  params: CorrelationScoringParams,
): Hex {
  return canonicalJsonHash({
    canonicalJsonVersion: params.canonicalJsonVersion,
    eligibilitySpecVersion: params.eligibilitySpecVersion,
    featureSpecVersion: params.featureSpecVersion,
    maxClusterSizeWithoutDiscount: params.maxClusterSizeWithoutDiscount,
    minUnverifiedMaturityVotes: params.minUnverifiedMaturityVotes,
    scorerVersion: params.scorerVersion,
    unverifiedFloorBps: params.unverifiedFloorBps,
    verifiedFloorBps: params.verifiedFloorBps,
  });
}

export function scoreRoundPayoutWeights(args: {
  chainId: bigint;
  oracleAddress: Address;
  domain: number;
  rewardPoolId: bigint;
  contentId: bigint;
  roundId: bigint;
  votes: readonly CorrelationVoteInput[];
  params?: Partial<CorrelationScoringParams>;
}): RoundPayoutScoringResult {
  const params = { ...defaultCorrelationScoringParams(), ...args.params };
  validateParams(params);
  const clusters = buildClusters(args.votes);
  const clusterSizes = new Map<number, number>();
  for (let index = 0; index < args.votes.length; index++) {
    const root = clusters.find(index);
    clusterSizes.set(root, (clusterSizes.get(root) ?? 0) + 1);
  }

  const leaves = args.votes.map((vote, index) => {
    const clusterRoot = clusters.find(index);
    const clusterSize = clusterSizes.get(clusterRoot) ?? 1;
    const clusterId = clusterIdFor(args.votes, clusters, clusterRoot);
    const { independenceBps, reasons } = independenceForVote(
      vote,
      clusterSize,
      params,
    );
    const effectiveWeight =
      (vote.baseWeight * BigInt(independenceBps)) / BPS_DENOMINATOR;
    const reasonHash = keccak256(toBytes(reasons.join("|")));
    const payout: PayoutWeightLeafInput = {
      domain: args.domain,
      rewardPoolId: args.rewardPoolId,
      contentId: args.contentId,
      roundId: args.roundId,
      commitKey: vote.commitKey,
      identityKey: vote.identityKey,
      account: vote.account,
      baseWeight: vote.baseWeight,
      independenceBps,
      effectiveWeight,
      reasonHash,
    };
    return {
      ...payout,
      clusterId,
      verifiedHuman: vote.verifiedHuman,
      leaf: payoutWeightLeaf(args.chainId, args.oracleAddress, payout),
      reasons,
    };
  });

  return {
    rawEligibleVoters: leaves.length,
    effectiveParticipantUnits: leaves.reduce(
      (sum, leaf) => sum + leaf.independenceBps,
      0,
    ),
    totalClaimWeight: leaves.reduce(
      (sum, leaf) => sum + leaf.effectiveWeight,
      0n,
    ),
    weightRoot: merkleRoot(leaves.map((leaf) => leaf.leaf)),
    reasonRoot: merkleRoot(leaves.map((leaf) => leaf.reasonHash)),
    leaves,
    parameterHash: correlationParameterHash(params),
  };
}

export function payoutWeightLeaf(
  chainId: bigint,
  oracleAddress: Address,
  payout: PayoutWeightLeafInput,
): Hex {
  const encoded = encodeAbiParameters(
    parseAbiParameters(
      "bytes32,uint256,address,uint8,uint256,uint256,uint256,bytes32,bytes32,address,uint256,uint16,uint256,bytes32",
    ),
    [
      PAYOUT_WEIGHT_DOMAIN,
      chainId,
      oracleAddress,
      payout.domain,
      payout.rewardPoolId,
      payout.contentId,
      payout.roundId,
      payout.commitKey,
      payout.identityKey,
      payout.account,
      payout.baseWeight,
      payout.independenceBps,
      payout.effectiveWeight,
      payout.reasonHash,
    ],
  );
  return keccak256(keccak256(encoded));
}

export function merkleRoot(values: readonly Hex[]): Hex {
  if (values.length === 0)
    return "0x0000000000000000000000000000000000000000000000000000000000000000";
  let level = [...values].sort(compareHex);
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      const right = level[index + 1] ?? left;
      next.push(hashSortedPair(left, right));
    }
    level = next;
  }
  return level[0]!;
}

export function merkleProof(values: readonly Hex[], leaf: Hex): Hex[] {
  let level = [...values].sort(compareHex);
  let leafIndex = level.findIndex(
    (value) => value.toLowerCase() === leaf.toLowerCase(),
  );
  if (leafIndex < 0) {
    throw new Error("Leaf not found in Merkle tree");
  }

  const proof: Hex[] = [];
  while (level.length > 1) {
    const siblingIndex = leafIndex % 2 === 0 ? leafIndex + 1 : leafIndex - 1;
    proof.push(level[siblingIndex] ?? level[leafIndex]!);

    const next: Hex[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      const right = level[index + 1] ?? left;
      next.push(hashSortedPair(left, right));
    }
    leafIndex = Math.floor(leafIndex / 2);
    level = next;
  }

  return proof;
}

function buildClusters(votes: readonly CorrelationVoteInput[]): DisjointSet {
  const clusters = new DisjointSet(votes.length);
  const firstIndexByFeature = new Map<string, number>();
  for (let index = 0; index < votes.length; index++) {
    for (const feature of votes[index]?.features ?? []) {
      const key = feature.trim().toLowerCase();
      if (!key) continue;
      const previousIndex = firstIndexByFeature.get(key);
      if (previousIndex === undefined) {
        firstIndexByFeature.set(key, index);
      } else {
        clusters.union(previousIndex, index);
      }
    }
  }
  return clusters;
}

function independenceForVote(
  vote: CorrelationVoteInput,
  clusterSize: number,
  params: CorrelationScoringParams,
): { independenceBps: number; reasons: readonly string[] } {
  const floor = vote.verifiedHuman
    ? params.verifiedFloorBps
    : params.unverifiedFloorBps;
  const clusterBps =
    clusterSize <= params.maxClusterSizeWithoutDiscount
      ? 10_000
      : Math.floor(10_000 / Math.sqrt(clusterSize));
  const maturityBps = vote.verifiedHuman
    ? 10_000
    : Math.floor(
        (Math.min(vote.historicalVoteCount, params.minUnverifiedMaturityVotes) *
          10_000) /
          params.minUnverifiedMaturityVotes,
      );
  const independenceBps = Math.max(
    floor,
    Math.min(10_000, clusterBps, maturityBps),
  );
  const reasons = [
    `cluster_size=${clusterSize}`,
    `cluster_bps=${clusterBps}`,
    `maturity_bps=${maturityBps}`,
    vote.verifiedHuman
      ? "verified_human_anchor=true"
      : "verified_human_anchor=false",
  ];
  return { independenceBps, reasons };
}

function clusterIdFor(
  votes: readonly CorrelationVoteInput[],
  clusters: DisjointSet,
  root: number,
): Hex {
  const members = votes
    .map((vote, index) => ({ vote, index }))
    .filter(({ index }) => clusters.find(index) === root)
    .map(
      ({ vote }) =>
        `${vote.identityKey}:${vote.account.toLowerCase()}:${vote.commitKey}`,
    )
    .sort();
  return keccak256(toBytes(members.join("|")));
}

function hashSortedPair(left: Hex, right: Hex): Hex {
  return compareHex(left, right) <= 0
    ? keccak256(concat([left, right]))
    : keccak256(concat([right, left]));
}

function compareHex(left: Hex, right: Hex): number {
  return left.toLowerCase().localeCompare(right.toLowerCase());
}

function validateParams(params: CorrelationScoringParams): void {
  if (
    params.minUnverifiedMaturityVotes <= 0 ||
    params.unverifiedFloorBps < 0 ||
    params.verifiedFloorBps < 0 ||
    params.unverifiedFloorBps > 10_000 ||
    params.verifiedFloorBps > 10_000 ||
    params.maxClusterSizeWithoutDiscount <= 0 ||
    !params.scorerVersion ||
    !params.eligibilitySpecVersion ||
    !params.canonicalJsonVersion ||
    !params.featureSpecVersion
  ) {
    throw new Error("Invalid correlation scoring parameters");
  }
}
