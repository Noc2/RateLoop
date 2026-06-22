import { afterEach, describe, expect, it, vi } from "vitest";

interface MockClient {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

interface MockPool {
  query: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

function mockConfig(databaseUrl: string | null = "postgres://keeper:keeper@localhost/keeper") {
  vi.doMock("../config.js", () => ({
    config: {
      persistence: databaseUrl ? { databaseUrl, mainLoopLockRequired: false } : undefined,
    },
  }));
}

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

async function importKeeperState(params: {
  databaseUrl?: string | null;
  locked?: boolean;
  schemaError?: Error;
  connectError?: Error;
  unlockError?: Error;
} = {}) {
  vi.resetModules();
  mockConfig(params.databaseUrl === undefined ? "postgres://keeper:keeper@localhost/keeper" : params.databaseUrl);

  const client: MockClient = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("pg_try_advisory_lock")) {
        return { rows: [{ locked: params.locked ?? true }] };
      }
      if (sql.includes("pg_advisory_unlock")) {
        if (params.unlockError) throw params.unlockError;
        return { rows: [{ pg_advisory_unlock: true }] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };

  const pool: MockPool = {
    query: vi.fn(async () => {
      if (params.schemaError) throw params.schemaError;
      return { rows: [] };
    }),
    connect: vi.fn(async () => {
      if (params.connectError) throw params.connectError;
      return client;
    }),
    end: vi.fn(async () => undefined),
  };

  const Pool = vi.fn(function MockPgPool() {
    return pool;
  });
  vi.doMock("pg", () => ({
    default: { Pool },
  }));

  const module = await import("../keeper-state.js");
  return { ...module, Pool, pool, client };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("keeper advisory lock wrappers", () => {
  it("holds the main-loop advisory lock client until the workload finishes", async () => {
    const { runWithKeeperMainLoopLock, pool, client } = await importKeeperState();
    const logger = createLogger();
    const run = vi.fn(async () => "ran");

    await expect(runWithKeeperMainLoopLock(logger, "fallback", run)).resolves.toBe("ran");

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith(
      "select pg_try_advisory_lock($1::bigint) as locked",
      ["773526208283402194"],
    );
    expect(client.query).toHaveBeenCalledWith(
      "select pg_advisory_unlock($1::bigint)",
      ["773526208283402194"],
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledTimes(1);

    const lockOrder = client.query.mock.invocationCallOrder[0]!;
    const runOrder = run.mock.invocationCallOrder[0]!;
    const unlockOrder = client.query.mock.invocationCallOrder[1]!;
    const releaseOrder = client.release.mock.invocationCallOrder[0]!;
    expect(lockOrder).toBeLessThan(runOrder);
    expect(runOrder).toBeLessThan(unlockOrder);
    expect(unlockOrder).toBeLessThan(releaseOrder);
  });

  it("propagates main-loop workload errors after releasing the lock", async () => {
    const { runWithKeeperMainLoopLock, client } = await importKeeperState();
    const logger = createLogger();
    const error = new Error("rpc unavailable");
    const run = vi.fn(async () => {
      throw error;
    });

    await expect(runWithKeeperMainLoopLock(logger, "fallback", run)).rejects.toThrow(error);

    expect(run).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith(
      "select pg_advisory_unlock($1::bigint)",
      ["773526208283402194"],
    );
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalledWith(
      "Keeper main loop lock unavailable; running this tick without it",
      expect.anything(),
    );
  });

  it("discards the main-loop lock client when unlock fails", async () => {
    const unlockError = new Error("connection reset during unlock");
    const { runWithKeeperMainLoopLock, client } = await importKeeperState({ unlockError });
    const logger = createLogger();
    const run = vi.fn(async () => "ran");

    await expect(runWithKeeperMainLoopLock(logger, "fallback", run)).resolves.toBe("ran");

    expect(client.query).toHaveBeenCalledWith(
      "select pg_advisory_unlock($1::bigint)",
      ["773526208283402194"],
    );
    expect(client.release).toHaveBeenCalledWith(unlockError);
    expect(logger.warn).toHaveBeenCalledWith("Keeper main loop lock release failed", {
      error: "connection reset during unlock",
    });
  });

  it("returns the main-loop fallback without running when another keeper holds the lock", async () => {
    const { runWithKeeperMainLoopLock, client } = await importKeeperState({ locked: false });
    const logger = createLogger();
    const run = vi.fn(async () => "ran");

    await expect(runWithKeeperMainLoopLock(logger, "fallback", run)).resolves.toBe("fallback");

    expect(run).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      "Skipping keeper main loop because another keeper holds the persistence lock",
    );
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.query).not.toHaveBeenCalledWith(
      "select pg_advisory_unlock($1::bigint)",
      ["773526208283402194"],
    );
  });

  it("runs the main loop without persistence when schema setup fails", async () => {
    const { runWithKeeperMainLoopLock, pool } = await importKeeperState({
      schemaError: new Error("database down"),
    });
    const logger = createLogger();
    const run = vi.fn(async () => "ran");

    await expect(runWithKeeperMainLoopLock(logger, "fallback", run)).resolves.toBe("ran");

    expect(run).toHaveBeenCalledTimes(1);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "Keeper persistence schema initialization failed",
      { error: "database down" },
    );
  });

  it("returns the main-loop fallback when a required lock cannot initialize", async () => {
    const { runWithKeeperMainLoopLock, pool } = await importKeeperState({
      schemaError: new Error("database down"),
    });
    const logger = createLogger();
    const run = vi.fn(async () => "ran");

    await expect(
      runWithKeeperMainLoopLock(logger, "fallback", run, { lockRequired: true }),
    ).resolves.toBe("fallback");

    expect(run).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "Keeper persistence schema initialization failed",
      { error: "database down" },
    );
  });

  it("returns the main-loop fallback when a required lock cannot be acquired", async () => {
    const { runWithKeeperMainLoopLock, client } = await importKeeperState({
      connectError: new Error("too many clients"),
    });
    const logger = createLogger();
    const run = vi.fn(async () => "ran");

    await expect(
      runWithKeeperMainLoopLock(logger, "fallback", run, { lockRequired: true }),
    ).resolves.toBe("fallback");

    expect(run).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "Keeper main loop lock unavailable; skipping this tick because KEEPER_MAIN_LOOP_LOCK_REQUIRED=true",
      { error: "too many clients" },
    );
  });

  it("returns the main-loop fallback when a required lock has no database", async () => {
    const { runWithKeeperMainLoopLock, pool } = await importKeeperState({
      databaseUrl: null,
    });
    const logger = createLogger();
    const run = vi.fn(async () => "ran");

    await expect(
      runWithKeeperMainLoopLock(logger, "fallback", run, { lockRequired: true }),
    ).resolves.toBe("fallback");

    expect(run).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "Keeper main loop lock required but KEEPER_DATABASE_URL is not configured; skipping this tick",
      { error: "missing database" },
    );
  });

  it("propagates correlation workload errors without re-running the workload", async () => {
    const { runWithCorrelationSnapshotPublishLock, client } = await importKeeperState();
    const logger = createLogger();
    const error = new Error("publication failed");
    const run = vi.fn(async () => {
      throw error;
    });

    await expect(runWithCorrelationSnapshotPublishLock(logger, "fallback", run)).rejects.toThrow(error);

    expect(run).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith(
      "select pg_advisory_unlock($1::bigint)",
      ["773526208283402193"],
    );
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalledWith(
      "Keeper persistence lock unavailable; running correlation snapshot publication without it",
      expect.anything(),
    );
  });

  it("discards the correlation lock client when unlock fails", async () => {
    const unlockError = new Error("unlock timeout");
    const { runWithCorrelationSnapshotPublishLock, client } = await importKeeperState({ unlockError });
    const logger = createLogger();
    const run = vi.fn(async () => "published");

    await expect(runWithCorrelationSnapshotPublishLock(logger, "fallback", run)).resolves.toBe("published");

    expect(client.query).toHaveBeenCalledWith(
      "select pg_advisory_unlock($1::bigint)",
      ["773526208283402193"],
    );
    expect(client.release).toHaveBeenCalledWith(unlockError);
    expect(logger.warn).toHaveBeenCalledWith("Keeper persistence lock release failed", {
      error: "unlock timeout",
    });
  });

  it("runs correlation publication without persistence when lock acquisition fails", async () => {
    const { runWithCorrelationSnapshotPublishLock, client } = await importKeeperState({
      connectError: new Error("too many clients"),
    });
    const logger = createLogger();
    const run = vi.fn(async () => "ran");

    await expect(runWithCorrelationSnapshotPublishLock(logger, "fallback", run)).resolves.toBe("ran");

    expect(run).toHaveBeenCalledTimes(1);
    expect(client.query).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "Keeper persistence lock unavailable; running correlation snapshot publication without it",
      { error: "too many clients" },
    );
  });
});
