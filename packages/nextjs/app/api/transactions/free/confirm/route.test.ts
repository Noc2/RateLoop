import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

const env = process.env as Record<string, string | undefined>;
const originalAppEnv = env.APP_ENV;
const originalDatabaseUrl = env.DATABASE_URL;
const originalNodeEnv = env.NODE_ENV;
const originalTrustedHeaders = env.RATE_LIMIT_TRUSTED_IP_HEADERS;

const TEST_ADDRESS = "0x63cada40E8AcF7A1d47229af5Be35b78b16035fa";
const TEST_IP = "203.0.113.77";
const TEST_OPERATION_KEY = `0x${"1".repeat(64)}`;
const TEST_TX_HASH = `0x${"2".repeat(64)}`;
const TEST_RESERVATION_SESSION_TOKEN = "a".repeat(64);

type DbModule = typeof import("~~/lib/db");
type DbTestMemoryModule = typeof import("~~/lib/db/testing/testMemory");
type RateLimitModule = typeof import("~~/utils/rateLimit");
type FreeTransactionsModule = typeof import("~~/lib/thirdweb/freeTransactions");
type RouteModule = typeof import("./route");
type DatabaseResources = import("~~/lib/db").DatabaseResources;

let dbModule: DbModule;
let dbTestMemory: DbTestMemoryModule;
let rateLimit: RateLimitModule;
let freeTransactions: FreeTransactionsModule;
let route: RouteModule;
let memoryResources: DatabaseResources;

function createStoreUnavailableResources(base: DatabaseResources): DatabaseResources {
  const storeUnavailableError = new Error("database offline", {
    cause: {
      code: "SELF_SIGNED_CERT_IN_CHAIN",
    },
  });
  const database = new Proxy(base.database as object, {
    get(target, property, receiver) {
      if (property === "insert" || property === "transaction") {
        return () => {
          throw storeUnavailableError;
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as DatabaseResources["database"];

  return {
    client: base.client,
    database,
    pool: base.pool,
  };
}

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("https://rateloop.ai/api/transactions/free/confirm", {
    method: "POST",
    headers: new Headers({
      "content-type": "application/json",
      "x-forwarded-for": TEST_IP,
    }),
    body: JSON.stringify(body),
  });
}

before(async () => {
  env.APP_ENV = "production";
  env.DATABASE_URL = "memory:";
  env.NODE_ENV = "production";
  env.RATE_LIMIT_TRUSTED_IP_HEADERS = "x-forwarded-for";

  dbModule = await import("~~/lib/db");
  dbTestMemory = await import("~~/lib/db/testing/testMemory");
  rateLimit = await import("~~/utils/rateLimit");
  freeTransactions = await import("~~/lib/thirdweb/freeTransactions");
  route = await import("./route");

  memoryResources = dbTestMemory.createMemoryDatabaseResources();
});

beforeEach(async () => {
  env.APP_ENV = "production";
  env.DATABASE_URL = "memory:";
  env.NODE_ENV = "production";
  env.RATE_LIMIT_TRUSTED_IP_HEADERS = "x-forwarded-for";

  dbModule.__setDatabaseResourcesForTests(memoryResources);
  rateLimit.__setRateLimitStoreForTests({
    execute: async () => {
      throw new Error("database offline");
    },
  });
  freeTransactions.__setFreeTransactionTestOverridesForTests({
    allTransactionHashesSucceeded: async () => true,
  });

  await dbModule.dbClient.execute("DELETE FROM free_transaction_reservations");
  await dbModule.dbClient.execute("DELETE FROM free_transaction_quotas");
});

after(() => {
  dbModule.__setDatabaseResourcesForTests(null);
  rateLimit.__setRateLimitStoreForTests(null);
  freeTransactions.__setFreeTransactionTestOverridesForTests(null);

  if (originalAppEnv === undefined) {
    delete env.APP_ENV;
  } else {
    env.APP_ENV = originalAppEnv;
  }

  if (originalDatabaseUrl === undefined) {
    delete env.DATABASE_URL;
  } else {
    env.DATABASE_URL = originalDatabaseUrl;
  }

  if (originalNodeEnv === undefined) {
    delete env.NODE_ENV;
  } else {
    env.NODE_ENV = originalNodeEnv;
  }

  if (originalTrustedHeaders === undefined) {
    delete env.RATE_LIMIT_TRUSTED_IP_HEADERS;
  } else {
    env.RATE_LIMIT_TRUSTED_IP_HEADERS = originalTrustedHeaders;
  }
});

test("free transaction confirm route fails closed when the rate limit store is unavailable", async () => {
  const response = await route.POST(
    makeRequest({
      address: TEST_ADDRESS,
      chainId: 480,
      operationKey: TEST_OPERATION_KEY,
      reservationSessionToken: TEST_RESERVATION_SESSION_TOKEN,
      transactionHashes: [TEST_TX_HASH],
    }),
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    code: "service_unavailable",
    message: "Rate limiting is unavailable",
    recoverWith: "retry_later",
    retryable: true,
    status: 503,
  });
});

test("free transaction confirm route fails closed when the quota store is unavailable", async () => {
  rateLimit.__setRateLimitStoreForTests(null);
  dbModule.__setDatabaseResourcesForTests(createStoreUnavailableResources(memoryResources));

  try {
    const response = await route.POST(
      makeRequest({
        address: TEST_ADDRESS,
        chainId: 480,
        operationKey: TEST_OPERATION_KEY,
        reservationSessionToken: TEST_RESERVATION_SESSION_TOKEN,
        transactionHashes: [TEST_TX_HASH],
      }),
    );

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Free transaction quota store unavailable" });
  } finally {
    dbModule.__setDatabaseResourcesForTests(memoryResources);
    rateLimit.__setRateLimitStoreForTests({
      execute: async () => {
        throw new Error("database offline");
      },
    });
  }
});

test("free transaction confirm route reports a missing reservation", async () => {
  rateLimit.__setRateLimitStoreForTests(null);

  const response = await route.POST(
    makeRequest({
      address: TEST_ADDRESS,
      chainId: 480,
      operationKey: TEST_OPERATION_KEY,
      reservationSessionToken: TEST_RESERVATION_SESSION_TOKEN,
      transactionHashes: [TEST_TX_HASH],
    }),
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Free transaction reservation not found",
    ok: false,
    outcome: "missing_reservation",
  });
});

test("free transaction confirm route reports non-pending reservations", async () => {
  rateLimit.__setRateLimitStoreForTests(null);
  const now = new Date();
  await dbModule.dbClient.execute({
    sql: `
      INSERT INTO free_transaction_reservations (
        operation_key,
        identity_key,
        rater_identity_key,
        chain_id,
        environment,
        wallet_address,
        reservation_session_token,
        status,
        reserved_at,
        expires_at,
        released_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      TEST_OPERATION_KEY,
      "480:production:identity",
      `0x${"9".repeat(64)}`,
      480,
      "production",
      TEST_ADDRESS.toLowerCase(),
      TEST_RESERVATION_SESSION_TOKEN,
      "released",
      now,
      new Date(now.getTime() + 60_000),
      now,
      now,
    ],
  });

  const response = await route.POST(
    makeRequest({
      address: TEST_ADDRESS,
      chainId: 480,
      operationKey: TEST_OPERATION_KEY,
      reservationSessionToken: TEST_RESERVATION_SESSION_TOKEN,
      transactionHashes: [TEST_TX_HASH],
    }),
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "Free transaction reservation is not pending",
    ok: false,
    outcome: "ignored_released",
  });
});
