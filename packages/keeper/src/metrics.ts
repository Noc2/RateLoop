/**
 * Prometheus-compatible metrics endpoint and health check.
 * Uses only Node.js builtins — no external dependencies.
 */
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "http";
import path from "node:path";
import type { KeeperResult } from "./keeper.js";

// --- Counters ---
const counters: Record<string, number> = {
  keeper_rounds_opened_total: 0,
  keeper_rounds_settled_total: 0,
  keeper_rounds_cancelled_total: 0,
  keeper_rounds_reveal_failed_finalized_total: 0,
  keeper_votes_revealed_total: 0,
  keeper_advisory_votes_revealed_total: 0,
  keeper_advisory_launch_credits_claimed_total: 0,
  keeper_unrevealed_cleanup_batches_total: 0,
  keeper_reward_pool_rounds_qualified_total: 0,
  keeper_bundle_terminal_syncs_total: 0,
  keeper_content_marked_dormant_total: 0,
  keeper_runs_total: 0,
  keeper_errors_total: 0,
  keeper_decrypt_failures_total: 0,
  keeper_ponder_ciphertext_fetch_failures_total: 0,
  keeper_ciphertext_log_fallback_total: 0,
  keeper_drand_relay_failovers_total: 0,
  keeper_reveal_failed_finalize_skipped_total: 0,
  keeper_work_discovery_ponder_failures_total: 0,
  keeper_main_loop_lock_skips_total: 0,
  keeper_feedback_bonus_forfeits_total: 0,
  keeper_feedback_bonus_forfeit_failures_total: 0,
  keeper_reward_pool_qualification_failures_total: 0,
  keeper_reward_pool_qualification_cursor_advance_attempts_total: 0,
  keeper_reward_pool_qualification_cursor_advances_total: 0,
  keeper_reward_pool_qualification_cursor_advance_failures_total: 0,
  keeper_bundle_terminal_sync_failures_total: 0,
  keeper_correlation_epoch_proposed_total: 0,
  keeper_correlation_epoch_finalized_total: 0,
  keeper_round_payout_snapshot_proposed_total: 0,
  keeper_round_payout_snapshot_finalized_total: 0,
  keeper_rating_snapshot_applied_total: 0,
  keeper_rbts_settlement_snapshot_applied_total: 0,
  keeper_payout_finality_sla_breaches_total: 0,
  keeper_artifact_cache_or_fetch_failure_total: 0,
};

// --- Gauges ---
const gauges: Record<string, number> = {
  keeper_last_run_duration_seconds: 0,
  keeper_last_successful_run_timestamp: 0,
  keeper_last_main_loop_lock_skip_duration_seconds: 0,
  keeper_last_main_loop_lock_skip_timestamp: 0,
  keeper_is_running: 0,
  keeper_wallet_balance_wei: 0,
  keeper_rounds_awaiting_reveal_quorum: 0,
  // -1 means no round is currently at risk of RevealFailed finalization.
  keeper_reveal_grace_seconds_remaining_min: -1,
  keeper_work_discovery_last_duration_seconds: 0,
  keeper_work_discovery_last_source: 0,
  keeper_work_discovery_round_open_requests: 0,
  keeper_work_discovery_open_round_candidates: 0,
  keeper_work_discovery_cleanup_round_candidates: 0,
  keeper_work_discovery_dormant_content_candidates: 0,
  keeper_work_discovery_feedback_bonus_forfeit_candidates: 0,
  // -1 means no settle-ready backlog was observed in the last work discovery.
  keeper_settlement_backlog_oldest_seconds: -1,
  keeper_work_discovery_reward_pool_qualification_candidates: 0,
  keeper_work_discovery_bundle_terminal_sync_candidates: 0,
  keeper_correlation_source_ready_backlog_oldest_seconds: -1,
  keeper_correlation_epoch_finalization_backlog_oldest_seconds: -1,
  keeper_round_payout_finalization_backlog_oldest_seconds: -1,
  keeper_round_payout_apply_backlog_oldest_seconds: -1,
};

const startTime = Date.now();
let consecutiveErrors = 0;
let lastRunTime: Date | null = null;
let lastMainLoopLockSkipTime: Date | null = null;
let healthThresholdMs = 90_000; // 3x default 30s interval
// Exact wallet balance for /health. The Prometheus gauge is a float64, which loses wei
// precision above 2^53 wei (~0.009 ETH); keep the bigint separately so /health does not
// re-present a rounded double as an exact-looking integer.
let walletBalanceWei: bigint | null = null;

export function setHealthThreshold(intervalMs: number) {
  healthThresholdMs = intervalMs * 3;
}

export function incrementCounter(name: string, amount = 1) {
  if (name in counters) {
    counters[name] += amount;
  }
}

export function setGauge(name: string, value: number) {
  if (name in gauges) {
    gauges[name] = value;
  }
}

export interface CorrelationSnapshotMetricsResult {
  epochsProposed: number;
  epochsFinalized: number;
  roundSnapshotsProposed: number;
  roundSnapshotsFinalized: number;
  ratingSnapshotsApplied: number;
  rbtsSettlementSnapshotsApplied: number;
}

export function recordCorrelationSnapshotResult(result: CorrelationSnapshotMetricsResult) {
  incrementCounter("keeper_correlation_epoch_proposed_total", result.epochsProposed);
  incrementCounter("keeper_correlation_epoch_finalized_total", result.epochsFinalized);
  incrementCounter("keeper_round_payout_snapshot_proposed_total", result.roundSnapshotsProposed);
  incrementCounter("keeper_round_payout_snapshot_finalized_total", result.roundSnapshotsFinalized);
  incrementCounter("keeper_rating_snapshot_applied_total", result.ratingSnapshotsApplied);
  incrementCounter(
    "keeper_rbts_settlement_snapshot_applied_total",
    result.rbtsSettlementSnapshotsApplied,
  );
}

/**
 * Record the keeper wallet balance. The exact bigint is kept for /health; the
 * Prometheus gauge necessarily exposes a float64 approximation (documented in its
 * HELP text), which is fine for alerting thresholds.
 */
export function setWalletBalanceWei(balance: bigint) {
  walletBalanceWei = balance;
  gauges.keeper_wallet_balance_wei = Number(balance);
}

export function getConsecutiveErrors(): number {
  return consecutiveErrors;
}

/** Record the result of a keeper run. */
export function recordRun(result: KeeperResult, durationMs: number) {
  counters.keeper_runs_total++;
  counters.keeper_rounds_opened_total += result.roundsOpened;
  counters.keeper_rounds_settled_total += result.roundsSettled;
  counters.keeper_rounds_cancelled_total += result.roundsCancelled;
  counters.keeper_rounds_reveal_failed_finalized_total += result.roundsRevealFailedFinalized;
  counters.keeper_votes_revealed_total += result.votesRevealed;
  counters.keeper_advisory_votes_revealed_total += result.advisoryVotesRevealed;
  counters.keeper_advisory_launch_credits_claimed_total += result.advisoryLaunchCreditsClaimed;
  counters.keeper_unrevealed_cleanup_batches_total += result.cleanupBatchesProcessed;
  counters.keeper_reward_pool_rounds_qualified_total += result.rewardPoolRoundsQualified;
  counters.keeper_bundle_terminal_syncs_total += result.questionBundleTerminalSyncs;
  counters.keeper_content_marked_dormant_total += result.contentMarkedDormant;
  counters.keeper_feedback_bonus_forfeits_total += result.feedbackBonusPoolsForfeited;
  gauges.keeper_rounds_awaiting_reveal_quorum = result.roundsAwaitingRevealQuorum;
  gauges.keeper_reveal_grace_seconds_remaining_min =
    result.minRevealGraceSecondsRemaining ?? -1;
  gauges.keeper_last_run_duration_seconds = durationMs / 1000;
  gauges.keeper_last_successful_run_timestamp = Date.now() / 1000;
  consecutiveErrors = 0;
  lastRunTime = new Date();
}

/** Record a skipped keeper tick when another replica held the main-loop lock. */
export function recordMainLoopLockSkip(durationMs: number) {
  counters.keeper_main_loop_lock_skips_total++;
  gauges.keeper_last_main_loop_lock_skip_duration_seconds = durationMs / 1000;
  gauges.keeper_last_main_loop_lock_skip_timestamp = Date.now() / 1000;
  lastMainLoopLockSkipTime = new Date();
}

/** Record a keeper error. */
export function recordError() {
  counters.keeper_errors_total++;
  consecutiveErrors++;
}

// --- Prometheus text format ---
function renderMetrics(): string {
  const lines: string[] = [];

  const counterHelp: Record<string, string> = {
    keeper_rounds_opened_total: "Total rating rounds proactively opened by keeper",
    keeper_rounds_settled_total: "Total rounds settled by keeper",
    keeper_rounds_cancelled_total: "Total rounds cancelled by keeper",
    keeper_rounds_reveal_failed_finalized_total: "Total rounds finalized as RevealFailed by keeper",
    keeper_votes_revealed_total: "Total votes revealed by keeper",
    keeper_advisory_votes_revealed_total: "Total advisory votes revealed by keeper",
    keeper_advisory_launch_credits_claimed_total: "Total advisory launch credits claimed by keeper",
    keeper_unrevealed_cleanup_batches_total: "Total unrevealed-vote cleanup batches processed by keeper",
    keeper_reward_pool_rounds_qualified_total: "Total question reward pool rounds qualified by keeper",
    keeper_bundle_terminal_syncs_total: "Total question bundle terminal sync transactions sent by keeper",
    keeper_content_marked_dormant_total: "Total content items marked dormant",
    keeper_runs_total: "Total keeper run cycles",
    keeper_errors_total: "Total keeper run errors",
    keeper_decrypt_failures_total: "Total tlock decryption failures",
    keeper_ponder_ciphertext_fetch_failures_total:
      "Total failed Ponder indexed-ciphertext fetches",
    keeper_ciphertext_log_fallback_total:
      "Total ciphertexts resolved via the eth_getLogs fallback instead of Ponder",
    keeper_drand_relay_failovers_total:
      "Total drand relay failover events (a relay failed and the next one was tried)",
    keeper_reveal_failed_finalize_skipped_total:
      "Total reveal-failed finalizations skipped because the reveal pipeline was unhealthy",
    keeper_work_discovery_ponder_failures_total: "Total Ponder keeper-work discovery failures",
    keeper_main_loop_lock_skips_total: "Total keeper runs skipped because another keeper held the main loop lock",
    keeper_feedback_bonus_forfeits_total: "Total expired Feedback Bonus pools forfeited by keeper",
    keeper_feedback_bonus_forfeit_failures_total: "Total unexpected Feedback Bonus forfeit failures",
    keeper_reward_pool_qualification_failures_total: "Total unexpected reward pool qualification failures",
    keeper_reward_pool_qualification_cursor_advance_attempts_total:
      "Total reward pool qualification cursor advance attempts",
    keeper_reward_pool_qualification_cursor_advances_total:
      "Total successful reward pool qualification cursor advance transactions",
    keeper_reward_pool_qualification_cursor_advance_failures_total:
      "Total unexpected reward pool qualification cursor advance failures",
    keeper_bundle_terminal_sync_failures_total: "Total unexpected question bundle terminal sync failures",
    keeper_correlation_epoch_proposed_total: "Total correlation epoch snapshots proposed by keeper",
    keeper_correlation_epoch_finalized_total: "Total correlation epoch snapshots finalized by keeper",
    keeper_round_payout_snapshot_proposed_total: "Total round payout snapshots proposed by keeper",
    keeper_round_payout_snapshot_finalized_total: "Total round payout snapshots finalized by keeper",
    keeper_rating_snapshot_applied_total: "Total finalized public rating payout snapshots applied by keeper",
    keeper_rbts_settlement_snapshot_applied_total: "Total finalized RBTS settlement snapshots applied by keeper",
    keeper_payout_finality_sla_breaches_total: "Total healthy unchallenged payout-finality paths observed past the one-hour SLA",
    keeper_artifact_cache_or_fetch_failure_total: "Total correlation artifact cache or fetch failures observed by keeper",
  };

  for (const [name, value] of Object.entries(counters)) {
    lines.push(`# HELP ${name} ${counterHelp[name] || name}`);
    lines.push(`# TYPE ${name} counter`);
    lines.push(`${name} ${value}`);
  }

  const gaugeHelp: Record<string, string> = {
    keeper_last_run_duration_seconds: "Duration of the last keeper run in seconds",
    keeper_last_successful_run_timestamp: "Unix timestamp of last successful run",
    keeper_last_main_loop_lock_skip_duration_seconds:
      "Duration of the last keeper tick skipped because another keeper held the main loop lock",
    keeper_last_main_loop_lock_skip_timestamp:
      "Unix timestamp of the last keeper tick skipped because another keeper held the main loop lock",
    keeper_is_running: "Whether a keeper run is currently in progress",
    keeper_wallet_balance_wei:
      "Keeper wallet native balance in wei (float64-approximate above 2^53 wei; /health reports the exact value)",
    keeper_rounds_awaiting_reveal_quorum:
      "Open rounds with commit quorum whose reveal quorum is still unmet",
    keeper_reveal_grace_seconds_remaining_min:
      "Seconds until the most at-risk round becomes finalizable as RevealFailed (-1 = none)",
    keeper_work_discovery_last_duration_seconds: "Duration of the last keeper work discovery phase in seconds",
    keeper_work_discovery_last_source: "Last keeper work discovery source: 1=Ponder, 2=chain reconciliation",
    keeper_work_discovery_round_open_requests:
      "Proactive round open requests returned by the last keeper work discovery phase",
    keeper_work_discovery_open_round_candidates: "Open round candidates returned by the last keeper work discovery phase",
    keeper_work_discovery_cleanup_round_candidates: "Cleanup round candidates returned by the last keeper work discovery phase",
    keeper_work_discovery_dormant_content_candidates: "Dormant content candidates returned by the last keeper work discovery phase",
    keeper_work_discovery_feedback_bonus_forfeit_candidates:
      "Expired Feedback Bonus pool candidates returned by the last keeper work discovery phase",
    keeper_settlement_backlog_oldest_seconds:
      "Age in seconds of the oldest settle-ready round returned by keeper work discovery (-1 = none)",
    keeper_work_discovery_reward_pool_qualification_candidates:
      "Reward pool qualification candidates returned by the last keeper work discovery phase",
    keeper_work_discovery_bundle_terminal_sync_candidates:
      "Question bundle terminal sync candidates returned by the last keeper work discovery phase",
    keeper_correlation_source_ready_backlog_oldest_seconds:
      "Age in seconds of the oldest source-ready correlation source without a round payout proposal (-1 = none)",
    keeper_correlation_epoch_finalization_backlog_oldest_seconds:
      "Age in seconds of the oldest proposed correlation epoch not finalized yet (-1 = none)",
    keeper_round_payout_finalization_backlog_oldest_seconds:
      "Age in seconds of the oldest proposed round payout snapshot not finalized yet (-1 = none)",
    keeper_round_payout_apply_backlog_oldest_seconds:
      "Age in seconds of the oldest finalized round payout snapshot past veto but not consumed/applied (-1 = none)",
  };

  for (const [name, value] of Object.entries(gauges)) {
    lines.push(`# HELP ${name} ${gaugeHelp[name] || name}`);
    lines.push(`# TYPE ${name} gauge`);
    lines.push(`${name} ${value}`);
  }

  return lines.join("\n") + "\n";
}

export function getMetricsText(): string {
  return renderMetrics();
}

// --- Health check ---
function isHealthy(): boolean {
  if (!lastRunTime) return false;
  return Date.now() - lastRunTime.getTime() < healthThresholdMs;
}

function renderHealth(): { status: number; body: string } {
  const healthy = isHealthy();
  const body = JSON.stringify({
    status: healthy ? "ok" : "unhealthy",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    lastRun: lastRunTime?.toISOString() ?? null,
    lastRunDuration: gauges.keeper_last_run_duration_seconds,
    lastMainLoopLockSkip: lastMainLoopLockSkipTime?.toISOString() ?? null,
    lastMainLoopLockSkipDuration: gauges.keeper_last_main_loop_lock_skip_duration_seconds,
    consecutiveErrors,
    totalRuns: counters.keeper_runs_total,
    mainLoopLockSkips: counters.keeper_main_loop_lock_skips_total,
    roundsOpened: counters.keeper_rounds_opened_total,
    roundsRevealFailedFinalized: counters.keeper_rounds_reveal_failed_finalized_total,
    cleanupBatchesProcessed: counters.keeper_unrevealed_cleanup_batches_total,
    rewardPoolRoundsQualified: counters.keeper_reward_pool_rounds_qualified_total,
    questionBundleTerminalSyncs: counters.keeper_bundle_terminal_syncs_total,
    feedbackBonusPoolsForfeited: counters.keeper_feedback_bonus_forfeits_total,
    decryptFailures: counters.keeper_decrypt_failures_total,
    roundsAwaitingRevealQuorum: gauges.keeper_rounds_awaiting_reveal_quorum,
    revealGraceSecondsRemainingMin: gauges.keeper_reveal_grace_seconds_remaining_min,
    workDiscoveryDuration: gauges.keeper_work_discovery_last_duration_seconds,
    workDiscoverySource: gauges.keeper_work_discovery_last_source,
    roundOpenRequests: gauges.keeper_work_discovery_round_open_requests,
    openRoundCandidates: gauges.keeper_work_discovery_open_round_candidates,
    cleanupRoundCandidates: gauges.keeper_work_discovery_cleanup_round_candidates,
    dormantContentCandidates: gauges.keeper_work_discovery_dormant_content_candidates,
    feedbackBonusForfeitCandidates:
      gauges.keeper_work_discovery_feedback_bonus_forfeit_candidates,
    settlementBacklogOldestSeconds:
      gauges.keeper_settlement_backlog_oldest_seconds,
    rewardPoolQualificationCandidates:
      gauges.keeper_work_discovery_reward_pool_qualification_candidates,
    bundleTerminalSyncCandidates:
      gauges.keeper_work_discovery_bundle_terminal_sync_candidates,
    walletBalanceWei: (walletBalanceWei ?? 0n).toString(),
  });
  return { status: healthy ? 200 : 503, body };
}

export function getHealthSnapshot(): { status: number; body: string } {
  return renderHealth();
}

// --- HTTP server ---

/**
 * KEEPER-2 (2026-05-21 repo audit): the metrics server exposes the wallet balance gauge and
 * operational counters. Default bind is `127.0.0.1`, which is safe — but operators sometimes
 * set `METRICS_BIND_ADDRESS=0.0.0.0` to let a sibling Prometheus container scrape, which
 * exposes the wallet balance to anyone on the network. Refuse to start on a non-loopback bind
 * unless an explicit `METRICS_AUTH_TOKEN` is set, and bearer-check it on every request.
 */
const LOOPBACK_BIND_ADDRESSES = new Set(["127.0.0.1", "::1", "localhost"]);
const ARTIFACT_ROUTE_PREFIX = "/correlation-artifacts/";
const ARTIFACT_FILENAME_RE = /^0x[a-fA-F0-9]{64}\.json$/;

interface MetricsServerOptions {
  artifactDirectory?: string | null;
}

interface CorrelationArtifactResponse {
  status: number;
  headers?: Record<string, string>;
  body?: Buffer | string;
}

function isLoopbackBind(addr: string): boolean {
  return LOOPBACK_BIND_ADDRESSES.has(addr) || addr.startsWith("127.");
}

function timingSafeBearerMatch(header: string | undefined, expected: string): boolean {
  if (!header) return false;
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const presented = header.slice(prefix.length).trim();
  if (presented.length !== expected.length) return false;
  // Constant-time compare without pulling in node:crypto's timingSafeEqual on every request
  // (presented and expected are equal-length ASCII strings here).
  let diff = 0;
  for (let i = 0; i < presented.length; i++) diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function serveCorrelationArtifact(
  req: IncomingMessage,
  res: ServerResponse,
  artifactDirectory: string | null | undefined,
): Promise<boolean> {
  const artifactResponse = await resolveCorrelationArtifactResponse(
    req.method,
    req.url,
    artifactDirectory,
  );
  if (!artifactResponse) return false;

  res.writeHead(artifactResponse.status, artifactResponse.headers);
  res.end(artifactResponse.body);
  return true;
}

export async function resolveCorrelationArtifactResponse(
  method: string | undefined,
  requestUrl: string | undefined,
  artifactDirectory: string | null | undefined,
): Promise<CorrelationArtifactResponse | null> {
  const url = new URL(requestUrl || "/", "http://keeper.local");
  if (!url.pathname.startsWith(ARTIFACT_ROUTE_PREFIX)) return null;

  if (method !== "GET" && method !== "HEAD") {
    return {
      status: 405,
      headers: { Allow: "GET, HEAD" },
      body: "Method Not Allowed\n",
    };
  }

  if (!artifactDirectory) {
    return { status: 404, body: "Not Found\n" };
  }

  const filename = url.pathname.slice(ARTIFACT_ROUTE_PREFIX.length);
  if (!ARTIFACT_FILENAME_RE.test(filename)) {
    return { status: 404, body: "Not Found\n" };
  }

  try {
    const artifactPath = path.join(artifactDirectory, filename);
    const body = await readFile(artifactPath);
    return {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": String(body.byteLength),
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
      body: method === "HEAD" ? undefined : body,
    };
  } catch {
    return { status: 404, body: "Not Found\n" };
  }
}

function makeHandler(authToken: string | null, options: MetricsServerOptions = {}) {
  return async function handler(req: IncomingMessage, res: ServerResponse) {
    // The correlation-artifact route is intentionally served BEFORE the metrics
    // bearer-auth check below: these artifacts are content-addressed, immutable,
    // and published via a public base URL, so they are meant to be fetched
    // without auth. The filename is bounded by ARTIFACT_FILENAME_RE
    // (^0x[a-fA-F0-9]{64}\.json$), so no path traversal is possible. Do NOT move
    // this below the auth check.
    if (await serveCorrelationArtifact(req, res, options.artifactDirectory)) return;

    if (req.url === "/live") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD" });
        res.end("Method Not Allowed\n");
        return;
      }
      const body = JSON.stringify({ status: "ok" });
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(body)),
      });
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }

    if (authToken !== null && !timingSafeBearerMatch(req.headers.authorization, authToken)) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      res.end("Unauthorized\n");
      return;
    }
    if (req.url === "/metrics" || req.url === "/health") {
      if (req.method !== "GET") {
        res.writeHead(405, { Allow: "GET" });
        res.end("Method Not Allowed\n");
        return;
      }
      if (req.url === "/metrics") {
        res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
        res.end(renderMetrics());
      } else {
        const { status, body } = renderHealth();
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(body);
      }
    } else {
      res.writeHead(404);
      res.end("Not Found\n");
    }
  };
}

export function startMetricsServer(
  port: number,
  bindAddress = "127.0.0.1",
  authToken: string | null = null,
  options: MetricsServerOptions = {},
): Server {
  if (!isLoopbackBind(bindAddress) && (authToken === null || authToken.length < 16)) {
    throw new Error(
      `Refusing to start metrics server on non-loopback bind '${bindAddress}' without a ` +
        `METRICS_AUTH_TOKEN (>= 16 chars). Either bind to 127.0.0.1 / ::1 or set the env var.`,
    );
  }
  const server = createServer(makeHandler(authToken, options));
  server.listen(port, bindAddress);
  return server;
}
