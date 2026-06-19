import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

process.env.DATABASE_URL = "memory:";

type ContentWatchModule = typeof import("./contentWatch");
type DbModule = typeof import("../db");
type DbTestMemoryModule = typeof import("../db/testMemory");

let contentWatch: ContentWatchModule;
let dbModule: DbModule;
let dbTestMemory: DbTestMemoryModule;

const WALLET = "0x1234567890abcdef1234567890abcdef12345678" as const;
const FOUNDRY_SCOPE = {
  chainId: 31337,
  contentRegistryAddress: "0x0000000000000000000000000000000000000001" as const,
  deploymentKey: "31337:0x0000000000000000000000000000000000000001",
};
const BASE_SCOPE = {
  chainId: 8453,
  contentRegistryAddress: "0x0000000000000000000000000000000000000002" as const,
  deploymentKey: "8453:0x0000000000000000000000000000000000000002",
};

before(async () => {
  dbModule = await import("../db");
  dbTestMemory = await import("../db/testMemory");
  dbModule.__setDatabaseResourcesForTests(dbTestMemory.createMemoryDatabaseResources());
  contentWatch = await import("./contentWatch");
  await contentWatch.ensureWatchedContentTable();
});

beforeEach(async () => {
  await dbModule.dbClient.execute("DELETE FROM watched_content");
});

after(() => {
  dbModule.__setDatabaseResourcesForTests(null);
});

test("createWatchlistTimestamp truncates to whole seconds", () => {
  const timestamp = contentWatch.createWatchlistTimestamp(1_725_000_123_987);
  assert.equal(timestamp.getTime(), 1_725_000_123_000);
});

test("addWatchedContent stores sane timestamps", async () => {
  await contentWatch.addWatchedContent(WALLET, "1", FOUNDRY_SCOPE);

  const [item] = await contentWatch.listWatchedContent(WALLET, FOUNDRY_SCOPE);
  assert.ok(item, "watchlist row should exist");
  assert.equal(item.chainId, FOUNDRY_SCOPE.chainId);
  assert.equal(item.deploymentKey, FOUNDRY_SCOPE.deploymentKey);
  assert.equal(item.contentRegistryAddress, FOUNDRY_SCOPE.contentRegistryAddress);

  const createdAt = new Date(item.createdAt);
  assert.equal(createdAt.getMilliseconds(), 0);
  assert.ok(createdAt.getFullYear() < 2100);
  assert.ok(Math.abs(createdAt.getTime() - Date.now()) < 10_000);
});

test("watchlist rows are scoped by deployment", async () => {
  await contentWatch.addWatchedContent(WALLET, "1", FOUNDRY_SCOPE);
  await contentWatch.addWatchedContent(WALLET, "1", BASE_SCOPE);

  assert.deepEqual(
    (await contentWatch.listWatchedContent(WALLET, FOUNDRY_SCOPE)).map(item => item.deploymentKey),
    [FOUNDRY_SCOPE.deploymentKey],
  );
  assert.deepEqual(
    (await contentWatch.listWatchedContent(WALLET, BASE_SCOPE)).map(item => item.deploymentKey),
    [BASE_SCOPE.deploymentKey],
  );

  await contentWatch.removeWatchedContent(WALLET, "1", FOUNDRY_SCOPE);

  assert.equal((await contentWatch.listWatchedContent(WALLET, FOUNDRY_SCOPE)).length, 0);
  assert.equal((await contentWatch.listWatchedContent(WALLET, BASE_SCOPE)).length, 1);
});
