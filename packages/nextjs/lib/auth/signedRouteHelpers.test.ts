import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

process.env.DATABASE_URL = "memory:";

type DbModule = typeof import("~~/lib/db");
type DbTestMemoryModule = typeof import("~~/lib/db/testing/testMemory");
type SignedReadSessionsModule = typeof import("./signedReadSessions");
type SignedRouteHelpersModule = typeof import("./signedRouteHelpers");

const WALLET = "0x1234567890abcdef1234567890abcdef12345678" as const;

let dbModule: DbModule;
let dbTestMemory: DbTestMemoryModule;
let signedReadSessions: SignedReadSessionsModule;
let signedRouteHelpers: SignedRouteHelpersModule;

before(async () => {
  dbModule = await import("~~/lib/db");
  dbTestMemory = await import("~~/lib/db/testing/testMemory");
  dbModule.__setDatabaseResourcesForTests(dbTestMemory.createMemoryDatabaseResources());
  signedReadSessions = await import("./signedReadSessions");
  signedRouteHelpers = await import("./signedRouteHelpers");
});

beforeEach(async () => {
  await dbModule.dbClient.execute("DELETE FROM signed_read_sessions");
});

after(() => {
  dbModule.__setDatabaseResourcesForTests(null);
});

test("signed read responses only issue the verified read scope", async () => {
  const response = await signedRouteHelpers.createSignedReadResponse(WALLET, "agent_policies", { ok: true });

  const agentPoliciesCookie = response.cookies.get(signedReadSessions.AGENT_POLICIES_SIGNED_READ_SESSION_COOKIE_NAME);

  assert.ok(agentPoliciesCookie?.value, "requested read scope cookie should be set");
  assert.equal(response.cookies.get(signedReadSessions.WATCHLIST_SIGNED_READ_SESSION_COOKIE_NAME), undefined);
  assert.equal(
    await signedReadSessions.verifySignedReadSession(agentPoliciesCookie.value, WALLET, "agent_policies"),
    true,
  );
  assert.equal(await signedReadSessions.verifySignedReadSession(agentPoliciesCookie.value, WALLET, "watchlist"), false);
});
