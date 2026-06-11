import pg from "pg";
import { config } from "./config.js";
import type { Logger } from "./logger.js";

const { Pool } = pg;

const CORRELATION_SNAPSHOT_LOCK_KEY = "773526208283402193";
const MAIN_LOOP_LOCK_KEY = "773526208283402194";

interface CachedCorrelationArtifactRow {
  artifact_hash: string;
  canonical_json: string;
}

interface CachedCorrelationArtifact {
  artifactHash: `0x${string}`;
  canonicalJson: string;
}

type AdvisoryLockResult =
  | { status: "acquired"; client: pg.PoolClient }
  | { status: "busy" }
  | { status: "unavailable" };

let pool: pg.Pool | null | undefined;
let schemaReady: Promise<void> | null = null;
const persistenceWarnings = new Set<string>();

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
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "rateloop-keeper",
  });
  return pool;
}

function warnPersistenceOnce(logger: Logger, key: string, msg: string, error: unknown) {
  if (persistenceWarnings.has(key)) return;
  persistenceWarnings.add(key);
  logger.warn(msg, {
    error: error instanceof Error ? error.message : String(error),
  });
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
    warnPersistenceOnce(params.logger, params.warningKey, params.warningMessage, error);
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
    await params.client.query("select pg_advisory_unlock($1::bigint)", [params.lockKey]);
  } catch (error) {
    releaseError = error instanceof Error ? error : new Error(String(error));
    warnPersistenceOnce(params.logger, params.warningKey, params.warningMessage, error);
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
    .query(`
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
    `)
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
    warningMessage: "Keeper persistence lock unavailable; running correlation snapshot publication without it",
  });
  if (lock.status === "unavailable") {
    return run();
  }
  if (lock.status === "busy") {
    logger.debug("Skipping correlation snapshot publication because another keeper holds the persistence lock");
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
    lockKey: MAIN_LOOP_LOCK_KEY,
    logger,
    warningKey: "main-loop-lock",
    warningMessage: "Keeper main loop lock unavailable; running this tick without it",
  });
  if (lock.status === "unavailable") {
    return run();
  }
  if (lock.status === "busy") {
    logger.debug("Skipping keeper main loop because another keeper holds the persistence lock");
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

export async function readCachedCorrelationArtifact(
  fingerprint: `0x${string}`,
  logger: Logger,
): Promise<CachedCorrelationArtifact | null> {
  let activePool: pg.Pool | null = null;
  try {
    activePool = await ensureSchema(logger);
  } catch {
    return null;
  }
  if (!activePool) {
    return null;
  }

  try {
    const result = await activePool.query<CachedCorrelationArtifactRow>(
      `
        update keeper_correlation_artifacts
        set last_used_at = now()
        where fingerprint = $1
        returning artifact_hash, canonical_json
      `,
      [fingerprint],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      artifactHash: row.artifact_hash as `0x${string}`,
      canonicalJson: row.canonical_json,
    };
  } catch (error) {
    warnPersistenceOnce(
      logger,
      "cache-read",
      "Keeper persistence artifact cache read failed",
      error,
    );
    return null;
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
  } catch (error) {
    warnPersistenceOnce(
      params.logger,
      "cache-write",
      "Keeper persistence artifact cache write failed",
      error,
    );
  }
}

export async function closeKeeperState(): Promise<void> {
  if (!pool) {
    return;
  }
  const activePool = pool;
  pool = null;
  schemaReady = null;
  await activePool.end();
}
