import { describe, expect, it } from "vitest";
import {
  evaluateTokenlessIndexerHealth,
  tokenlessIndexerFreshnessThresholds,
} from "../src/indexer-health";

const thresholds = { maxBlockLag: 30, maxAgeSeconds: 120 };

describe("tokenless indexer operational health", () => {
  it("reports historical sync separately from freshness", () => {
    expect(
      evaluateTokenlessIndexerHealth({
        chainHead: 1_100n,
        startBlock: 1_000,
        indexBlock: null,
        indexTimestamp: null,
        indexReady: false,
        initialEpochIndexed: false,
        enforceWallClockFreshness: true,
        thresholds,
      }),
    ).toMatchObject({
      status: "syncing",
      reasons: [
        "initial_epoch_not_indexed",
        "historical_index_not_ready",
        "deployment_block_not_indexed",
      ],
    });
  });

  it("fails health when block or wall-clock freshness exceeds its bound", () => {
    expect(
      evaluateTokenlessIndexerHealth({
        chainHead: 1_100n,
        startBlock: 1_000,
        indexBlock: 1_050,
        indexTimestamp: 1_000,
        indexReady: true,
        initialEpochIndexed: true,
        enforceWallClockFreshness: true,
        nowSeconds: 1_181,
        thresholds,
      }),
    ).toEqual({
      status: "stale",
      reasons: ["index_block_lag_exceeded", "index_timestamp_age_exceeded"],
      blockLag: 50,
      indexAgeSeconds: 181,
      thresholds,
    });
  });

  it("keeps an idle local chain honest without imposing hosted wall-clock activity", () => {
    expect(
      evaluateTokenlessIndexerHealth({
        chainHead: 1_010n,
        startBlock: 1_000,
        indexBlock: 1_010,
        indexTimestamp: 1,
        indexReady: true,
        initialEpochIndexed: true,
        enforceWallClockFreshness: false,
        nowSeconds: 10_000,
        thresholds,
      }).status,
    ).toBe("ok");
  });

  it("rejects invalid alert thresholds instead of silently disabling them", () => {
    expect(() =>
      tokenlessIndexerFreshnessThresholds({
        TOKENLESS_MAX_INDEX_LAG_BLOCKS: "0",
      }),
    ).toThrow(/positive integer/);
  });
});
