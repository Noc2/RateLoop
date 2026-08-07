import * as schema from "./schema";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";
import "server-only";
import { getDatabaseConfig } from "~~/lib/env/server";

type QueryInput = string | { sql: string; args?: unknown[] };

type DatabaseClient = {
  execute: (input: QueryInput) => Promise<QueryResult<QueryResultRow>>;
};

type DatabaseResources = {
  client: DatabaseClient;
  database: ReturnType<typeof drizzleNodePg>;
  pool: Pool;
};

export const POSTGRES_CONNECTION_TIMEOUT_MS = 10_000;

/**
 * Server-side ceilings on how long a single statement, and a transaction left
 * idle, may hold a connection.
 *
 * `connectionTimeoutMillis` only bounds *acquiring* a connection; once acquired,
 * a statement could previously run unbounded. Individual modules set
 * per-transaction timeouts, but every path that did not was one slow query away
 * from parking a pooled connection — and a slow statement inside a transaction
 * that holds an advisory lock parks the lock with it.
 *
 * Thirty seconds is well above every legitimate query here (the slowest are the
 * evidence projections) and well below the platform request ceiling, so a
 * statement that trips this was never going to return usefully.
 */
export const POSTGRES_STATEMENT_TIMEOUT_MS = 30_000;
export const POSTGRES_IDLE_IN_TRANSACTION_TIMEOUT_MS = 60_000;

function normalizeQuery(input: QueryInput) {
  const text = typeof input === "string" ? input : input.sql;
  const values = typeof input === "string" ? [] : (input.args ?? []);

  let placeholderIndex = 0;
  const parameterizedText = values.length > 0 ? text.replace(/\?/g, () => `$${++placeholderIndex}`) : text;

  return {
    text: parameterizedText,
    values,
  };
}

function createPool(config: { url: string }): Pool {
  const poolConfig: PoolConfig = {
    connectionTimeoutMillis: POSTGRES_CONNECTION_TIMEOUT_MS,
    connectionString: config.url,
    idle_in_transaction_session_timeout: POSTGRES_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    statement_timeout: POSTGRES_STATEMENT_TIMEOUT_MS,
  };

  return new Pool(poolConfig);
}

function createDatabaseClient(pool: Pool): DatabaseClient {
  return {
    async execute(input) {
      const query = normalizeQuery(input);
      return pool.query(query);
    },
  };
}

function createDatabaseResources(): DatabaseResources {
  const config = getDatabaseConfig();

  if (config.url === "memory:") {
    throw new Error("In-memory database support is only available through test helpers.");
  }

  const pool = createPool(config);
  const client = createDatabaseClient(pool);
  const database = drizzleNodePg(pool, { schema });

  return {
    client,
    database,
    pool,
  };
}

let resources: DatabaseResources | null = null;
let resourcesOverride: DatabaseResources | null = null;

function getDatabaseResources(): DatabaseResources {
  if (resourcesOverride) {
    return resourcesOverride;
  }

  if (!resources) {
    resources = createDatabaseResources();
  }

  return resources;
}

function createLazyProxy<T extends object>(getValue: () => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const target = getValue();
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    has(_target, property) {
      return Reflect.has(getValue(), property);
    },
    ownKeys() {
      return Reflect.ownKeys(getValue());
    },
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(getValue(), property);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  });
}

export const db = createLazyProxy(() => getDatabaseResources().database);
export const dbClient = createLazyProxy(() => getDatabaseResources().client);
export const dbPool = createLazyProxy(() => getDatabaseResources().pool);

/**
 * PostgreSQL clients only execute one query at a time. `pg` historically queued
 * overlapping calls, but warns today and will reject them in pg 9. Keep the
 * caller's Promise-based shape while making the sequencing explicit.
 */
export function serializePoolClientQueries(client: PoolClient): PoolClient {
  let tail = Promise.resolve();
  const query = (...args: unknown[]) => {
    const result = tail.then(() => Reflect.apply(client.query, client, args));
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === "query") return query;
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function __setDatabaseResourcesForTests(value: DatabaseResources | null) {
  resourcesOverride = value;
}

export type { DatabaseClient, DatabaseResources, QueryInput };
