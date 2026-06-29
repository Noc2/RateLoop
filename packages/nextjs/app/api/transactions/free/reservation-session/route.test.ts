import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildFreeTransactionReservationSessionMessage } from "~~/lib/thirdweb/freeTransactionReservationSession";

type DbModule = typeof import("~~/lib/db");
type DbTestMemoryModule = typeof import("~~/lib/db/testing/testMemory");
type RateLimitModule = typeof import("~~/utils/rateLimit");
type RouteModule = typeof import("./route");

const env = process.env as Record<string, string | undefined>;
const originalDatabaseUrl = env.DATABASE_URL;
const originalNodeEnv = env.NODE_ENV;
const originalTargetNetworks = env.NEXT_PUBLIC_TARGET_NETWORKS;

const TEST_ACCOUNT = privateKeyToAccount(`0x${"12".repeat(32)}`);
const TEST_ADDRESS = TEST_ACCOUNT.address;
const TEST_CHAIN_ID = 4801;
const TEST_OPERATION_KEY = `0x${"ab".repeat(32)}`;
const TEST_RESERVATION_SESSION_TOKEN = "c".repeat(64);

let dbModule: DbModule;
let dbTestMemory: DbTestMemoryModule;
let rateLimit: RateLimitModule;
let route: RouteModule;

function restoreEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("https://rateloop.ai/api/transactions/free/reservation-session", {
    method: "POST",
    headers: new Headers({
      "content-type": "application/json",
      "user-agent": "reservation-session-test",
      "x-forwarded-for": "203.0.113.77",
    }),
    body: JSON.stringify(body),
  });
}

async function signReservationSessionMessage() {
  return TEST_ACCOUNT.signMessage({
    message: buildFreeTransactionReservationSessionMessage({
      address: TEST_ADDRESS,
      chainId: TEST_CHAIN_ID,
      operationKey: TEST_OPERATION_KEY,
    }),
  });
}

before(async () => {
  env.DATABASE_URL = "memory:";
  env.NODE_ENV = "test";
  env.NEXT_PUBLIC_TARGET_NETWORKS = String(TEST_CHAIN_ID);
  dbModule = await import("~~/lib/db");
  dbTestMemory = await import("~~/lib/db/testing/testMemory");
  rateLimit = await import("~~/utils/rateLimit");
  route = await import("./route");
});

beforeEach(async () => {
  env.DATABASE_URL = "memory:";
  env.NODE_ENV = "test";
  env.NEXT_PUBLIC_TARGET_NETWORKS = String(TEST_CHAIN_ID);
  const resources = dbTestMemory.createMemoryDatabaseResources();
  dbModule.__setDatabaseResourcesForTests(resources);
  rateLimit.__setRateLimitStoreForTests(resources.client);
  await resources.client.execute("DELETE FROM api_rate_limits");
  await resources.client.execute("DELETE FROM free_transaction_reservations");
});

after(() => {
  rateLimit?.__setRateLimitStoreForTests(null);
  dbModule?.__setDatabaseResourcesForTests(null);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("NODE_ENV", originalNodeEnv);
  restoreEnv("NEXT_PUBLIC_TARGET_NETWORKS", originalTargetNetworks);
});

test("reservation session route rejects unsigned token lookups", async () => {
  const expiresAt = new Date(Date.now() + 60_000);
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
      `0x${"11".repeat(32)}`,
      `0x${"22".repeat(32)}`,
      TEST_CHAIN_ID,
      "test",
      getAddress(TEST_ADDRESS),
      TEST_RESERVATION_SESSION_TOKEN,
      "pending",
      new Date(),
      expiresAt,
      null,
      new Date(),
    ],
  });

  const response = await route.POST(
    makeRequest({
      address: TEST_ADDRESS,
      chainId: TEST_CHAIN_ID,
      operationKey: TEST_OPERATION_KEY,
    }),
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Invalid reservation session signature" });
});

test("reservation session route returns pending token for matching signed wallet", async () => {
  const expiresAt = new Date(Date.now() + 60_000);
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
      `0x${"11".repeat(32)}`,
      `0x${"22".repeat(32)}`,
      TEST_CHAIN_ID,
      "test",
      getAddress(TEST_ADDRESS),
      TEST_RESERVATION_SESSION_TOKEN,
      "pending",
      new Date(),
      expiresAt,
      null,
      new Date(),
    ],
  });

  const response = await route.POST(
    makeRequest({
      address: TEST_ADDRESS,
      chainId: TEST_CHAIN_ID,
      operationKey: TEST_OPERATION_KEY,
      signature: await signReservationSessionMessage(),
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.reservationSessionToken, TEST_RESERVATION_SESSION_TOKEN);
});

test("reservation session route returns 404 when no pending reservation exists", async () => {
  const response = await route.POST(
    makeRequest({
      address: TEST_ADDRESS,
      chainId: TEST_CHAIN_ID,
      operationKey: TEST_OPERATION_KEY,
      signature: await signReservationSessionMessage(),
    }),
  );

  assert.equal(response.status, 404);
});
