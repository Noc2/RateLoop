import {
  PAYOUT_DOMAIN_QUESTION_REWARD,
  correlationParameterHash,
  defaultCorrelationScoringParams,
  merkleProof,
  scoreRoundPayoutWeights,
  type CorrelationVoteInput,
} from "@rateloop/node-utils/correlationScoring";
import {
  getAddress,
  isAddress,
  isHex,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { config } from "./config.js";
import { canonicalJson, storeCorrelationArtifact } from "./correlation-artifact-storage.js";
import type {
  CorrelationEpochArtifact,
  CorrelationSnapshotArtifactFile,
  RoundPayoutSnapshotArtifact,
} from "./correlation-snapshots.js";
import type { Logger } from "./logger.js";

interface CandidateResponse {
  items?: unknown[];
}

interface VoteResponse {
  items?: unknown[];
}

interface CorrelationRoundCandidate {
  rewardPoolId: bigint;
  contentId: bigint;
  roundId: bigint;
}

interface PublicRoundPayoutSnapshot {
  domain: number;
  rewardPoolId: string;
  contentId: string;
  roundId: string;
  correlationEpochId: string;
  rawEligibleVoters: number;
  effectiveParticipantUnits: number;
  totalClaimWeight: string;
  weightRoot: Hex;
  reasonRoot: Hex;
  payoutWeights: PublicPayoutWeight[];
}

interface PublicPayoutWeight {
  domain: number;
  rewardPoolId: string;
  contentId: string;
  roundId: string;
  commitKey: Hex;
  identityKey: Hex;
  account: Address;
  baseWeight: string;
  independenceBps: number;
  effectiveWeight: string;
  reasonHash: Hex;
  leaf: Hex;
  proof: Hex[];
  clusterId: Hex;
  verifiedHuman: boolean;
  reasons: readonly string[];
}

const VOTE_PAGE_SIZE = 1_000;

export async function buildConfiguredCorrelationSnapshotArtifact(
  logger: Logger,
): Promise<CorrelationSnapshotArtifactFile> {
  if (!config.ponderBaseUrl) {
    throw new Error("PONDER_BASE_URL is required for automatic correlation snapshots");
  }

  const candidates = await fetchRoundCandidates(
    config.ponderBaseUrl,
    config.correlationSnapshots.maxRoundsPerTick,
  );
  if (candidates.length === 0) {
    return {};
  }

  const publicRounds: PublicRoundPayoutSnapshot[] = [];

  for (const candidate of candidates) {
    const votes = await fetchRoundVotes(config.ponderBaseUrl, candidate);

    const scored = scoreRoundPayoutWeights({
      chainId: BigInt(config.chainId),
      oracleAddress: config.contracts.clusterPayoutOracle,
      domain: PAYOUT_DOMAIN_QUESTION_REWARD,
      rewardPoolId: candidate.rewardPoolId,
      contentId: candidate.contentId,
      roundId: candidate.roundId,
      votes,
    });
    const leaves = scored.leaves.map((leaf) => leaf.leaf);

    publicRounds.push({
      domain: PAYOUT_DOMAIN_QUESTION_REWARD,
      rewardPoolId: candidate.rewardPoolId.toString(),
      contentId: candidate.contentId.toString(),
      roundId: candidate.roundId.toString(),
      correlationEpochId: candidate.roundId.toString(),
      rawEligibleVoters: scored.rawEligibleVoters,
      effectiveParticipantUnits: scored.effectiveParticipantUnits,
      totalClaimWeight: scored.totalClaimWeight.toString(),
      weightRoot: scored.weightRoot,
      reasonRoot: scored.reasonRoot,
      payoutWeights: scored.leaves.map((leaf): PublicPayoutWeight => ({
        domain: leaf.domain,
        rewardPoolId: leaf.rewardPoolId.toString(),
        contentId: leaf.contentId.toString(),
        roundId: leaf.roundId.toString(),
        commitKey: leaf.commitKey,
        identityKey: leaf.identityKey,
        account: leaf.account,
        baseWeight: leaf.baseWeight.toString(),
        independenceBps: leaf.independenceBps,
        effectiveWeight: leaf.effectiveWeight.toString(),
        reasonHash: leaf.reasonHash,
        leaf: leaf.leaf,
        proof: merkleProof(leaves, leaf.leaf),
        clusterId: leaf.clusterId,
        verifiedHuman: leaf.verifiedHuman,
        reasons: leaf.reasons,
      })),
    });
  }

  if (publicRounds.length === 0) {
    return {};
  }

  const params = defaultCorrelationScoringParams();
  const parameterHash = correlationParameterHash(params);
  const publicEpochs = buildPublicEpochs(publicRounds, parameterHash);
  const stored = await storeCorrelationArtifact({
    artifactVersion: "rateloop-correlation-artifact-v1",
    chainId: config.chainId,
    oracleAddress: config.contracts.clusterPayoutOracle,
    scorerVersion: params.scorerVersion,
    parameters: params,
    correlationEpochs: publicEpochs,
    roundPayoutSnapshots: publicRounds,
  });

  const correlationEpochs: CorrelationEpochArtifact[] = publicEpochs.map((epoch) => ({
    ...epoch,
    artifactHash: stored.artifactHash,
    artifactURI: stored.artifactURI,
  }));
  const roundPayoutSnapshots: RoundPayoutSnapshotArtifact[] = publicRounds.map((snapshot) => ({
    domain: snapshot.domain,
    rewardPoolId: snapshot.rewardPoolId,
    contentId: snapshot.contentId,
    roundId: snapshot.roundId,
    correlationEpochId: snapshot.correlationEpochId,
    rawEligibleVoters: snapshot.rawEligibleVoters,
    effectiveParticipantUnits: snapshot.effectiveParticipantUnits,
    totalClaimWeight: snapshot.totalClaimWeight,
    weightRoot: snapshot.weightRoot,
    reasonRoot: snapshot.reasonRoot,
    artifactHash: stored.artifactHash,
    artifactURI: stored.artifactURI,
  }));

  logger.info("Built automatic correlation snapshot artifact", {
    candidateCount: candidates.length,
    roundSnapshotCount: roundPayoutSnapshots.length,
    epochCount: correlationEpochs.length,
    artifactHash: stored.artifactHash,
    artifactURI: stored.artifactURI,
    canonicalBytes: Buffer.byteLength(stored.canonicalJson),
  });

  return { correlationEpochs, roundPayoutSnapshots };
}

function buildPublicEpochs(
  rounds: readonly PublicRoundPayoutSnapshot[],
  parameterHash: Hex,
) {
  const byEpoch = new Map<string, PublicRoundPayoutSnapshot[]>();
  for (const round of rounds) {
    const entries = byEpoch.get(round.correlationEpochId) ?? [];
    entries.push(round);
    byEpoch.set(round.correlationEpochId, entries);
  }

  return [...byEpoch.entries()]
    .sort(([left], [right]) => bigintCompare(BigInt(left), BigInt(right)))
    .map(([epochId, epochRounds]) => ({
      epochId,
      fromRoundId: epochId,
      toRoundId: epochId,
      clusterRoot: hashJson(
        epochRounds.map((round) => ({
          rewardPoolId: round.rewardPoolId,
          contentId: round.contentId,
          roundId: round.roundId,
          weightRoot: round.weightRoot,
          reasonRoot: round.reasonRoot,
        })),
      ),
      parameterHash,
      roundSnapshotCount: epochRounds.length,
    }));
}

async function fetchRoundCandidates(
  ponderBaseUrl: string,
  limit: number,
): Promise<CorrelationRoundCandidate[]> {
  const url = new URL("/correlation/round-candidates", ponderBaseUrl);
  url.searchParams.set("limit", String(limit));
  const response = await fetchJson<CandidateResponse>(url);
  return (response.items ?? []).map(parseCandidate);
}

async function fetchRoundVotes(
  ponderBaseUrl: string,
  candidate: CorrelationRoundCandidate,
): Promise<CorrelationVoteInput[]> {
  const votes: CorrelationVoteInput[] = [];
  for (let offset = 0; ; offset += VOTE_PAGE_SIZE) {
    const url = new URL("/correlation/round-votes", ponderBaseUrl);
    url.searchParams.set("rewardPoolId", candidate.rewardPoolId.toString());
    url.searchParams.set("contentId", candidate.contentId.toString());
    url.searchParams.set("roundId", candidate.roundId.toString());
    url.searchParams.set("limit", String(VOTE_PAGE_SIZE));
    url.searchParams.set("offset", String(offset));
    const response = await fetchJson<VoteResponse>(url);
    const items = response.items ?? [];
    votes.push(...items.map(parseVote));
    if (items.length < VOTE_PAGE_SIZE) {
      return votes;
    }
  }
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Ponder request failed: ${url.pathname} ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function parseCandidate(value: unknown): CorrelationRoundCandidate {
  const record = requireRecord(value, "correlation round candidate");
  return {
    rewardPoolId: requirePositiveBigInt(record.rewardPoolId, "rewardPoolId"),
    contentId: requirePositiveBigInt(record.contentId, "contentId"),
    roundId: requirePositiveBigInt(record.roundId, "roundId"),
  };
}

function parseVote(value: unknown): CorrelationVoteInput {
  const record = requireRecord(value, "correlation vote");
  const account = requireAddress(record.account, "account");
  const identityKey = requireHex(record.identityKey, "identityKey");
  const commitKey = requireHex(record.commitKey, "commitKey");
  return {
    account,
    identityKey,
    commitKey,
    baseWeight: requirePositiveBigInt(record.baseWeight, "baseWeight"),
    verifiedHuman: record.verifiedHuman === true,
    historicalVoteCount: requireNonNegativeNumber(
      record.historicalVoteCount,
      "historicalVoteCount",
    ),
    features: Array.isArray(record.features)
      ? record.features.filter((feature): feature is string => typeof feature === "string")
      : [],
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function requireAddress(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`${label} must be an address`);
  }
  return getAddress(value);
}

function requireHex(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !isHex(value)) {
    throw new Error(`${label} must be hex`);
  }
  return value as Hex;
}

function requirePositiveBigInt(value: unknown, label: string): bigint {
  const parsed = parseBigInt(value);
  if (parsed === null || parsed <= 0n) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function requireNonNegativeNumber(value: unknown, label: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function parseBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

function hashJson(value: unknown): Hex {
  return keccak256(toBytes(canonicalJson(value)));
}

function bigintCompare(left: bigint, right: bigint) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
