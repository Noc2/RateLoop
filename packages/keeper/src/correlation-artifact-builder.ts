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
import {
  canonicalJson,
  materializeCorrelationArtifactCanonicalJson,
  storeCorrelationArtifact,
  type StoredCorrelationArtifact,
} from "./correlation-artifact-storage.js";
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
  roundContext?: unknown;
}

interface RoundVotesPage {
  votes: CorrelationVoteInput[];
  /** Null when Ponder omits or malforms the round context (neutral fallback). */
  trailingBaseRateUpBps: number | null;
}

export interface CorrelationRoundCandidate {
  rewardPoolId: bigint;
  contentId: bigint;
  roundId: bigint;
}

interface BuiltConfiguredCorrelationSnapshotArtifact {
  artifact: CorrelationSnapshotArtifactFile;
  artifactHash?: `0x${string}`;
  artifactURI?: string;
  canonicalJson?: string;
  canonicalBytes: number;
  candidateCount: number;
  roundSnapshotCount: number;
  epochCount: number;
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
  trailingBaseRateUpBps: number | null;
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
  surpriseBps: number;
  reasonHash: Hex;
  leaf: Hex;
  proof: Hex[];
  clusterId: Hex;
  verifiedHuman: boolean;
  reasons: readonly string[];
}

const VOTE_PAGE_SIZE = 1_000;
const PONDER_FETCH_TIMEOUT_MS = 5_000;
const PONDER_JSON_MAX_BYTES = 5_000_000;
const MAX_VOTE_PAGES_PER_ROUND = 50;
const CANDIDATE_FINGERPRINT_VERSION = "rateloop-correlation-candidates-v1";
const loggedAutomaticArtifactHashes = new Set<string>();

export async function buildConfiguredCorrelationSnapshotArtifact(
  logger: Logger,
): Promise<CorrelationSnapshotArtifactFile> {
  return (await buildConfiguredCorrelationSnapshotArtifactDetails(logger)).artifact;
}

async function buildConfiguredCorrelationSnapshotArtifactDetails(
  logger: Logger,
): Promise<BuiltConfiguredCorrelationSnapshotArtifact> {
  const candidates = await loadConfiguredCorrelationSnapshotCandidates(logger);
  return buildConfiguredCorrelationSnapshotArtifactForCandidates(candidates, logger);
}

export async function loadConfiguredCorrelationSnapshotCandidates(
  logger: Logger,
): Promise<CorrelationRoundCandidate[]> {
  if (!config.ponderBaseUrl) {
    throw new Error("PONDER_BASE_URL is required for automatic correlation snapshots");
  }

  const candidateWindow = await fetchRoundCandidateWindow(
    config.ponderBaseUrl,
    config.correlationSnapshots.maxRoundsPerTick,
  );
  const candidates = selectCompleteEpochCandidates(
    candidateWindow,
    config.correlationSnapshots.maxRoundsPerTick,
    logger,
  );
  return candidates;
}

export async function buildConfiguredCorrelationSnapshotArtifactForCandidates(
  candidates: readonly CorrelationRoundCandidate[],
  logger: Logger,
): Promise<BuiltConfiguredCorrelationSnapshotArtifact> {
  if (candidates.length === 0) {
    return {
      artifact: {},
      canonicalBytes: 0,
      candidateCount: 0,
      roundSnapshotCount: 0,
      epochCount: 0,
    };
  }

  if (!config.ponderBaseUrl) {
    throw new Error("PONDER_BASE_URL is required for automatic correlation snapshots");
  }
  const publicRounds: PublicRoundPayoutSnapshot[] = [];

  for (const candidate of candidates) {
    const { votes, trailingBaseRateUpBps } = await fetchRoundVotes(
      config.ponderBaseUrl,
      candidate,
    );

    const scored = scoreRoundPayoutWeights({
      chainId: BigInt(config.chainId),
      oracleAddress: config.contracts.clusterPayoutOracle,
      domain: PAYOUT_DOMAIN_QUESTION_REWARD,
      rewardPoolId: candidate.rewardPoolId,
      contentId: candidate.contentId,
      roundId: candidate.roundId,
      votes,
      trailingBaseRateUpBps,
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
      trailingBaseRateUpBps,
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
        surpriseBps: leaf.surpriseBps,
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
    return {
      artifact: {},
      canonicalBytes: 0,
      candidateCount: candidates.length,
      roundSnapshotCount: 0,
      epochCount: 0,
    };
  }

  const params = defaultCorrelationScoringParams();
  const parameterHash = correlationParameterHash(params);
  const publicEpochs = buildPublicEpochs(publicRounds, parameterHash);
  const stored = await storeCorrelationArtifact({
    artifactVersion: "rateloop-correlation-artifact-v2",
    chainId: config.chainId,
    oracleAddress: config.contracts.clusterPayoutOracle,
    scorerVersion: params.scorerVersion,
    parameters: params,
    correlationEpochs: publicEpochs,
    roundPayoutSnapshots: publicRounds,
  });

  const artifact = buildSnapshotArtifactFromStoredPublicArtifact(
    { correlationEpochs: publicEpochs, roundPayoutSnapshots: publicRounds },
    stored,
  );
  const correlationEpochs = artifact.correlationEpochs ?? [];
  const roundPayoutSnapshots = artifact.roundPayoutSnapshots ?? [];

  const artifactUriSummary = summarizeArtifactUri(stored.artifactURI);
  const logData = {
    candidateCount: candidates.length,
    roundSnapshotCount: roundPayoutSnapshots.length,
    epochCount: correlationEpochs.length,
    artifactHash: stored.artifactHash,
    ...artifactUriSummary,
    canonicalBytes: Buffer.byteLength(stored.canonicalJson),
  };
  if (loggedAutomaticArtifactHashes.has(stored.artifactHash)) {
    logger.debug("Automatic correlation snapshot artifact unchanged", logData);
  } else {
    loggedAutomaticArtifactHashes.add(stored.artifactHash);
    logger.info("Built automatic correlation snapshot artifact", logData);
  }

  return {
    artifact,
    artifactHash: stored.artifactHash,
    artifactURI: stored.artifactURI,
    canonicalJson: stored.canonicalJson,
    canonicalBytes: Buffer.byteLength(stored.canonicalJson),
    candidateCount: candidates.length,
    roundSnapshotCount: roundPayoutSnapshots.length,
    epochCount: correlationEpochs.length,
  };
}

export function correlationSnapshotCandidateFingerprint(
  candidates: readonly CorrelationRoundCandidate[],
): `0x${string}` {
  const params = defaultCorrelationScoringParams();
  const normalizedCandidates = candidates
    .map((candidate) => ({
      rewardPoolId: candidate.rewardPoolId.toString(),
      contentId: candidate.contentId.toString(),
      roundId: candidate.roundId.toString(),
    }))
    .sort((left, right) => {
      const roundCompare = bigintCompare(BigInt(left.roundId), BigInt(right.roundId));
      if (roundCompare !== 0) return roundCompare;
      const rewardPoolCompare = bigintCompare(
        BigInt(left.rewardPoolId),
        BigInt(right.rewardPoolId),
      );
      if (rewardPoolCompare !== 0) return rewardPoolCompare;
      return bigintCompare(BigInt(left.contentId), BigInt(right.contentId));
    });

  return keccak256(toBytes(canonicalJson({
    version: CANDIDATE_FINGERPRINT_VERSION,
    chainId: config.chainId,
    oracleAddress: config.contracts.clusterPayoutOracle,
    scorerVersion: params.scorerVersion,
    parameterHash: correlationParameterHash(params),
    candidates: normalizedCandidates,
  })));
}

export async function restoreConfiguredCorrelationSnapshotArtifactFromCanonicalJson(
  canonical: string,
): Promise<BuiltConfiguredCorrelationSnapshotArtifact> {
  const stored = await materializeCorrelationArtifactCanonicalJson(canonical);
  const publicArtifact = JSON.parse(canonical) as PublicCorrelationArtifact;
  const artifact = buildSnapshotArtifactFromStoredPublicArtifact(publicArtifact, stored);
  return {
    artifact,
    artifactHash: stored.artifactHash,
    artifactURI: stored.artifactURI,
    canonicalJson: stored.canonicalJson,
    canonicalBytes: Buffer.byteLength(stored.canonicalJson),
    candidateCount: 0,
    roundSnapshotCount: artifact.roundPayoutSnapshots?.length ?? 0,
    epochCount: artifact.correlationEpochs?.length ?? 0,
  };
}

interface PublicCorrelationArtifact {
  correlationEpochs?: Array<Omit<CorrelationEpochArtifact, "artifactHash" | "artifactURI">>;
  roundPayoutSnapshots?: PublicRoundPayoutSnapshot[];
}

function buildSnapshotArtifactFromStoredPublicArtifact(
  publicArtifact: PublicCorrelationArtifact,
  stored: StoredCorrelationArtifact,
): CorrelationSnapshotArtifactFile {
  const correlationEpochs: CorrelationEpochArtifact[] = (
    publicArtifact.correlationEpochs ?? []
  ).map((epoch) => ({
    ...epoch,
    artifactHash: stored.artifactHash,
    artifactURI: stored.artifactURI,
  }));
  const roundPayoutSnapshots: RoundPayoutSnapshotArtifact[] = (
    publicArtifact.roundPayoutSnapshots ?? []
  ).map((snapshot) => ({
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

  return { correlationEpochs, roundPayoutSnapshots };
}

function summarizeArtifactUri(artifactURI: string) {
  const byteLength = Buffer.byteLength(artifactURI);
  if (artifactURI.startsWith("data:")) {
    return {
      artifactUriScheme: "data",
      artifactUriBytes: byteLength,
    };
  }

  try {
    const url = new URL(artifactURI);
    return {
      artifactUriScheme: url.protocol.replace(/:$/u, ""),
      artifactUriHost: url.host,
      artifactUriPath: url.pathname,
      artifactUriBytes: byteLength,
    };
  } catch {
    return {
      artifactUriScheme: "unknown",
      artifactUriBytes: byteLength,
    };
  }
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

async function fetchRoundCandidateWindow(
  ponderBaseUrl: string,
  maxRoundsPerTick: number,
): Promise<CorrelationRoundCandidate[]> {
  const candidates: CorrelationRoundCandidate[] = [];
  const targetCount = maxRoundsPerTick + 1;
  for (let offset = 0; candidates.length < targetCount;) {
    const limit = Math.min(targetCount - candidates.length, 200);
    const url = new URL("/correlation/round-candidates", ponderBaseUrl);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    const response = await fetchJson<CandidateResponse>(url);
    const items = response.items ?? [];
    if (items.length > limit) {
      throw new Error(`Ponder returned too many correlation candidates: ${items.length} > ${limit}`);
    }
    candidates.push(...items.map(parseCandidate));
    if (items.length < limit) {
      break;
    }
    offset += items.length;
  }
  return candidates;
}

function selectCompleteEpochCandidates(
  candidates: readonly CorrelationRoundCandidate[],
  maxRoundsPerTick: number,
  logger: Logger,
): CorrelationRoundCandidate[] {
  if (candidates.length === 0) {
    return [];
  }

  const epochRoundId = candidates[0]!.roundId;
  const epochCandidates = candidates.filter((candidate) => candidate.roundId === epochRoundId);
  const sawNextEpoch = candidates.some((candidate) => candidate.roundId !== epochRoundId);
  if (epochCandidates.length > maxRoundsPerTick || (!sawNextEpoch && candidates.length > maxRoundsPerTick)) {
    logger.warn("Skipping automatic correlation epoch because one round exceeds maxRoundsPerTick", {
      roundId: epochRoundId.toString(),
      candidateCountSeen: epochCandidates.length,
      maxRoundsPerTick,
    });
    return [];
  }

  return epochCandidates;
}

async function fetchRoundVotes(
  ponderBaseUrl: string,
  candidate: CorrelationRoundCandidate,
): Promise<RoundVotesPage> {
  const votes: CorrelationVoteInput[] = [];
  let trailingBaseRateUpBps: number | null = null;
  for (let page = 0; page < MAX_VOTE_PAGES_PER_ROUND; page += 1) {
    const offset = page * VOTE_PAGE_SIZE;
    const url = new URL("/correlation/round-votes", ponderBaseUrl);
    url.searchParams.set("rewardPoolId", candidate.rewardPoolId.toString());
    url.searchParams.set("contentId", candidate.contentId.toString());
    url.searchParams.set("roundId", candidate.roundId.toString());
    url.searchParams.set("limit", String(VOTE_PAGE_SIZE));
    url.searchParams.set("offset", String(offset));
    const response = await fetchJson<VoteResponse>(url);
    const items = response.items ?? [];
    if (items.length > VOTE_PAGE_SIZE) {
      throw new Error(`Ponder returned too many correlation votes: ${items.length} > ${VOTE_PAGE_SIZE}`);
    }
    trailingBaseRateUpBps ??= parseRoundContextTrailingBaseRateUpBps(
      response.roundContext,
    );
    votes.push(...items.map(parseVote));
    if (items.length < VOTE_PAGE_SIZE) {
      return { votes, trailingBaseRateUpBps };
    }
  }
  throw new Error(
    `Ponder returned more than ${MAX_VOTE_PAGES_PER_ROUND} correlation vote pages for rewardPoolId=${candidate.rewardPoolId} contentId=${candidate.contentId} roundId=${candidate.roundId}`,
  );
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(PONDER_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Ponder request failed: ${url.pathname} ${response.status}`);
  }
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const declaredLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declaredLength) && declaredLength > PONDER_JSON_MAX_BYTES) {
      throw new Error(`Ponder response too large: ${declaredLength} > ${PONDER_JSON_MAX_BYTES} bytes`);
    }
  }
  return JSON.parse(await readResponseBody(response, PONDER_JSON_MAX_BYTES)) as T;
}

async function readResponseBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    throw new Error("Ponder response body is not readable");
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const reader = response.body.getReader();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`Ponder response exceeded ${maxBytes} bytes during read`);
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
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
  const revealWeight = parseBigInt(record.revealWeight);
  return {
    account,
    identityKey,
    commitKey,
    verifiedHuman: record.verifiedHuman === true,
    historicalVoteCount: requireNonNegativeNumber(
      record.historicalVoteCount,
      "historicalVoteCount",
    ),
    features: Array.isArray(record.features)
      ? record.features.filter((feature): feature is string => typeof feature === "string")
      : [],
    // Surprise inputs are optional: a missing or malformed value falls back
    // to the neutral surprise multiplier inside the scorer (spec fallback).
    isUp: typeof record.isUp === "boolean" ? record.isUp : null,
    revealWeight: revealWeight !== null && revealWeight >= 0n ? revealWeight : null,
  };
}

function parseRoundContextTrailingBaseRateUpBps(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = (value as Record<string, unknown>).trailingBaseRateUpBps;
  const parsed =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && /^\d+$/.test(raw)
        ? Number(raw)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 10_000) {
    return null;
  }
  return parsed;
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
