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
  keeper_rounds_settled_total: 0,
  keeper_rounds_cancelled_total: 0,
  keeper_rounds_reveal_failed_finalized_total: 0,
  keeper_votes_revealed_total: 0,
  keeper_advisory_votes_revealed_total: 0,
  keeper_advisory_launch_credits_claimed_total: 0,
  keeper_unrevealed_cleanup_batches_total: 0,
  keeper_content_marked_dormant_total: 0,
  keeper_feedback_reveal_jobs_leased_total: 0,
  keeper_feedback_reveals_total: 0,
  keeper_feedback_reveal_failures_total: 0,
  keeper_feedback_reveal_already_revealed_total: 0,
  keeper_runs_total: 0,
  keeper_errors_total: 0,
  keeper_decrypt_failures_total: 0,
};

// --- Gauges ---
const gauges: Record<string, number> = {
  keeper_last_run_duration_seconds: 0,
  keeper_last_successful_run_timestamp: 0,
  keeper_is_running: 0,
  keeper_wallet_balance_wei: 0,
};

const startTime = Date.now();
let consecutiveErrors = 0;
let lastRunTime: Date | null = null;
let healthThresholdMs = 90_000; // 3x default 30s interval

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

/** Record the result of a keeper run. */
export function recordRun(result: KeeperResult, durationMs: number) {
  counters.keeper_runs_total++;
  counters.keeper_rounds_settled_total += result.roundsSettled;
  counters.keeper_rounds_cancelled_total += result.roundsCancelled;
  counters.keeper_rounds_reveal_failed_finalized_total += result.roundsRevealFailedFinalized;
  counters.keeper_votes_revealed_total += result.votesRevealed;
  counters.keeper_advisory_votes_revealed_total += result.advisoryVotesRevealed;
  counters.keeper_advisory_launch_credits_claimed_total += result.advisoryLaunchCreditsClaimed;
  counters.keeper_unrevealed_cleanup_batches_total += result.cleanupBatchesProcessed;
  counters.keeper_content_marked_dormant_total += result.contentMarkedDormant;
  gauges.keeper_last_run_duration_seconds = durationMs / 1000;
  gauges.keeper_last_successful_run_timestamp = Date.now() / 1000;
  consecutiveErrors = 0;
  lastRunTime = new Date();
}

export function recordFeedbackRevealRun(result: {
  jobsLeased: number;
  revealed: number;
  failures: number;
  alreadyRevealed: number;
}) {
  counters.keeper_feedback_reveal_jobs_leased_total += result.jobsLeased;
  counters.keeper_feedback_reveals_total += result.revealed;
  counters.keeper_feedback_reveal_failures_total += result.failures;
  counters.keeper_feedback_reveal_already_revealed_total += result.alreadyRevealed;
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
    keeper_rounds_settled_total: "Total rounds settled by keeper",
    keeper_rounds_cancelled_total: "Total rounds cancelled by keeper",
    keeper_rounds_reveal_failed_finalized_total: "Total rounds finalized as RevealFailed by keeper",
    keeper_votes_revealed_total: "Total votes revealed by keeper",
    keeper_advisory_votes_revealed_total: "Total advisory votes revealed by keeper",
    keeper_advisory_launch_credits_claimed_total: "Total advisory launch credits claimed by keeper",
    keeper_unrevealed_cleanup_batches_total: "Total unrevealed-vote cleanup batches processed by keeper",
    keeper_content_marked_dormant_total: "Total content items marked dormant",
    keeper_feedback_reveal_jobs_leased_total: "Legacy no-op feedback reveal jobs leased from the app queue",
    keeper_feedback_reveals_total: "Legacy no-op content feedback reveals submitted by keeper",
    keeper_feedback_reveal_failures_total: "Legacy no-op content feedback reveal jobs reported failed by keeper",
    keeper_feedback_reveal_already_revealed_total: "Legacy no-op content feedback jobs already revealed on-chain",
    keeper_runs_total: "Total keeper run cycles",
    keeper_errors_total: "Total keeper run errors",
    keeper_decrypt_failures_total: "Total tlock decryption failures",
  };

  for (const [name, value] of Object.entries(counters)) {
    lines.push(`# HELP ${name} ${counterHelp[name] || name}`);
    lines.push(`# TYPE ${name} counter`);
    lines.push(`${name} ${value}`);
  }

  const gaugeHelp: Record<string, string> = {
    keeper_last_run_duration_seconds: "Duration of the last keeper run in seconds",
    keeper_last_successful_run_timestamp: "Unix timestamp of last successful run",
    keeper_is_running: "Whether a keeper run is currently in progress",
    keeper_wallet_balance_wei: "Keeper wallet native balance in wei",
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
    consecutiveErrors,
    totalRuns: counters.keeper_runs_total,
    roundsRevealFailedFinalized: counters.keeper_rounds_reveal_failed_finalized_total,
    cleanupBatchesProcessed: counters.keeper_unrevealed_cleanup_batches_total,
    decryptFailures: counters.keeper_decrypt_failures_total,
    walletBalanceWei: String(BigInt(Math.round(gauges.keeper_wallet_balance_wei))),
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
