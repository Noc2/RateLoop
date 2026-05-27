import deployedContracts from "@rateloop/contracts/deployedContracts";
import { ROUND_STATE, type RoundState } from "@rateloop/contracts/protocol";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { type Abi, type Address, createPublicClient, http, zeroHash } from "viem";
import { db } from "~~/lib/db";
import { contentFeedback } from "~~/lib/db/schema";
import { getPrimaryServerTargetNetwork, getServerRpcOverrides, getServerTargetNetworkById } from "~~/lib/env/server";
import {
  type ContentFeedbackHashInput,
  type ContentFeedbackHashMetadata,
  buildContentFeedbackHash,
} from "~~/lib/feedback/feedbackHash";
import {
  CONTENT_FEEDBACK_BODY_MAX_LENGTH,
  CONTENT_FEEDBACK_SOURCE_URL_MAX_LENGTH,
  CONTENT_FEEDBACK_TYPES,
  CONTENT_FEEDBACK_TYPE_LABELS,
  type ContentFeedbackItem,
  type ContentFeedbackListResult,
  type ContentFeedbackType,
} from "~~/lib/feedback/types";
import { isValidWalletAddress, normalizeContentId, normalizeWalletAddress } from "~~/lib/watchlist/contentWatch";
import { type PonderContentFeedbackItem, isPonderConfigured, ponderApi } from "~~/services/ponder/client";
import { containsBlockedText, containsBlockedUrl } from "~~/utils/contentFilter";

const CONTENT_FEEDBACK_LIST_LIMIT = 100;
const APPROVED_MODERATION_STATUS = "approved";
const HIDDEN_UNTIL_SETTLEMENT_STATUS = "hidden_until_settlement";

export interface NormalizedContentFeedbackInput {
  normalizedAddress: `0x${string}`;
  contentId: string;
  feedbackType: ContentFeedbackType;
  body: string;
  sourceUrl: string | null;
}

export interface ContentFeedbackChallengePayload extends NormalizedContentFeedbackInput, ContentFeedbackHashMetadata {}

export interface PreparedContentFeedbackInput extends ContentFeedbackChallengePayload {
  payloadSignature: `0x${string}`;
}

export interface NormalizedContentFeedbackReadInput {
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
type DeployedContractRecord = {
  address: Address;
  abi: Abi;
};
type DeployedContractsMap = Record<number, Record<string, DeployedContractRecord>>;
type FeedbackVoteEligibilityTestOverrides = {
  getAllRounds?: typeof ponderApi.getAllRounds;
  getContentById?: typeof ponderApi.getContentById;
  getVotes?: typeof ponderApi.getVotes;
  hasOnchainFeedbackEligibleVote?: (params: FeedbackVoteEligibilityParams) => Promise<boolean>;
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
      message.includes("content_feedback_feedback_hash_unique") ||
      message.includes("content_feedback_active_author_round_unique") ||
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

function normalizeFeedbackSourceUrl(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > CONTENT_FEEDBACK_SOURCE_URL_MAX_LENGTH) return undefined;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
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
    return { ok: false, error: "Source URL must be a valid http(s) URL" };
  }
  if (sourceUrl && containsBlockedUrl(sourceUrl).blocked) {
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

export function normalizeContentFeedbackReadInput(input: {
  address?: string | null;
  contentId?: unknown;
}): { ok: true; payload: NormalizedContentFeedbackReadInput } | { ok: false; error: string } {
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

function createContentFeedbackTimestamp(nowMs = Date.now()): Date {
  return new Date(Math.floor(nowMs / 1000) * 1000);
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
      functionName: "rounds",
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
  const [contentResponse, rounds] = await Promise.all([
    (feedbackVoteEligibilityTestOverrides?.getContentById ?? ponderApi.getContentById)(contentId),
    (feedbackVoteEligibilityTestOverrides?.getAllRounds ?? ponderApi.getAllRounds)({ contentId }),
  ]);

  const context = buildContentFeedbackRoundContext(rounds, contentResponse.content.openRound?.roundId ?? null);
  if (context.openRoundId) {
    return context;
  }

  const onchainOpenRoundId = await resolveOnchainOpenRoundId(contentId, chainId);
  return onchainOpenRoundId ? buildContentFeedbackRoundContext(rounds, onchainOpenRoundId) : context;
}

export function buildPreparedContentFeedbackInput(
  payload: NormalizedContentFeedbackInput,
  params: Omit<ContentFeedbackHashInput, "contentId" | "authorAddress" | "feedbackType" | "body" | "sourceUrl"> & {
    feedbackHash?: `0x${string}`;
    payloadSignature: `0x${string}`;
  },
): PreparedContentFeedbackInput {
  return {
    ...buildContentFeedbackChallengePayload(payload, params),
    payloadSignature: params.payloadSignature,
  };
}

export function buildContentFeedbackChallengePayload(
  payload: NormalizedContentFeedbackInput,
  params: Omit<ContentFeedbackHashInput, "contentId" | "authorAddress" | "feedbackType" | "body" | "sourceUrl"> & {
    feedbackHash?: `0x${string}`;
  },
): ContentFeedbackChallengePayload {
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
    publicClient: createPublicClient({
      chain: targetNetwork,
      transport: http(rpcUrl),
    }),
    votingEngine: contractsForChain?.RoundVotingEngine,
  };
}

function isNonZeroBytes32(value: unknown) {
  return typeof value === "string" && value !== zeroHash;
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
        functionName: "voterCommitHash",
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
    return results.some(isNonZeroBytes32);
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

export function __setContentFeedbackVoteEligibilityTestOverridesForTests(
  overrides: FeedbackVoteEligibilityTestOverrides | null,
) {
  feedbackVoteEligibilityTestOverrides = overrides;
}

export async function assertContentFeedbackVoterEligibility(params: FeedbackVoteEligibilityParams): Promise<void> {
  const votes = await (feedbackVoteEligibilityTestOverrides?.getVotes ?? ponderApi.getVotes)({
    voter: params.address,
    contentId: params.contentId,
    roundId: params.roundId,
    limit: "1",
  });
  const hasVote = votes.items.some(
    vote =>
      String(vote.contentId) === params.contentId &&
      String(vote.roundId) === params.roundId &&
      normalizeWalletAddress(vote.voter) === params.address,
  );
  if (!hasVote) {
    const hasOnchainVote = await (
      feedbackVoteEligibilityTestOverrides?.hasOnchainFeedbackEligibleVote ?? hasOnchainFeedbackEligibleVote
    )(params);
    if (!hasOnchainVote) {
      throw new ContentFeedbackVoterEligibilityError();
    }
  }
}

function isFeedbackPublic(row: Pick<FeedbackRow, "roundId">, context: ContentFeedbackRoundContext) {
  if (!row.roundId) {
    return context.settlementComplete;
  }
  return context.terminalRoundIds.has(row.roundId);
}

function buildPublicFeedbackCondition(context: ContentFeedbackRoundContext) {
  const publicRoundConditions = [];
  if (context.settlementComplete) {
    publicRoundConditions.push(isNull(contentFeedback.roundId));
  }
  const terminalRoundIds = Array.from(context.terminalRoundIds);
  if (terminalRoundIds.length > 0) {
    publicRoundConditions.push(inArray(contentFeedback.roundId, terminalRoundIds));
  }

  if (publicRoundConditions.length === 0) return undefined;
  return publicRoundConditions.length === 1 ? publicRoundConditions[0] : or(...publicRoundConditions);
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
  const isPublic = isFeedbackPublic(row, params.context);
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
    visibilityStatus: row.visibilityStatus,
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
    chainId: null,
    authorAddress,
    feedbackType,
    feedbackTypeLabel,
    body: row.body,
    sourceUrl: row.sourceUrl?.trim() || null,
    feedbackHash: row.feedbackHash,
    clientNonce: row.clientNonce ?? null,
    moderationStatus: APPROVED_MODERATION_STATUS,
    visibilityStatus: "public_onchain",
    createdAt,
    updatedAt: unixSecondsToIso(row.updatedAt ?? row.revealedAt ?? row.committedAt),
    isOwn,
    isPublic: true,
  };
}

async function listProtocolContentFeedback(params: {
  contentId: string;
  viewerAddress?: `0x${string}` | null;
}): Promise<ContentFeedbackItem[]> {
  if (!isPonderConfigured()) {
    return [];
  }

  try {
    const response = await ponderApi.getContentFeedback({
      contentId: params.contentId,
      limit: String(CONTENT_FEEDBACK_LIST_LIMIT),
    });
    return response.items
      .map(row => mapProtocolFeedbackRow(row, { viewerAddress: params.viewerAddress }))
      .filter((item): item is ContentFeedbackItem => item !== null);
  } catch (error) {
    console.warn("[content-feedback] Unable to load protocol-indexed feedback.", {
      contentId: params.contentId,
      error,
    });
    return [];
  }
}

function contentFeedbackItemKey(item: ContentFeedbackItem) {
  return item.feedbackHash?.toLowerCase() ?? String(item.id);
}

function mergeContentFeedbackItems(protocolItems: ContentFeedbackItem[], localItems: ContentFeedbackItem[]) {
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

  return Array.from(byKey.values())
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, CONTENT_FEEDBACK_LIST_LIMIT);
}

export async function addContentFeedback(
  payload: PreparedContentFeedbackInput,
  context: ContentFeedbackRoundContext,
): Promise<ContentFeedbackItem> {
  if (
    !context.currentRoundId ||
    context.currentRoundId !== payload.roundId ||
    context.openRoundId !== payload.roundId
  ) {
    throw new Error("CONTENT_ROUND_UNAVAILABLE");
  }

  const now = createContentFeedbackTimestamp();
  let row: FeedbackRow | undefined;
  try {
    const [existingFeedback] = await db
      .select({ id: contentFeedback.id })
      .from(contentFeedback)
      .where(
        and(
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
        contentId: payload.contentId,
        roundId: payload.roundId,
        chainId: payload.chainId,
        authorAddress: payload.normalizedAddress,
        feedbackType: payload.feedbackType,
        body: payload.body,
        sourceUrl: payload.sourceUrl,
        feedbackHash: payload.feedbackHash,
        clientNonce: payload.clientNonce,
        payloadSignature: payload.payloadSignature,
        moderationStatus: APPROVED_MODERATION_STATUS,
        visibilityStatus: HIDDEN_UNTIL_SETTLEMENT_STATUS,
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

export async function listContentFeedback(params: {
  contentId: string;
  context: ContentFeedbackRoundContext;
  viewerAddress?: `0x${string}` | null;
}): Promise<ContentFeedbackListResult> {
  let rows: FeedbackRow[];
  let publicCount = 0;
  try {
    const baseCondition = and(
      eq(contentFeedback.contentId, params.contentId),
      eq(contentFeedback.moderationStatus, APPROVED_MODERATION_STATUS),
      isNull(contentFeedback.deletedAt),
    );
    const publicCondition = buildPublicFeedbackCondition(params.context);
    const visibleCondition = params.viewerAddress
      ? publicCondition
        ? or(publicCondition, eq(contentFeedback.authorAddress, params.viewerAddress))
        : eq(contentFeedback.authorAddress, params.viewerAddress)
      : publicCondition;

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
      ownHiddenCount: 0,
      settlementComplete: params.context.settlementComplete,
      openRoundId: params.context.openRoundId,
    };
  }

  const localItems = rows
    .map(row => mapFeedbackRow(row, { context: params.context, viewerAddress: params.viewerAddress }))
    .filter((item): item is ContentFeedbackItem => item !== null);
  const protocolItems = await listProtocolContentFeedback({
    contentId: params.contentId,
    viewerAddress: params.viewerAddress,
  });
  const items = mergeContentFeedbackItems(protocolItems, localItems);
  const ownHiddenCount = items.filter(item => item.isOwn && !item.isPublic).length;
  const mergedPublicCount = items.filter(item => item.isPublic).length;

  return {
    items,
    count: items.length,
    publicCount: Math.max(publicCount, mergedPublicCount),
    ownHiddenCount,
    settlementComplete: params.context.settlementComplete,
    openRoundId: params.context.openRoundId,
  };
}

export async function listContentFeedbackCounts(params: {
  contentIds: string[];
  contextByContentId: Map<string, ContentFeedbackRoundContext>;
}): Promise<Record<string, number>> {
  const counts = Object.fromEntries(params.contentIds.map(contentId => [contentId, 0]));
  if (params.contentIds.length === 0) {
    return counts;
  }

  let rows: Array<{
    contentId: string;
    roundId: string | null;
    moderationStatus: string;
  }>;
  try {
    rows = await db
      .select({
        contentId: contentFeedback.contentId,
        roundId: contentFeedback.roundId,
        moderationStatus: contentFeedback.moderationStatus,
      })
      .from(contentFeedback)
      .where(and(inArray(contentFeedback.contentId, params.contentIds), isNull(contentFeedback.deletedAt)));
  } catch (error) {
    if (isContentFeedbackStorageUnavailableError(error)) {
      return counts;
    }
    throw error;
  }

  for (const row of rows) {
    if (row.moderationStatus !== APPROVED_MODERATION_STATUS) continue;
    const context = params.contextByContentId.get(row.contentId);
    if (!context || !isFeedbackPublic(row, context)) continue;
    counts[row.contentId] = (counts[row.contentId] ?? 0) + 1;
  }

  return counts;
}
