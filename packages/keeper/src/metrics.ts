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
  keeper_weight_batches_processed_total: 0,
  keeper_rounds_finalized_total: 0,
  keeper_terminal_rounds_advanced_total: 0,
  keeper_claims_executed_total: 0,
  keeper_stale_returns_executed_total: 0,
};

const gauges: Record<string, number> = {
  keeper_is_running: 0,
  keeper_last_run_duration_seconds: 0,
  keeper_last_successful_run_timestamp: 0,
  keeper_wallet_balance_wei: 0,
  keeper_rounds_scanned: 0,
  keeper_self_reveal_fallbacks_pending: 0,
};

let consecutiveErrors = 0;
let lastRunAt: Date | null = null;
let walletBalanceWei: bigint | null = null;
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
  counters.keeper_weight_batches_processed_total +=
    result.weightBatchesProcessed;
  counters.keeper_rounds_finalized_total += result.roundsFinalized;
  counters.keeper_terminal_rounds_advanced_total +=
    result.terminalRoundsAdvanced;
  counters.keeper_claims_executed_total += result.claimsExecuted;
  counters.keeper_stale_returns_executed_total += result.staleReturnsExecuted;
  gauges.keeper_last_run_duration_seconds = durationMs / 1000;
  gauges.keeper_last_successful_run_timestamp = Date.now() / 1000;
  gauges.keeper_rounds_scanned = result.roundsScanned;
  gauges.keeper_self_reveal_fallbacks_pending =
    result.selfRevealFallbacksPending;
  consecutiveErrors = 0;
  lastRunAt = new Date();
}

function renderMetrics() {
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
  authToken: string | null
): Server {
  const server = createServer((request, response) => {
    if (request.url === "/live") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ status: "live", protocol: "tokenless-v1" })
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
      const stale =
        !lastRunAt || Date.now() - lastRunAt.getTime() > healthThresholdMs;
      const healthy = !stale && consecutiveErrors < 3;
      response.writeHead(healthy ? 200 : 503, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify({
          status: healthy ? "ok" : "degraded",
          protocol: "tokenless-v1",
          consecutiveErrors,
          lastRunAt: lastRunAt?.toISOString() ?? null,
          walletBalanceWei: walletBalanceWei?.toString() ?? null,
          selfRevealFallbacksPending:
            gauges.keeper_self_reveal_fallbacks_pending,
        })
      );
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.listen(port, bindAddress);
  return server;
}
