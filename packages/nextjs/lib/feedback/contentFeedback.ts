import deployedContracts from "@rateloop/contracts/deployedContracts";
import { ROUND_STATE, type RoundState } from "@rateloop/contracts/protocol";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { type Abi, type Address, createPublicClient, getAddress, http, isAddress, zeroHash } from "viem";
import { db } from "~~/lib/db";
import { contentFeedback } from "~~/lib/db/schema";
import { getPrimaryServerTargetNetwork, getServerRpcOverrides, getServerTargetNetworkById } from "~~/lib/env/server";
import {
  type ContentFeedbackHashInput,
  type ContentFeedbackHashMetadata,
  buildContentFeedbackHash,
} from "~~/lib/feedback/feedbackHash";
import { isBlockedFeedbackSourceUrl, normalizeFeedbackSourceUrl } from "~~/lib/feedback/sourceUrl";
import {
  CONTENT_FEEDBACK_BODY_MAX_LENGTH,
  CONTENT_FEEDBACK_TYPES,
  CONTENT_FEEDBACK_TYPE_LABELS,
  type ContentFeedbackBonusAward,
  type ContentFeedbackBonusPool,
  type ContentFeedbackItem,
  type ContentFeedbackListResult,
  type ContentFeedbackType,
} from "~~/lib/feedback/types";
import { type ProtocolDeploymentScope, resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";
import { isValidWalletAddress, normalizeContentId, normalizeWalletAddress } from "~~/lib/watchlist/contentWatch";
import {
  type PonderContentFeedbackItem,
  type PonderFeedbackBonusAward,
  type PonderFeedbackBonusPool,
  isPonderConfigured,
  ponderApi,
} from "~~/services/ponder/client";
import { containsBlockedText } from "~~/utils/contentFilter";

const CONTENT_FEEDBACK_LIST_LIMIT = 100;
const APPROVED_MODERATION_STATUS = "approved";

export interface NormalizedContentFeedbackInput {
  normalizedAddress: `0x${string}`;
  contentId: string;
  feedbackType: ContentFeedbackType;
  body: string;
  sourceUrl: string | null;
}

export interface ContentFeedbackDeploymentIdentity {
  deploymentKey: string;
  contentRegistryAddress: `0x${string}`;
  feedbackRegistryAddress: `0x${string}`;
}

export interface ContentFeedbackChallengePayload
  extends NormalizedContentFeedbackInput,
    ContentFeedbackHashMetadata,
    ContentFeedbackDeploymentIdentity {}

export interface PreparedContentFeedbackInput extends ContentFeedbackChallengePayload {
  commitKey: `0x${string}`;
  payloadSignature: `0x${string}`;
  publicationTxHash?: `0x${string}` | null;
}

export interface NormalizedContentFeedbackListInput {
  contentId: string;
  normalizedAddress: `0x${string}` | null;
}

export interface ContentFeedbackRoundContext {
  openRoundId: string | null;
  currentRoundId: string | null;
  terminalRoundIds: Set<string>;
  settlementComplete: boolean;
}

type FeedbackRow = typeof contentFeedback.$inferSelect;
type FeedbackVoteEligibilityParams = {
  contentId: string;
  roundId: string;
  address: `0x${string}`;
  chainId?: number;
};
type FeedbackPublicationParams = FeedbackVoteEligibilityParams & {
  commitKey: `0x${string}`;
  feedbackHash: `0x${string}`;
};
type DeployedContractRecord = {
  address: Address;
  abi: Abi;
};
type FeedbackRegistryRecordResult =
  | readonly [`0x${string}`, `0x${string}`, bigint | number, bigint | number, `0x${string}`]
  | {
      feedbackHash?: `0x${string}`;
      author?: `0x${string}`;
      committedAt?: bigint | number;
      revealedAt?: bigint | number;
      votingEngineSnapshot?: `0x${string}`;
    };
type DeployedContractsMap = Record<number, Record<string, DeployedContractRecord>>;
type FeedbackVoteEligibilityTestOverrides = {
  getAllRounds?: typeof ponderApi.getAllRounds;
  getContentById?: typeof ponderApi.getContentById;
  getContentFeedback?: typeof ponderApi.getContentFeedback;
  getFeedbackBonusAwards?: typeof ponderApi.getFeedbackBonusAwards;
  getFeedbackBonusPools?: typeof ponderApi.getFeedbackBonusPools;
  getVotes?: typeof ponderApi.getVotes;
  hasOnchainFeedbackEligibleVote?: (params: FeedbackVoteEligibilityParams) => Promise<boolean>;
  isFeedbackRaterIdentityBanned?: (params: FeedbackVoteEligibilityParams) => Promise<boolean>;
  resolveOnchainOpenRoundId?: (params: { contentId: string; chainId?: number }) => Promise<string | null>;
};

let feedbackVoteEligibilityTestOverrides: FeedbackVoteEligibilityTestOverrides | null = null;

export class ContentFeedbackStorageUnavailableError extends Error {
  constructor() {
    super("CONTENT_FEEDBACK_STORAGE_UNAVAILABLE");
    this.name = "ContentFeedbackStorageUnavailableError";
  }
}

export class ContentFeedbackDuplicateError extends Error {
  constructor() {
    super("CONTENT_FEEDBACK_DUPLICATE");
    this.name = "ContentFeedbackDuplicateError";
  }
}

export class ContentFeedbackVoterEligibilityError extends Error {
  constructor(message = "CONTENT_FEEDBACK_VOTER_REQUIRED") {
    super(message);
    this.name = "ContentFeedbackVoterEligibilityError";
  }
}

export class ContentFeedbackPublicationMissingError extends Error {
  constructor(message = "CONTENT_FEEDBACK_PUBLICATION_MISSING") {
    super(message);
    this.name = "ContentFeedbackPublicationMissingError";
  }
}

export class ContentFeedbackDeploymentUnavailableError extends Error {
  constructor() {
    super("CONTENT_FEEDBACK_DEPLOYMENT_UNAVAILABLE");
    this.name = "ContentFeedbackDeploymentUnavailableError";
  }
}

function isContentFeedbackStorageUnavailableError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as { code?: unknown; message?: unknown };
  if (
    maybeError.code === "42P01" &&
    typeof maybeError.message === "string" &&
    maybeError.message.includes("content_feedback")
  ) {
    return true;
  }

  const cause = (error as { cause?: unknown }).cause;
  return depth < 3 && cause !== undefined ? isContentFeedbackStorageUnavailableError(cause, depth + 1) : false;
}

function isContentFeedbackDuplicateStorageError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as { code?: unknown; constraint?: unknown; message?: unknown };
  if (maybeError.code === "23505") {
    const constraint = typeof maybeError.constraint === "string" ? maybeError.constraint : "";
    const message = typeof maybeError.message === "string" ? maybeError.message : "";
    return (
      constraint === "content_feedback_feedback_hash_unique" ||
      constraint === "content_feedback_active_author_round_unique" ||
      constraint === "content_feedback_deployment_feedback_hash_unique" ||
      constraint === "content_feedback_deployment_active_author_round_unique" ||
      message.includes("content_feedback_feedback_hash_unique") ||
      message.includes("content_feedback_active_author_round_unique") ||
      message.includes("content_feedback_deployment_feedback_hash_unique") ||
      message.includes("content_feedback_deployment_active_author_round_unique") ||
      message.includes("duplicate key value")
    );
  }

  const cause = (error as { cause?: unknown }).cause;
  return depth < 3 && cause !== undefined ? isContentFeedbackDuplicateStorageError(cause, depth + 1) : false;
}

function isContentFeedbackType(value: string): value is ContentFeedbackType {
  return CONTENT_FEEDBACK_TYPES.includes(value as ContentFeedbackType);
}

function normalizeFeedbackType(value: unknown): ContentFeedbackType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isContentFeedbackType(normalized) ? normalized : null;
}

function normalizeFeedbackBody(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (normalized.length < 4 || normalized.length > CONTENT_FEEDBACK_BODY_MAX_LENGTH) {
    return null;
  }
  return normalized;
}

function normalizeBytes32Hex(value: unknown): `0x${string}` | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return /^0x[0-9a-f]{64}$/.test(trimmed) ? (trimmed as `0x${string}`) : null;
}

export function normalizeContentFeedbackCommitKey(value: unknown): `0x${string}` | null {
  return normalizeBytes32Hex(value);
}

export function normalizeContentFeedbackTxHash(value: unknown): `0x${string}` | null {
  return normalizeBytes32Hex(value);
}

export function normalizeContentFeedbackInput(input: {
  address?: string;
  contentId?: unknown;
  feedbackType?: unknown;
  body?: unknown;
  sourceUrl?: unknown;
}): { ok: true; payload: NormalizedContentFeedbackInput } | { ok: false; error: string } {
  if (!input.address || !isValidWalletAddress(input.address)) {
    return { ok: false, error: "Invalid wallet address" };
  }

  const contentId = normalizeContentId(input.contentId);
  if (!contentId) {
    return { ok: false, error: "Missing or invalid contentId" };
  }

  const feedbackType = normalizeFeedbackType(input.feedbackType);
  if (!feedbackType) {
    return { ok: false, error: "Choose a feedback type" };
  }

  const body = normalizeFeedbackBody(input.body);
  if (!body) {
    return {
      ok: false,
      error: `Feedback must be between 4 and ${CONTENT_FEEDBACK_BODY_MAX_LENGTH} characters`,
    };
  }
  if (containsBlockedText(body).blocked) {
    return { ok: false, error: "Feedback contains blocked content" };
  }

  const sourceUrl = normalizeFeedbackSourceUrl(input.sourceUrl);
  if (sourceUrl === undefined) {
    return { ok: false, error: "Source URL must be a valid HTTPS URL" };
  }
  if (sourceUrl && isBlockedFeedbackSourceUrl(sourceUrl)) {
    return { ok: false, error: "Source URL is blocked by this frontend" };
  }

  return {
    ok: true,
    payload: {
      normalizedAddress: normalizeWalletAddress(input.address),
      contentId,
      feedbackType,
      body,
      sourceUrl,
    },
  };
}

export function normalizeContentFeedbackListInput(input: {
  address?: string | null;
  contentId?: unknown;
}): { ok: true; payload: NormalizedContentFeedbackListInput } | { ok: false; error: string } {
  const contentId = normalizeContentId(input.contentId);
  if (!contentId) {
    return { ok: false, error: "Missing or invalid contentId" };
  }

  if (input.address === undefined || input.address === null || input.address === "") {
    return { ok: true, payload: { contentId, normalizedAddress: null } };
  }

  if (!isValidWalletAddress(input.address)) {
    return { ok: false, error: "Invalid wallet address" };
  }

  return {
    ok: true,
    payload: {
      contentId,
      normalizedAddress: normalizeWalletAddress(input.address),
    },
  };
}

export function normalizeContentFeedbackCountsInput(value: unknown): string[] {
  if (typeof value !== "string") return [];

  const seen = new Set<string>();
  for (const part of value.split(",")) {
    const contentId = normalizeContentId(part);
    if (contentId) {
      seen.add(contentId);
    }
    if (seen.size >= 100) break;
  }

  return Array.from(seen);
}

export function normalizeOptionalContentFeedbackChainId(
  value: unknown,
): { ok: true; chainId: number | undefined } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, chainId: undefined };
  }

  const raw =
    typeof value === "number" || typeof value === "bigint"
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  if (!/^\d+$/.test(raw)) {
    return { ok: false, error: "Missing or unsupported chainId" };
  }

  const chainId = Number(raw);
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || !getServerTargetNetworkById(chainId)) {
    return { ok: false, error: "Missing or unsupported chainId" };
  }

  return { ok: true, chainId };
}

function createContentFeedbackTimestamp(nowMs = Date.now()): Date {
  return new Date(Math.floor(nowMs / 1000) * 1000);
}

export function resolveContentFeedbackDeploymentScope(chainId?: number): ProtocolDeploymentScope | null {
  const targetNetwork =
    typeof chainId === "number" ? getServerTargetNetworkById(chainId) : getPrimaryServerTargetNetwork();
  if (!targetNetwork) {
    return null;
  }

  return resolveProtocolDeploymentScope(targetNetwork.id);
}

function requireContentFeedbackDeploymentScope(chainId?: number, scope?: ProtocolDeploymentScope) {
  if (scope) return scope;

  const resolvedScope = resolveContentFeedbackDeploymentScope(chainId);
  if (!resolvedScope) {
    throw new ContentFeedbackDeploymentUnavailableError();
  }

  return resolvedScope;
}

function isTerminalRoundState(state: unknown): state is Exclude<RoundState, typeof ROUND_STATE.Open> {
  return (
    state === ROUND_STATE.Settled ||
    state === ROUND_STATE.Cancelled ||
    state === ROUND_STATE.Tied ||
    state === ROUND_STATE.RevealFailed
  );
}

export function buildContentFeedbackRoundContext(
  rounds: Array<{ roundId?: string | number | bigint | null; state?: unknown }>,
  openRoundId?: string | number | bigint | null,
): ContentFeedbackRoundContext {
  const normalizedOpenRoundId = openRoundId !== undefined && openRoundId !== null ? String(openRoundId) : null;
  let latestRoundId: string | null = null;
  const terminalRoundIds = new Set<string>();

  for (const round of rounds) {
    if (round.roundId === undefined || round.roundId === null) continue;
    const roundId = String(round.roundId);
    if (latestRoundId === null || BigInt(roundId) > BigInt(latestRoundId)) {
      latestRoundId = roundId;
    }
    if (isTerminalRoundState(round.state)) {
      terminalRoundIds.add(roundId);
    }
  }

  const openRoundFromRows =
    normalizedOpenRoundId ??
    rounds.find(round => round.state === ROUND_STATE.Open && round.roundId !== undefined && round.roundId !== null)
      ?.roundId;
  const resolvedOpenRoundId =
    openRoundFromRows !== undefined && openRoundFromRows !== null ? String(openRoundFromRows) : null;

  return {
    openRoundId: resolvedOpenRoundId,
    currentRoundId: resolvedOpenRoundId ?? latestRoundId,
    terminalRoundIds,
    settlementComplete: resolvedOpenRoundId === null && terminalRoundIds.size > 0,
  };
}

function getRoundState(rawRound: unknown): number | null {
  if (Array.isArray(rawRound)) {
    return toFiniteNumber(rawRound[1]);
  }
  if (rawRound && typeof rawRound === "object" && "state" in rawRound) {
    return toFiniteNumber((rawRound as { state?: unknown }).state);
  }
  return null;
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function resolveOnchainOpenRoundId(contentId: string, chainId?: number): Promise<string | null> {
  const override = feedbackVoteEligibilityTestOverrides?.resolveOnchainOpenRoundId;
  if (override) {
    return override({ contentId, chainId });
  }

  const context = resolveFeedbackVoteReadContext(chainId);
  if (!context?.votingEngine) {
    return null;
  }

  try {
    const contentIdBigInt = BigInt(contentId);
    const roundId = (await context.publicClient.readContract({
      address: context.votingEngine.address,
      abi: context.votingEngine.abi,
      functionName: "currentRoundId",
      args: [contentIdBigInt],
    })) as bigint;

    if (roundId <= 0n) {
      return null;
    }

    const round = await context.publicClient.readContract({
      address: context.votingEngine.address,
      abi: context.votingEngine.abi,
      functionName: "roundCore",
      args: [contentIdBigInt, roundId],
    });

    return getRoundState(round) === ROUND_STATE.Open ? roundId.toString() : null;
  } catch (error) {
    console.warn("[content-feedback] Unable to resolve open round on-chain.", {
      chainId,
      contentId,
      error,
    });
    return null;
  }
}

export async function resolveContentFeedbackRoundContext(
  contentId: string,
  chainId?: number,
): Promise<ContentFeedbackRoundContext> {
  const deployment = resolveContentFeedbackDeploymentScope(chainId);
  const ponderOptions = {
    chainId: deployment?.chainId ?? chainId,
    deploymentKey: deployment?.deploymentKey,
  };
  const [contentResult, roundsResult] = await Promise.allSettled([
    (feedbackVoteEligibilityTestOverrides?.getContentById ?? ponderApi.getContentById)(contentId, ponderOptions),
    (feedbackVoteEligibilityTestOverrides?.getAllRounds ?? ponderApi.getAllRounds)({ contentId }, ponderOptions),
  ]);
  const contentResponse = contentResult.status === "fulfilled" ? contentResult.value : null;
  const rounds =
    roundsResult.status === "fulfilled"
      ? roundsResult.value
      : Array.isArray(contentResponse?.rounds)
        ? contentResponse.rounds
        : [];

  if (contentResult.status === "rejected" || roundsResult.status === "rejected") {
    console.warn("[content-feedback] Unable to resolve complete round context from ponder.", {
      chainId,
      contentId,
      contentError: contentResult.status === "rejected" ? contentResult.reason : undefined,
      roundsError: roundsResult.status === "rejected" ? roundsResult.reason : undefined,
    });
  }

  const context = buildContentFeedbackRoundContext(rounds, contentResponse?.content?.openRound?.roundId ?? null);
  if (context.openRoundId) {
    return context;
  }

  const onchainOpenRoundId = await resolveOnchainOpenRoundId(contentId, chainId);
  return onchainOpenRoundId ? buildContentFeedbackRoundContext(rounds, onchainOpenRoundId) : context;
}

export function buildPreparedContentFeedbackInput(
  payload: NormalizedContentFeedbackInput,
  params: Omit<ContentFeedbackHashInput, "contentId" | "authorAddress" | "feedbackType" | "body" | "sourceUrl"> & {
    commitKey: `0x${string}`;
    deployment?: ProtocolDeploymentScope;
    feedbackHash?: `0x${string}`;
    payloadSignature: `0x${string}`;
    publicationTxHash?: `0x${string}` | null;
  },
): PreparedContentFeedbackInput {
  return {
    ...buildContentFeedbackChallengePayload(payload, params),
    commitKey: params.commitKey,
    payloadSignature: params.payloadSignature,
    publicationTxHash: params.publicationTxHash ?? null,
  };
}

export function buildContentFeedbackChallengePayload(
  payload: NormalizedContentFeedbackInput,
  params: Omit<ContentFeedbackHashInput, "contentId" | "authorAddress" | "feedbackType" | "body" | "sourceUrl"> & {
    deployment?: ProtocolDeploymentScope;
    feedbackHash?: `0x${string}`;
  },
): ContentFeedbackChallengePayload {
  const deployment = requireContentFeedbackDeploymentScope(params.chainId, params.deployment);
  const expectedHash = buildContentFeedbackHash({
    chainId: params.chainId,
    contentId: payload.contentId,
    roundId: params.roundId,
    authorAddress: payload.normalizedAddress,
    feedbackType: payload.feedbackType,
    body: payload.body,
    sourceUrl: payload.sourceUrl,
    clientNonce: params.clientNonce,
  });
  const feedbackHash = (params.feedbackHash ?? expectedHash).toLowerCase() as `0x${string}`;
  if (feedbackHash !== expectedHash) {
    throw new Error("CONTENT_FEEDBACK_HASH_MISMATCH");
  }

  return {
    ...payload,
    chainId: params.chainId,
    roundId: params.roundId,
    clientNonce: params.clientNonce,
    feedbackHash,
    deploymentKey: deployment.deploymentKey,
    contentRegistryAddress: deployment.contentRegistryAddress,
    feedbackRegistryAddress: deployment.feedbackRegistryAddress,
  };
}

function resolveFeedbackVoteReadContext(chainId?: number) {
  const targetNetwork =
    typeof chainId === "number" ? getServerTargetNetworkById(chainId) : getPrimaryServerTargetNetwork();
  if (!targetNetwork) {
    return null;
  }

  const contractsForChain = (deployedContracts as unknown as Partial<DeployedContractsMap>)[targetNetwork.id];
  const rpcOverrides = getServerRpcOverrides();
  const rpcUrl = rpcOverrides?.[targetNetwork.id] ?? targetNetwork.rpcUrls.default.http[0];
  if (!rpcUrl) {
    return null;
  }

  return {
    advisoryVoteRecorder: contractsForChain?.AdvisoryVoteRecorder,
    feedbackRegistry: contractsForChain?.FeedbackRegistry,
    publicClient: createPublicClient({
      chain: targetNetwork,
      transport: http(rpcUrl),
    }),
    raterRegistry: contractsForChain?.RaterRegistry,
    votingEngine: contractsForChain?.RoundVotingEngine,
  };
}

function isNonZeroBytes32(value: unknown): value is string {
  return typeof value === "string" && value !== zeroHash;
}

function normalizeChainAddress(value: unknown): Address | null {
  return typeof value === "string" && isAddress(value) ? getAddress(value) : null;
}

function normalizeBytes32OrNull(value: unknown): `0x${string}` | null {
  return isNonZeroBytes32(value) && /^0x[0-9a-fA-F]{64}$/.test(value) ? (value.toLowerCase() as `0x${string}`) : null;
}

function readResolvedRaterIdentityKey(value: unknown): `0x${string}` | null {
  const tuple = Array.isArray(value) ? (value as readonly unknown[]) : null;
  const object =
    !tuple && value && typeof value === "object" ? (value as Record<string, unknown>) : ({} as Record<string, unknown>);
  const holder = normalizeChainAddress(tuple ? tuple[0] : object.holder);
  const identityKey = normalizeBytes32OrNull(tuple ? tuple[1] : object.identityKey);
  return holder ? identityKey : null;
}

async function isFeedbackRaterIdentityBanned(params: FeedbackVoteEligibilityParams): Promise<boolean> {
  const context = resolveFeedbackVoteReadContext(params.chainId);
  if (!context?.raterRegistry) {
    return false;
  }

  try {
    const resolved = await context.publicClient.readContract({
      address: context.raterRegistry.address,
      abi: context.raterRegistry.abi,
      functionName: "resolveRater",
      args: [params.address],
    });
    const identityKey = readResolvedRaterIdentityKey(resolved);
    if (!identityKey) return false;

    const banned = await context.publicClient.readContract({
      address: context.raterRegistry.address,
      abi: context.raterRegistry.abi,
      functionName: "isIdentityKeyBanned",
      args: [identityKey],
    });
    return Boolean(banned);
  } catch (error) {
    console.warn("[content-feedback] Unable to verify rater identity ban.", {
      address: params.address,
      chainId: params.chainId,
      contentId: params.contentId,
      error,
      roundId: params.roundId,
    });
    return false;
  }
}

async function hasOnchainFeedbackEligibleVote(params: FeedbackVoteEligibilityParams): Promise<boolean> {
  const context = resolveFeedbackVoteReadContext(params.chainId);
  if (!context) {
    return false;
  }

  const contentId = BigInt(params.contentId);
  const roundId = BigInt(params.roundId);
  const checks: Promise<unknown>[] = [];

  if (context.votingEngine) {
    checks.push(
      context.publicClient.readContract({
        address: context.votingEngine.address,
        abi: context.votingEngine.abi,
        functionName: "voterCommitKey",
        args: [contentId, roundId, params.address],
      }),
    );
  }

  if (context.advisoryVoteRecorder) {
    checks.push(
      context.publicClient.readContract({
        address: context.advisoryVoteRecorder.address,
        abi: context.advisoryVoteRecorder.abi,
        functionName: "advisoryCommitKeyByRater",
        args: [contentId, roundId, params.address],
      }),
    );
  }

  if (checks.length === 0) {
    return false;
  }

  try {
    const results = await Promise.all(checks);
    return results.some(result =>
      Array.isArray(result) ? isNonZeroBytes32(result[1]) || isNonZeroBytes32(result[0]) : isNonZeroBytes32(result),
    );
  } catch (error) {
    console.warn("[content-feedback] Unable to verify vote eligibility on-chain.", {
      address: params.address,
      chainId: params.chainId,
      contentId: params.contentId,
      error,
      roundId: params.roundId,
    });
    return false;
  }
}

function isFeedbackRecordTuple(
  record: FeedbackRegistryRecordResult,
): record is Extract<FeedbackRegistryRecordResult, readonly unknown[]> {
  return Array.isArray(record);
}

function readRecordFeedbackHash(record: FeedbackRegistryRecordResult): `0x${string}` {
  if (isFeedbackRecordTuple(record)) return record[0];
  return record.feedbackHash ?? zeroHash;
}

function readRecordAuthor(record: FeedbackRegistryRecordResult): `0x${string}` | null {
  const author = isFeedbackRecordTuple(record) ? record[1] : record.author;
  return author && isValidWalletAddress(author) ? normalizeWalletAddress(author) : null;
}

function readRecordRevealedAt(record: FeedbackRegistryRecordResult): bigint {
  const value = isFeedbackRecordTuple(record) ? record[3] : record.revealedAt;
  try {
    return BigInt(value ?? 0);
  } catch {
    return 0n;
  }
}

export async function assertContentFeedbackPublishedOnchain(params: FeedbackPublicationParams): Promise<void> {
  const context = resolveFeedbackVoteReadContext(params.chainId);
  if (!context?.feedbackRegistry) {
    throw new ContentFeedbackPublicationMissingError("CONTENT_FEEDBACK_REGISTRY_UNAVAILABLE");
  }

  try {
    const record = (await context.publicClient.readContract({
      address: context.feedbackRegistry.address,
      abi: context.feedbackRegistry.abi,
      functionName: "feedbackByCommitKey",
      args: [BigInt(params.contentId), BigInt(params.roundId), params.commitKey],
    })) as FeedbackRegistryRecordResult;

    const feedbackHash = readRecordFeedbackHash(record).toLowerCase();
    const author = readRecordAuthor(record);
    if (
      readRecordRevealedAt(record) <= 0n ||
      feedbackHash !== params.feedbackHash.toLowerCase() ||
      author !== params.address
    ) {
      throw new ContentFeedbackPublicationMissingError();
    }
  } catch (error) {
    if (error instanceof ContentFeedbackPublicationMissingError) {
      throw error;
    }
    console.warn("[content-feedback] Unable to verify on-chain feedback publication.", {
      address: params.address,
      chainId: params.chainId,
      contentId: params.contentId,
      error,
      roundId: params.roundId,
    });
    throw new ContentFeedbackPublicationMissingError();
  }
}

export function __setContentFeedbackVoteEligibilityTestOverridesForTests(
  overrides: FeedbackVoteEligibilityTestOverrides | null,
) {
  feedbackVoteEligibilityTestOverrides = overrides;
}

export async function assertContentFeedbackVoterEligibility(params: FeedbackVoteEligibilityParams): Promise<void> {
  const identityBanned = await (
    feedbackVoteEligibilityTestOverrides?.isFeedbackRaterIdentityBanned ?? isFeedbackRaterIdentityBanned
  )(params);
  if (identityBanned) {
    throw new ContentFeedbackVoterEligibilityError("CONTENT_FEEDBACK_IDENTITY_BANNED");
  }

  const deployment = resolveContentFeedbackDeploymentScope(params.chainId);
  let hasVote = false;
  try {
    const votes = await (feedbackVoteEligibilityTestOverrides?.getVotes ?? ponderApi.getVotes)(
      {
        voter: params.address,
        contentId: params.contentId,
        roundId: params.roundId,
        limit: "1",
      },
      {
        chainId: deployment?.chainId ?? params.chainId,
        deploymentKey: deployment?.deploymentKey,
      },
    );
    hasVote = votes.items.some(
      vote =>
        String(vote.contentId) === params.contentId &&
        String(vote.roundId) === params.roundId &&
        normalizeWalletAddress(vote.voter) === params.address,
    );
  } catch (error) {
    console.warn("[content-feedback] Unable to verify indexed feedback eligibility; trying on-chain fallback.", {
      address: params.address,
      chainId: params.chainId,
      contentId: params.contentId,
      error,
      roundId: params.roundId,
    });
  }
  if (!hasVote) {
    const hasOnchainVote = await (
      feedbackVoteEligibilityTestOverrides?.hasOnchainFeedbackEligibleVote ?? hasOnchainFeedbackEligibleVote
    )(params);
    if (!hasOnchainVote) {
      throw new ContentFeedbackVoterEligibilityError();
    }
  }
}

function isFeedbackPublic(row: Pick<FeedbackRow, "publishedAt">) {
  return row.publishedAt !== null;
}

function buildPublicFeedbackCondition() {
  return sql`${contentFeedback.publishedAt} IS NOT NULL`;
}

function mapFeedbackRow(
  row: FeedbackRow,
  params: {
    context: ContentFeedbackRoundContext;
    viewerAddress?: `0x${string}` | null;
  },
): ContentFeedbackItem | null {
  if (row.deletedAt || row.moderationStatus !== APPROVED_MODERATION_STATUS) {
    return null;
  }

  const authorAddress = normalizeWalletAddress(row.authorAddress);
  const feedbackType = normalizeFeedbackType(row.feedbackType);
  if (!feedbackType) {
    return null;
  }

  const isOwn = params.viewerAddress === authorAddress;
  const isPublic = isFeedbackPublic(row);
  if (!isPublic && !isOwn) {
    return null;
  }

  return {
    id: row.id,
    contentId: row.contentId,
    roundId: row.roundId,
    chainId: row.chainId,
    authorAddress,
    feedbackType,
    feedbackTypeLabel: CONTENT_FEEDBACK_TYPE_LABELS[feedbackType],
    body: row.body,
    sourceUrl: row.sourceUrl,
    feedbackHash: row.feedbackHash,
    clientNonce: row.clientNonce,
    moderationStatus: row.moderationStatus,
    publicationTxHash: row.publicationTxHash,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    isOwn,
    isPublic,
  };
}

function unixSecondsToIso(value: string | number | bigint | null | undefined): string {
  if (value === null || value === undefined) {
    return createContentFeedbackTimestamp().toISOString();
  }

  try {
    return new Date(Number(BigInt(value)) * 1000).toISOString();
  } catch {
    return createContentFeedbackTimestamp().toISOString();
  }
}

function mapProtocolFeedbackRow(
  row: PonderContentFeedbackItem,
  params: {
    chainId?: number | null;
    viewerAddress?: `0x${string}` | null;
  },
): ContentFeedbackItem | null {
  if (!row.revealed || !row.body || !row.feedbackType) {
    return null;
  }
  if (!isValidWalletAddress(row.author)) {
    return null;
  }

  const authorAddress = normalizeWalletAddress(row.author);
  const normalizedKnownType = normalizeFeedbackType(row.feedbackType);
  const rawFeedbackType = row.feedbackType.trim();
  const feedbackType = normalizedKnownType ?? rawFeedbackType.toLowerCase();
  const feedbackTypeLabel = normalizedKnownType ? CONTENT_FEEDBACK_TYPE_LABELS[normalizedKnownType] : rawFeedbackType;
  const isOwn = params.viewerAddress === authorAddress;
  const createdAt = unixSecondsToIso(row.revealedAt ?? row.committedAt);

  return {
    id: `protocol:${row.id}`,
    contentId: row.contentId,
    roundId: row.roundId,
    chainId: params.chainId ?? null,
    authorAddress,
    feedbackType,
    feedbackTypeLabel,
    body: row.body,
    sourceUrl: row.sourceUrl?.trim() || null,
    feedbackHash: row.feedbackHash,
    clientNonce: row.clientNonce ?? null,
    moderationStatus: APPROVED_MODERATION_STATUS,
    publicationTxHash: row.revealTxHash ?? row.commitTxHash ?? null,
    publishedAt: unixSecondsToIso(row.revealedAt ?? row.committedAt),
    createdAt,
    updatedAt: unixSecondsToIso(row.updatedAt ?? row.revealedAt ?? row.committedAt),
    isOwn,
    isPublic: true,
  };
}

async function listProtocolContentFeedback(params: {
  chainId: number;
  contentId: string;
  deploymentKey: string;
  viewerAddress?: `0x${string}` | null;
}): Promise<ContentFeedbackItem[]> {
  const getContentFeedback = feedbackVoteEligibilityTestOverrides?.getContentFeedback;
  if (!getContentFeedback && !isPonderConfigured()) {
    return [];
  }

  try {
    const response = await (getContentFeedback ?? ponderApi.getContentFeedback)(
      {
        contentId: params.contentId,
        limit: String(CONTENT_FEEDBACK_LIST_LIMIT),
      },
      { chainId: params.chainId, deploymentKey: params.deploymentKey },
    );
    return response.items
      .map(row => mapProtocolFeedbackRow(row, { chainId: params.chainId, viewerAddress: params.viewerAddress }))
      .filter((item): item is ContentFeedbackItem => item !== null);
  } catch (error) {
    console.warn("[content-feedback] Unable to load protocol-indexed feedback.", {
      contentId: params.contentId,
      error,
    });
    return [];
  }
}

function isHexHash(value: string | null | undefined): value is `0x${string}` {
  return normalizeBytes32Hex(value) !== null;
}

function mapFeedbackBonusPool(row: PonderFeedbackBonusPool): ContentFeedbackBonusPool | null {
  if (!isValidWalletAddress(row.awarder)) return null;
  const currency = row.asset === 0 ? "LREP" : "USDC";
  return {
    id: row.id,
    contentId: row.contentId,
    roundId: row.roundId,
    awarder: normalizeWalletAddress(row.awarder),
    asset: row.asset,
    currency,
    displayCurrency: currency === "USDC" ? "USD" : "LREP",
    fundedAmount: row.fundedAmount,
    remainingAmount: row.remainingAmount,
    awardedAmount: row.awardedAmount,
    feedbackClosesAt: row.feedbackClosesAt,
    awardDeadline: row.awardDeadline,
    frontendFeeBps: Number(row.frontendFeeBps) || 0,
  };
}

function mapFeedbackBonusAward(row: PonderFeedbackBonusAward): ContentFeedbackBonusAward | null {
  if (!isValidWalletAddress(row.recipient) || !isHexHash(row.feedbackHash)) return null;
  const currency = row.asset === 0 ? "LREP" : "USDC";
  return {
    id: row.id,
    poolId: row.poolId,
    contentId: row.contentId,
    roundId: row.roundId,
    recipient: normalizeWalletAddress(row.recipient),
    feedbackHash: row.feedbackHash.toLowerCase() as `0x${string}`,
    asset: row.asset,
    currency,
    displayCurrency: currency === "USDC" ? "USD" : "LREP",
    grossAmount: row.grossAmount,
    recipientAmount: row.recipientAmount,
    frontendFee: row.frontendFee,
    awardedAt: row.awardedAt,
  };
}

async function listAwardableFeedbackBonusPools(params: {
  chainId: number;
  contentId: string;
  deploymentKey: string;
  awarderAddress?: `0x${string}` | null;
}): Promise<ContentFeedbackBonusPool[]> {
  const getFeedbackBonusPools =
    feedbackVoteEligibilityTestOverrides?.getFeedbackBonusPools ?? ponderApi.getFeedbackBonusPools;
  if (
    !params.awarderAddress ||
    (!feedbackVoteEligibilityTestOverrides?.getFeedbackBonusPools && !isPonderConfigured())
  ) {
    return [];
  }

  try {
    const response = await getFeedbackBonusPools(
      {
        contentId: params.contentId,
        awarder: params.awarderAddress,
        activeOnly: "true",
        limit: String(CONTENT_FEEDBACK_LIST_LIMIT),
      },
      { chainId: params.chainId, deploymentKey: params.deploymentKey },
    );
    return response.items.map(mapFeedbackBonusPool).filter((pool): pool is ContentFeedbackBonusPool => pool !== null);
  } catch (error) {
    console.warn("[content-feedback] Unable to load awardable feedback bonus pools.", {
      awarder: params.awarderAddress,
      contentId: params.contentId,
      error,
    });
    return [];
  }
}

async function listFeedbackBonusAwards(params: {
  chainId: number;
  contentId: string;
  deploymentKey: string;
  items: ContentFeedbackItem[];
}): Promise<ContentFeedbackBonusAward[]> {
  const getFeedbackBonusAwards =
    feedbackVoteEligibilityTestOverrides?.getFeedbackBonusAwards ?? ponderApi.getFeedbackBonusAwards;
  if (!feedbackVoteEligibilityTestOverrides?.getFeedbackBonusAwards && !isPonderConfigured()) {
    return [];
  }

  const feedbackHashes = Array.from(
    new Set(
      params.items
        .map(item => (isHexHash(item.feedbackHash) ? item.feedbackHash.toLowerCase() : null))
        .filter((hash): hash is string => hash !== null),
    ),
  );
  if (feedbackHashes.length === 0) {
    return [];
  }

  try {
    const response = await getFeedbackBonusAwards(
      {
        contentId: params.contentId,
        feedbackHashes: feedbackHashes.join(","),
        limit: String(CONTENT_FEEDBACK_LIST_LIMIT),
      },
      { chainId: params.chainId, deploymentKey: params.deploymentKey },
    );
    return response.items
      .map(mapFeedbackBonusAward)
      .filter((award): award is ContentFeedbackBonusAward => award !== null);
  } catch (error) {
    console.warn("[content-feedback] Unable to load feedback bonus awards.", {
      contentId: params.contentId,
      error,
    });
    return [];
  }
}

function contentFeedbackItemKey(item: ContentFeedbackItem) {
  return item.feedbackHash?.toLowerCase() ?? String(item.id);
}

function dedupeContentFeedbackItems(protocolItems: ContentFeedbackItem[], localItems: ContentFeedbackItem[]) {
  const byKey = new Map<string, ContentFeedbackItem>();
  for (const item of protocolItems) {
    byKey.set(contentFeedbackItemKey(item), item);
  }
  for (const item of localItems) {
    const key = contentFeedbackItemKey(item);
    if (!byKey.has(key)) {
      byKey.set(key, item);
    }
  }

  return Array.from(byKey.values());
}

function mergeContentFeedbackItems(protocolItems: ContentFeedbackItem[], localItems: ContentFeedbackItem[]) {
  return dedupeContentFeedbackItems(protocolItems, localItems)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, CONTENT_FEEDBACK_LIST_LIMIT);
}

export async function addContentFeedback(
  payload: PreparedContentFeedbackInput,
  context: ContentFeedbackRoundContext,
): Promise<ContentFeedbackItem> {
  const now = createContentFeedbackTimestamp();
  let row: FeedbackRow | undefined;
  try {
    const [existingFeedback] = await db
      .select({ id: contentFeedback.id })
      .from(contentFeedback)
      .where(
        and(
          eq(contentFeedback.deploymentKey, payload.deploymentKey),
          eq(contentFeedback.contentId, payload.contentId),
          eq(contentFeedback.roundId, payload.roundId),
          eq(contentFeedback.authorAddress, payload.normalizedAddress),
          isNull(contentFeedback.deletedAt),
        ),
      )
      .limit(1);
    if (existingFeedback) {
      throw new ContentFeedbackDuplicateError();
    }

    [row] = await db
      .insert(contentFeedback)
      .values({
        deploymentKey: payload.deploymentKey,
        contentRegistryAddress: payload.contentRegistryAddress,
        feedbackRegistryAddress: payload.feedbackRegistryAddress,
        contentId: payload.contentId,
        roundId: payload.roundId,
        chainId: payload.chainId,
        authorAddress: payload.normalizedAddress,
        feedbackType: payload.feedbackType,
        body: payload.body,
        sourceUrl: payload.sourceUrl,
        feedbackHash: payload.feedbackHash,
        commitKey: payload.commitKey,
        clientNonce: payload.clientNonce,
        payloadSignature: payload.payloadSignature,
        moderationStatus: APPROVED_MODERATION_STATUS,
        publicationTxHash: payload.publicationTxHash ?? null,
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      .returning();
  } catch (error) {
    if (isContentFeedbackDuplicateStorageError(error)) {
      throw new ContentFeedbackDuplicateError();
    }
    if (isContentFeedbackStorageUnavailableError(error)) {
      throw new ContentFeedbackStorageUnavailableError();
    }
    throw error;
  }

  const item = row ? mapFeedbackRow(row, { context, viewerAddress: payload.normalizedAddress }) : null;
  if (!item) {
    throw new Error("CONTENT_FEEDBACK_INSERT_FAILED");
  }

  return item;
}

export async function getExistingActiveContentFeedbackForAuthor(params: {
  deploymentKey?: string;
  contentId: string;
  roundId: string;
  authorAddress: `0x${string}`;
  context: ContentFeedbackRoundContext;
}): Promise<ContentFeedbackItem | null> {
  const deploymentKey = params.deploymentKey ?? requireContentFeedbackDeploymentScope().deploymentKey;
  try {
    const [row] = await db
      .select()
      .from(contentFeedback)
      .where(
        and(
          eq(contentFeedback.deploymentKey, deploymentKey),
          eq(contentFeedback.contentId, params.contentId),
          eq(contentFeedback.roundId, params.roundId),
          eq(contentFeedback.authorAddress, params.authorAddress),
          isNull(contentFeedback.deletedAt),
        ),
      )
      .limit(1);

    return row ? mapFeedbackRow(row, { context: params.context, viewerAddress: params.authorAddress }) : null;
  } catch (error) {
    if (isContentFeedbackStorageUnavailableError(error)) {
      throw new ContentFeedbackStorageUnavailableError();
    }
    throw error;
  }
}

export async function listContentFeedback(params: {
  chainId?: number;
  deploymentKey?: string;
  contentId: string;
  context: ContentFeedbackRoundContext;
  viewerAddress?: `0x${string}` | null;
  awarderAddress?: `0x${string}` | null;
}): Promise<ContentFeedbackListResult> {
  const deployment = params.deploymentKey
    ? resolveContentFeedbackDeploymentScope(params.chainId)
    : requireContentFeedbackDeploymentScope(params.chainId);
  const deploymentKey = params.deploymentKey ?? deployment?.deploymentKey;
  const chainId = params.chainId ?? deployment?.chainId;
  if (!deploymentKey || typeof chainId !== "number") {
    throw new ContentFeedbackDeploymentUnavailableError();
  }
  let rows: FeedbackRow[];
  let publicCount = 0;
  try {
    const baseCondition = and(
      eq(contentFeedback.deploymentKey, deploymentKey),
      eq(contentFeedback.contentId, params.contentId),
      eq(contentFeedback.moderationStatus, APPROVED_MODERATION_STATUS),
      isNull(contentFeedback.deletedAt),
    );
    const publicCondition = buildPublicFeedbackCondition();
    const visibleCondition = publicCondition;

    if (publicCondition) {
      const [countRow] = await db
        .select({ value: sql<number>`count(*)` })
        .from(contentFeedback)
        .where(and(baseCondition, publicCondition));
      publicCount = Number(countRow?.value ?? 0);
    }

    rows = await db
      .select()
      .from(contentFeedback)
      .where(visibleCondition ? and(baseCondition, visibleCondition) : sql`false`)
      .orderBy(desc(contentFeedback.createdAt), desc(contentFeedback.id))
      .limit(CONTENT_FEEDBACK_LIST_LIMIT);
  } catch (error) {
    if (!isContentFeedbackStorageUnavailableError(error)) {
      throw error;
    }

    return {
      items: [],
      count: 0,
      publicCount: 0,
      settlementComplete: params.context.settlementComplete,
      openRoundId: params.context.openRoundId,
      awardableFeedbackBonusPools: [],
    };
  }

  const localItems = rows
    .map(row => mapFeedbackRow(row, { context: params.context, viewerAddress: params.viewerAddress }))
    .filter((item): item is ContentFeedbackItem => item !== null);
  const protocolItems = await listProtocolContentFeedback({
    chainId,
    contentId: params.contentId,
    deploymentKey,
    viewerAddress: params.viewerAddress,
  });
  const items = mergeContentFeedbackItems(protocolItems, localItems);
  const [awardableFeedbackBonusPools, feedbackBonusAwards] = await Promise.all([
    listAwardableFeedbackBonusPools({
      chainId,
      contentId: params.contentId,
      deploymentKey,
      awarderAddress: params.awarderAddress,
    }),
    listFeedbackBonusAwards({ chainId, contentId: params.contentId, deploymentKey, items }),
  ]);
  const terminalAwardablePools = awardableFeedbackBonusPools.filter(pool =>
    params.context.terminalRoundIds.has(pool.roundId),
  );
  const awardsByFeedbackHash = new Map<string, ContentFeedbackBonusAward[]>();
  for (const award of feedbackBonusAwards) {
    const key = award.feedbackHash.toLowerCase();
    awardsByFeedbackHash.set(key, [...(awardsByFeedbackHash.get(key) ?? []), award]);
  }
  const annotatedItems = items.map(item => {
    const feedbackHash = isHexHash(item.feedbackHash) ? item.feedbackHash.toLowerCase() : null;
    return {
      ...item,
      feedbackBonusAwards: feedbackHash ? (awardsByFeedbackHash.get(feedbackHash) ?? []) : [],
    };
  });
  const mergedPublicCount = items.filter(item => item.isPublic).length;

  return {
    items: annotatedItems,
    count: annotatedItems.length,
    publicCount: Math.max(publicCount, mergedPublicCount),
    settlementComplete: params.context.settlementComplete,
    openRoundId: params.context.openRoundId,
    awardableFeedbackBonusPools: terminalAwardablePools,
  };
}

export async function listContentFeedbackCounts(params: {
  chainId?: number;
  deploymentKey?: string;
  contentIds: string[];
  contextByContentId: Map<string, ContentFeedbackRoundContext>;
}): Promise<Record<string, number>> {
  const deployment = requireContentFeedbackDeploymentScope(params.chainId);
  const deploymentKey = params.deploymentKey ?? deployment.deploymentKey;
  const chainId = params.chainId ?? deployment.chainId;
  const counts = Object.fromEntries(params.contentIds.map(contentId => [contentId, 0]));
  if (params.contentIds.length === 0) {
    return counts;
  }

  let rows: FeedbackRow[];
  try {
    rows = await db
      .select()
      .from(contentFeedback)
      .where(
        and(
          eq(contentFeedback.deploymentKey, deploymentKey),
          inArray(contentFeedback.contentId, params.contentIds),
          isNull(contentFeedback.deletedAt),
        ),
      );
  } catch (error) {
    if (isContentFeedbackStorageUnavailableError(error)) {
      rows = [];
    } else {
      throw error;
    }
  }

  const localItemsByContentId = new Map<string, ContentFeedbackItem[]>();
  for (const row of rows) {
    const context = params.contextByContentId.get(row.contentId);
    if (!context) continue;
    const item = mapFeedbackRow(row, { context });
    if (!item?.isPublic) continue;
    localItemsByContentId.set(row.contentId, [...(localItemsByContentId.get(row.contentId) ?? []), item]);
  }

  await Promise.all(
    params.contentIds.map(async contentId => {
      const protocolItems = await listProtocolContentFeedback({
        chainId,
        contentId,
        deploymentKey,
      });
      const localItems = localItemsByContentId.get(contentId) ?? [];
      counts[contentId] = dedupeContentFeedbackItems(protocolItems, localItems).filter(item => item.isPublic).length;
    }),
  );

  return counts;
}
