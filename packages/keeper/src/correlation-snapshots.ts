import { readFile } from "node:fs/promises";
import { PAYOUT_DOMAIN_PUBLIC_RATING } from "@rateloop/node-utils/correlationScoring";
import { verifyCorrelationArtifact } from "./correlation-artifact-verifier.js";
import { resolveAllowedArtifactUri } from "./artifact-uri.js";
import { readBoundedResponseText } from "./bounded-response.js";
import type { Account, Chain, PublicClient, WalletClient } from "viem";
import {
  ClusterPayoutOracleAbi,
  FrontendRegistryAbi,
  QuestionRewardPoolEscrowAbi,
} from "@rateloop/contracts/abis";
import { canonicalJsonHash } from "@rateloop/node-utils/json";
import type { Address, Hex } from "viem";
import { BaseError, ContractFunctionRevertedError, zeroAddress } from "viem";
import type { Logger } from "./logger.js";
import { config } from "./config.js";
import {
  buildConfiguredCorrelationSnapshotArtifactForCandidates,
  correlationSnapshotCandidateFingerprint,
  loadConfiguredCorrelationSnapshotCandidates,
  restoreConfiguredCorrelationSnapshotArtifactFromCanonicalJson,
  type CorrelationRoundCandidate,
} from "./correlation-artifact-builder.js";
import { areCorrelationCandidatesPonderFresh } from "./correlation-ponder-freshness.js";
import {
  readCachedCorrelationArtifact,
  runWithCorrelationSnapshotPublishLock,
  writeCachedCorrelationArtifact,
} from "./keeper-state.js";
import { writeContractAndConfirm } from "./keeper.js";
import { readRoundLifecycleState } from "./contract-reads.js";
import { getRevertReason } from "./revert-utils.js";

interface CorrelationSnapshotPublishOptions {
  ponderNowSeconds?: bigint;
}

const STATUS = {
  None: 0,
  Proposed: 1,
  Challenged: 2,
  Finalized: 3,
  Rejected: 4,
} as const;
const ARTIFACT_FETCH_TIMEOUT_MS = 15_000;
const ARTIFACT_MAX_BYTES = 10_000_000;

interface CorrelationSnapshotPublisherResult {
  epochsProposed: number;
  epochsFinalized: number;
  roundSnapshotsProposed: number;
  roundSnapshotsFinalized: number;
  ratingSnapshotsApplied: number;
}

export interface CorrelationEpochArtifact {
  epochId: string | number | bigint;
  fromRoundId: string | number | bigint;
  toRoundId: string | number | bigint;
  clusterRoot: `0x${string}`;
  parameterHash: `0x${string}`;
  artifactHash: `0x${string}`;
  artifactURI: string;
  sourceRefs?: CorrelationEpochSourceRefArtifact[];
}

export interface CorrelationEpochSourceRefArtifact {
  domain: number;
  rewardPoolId: string | number | bigint;
  contentId: string | number | bigint;
  roundId: string | number | bigint;
}

export interface RoundPayoutSnapshotArtifact
  extends CorrelationEpochSourceRefArtifact {
  correlationEpochId: string | number | bigint;
  rawEligibleVoters: number;
  effectiveParticipantUnits: number;
  totalClaimWeight: string | number | bigint;
  weightRoot: `0x${string}`;
  reasonRoot: `0x${string}`;
  artifactHash: `0x${string}`;
  artifactURI: string;
}

export interface CorrelationSnapshotArtifactFile {
  correlationEpochs?: CorrelationEpochArtifact[];
  roundPayoutSnapshots?: RoundPayoutSnapshotArtifact[];
}

interface PublicRatingPayoutWeight {
  domain?: unknown;
  rewardPoolId?: unknown;
  contentId?: unknown;
  roundId?: unknown;
  commitKey?: unknown;
  identityKey?: unknown;
  account?: unknown;
  baseWeight?: unknown;
  independenceBps?: unknown;
  effectiveWeight?: unknown;
  reasonHash?: unknown;
  proof?: unknown;
}

interface PublicRoundPayoutSnapshotWithWeights {
  domain?: unknown;
  rewardPoolId?: unknown;
  contentId?: unknown;
  roundId?: unknown;
  payoutWeights?: unknown;
}

interface PublicCorrelationArtifactWithWeights {
  roundPayoutSnapshots?: unknown;
}

interface SnapshotProposerAuthorization {
  authorized: boolean;
  frontendOperator?: Address;
}

interface CorrelationEpochSnapshotSummary {
  status: number;
  clusterRoot: `0x${string}` | null;
}

interface RoundPayoutProposalSummary {
  status: number;
  finalizedAt: bigint;
}

interface RoundPayoutSnapshotSource {
  domain: number;
  rewardPoolId: string | number | bigint;
  contentId: string | number | bigint;
  roundId: string | number | bigint;
}

interface AutomaticCorrelationSnapshotPublishContext {
  candidateFingerprint?: `0x${string}`;
  rejectedEpochIds?: ReadonlySet<string>;
}

const rejectedAutomaticCorrelationCandidates = new Set<string>();

function emptyResult(): CorrelationSnapshotPublisherResult {
  return {
    epochsProposed: 0,
    epochsFinalized: 0,
    roundSnapshotsProposed: 0,
    roundSnapshotsFinalized: 0,
    ratingSnapshotsApplied: 0,
  };
}

const ContentRegistryRatingSnapshotAbi = [
  {
    type: "function",
    name: "isRoundPayoutSnapshotConsumed",
    stateMutability: "view",
    inputs: [
      { name: "domain", type: "uint8" },
      { name: "rewardPoolId", type: "uint256" },
      { name: "contentId", type: "uint256" },
      { name: "roundId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "applyRatingPayoutSnapshot",
    stateMutability: "nonpayable",
    inputs: [
      { name: "contentId", type: "uint256" },
      { name: "roundId", type: "uint256" },
      {
        name: "payoutWeights",
        type: "tuple[]",
        components: [
          { name: "domain", type: "uint8" },
          { name: "rewardPoolId", type: "uint256" },
          { name: "contentId", type: "uint256" },
          { name: "roundId", type: "uint256" },
          { name: "commitKey", type: "bytes32" },
          { name: "identityKey", type: "bytes32" },
          { name: "account", type: "address" },
          { name: "baseWeight", type: "uint256" },
          { name: "independenceBps", type: "uint16" },
          { name: "effectiveWeight", type: "uint256" },
          { name: "reasonHash", type: "bytes32" },
        ],
      },
      { name: "proofs", type: "bytes32[][]" },
    ],
    outputs: [],
  },
] as const;

const ClusterPayoutOracleStatusReadAbi = [
  {
    type: "function",
    name: "correlationEpochSnapshot",
    stateMutability: "view",
    inputs: [{ name: "epochId", type: "uint64" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "epochId", type: "uint64" },
          { name: "fromRoundId", type: "uint64" },
          { name: "toRoundId", type: "uint64" },
          { name: "proposedAt", type: "uint64" },
          { name: "challengeWindowAtProposal", type: "uint64" },
          { name: "finalizedAt", type: "uint64" },
          { name: "proposer", type: "address" },
          { name: "frontendOperator", type: "address" },
          { name: "challenger", type: "address" },
          { name: "clusterRoot", type: "bytes32" },
          { name: "parameterHash", type: "bytes32" },
          { name: "artifactHash", type: "bytes32" },
          { name: "artifactURI", type: "string" },
          { name: "status", type: "uint8" },
          { name: "bond", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "roundPayoutProposal",
    stateMutability: "view",
    inputs: [{ name: "snapshotKey", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          {
            name: "snapshot",
            type: "tuple",
            components: [
              { name: "snapshotKey", type: "bytes32" },
              { name: "domain", type: "uint8" },
              { name: "correlationEpochId", type: "uint64" },
              { name: "finalizedAt", type: "uint64" },
              { name: "rawEligibleVoters", type: "uint32" },
              { name: "effectiveParticipantUnits", type: "uint32" },
              { name: "rewardPoolId", type: "uint256" },
              { name: "contentId", type: "uint256" },
              { name: "roundId", type: "uint256" },
              { name: "totalClaimWeight", type: "uint256" },
              { name: "weightRoot", type: "bytes32" },
              { name: "reasonRoot", type: "bytes32" },
              { name: "status", type: "uint8" },
            ],
          },
          { name: "proposedAt", type: "uint64" },
          { name: "challengeWindowAtProposal", type: "uint64" },
          { name: "consumer", type: "address" },
          { name: "proposer", type: "address" },
          { name: "frontendOperator", type: "address" },
          { name: "challenger", type: "address" },
          { name: "artifactHash", type: "bytes32" },
          { name: "artifactURI", type: "string" },
          { name: "bond", type: "uint256" },
        ],
      },
    ],
  },
] as const;

function rejectedAutomaticCorrelationCandidateKey(
  epochId: string,
  candidateFingerprint: `0x${string}`,
): string {
  return `${epochId}:${candidateFingerprint.toLowerCase()}`;
}

function hasRejectedAutomaticCorrelationCandidate(
  epochId: string,
  candidateFingerprint: `0x${string}`,
): boolean {
  return rejectedAutomaticCorrelationCandidates.has(
    rejectedAutomaticCorrelationCandidateKey(epochId, candidateFingerprint),
  );
}

function rememberRejectedAutomaticCorrelationCandidate(
  epochId: string,
  candidateFingerprint: `0x${string}`,
): void {
  rejectedAutomaticCorrelationCandidates.add(
    rejectedAutomaticCorrelationCandidateKey(epochId, candidateFingerprint),
  );
}

function normalizeClusterRoot(clusterRoot: unknown): `0x${string}` | null {
  if (
    typeof clusterRoot === "string" &&
    /^0x[0-9a-f]{64}$/iu.test(clusterRoot)
  ) {
    return clusterRoot.toLowerCase() as `0x${string}`;
  }
  return null;
}

async function readCorrelationEpochSnapshotSummary(
  publicClient: PublicClient,
  epochId: bigint,
): Promise<CorrelationEpochSnapshotSummary> {
  const snapshot = (await publicClient.readContract({
    address: config.contracts.clusterPayoutOracle,
    abi: ClusterPayoutOracleStatusReadAbi,
    functionName: "correlationEpochSnapshot",
    args: [epochId],
  })) as { status?: unknown; clusterRoot?: unknown };

  return {
    status: normalizeNumber(snapshot.status) ?? STATUS.None,
    clusterRoot: normalizeClusterRoot(snapshot.clusterRoot),
  };
}

async function readRoundPayoutSnapshotSummary(
  publicClient: PublicClient,
  source: RoundPayoutSnapshotSource,
): Promise<RoundPayoutProposalSummary> {
  const rewardPoolId = normalizeBigIntValue(source.rewardPoolId);
  const contentId = normalizeBigIntValue(source.contentId);
  const roundId = normalizeBigIntValue(source.roundId);
  if (rewardPoolId === null || contentId === null || roundId === null) {
    throw new Error("Round payout snapshot source contains invalid identifiers");
  }

  try {
    const snapshot = (await publicClient.readContract({
      address: config.contracts.clusterPayoutOracle,
      abi: ClusterPayoutOracleAbi,
      functionName: "getRoundPayoutSnapshot",
      args: [source.domain, rewardPoolId, contentId, roundId],
    })) as { status?: unknown; finalizedAt?: unknown };

    const finalizedAt = snapshot.finalizedAt;
    const finalizedAtValue = normalizeBigIntString(finalizedAt);
    return {
      status: normalizeNumber(snapshot.status) ?? STATUS.None,
      finalizedAt:
        typeof finalizedAt === "bigint"
          ? finalizedAt
          : finalizedAtValue !== null
            ? BigInt(finalizedAtValue)
            : 0n,
    };
  } catch (error) {
    if (isSnapshotNotFoundError(error)) {
      return { status: STATUS.None, finalizedAt: 0n };
    }
    throw error;
  }
}

function artifactSnapshotSource(snapshot: RoundPayoutSnapshotArtifact): RoundPayoutSnapshotSource {
  return {
    domain: snapshot.domain,
    rewardPoolId: snapshot.rewardPoolId,
    contentId: snapshot.contentId,
    roundId: snapshot.roundId,
  };
}

async function readSnapshotProposerAuthorization(
  publicClient: PublicClient,
  account: Account,
  logger: Logger,
): Promise<SnapshotProposerAuthorization> {
  const frontendRegistry = config.correlationSnapshots.frontendRegistry;
  if (!frontendRegistry) {
    logger.warn(
      "Skipping correlation snapshot proposals because no frontend registry is configured",
      {
        snapshotProposer: account.address,
      },
    );
    return { authorized: false };
  }

  try {
    const frontendOperator = (await publicClient.readContract({
      address: frontendRegistry,
      abi: FrontendRegistryAbi,
      functionName: "authorizedSnapshotFrontend",
      args: [account.address],
    })) as Address;
    const authorized = frontendOperator !== zeroAddress;

    const data = {
      snapshotProposer: account.address,
      frontendOperator,
      frontendRegistry,
      eligible: authorized,
    };
    if (authorized) {
      logger.debug(
        "Correlation snapshot proposer authorization confirmed",
        data,
      );
    } else {
      logger.warn(
        "Skipping correlation snapshot proposals because keeper is not authorized by an eligible frontend",
        data,
      );
    }
    return {
      authorized,
      frontendOperator: authorized ? frontendOperator : undefined,
    };
  } catch (error: unknown) {
    logger.warn(
      "Skipping correlation snapshot proposals because frontend proposer authorization could not be read",
      {
        snapshotProposer: account.address,
        frontendRegistry,
        error: getRevertReason(error),
      },
    );
    return { authorized: false };
  }
}

async function loadConfiguredCorrelationSnapshotArtifact(
  logger: Logger,
): Promise<CorrelationSnapshotArtifactFile | null> {
  if (!config.correlationSnapshots.enabled) {
    return null;
  }

  if (config.correlationSnapshots.mode === "auto") {
    const candidates =
      await loadConfiguredCorrelationSnapshotCandidates(logger);
    return (
      await buildConfiguredCorrelationSnapshotArtifactForCandidates(
        candidates,
        logger,
      )
    ).artifact;
  }

  if (!config.correlationSnapshots.artifactPath) {
    return null;
  }

  const canonical = (await readFile(config.correlationSnapshots.artifactPath, "utf8")).trimEnd();
  const verification = verifyCorrelationArtifact(JSON.parse(canonical));
  if (!verification.ok) {
    logger.error("Refusing to publish invalid correlation snapshot artifact file", {
      artifactPath: config.correlationSnapshots.artifactPath,
      errors: verification.errors,
    });
    return null;
  }

  const { artifact } =
    await restoreConfiguredCorrelationSnapshotArtifactFromCanonicalJson(canonical);
  return artifact;
}

async function roundSnapshotSourceReady(
  publicClient: PublicClient,
  snapshot: CorrelationEpochSourceRefArtifact,
  logger: Logger,
): Promise<boolean> {
  try {
    const consumer = (await publicClient.readContract({
      address: config.contracts.clusterPayoutOracle,
      abi: ClusterPayoutOracleAbi,
      functionName: "roundPayoutSnapshotConsumer",
      args: [snapshot.domain],
    })) as Address;
    if (consumer === "0x0000000000000000000000000000000000000000") {
      logger.warn(
        "Skipping round payout snapshot because no consumer is configured",
        {
          domain: snapshot.domain,
          rewardPoolId: snapshot.rewardPoolId.toString(),
          contentId: snapshot.contentId.toString(),
          roundId: snapshot.roundId.toString(),
        },
      );
      return false;
    }

    const sourceReadyAt = (await publicClient.readContract({
      address: consumer,
      abi: QuestionRewardPoolEscrowAbi,
      functionName: "roundPayoutSnapshotSourceReadyAt",
      args: [
        snapshot.domain,
        BigInt(snapshot.rewardPoolId),
        BigInt(snapshot.contentId),
        BigInt(snapshot.roundId),
      ],
    })) as bigint;
    if (sourceReadyAt === 0n) {
      logger.debug("Skipping round payout snapshot until source is ready", {
        domain: snapshot.domain,
        rewardPoolId: snapshot.rewardPoolId.toString(),
        contentId: snapshot.contentId.toString(),
        roundId: snapshot.roundId.toString(),
      });
      return false;
    }

    const block = await publicClient.getBlock();
    if (sourceReadyAt > block.timestamp) {
      logger.debug(
        "Skipping round payout snapshot until source timestamp is reached",
        {
          domain: snapshot.domain,
          rewardPoolId: snapshot.rewardPoolId.toString(),
          contentId: snapshot.contentId.toString(),
          roundId: snapshot.roundId.toString(),
          sourceReadyAt: sourceReadyAt.toString(),
          blockTimestamp: block.timestamp.toString(),
        },
      );
      return false;
    }

    return true;
  } catch (error) {
    logger.warn(
      "Skipping round payout snapshot because source readiness could not be read",
      {
        domain: snapshot.domain,
        rewardPoolId: snapshot.rewardPoolId.toString(),
        contentId: snapshot.contentId.toString(),
        roundId: snapshot.roundId.toString(),
        error: getRevertReason(error),
      },
    );
    return false;
  }
}

async function readPublicCorrelationArtifact(
  snapshot: Pick<RoundPayoutSnapshotArtifact, "artifactHash" | "artifactURI">,
): Promise<PublicCorrelationArtifactWithWeights | null> {
  const canonical = await readArtifactCanonicalJson(snapshot.artifactURI);
  if (!canonical) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonical);
  } catch {
    return null;
  }
  if (canonicalJsonHash(parsed).toLowerCase() !== snapshot.artifactHash.toLowerCase()) {
    return null;
  }
  return parsed && typeof parsed === "object"
    ? (parsed as PublicCorrelationArtifactWithWeights)
    : null;
}

async function readArtifactCanonicalJson(uri: string): Promise<string | null> {
  if (uri.startsWith("data:")) {
    const commaIndex = uri.indexOf(",");
    if (commaIndex < 0) return null;
    const metadata = uri.slice("data:".length, commaIndex);
    const payload = uri.slice(commaIndex + 1);
    if (payload.length > Math.ceil(ARTIFACT_MAX_BYTES / 3) * 4) return null;
    const isBase64 = metadata.split(";").some((part) => part.toLowerCase() === "base64");
    const decoded = isBase64
      ? Buffer.from(payload, "base64").toString("utf8")
      : decodeURIComponent(payload);
    return Buffer.byteLength(decoded, "utf8") <= ARTIFACT_MAX_BYTES ? decoded : null;
  }

  const allowlistCsv = [
    process.env.KEEPER_ARTIFACT_HTTPS_ALLOWLIST?.trim(),
    config.correlationSnapshots.artifactStorage.publicBaseUrl?.trim(),
  ]
    .filter(Boolean)
    .join(",");
  const allowedUri = resolveAllowedArtifactUri(uri, allowlistCsv);
  if (!allowedUri) {
    return null;
  }

  const response = await fetch(allowedUri, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(ARTIFACT_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  try {
    return await readBoundedResponseText(response, ARTIFACT_MAX_BYTES, "Artifact");
  } catch {
    return null;
  }
}

function ratingSnapshotWithWeights(
  artifact: PublicCorrelationArtifactWithWeights,
  snapshot: RoundPayoutSnapshotArtifact,
): PublicRoundPayoutSnapshotWithWeights | null {
  if (!Array.isArray(artifact.roundPayoutSnapshots)) return null;
  return (
    artifact.roundPayoutSnapshots.find((entry): entry is PublicRoundPayoutSnapshotWithWeights => {
      if (!entry || typeof entry !== "object") return false;
      const record = entry as PublicRoundPayoutSnapshotWithWeights;
      return (
        normalizeNumber(record.domain) === PAYOUT_DOMAIN_PUBLIC_RATING &&
        normalizeBigIntString(record.rewardPoolId) === "0" &&
        normalizeBigIntString(record.contentId) === BigInt(snapshot.contentId).toString() &&
        normalizeBigIntString(record.roundId) === BigInt(snapshot.roundId).toString()
      );
    }) ?? null
  );
}

function ratingPayoutWeightArgs(round: PublicRoundPayoutSnapshotWithWeights) {
  if (!Array.isArray(round.payoutWeights)) return null;
  const normalized = round.payoutWeights
    .map((entry) => normalizeRatingPayoutWeight(entry))
    .filter((entry): entry is NonNullable<ReturnType<typeof normalizeRatingPayoutWeight>> => entry !== null)
    .sort((left, right) => left.payoutWeight.commitKey.localeCompare(right.payoutWeight.commitKey));
  if (normalized.length !== round.payoutWeights.length) return null;
  return {
    payoutWeights: normalized.map((entry) => entry.payoutWeight),
    proofs: normalized.map((entry) => entry.proof),
  };
}

function normalizeRatingPayoutWeight(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as PublicRatingPayoutWeight;
  const domain = normalizeNumber(record.domain);
  const rewardPoolId = normalizeBigIntString(record.rewardPoolId);
  const contentId = normalizeBigIntString(record.contentId);
  const roundId = normalizeBigIntString(record.roundId);
  const commitKey = normalizeHex(record.commitKey, 32);
  const identityKey = normalizeHex(record.identityKey, 32);
  const account = normalizeHex(record.account, 20);
  const baseWeight = normalizeBigIntString(record.baseWeight);
  const independenceBps = normalizeNumber(record.independenceBps);
  const effectiveWeight = normalizeBigIntString(record.effectiveWeight);
  const reasonHash = normalizeHex(record.reasonHash, 32);
  const proof = normalizeHexArray(record.proof);
  if (
    domain !== PAYOUT_DOMAIN_PUBLIC_RATING ||
    rewardPoolId !== "0" ||
    contentId === null ||
    roundId === null ||
    commitKey === null ||
    identityKey === null ||
    account === null ||
    baseWeight === null ||
    independenceBps === null ||
    effectiveWeight === null ||
    reasonHash === null ||
    proof === null
  ) {
    return null;
  }
  return {
    payoutWeight: {
      domain,
      rewardPoolId: 0n,
      contentId: BigInt(contentId),
      roundId: BigInt(roundId),
      commitKey,
      identityKey,
      account,
      baseWeight: BigInt(baseWeight),
      independenceBps,
      effectiveWeight: BigInt(effectiveWeight),
      reasonHash,
    },
    proof,
  };
}

function normalizeHex(value: unknown, byteLength: number): Hex | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  return value.length === 2 + byteLength * 2 ? (value as Hex) : null;
}

function normalizeHexArray(value: unknown): Hex[] | null {
  if (!Array.isArray(value)) return null;
  const normalized = value.map((entry) => normalizeHex(entry, 32));
  return normalized.every((entry): entry is Hex => entry !== null) ? normalized : null;
}

function normalizeBigIntString(value: unknown): string | null {
  if (typeof value === "bigint") return value >= 0n ? value.toString() : null;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value.toString();
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  return null;
}

function normalizeBigIntValue(value: unknown): bigint | null {
  const normalized = normalizeBigIntString(value);
  return normalized === null ? null : BigInt(normalized);
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "bigint" && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function isSnapshotNotFoundError(error: unknown): boolean {
  if (error instanceof BaseError) {
    const reverted = error.walk(
      candidate => candidate instanceof ContractFunctionRevertedError,
    ) as ContractFunctionRevertedError | null;
    if (reverted?.data?.errorName === "SnapshotNotFound") return true;
  }

  const candidate = error as { data?: { errorName?: unknown }; message?: unknown; shortMessage?: unknown };
  return (
    candidate?.data?.errorName === "SnapshotNotFound" ||
    (typeof candidate?.message === "string" && candidate.message.includes("SnapshotNotFound")) ||
    (typeof candidate?.shortMessage === "string" && candidate.shortMessage.includes("SnapshotNotFound"))
  );
}

async function applyFinalizedRatingSnapshotsFromArtifact(
  artifact: CorrelationSnapshotArtifactFile,
  publicClient: PublicClient,
  walletClient: WalletClient,
  chain: Chain,
  account: Account,
  logger: Logger,
): Promise<number> {
  let applied = 0;
  const parsedArtifactByHash = new Map<string, PublicCorrelationArtifactWithWeights | null>();
  for (const snapshot of artifact.roundPayoutSnapshots ?? []) {
    if (snapshot.domain !== PAYOUT_DOMAIN_PUBLIC_RATING || BigInt(snapshot.rewardPoolId) !== 0n) continue;

    const snapshotKey = await publicClient.readContract({
      address: config.contracts.clusterPayoutOracle,
      abi: ClusterPayoutOracleAbi,
      functionName: "roundPayoutSnapshotKey",
      args: [snapshot.domain, 0n, BigInt(snapshot.contentId), BigInt(snapshot.roundId)],
    });

    let status: number = STATUS.None;
    let finalizedAt = 0n;
    try {
      const existing = await readRoundPayoutSnapshotSummary(
        publicClient,
        artifactSnapshotSource(snapshot),
      );
      status = existing.status;
      finalizedAt = existing.finalizedAt;
    } catch {
      continue;
    }
    if (status !== STATUS.Finalized) continue;

    const [block, vetoWindow] = await Promise.all([
      publicClient.getBlock(),
      publicClient.readContract({
        address: config.contracts.clusterPayoutOracle,
        abi: ClusterPayoutOracleAbi,
        functionName: "FINALIZATION_VETO_WINDOW",
      }) as Promise<bigint>,
    ]);
    if (block.timestamp <= finalizedAt + vetoWindow) {
      logger.debug("Skipping rating snapshot apply until veto window elapses", {
        snapshotKey,
      });
      continue;
    }

    const lifecycle = await readRoundLifecycleState(
      publicClient,
      config.contracts.votingEngine,
      BigInt(snapshot.contentId),
      BigInt(snapshot.roundId),
    );
    if (lifecycle.cleanupRemaining !== 0n) {
      logger.debug("Skipping rating snapshot apply until cleanup completes", {
        snapshotKey,
        cleanupRemaining: lifecycle.cleanupRemaining.toString(),
      });
      continue;
    }

    const consumed = (await publicClient.readContract({
      address: config.contracts.contentRegistry,
      abi: ContentRegistryRatingSnapshotAbi,
      functionName: "isRoundPayoutSnapshotConsumed",
      args: [PAYOUT_DOMAIN_PUBLIC_RATING, 0n, BigInt(snapshot.contentId), BigInt(snapshot.roundId)],
    })) as boolean;
    if (consumed) continue;

    const artifactKey = snapshot.artifactHash.toLowerCase();
    let publicArtifact = parsedArtifactByHash.get(artifactKey);
    if (publicArtifact === undefined) {
      publicArtifact = await readPublicCorrelationArtifact(snapshot);
      parsedArtifactByHash.set(artifactKey, publicArtifact);
    }
    if (!publicArtifact) {
      logger.warn("Skipping rating snapshot application because artifact could not be read or verified", {
        snapshotKey,
        artifactHash: snapshot.artifactHash,
      });
      continue;
    }

    const publicRound = ratingSnapshotWithWeights(publicArtifact, snapshot);
    const args = publicRound ? ratingPayoutWeightArgs(publicRound) : null;
    if (!args) {
      logger.warn("Skipping rating snapshot application because payout weights are missing or malformed", {
        snapshotKey,
        artifactHash: snapshot.artifactHash,
      });
      continue;
    }

    try {
      await writeContractAndConfirm(publicClient, walletClient, {
        account,
        chain,
        address: config.contracts.contentRegistry,
        abi: ContentRegistryRatingSnapshotAbi,
        functionName: "applyRatingPayoutSnapshot",
        args: [BigInt(snapshot.contentId), BigInt(snapshot.roundId), args.payoutWeights, args.proofs],
      });
      applied += 1;
      logger.info("Applied finalized rating payout snapshot", { snapshotKey });
    } catch (error) {
      logger.debug("Rating payout snapshot not applicable yet", {
        snapshotKey,
        error: getRevertReason(error),
      });
    }
  }
  return applied;
}

async function readyCorrelationEpochSourceRefs(
  publicClient: PublicClient,
  artifact: CorrelationSnapshotArtifactFile,
  epoch: CorrelationEpochArtifact,
  logger: Logger,
) {
  const epochId = BigInt(epoch.epochId);
  const configuredRefs =
    epoch.sourceRefs ??
    (artifact.roundPayoutSnapshots ?? []).filter(
      (snapshot) => BigInt(snapshot.correlationEpochId) === epochId,
    );
  if (configuredRefs.length === 0) {
    logger.warn(
      "Skipping correlation epoch snapshot because no covered sources are listed",
      {
        epochId: epochId.toString(),
      },
    );
    return null;
  }

  const keyedRefs = await Promise.all(
    configuredRefs.map(async (sourceRef) => ({
      sourceRef,
      snapshotKey: (await publicClient.readContract({
        address: config.contracts.clusterPayoutOracle,
        abi: ClusterPayoutOracleAbi,
        functionName: "roundPayoutSnapshotKey",
        args: [
          sourceRef.domain,
          BigInt(sourceRef.rewardPoolId),
          BigInt(sourceRef.contentId),
          BigInt(sourceRef.roundId),
        ],
      })) as `0x${string}`,
    })),
  );
  keyedRefs.sort((left, right) =>
    left.snapshotKey.localeCompare(right.snapshotKey),
  );

  for (let i = 1; i < keyedRefs.length; i += 1) {
    if (keyedRefs[i]!.snapshotKey === keyedRefs[i - 1]!.snapshotKey) {
      logger.warn(
        "Skipping correlation epoch snapshot because covered sources contain a duplicate",
        {
          epochId: epochId.toString(),
          snapshotKey: keyedRefs[i]!.snapshotKey,
        },
      );
      return null;
    }
  }

  const sourceRefs = keyedRefs.map(({ sourceRef }) => ({
    domain: sourceRef.domain,
    rewardPoolId: BigInt(sourceRef.rewardPoolId),
    contentId: BigInt(sourceRef.contentId),
    roundId: BigInt(sourceRef.roundId),
  }));
  for (const sourceRef of sourceRefs) {
    if (!(await roundSnapshotSourceReady(publicClient, sourceRef, logger))) {
      return null;
    }
  }

  return sourceRefs;
}

export async function publishConfiguredCorrelationSnapshots(
  publicClient: PublicClient,
  walletClient: WalletClient,
  chain: Chain,
  account: Account,
  logger: Logger,
  options: CorrelationSnapshotPublishOptions = {},
): Promise<CorrelationSnapshotPublisherResult> {
  return runWithCorrelationSnapshotPublishLock(logger, emptyResult(), () =>
    publishConfiguredCorrelationSnapshotsUnlocked(
      publicClient,
      walletClient,
      chain,
      account,
      logger,
      options,
    ),
  );
}

async function publishConfiguredCorrelationSnapshotsUnlocked(
  publicClient: PublicClient,
  walletClient: WalletClient,
  chain: Chain,
  account: Account,
  logger: Logger,
  options: CorrelationSnapshotPublishOptions = {},
): Promise<CorrelationSnapshotPublisherResult> {
  if (!config.correlationSnapshots.enabled) {
    return emptyResult();
  }

  if (config.correlationSnapshots.mode === "auto") {
    return publishAutomaticCorrelationSnapshots(
      publicClient,
      walletClient,
      chain,
      account,
      logger,
      options,
    );
  }

  const artifact = await loadConfiguredCorrelationSnapshotArtifact(logger);
  return publishCorrelationSnapshotArtifact(
    artifact,
    publicClient,
    walletClient,
    chain,
    account,
    logger,
  );
}

async function publishAutomaticCorrelationSnapshots(
  publicClient: PublicClient,
  walletClient: WalletClient,
  chain: Chain,
  account: Account,
  logger: Logger,
  options: CorrelationSnapshotPublishOptions = {},
): Promise<CorrelationSnapshotPublisherResult> {
  const candidates = await loadConfiguredCorrelationSnapshotCandidates(logger);
  if (candidates.length === 0) {
    return emptyResult();
  }

  const preflight = await preflightAutomaticCorrelationSnapshots(
    candidates,
    publicClient,
    walletClient,
    chain,
    account,
    logger,
  );
  if (!preflight.needsArtifactBuild) {
    return preflight.result;
  }

  if (!(await areCorrelationCandidatesPonderFresh(publicClient, candidates, logger, {
    ponderNowSeconds: options.ponderNowSeconds,
  }))) {
    return preflight.result;
  }

  const fingerprint = correlationSnapshotCandidateFingerprint(candidates);
  const rejectedEpochIds = [...preflight.rejectedEpochIds];
  if (
    rejectedEpochIds.some((epochId) =>
      hasRejectedAutomaticCorrelationCandidate(epochId, fingerprint),
    )
  ) {
    logger.debug(
      "Skipping automatic correlation snapshot build for previously rejected candidate fingerprint",
      {
        candidateFingerprint: fingerprint,
        rejectedEpochIds,
      },
    );
    return preflight.result;
  }

  const cachedArtifact = preflight.hasRejectedRoundSnapshots
    ? null
    : await readCachedCorrelationArtifact(
        fingerprint,
        logger,
      );
  if (preflight.hasRejectedRoundSnapshots) {
    logger.debug(
      "Skipping cached automatic correlation snapshot artifact after rejected round payout snapshot",
      {
        candidateFingerprint: fingerprint,
      },
    );
  }
  let built = cachedArtifact
    ? await restoreConfiguredCorrelationSnapshotArtifactFromCanonicalJson(
        cachedArtifact.canonicalJson,
      )
    : null;
  if (
    cachedArtifact &&
    built?.artifactHash &&
    built.artifactHash !== cachedArtifact.artifactHash
  ) {
    logger.warn(
      "Ignoring cached automatic correlation snapshot artifact with mismatched hash",
      {
        candidateFingerprint: fingerprint,
        cachedArtifactHash: cachedArtifact.artifactHash,
        actualArtifactHash: built.artifactHash,
      },
    );
    built = null;
  }
  if (cachedArtifact && built) {
    logger.debug("Using cached automatic correlation snapshot artifact", {
      candidateFingerprint: fingerprint,
      artifactHash: built.artifactHash,
      roundSnapshotCount: built.roundSnapshotCount,
      epochCount: built.epochCount,
      canonicalBytes: built.canonicalBytes,
    });
  }
  if (!built) {
    built = await buildConfiguredCorrelationSnapshotArtifactForCandidates(
      candidates,
      logger,
      { ponderNowSeconds: options.ponderNowSeconds },
    );
  }
  if (
    (!cachedArtifact || cachedArtifact.artifactHash !== built.artifactHash) &&
    built.artifactHash &&
    built.canonicalJson
  ) {
    await writeCachedCorrelationArtifact({
      fingerprint,
      artifactHash: built.artifactHash,
      canonicalJson: built.canonicalJson,
      candidateCount: candidates.length,
      roundSnapshotCount: built.roundSnapshotCount,
      epochCount: built.epochCount,
      logger,
    });
  }

  return publishCorrelationSnapshotArtifact(
    built.artifact,
    publicClient,
    walletClient,
    chain,
    account,
    logger,
    preflight.result,
    {
      candidateFingerprint: fingerprint,
      rejectedEpochIds: preflight.rejectedEpochIds,
    },
  );
}

async function preflightAutomaticCorrelationSnapshots(
  candidates: readonly CorrelationRoundCandidate[],
  publicClient: PublicClient,
  walletClient: WalletClient,
  chain: Chain,
  account: Account,
  logger: Logger,
): Promise<{
  result: CorrelationSnapshotPublisherResult;
  needsArtifactBuild: boolean;
  rejectedEpochIds: Set<string>;
  hasRejectedRoundSnapshots: boolean;
}> {
  const result = emptyResult();
  let needsArtifactBuild = false;
  let hasRejectedRoundSnapshots = false;
  const rejectedEpochIds = new Set<string>();
  const epochFinalizedById = new Map<string, boolean>();

  for (const candidate of candidates) {
    const epochId = candidate.roundId;
    const epochKey = epochId.toString();
    let epochFinalized = epochFinalizedById.get(epochKey);

    if (epochFinalized === undefined) {
      const existingEpoch = await readCorrelationEpochSnapshotSummary(
        publicClient,
        epochId,
      );
      const epochStatus = existingEpoch.status;
      epochFinalized = epochStatus === STATUS.Finalized;

      if (epochStatus === STATUS.None || epochStatus === STATUS.Rejected) {
        if (epochStatus === STATUS.Rejected) {
          rejectedEpochIds.add(epochKey);
        }
        needsArtifactBuild = true;
        epochFinalizedById.set(epochKey, false);
        continue;
      }

      if (epochStatus === STATUS.Proposed) {
        try {
          await writeContractAndConfirm(publicClient, walletClient, {
            account,
            chain,
            address: config.contracts.clusterPayoutOracle,
            abi: ClusterPayoutOracleAbi,
            functionName: "finalizeCorrelationEpoch",
            args: [epochId],
          });
          result.epochsFinalized += 1;
          epochFinalized = true;
          logger.info("Finalized correlation epoch snapshot", {
            epochId: epochId.toString(),
          });
        } catch (error) {
          logger.debug("Correlation epoch snapshot not finalizable yet", {
            epochId: epochId.toString(),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } else if (epochStatus === STATUS.Challenged) {
        logger.debug("Skipping challenged correlation epoch snapshot", {
          epochId: epochId.toString(),
        });
      }

      epochFinalizedById.set(epochKey, epochFinalized);
    }

    if (!epochFinalized) {
      continue;
    }

    const snapshotKey = await publicClient.readContract({
      address: config.contracts.clusterPayoutOracle,
      abi: ClusterPayoutOracleAbi,
      functionName: "roundPayoutSnapshotKey",
      args: [
        candidate.domain,
        candidate.rewardPoolId,
        candidate.contentId,
        candidate.roundId,
      ],
    });

    const existingRound = await readRoundPayoutSnapshotSummary(
      publicClient,
      candidate,
    );
    const roundStatus = existingRound.status;

    if (roundStatus === STATUS.None || roundStatus === STATUS.Rejected) {
      if (roundStatus === STATUS.Rejected) {
        hasRejectedRoundSnapshots = true;
      }
      if (
        await roundSnapshotSourceReady(
          publicClient,
          {
            domain: candidate.domain,
            rewardPoolId: candidate.rewardPoolId,
            contentId: candidate.contentId,
            roundId: candidate.roundId,
          } as RoundPayoutSnapshotArtifact,
          logger,
        )
      ) {
        needsArtifactBuild = true;
      }
    } else if (roundStatus === STATUS.Proposed) {
      try {
        await writeContractAndConfirm(publicClient, walletClient, {
          account,
          chain,
          address: config.contracts.clusterPayoutOracle,
          abi: ClusterPayoutOracleAbi,
          functionName: "finalizeRoundPayoutSnapshot",
          args: [snapshotKey],
        });
        result.roundSnapshotsFinalized += 1;
        if (candidate.domain === PAYOUT_DOMAIN_PUBLIC_RATING) {
          needsArtifactBuild = true;
        }
        logger.info("Finalized round payout snapshot", { snapshotKey });
      } catch (error) {
        logger.debug("Round payout snapshot not finalizable yet", {
          snapshotKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else if (roundStatus === STATUS.Challenged) {
      logger.debug("Skipping challenged round payout snapshot", {
        snapshotKey,
      });
    } else if (roundStatus === STATUS.Finalized && candidate.domain === PAYOUT_DOMAIN_PUBLIC_RATING) {
      needsArtifactBuild = true;
    }
  }

  return { result, needsArtifactBuild, rejectedEpochIds, hasRejectedRoundSnapshots };
}

async function publishCorrelationSnapshotArtifact(
  artifact: CorrelationSnapshotArtifactFile | null,
  publicClient: PublicClient,
  walletClient: WalletClient,
  chain: Chain,
  account: Account,
  logger: Logger,
  initialResult: CorrelationSnapshotPublisherResult = emptyResult(),
  automaticContext: AutomaticCorrelationSnapshotPublishContext = {},
): Promise<CorrelationSnapshotPublisherResult> {
  if (!artifact) {
    return emptyResult();
  }

  const result = { ...initialResult };
  if (
    (artifact.correlationEpochs ?? []).length === 0 &&
    (artifact.roundPayoutSnapshots ?? []).length === 0
  ) {
    return result;
  }

  let snapshotProposerAuthorization: SnapshotProposerAuthorization | null =
    null;
  async function getSnapshotProposerAuthorization() {
    snapshotProposerAuthorization ??= await readSnapshotProposerAuthorization(
      publicClient,
      account,
      logger,
    );
    return snapshotProposerAuthorization;
  }
  const coveredEpochIds = new Set<string>();

  for (const epoch of artifact.correlationEpochs ?? []) {
    const epochId = BigInt(epoch.epochId);
    const existing = await readCorrelationEpochSnapshotSummary(
      publicClient,
      epochId,
    );
    const status = existing.status;
    if (status === STATUS.None || status === STATUS.Rejected) {
      if (status === STATUS.Rejected && automaticContext.candidateFingerprint) {
        const rejectedEpochId = epochId.toString();
        if (
          automaticContext.rejectedEpochIds?.has(rejectedEpochId) &&
          existing.clusterRoot === epoch.clusterRoot.toLowerCase()
        ) {
          rememberRejectedAutomaticCorrelationCandidate(
            rejectedEpochId,
            automaticContext.candidateFingerprint,
          );
          logger.debug(
            "Skipping automatic correlation epoch proposal for rejected cluster root",
            {
              epochId: rejectedEpochId,
              clusterRoot: epoch.clusterRoot,
              candidateFingerprint: automaticContext.candidateFingerprint,
            },
          );
          continue;
        }
      }

      const proposerAuthorization = await getSnapshotProposerAuthorization();
      if (!proposerAuthorization.authorized) {
        logger.debug(
          "Skipping correlation epoch proposal until keeper is authorized by an eligible frontend",
          {
            epochId: epochId.toString(),
            snapshotProposer: account.address,
            frontendOperator: proposerAuthorization.frontendOperator,
          },
        );
        continue;
      }

      const sourceRefs = await readyCorrelationEpochSourceRefs(
        publicClient,
        artifact,
        epoch,
        logger,
      );
      if (!sourceRefs) {
        continue;
      }

      try {
        await writeContractAndConfirm(publicClient, walletClient, {
          account,
          chain,
          address: config.contracts.clusterPayoutOracle,
          abi: ClusterPayoutOracleAbi,
          functionName: "proposeCorrelationEpoch",
          args: [
            epochId,
            BigInt(epoch.fromRoundId),
            BigInt(epoch.toRoundId),
            epoch.clusterRoot,
            epoch.parameterHash,
            epoch.artifactHash,
            epoch.artifactURI,
            sourceRefs,
          ],
        });
        result.epochsProposed += 1;
        coveredEpochIds.add(epochId.toString());
        logger.info("Proposed correlation epoch snapshot", {
          epochId: epochId.toString(),
        });
      } catch (error) {
        logger.warn("Correlation epoch snapshot proposal failed", {
          epochId: epochId.toString(),
          error: getRevertReason(error),
        });
      }
    } else if (status === STATUS.Proposed) {
      coveredEpochIds.add(epochId.toString());
      try {
        await writeContractAndConfirm(publicClient, walletClient, {
          account,
          chain,
          address: config.contracts.clusterPayoutOracle,
          abi: ClusterPayoutOracleAbi,
          functionName: "finalizeCorrelationEpoch",
          args: [epochId],
        });
        result.epochsFinalized += 1;
        logger.info("Finalized correlation epoch snapshot", {
          epochId: epochId.toString(),
        });
      } catch (error) {
        logger.debug("Correlation epoch snapshot not finalizable yet", {
          epochId: epochId.toString(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else if (status === STATUS.Finalized) {
      coveredEpochIds.add(epochId.toString());
    } else if (status === STATUS.Challenged) {
      logger.debug("Skipping challenged correlation epoch snapshot", {
        epochId: epochId.toString(),
      });
    }
  }

  for (const snapshot of artifact.roundPayoutSnapshots ?? []) {
    const correlationEpochId = BigInt(snapshot.correlationEpochId);
    if (!coveredEpochIds.has(correlationEpochId.toString())) {
      logger.debug(
        "Skipping round payout snapshot until correlation epoch is proposed",
        {
          correlationEpochId: correlationEpochId.toString(),
          rewardPoolId: snapshot.rewardPoolId.toString(),
          contentId: snapshot.contentId.toString(),
          roundId: snapshot.roundId.toString(),
        },
      );
      continue;
    }

    const snapshotKey = await publicClient.readContract({
      address: config.contracts.clusterPayoutOracle,
      abi: ClusterPayoutOracleAbi,
      functionName: "roundPayoutSnapshotKey",
      args: [
        snapshot.domain,
        BigInt(snapshot.rewardPoolId),
        BigInt(snapshot.contentId),
        BigInt(snapshot.roundId),
      ],
    });

    let status: number = STATUS.None;
    try {
      const existing = await readRoundPayoutSnapshotSummary(
        publicClient,
        artifactSnapshotSource(snapshot),
      );
      status = existing.status;
    } catch (error) {
      logger.warn("Skipping round payout snapshot because status could not be read", {
        snapshotKey,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (status === STATUS.None || status === STATUS.Rejected) {
      const proposerAuthorization = await getSnapshotProposerAuthorization();
      if (!proposerAuthorization.authorized) {
        logger.debug(
          "Skipping round payout snapshot proposal until keeper is authorized by an eligible frontend",
          {
            snapshotKey,
            snapshotProposer: account.address,
            frontendOperator: proposerAuthorization.frontendOperator,
          },
        );
        continue;
      }

      if (!(await roundSnapshotSourceReady(publicClient, snapshot, logger))) {
        continue;
      }

      try {
        await writeContractAndConfirm(publicClient, walletClient, {
          account,
          chain,
          address: config.contracts.clusterPayoutOracle,
          abi: ClusterPayoutOracleAbi,
          functionName: "proposeRoundPayoutSnapshot",
          args: [
            {
              domain: snapshot.domain,
              rewardPoolId: BigInt(snapshot.rewardPoolId),
              contentId: BigInt(snapshot.contentId),
              roundId: BigInt(snapshot.roundId),
              correlationEpochId,
              rawEligibleVoters: snapshot.rawEligibleVoters,
              effectiveParticipantUnits: snapshot.effectiveParticipantUnits,
              totalClaimWeight: BigInt(snapshot.totalClaimWeight),
              weightRoot: snapshot.weightRoot,
              reasonRoot: snapshot.reasonRoot,
              artifactHash: snapshot.artifactHash,
              artifactURI: snapshot.artifactURI,
            },
          ],
        });
        result.roundSnapshotsProposed += 1;
        logger.info("Proposed round payout snapshot", { snapshotKey });
      } catch (error) {
        logger.warn("Round payout snapshot proposal failed", {
          snapshotKey,
          error: getRevertReason(error),
        });
      }
    } else if (status === STATUS.Proposed) {
      try {
        await writeContractAndConfirm(publicClient, walletClient, {
          account,
          chain,
          address: config.contracts.clusterPayoutOracle,
          abi: ClusterPayoutOracleAbi,
          functionName: "finalizeRoundPayoutSnapshot",
          args: [snapshotKey],
        });
        result.roundSnapshotsFinalized += 1;
        logger.info("Finalized round payout snapshot", { snapshotKey });
      } catch (error) {
        logger.debug("Round payout snapshot not finalizable yet", {
          snapshotKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else if (status === STATUS.Challenged) {
      logger.debug("Skipping challenged round payout snapshot", {
        snapshotKey,
      });
    }
  }

  result.ratingSnapshotsApplied += await applyFinalizedRatingSnapshotsFromArtifact(
    artifact,
    publicClient,
    walletClient,
    chain,
    account,
    logger,
  );

  return result;
}
