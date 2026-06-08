import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  getHealthSnapshot,
  incrementCounter,
  getMetricsText,
  setGauge,
  recordRun,
  recordError,
  getConsecutiveErrors,
  resolveCorrelationArtifactResponse,
  startMetricsServer,
} from "../metrics.js";
import type { KeeperResult } from "../keeper.js";

function makeResult(overrides: Partial<KeeperResult> = {}): KeeperResult {
  return {
    roundsSettled: 0,
    roundsCancelled: 0,
    roundsRevealFailedFinalized: 0,
    votesRevealed: 0,
    advisoryVotesRevealed: 0,
    advisoryLaunchCreditsClaimed: 0,
    cleanupBatchesProcessed: 0,
    contentMarkedDormant: 0,
    ...overrides,
  };
}

function requestLocalhost(port: number, path: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET" }, res => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(Buffer.from(chunk)));
      res.on("end", () =>
        resolve({
          statusCode: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

describe("metrics", () => {
  it("incrementCounter increments known counters", () => {
    // This just verifies no throw — counters are internal
    incrementCounter("keeper_runs_total");
    incrementCounter("keeper_runs_total", 5);
  });

  it("incrementCounter ignores unknown counters", () => {
    // Should not throw
    incrementCounter("unknown_counter");
  });

  it("setGauge sets known gauges", () => {
    setGauge("keeper_is_running", 1);
    setGauge("keeper_is_running", 0);
  });

  it("setGauge ignores unknown gauges", () => {
    setGauge("unknown_gauge", 42);
  });

  it("recordRun resets consecutive errors", () => {
    recordError();
    recordError();
    expect(getConsecutiveErrors()).toBe(2);

    recordRun(makeResult({ roundsSettled: 1 }), 100);
    expect(getConsecutiveErrors()).toBe(0);
  });

  it("recordError increments consecutive errors", () => {
    // Reset by doing a successful run first
    recordRun(makeResult(), 50);
    expect(getConsecutiveErrors()).toBe(0);

    recordError();
    expect(getConsecutiveErrors()).toBe(1);
    recordError();
    expect(getConsecutiveErrors()).toBe(2);
  });

  it("renders operational gauges in metrics and health responses", async () => {
    recordRun(
      makeResult({
        roundsRevealFailedFinalized: 2,
        cleanupBatchesProcessed: 3,
      }),
      75,
    );
    setGauge("keeper_wallet_balance_wei", 4_000_000_000_000);

    const metricsBody = getMetricsText();
    expect(metricsBody).toContain("keeper_rounds_reveal_failed_finalized_total 2");
    expect(metricsBody).toContain("keeper_unrevealed_cleanup_batches_total 3");
    expect(metricsBody).toContain("keeper_wallet_balance_wei 4000000000000");

    const health = getHealthSnapshot();
    expect([200, 503]).toContain(health.status);
    expect(JSON.parse(health.body)).toMatchObject({
      roundsRevealFailedFinalized: 2,
      cleanupBatchesProcessed: 3,
      walletBalanceWei: "4000000000000",
    });
  });

  it("resolves only hash-named correlation artifacts from the artifact directory", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "keeper-artifacts-"));
    const artifactFilename = `0x${"a".repeat(64)}.json`;
    const artifactBody = { ok: true, artifact: "test" };
    await writeFile(join(artifactDir, artifactFilename), `${JSON.stringify(artifactBody)}\n`, "utf8");

    try {
      const artifactResponse = await resolveCorrelationArtifactResponse(
        "GET",
        `/correlation-artifacts/${artifactFilename}`,
        artifactDir,
      );
      expect(artifactResponse?.status).toBe(200);
      expect(artifactResponse?.headers?.["Content-Type"]).toContain("application/json");
      expect(JSON.parse(artifactResponse!.body!.toString())).toEqual(artifactBody);

      const headResponse = await resolveCorrelationArtifactResponse(
        "HEAD",
        `/correlation-artifacts/${artifactFilename}`,
        artifactDir,
      );
      expect(headResponse?.status).toBe(200);
      expect(headResponse?.body).toBeUndefined();

      const invalidArtifactResponse = await resolveCorrelationArtifactResponse(
        "GET",
        "/correlation-artifacts/not-an-artifact.json",
        artifactDir,
      );
      expect(invalidArtifactResponse?.status).toBe(404);

      await expect(
        resolveCorrelationArtifactResponse("GET", "/metrics", artifactDir),
      ).resolves.toBeNull();
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it("serves unauthenticated liveness while protecting detailed health", async () => {
    const server = startMetricsServer(0, "127.0.0.1", "0123456789abcdef");
    try {
      await once(server, "listening");
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        throw new Error("Expected TCP server address");
      }

      const live = await requestLocalhost(address.port, "/live");
      expect(live.statusCode).toBe(200);
      expect(JSON.parse(live.body)).toEqual({ status: "ok" });

      const health = await requestLocalhost(address.port, "/health");
      expect(health.statusCode).toBe(401);
    } finally {
      server.close();
    }
  });
});
