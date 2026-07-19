import { createServer, type Server } from "node:http";
import type { TokenlessKeeperResult } from "./tokenless-types.js";

const counters: Record<string, number> = {
  keeper_runs_total: 0,
  keeper_errors_total: 0,
  keeper_drand_relay_failovers_total: 0,
  keeper_reveal_windows_opened_total: 0,
  keeper_votes_revealed_total: 0,
  keeper_settlements_begun_total: 0,
  keeper_aggregate_batches_processed_total: 0,
  keeper_scoring_seeds_finalized_total: 0,
  keeper_score_batches_processed_total: 0,
  keeper_rounds_finalized_total: 0,
  keeper_terminal_rounds_advanced_total: 0,
  keeper_claims_executed_total: 0,
  keeper_stale_returns_executed_total: 0,
  keeper_feedback_bonus_refunds_executed_total: 0,
};

const gauges: Record<string, number> = {
  keeper_is_running: 0,
  keeper_last_run_duration_seconds: 0,
  keeper_last_successful_run_timestamp: 0,
  keeper_last_progress_timestamp: 0,
  keeper_last_work_observed_timestamp: 0,
  keeper_wallet_balance_wei: 0,
  keeper_minimum_wallet_balance_wei: 0,
  keeper_rounds_scanned: 0,
  keeper_self_reveal_fallbacks_pending: 0,
  keeper_rounds_awaiting_beacon_failure: 0,
  keeper_rounds_awaiting_scoring_entropy: 0,
};

let consecutiveErrors = 0;
let lastRunAt: Date | null = null;
let lastProgressAt: Date | null = null;
let lastWorkObservedAt: Date | null = null;
let walletBalanceWei: bigint | null = null;
let minimumWalletBalanceWei = 0n;
let healthThresholdMs = 45_000;

export function incrementCounter(name: string, amount = 1) {
  if (name in counters) counters[name] += amount;
}

export function setGauge(name: string, value: number) {
  if (name in gauges) gauges[name] = value;
}

export function setWalletBalanceWei(value: bigint) {
  walletBalanceWei = value;
  gauges.keeper_wallet_balance_wei = Number(value);
}

export function setMinimumWalletBalanceWei(value: bigint) {
  if (value < 0n)
    throw new Error("Minimum keeper wallet balance cannot be negative.");
  minimumWalletBalanceWei = value;
  gauges.keeper_minimum_wallet_balance_wei = Number(value);
}

export function setHealthThreshold(intervalMs: number) {
  healthThresholdMs = intervalMs * 3;
}

export function getConsecutiveErrors() {
  return consecutiveErrors;
}

export function recordError() {
  counters.keeper_errors_total += 1;
  consecutiveErrors += 1;
}

export function recordRun(result: TokenlessKeeperResult, durationMs: number) {
  counters.keeper_runs_total += 1;
  counters.keeper_reveal_windows_opened_total += result.revealWindowsOpened;
  counters.keeper_votes_revealed_total += result.votesRevealed;
  counters.keeper_settlements_begun_total += result.settlementsBegun;
  counters.keeper_aggregate_batches_processed_total +=
    result.aggregateBatchesProcessed;
  counters.keeper_scoring_seeds_finalized_total += result.scoringSeedsFinalized;
  counters.keeper_score_batches_processed_total += result.scoreBatchesProcessed;
  counters.keeper_rounds_finalized_total += result.roundsFinalized;
  counters.keeper_terminal_rounds_advanced_total +=
    result.terminalRoundsAdvanced;
  counters.keeper_claims_executed_total += result.claimsExecuted;
  counters.keeper_stale_returns_executed_total += result.staleReturnsExecuted;
  counters.keeper_feedback_bonus_refunds_executed_total +=
    result.feedbackBonusRefundsExecuted;
  const completedAt = new Date();
  gauges.keeper_last_run_duration_seconds = durationMs / 1000;
  gauges.keeper_last_successful_run_timestamp = completedAt.getTime() / 1000;
  gauges.keeper_rounds_scanned = result.roundsScanned;
  gauges.keeper_self_reveal_fallbacks_pending =
    result.selfRevealFallbacksPending;
  gauges.keeper_rounds_awaiting_beacon_failure =
    result.roundsAwaitingBeaconFailure;
  gauges.keeper_rounds_awaiting_scoring_entropy =
    result.roundsAwaitingScoringEntropy;
  const progressCount =
    result.revealWindowsOpened +
    result.votesRevealed +
    result.settlementsBegun +
    result.aggregateBatchesProcessed +
    result.scoringSeedsFinalized +
    result.scoreBatchesProcessed +
    result.roundsFinalized +
    result.terminalRoundsAdvanced +
    result.claimsExecuted +
    result.staleReturnsExecuted +
    result.feedbackBonusRefundsExecuted;
  if (progressCount > 0) {
    lastProgressAt = completedAt;
    gauges.keeper_last_progress_timestamp = completedAt.getTime() / 1000;
  }
  if (result.roundsScanned > 0) {
    lastWorkObservedAt = completedAt;
    gauges.keeper_last_work_observed_timestamp = completedAt.getTime() / 1000;
  }
  consecutiveErrors = 0;
  lastRunAt = completedAt;
}

export function operationalHealthSnapshot(now = new Date()) {
  const reasons: string[] = [];
  const runAgeMs = lastRunAt ? now.getTime() - lastRunAt.getTime() : null;
  if (runAgeMs === null || runAgeMs > healthThresholdMs)
    reasons.push("keeper_run_stale");
  if (consecutiveErrors >= 3) reasons.push("consecutive_errors");
  if (minimumWalletBalanceWei > 0n && walletBalanceWei === null)
    reasons.push("wallet_balance_unknown");
  if (walletBalanceWei !== null && walletBalanceWei < minimumWalletBalanceWei) {
    reasons.push("gas_balance_low");
  }
  return {
    status: reasons.length === 0 ? ("ok" as const) : ("degraded" as const),
    protocol: "tokenless-v4" as const,
    reasons,
    consecutiveErrors,
    lastRunAt: lastRunAt?.toISOString() ?? null,
    lastProgressAt: lastProgressAt?.toISOString() ?? null,
    lastWorkObservedAt: lastWorkObservedAt?.toISOString() ?? null,
    runAgeSeconds: runAgeMs === null ? null : Math.max(0, runAgeMs / 1_000),
    walletBalanceWei: walletBalanceWei?.toString() ?? null,
    minimumWalletBalanceWei: minimumWalletBalanceWei.toString(),
    selfRevealFallbacksPending: gauges.keeper_self_reveal_fallbacks_pending,
    roundsAwaitingBeaconFailure: gauges.keeper_rounds_awaiting_beacon_failure,
    roundsAwaitingScoringEntropy: gauges.keeper_rounds_awaiting_scoring_entropy,
  };
}

export function renderMetrics() {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(counters)) {
    lines.push(`# TYPE ${name} counter`, `${name} ${value}`);
  }
  for (const [name, value] of Object.entries(gauges)) {
    lines.push(`# TYPE ${name} gauge`, `${name} ${value}`);
  }
  return `${lines.join("\n")}\n`;
}

function authorized(header: string | undefined, token: string | null) {
  return token === null || header === `Bearer ${token}`;
}

export function startMetricsServer(
  port: number,
  bindAddress: string,
  authToken: string | null,
): Server {
  const server = createServer((request, response) => {
    if (request.url === "/live") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ status: "live", protocol: "tokenless-v4" }),
      );
      return;
    }
    if (request.url === "/ready") {
      const health = operationalHealthSnapshot();
      response.writeHead(health.status === "ok" ? 200 : 503, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify({
          status: health.status,
          protocol: health.protocol,
          reasons: health.reasons,
        }),
      );
      return;
    }
    if (!authorized(request.headers.authorization, authToken)) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    if (request.url === "/metrics") {
      response.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
      response.end(renderMetrics());
      return;
    }
    if (request.url === "/health") {
      const health = operationalHealthSnapshot();
      response.writeHead(health.status === "ok" ? 200 : 503, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify(health));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.listen(port, bindAddress);
  return server;
}

export function __resetMetricsForTests() {
  for (const key of Object.keys(counters)) counters[key] = 0;
  for (const key of Object.keys(gauges)) gauges[key] = 0;
  consecutiveErrors = 0;
  lastRunAt = null;
  lastProgressAt = null;
  lastWorkObservedAt = null;
  walletBalanceWei = null;
  minimumWalletBalanceWei = 0n;
  healthThresholdMs = 45_000;
}
