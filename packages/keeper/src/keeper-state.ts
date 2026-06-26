import pg from "pg";
import { config } from "./config.js";
import type { Logger } from "./logger.js";

const { Pool } = pg;

const CORRELATION_SNAPSHOT_LOCK_KEY = "773526208283402193";
const MAIN_LOOP_LOCK_KEY = "773526208283402194";
const CACHE_WRITE_RETRY_DELAY_MS = 60_000;
const PERSISTENCE_POOL_MAX_CONNECTIONS = 3;

type AdvisoryLockResult =
  | { status: "acquired"; client: pg.PoolClient }
  | { status: "busy" }
  | { status: "unavailable" };

interface CachedCorrelationArtifactWrite {
  fingerprint: `0x${string}`;
  artifactHash: `0x${string}`;
  canonicalJson: string;
  candidateCount: number;
  roundSnapshotCount: number;
  epochCount: number;
  logger: Logger;
}

interface PendingCacheWrite {
  params: CachedCorrelationArtifactWrite;
  failedAttempts: number;
  timer: ReturnType<typeof setTimeout> | null;
}

let pool: pg.Pool | null | undefined;
let schemaReady: Promise<void> | null = null;
const persistenceWarnings = new Set<string>();
const pendingCacheWrites = new Map<string, PendingCacheWrite>();

function getDatabaseUrl(): string | null {
  return config.persistence?.databaseUrl ?? null;
}

function getPool(): pg.Pool | null {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return null;
  }
  if (pool !== undefined) {
    return pool;
  }

  pool = new Pool({
    connectionString: databaseUrl,
    // Production ticks can hold the main-loop and correlation-snapshot advisory
    // lock clients while writing the correlation artifact cache.
    max: PERSISTENCE_POOL_MAX_CONNECTIONS,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "rateloop-keeper",
  });
  return pool;
}

function warnPersistenceOnce(
  logger: Logger,
  key: string,
  msg: string,
  error: unknown,
) {
  if (persistenceWarnings.has(key)) return;
  persistenceWarnings.add(key);
  logger.warn(msg, {
    error: error instanceof Error ? error.message : String(error),
  });
}

function formatPersistenceError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getCacheWriteKey(params: CachedCorrelationArtifactWrite): string {
  return params.fingerprint;
}

async function insertCachedCorrelationArtifact(
  activePool: pg.Pool,
  params: CachedCorrelationArtifactWrite,
) {
  await activePool.query(
    `
      insert into keeper_correlation_artifacts (
        fingerprint,
        artifact_hash,
        canonical_json,
        candidate_count,
        round_snapshot_count,
        epoch_count,
        created_at,
        last_used_at
      )
      values ($1, $2, $3, $4, $5, $6, now(), now())
      on conflict (fingerprint) do update set
        artifact_hash = excluded.artifact_hash,
        canonical_json = excluded.canonical_json,
        candidate_count = excluded.candidate_count,
        round_snapshot_count = excluded.round_snapshot_count,
        epoch_count = excluded.epoch_count,
        last_used_at = now()
    `,
    [
      params.fingerprint,
      params.artifactHash,
      params.canonicalJson,
      params.candidateCount,
      params.roundSnapshotCount,
      params.epochCount,
    ],
  );
}

function clearPendingCacheWrite(params: CachedCorrelationArtifactWrite) {
  const key = getCacheWriteKey(params);
  const pending = pendingCacheWrites.get(key);
  if (!pending) return;

  if (pending.timer) {
    clearTimeout(pending.timer);
  }
  pendingCacheWrites.delete(key);
  params.logger.info("Keeper persistence artifact cache write recovered", {
    artifactHash: params.artifactHash,
    failedAttempts: pending.failedAttempts,
    fingerprint: params.fingerprint,
  });
}

function schedulePendingCacheWriteRetry(
  key: string,
  pending: PendingCacheWrite,
) {
  if (pending.timer) return;

  pending.timer = setTimeout(() => {
    pending.timer = null;
    void retryCachedCorrelationArtifact(key);
  }, CACHE_WRITE_RETRY_DELAY_MS);
  pending.timer.unref?.();
}

function rememberFailedCacheWrite(
  params: CachedCorrelationArtifactWrite,
  error: unknown,
) {
  const key = getCacheWriteKey(params);
  const pending = pendingCacheWrites.get(key) ?? {
    params,
    failedAttempts: 0,
    timer: null,
  };
  pending.params = params;
  pending.failedAttempts += 1;
  pendingCacheWrites.set(key, pending);

  params.logger.warn(
    "Keeper persistence artifact cache write failed; scheduling retry",
    {
      artifactHash: params.artifactHash,
      error: formatPersistenceError(error),
      failedAttempts: pending.failedAttempts,
      fingerprint: params.fingerprint,
      retryDelayMs: CACHE_WRITE_RETRY_DELAY_MS,
    },
  );
  schedulePendingCacheWriteRetry(key, pending);
}

async function retryCachedCorrelationArtifact(key: string): Promise<void> {
  const pending = pendingCacheWrites.get(key);
  if (!pending) return;

  let activePool: pg.Pool | null = null;
  try {
    activePool = await ensureSchema(pending.params.logger);
  } catch (error) {
    rememberFailedCacheWrite(pending.params, error);
    return;
  }
  if (!activePool) {
    pendingCacheWrites.delete(key);
    return;
  }

  try {
    await insertCachedCorrelationArtifact(activePool, pending.params);
    clearPendingCacheWrite(pending.params);
  } catch (error) {
    rememberFailedCacheWrite(pending.params, error);
  }
}

async function tryAcquireAdvisoryLock(params: {
  activePool: pg.Pool;
  lockKey: string;
  logger: Logger;
  warningKey: string;
  warningMessage: string;
}): Promise<AdvisoryLockResult> {
  let client: pg.PoolClient | null = null;
  try {
    client = await params.activePool.connect();
    const result = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1::bigint) as locked",
      [params.lockKey],
    );
    const locked = result.rows[0]?.locked === true;
    if (!locked) {
      client.release();
      return { status: "busy" };
    }
    return { status: "acquired", client };
  } catch (error) {
    client?.release();
    warnPersistenceOnce(
      params.logger,
      params.warningKey,
      params.warningMessage,
      error,
    );
    return { status: "unavailable" };
  }
}

async function releaseAdvisoryLock(params: {
  client: pg.PoolClient;
  lockKey: string;
  logger: Logger;
  warningKey: string;
  warningMessage: string;
}): Promise<void> {
  let releaseError: Error | undefined;
  try {
    await params.client.query("select pg_advisory_unlock($1::bigint)", [
      params.lockKey,
    ]);
  } catch (error) {
    releaseError = error instanceof Error ? error : new Error(String(error));
    warnPersistenceOnce(
      params.logger,
      params.warningKey,
      params.warningMessage,
      error,
    );
  } finally {
    params.client.release(releaseError);
  }
}

async function ensureSchema(logger: Logger): Promise<pg.Pool | null> {
  const activePool = getPool();
  if (!activePool) {
    return null;
  }

  schemaReady ??= activePool
    .query(
      `
      create table if not exists keeper_correlation_artifacts (
        fingerprint text primary key,
        artifact_hash text not null,
        canonical_json text not null,
        candidate_count integer not null default 0,
        round_snapshot_count integer not null default 0,
        epoch_count integer not null default 0,
        created_at timestamptz not null default now(),
        last_used_at timestamptz not null default now()
      )
    `,
    )
    .then(() => undefined)
    .catch((error: unknown) => {
      schemaReady = null;
      warnPersistenceOnce(
        logger,
        "schema",
        "Keeper persistence schema initialization failed",
        error,
      );
      throw error;
    });

  await schemaReady;
  return activePool;
}

export async function runWithCorrelationSnapshotPublishLock<T>(
  logger: Logger,
  fallback: T,
  run: () => Promise<T>,
): Promise<T> {
  let activePool: pg.Pool | null = null;
  try {
    activePool = await ensureSchema(logger);
  } catch {
    return run();
  }

  if (!activePool) {
    return run();
  }

  const lock = await tryAcquireAdvisoryLock({
    activePool,
    lockKey: CORRELATION_SNAPSHOT_LOCK_KEY,
    logger,
    warningKey: "lock",
    warningMessage:
      "Keeper persistence lock unavailable; running correlation snapshot publication without it",
  });
  if (lock.status === "unavailable") {
    return run();
  }
  if (lock.status === "busy") {
    logger.debug(
      "Skipping correlation snapshot publication because another keeper holds the persistence lock",
    );
    return fallback;
  }

  try {
    return await run();
  } finally {
    await releaseAdvisoryLock({
      client: lock.client,
      lockKey: CORRELATION_SNAPSHOT_LOCK_KEY,
      logger,
      warningKey: "unlock",
      warningMessage: "Keeper persistence lock release failed",
    });
  }
}

export async function runWithKeeperMainLoopLock<T>(
  logger: Logger,
  fallback: T,
  run: () => Promise<T>,
  options: { lockRequired?: boolean } = {},
): Promise<T> {
  const lockRequired = options.lockRequired === true;
  let activePool: pg.Pool | null = null;
  try {
    activePool = await ensureSchema(logger);
  } catch (error) {
    if (lockRequired) {
      throw error;
    }
    return run();
  }

  if (!activePool) {
    if (lockRequired) {
      warnPersistenceOnce(
        logger,
        "main-loop-lock-required-without-database",
        "Keeper main loop lock required but KEEPER_DATABASE_URL is not configured; skipping this tick",
        "missing database",
      );
      throw new Error(
        "KEEPER_DATABASE_URL is required when KEEPER_MAIN_LOOP_LOCK_REQUIRED=true",
      );
    }
    return run();
  }

  const lock = await tryAcquireAdvisoryLock({
    activePool,
    lockKey: MAIN_LOOP_LOCK_KEY,
    logger,
    warningKey: "main-loop-lock",
    warningMessage: lockRequired
      ? "Keeper main loop lock unavailable; skipping this tick because KEEPER_MAIN_LOOP_LOCK_REQUIRED=true"
      : "Keeper main loop lock unavailable; running this tick without it",
  });
  if (lock.status === "unavailable") {
    if (lockRequired) {
      throw new Error(
        "Keeper main loop lock unavailable while KEEPER_MAIN_LOOP_LOCK_REQUIRED=true",
      );
    }
    return run();
  }
  if (lock.status === "busy") {
    logger.debug(
      "Skipping keeper main loop because another keeper holds the persistence lock",
    );
    return fallback;
  }

  try {
    return await run();
  } finally {
    await releaseAdvisoryLock({
      client: lock.client,
      lockKey: MAIN_LOOP_LOCK_KEY,
      logger,
      warningKey: "main-loop-unlock",
      warningMessage: "Keeper main loop lock release failed",
    });
  }
}

export async function writeCachedCorrelationArtifact(params: {
  fingerprint: `0x${string}`;
  artifactHash: `0x${string}`;
  canonicalJson: string;
  candidateCount: number;
  roundSnapshotCount: number;
  epochCount: number;
  logger: Logger;
}): Promise<void> {
  let activePool: pg.Pool | null = null;
  try {
    activePool = await ensureSchema(params.logger);
  } catch {
    return;
  }
  if (!activePool) {
    return;
  }

  try {
    await insertCachedCorrelationArtifact(activePool, params);
    clearPendingCacheWrite(params);
  } catch (error) {
    rememberFailedCacheWrite(params, error);
  }
}

export async function closeKeeperState(): Promise<void> {
  for (const pending of pendingCacheWrites.values()) {
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
  }
  pendingCacheWrites.clear();

  if (!pool) {
    return;
  }
  const activePool = pool;
  pool = null;
  schemaReady = null;
  await activePool.end();
}
