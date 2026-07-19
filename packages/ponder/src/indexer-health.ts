export type TokenlessIndexerFreshnessThresholds = {
  maxBlockLag: number;
  maxAgeSeconds: number;
};

export type TokenlessIndexerHealth = {
  status: "ok" | "syncing" | "stale";
  reasons: string[];
  blockLag: number | null;
  indexAgeSeconds: number | null;
  thresholds: TokenlessIndexerFreshnessThresholds;
};

const DEFAULT_MAX_BLOCK_LAG = 30;
const DEFAULT_MAX_AGE_SECONDS = 120;

function positiveInteger(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  key: string,
  fallback: number,
) {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${key} must be a positive integer.`);
  }
  return value;
}

export function tokenlessIndexerFreshnessThresholds(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): TokenlessIndexerFreshnessThresholds {
  return {
    maxBlockLag: positiveInteger(
      env,
      "TOKENLESS_MAX_INDEX_LAG_BLOCKS",
      DEFAULT_MAX_BLOCK_LAG,
    ),
    maxAgeSeconds: positiveInteger(
      env,
      "TOKENLESS_MAX_INDEX_AGE_SECONDS",
      DEFAULT_MAX_AGE_SECONDS,
    ),
  };
}

export function evaluateTokenlessIndexerHealth(input: {
  chainHead: bigint;
  startBlock: number;
  indexBlock: number | null;
  indexTimestamp: number | null;
  indexReady: boolean;
  initialEpochIndexed: boolean;
  enforceWallClockFreshness: boolean;
  nowSeconds?: number;
  thresholds?: TokenlessIndexerFreshnessThresholds;
}): TokenlessIndexerHealth {
  const thresholds = input.thresholds ?? tokenlessIndexerFreshnessThresholds();
  const reasons: string[] = [];
  if (!input.initialEpochIndexed) reasons.push("initial_epoch_not_indexed");
  if (!input.indexReady) reasons.push("historical_index_not_ready");
  if (input.indexBlock === null || input.indexBlock < input.startBlock) {
    reasons.push("deployment_block_not_indexed");
  }
  if (reasons.length > 0) {
    return {
      status: "syncing",
      reasons,
      blockLag: null,
      indexAgeSeconds: null,
      thresholds,
    };
  }

  const indexBlock = input.indexBlock!;
  const rawLag = input.chainHead - BigInt(indexBlock);
  const blockLag =
    rawLag <= 0n
      ? 0
      : Number(
          rawLag > BigInt(Number.MAX_SAFE_INTEGER)
            ? Number.MAX_SAFE_INTEGER
            : rawLag,
        );
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const indexAgeSeconds =
    input.indexTimestamp === null
      ? null
      : Math.max(0, nowSeconds - input.indexTimestamp);
  if (blockLag > thresholds.maxBlockLag)
    reasons.push("index_block_lag_exceeded");
  if (
    input.enforceWallClockFreshness &&
    (indexAgeSeconds === null || indexAgeSeconds > thresholds.maxAgeSeconds)
  ) {
    reasons.push("index_timestamp_age_exceeded");
  }
  return {
    status: reasons.length === 0 ? "ok" : "stale",
    reasons,
    blockLag,
    indexAgeSeconds,
    thresholds,
  };
}
