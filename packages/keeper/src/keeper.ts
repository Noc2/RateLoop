/**
 * Core keeper logic: reveal tlock RBTS votes, advance round terminal states, clean up
 * unrevealed commits, and sweep dormant content.
 *
 * With tlock commit-reveal voting, the keeper has six jobs:
 *   1. Reveal committed RBTS votes after each epoch ends (using drand beacon decryption).
 *   2. Call `settleRound(contentId, roundId)` when ≥max(minVoters, 3) are revealed.
 *      Low-turnout rounds still settle as feedback signals; score-spread LREP forfeits
 *      are only enabled by the contracts once the economic reveal threshold is reached.
 *   3. Call `finalizeRevealFailedRound(contentId, roundId)` once the extended
 *      reveal-failed recovery window has passed without reveal quorum.
 *   4. Call `processUnrevealedVotes(contentId, roundId, startIndex, count)` for
 *      terminal rounds that still have unrevealed stake to sweep/refund.
 *   5. Call `cancelExpiredRound(contentId, roundId)` for rounds past maxDuration that
 *      never reached commit quorum.
 *   6. Call `markDormant(contentId)` for stale content.
 *   7. Call `forfeitExpiredFeedbackBonus(poolId)` for expired Feedback Bonus pools
 *      that still hold residue.
 *
 * Vote ciphertext is tlock-encrypted to a future drand round. After the epoch
 * ends, the drand beacon makes the decryption key available and the keeper can decrypt.
 */
import {
  getAbiItem,
  keccak256,
  zeroAddress,
  type AbiEvent,
  type PublicClient,
  type WalletClient,
  type Chain,
  type Account,
} from "viem";
import { REVEAL_FAILED_GRACE_MULTIPLIER } from "@rateloop/contracts/protocol";
import { buildPonderRequestHeaders } from "./ponder-headers.js";
import { timelockDecrypt } from "tlock-js";
import {
  isDrandUnavailableError,
  resetTlockClientCacheForTests,
  resolveTlockClientForDrandChain,
} from "./drand.js";
import {
  AdvisoryVoteRecorderAbi,
  ContentRegistryAbi,
  FeedbackBonusEscrowAbi,
  QuestionRewardPoolEscrowAbi,
  RoundVotingEngineAbi,
} from "@rateloop/contracts/abis";
import {
  decodeRbtsVotePlaintext,
  parseTlockCiphertextMetadata,
} from "@rateloop/contracts/voting";
import { buildCommitKey } from "@rateloop/contracts/votingCore";
import { PONDER_HTTP_FETCH_TIMEOUT_MS } from "@rateloop/node-utils/correlationScoring";
import {
  type CommitData,
  type RoundData,
  type RoundVotingConfig,
  RoundState,
  parseCommitData,
  readCurrentRoundIds,
  readRound,
  readRoundCommitKeys,
  readRoundConfigForRound,
  readRoundLifecycleState,
} from "./contract-reads.js";
import { config } from "./config.js";
import type { Logger } from "./logger.js";
import { incrementCounter, setGauge } from "./metrics.js";
import { buildPonderUrl } from "./ponder-url.js";
import { getRevertReason, isExpectedRevert } from "./revert-utils.js";

// --- Types ---
export interface KeeperResult {
  roundsOpened: number;
  roundsSettled: number;
  roundsCancelled: number;
  roundsRevealFailedFinalized: number;
  votesRevealed: number;
  advisoryVotesRevealed: number;
  advisoryLaunchCreditsClaimed: number;
  cleanupBatchesProcessed: number;
  contentMarkedDormant: number;
  feedbackBonusPoolsForfeited: number;
  /** Open rounds with commit quorum but reveal quorum still unmet this tick. */
  roundsAwaitingRevealQuorum: number;
  /**
   * Smallest number of seconds until any of those rounds becomes finalizable as
   * RevealFailed (0 = already past its grace deadline); null when no round is at risk.
   */
  minRevealGraceSecondsRemaining: number | null;
}
export interface KeeperRunContext {
  blockTimestamp?: bigint;
}
interface CleanupCursor {
  contentId: bigint;
  roundId: bigint;
  nextIndex: number;
}
interface KeeperWorkRoundCandidate {
  contentId: bigint;
  roundId: bigint;
  reason?: string;
}
interface KeeperWorkContentCandidate {
  contentId: bigint;
  reason?: string;
}
interface KeeperWorkFeedbackBonusForfeitCandidate {
  poolId: bigint;
  contentId?: bigint;
  roundId?: bigint;
  awardDeadline?: bigint;
  remainingAmount?: bigint;
  reason?: string;
}
interface KeeperWorkDiscovery {
  source: "ponder" | "chain";
  contentIds: bigint[];
  roundOpenRequests: KeeperWorkContentCandidate[];
  openRounds: KeeperWorkRoundCandidate[];
  cleanupRounds: KeeperWorkRoundCandidate[];
  dormantContent: KeeperWorkContentCandidate[];
  feedbackBonusForfeits: KeeperWorkFeedbackBonusForfeitCandidate[];
}
interface PonderDeploymentMetadata {
  chainId?: unknown;
  contentRegistryAddress?: unknown;
  feedbackRegistryAddress?: unknown;
  deploymentKey?: unknown;
}

const MAX_CLEANUP_BATCHES_PER_TICK = 4;
// Reveal-failed finalization waits out an extended recovery window of
// REVEAL_FAILED_GRACE_MULTIPLIER x the round's snapshotted reveal grace period.
const REVEAL_FAILED_GRACE_MULTIPLIER_BI = BigInt(REVEAL_FAILED_GRACE_MULTIPLIER);
const MAX_CLEANUP_COMPLETED = 5000;
const MAX_CLEANUP_QUEUE = 2000;
const PONDER_FETCH_TIMEOUT_MS = PONDER_HTTP_FETCH_TIMEOUT_MS;
const INDEXED_CIPHERTEXT_PAGE_SIZE = 200;
const MAX_INDEXED_CIPHERTEXT_PAGES = 6;
const cleanupQueue = new Map<string, CleanupCursor>();
const cleanupCompletedRounds = new Set<string>();
const cleanupDiscoveryRoundByContent = new Map<bigint, bigint>();
let keeperWorkDiscoveryTick = 0;
// Rotating cursor for bounded chain content scans on Ponder discovery ticks.
let chainReconciliationContentCursor = 1n;
let verifiedPonderDeploymentCacheKey: string | null = null;

function emptyResult(): KeeperResult {
  return {
    roundsOpened: 0,
    roundsSettled: 0,
    roundsCancelled: 0,
    roundsRevealFailedFinalized: 0,
    votesRevealed: 0,
    advisoryVotesRevealed: 0,
    advisoryLaunchCreditsClaimed: 0,
    cleanupBatchesProcessed: 0,
    contentMarkedDormant: 0,
    feedbackBonusPoolsForfeited: 0,
    roundsAwaitingRevealQuorum: 0,
    minRevealGraceSecondsRemaining: null,
  };
}

export { validateKeeperContracts } from "./contract-reads.js";

export function resetKeeperStateForTests(): void {
  cleanupQueue.clear();
  cleanupCompletedRounds.clear();
  cleanupDiscoveryRoundByContent.clear();
  keeperWorkDiscoveryTick = 0;
  chainReconciliationContentCursor = 1n;
  verifiedPonderDeploymentCacheKey = null;
  decryptFailureCount.clear();
  resetTlockClientCacheForTests();
  lastBlockTimestampS = null;
  lastBlockObservedAtMs = null;
}

// Track repeated decrypt failures per commitKey to stop retrying permanently bad ciphertexts
const decryptFailureCount = new Map<string, number>();
const MAX_DECRYPT_RETRIES = 10;
const MAX_DECRYPT_FAILURE_ENTRIES = 10_000;

// KEEPER-1 (2026-05-21 repo audit): cache the last RPC-observed block timestamp so that an RPC
// outage does not force the keeper onto a raw `Date.now()` fallback. The system clock is
// vulnerable to NTP spoofing and drift; using it during an RPC outage can put the keeper out of
// sync with chain time and cause reveal submissions to revert. Pair the cached `block.timestamp`
// with the wall-clock time we observed it, so on RPC failure we can advance the cache by the
// elapsed wall-clock seconds — bounded to MAX_BLOCK_TIME_CACHE_AGE_S so a stuck cache cannot
// silently power the keeper forever.
let lastBlockTimestampS: bigint | null = null;
let lastBlockObservedAtMs: number | null = null;
// M-7 (2026-05-22 audit): the previous 120s ceiling let extrapolation drift up to
// ~239s away from chain time at worst (120s cache age + 119s elapsed at miss time),
// which can move reveal-deadline checks downstream into the wrong classification.
// 30s is still longer than any realistic L2 block cadence we target but bounds the
// worst-case drift to roughly one minute total.
const MAX_BLOCK_TIME_CACHE_AGE_S = 30;

async function resolveOnChainNowSeconds(
  publicClient: PublicClient,
): Promise<bigint> {
  try {
    const block = await publicClient.getBlock({ blockTag: "latest" });
    lastBlockTimestampS = block.timestamp;
    lastBlockObservedAtMs = Date.now();
    return block.timestamp;
  } catch (rpcError) {
    if (lastBlockTimestampS === null || lastBlockObservedAtMs === null) {
      // No cache to extrapolate from — fail loud rather than guessing with a wall clock.
      throw new Error(
        "RPC block fetch failed and no cached block timestamp is available",
      );
    }
    const elapsedS = Math.max(
      0,
      Math.floor((Date.now() - lastBlockObservedAtMs) / 1000),
    );
    if (elapsedS > MAX_BLOCK_TIME_CACHE_AGE_S) {
      throw new Error(
        `RPC block fetch failed and cached block timestamp is stale (${elapsedS}s old)`,
      );
    }
    console.warn(
      `[Keeper] RPC block fetch failed; extrapolating cached block.timestamp by ${elapsedS}s ` +
        `(rpc error: ${rpcError instanceof Error ? rpcError.message : String(rpcError)})`,
    );
    return lastBlockTimestampS + BigInt(elapsedS);
  }
}

const TOO_EARLY_TLOCK_ERROR_FRAGMENT = "too early to decrypt the ciphertext";
const DECRYPTABLE_AT_ROUND_PATTERN = /decryptable at round (\d+)/i;

function trackDecryptFailure(commitKey: string): number {
  const count = (decryptFailureCount.get(commitKey) ?? 0) + 1;
  // LRU touch: delete + re-insert moves the recently-failed entry to the back of the Map's
  // insertion order, so the oldest *untouched* entry is always the eviction candidate.
  // FIFO previously could evict a permanently-broken commit, reset its failure count, and
  // then start retrying it forever from zero.
  decryptFailureCount.delete(commitKey);
  decryptFailureCount.set(commitKey, count);
  if (decryptFailureCount.size > MAX_DECRYPT_FAILURE_ENTRIES) {
    const oldest = decryptFailureCount.keys().next().value;
    if (oldest !== undefined) decryptFailureCount.delete(oldest);
  }
  return count;
}

function markPermanentDecryptFailure(commitKey: string): void {
  decryptFailureCount.set(commitKey, MAX_DECRYPT_RETRIES);
}

function classifyDecryptError(err: unknown): {
  retryable: boolean;
  message: string;
  decryptableAtRound?: string;
} {
  const message =
    (err as { message?: string } | undefined)?.message ?? String(err);
  if (message.toLowerCase().includes(TOO_EARLY_TLOCK_ERROR_FRAGMENT)) {
    return {
      retryable: true,
      message,
      decryptableAtRound: message.match(DECRYPTABLE_AT_ROUND_PATTERN)?.[1],
    };
  }
  // Every relay for the chain is down — an infrastructure outage, not a bad
  // ciphertext. Never count it toward the permanent decrypt-failure budget.
  if (isDrandUnavailableError(err)) {
    return { retryable: true, message };
  }

  return { retryable: false, message };
}

function cleanupRoundKey(contentId: bigint, roundId: bigint): string {
  return `${contentId}:${roundId}`;
}

function isCleanupEligibleRoundState(state: number): boolean {
  return (
    state === RoundState.Settled ||
    state === RoundState.Tied ||
    state === RoundState.RevealFailed
  );
}

function enqueueRoundForCleanup(
  contentId: bigint,
  roundId: bigint,
  startIndex = 0,
): void {
  const key = cleanupRoundKey(contentId, roundId);
  if (cleanupCompletedRounds.has(key)) return;

  const existing = cleanupQueue.get(key);
  if (existing) {
    existing.nextIndex = Math.min(existing.nextIndex, startIndex);
    return;
  }

  cleanupQueue.set(key, { contentId, roundId, nextIndex: startIndex });

  // Evict oldest pending cursors when the queue grows past the cap so a slow drain cannot
  // turn the keeper into a memory-leak under sustained load. The dropped cursors will be
  // re-enqueued the next time their round surfaces from event scanning.
  if (cleanupQueue.size > MAX_CLEANUP_QUEUE) {
    const overflow = cleanupQueue.size - MAX_CLEANUP_QUEUE;
    let removed = 0;
    for (const oldestKey of cleanupQueue.keys()) {
      if (removed >= overflow) break;
      cleanupQueue.delete(oldestKey);
      removed += 1;
    }
  }
}

function markCleanupCompleted(contentId: bigint, roundId: bigint): void {
  const key = cleanupRoundKey(contentId, roundId);
  cleanupQueue.delete(key);
  cleanupCompletedRounds.add(key);

  // Evict oldest entries when the set grows too large
  if (cleanupCompletedRounds.size > MAX_CLEANUP_COMPLETED) {
    const entries = Array.from(cleanupCompletedRounds);
    const toRemove = entries.slice(0, entries.length - MAX_CLEANUP_COMPLETED);
    for (const entry of toRemove) {
      cleanupCompletedRounds.delete(entry);
    }
  }
}

/**
 * Best-effort: after a settled round, drive bundle qualification by calling
 * `syncBundleQuestionTerminal` on the registry's `questionRewardPoolEscrow`. The escrow
 * function is permissionless and idempotent — it is a no-op for non-bundled content and
 * for bundles where the round set is not yet complete. Failures are logged but do not
 * propagate, since the keeper has already produced its primary settle effect.
 */
async function _syncBundleQuestionTerminal(
  publicClient: PublicClient,
  walletClient: WalletClient,
  chain: Chain,
  account: Account,
  registryAddr: `0x${string}`,
  contentId: bigint,
  roundId: bigint,
  logger: Logger,
): Promise<void> {
  try {
    const escrow = (await publicClient.readContract({
      address: registryAddr,
      abi: ContentRegistryAbi,
      functionName: "questionRewardPoolEscrow",
      args: [],
    })) as `0x${string}`;
    if (escrow === "0x0000000000000000000000000000000000000000") return;

    await writeContractAndConfirm(publicClient, walletClient, {
      chain,
      account,
      address: escrow,
      abi: QuestionRewardPoolEscrowAbi,
      functionName: "syncBundleQuestionTerminal",
      args: [contentId, roundId],
    });
    logger.debug("Synced bundle question terminal", {
      contentId: contentId.toString(),
      roundId: roundId.toString(),
    });
  } catch (err: unknown) {
    const reason = getRevertReason(err);
    if (!isExpectedRevert(reason)) {
      logger.debug("Bundle sync skipped", {
        contentId: contentId.toString(),
        roundId: roundId.toString(),
        error: reason,
      });
    }
  }
}

async function discoverCleanupCandidate(
  publicClient: Pick<PublicClient, "readContract">,
  engineAddr: `0x${string}`,
  contentId: bigint,
  latestRoundId: bigint,
): Promise<void> {
  if (latestRoundId == 0n) {
    cleanupDiscoveryRoundByContent.delete(contentId);
    return;
  }

  let roundId = cleanupDiscoveryRoundByContent.get(contentId) ?? 1n;
  if (roundId > latestRoundId) {
    roundId = 1n;
  }

  cleanupDiscoveryRoundByContent.set(
    contentId,
    roundId >= latestRoundId ? 1n : roundId + 1n,
  );

  const key = cleanupRoundKey(contentId, roundId);
  if (cleanupCompletedRounds.has(key) || cleanupQueue.has(key)) {
    return;
  }

  const round = await readRound(publicClient, engineAddr, contentId, roundId);
  if (isCleanupEligibleRoundState(round.state)) {
    enqueueRoundForCleanup(contentId, roundId);
  }
}

async function scanBoundedChainContentIds(
  publicClient: Pick<PublicClient, "readContract">,
  registryAddr: `0x${string}`,
  batchSize: number,
): Promise<bigint[]> {
  if (batchSize <= 0) {
    return [];
  }

  const nextContentId = (await publicClient.readContract({
    address: registryAddr,
    abi: ContentRegistryAbi,
    functionName: "nextContentId",
    args: [],
  })) as bigint;

  if (nextContentId <= 1n) {
    chainReconciliationContentCursor = 1n;
    return [];
  }

  let cursor = chainReconciliationContentCursor;
  if (cursor < 1n || cursor >= nextContentId) {
    cursor = 1n;
  }

  const contentIds: bigint[] = [];
  for (let i = 0; i < batchSize && cursor < nextContentId; i++) {
    contentIds.push(cursor);
    cursor += 1n;
  }

  chainReconciliationContentCursor =
    cursor >= nextContentId ? 1n : cursor;

  return contentIds;
}

async function discoverKeeperWorkCandidates(
  publicClient: Pick<PublicClient, "readContract">,
  registryAddr: `0x${string}`,
  now: bigint,
  logger: Logger,
): Promise<KeeperWorkDiscovery> {
  const startedAt = Date.now();
  const discoveryConfig = config.keeperWorkDiscovery ?? {
    enabled: false,
    reconciliationEveryTicks: 1,
    maxCandidates: 500,
    chainScanPerTick: 10,
  };

  keeperWorkDiscoveryTick += 1;
  const reconcileEvery = Math.max(
    1,
    Number(discoveryConfig.reconciliationEveryTicks ?? 1),
  );
  const reconciliationDue = keeperWorkDiscoveryTick % reconcileEvery === 0;

  let discovery: KeeperWorkDiscovery | null = null;
  if (discoveryConfig.enabled && !reconciliationDue) {
    discovery = await fetchKeeperWorkFromPonder(
      now,
      BigInt(config.dormancyPeriod),
      Number(discoveryConfig.maxCandidates ?? 500),
      logger,
    );
    if (discovery) {
      const chainBatch = await scanBoundedChainContentIds(
        publicClient,
        registryAddr,
        Number(discoveryConfig.chainScanPerTick ?? 10),
      );
      if (chainBatch.length > 0) {
        discovery = {
          ...discovery,
          contentIds: sortedUniqueBigInts([
            ...discovery.contentIds,
            ...chainBatch,
          ]),
        };
      }
    }
  }

  if (!discovery) {
    const chainBatchSize = reconciliationDue
      ? Math.max(
          Number(discoveryConfig.chainScanPerTick ?? 10) * 5,
          Math.ceil(Number(discoveryConfig.maxCandidates ?? 500) / reconcileEvery),
        )
      : Number(discoveryConfig.chainScanPerTick ?? 10);
    const chainContentIds = await scanBoundedChainContentIds(
      publicClient,
      registryAddr,
      chainBatchSize,
    );
    let ponderHints: KeeperWorkDiscovery | null = null;
    if (discoveryConfig.enabled) {
      ponderHints = await fetchKeeperWorkFromPonder(
        now,
        BigInt(config.dormancyPeriod),
        Number(discoveryConfig.maxCandidates ?? 500),
        logger,
      );
    }
    if (ponderHints) {
      discovery = {
        ...ponderHints,
        source: reconciliationDue ? "chain" : ponderHints.source,
        contentIds: sortedUniqueBigInts([
          ...ponderHints.contentIds,
          ...chainContentIds,
        ]),
      };
    } else {
      discovery = {
        source: "chain",
        contentIds: chainContentIds,
        roundOpenRequests: [],
        openRounds: [],
        cleanupRounds: [],
        dormantContent: [],
        feedbackBonusForfeits: [],
      };
    }
  }

  setGauge(
    "keeper_work_discovery_last_duration_seconds",
    (Date.now() - startedAt) / 1000,
  );
  setGauge(
    "keeper_work_discovery_last_source",
    discovery.source === "ponder" ? 1 : 2,
  );
  setGauge(
    "keeper_work_discovery_round_open_requests",
    discovery.roundOpenRequests.length,
  );
  setGauge(
    "keeper_work_discovery_open_round_candidates",
    discovery.openRounds.length,
  );
  setGauge(
    "keeper_work_discovery_cleanup_round_candidates",
    discovery.cleanupRounds.length,
  );
  setGauge(
    "keeper_work_discovery_dormant_content_candidates",
    discovery.dormantContent.length,
  );
  setGauge(
    "keeper_work_discovery_feedback_bonus_forfeit_candidates",
    discovery.feedbackBonusForfeits.length,
  );

  return discovery;
}

function normalizePonderDeploymentAddress(value: unknown): string | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase()
    : null;
}

function normalizePonderDeploymentChainId(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function expectedPonderDeploymentCacheKey(baseUrl: string) {
  return [
    baseUrl,
    config.chainId,
    config.contracts.contentRegistry.toLowerCase(),
    config.contracts.feedbackRegistry.toLowerCase(),
  ].join("|");
}

function expectedPonderDeploymentKey() {
  return [
    String(config.chainId),
    config.contracts.contentRegistry.toLowerCase(),
    config.contracts.feedbackRegistry.toLowerCase(),
  ].join(":");
}

async function assertPonderDeploymentMatchesKeeper(
  baseUrl: string,
  headers: Record<string, string>,
): Promise<void> {
  const cacheKey = expectedPonderDeploymentCacheKey(baseUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PONDER_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(buildPonderUrl(baseUrl, "/deployment"), {
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Ponder deployment request failed: ${response.status}`);
    }

    const deployment = (await response.json()) as PonderDeploymentMetadata;
    const ponderChainId = normalizePonderDeploymentChainId(deployment.chainId);
    const ponderContentRegistry = normalizePonderDeploymentAddress(
      deployment.contentRegistryAddress,
    );
    const ponderFeedbackRegistry = normalizePonderDeploymentAddress(
      deployment.feedbackRegistryAddress,
    );
    const ponderDeploymentKey =
      typeof deployment.deploymentKey === "string" && deployment.deploymentKey.trim()
        ? deployment.deploymentKey.trim().toLowerCase()
        : null;
    const verificationCacheKey = `${cacheKey}:${ponderDeploymentKey ?? "unknown"}`;
    if (verifiedPonderDeploymentCacheKey === verificationCacheKey) return;

    const expectedContentRegistry = config.contracts.contentRegistry.toLowerCase();
    const expectedFeedbackRegistry = config.contracts.feedbackRegistry.toLowerCase();
    const expectedDeploymentKey = expectedPonderDeploymentKey();
    const mismatches: string[] = [];

    if (ponderChainId !== config.chainId) {
      mismatches.push(`chainId=${ponderChainId ?? "unknown"} expected ${config.chainId}`);
    }
    if (ponderContentRegistry !== expectedContentRegistry) {
      mismatches.push(
        `contentRegistryAddress=${ponderContentRegistry ?? "unknown"} expected ${expectedContentRegistry}`,
      );
    }
    if (ponderFeedbackRegistry !== expectedFeedbackRegistry) {
      mismatches.push(
        `feedbackRegistryAddress=${ponderFeedbackRegistry ?? "unknown"} expected ${expectedFeedbackRegistry}`,
      );
    }
    if (ponderDeploymentKey !== expectedDeploymentKey) {
      mismatches.push(
        `deploymentKey=${ponderDeploymentKey ?? "unknown"} expected ${expectedDeploymentKey}`,
      );
    }

    if (mismatches.length > 0) {
      verifiedPonderDeploymentCacheKey = null;
      const deploymentKey = ponderDeploymentKey ? ` (${ponderDeploymentKey})` : "";
      throw new Error(`Ponder deployment does not match keeper config${deploymentKey}: ${mismatches.join(", ")}`);
    }

    verifiedPonderDeploymentCacheKey = verificationCacheKey;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchKeeperWorkFromPonder(
  now: bigint,
  dormancyPeriod: bigint,
  limit: number,
  logger: Logger,
): Promise<KeeperWorkDiscovery | null> {
  const baseUrl = config.ponderBaseUrl;
  if (!baseUrl) return null;

  const isProduction = process.env.NODE_ENV === "production";
  const keeperWorkToken = process.env.PONDER_KEEPER_WORK_TOKEN?.trim();
  if (isProduction && !keeperWorkToken) {
    throw new Error("PONDER_KEEPER_WORK_TOKEN is required in production");
  }

  const url = buildPonderUrl(baseUrl, "/keeper/work");
  url.searchParams.set("now", now.toString());
  url.searchParams.set("dormancyPeriod", dormancyPeriod.toString());
  url.searchParams.set(
    "feedbackBonusForfeitMinAge",
    String(config.feedbackBonusForfeits?.minAgeSeconds ?? 0),
  );
  url.searchParams.set("limit", String(Math.max(1, limit)));
  const proactiveRoundOpening = config.proactiveRoundOpening ?? {
    enabled: false,
    maxPerTick: 0,
    recentSeconds: 0n,
  };
  if (proactiveRoundOpening.enabled && proactiveRoundOpening.maxPerTick > 0) {
    url.searchParams.set("roundOpenLimit", String(proactiveRoundOpening.maxPerTick));
    url.searchParams.set("roundOpenRecentSeconds", proactiveRoundOpening.recentSeconds.toString());
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PONDER_FETCH_TIMEOUT_MS);

  try {
    const headers = buildPonderRequestHeaders();
    await assertPonderDeploymentMatchesKeeper(baseUrl, headers);
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Ponder keeper work request failed: ${response.status}`);
    }

    const payload = await response.json();
    const discovery = parseKeeperWorkPayload(payload);
    if (!discovery) {
      throw new Error("Ponder keeper work response was malformed");
    }

    return discovery;
  } catch (err: unknown) {
    incrementCounter("keeper_work_discovery_ponder_failures_total");
    if (isProduction) {
      throw err instanceof Error ? err : new Error(getRevertReason(err));
    }
    logger.warn("Falling back to chain keeper work discovery", {
      error: getRevertReason(err),
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseKeeperWorkPayload(payload: unknown): KeeperWorkDiscovery | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const roundOpenRequests = parseKeeperWorkContentArray(record.roundOpenRequests ?? []);
  const openRounds = parseKeeperWorkRoundArray(record.openRounds);
  const cleanupRounds = parseKeeperWorkRoundArray(record.cleanupRounds);
  const dormantContent = parseKeeperWorkContentArray(record.dormantContent);
  const feedbackBonusForfeits = parseKeeperWorkFeedbackBonusForfeitArray(
    record.feedbackBonusForfeits ?? [],
  );

  if (
    !roundOpenRequests ||
    !openRounds ||
    !cleanupRounds ||
    !dormantContent ||
    !feedbackBonusForfeits
  ) {
    return null;
  }

  const contentIds = sortedUniqueBigInts([
    ...roundOpenRequests.map((candidate) => candidate.contentId),
    ...openRounds.map((candidate) => candidate.contentId),
    ...cleanupRounds.map((candidate) => candidate.contentId),
    ...dormantContent.map((candidate) => candidate.contentId),
  ]);

  return {
    source: "ponder",
    contentIds,
    roundOpenRequests,
    openRounds,
    cleanupRounds,
    dormantContent,
    feedbackBonusForfeits,
  };
}

function parseKeeperWorkRoundArray(
  value: unknown,
): KeeperWorkRoundCandidate[] | null {
  if (!Array.isArray(value)) return null;
  const candidates: KeeperWorkRoundCandidate[] = [];
  for (const item of value) {
    const candidate = parseKeeperWorkRound(item);
    if (!candidate) return null;
    candidates.push(candidate);
  }
  return dedupeRoundCandidates(candidates);
}

function parseKeeperWorkContentArray(
  value: unknown,
): KeeperWorkContentCandidate[] | null {
  if (!Array.isArray(value)) return null;
  const candidates: KeeperWorkContentCandidate[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const contentId = parsePositiveBigInt(record.contentId);
    if (contentId === null) return null;
    const key = contentId.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      contentId,
      reason: typeof record.reason === "string" ? record.reason : undefined,
    });
  }
  return candidates.sort((a, b) => compareBigInt(a.contentId, b.contentId));
}

function parseKeeperWorkFeedbackBonusForfeitArray(
  value: unknown,
): KeeperWorkFeedbackBonusForfeitCandidate[] | null {
  if (!Array.isArray(value)) return null;
  const candidates: KeeperWorkFeedbackBonusForfeitCandidate[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const poolId = parsePositiveBigInt(record.poolId);
    if (poolId === null) return null;
    const key = poolId.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      poolId,
      contentId: parseOptionalPositiveBigInt(record.contentId),
      roundId: parseOptionalPositiveBigInt(record.roundId),
      awardDeadline: parseOptionalNonNegativeBigInt(record.awardDeadline),
      remainingAmount: parseOptionalNonNegativeBigInt(record.remainingAmount),
      reason: typeof record.reason === "string" ? record.reason : undefined,
    });
  }
  return candidates;
}

function parseKeeperWorkRound(value: unknown): KeeperWorkRoundCandidate | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const contentId = parsePositiveBigInt(record.contentId);
  const roundId = parsePositiveBigInt(record.roundId);
  if (contentId === null || roundId === null) return null;
  return {
    contentId,
    roundId,
    reason: typeof record.reason === "string" ? record.reason : undefined,
  };
}

function dedupeRoundCandidates(
  candidates: KeeperWorkRoundCandidate[],
): KeeperWorkRoundCandidate[] {
  const byKey = new Map<string, KeeperWorkRoundCandidate>();
  for (const candidate of candidates) {
    byKey.set(
      cleanupRoundKey(candidate.contentId, candidate.roundId),
      candidate,
    );
  }
  return Array.from(byKey.values()).sort((a, b) => {
    const contentOrder = compareBigInt(a.contentId, b.contentId);
    return contentOrder !== 0
      ? contentOrder
      : compareBigInt(a.roundId, b.roundId);
  });
}

function sortedUniqueBigInts(values: bigint[]): bigint[] {
  return Array.from(new Set(values.map((value) => value.toString())))
    .map((value) => BigInt(value))
    .sort(compareBigInt);
}

function parsePositiveBigInt(value: unknown): bigint | null {
  try {
    const parsed =
      typeof value === "bigint" ? value : BigInt(String(value ?? ""));
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

function parseOptionalPositiveBigInt(value: unknown): bigint | undefined {
  if (value === undefined || value === null) return undefined;
  return parsePositiveBigInt(value) ?? undefined;
}

function parseOptionalNonNegativeBigInt(value: unknown): bigint | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    const parsed = typeof value === "bigint" ? value : BigInt(String(value));
    return parsed >= 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function compareBigInt(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Decrypt a tlock-encrypted ciphertext using the drand beacon.
 * Ciphertext on-chain is hex-encoded UTF-8 armored AGE string.
 * Plaintext is 36 bytes: [uint8 version, uint8 isUp, uint16 predictedUpBps, bytes32 salt].
 */
// Valid tlock ciphertexts are ~600-800 bytes; 4KB is a generous upper bound.
const MAX_CIPHERTEXT_BYTES = 4096;

export async function decryptTlockVoteCiphertext(
  ciphertext: `0x${string}`,
  drandChainHash?: `0x${string}`,
): Promise<{
  isUp: boolean;
  predictedUpBps: number;
  predictedUpPercent: number;
  salt: `0x${string}`;
} | null> {
  const hex = ciphertext.startsWith("0x") ? ciphertext.slice(2) : ciphertext;
  if (hex.length / 2 > MAX_CIPHERTEXT_BYTES) return null;
  // Convert hex bytes back to UTF-8 armored string
  const armored = Buffer.from(hex, "hex").toString("utf-8");
  const client = resolveTlockClientForDrandChain(
    drandChainHash ?? parseTlockCiphertextMetadata(ciphertext)?.drandChainHash,
  );

  const plaintext = await timelockDecrypt(armored, client);
  return decodeRbtsVotePlaintext(plaintext);
}

function validateCiphertextMetadata(
  commit: CommitData,
  ciphertext: `0x${string}`,
): { ok: true } | { ok: false; reason: string } {
  if (commit.targetRound == null || commit.drandChainHash == null) {
    return {
      ok: false,
      reason: "missing tlock metadata on the stored commit",
    };
  }

  const metadata = parseTlockCiphertextMetadata(ciphertext);
  if (!metadata) {
    return {
      ok: false,
      reason: "malformed tlock ciphertext metadata",
    };
  }

  if (
    metadata.targetRound !== commit.targetRound ||
    metadata.drandChainHash !== commit.drandChainHash
  ) {
    return {
      ok: false,
      reason: `tlock metadata mismatch (stored round ${commit.targetRound.toString()}, ciphertext round ${metadata.targetRound.toString()})`,
    };
  }

  return { ok: true };
}

interface IndexedCiphertextRecord {
  commitKey?: `0x${string}`;
  ciphertextHash?: `0x${string}`;
  ciphertext?: `0x${string}`;
}

type IndexedCiphertextMap = Map<string, IndexedCiphertextRecord>;

function indexedCiphertextKey(commitKey: `0x${string}`): string {
  return commitKey.toLowerCase();
}

async function fetchIndexedCiphertextsForRound(params: {
  kind: "vote" | "advisory";
  contentId: bigint;
  roundId: bigint;
  logger: Logger;
}): Promise<IndexedCiphertextMap | null> {
  if (!config.ponderBaseUrl) {
    params.logger.warn(
      "PONDER_BASE_URL is not configured; cannot fetch indexed vote ciphertexts",
      {
        kind: params.kind,
        contentId: Number(params.contentId),
        roundId: Number(params.roundId),
      },
    );
    return null;
  }

  try {
    const headers = buildPonderRequestHeaders();
    await assertPonderDeploymentMatchesKeeper(config.ponderBaseUrl, headers);
    const path = params.kind === "vote" ? "/votes" : "/advisory-votes";
    const indexedCiphertexts: IndexedCiphertextMap = new Map();
    for (let page = 0; page < MAX_INDEXED_CIPHERTEXT_PAGES; page++) {
      const url = buildPonderUrl(config.ponderBaseUrl, path);
      url.searchParams.set("contentId", params.contentId.toString());
      url.searchParams.set("roundId", params.roundId.toString());
      url.searchParams.set("limit", String(INDEXED_CIPHERTEXT_PAGE_SIZE));
      url.searchParams.set(
        "offset",
        String(page * INDEXED_CIPHERTEXT_PAGE_SIZE),
      );

      // H-4 (2026-05-22 audit): previously fetched without any timeout, so a slow Ponder
      // response could stall the whole reveal loop. 5s is well above Ponder's normal
      // p99; anything beyond is unhealthy and the keeper retries on the next tick.
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(PONDER_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        incrementCounter("keeper_ponder_ciphertext_fetch_failures_total");
        params.logger.warn("Failed to fetch indexed vote ciphertext", {
          kind: params.kind,
          status: response.status,
          url: url.toString(),
        });
        return null;
      }

      const body = (await response.json()) as {
        items?: IndexedCiphertextRecord[];
      };
      const items = body.items ?? [];
      for (const item of items) {
        if (item.commitKey) {
          indexedCiphertexts.set(indexedCiphertextKey(item.commitKey), item);
        }
      }
      if (items.length < INDEXED_CIPHERTEXT_PAGE_SIZE)
        return indexedCiphertexts;
    }
    // Currently unreachable for protocol-capped rounds (max 200 voters), but a governance
    // cap raise past MAX_INDEXED_CIPHERTEXT_PAGES * INDEXED_CIPHERTEXT_PAGE_SIZE commits
    // would otherwise silently truncate the map. Commits beyond the limit are no longer
    // permanently unrevealable — the eth_getLogs fallback recovers them — but every such
    // round would silently lean on the slower on-chain log scan, so still warn loudly.
    params.logger.warn(
      "Indexed ciphertext page limit reached; commits beyond the limit fall back to on-chain logs",
      {
        kind: params.kind,
        contentId: Number(params.contentId),
        roundId: Number(params.roundId),
        maxCommits: MAX_INDEXED_CIPHERTEXT_PAGES * INDEXED_CIPHERTEXT_PAGE_SIZE,
      },
    );
    return indexedCiphertexts;
  } catch (err: unknown) {
    incrementCounter("keeper_ponder_ciphertext_fetch_failures_total");
    params.logger.warn("Failed to resolve indexed vote ciphertexts", {
      kind: params.kind,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// Reveal-liveness fallback (design review 2026-06, finding 3): Ponder is the primary
// ciphertext source, but every commit's full ciphertext is also emitted on-chain in the
// VoteCommitted / AdvisoryVoteRecorded events. When Ponder is down or its response is
// missing a commit, rebuild the ciphertext map straight from `eth_getLogs` so a Ponder
// outage alone can never stall reveals into a RevealFailed finalization.
const LOG_FALLBACK_CHUNK_BLOCKS = 10_000n;

const voteCommittedEvent = getAbiItem({
  abi: RoundVotingEngineAbi,
  name: "VoteCommitted",
}) as AbiEvent;
const advisoryVoteRecordedEvent = getAbiItem({
  abi: AdvisoryVoteRecorderAbi,
  name: "AdvisoryVoteRecorded",
}) as AbiEvent;

interface CommitEventArgs {
  voter?: `0x${string}`;
  commitHash?: `0x${string}`;
  advisoryCommitKey?: `0x${string}`;
  ciphertextHash?: `0x${string}`;
  ciphertext?: `0x${string}`;
}

async function fetchLogCiphertextsForRound(params: {
  publicClient: Pick<PublicClient, "getBlockNumber" | "getLogs">;
  kind: "vote" | "advisory";
  contractAddress: `0x${string}`;
  contentId: bigint;
  roundId: bigint;
  neededCommitKeys: ReadonlySet<string>;
  logger: Logger;
}): Promise<IndexedCiphertextMap | null> {
  try {
    const latestBlock = await params.publicClient.getBlockNumber();
    const lookback = BigInt(config.logFallbackLookbackBlocks);
    const minBlock = latestBlock > lookback ? latestBlock - lookback : 0n;
    const event =
      params.kind === "vote" ? voteCommittedEvent : advisoryVoteRecordedEvent;
    const logCiphertexts: IndexedCiphertextMap = new Map();

    // Scan backwards from the chain head in bounded chunks (RPC providers commonly cap
    // getLogs ranges) and stop as soon as every commit key of the round is covered —
    // commits cluster near the round window, so this normally takes a single request.
    let toBlock = latestBlock;
    while (toBlock >= minBlock) {
      const fromBlock =
        toBlock >= minBlock + LOG_FALLBACK_CHUNK_BLOCKS
          ? toBlock - LOG_FALLBACK_CHUNK_BLOCKS + 1n
          : minBlock;
      const logs = await params.publicClient.getLogs({
        address: params.contractAddress,
        event,
        args: { contentId: params.contentId, roundId: params.roundId },
        fromBlock,
        toBlock,
      });
      for (const log of logs) {
        const args = (log as { args?: CommitEventArgs }).args ?? {};
        const commitKey =
          params.kind === "vote"
            ? args.voter && args.commitHash
              ? buildCommitKey(args.voter, args.commitHash)
              : null
            : (args.advisoryCommitKey ?? null);
        if (!commitKey || !args.ciphertextHash || !args.ciphertext) continue;
        logCiphertexts.set(indexedCiphertextKey(commitKey), {
          commitKey,
          ciphertextHash: args.ciphertextHash,
          ciphertext: args.ciphertext,
        });
      }

      let allFound = true;
      for (const needed of params.neededCommitKeys) {
        if (!logCiphertexts.has(needed)) {
          allFound = false;
          break;
        }
      }
      if (allFound) break;
      toBlock = fromBlock - 1n;
    }

    return logCiphertexts;
  } catch (err: unknown) {
    params.logger.warn("Failed to fetch on-chain ciphertext logs", {
      kind: params.kind,
      contentId: params.contentId.toString(),
      roundId: params.roundId.toString(),
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function getIndexedCiphertext(params: {
  indexedCiphertexts: IndexedCiphertextMap;
  kind: "vote" | "advisory";
  commitKey: `0x${string}`;
  expectedCiphertextHash: `0x${string}`;
  logger: Logger;
}): `0x${string}` | null {
  const record = params.indexedCiphertexts.get(
    indexedCiphertextKey(params.commitKey),
  );
  if (!record?.ciphertext || !record.ciphertextHash) {
    return null;
  }
  if (
    record.ciphertextHash.toLowerCase() !==
    params.expectedCiphertextHash.toLowerCase()
  ) {
    params.logger.error(
      "Indexed ciphertext hash does not match on-chain commit hash",
      {
        kind: params.kind,
        commitKey: params.commitKey,
        indexedCiphertextHash: record.ciphertextHash,
        expectedCiphertextHash: params.expectedCiphertextHash,
      },
    );
    return null;
  }
  if (keccak256(record.ciphertext) !== params.expectedCiphertextHash) {
    params.logger.error(
      "Indexed ciphertext bytes do not hash to on-chain ciphertext hash",
      {
        kind: params.kind,
        commitKey: params.commitKey,
        expectedCiphertextHash: params.expectedCiphertextHash,
      },
    );
    return null;
  }
  return record.ciphertext;
}

/**
 * Main keeper loop: iterate all content, reveal votes, progress rounds, clean terminal
 * round leftovers, and sweep dormant content.
 */
export async function resolveRounds(
  publicClient: PublicClient,
  walletClient: WalletClient,
  chain: Chain,
  account: Account,
  logger: Logger,
  runContext?: KeeperRunContext,
): Promise<KeeperResult> {
  const engineAddr = config.contracts.votingEngine;
  const registryAddr = config.contracts.contentRegistry;
  const advisoryAddr = config.contracts.advisoryVoteRecorder;

  // Use on-chain block.timestamp — this is what the contract uses for checks.
  // KEEPER-1 (2026-05-21 repo audit): on RPC failure, `resolveOnChainNowSeconds` extrapolates
  // from the last successful block timestamp (bounded). It throws if there's no cached value or
  // the cache is too stale, so the keeper short-circuits this iteration loudly rather than
  // continuing on a possibly-skewed system clock.
  // A total RPC outage must surface as a FAILED tick: throwing here propagates to
  // tick()'s error path (recordError -> consecutiveErrors / keeper_errors_total), so
  // /health degrades instead of the outage looking like an endless successful empty run.
  let now: bigint;
  try {
    now = await resolveOnChainNowSeconds(publicClient);
    if (runContext) {
      runContext.blockTimestamp = now;
    }
  } catch (err) {
    throw new Error(
      `Cannot resolve current block time: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const result: KeeperResult = emptyResult();

  // --- Discover work candidates ---
  // Like the block-time read above, a total discovery outage here is a fatal whole-tick
  // failure: propagate it so recordRun is not called and the tick is counted as an
  // error. Non-production Ponder failures fall back to chain enumeration inside
  // discoverKeeperWorkCandidates; production Ponder auth/HTTP errors and missing
  // PONDER_KEEPER_WORK_TOKEN throw. Per-round failures further down keep their
  // partial-failure semantics.
  let discovery: KeeperWorkDiscovery;
  try {
    discovery = await discoverKeeperWorkCandidates(
      publicClient,
      registryAddr,
      now,
      logger,
    );
  } catch (err) {
    throw new Error(
      `Keeper work discovery failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  for (const candidate of discovery.cleanupRounds) {
    enqueueRoundForCleanup(candidate.contentId, candidate.roundId);
  }

  result.roundsOpened += await _openRequestedRounds(
    publicClient,
    walletClient,
    chain,
    account,
    logger,
    engineAddr,
    discovery.roundOpenRequests,
  );

  // --- Process discovered content items ---
  for (const contentId of discovery.contentIds) {
    try {
      // Get the current round IDs for this content.
      let activeRoundId: bigint;
      let latestRoundId: bigint;
      try {
        ({ activeRoundId, latestRoundId } = await readCurrentRoundIds(
          publicClient,
          engineAddr,
          contentId,
        ));
      } catch {
        activeRoundId = 0n;
        latestRoundId = 0n;
      }

      let activeRoundBlocksDormancy: boolean | undefined;
      const readActiveRoundBlocksDormancy = async () => {
        if (activeRoundBlocksDormancy === undefined) {
          activeRoundBlocksDormancy = (await publicClient.readContract({
            address: engineAddr,
            abi: RoundVotingEngineAbi,
            functionName: "isDormancyBlocked",
            args: [contentId],
          })) as boolean;
        }
        return activeRoundBlocksDormancy;
      };

      if (activeRoundId > 0n) {
        // --- 1. REVEAL LOOP: Decrypt and reveal unrevealed commits ---
        const revealOutcome = await _revealCommits(
          publicClient,
          walletClient,
          chain,
          account,
          logger,
          engineAddr,
          contentId,
          activeRoundId,
          now,
        );
        result.votesRevealed += revealOutcome.revealed;
        result.advisoryVotesRevealed += await _revealAdvisoryCommits(
          publicClient,
          walletClient,
          chain,
          account,
          logger,
          advisoryAddr,
          contentId,
          activeRoundId,
          now,
        );

        // Re-read round after reveals to get updated state
        let round: RoundData;
        let roundConfig: RoundVotingConfig;
        try {
          [round, roundConfig] = await Promise.all([
            readRound(publicClient, engineAddr, contentId, activeRoundId),
            readRoundConfigForRound(
              publicClient,
              engineAddr,
              contentId,
              activeRoundId,
            ),
          ]);
        } catch {
          continue;
        }

        // --- 2. SETTLE: If settlement threshold reached (not necessarily full-strength economics) ---
        const rbtsRevealQuorum =
          roundConfig.minVoters > 3n ? roundConfig.minVoters : 3n;
        if (
          round.state === RoundState.Open &&
          round.revealedCount >= rbtsRevealQuorum
        ) {
          try {
            await writeContractAndConfirm(publicClient, walletClient, {
              chain,
              account,
              address: engineAddr,
              abi: RoundVotingEngineAbi,
              functionName: "settleRound",
              args: [contentId, activeRoundId],
            });
            round = await readRound(
              publicClient,
              engineAddr,
              contentId,
              activeRoundId,
            );
            if (round.state === RoundState.Open) {
              logger.info("Captured RBTS settlement seed", {
                contentId: contentId.toString(),
                roundId: Number(activeRoundId),
              });
            } else if (
              round.state === RoundState.Settled ||
              round.state === RoundState.Tied
            ) {
              logger.info("Settled round", {
                contentId: contentId.toString(),
                roundId: Number(activeRoundId),
              });
              result.roundsSettled++;
              enqueueRoundForCleanup(contentId, activeRoundId);
              result.advisoryLaunchCreditsClaimed +=
                await _claimAdvisoryLaunchCredits(
                  publicClient,
                  walletClient,
                  chain,
                  account,
                  logger,
                  advisoryAddr,
                  contentId,
                  activeRoundId,
                );

              // Drive bundle qualification (no-op for non-bundled content). Settlement only
              // records the round into the bundle slot; qualification — which iterates voters
              // and bundle questions — is intentionally deferred to keep settlement O(1).
              // A hostile funder could otherwise wait for the refund window and reclaim
              // rewards voters have earned, since `refundQuestionBundleReward` reads
              // `bundle.completedRoundSets` (which only advances on qualification).
              await _syncBundleQuestionTerminal(
                publicClient,
                walletClient,
                chain,
                account,
                registryAddr,
                contentId,
                activeRoundId,
                logger,
              );
            }
          } catch (err: unknown) {
            const reason = getRevertReason(err);
            if (!isExpectedRevert(reason)) {
              logger.warn("Failed to settle round", {
                contentId: contentId.toString(),
                roundId: Number(activeRoundId),
                error: reason,
              });
            }
          }
        }

        // --- 3. REVEAL FAILED: commit quorum reached, reveal quorum never did ---
        if (
          round.state === RoundState.Open &&
          round.voteCount >= rbtsRevealQuorum &&
          round.revealedCount < rbtsRevealQuorum
        ) {
          result.roundsAwaitingRevealQuorum++;
          try {
            const [roundLifecycle, blocksDormancy] = await Promise.all([
              readRoundLifecycleState(
                publicClient,
                engineAddr,
                contentId,
                activeRoundId,
              ),
              readActiveRoundBlocksDormancy(),
            ]);
            const lastCommitRevealableAfter =
              roundLifecycle.lastCommitRevealableAfter;
            // Mirrors RoundCleanupLib.REVEAL_FAILED_GRACE_MULTIPLIER: the on-chain
            // reveal-failed deadline is the snapshotted grace period times 24, so
            // computing it with the base grace would submit finalization transactions
            // ~23 hours early and burn gas on RevealGraceActive reverts.
            const revealFailedGrace =
              roundLifecycle.revealGracePeriod * REVEAL_FAILED_GRACE_MULTIPLIER_BI;

            const revealFailedEligibleAt =
              lastCommitRevealableAfter >
              round.startTime + roundConfig.maxDuration
                ? lastCommitRevealableAfter + revealFailedGrace
                : round.startTime + roundConfig.maxDuration + revealFailedGrace;

            if (lastCommitRevealableAfter > 0n) {
              const remainingS =
                revealFailedEligibleAt > now
                  ? Number(revealFailedEligibleAt - now)
                  : 0;
              if (
                result.minRevealGraceSecondsRemaining === null ||
                remainingS < result.minRevealGraceSecondsRemaining
              ) {
                result.minRevealGraceSecondsRemaining = remainingS;
              }
            }

            if (
              blocksDormancy &&
              lastCommitRevealableAfter > 0n &&
              now >= revealFailedEligibleAt
            ) {
              if (revealOutcome.infrastructureFailure) {
                // Never finalize while this tick's reveal pipeline was blocked by
                // infrastructure (ciphertexts unavailable, drand relays down, RPC
                // reads failing): finalization forfeits unrevealed stakes, and a
                // systemic outage must not be billed to voters.
                // finalizeRevealFailedRound stays permissionless on-chain, so this
                // only stops THIS keeper from finalizing rounds it failed to reveal
                // itself.
                incrementCounter("keeper_reveal_failed_finalize_skipped_total");
                logger.warn(
                  "Skipping reveal-failed finalization; reveal pipeline was unhealthy this tick",
                  {
                    contentId: contentId.toString(),
                    roundId: Number(activeRoundId),
                  },
                );
              } else {
                await writeContractAndConfirm(publicClient, walletClient, {
                  chain,
                  account,
                  address: engineAddr,
                  abi: RoundVotingEngineAbi,
                  functionName: "finalizeRevealFailedRound",
                  args: [contentId, activeRoundId],
                });
                logger.info("Finalized reveal-failed round", {
                  contentId: contentId.toString(),
                  roundId: Number(activeRoundId),
                });
                result.roundsRevealFailedFinalized++;
                enqueueRoundForCleanup(contentId, activeRoundId);
              }
            }
          } catch (err: unknown) {
            const reason = getRevertReason(err);
            if (!isExpectedRevert(reason)) {
              logger.warn("Failed to finalize reveal-failed round", {
                contentId: contentId.toString(),
                roundId: Number(activeRoundId),
                error: reason,
              });
            }
          }
        }

        // --- 4. CANCEL: Open rounds past maxDuration that cannot enter reveal-failed settlement ---
        if (
          round.state === RoundState.Open &&
          round.revealedCount < rbtsRevealQuorum &&
          round.startTime > 0n &&
          now >= round.startTime + roundConfig.maxDuration
        ) {
          try {
            const blocksDormancy =
              round.voteCount < rbtsRevealQuorum
                ? true
                : await readActiveRoundBlocksDormancy();
            if (round.voteCount < rbtsRevealQuorum || !blocksDormancy) {
              await writeContractAndConfirm(publicClient, walletClient, {
                chain,
                account,
                address: engineAddr,
                abi: RoundVotingEngineAbi,
                functionName: "cancelExpiredRound",
                args: [contentId, activeRoundId],
              });
              logger.info("Cancelled expired round", {
                contentId: contentId.toString(),
                roundId: Number(activeRoundId),
              });
              result.roundsCancelled++;
            }
          } catch (err: unknown) {
            const reason = getRevertReason(err);
            if (!isExpectedRevert(reason)) {
              logger.warn("Failed to cancel expired round", {
                contentId: contentId.toString(),
                roundId: Number(activeRoundId),
                error: reason,
              });
            }
          }
        }
      }

      // --- 5. CLEANUP DISCOVERY: inspect at most one historical round per content ---
      try {
        await discoverCleanupCandidate(
          publicClient,
          engineAddr,
          contentId,
          latestRoundId,
        );
      } catch (err: unknown) {
        logger.debug("Could not discover cleanup candidate", {
          contentId: contentId.toString(),
          error: getRevertReason(err),
        });
      }

      if (latestRoundId > 0n) {
        result.advisoryLaunchCreditsClaimed +=
          await _claimAdvisoryLaunchCredits(
            publicClient,
            walletClient,
            chain,
            account,
            logger,
            advisoryAddr,
            contentId,
            latestRoundId,
          );
      }

      // --- 6. Dormancy sweep ---
      // ContentRegistry.markDormant actually gates on `dormancyAnchorAt` (bumped only by
      // submission, revival, and meaningful settlement — vote commits deliberately bump
      // `lastActivityAt` but NOT the anchor) and hard-reverts "Bundled content" when
      // `contentBundleId != 0`. Neither mapping has a public view, so the keeper cannot
      // read them directly. `lastActivityAt` is a safe pre-filter because every anchor
      // bump also bumps `lastActivityAt`, so `lastActivityAt >= dormancyAnchorAt` always:
      // with config.dormancyPeriod clamped to the contract's 30-day DORMANCY_PERIOD
      // (see config.ts), this check never fires before the contract would accept it —
      // at worst it fires late for content kept "active" by vote commits alone.
      // Bundled content cannot be detected up front; the pre-broadcast gas estimation
      // in writeContractAndConfirm catches its revert without burning gas, and the
      // catch below treats it as an expected skip.
      try {
        const rawContent = await publicClient.readContract({
          address: registryAddr,
          abi: ContentRegistryAbi,
          functionName: "contents",
          args: [contentId],
        });
        const contentTuple = rawContent as unknown as Record<string, unknown> &
          readonly unknown[];
        const status = Number(contentTuple.status ?? contentTuple[5] ?? -1);
        const lastActivityAt = BigInt(
          String(contentTuple.lastActivityAt ?? contentTuple[4] ?? 0),
        );
        const blocksDormancy =
          activeRoundId > 0n ? await readActiveRoundBlocksDormancy() : false;
        const dormancyEligible =
          status === 0 &&
          !blocksDormancy &&
          lastActivityAt > 0n &&
          now > lastActivityAt + config.dormancyPeriod;

        if (dormancyEligible) {
          await writeContractAndConfirm(publicClient, walletClient, {
            chain,
            account,
            address: registryAddr,
            abi: ContentRegistryAbi,
            functionName: "markDormant",
            args: [contentId],
          });
          logger.info("Marked content as dormant", {
            contentId: contentId.toString(),
          });
          result.contentMarkedDormant++;
        }
      } catch (err: unknown) {
        const reason = getRevertReason(err);
        // "Bundled content" and "Dormancy period not elapsed" are expected skips: the
        // keeper cannot read contentBundleId / dormancyAnchorAt (no views exist), so it
        // discovers them via the pre-broadcast estimation revert.
        if (
          !reason.includes("pending votes") &&
          !reason.includes("Content has active round") &&
          !reason.includes("Bundled content") &&
          !reason.includes("Dormancy period not elapsed")
        ) {
          logger.debug("Could not check dormancy", {
            contentId: contentId.toString(),
            error: reason,
          });
        }
      }
    } catch (err: unknown) {
      logger.error("Error processing content", {
        contentId: contentId.toString(),
        error: getRevertReason(err),
      });
    }
  }

  result.cleanupBatchesProcessed += await _processQueuedCleanupRounds(
    publicClient,
    walletClient,
    chain,
    account,
    logger,
    engineAddr,
  );

  result.feedbackBonusPoolsForfeited += await _forfeitExpiredFeedbackBonuses(
    publicClient,
    walletClient,
    chain,
    account,
    logger,
    discovery.feedbackBonusForfeits,
  );

  return result;
}

function isExpectedRoundOpenRevert(reason: string): boolean {
  const benign = [
    "ContentNotActive",
    "SelfVote",
    "ConfidentialityCredentialRequired",
    "ConfidentialityBondRequired",
    "IdentityBanned",
    "RoundNotOpen",
    "ThresholdReached",
    "EnforcedPause",
    "Pausable",
  ];
  const lower = reason.toLowerCase();
  return benign.some((phrase) => lower.includes(phrase.toLowerCase()));
}

async function _openRequestedRounds(
  publicClient: PublicClient,
  walletClient: WalletClient,
  chain: Chain,
  account: Account,
  logger: Logger,
  engineAddr: `0x${string}`,
  candidates: readonly KeeperWorkContentCandidate[],
): Promise<number> {
  if (candidates.length === 0) {
    return 0;
  }

  let opened = 0;
  for (const candidate of candidates) {
    try {
      const { activeRoundId } = await readCurrentRoundIds(
        publicClient,
        engineAddr,
        candidate.contentId,
      );
      if (activeRoundId > 0n) {
        logger.debug("Skipped proactive round open; active round already exists", {
          contentId: candidate.contentId.toString(),
          reason: candidate.reason,
          roundId: activeRoundId.toString(),
        });
        continue;
      }

      await writeContractAndConfirm(publicClient, walletClient, {
        chain,
        account,
        address: engineAddr,
        abi: RoundVotingEngineAbi,
        functionName: "openRound",
        args: [candidate.contentId],
      });
      opened++;
      logger.info("Proactively opened rating round", {
        contentId: candidate.contentId.toString(),
        reason: candidate.reason,
      });
    } catch (err: unknown) {
      const reason = getRevertReason(err);
      if (isExpectedRoundOpenRevert(reason)) {
        logger.debug("Skipped proactive round open candidate", {
          contentId: candidate.contentId.toString(),
          reason: candidate.reason,
          error: reason,
        });
        continue;
      }

      logger.warn("Failed to proactively open rating round", {
        contentId: candidate.contentId.toString(),
        reason: candidate.reason,
        error: reason,
      });
    }
  }

  return opened;
}

function isExpectedFeedbackBonusForfeitRevert(reason: string): boolean {
  const benign = [
    "Already forfeited",
    "Not expired",
    "No funds",
    "EnforcedPause",
    "Pausable",
  ];
  const lower = reason.toLowerCase();
  return benign.some((phrase) => lower.includes(phrase.toLowerCase()));
}

async function _forfeitExpiredFeedbackBonuses(
  publicClient: PublicClient,
  walletClient: WalletClient,
  chain: Chain,
  account: Account,
  logger: Logger,
  candidates: readonly KeeperWorkFeedbackBonusForfeitCandidate[],
): Promise<number> {
  const feedbackBonusForfeits = config.feedbackBonusForfeits ?? {
    enabled: false,
    maxPoolsPerTick: 0,
  };
  const escrowAddr = config.contracts.feedbackBonusEscrow;
  if (
    !feedbackBonusForfeits.enabled ||
    feedbackBonusForfeits.maxPoolsPerTick <= 0 ||
    !escrowAddr ||
    escrowAddr === zeroAddress ||
    candidates.length === 0
  ) {
    return 0;
  }

  let forfeited = 0;
  for (const candidate of candidates.slice(
    0,
    feedbackBonusForfeits.maxPoolsPerTick,
  )) {
    try {
      await writeContractAndConfirm(publicClient, walletClient, {
        chain,
        account,
        address: escrowAddr,
        abi: FeedbackBonusEscrowAbi,
        functionName: "forfeitExpiredFeedbackBonus",
        args: [candidate.poolId],
      });
      forfeited++;
      logger.info("Forfeited expired Feedback Bonus pool", {
        poolId: candidate.poolId.toString(),
        contentId: candidate.contentId?.toString(),
        roundId: candidate.roundId?.toString(),
        remainingAmount: candidate.remainingAmount?.toString(),
      });
    } catch (err: unknown) {
      const reason = getRevertReason(err);
      if (isExpectedFeedbackBonusForfeitRevert(reason)) {
        logger.debug("Skipped Feedback Bonus forfeit candidate", {
          poolId: candidate.poolId.toString(),
          contentId: candidate.contentId?.toString(),
          roundId: candidate.roundId?.toString(),
          error: reason,
        });
        continue;
      }

      incrementCounter("keeper_feedback_bonus_forfeit_failures_total");
      logger.warn("Failed to forfeit expired Feedback Bonus pool", {
        poolId: candidate.poolId.toString(),
        contentId: candidate.contentId?.toString(),
        roundId: candidate.roundId?.toString(),
        error: reason,
      });
    }
  }

  return forfeited;
}

// Small headroom over eth_estimateGas so minor state drift between estimation and
// inclusion (e.g. another keeper's reveal landing first) does not OOG the transaction.
const GAS_ESTIMATE_BUFFER_NUMERATOR = 12n;
const GAS_ESTIMATE_BUFFER_DENOMINATOR = 10n;

export async function writeContractAndConfirm(
  publicClient: Pick<PublicClient, "waitForTransactionReceipt">,
  walletClient: WalletClient,
  request: Parameters<WalletClient["writeContract"]>[0],
): Promise<`0x${string}`> {
  // Estimate gas BEFORE broadcasting. Supplying an explicit `gas` makes viem skip
  // eth_estimateGas — the keeper's only pre-broadcast simulation — so the old behavior
  // of unconditionally setting `gas = maxGasPerTx` broadcast every transaction whose
  // contract conditions were not met, mining a revert and burning gas on every benign
  // race (AlreadyRevealed, UnrevealedPastEpochVotes, "Bundled content", redundant
  // keeper instances, ...). Instead, estimate first: if estimation reverts, the error
  // propagates to the caller's existing getRevertReason/isExpectedRevert classification
  // and nothing is broadcast. maxGasPerTx acts purely as a CAP on the estimate.
  if (!request.gas) {
    const estimateContractGas = (
      publicClient as Partial<Pick<PublicClient, "estimateContractGas">>
    ).estimateContractGas;
    if (estimateContractGas) {
      const req = request as {
        address: `0x${string}`;
        abi: unknown;
        functionName: string;
        args?: readonly unknown[];
        account?: unknown;
        value?: bigint;
      };
      const estimate = await estimateContractGas.call(publicClient, {
        address: req.address,
        abi: req.abi,
        functionName: req.functionName,
        args: req.args,
        account: req.account,
        ...(req.value !== undefined ? { value: req.value } : {}),
      } as Parameters<PublicClient["estimateContractGas"]>[0]);

      const cap = config.maxGasPerTx > 0 ? BigInt(config.maxGasPerTx) : null;
      if (cap !== null && estimate > cap) {
        // Broadcasting with `gas = cap` would deterministically run out of gas on-chain
        // and burn the entire cap. Refuse instead.
        throw new Error(
          `Estimated gas ${estimate} exceeds MAX_GAS_PER_TX ${config.maxGasPerTx}; not broadcasting`,
        );
      }
      const buffered =
        (estimate * GAS_ESTIMATE_BUFFER_NUMERATOR) /
        GAS_ESTIMATE_BUFFER_DENOMINATOR;
      request.gas = cap !== null && buffered > cap ? cap : buffered;
    } else if (config.maxGasPerTx > 0) {
      // Test doubles without estimateContractGas: keep the legacy hard cap.
      request.gas = BigInt(config.maxGasPerTx);
    }
  }

  const hash = await walletClient.writeContract(request);

  const waitForReceipt = (
    publicClient as {
      waitForTransactionReceipt?: (args: {
        hash: `0x${string}`;
      }) => Promise<{ status: string }>;
    }
  ).waitForTransactionReceipt;
  if (waitForReceipt) {
    const receipt = await waitForReceipt.call(publicClient, { hash });
    if (receipt && receipt.status === "reverted") {
      throw new Error(`Transaction ${hash} reverted on-chain`);
    }
  }

  return hash;
}

interface RevealCommitsOutcome {
  revealed: number;
  /**
   * True when at least one pending reveal was blocked by infrastructure this tick:
   * ciphertext bytes unavailable from both Ponder and the on-chain log fallback, every
   * drand relay down, or the commit set unreadable over RPC. Distinct from legitimate
   * skips (not yet revealable, permanently bad ciphertexts). While true, the keeper
   * must not finalize the round as RevealFailed — that would convert the keeper's own
   * outage into voter stake forfeitures (design review 2026-06, finding 3).
   */
  infrastructureFailure: boolean;
}

/**
 * Reveal all unrevealed commits for a round whose epoch has ended.
 * Returns the number of votes revealed and whether infrastructure blocked any reveal.
 */
async function _revealCommits(
  publicClient: PublicClient,
  walletClient: WalletClient,
  chain: Chain,
  account: Account,
  logger: Logger,
  engineAddr: `0x${string}`,
  contentId: bigint,
  roundId: bigint,
  now: bigint,
): Promise<RevealCommitsOutcome> {
  let revealed = 0;
  let infrastructureFailure = false;

  // Get all commit keys for this round
  let commitKeys: readonly `0x${string}`[];
  try {
    commitKeys = await readRoundCommitKeys(
      publicClient,
      engineAddr,
      contentId,
      roundId,
    );
  } catch {
    return { revealed: 0, infrastructureFailure: true };
  }

  let indexedCiphertexts: IndexedCiphertextMap | null | undefined;
  let logCiphertexts: IndexedCiphertextMap | null | undefined;
  for (const commitKey of commitKeys) {
    try {
      // Read commit data
      const rawCommit = await publicClient.readContract({
        address: engineAddr,
        abi: RoundVotingEngineAbi,
        functionName: "commitRevealData",
        args: [contentId, roundId, commitKey],
      });
      const commit = parseCommitData(rawCommit);

      // Skip if already revealed or epoch not ended
      if (commit.revealed) continue;
      if (now < commit.revealableAfter) continue;

      // Skip commitKeys that have permanently failed decryption
      const priorFailures = decryptFailureCount.get(commitKey) ?? 0;
      if (priorFailures >= MAX_DECRYPT_RETRIES) continue;

      if (indexedCiphertexts === undefined) {
        indexedCiphertexts = await fetchIndexedCiphertextsForRound({
          kind: "vote",
          contentId,
          roundId,
          logger,
        });
      }
      let ciphertext = indexedCiphertexts
        ? getIndexedCiphertext({
            indexedCiphertexts,
            kind: "vote",
            commitKey,
            expectedCiphertextHash: commit.ciphertextHash,
            logger,
          })
        : null;
      if (!ciphertext) {
        if (logCiphertexts === undefined) {
          logCiphertexts = await fetchLogCiphertextsForRound({
            publicClient,
            kind: "vote",
            contractAddress: engineAddr,
            contentId,
            roundId,
            neededCommitKeys: new Set(commitKeys.map(indexedCiphertextKey)),
            logger,
          });
        }
        if (logCiphertexts) {
          ciphertext = getIndexedCiphertext({
            indexedCiphertexts: logCiphertexts,
            kind: "vote",
            commitKey,
            expectedCiphertextHash: commit.ciphertextHash,
            logger,
          });
          if (ciphertext) {
            incrementCounter("keeper_ciphertext_log_fallback_total");
            logger.info("Resolved vote ciphertext from on-chain logs", {
              contentId: contentId.toString(),
              roundId: roundId.toString(),
              commitKey,
            });
          }
        }
      }
      if (!ciphertext) {
        // Neither Ponder nor the on-chain log fallback produced verifiable ciphertext
        // bytes for a pending commit — data unavailability, not a voter problem.
        infrastructureFailure = true;
        continue;
      }

      const metadataValidation = validateCiphertextMetadata(commit, ciphertext);
      if (!metadataValidation.ok) {
        markPermanentDecryptFailure(commitKey);
        incrementCounter("keeper_decrypt_failures_total");
        logger.error("tlock ciphertext metadata invalid", {
          contentId: contentId.toString(),
          roundId: roundId.toString(),
          commitKey,
          permanent: true,
          error: metadataValidation.reason,
        });
        continue;
      }

      // Decrypt the tlock ciphertext using the drand beacon
      let decrypted: {
        isUp: boolean;
        predictedUpBps: number;
        predictedUpPercent: number;
        salt: `0x${string}`;
      } | null;
      try {
        decrypted = await decryptTlockVoteCiphertext(
          ciphertext,
          commit.drandChainHash,
        );
      } catch (err: unknown) {
        if (isDrandUnavailableError(err)) {
          infrastructureFailure = true;
          decryptFailureCount.delete(commitKey);
          logger.warn("All drand relays unavailable; retrying next tick", {
            contentId: contentId.toString(),
            roundId: roundId.toString(),
            commitKey,
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
        const decryptError = classifyDecryptError(err);
        if (decryptError.retryable) {
          decryptFailureCount.delete(commitKey);
          logger.debug("tlock ciphertext not decryptable yet", {
            contentId: contentId.toString(),
            roundId: roundId.toString(),
            commitKey,
            decryptableAtRound: decryptError.decryptableAtRound,
            error: decryptError.message,
          });
          continue;
        }

        const count = trackDecryptFailure(commitKey);
        incrementCounter("keeper_decrypt_failures_total");
        const logFn =
          count >= MAX_DECRYPT_RETRIES
            ? logger.error.bind(logger)
            : logger.warn.bind(logger);
        logFn("tlock decryption failed", {
          contentId: contentId.toString(),
          roundId: roundId.toString(),
          commitKey,
          attempt: count,
          permanent: count >= MAX_DECRYPT_RETRIES,
          error: decryptError.message,
        });
        continue;
      }

      if (!decrypted) {
        const count = trackDecryptFailure(commitKey);
        incrementCounter("keeper_decrypt_failures_total");
        const logFn =
          count >= MAX_DECRYPT_RETRIES
            ? logger.error.bind(logger)
            : logger.warn.bind(logger);
        logFn("Failed to decode tlock ciphertext", {
          contentId: contentId.toString(),
          roundId: roundId.toString(),
          commitKey,
          attempt: count,
          permanent: count >= MAX_DECRYPT_RETRIES,
        });
        continue;
      }

      // Successful decrypt — clear any prior failure count
      decryptFailureCount.delete(commitKey);

      // Submit reveal to chain
      try {
        await writeContractAndConfirm(publicClient, walletClient, {
          chain,
          account,
          address: engineAddr,
          abi: RoundVotingEngineAbi,
          functionName: "revealVoteByCommitKey",
          args: [
            contentId,
            roundId,
            commitKey,
            decrypted.isUp,
            decrypted.predictedUpBps,
            decrypted.salt,
          ],
        });
        logger.info("Revealed RBTS vote", {
          contentId: contentId.toString(),
          roundId: roundId.toString(),
          voter: commit.voter,
        });
        revealed++;
      } catch (err: unknown) {
        const reason = getRevertReason(err);
        if (!isExpectedRevert(reason)) {
          infrastructureFailure = true;
          logger.warn("Failed to reveal vote", {
            contentId: contentId.toString(),
            roundId: roundId.toString(),
            commitKey,
            error: reason,
          });
        }
      }
    } catch (err: unknown) {
      infrastructureFailure = true;
      logger.debug("Error processing commit", {
        contentId: contentId.toString(),
        roundId: roundId.toString(),
        commitKey,
        error: getRevertReason(err),
      });
    }
  }

  return { revealed, infrastructureFailure };
}

async function readRoundAdvisoryCommitKeys(
  publicClient: Pick<PublicClient, "readContract">,
  advisoryAddr: `0x${string}`,
  contentId: bigint,
  roundId: bigint,
): Promise<readonly `0x${string}`[]> {
  const count = (await publicClient.readContract({
    address: advisoryAddr,
    abi: AdvisoryVoteRecorderAbi,
    functionName: "roundAdvisoryCommitCount",
    args: [contentId, roundId],
  })) as bigint;
  if (count === 0n) return [];

  const total = Number(count);
  const results: `0x${string}`[] = [];
  const batchSize = 50;
  for (let offset = 0; offset < total; offset += batchSize) {
    const size = Math.min(batchSize, total - offset);
    const batch = await Promise.all(
      Array.from(
        { length: size },
        (_, i) =>
          publicClient.readContract({
            address: advisoryAddr,
            abi: AdvisoryVoteRecorderAbi,
            functionName: "getRoundAdvisoryCommitKey",
            args: [contentId, roundId, BigInt(offset + i)],
          }) as Promise<`0x${string}`>,
      ),
    );
    results.push(...batch);
  }
  return results;
}

async function _revealAdvisoryCommits(
  publicClient: PublicClient,
  walletClient: WalletClient,
  chain: Chain,
  account: Account,
  logger: Logger,
  advisoryAddr: `0x${string}`,
  contentId: bigint,
  roundId: bigint,
  now: bigint,
): Promise<number> {
  let revealed = 0;
  let commitKeys: readonly `0x${string}`[];
  try {
    commitKeys = await readRoundAdvisoryCommitKeys(
      publicClient,
      advisoryAddr,
      contentId,
      roundId,
    );
  } catch {
    return 0;
  }

  let indexedCiphertexts: IndexedCiphertextMap | null | undefined;
  let logCiphertexts: IndexedCiphertextMap | null | undefined;
  for (const commitKey of commitKeys) {
    try {
      const rawCommit = await publicClient.readContract({
        address: advisoryAddr,
        abi: AdvisoryVoteRecorderAbi,
        functionName: "advisoryCommitRevealData",
        args: [commitKey],
      });
      const commit = parseCommitData(rawCommit);
      if (commit.revealed) continue;
      if (now < commit.revealableAfter) continue;

      const priorFailures = decryptFailureCount.get(commitKey) ?? 0;
      if (priorFailures >= MAX_DECRYPT_RETRIES) continue;

      if (indexedCiphertexts === undefined) {
        indexedCiphertexts = await fetchIndexedCiphertextsForRound({
          kind: "advisory",
          contentId,
          roundId,
          logger,
        });
      }
      let ciphertext = indexedCiphertexts
        ? getIndexedCiphertext({
            indexedCiphertexts,
            kind: "advisory",
            commitKey,
            expectedCiphertextHash: commit.ciphertextHash,
            logger,
          })
        : null;
      if (!ciphertext) {
        if (logCiphertexts === undefined) {
          logCiphertexts = await fetchLogCiphertextsForRound({
            publicClient,
            kind: "advisory",
            contractAddress: advisoryAddr,
            contentId,
            roundId,
            neededCommitKeys: new Set(commitKeys.map(indexedCiphertextKey)),
            logger,
          });
        }
        if (logCiphertexts) {
          ciphertext = getIndexedCiphertext({
            indexedCiphertexts: logCiphertexts,
            kind: "advisory",
            commitKey,
            expectedCiphertextHash: commit.ciphertextHash,
            logger,
          });
          if (ciphertext) {
            incrementCounter("keeper_ciphertext_log_fallback_total");
            logger.info("Resolved advisory ciphertext from on-chain logs", {
              contentId: contentId.toString(),
              roundId: roundId.toString(),
              commitKey,
            });
          }
        }
      }
      if (!ciphertext) continue;

      const metadataValidation = validateCiphertextMetadata(commit, ciphertext);
      if (!metadataValidation.ok) {
        markPermanentDecryptFailure(commitKey);
        incrementCounter("keeper_decrypt_failures_total");
        logger.error("advisory tlock ciphertext metadata invalid", {
          contentId: contentId.toString(),
          roundId: roundId.toString(),
          commitKey,
          permanent: true,
          error: metadataValidation.reason,
        });
        continue;
      }

      let decrypted: {
        isUp: boolean;
        predictedUpBps: number;
        predictedUpPercent: number;
        salt: `0x${string}`;
      } | null;
      try {
        decrypted = await decryptTlockVoteCiphertext(
          ciphertext,
          commit.drandChainHash,
        );
      } catch (err: unknown) {
        const decryptError = classifyDecryptError(err);
        if (decryptError.retryable) {
          decryptFailureCount.delete(commitKey);
          logger.debug("advisory tlock ciphertext not decryptable yet", {
            contentId: contentId.toString(),
            roundId: roundId.toString(),
            commitKey,
            decryptableAtRound: decryptError.decryptableAtRound,
            error: decryptError.message,
          });
          continue;
        }

        const count = trackDecryptFailure(commitKey);
        incrementCounter("keeper_decrypt_failures_total");
        const logFn =
          count >= MAX_DECRYPT_RETRIES
            ? logger.error.bind(logger)
            : logger.warn.bind(logger);
        logFn("advisory tlock decryption failed", {
          contentId: contentId.toString(),
          roundId: roundId.toString(),
          commitKey,
          attempt: count,
          permanent: count >= MAX_DECRYPT_RETRIES,
          error: decryptError.message,
        });
        continue;
      }

      if (!decrypted) {
        const count = trackDecryptFailure(commitKey);
        incrementCounter("keeper_decrypt_failures_total");
        const logFn =
          count >= MAX_DECRYPT_RETRIES
            ? logger.error.bind(logger)
            : logger.warn.bind(logger);
        logFn("Failed to decode advisory tlock ciphertext", {
          contentId: contentId.toString(),
          roundId: roundId.toString(),
          commitKey,
          attempt: count,
          permanent: count >= MAX_DECRYPT_RETRIES,
        });
        continue;
      }

      decryptFailureCount.delete(commitKey);
      try {
        await writeContractAndConfirm(publicClient, walletClient, {
          chain,
          account,
          address: advisoryAddr,
          abi: AdvisoryVoteRecorderAbi,
          functionName: "revealAdvisoryVote",
          args: [
            commitKey,
            decrypted.isUp,
            decrypted.predictedUpBps,
            decrypted.salt,
          ],
        });
        logger.info("Revealed advisory vote", {
          contentId: contentId.toString(),
          roundId: roundId.toString(),
          commitKey,
        });
        revealed++;
      } catch (err: unknown) {
        const reason = getRevertReason(err);
        if (!isExpectedRevert(reason)) {
          logger.warn("Failed to reveal advisory vote", {
            contentId: contentId.toString(),
            roundId: roundId.toString(),
            commitKey,
            error: reason,
          });
        }
      }
    } catch (err: unknown) {
      logger.debug("Error processing advisory commit", {
        contentId: contentId.toString(),
        roundId: roundId.toString(),
        commitKey,
        error: getRevertReason(err),
      });
    }
  }

  return revealed;
}

async function _claimAdvisoryLaunchCredits(
  publicClient: PublicClient,
  walletClient: WalletClient,
  chain: Chain,
  account: Account,
  logger: Logger,
  advisoryAddr: `0x${string}`,
  contentId: bigint,
  roundId: bigint,
): Promise<number> {
  let claimed = 0;
  let commitKeys: readonly `0x${string}`[];
  try {
    commitKeys = await readRoundAdvisoryCommitKeys(
      publicClient,
      advisoryAddr,
      contentId,
      roundId,
    );
  } catch {
    return 0;
  }

  for (const commitKey of commitKeys) {
    try {
      const rawCore = (await publicClient.readContract({
        address: advisoryAddr,
        abi: AdvisoryVoteRecorderAbi,
        functionName: "advisoryCommitCore",
        args: [commitKey],
      })) as readonly unknown[];
      const revealed = Boolean(rawCore[5]);
      const launchCreditClaimed = Boolean(rawCore[8]);
      if (!revealed || launchCreditClaimed) continue;

      await writeContractAndConfirm(publicClient, walletClient, {
        chain,
        account,
        address: advisoryAddr,
        abi: AdvisoryVoteRecorderAbi,
        functionName: "claimAdvisoryLaunchCredit",
        args: [commitKey],
      });
      logger.info("Claimed advisory launch credit", {
        contentId: contentId.toString(),
        roundId: roundId.toString(),
        commitKey,
      });
      claimed++;
    } catch (err: unknown) {
      const reason = getRevertReason(err);
      if (!isExpectedRevert(reason)) {
        logger.debug("Could not claim advisory launch credit", {
          contentId: contentId.toString(),
          roundId: roundId.toString(),
          commitKey,
          error: reason,
        });
      }
    }
  }

  return claimed;
}

async function _processQueuedCleanupRounds(
  publicClient: PublicClient,
  walletClient: WalletClient,
  chain: Chain,
  account: Account,
  logger: Logger,
  engineAddr: `0x${string}`,
): Promise<number> {
  let batchesProcessed = 0;

  for (const cursor of Array.from(cleanupQueue.values())) {
    if (batchesProcessed >= MAX_CLEANUP_BATCHES_PER_TICK) {
      break;
    }

    let round: RoundData;
    try {
      round = await readRound(
        publicClient,
        engineAddr,
        cursor.contentId,
        cursor.roundId,
      );
    } catch (err: unknown) {
      logger.debug("Could not refresh cleanup round", {
        contentId: Number(cursor.contentId),
        roundId: Number(cursor.roundId),
        error: getRevertReason(err),
      });
      continue;
    }

    if (!isCleanupEligibleRoundState(round.state)) {
      cleanupQueue.delete(cleanupRoundKey(cursor.contentId, cursor.roundId));
      continue;
    }

    const cleanupResult = await _processRoundCleanupBatch(
      publicClient,
      walletClient,
      chain,
      account,
      logger,
      engineAddr,
      cursor.contentId,
      cursor.roundId,
      cursor.nextIndex,
    );

    batchesProcessed += cleanupResult.batchesProcessed;

    if (cleanupResult.done) {
      markCleanupCompleted(cursor.contentId, cursor.roundId);
    } else {
      cursor.nextIndex = cleanupResult.nextIndex;
    }
  }

  return batchesProcessed;
}

async function _processRoundCleanupBatch(
  publicClient: PublicClient,
  walletClient: WalletClient,
  chain: Chain,
  account: Account,
  logger: Logger,
  engineAddr: `0x${string}`,
  contentId: bigint,
  roundId: bigint,
  startIndex: number,
): Promise<{ batchesProcessed: number; done: boolean; nextIndex: number }> {
  let commitKeys: readonly `0x${string}`[];
  try {
    commitKeys = await readRoundCommitKeys(
      publicClient,
      engineAddr,
      contentId,
      roundId,
    );
  } catch {
    return { batchesProcessed: 0, done: false, nextIndex: startIndex };
  }

  if (commitKeys.length === 0) {
    return { batchesProcessed: 0, done: true, nextIndex: startIndex };
  }

  const pendingIndex = await _findNextPendingCleanupIndex(
    publicClient,
    engineAddr,
    contentId,
    roundId,
    commitKeys,
    startIndex,
  );
  if (pendingIndex < 0) {
    return { batchesProcessed: 0, done: true, nextIndex: startIndex };
  }

  try {
    await writeContractAndConfirm(publicClient, walletClient, {
      chain,
      account,
      address: engineAddr,
      abi: RoundVotingEngineAbi,
      functionName: "processUnrevealedVotes",
      args: [
        contentId,
        roundId,
        BigInt(pendingIndex),
        BigInt(config.cleanupBatchSize),
      ],
    });
    logger.info("Processed unrevealed vote cleanup", {
      contentId: contentId.toString(),
      roundId: roundId.toString(),
      startIndex: pendingIndex,
      batchSize: config.cleanupBatchSize,
    });
    return {
      batchesProcessed: 1,
      done: pendingIndex + config.cleanupBatchSize >= commitKeys.length,
      nextIndex: pendingIndex + config.cleanupBatchSize,
    };
  } catch (err: unknown) {
    const reason = getRevertReason(err);
    if (!isExpectedRevert(reason)) {
      logger.warn("Failed to process unrevealed votes", {
        contentId: contentId.toString(),
        roundId: roundId.toString(),
        startIndex: pendingIndex,
        batchSize: config.cleanupBatchSize,
        error: reason,
      });
      return { batchesProcessed: 0, done: false, nextIndex: pendingIndex };
    }

    const nextPendingIndex = await _findNextPendingCleanupIndex(
      publicClient,
      engineAddr,
      contentId,
      roundId,
      commitKeys,
      pendingIndex,
    );
    return {
      batchesProcessed: 0,
      done: nextPendingIndex < 0,
      nextIndex: nextPendingIndex < 0 ? pendingIndex : nextPendingIndex,
    };
  }
}

async function _findNextPendingCleanupIndex(
  publicClient: Pick<PublicClient, "readContract">,
  engineAddr: `0x${string}`,
  contentId: bigint,
  roundId: bigint,
  commitKeys: readonly `0x${string}`[],
  startIndex: number,
): Promise<number> {
  for (let i = startIndex; i < commitKeys.length; i++) {
    const commit = parseCommitData(
      await publicClient.readContract({
        address: engineAddr,
        abi: RoundVotingEngineAbi,
        functionName: "commitRevealData",
        args: [contentId, roundId, commitKeys[i]],
      }),
    );

    if (!commit.revealed && commit.stakeAmount > 0n) {
      return i;
    }
  }

  return -1;
}
