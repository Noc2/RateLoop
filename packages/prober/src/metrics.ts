/**
 * Prometheus-compatible metrics endpoint and health check.
 * Uses only Node.js builtins — no external dependencies.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import type { ProberRunResult } from "./types.js";

const counters: Record<string, number> = {
  prober_candidates_discovered_total: 0,
  prober_candidates_processed_total: 0,
  prober_candidates_skipped_total: 0,
  prober_probe_results_recorded_total: 0,
  prober_drift_flags_recorded_total: 0,
  prober_detector_failures_total: 0,
  prober_runs_total: 0,
  prober_errors_total: 0,
  prober_artifacts_stored_total: 0,
};

const gauges: Record<string, number> = {
  prober_last_run_duration_seconds: 0,
  prober_last_successful_run_timestamp: 0,
  prober_is_running: 0,
  prober_wallet_balance_wei: 0,
  prober_latest_block: 0,
  prober_last_scanned_block: 0,
  prober_pending_candidates: 0,
};

const startTime = Date.now();
let consecutiveErrors = 0;
let lastRunTime: Date | null = null;
let healthThresholdMs = 90_000;

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

export function getConsecutiveErrors(): number {
  return consecutiveErrors;
}

export function recordRun(result: ProberRunResult, durationMs: number) {
  counters.prober_runs_total++;
  counters.prober_candidates_discovered_total += result.candidatesDiscovered;
  counters.prober_candidates_processed_total += result.candidatesProcessed;
  counters.prober_candidates_skipped_total += result.candidatesSkipped;
  counters.prober_probe_results_recorded_total += result.probeResultsRecorded;
  counters.prober_drift_flags_recorded_total += result.driftFlagsRecorded;
  counters.prober_detector_failures_total += result.failedDetections;
  gauges.prober_last_run_duration_seconds = durationMs / 1000;
  gauges.prober_last_successful_run_timestamp = Date.now() / 1000;
  gauges.prober_latest_block = Number(result.latestBlock);
  gauges.prober_last_scanned_block = Number(result.lastScannedBlock);
  gauges.prober_pending_candidates = result.pendingCount;
  consecutiveErrors = 0;
  lastRunTime = new Date();
}

export function recordError() {
  counters.prober_errors_total++;
  consecutiveErrors++;
}

function renderMetrics(): string {
  const lines: string[] = [];

  const counterHelp: Record<string, string> = {
    prober_candidates_discovered_total: "Total probe candidates discovered",
    prober_candidates_processed_total: "Total probe candidates processed",
    prober_candidates_skipped_total: "Total probe candidates skipped because they no longer need probing",
    prober_probe_results_recorded_total: "Total probe results recorded on-chain",
    prober_drift_flags_recorded_total: "Total behavioral drift flags recorded on-chain",
    prober_detector_failures_total: "Total probe candidate processing failures",
    prober_runs_total: "Total prober run cycles",
    prober_errors_total: "Total prober run errors",
    prober_artifacts_stored_total: "Total probe metadata artifacts stored through the configured store",
  };

  for (const [name, value] of Object.entries(counters)) {
    lines.push(`# HELP ${name} ${counterHelp[name] || name}`);
    lines.push(`# TYPE ${name} counter`);
    lines.push(`${name} ${value}`);
  }

  const gaugeHelp: Record<string, string> = {
    prober_last_run_duration_seconds: "Duration of the last prober run in seconds",
    prober_last_successful_run_timestamp: "Unix timestamp of last successful run",
    prober_is_running: "Whether a prober run is currently in progress",
    prober_wallet_balance_wei: "Prober wallet native balance in wei",
    prober_latest_block: "Latest block observed by the prober",
    prober_last_scanned_block: "Last declaration history block scanned by the prober",
    prober_pending_candidates: "Current number of queued pending probe candidates",
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
    lastRunDuration: gauges.prober_last_run_duration_seconds,
    consecutiveErrors,
    totalRuns: counters.prober_runs_total,
    probeResultsRecorded: counters.prober_probe_results_recorded_total,
    driftFlagsRecorded: counters.prober_drift_flags_recorded_total,
    pendingCandidates: gauges.prober_pending_candidates,
    lastScannedBlock: String(BigInt(Math.round(gauges.prober_last_scanned_block))),
    latestBlock: String(BigInt(Math.round(gauges.prober_latest_block))),
    walletBalanceWei: String(BigInt(Math.round(gauges.prober_wallet_balance_wei))),
  });

  return { status: healthy ? 200 : 503, body };
}

export function getHealthSnapshot(): { status: number; body: string } {
  return renderHealth();
}

function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.url === "/metrics" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
    res.end(renderMetrics());
  } else if (req.url === "/health" && req.method === "GET") {
    const { status, body } = renderHealth();
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(body);
  } else {
    res.writeHead(404);
    res.end("Not Found\n");
  }
}

export function startMetricsServer(port: number, bindAddress = "127.0.0.1"): Server {
  const server = createServer(handler);
  server.listen(port, bindAddress);
  return server;
}
