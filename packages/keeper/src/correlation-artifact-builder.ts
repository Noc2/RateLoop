import {
  CORRELATION_VOTE_PAGE_SIZE,
  MAX_CORRELATION_VOTE_PAGES,
  PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD,
  PAYOUT_DOMAIN_PUBLIC_RATING,
  PAYOUT_DOMAIN_QUESTION_REWARD,
  PONDER_HTTP_FETCH_TIMEOUT_MS,
  correlationParameterHash,
  correlationVotesPathForDomain,
  defaultCorrelationScoringParams,
  merkleProof,
  scoreRoundPayoutWeights,
  scoreRoundRatingWeights,
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
import { readBoundedResponseText } from "./bounded-response.js";
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
import { buildPonderUrl } from "./ponder-url.js";

interface CandidateResponse {
  items?: unknown[];
}

interface VoteResponse {
  excludedVotes?: unknown[];
  items?: unknown[];
  roundContext?: unknown;
  truncated?: boolean;
}

interface RoundVotesPage {
  excludedVotes: PublicExcludedCorrelationVote[];
  questionMetadataRef: PublicQuestionMetadataRef;
  votes: CorrelationVoteInput[];
  /** Null when Ponder omits or malforms the round context (neutral fallback). */
  trailingBaseRateUpBps: number | null;
}

export interface CorrelationRoundCandidate {
  domain: number;
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
  questionMetadataRef: PublicQuestionMetadataRef;
  trailingBaseRateUpBps: number | null;
  eligibleVotes: PublicCorrelationVoteInput[];
  excludedVotes: PublicExcludedCorrelationVote[];
  payoutWeights: PublicPayoutWeight[];
}

interface PublicQuestionMetadataRef {
  questionMetadataHash: Hex | null;
  questionMetadataUri: string | null;
  resultSpecHash: Hex | null;
  targetAudienceHash: Hex | null;
}

interface PublicCorrelationVoteInput {
  account: Address;
  identityKey: Hex;
  commitKey: Hex;
  verifiedHuman: boolean;
  historicalVoteCount: number;
  features: readonly string[];
  isUp: boolean | null;
  revealWeight: string | null;
  stake: string | null;
  epochIndex: number | null;
}

interface PublicExcludedCorrelationVote {
  account: Address;
  identityKey: Hex;
  commitKey: Hex;
  cooldownSeconds: number | null;
  profileUpdatedAt: string | null;
  reasons: readonly string[];
  roundOpenTime: string | null;
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

const PONDER_FETCH_TIMEOUT_MS = PONDER_HTTP_FETCH_TIMEOUT_MS;
const PONDER_JSON_MAX_BYTES = 5_000_000;
const VOTE_PAGE_SIZE = CORRELATION_VOTE_PAGE_SIZE;
const MAX_VOTE_PAGES_PER_ROUND = MAX_CORRELATION_VOTE_PAGES;
const CANDIDATE_FINGERPRINT_VERSION = "rateloop-correlation-candidates-v1";
const HEX32_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const loggedAutomaticArtifactHashes = new Set<string>();

export async function buildConfiguredCorrelationSnapshotArtifact(
  logger: Logger,
): Promise<CorrelationSnapshotArtifactFile> {
  return (await buildConfiguredCorrelationSnapshotArtifactDetails(logger))
    .artifact;
}

async function buildConfiguredCorrelationSnapshotArtifactDetails(
  logger: Logger,
): Promise<BuiltConfiguredCorrelationSnapshotArtifact> {
  const candidates = await loadConfiguredCorrelationSnapshotCandidates(logger);
  return buildConfiguredCorrelationSnapshotArtifactForCandidates(
    candidates,
    logger,
  );
}

export async function loadConfiguredCorrelationSnapshotCandidates(
  logger: Logger,
): Promise<CorrelationRoundCandidate[]> {
  if (!config.ponderBaseUrl) {
    throw new Error(
      "PONDER_BASE_URL is required for automatic correlation snapshots",
    );
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

interface CorrelationArtifactBuildOptions {
  correlationEpochId?: bigint;
  ponderNowSeconds?: bigint;
}

export async function buildConfiguredCorrelationSnapshotArtifactForCandidates(
  candidates: readonly CorrelationRoundCandidate[],
  logger: Logger,
  options: CorrelationArtifactBuildOptions = {},
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
    throw new Error(
      "PONDER_BASE_URL is required for automatic correlation snapshots",
    );
  }
  const publicRounds: PublicRoundPayoutSnapshot[] = [];

  for (const candidate of candidates) {
    const { excludedVotes, questionMetadataRef, votes, trailingBaseRateUpBps } =
      await fetchRoundVotes(
        config.ponderBaseUrl,
        candidate,
        options.ponderNowSeconds,
      );

    const scored =
      candidate.domain === PAYOUT_DOMAIN_PUBLIC_RATING
        ? scoreRoundRatingWeights({
            chainId: BigInt(config.chainId),
            oracleAddress: config.contracts.clusterPayoutOracle,
            contentId: candidate.contentId,
            roundId: candidate.roundId,
            votes,
          })
        : scoreRoundPayoutWeights({
            chainId: BigInt(config.chainId),
            oracleAddress: config.contracts.clusterPayoutOracle,
            domain: candidate.domain,
            rewardPoolId: candidate.rewardPoolId,
            contentId: candidate.contentId,
            roundId: candidate.roundId,
            votes,
            trailingBaseRateUpBps,
          });
    const leaves = scored.leaves.map((leaf) => leaf.leaf);

    publicRounds.push({
      domain: candidate.domain,
      rewardPoolId: candidate.rewardPoolId.toString(),
      contentId: candidate.contentId.toString(),
      roundId: candidate.roundId.toString(),
      correlationEpochId: (
        options.correlationEpochId ?? candidate.roundId
      ).toString(),
      rawEligibleVoters: scored.rawEligibleVoters,
      effectiveParticipantUnits: scored.effectiveParticipantUnits,
      totalClaimWeight: scored.totalClaimWeight.toString(),
      weightRoot: scored.weightRoot,
      reasonRoot: scored.reasonRoot,
      questionMetadataRef,
      trailingBaseRateUpBps,
      eligibleVotes: votes.map(
        (vote): PublicCorrelationVoteInput => ({
          account: vote.account,
          identityKey: vote.identityKey,
          commitKey: vote.commitKey,
          verifiedHuman: vote.verifiedHuman,
          historicalVoteCount: vote.historicalVoteCount,
          features: [...vote.features].sort(),
          isUp: typeof vote.isUp === "boolean" ? vote.isUp : null,
          revealWeight:
            typeof vote.revealWeight === "bigint"
              ? vote.revealWeight.toString()
              : null,
          stake: typeof vote.stake === "bigint" ? vote.stake.toString() : null,
          epochIndex:
            typeof vote.epochIndex === "number" &&
            Number.isSafeInteger(vote.epochIndex)
              ? vote.epochIndex
              : null,
        }),
      ),
      excludedVotes,
      payoutWeights: scored.leaves.map(
        (leaf): PublicPayoutWeight => ({
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
        }),
      ),
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
    eligibilitySpecVersion: params.eligibilitySpecVersion,
    canonicalJsonVersion: params.canonicalJsonVersion,
    featureSpecVersion: params.featureSpecVersion,
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
      domain: candidate.domain,
      rewardPoolId: candidate.rewardPoolId.toString(),
      contentId: candidate.contentId.toString(),
      roundId: candidate.roundId.toString(),
    }))
    .sort((left, right) => {
      const roundCompare = bigintCompare(
        BigInt(left.roundId),
        BigInt(right.roundId),
      );
      if (roundCompare !== 0) return roundCompare;
      const domainCompare = left.domain - right.domain;
      if (domainCompare !== 0) return domainCompare;
      const rewardPoolCompare = bigintCompare(
        BigInt(left.rewardPoolId),
        BigInt(right.rewardPoolId),
      );
      if (rewardPoolCompare !== 0) return rewardPoolCompare;
      return bigintCompare(BigInt(left.contentId), BigInt(right.contentId));
    });

  return keccak256(
    toBytes(
      canonicalJson({
        version: CANDIDATE_FINGERPRINT_VERSION,
        chainId: config.chainId,
        oracleAddress: config.contracts.clusterPayoutOracle,
        scorerVersion: params.scorerVersion,
        parameterHash: correlationParameterHash(params),
        candidates: normalizedCandidates,
      }),
    ),
  );
}

export async function restoreConfiguredCorrelationSnapshotArtifactFromCanonicalJson(
  canonical: string,
): Promise<BuiltConfiguredCorrelationSnapshotArtifact> {
  const stored = await materializeCorrelationArtifactCanonicalJson(canonical);
  const publicArtifact = JSON.parse(canonical) as PublicCorrelationArtifact;
  const artifact = buildSnapshotArtifactFromStoredPublicArtifact(
    publicArtifact,
    stored,
  );
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
  correlationEpochs?: Array<
    Omit<CorrelationEpochArtifact, "artifactHash" | "artifactURI">
  >;
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
    .map(([epochId, epochRounds]) => {
      const roundIds = epochRounds.map((round) => BigInt(round.roundId));
      const fromRoundId = roundIds.reduce((min, value) =>
        value < min ? value : min,
      );
      const toRoundId = roundIds.reduce((max, value) =>
        value > max ? value : max,
      );

      return {
        epochId,
        fromRoundId: fromRoundId.toString(),
        toRoundId: toRoundId.toString(),
        clusterRoot: hashJson(
          epochRounds.map((round) => ({
            domain: round.domain,
            rewardPoolId: round.rewardPoolId,
            contentId: round.contentId,
            roundId: round.roundId,
            weightRoot: round.weightRoot,
            reasonRoot: round.reasonRoot,
          })),
        ),
        parameterHash,
        roundSnapshotCount: epochRounds.length,
      };
    });
}

async function fetchRoundCandidateWindow(
  ponderBaseUrl: string,
  maxRoundsPerTick: number,
): Promise<CorrelationRoundCandidate[]> {
  const candidates: CorrelationRoundCandidate[] = [];
  const targetCount = maxRoundsPerTick + 1;
  const endpoints = [
    "/correlation/round-candidates",
    "/correlation/bundle-round-candidates",
    "/correlation/rating-round-candidates",
  ];
  for (const pathname of endpoints) {
    for (let offset = 0; candidates.length < targetCount * endpoints.length; ) {
      const limit = Math.min(targetCount, 200);
      const url = buildPonderUrl(ponderBaseUrl, pathname);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));
      const response = await fetchJson<CandidateResponse>(url);
      const items = response.items ?? [];
      if (items.length > limit) {
        throw new Error(
          `Ponder returned too many correlation candidates: ${items.length} > ${limit}`,
        );
      }
      candidates.push(...items.map(parseCandidate));
      if (items.length < limit) {
        break;
      }
      offset += items.length;
    }
  }
  return candidates.sort(compareCandidates).slice(0, targetCount);
}

export function selectCompleteEpochCandidates(
  candidates: readonly CorrelationRoundCandidate[],
  maxRoundsPerTick: number,
  logger: Logger,
): CorrelationRoundCandidate[] {
  if (candidates.length === 0) {
    return [];
  }

  const epochRoundId = candidates[0]!.roundId;
  const epochCandidates = candidates.filter(
    (candidate) => candidate.roundId === epochRoundId,
  );
  const sawNextEpoch = candidates.some(
    (candidate) => candidate.roundId !== epochRoundId,
  );
  if (
    epochCandidates.length > maxRoundsPerTick ||
    (!sawNextEpoch && candidates.length > maxRoundsPerTick)
  ) {
    if (!sawNextEpoch) {
      logger.warn(
        "Skipping automatic correlation epoch because one round exceeds maxRoundsPerTick",
        {
          roundId: epochRoundId.toString(),
          candidateCountSeen: epochCandidates.length,
          maxRoundsPerTick,
        },
      );
      return [];
    }

    logger.warn(
      "Skipping automatic correlation epoch because epoch exceeds maxRoundsPerTick with a following epoch visible",
      {
        roundId: epochRoundId.toString(),
        candidateCountSeen: epochCandidates.length,
        maxRoundsPerTick,
      },
    );
    return [];
  }

  return epochCandidates;
}

async function fetchRoundVotes(
  ponderBaseUrl: string,
  candidate: CorrelationRoundCandidate,
  ponderNowSeconds?: bigint,
): Promise<RoundVotesPage> {
  const excludedVotes: PublicExcludedCorrelationVote[] = [];
  const excludedVoteKeys = new Set<string>();
  const votes: CorrelationVoteInput[] = [];
  let questionMetadataRef = emptyQuestionMetadataRef();
  let trailingBaseRateUpBps: number | null = null;
  for (let page = 0; page < MAX_VOTE_PAGES_PER_ROUND; page += 1) {
    const offset = page * VOTE_PAGE_SIZE;
    const url = buildPonderUrl(
      ponderBaseUrl,
      correlationVotesPathForDomain(candidate.domain),
    );
    if (candidate.domain !== PAYOUT_DOMAIN_PUBLIC_RATING) {
      url.searchParams.set("rewardPoolId", candidate.rewardPoolId.toString());
    }
    url.searchParams.set("contentId", candidate.contentId.toString());
    url.searchParams.set("roundId", candidate.roundId.toString());
    url.searchParams.set("limit", String(VOTE_PAGE_SIZE));
    url.searchParams.set("offset", String(offset));
    if (ponderNowSeconds !== undefined) {
      url.searchParams.set("now", ponderNowSeconds.toString());
    }
    const response = await fetchJson<VoteResponse>(url);
    if (response.truncated) {
      throw new Error(
        `Ponder truncated correlation votes for rewardPoolId=${candidate.rewardPoolId} contentId=${candidate.contentId} roundId=${candidate.roundId} offset=${offset}`,
      );
    }
    const items = response.items ?? [];
    if (items.length > VOTE_PAGE_SIZE) {
      throw new Error(
        `Ponder returned too many correlation votes: ${items.length} > ${VOTE_PAGE_SIZE}`,
      );
    }
    trailingBaseRateUpBps ??= parseRoundContextTrailingBaseRateUpBps(
      response.roundContext,
    );
    if (page === 0) {
      questionMetadataRef = parseRoundContextQuestionMetadataRef(
        response.roundContext,
      );
    }
    for (const excludedVote of (response.excludedVotes ?? []).map(
      parseExcludedVote,
    )) {
      const key = `${excludedVote.commitKey.toLowerCase()}:${excludedVote.identityKey.toLowerCase()}`;
      if (excludedVoteKeys.has(key)) continue;
      excludedVoteKeys.add(key);
      excludedVotes.push(excludedVote);
    }
    votes.push(...items.map(parseVote));
    if (items.length < VOTE_PAGE_SIZE) {
      return {
        excludedVotes,
        questionMetadataRef,
        votes,
        trailingBaseRateUpBps,
      };
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
    throw new Error(
      `Ponder request failed: ${url.pathname} ${response.status}`,
    );
  }
  return JSON.parse(
    await readBoundedResponseText(response, PONDER_JSON_MAX_BYTES, "Ponder"),
  ) as T;
}

function parseCandidate(value: unknown): CorrelationRoundCandidate {
  const record = requireRecord(value, "correlation round candidate");
  return {
    domain: parseCandidateDomain(record.domain),
    rewardPoolId: requireNonNegativeBigInt(record.rewardPoolId, "rewardPoolId"),
    contentId: requirePositiveBigInt(record.contentId, "contentId"),
    roundId: requirePositiveBigInt(record.roundId, "roundId"),
  };
}

function parseCandidateDomain(value: unknown) {
  const parsed = parseBigInt(value);
  if (parsed === BigInt(PAYOUT_DOMAIN_PUBLIC_RATING)) {
    return PAYOUT_DOMAIN_PUBLIC_RATING;
  }
  if (parsed === BigInt(PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD)) {
    return PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD;
  }
  return PAYOUT_DOMAIN_QUESTION_REWARD;
}

function parseVote(value: unknown): CorrelationVoteInput {
  const record = requireRecord(value, "correlation vote");
  const account = requireAddress(record.account, "account");
  const identityKey = requireHex(record.identityKey, "identityKey");
  const commitKey = requireHex(record.commitKey, "commitKey");
  const revealWeight = parseBigInt(record.revealWeight);
  const stake = parseBigInt(record.stake);
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
      ? record.features.filter(
          (feature): feature is string => typeof feature === "string",
        )
      : [],
    // Surprise inputs are optional: a missing or malformed value falls back
    // to the neutral surprise multiplier inside the scorer (spec fallback).
    isUp: typeof record.isUp === "boolean" ? record.isUp : null,
    revealWeight:
      revealWeight !== null && revealWeight >= 0n ? revealWeight : null,
    stake: stake !== null && stake >= 0n ? stake : null,
    epochIndex:
      typeof record.epochIndex === "number" &&
      Number.isSafeInteger(record.epochIndex) &&
      record.epochIndex >= 0
        ? record.epochIndex
        : null,
  };
}

function parseExcludedVote(value: unknown): PublicExcludedCorrelationVote {
  const record = requireRecord(value, "excluded correlation vote");
  return {
    account: requireAddress(record.account, "excludedVotes.account"),
    identityKey: requireHex(record.identityKey, "excludedVotes.identityKey"),
    commitKey: requireHex(record.commitKey, "excludedVotes.commitKey"),
    cooldownSeconds: parseNonNegativeNumber(record.cooldownSeconds),
    profileUpdatedAt: parseOptionalString(record.profileUpdatedAt),
    reasons: Array.isArray(record.reasons)
      ? record.reasons
          .filter((reason): reason is string => typeof reason === "string")
          .sort()
      : [],
    roundOpenTime: parseOptionalString(record.roundOpenTime),
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

function emptyQuestionMetadataRef(): PublicQuestionMetadataRef {
  return {
    questionMetadataHash: null,
    questionMetadataUri: null,
    resultSpecHash: null,
    targetAudienceHash: null,
  };
}

function parseRoundContextQuestionMetadataRef(
  value: unknown,
): PublicQuestionMetadataRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyQuestionMetadataRef();
  }
  const raw = (value as Record<string, unknown>).questionMetadataRef;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return emptyQuestionMetadataRef();
  }
  const record = raw as Record<string, unknown>;
  return {
    questionMetadataHash: parseOptionalHex(record.questionMetadataHash),
    questionMetadataUri: parseOptionalString(record.questionMetadataUri),
    resultSpecHash: parseOptionalHex(record.resultSpecHash),
    // Target-audience metadata is not derived from indexed chain events today.
    // Keep it out of correlation artifacts so payout roots stay reproducible.
    targetAudienceHash: null,
  };
}

function parseOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseOptionalHex(value: unknown): Hex | null {
  return typeof value === "string" && HEX32_PATTERN.test(value)
    ? (value.toLowerCase() as Hex)
    : null;
}

function parseNonNegativeNumber(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
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

function requireNonNegativeBigInt(value: unknown, label: string): bigint {
  const parsed = parseBigInt(value);
  if (parsed === null || parsed < 0n) {
    throw new Error(`${label} must be a non-negative integer`);
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
  if (typeof value === "number" && Number.isSafeInteger(value))
    return BigInt(value);
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

function compareCandidates(
  left: CorrelationRoundCandidate,
  right: CorrelationRoundCandidate,
) {
  const roundCompare = bigintCompare(right.roundId, left.roundId);
  if (roundCompare !== 0) return roundCompare;
  const domainCompare = left.domain - right.domain;
  if (domainCompare !== 0) return domainCompare;
  const rewardPoolCompare = bigintCompare(
    left.rewardPoolId,
    right.rewardPoolId,
  );
  if (rewardPoolCompare !== 0) return rewardPoolCompare;
  return bigintCompare(left.contentId, right.contentId);
}
