/**
 * Core keeper logic: reveal tlock RBTS votes, advance round terminal states, clean up
 * unrevealed commits, and sweep dormant content.
 *
 * With tlock commit-reveal voting, the keeper has six jobs:
 *   1. Reveal committed RBTS votes after each epoch ends (using drand beacon decryption).
 *   2. Call `settleRound(contentId, roundId)` when ≥max(minVoters, 3) are revealed.
 *   3. Call `finalizeRevealFailedRound(contentId, roundId)` once the last reveal grace
 *      deadline has passed without reveal quorum.
 *   4. Call `processUnrevealedVotes(contentId, roundId, startIndex, count)` for
 *      terminal rounds that still have unrevealed stake to sweep/refund.
 *   5. Call `cancelExpiredRound(contentId, roundId)` for rounds past maxDuration that
 *      never reached commit quorum.
 *   6. Call `markDormant(contentId)` for stale content.
 *
 * Vote ciphertext is tlock-encrypted to a future drand round. After the epoch
 * ends, the drand beacon makes the decryption key available and the keeper can decrypt.
 */
import { keccak256, type PublicClient, type WalletClient, type Chain, type Account } from "viem";
import { timelockDecrypt, mainnetClient } from "tlock-js";
import {
  AdvisoryVoteRecorderAbi,
  ContentRegistryAbi,
  QuestionRewardPoolEscrowAbi,
  RoundVotingEngineAbi,
} from "@rateloop/contracts/abis";
import {
  decodeRbtsVotePlaintext,
  parseTlockCiphertextMetadata,
} from "@rateloop/contracts/voting";
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
  readRoundRevealGracePeriod,
} from "./contract-reads.js";
import { config } from "./config.js";
import type { Logger } from "./logger.js";
import { incrementCounter } from "./metrics.js";
import { getRevertReason, isExpectedRevert } from "./revert-utils.js";

const tlockClient = mainnetClient();

// --- Types ---
export interface KeeperResult {
  roundsSettled: number;
  roundsCancelled: number;
  roundsRevealFailedFinalized: number;
  votesRevealed: number;
  advisoryVotesRevealed: number;
  advisoryLaunchCreditsClaimed: number;
  cleanupBatchesProcessed: number;
  contentMarkedDormant: number;
}
interface CleanupCursor {
  contentId: bigint;
  roundId: bigint;
  nextIndex: number;
}

const MAX_CLEANUP_BATCHES_PER_TICK = 4;
const MAX_CLEANUP_COMPLETED = 5000;
const MAX_CLEANUP_QUEUE = 2000;
const cleanupQueue = new Map<string, CleanupCursor>();
const cleanupCompletedRounds = new Set<string>();
const cleanupDiscoveryRoundByContent = new Map<bigint, bigint>();

function emptyResult(): KeeperResult {
  return {
    roundsSettled: 0,
    roundsCancelled: 0,
    roundsRevealFailedFinalized: 0,
    votesRevealed: 0,
    advisoryVotesRevealed: 0,
    advisoryLaunchCreditsClaimed: 0,
    cleanupBatchesProcessed: 0,
    contentMarkedDormant: 0,
  };
}

export { validateKeeperContracts } from "./contract-reads.js";

export function resetKeeperStateForTests(): void {
  cleanupQueue.clear();
  cleanupCompletedRounds.clear();
  cleanupDiscoveryRoundByContent.clear();
  decryptFailureCount.clear();
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

async function resolveOnChainNowSeconds(publicClient: PublicClient): Promise<bigint> {
  try {
    const block = await publicClient.getBlock({ blockTag: "latest" });
    lastBlockTimestampS = block.timestamp;
    lastBlockObservedAtMs = Date.now();
    return block.timestamp;
  } catch (rpcError) {
    if (lastBlockTimestampS === null || lastBlockObservedAtMs === null) {
      // No cache to extrapolate from — fail loud rather than guessing with a wall clock.
      throw new Error("RPC block fetch failed and no cached block timestamp is available");
    }
    const elapsedS = Math.max(0, Math.floor((Date.now() - lastBlockObservedAtMs) / 1000));
    if (elapsedS > MAX_BLOCK_TIME_CACHE_AGE_S) {
      throw new Error(`RPC block fetch failed and cached block timestamp is stale (${elapsedS}s old)`);
    }
    console.warn(
      `[Keeper] RPC block fetch failed; extrapolating cached block.timestamp by ${elapsedS}s ` +
        `(rpc error: ${rpcError instanceof Error ? rpcError.message : String(rpcError)})`,
    );
    return lastBlockTimestampS + BigInt(elapsedS);
  }
}

export function resetBlockTimestampCacheForTests(): void {
  lastBlockTimestampS = null;
  lastBlockObservedAtMs = null;
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

/**
 * Decrypt a tlock-encrypted ciphertext using the drand beacon.
 * Ciphertext on-chain is hex-encoded UTF-8 armored AGE string.
 * Plaintext is 36 bytes: [uint8 version, uint8 isUp, uint16 predictedUpBps, bytes32 salt].
 */
// Valid tlock ciphertexts are ~600-800 bytes; 4KB is a generous upper bound.
const MAX_CIPHERTEXT_BYTES = 4096;

export async function decryptTlockVoteCiphertext(
  ciphertext: `0x${string}`,
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

  const plaintext = await timelockDecrypt(armored, tlockClient);
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

async function fetchIndexedCiphertext(params: {
  kind: "vote" | "advisory";
  contentId: bigint;
  roundId: bigint;
  commitKey: `0x${string}`;
  expectedCiphertextHash: `0x${string}`;
  logger: Logger;
}): Promise<`0x${string}` | null> {
  if (!config.ponderBaseUrl) {
    params.logger.warn("PONDER_BASE_URL is not configured; cannot fetch indexed vote ciphertext", {
      kind: params.kind,
      contentId: Number(params.contentId),
      roundId: Number(params.roundId),
      commitKey: params.commitKey,
    });
    return null;
  }

  const path = params.kind === "vote" ? "/votes" : "/advisory-votes";
  const url = new URL(path, config.ponderBaseUrl);
  url.searchParams.set("contentId", params.contentId.toString());
  url.searchParams.set("roundId", params.roundId.toString());
  url.searchParams.set("limit", "200");

  try {
    const response = await fetch(url);
    if (!response.ok) {
      params.logger.warn("Failed to fetch indexed vote ciphertext", {
        kind: params.kind,
        status: response.status,
        url: url.toString(),
      });
      return null;
    }

    const body = (await response.json()) as { items?: IndexedCiphertextRecord[] };
    const record = body.items?.find(
      item => item.commitKey?.toLowerCase() === params.commitKey.toLowerCase(),
    );
    if (!record?.ciphertext || !record.ciphertextHash) {
      return null;
    }
    if (record.ciphertextHash.toLowerCase() !== params.expectedCiphertextHash.toLowerCase()) {
      params.logger.error("Indexed ciphertext hash does not match on-chain commit hash", {
        kind: params.kind,
        commitKey: params.commitKey,
        indexedCiphertextHash: record.ciphertextHash,
        expectedCiphertextHash: params.expectedCiphertextHash,
      });
      return null;
    }
    if (keccak256(record.ciphertext) !== params.expectedCiphertextHash) {
      params.logger.error("Indexed ciphertext bytes do not hash to on-chain ciphertext hash", {
        kind: params.kind,
        commitKey: params.commitKey,
        expectedCiphertextHash: params.expectedCiphertextHash,
      });
      return null;
    }
    return record.ciphertext;
  } catch (err: unknown) {
    params.logger.warn("Failed to resolve indexed vote ciphertext", {
      kind: params.kind,
      commitKey: params.commitKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
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
): Promise<KeeperResult> {
  const engineAddr = config.contracts.votingEngine;
  const registryAddr = config.contracts.contentRegistry;
  const advisoryAddr = config.contracts.advisoryVoteRecorder;

  // Use on-chain block.timestamp — this is what the contract uses for checks.
  // KEEPER-1 (2026-05-21 repo audit): on RPC failure, `resolveOnChainNowSeconds` extrapolates
  // from the last successful block timestamp (bounded). It throws if there's no cached value or
  // the cache is too stale, so the keeper short-circuits this iteration loudly rather than
  // continuing on a possibly-skewed system clock.
  let now: bigint;
  try {
    now = await resolveOnChainNowSeconds(publicClient);
  } catch (err) {
    logger.error(`[Keeper] Cannot resolve current block time: ${err instanceof Error ? err.message : String(err)}`);
    return emptyResult();
  }

  const result: KeeperResult = emptyResult();

  // --- Get total content count ---
  let nextContentId: bigint;
  try {
    nextContentId = (await publicClient.readContract({
      address: registryAddr,
      abi: ContentRegistryAbi,
      functionName: "nextContentId",
      args: [],
    })) as bigint;
  } catch {
    logger.error("Could not connect to chain");
    return emptyResult();
  }

  // --- Process each content item ---
  for (let contentId = 1n; contentId < nextContentId; contentId++) {
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

      if (activeRoundId > 0n) {
        // --- 1. REVEAL LOOP: Decrypt and reveal unrevealed commits ---
        const revealedCount = await _revealCommits(
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
        result.votesRevealed += revealedCount;
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

        // --- 2. SETTLE: If threshold reached (enough RBTS votes revealed) ---
        const rbtsRevealQuorum =
          roundConfig.minVoters > 3n ? roundConfig.minVoters : 3n;
        let roundHasHumanVerifiedCommit: boolean | undefined;
        const readRoundHasHumanVerifiedCommit = async () => {
          if (roundHasHumanVerifiedCommit === undefined) {
            roundHasHumanVerifiedCommit = (await publicClient.readContract({
              address: engineAddr,
              abi: RoundVotingEngineAbi,
              functionName: "roundHasHumanVerifiedCommit",
              args: [contentId, activeRoundId],
            })) as boolean;
          }
          return roundHasHumanVerifiedCommit;
        };

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
            logger.info("Settled round", {
              contentId: contentId.toString(),
              roundId: Number(activeRoundId),
            });
            result.roundsSettled++;
            enqueueRoundForCleanup(contentId, activeRoundId);
            result.advisoryLaunchCreditsClaimed += await _claimAdvisoryLaunchCredits(
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
          try {
            const [lastCommitRevealableAfter, revealGracePeriod, hasHumanVerifiedCommit] =
              await Promise.all([
                publicClient.readContract({
                  address: engineAddr,
                  abi: RoundVotingEngineAbi,
                  functionName: "lastCommitRevealableAfter",
                  args: [contentId, activeRoundId],
                }) as Promise<bigint>,
                readRoundRevealGracePeriod(
                  publicClient,
                  engineAddr,
                  contentId,
                  activeRoundId,
                ),
                readRoundHasHumanVerifiedCommit(),
              ]);

            const revealFailedEligibleAt =
              lastCommitRevealableAfter >
              round.startTime + roundConfig.maxDuration
                ? lastCommitRevealableAfter + revealGracePeriod
                : round.startTime + roundConfig.maxDuration + revealGracePeriod;

            if (
              hasHumanVerifiedCommit &&
              lastCommitRevealableAfter > 0n &&
              now >= revealFailedEligibleAt
            ) {
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
            const hasHumanVerifiedCommit =
              round.voteCount < rbtsRevealQuorum
                ? true
                : await readRoundHasHumanVerifiedCommit();
            if (round.voteCount < rbtsRevealQuorum || !hasHumanVerifiedCommit) {
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
        result.advisoryLaunchCreditsClaimed += await _claimAdvisoryLaunchCredits(
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
      try {
        const dormancyEligible = (await publicClient.readContract({
          address: registryAddr,
          abi: ContentRegistryAbi,
          functionName: "isDormancyEligible",
          args: [contentId],
        })) as boolean;

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
        if (
          !reason.includes("pending votes") &&
          !reason.includes("Content has active round")
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

  return result;
}

export async function writeContractAndConfirm(
  publicClient: Pick<PublicClient, "waitForTransactionReceipt">,
  walletClient: WalletClient,
  request: Parameters<WalletClient["writeContract"]>[0],
): Promise<`0x${string}`> {
  // Enforce gas cap to prevent runaway transactions
  if (!request.gas && config.maxGasPerTx > 0) {
    request.gas = BigInt(config.maxGasPerTx);
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

/**
 * Reveal all unrevealed commits for a round whose epoch has ended.
 * Returns the number of votes revealed in this call.
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
): Promise<number> {
  let revealed = 0;

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
    return 0;
  }

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

      const ciphertext = await fetchIndexedCiphertext({
        kind: "vote",
        contentId,
        roundId,
        commitKey,
        expectedCiphertextHash: commit.ciphertextHash,
        logger,
      });
      if (!ciphertext) continue;

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
        decrypted = await decryptTlockVoteCiphertext(ciphertext);
      } catch (err: unknown) {
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
          logger.warn("Failed to reveal vote", {
            contentId: contentId.toString(),
            roundId: roundId.toString(),
            commitKey,
            error: reason,
          });
        }
      }
    } catch (err: unknown) {
      logger.debug("Error processing commit", {
        contentId: contentId.toString(),
        roundId: roundId.toString(),
        commitKey,
        error: getRevertReason(err),
      });
    }
  }

  return revealed;
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
      Array.from({ length: size }, (_, i) =>
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
    commitKeys = await readRoundAdvisoryCommitKeys(publicClient, advisoryAddr, contentId, roundId);
  } catch {
    return 0;
  }

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

      const ciphertext = await fetchIndexedCiphertext({
        kind: "advisory",
        contentId,
        roundId,
        commitKey,
        expectedCiphertextHash: commit.ciphertextHash,
        logger,
      });
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
        decrypted = await decryptTlockVoteCiphertext(ciphertext);
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
        const logFn = count >= MAX_DECRYPT_RETRIES ? logger.error.bind(logger) : logger.warn.bind(logger);
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
        const logFn = count >= MAX_DECRYPT_RETRIES ? logger.error.bind(logger) : logger.warn.bind(logger);
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
          args: [commitKey, decrypted.isUp, decrypted.predictedUpBps, decrypted.salt],
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
    commitKeys = await readRoundAdvisoryCommitKeys(publicClient, advisoryAddr, contentId, roundId);
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
