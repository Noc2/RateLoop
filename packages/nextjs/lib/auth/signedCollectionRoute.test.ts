import { NextResponse } from "next/server";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

process.env.DATABASE_URL = "memory:";

type DbModule = typeof import("~~/lib/db");
type DbTestMemoryModule = typeof import("~~/lib/db/testing/testMemory");
type SignedCollectionRouteModule = typeof import("./signedCollectionRoute");
type SignedReadSessionsModule = typeof import("./signedReadSessions");
type SignedWriteSessionsModule = typeof import("./signedWriteSessions");

const WALLET = "0x1234567890abcdef1234567890abcdef12345678" as const;

let dbModule: DbModule;
let dbTestMemory: DbTestMemoryModule;
let signedCollectionRoute: SignedCollectionRouteModule;
let signedReadSessions: SignedReadSessionsModule;
let signedWriteSessions: SignedWriteSessionsModule;

before(async () => {
  dbModule = await import("~~/lib/db");
  dbTestMemory = await import("~~/lib/db/testing/testMemory");
  dbModule.__setDatabaseResourcesForTests(dbTestMemory.createMemoryDatabaseResources());
  signedCollectionRoute = await import("./signedCollectionRoute");
  signedReadSessions = await import("./signedReadSessions");
  signedWriteSessions = await import("./signedWriteSessions");
});

beforeEach(async () => {
  await dbModule.dbClient.execute("DELETE FROM signed_read_sessions");
  await dbModule.dbClient.execute("DELETE FROM signed_write_sessions");
});

after(() => {
  dbModule.__setDatabaseResourcesForTests(null);
});

test("successful collection writes also issue read access for reloads", async () => {
  const response = await signedCollectionRoute.maybeIssueSignedCollectionWriteSession(NextResponse.json({ ok: true }), {
    hasWriteSession: false,
    walletAddress: WALLET,
    scope: "watchlist",
  });

  const readCookie = response.cookies.get(signedReadSessions.WATCHLIST_SIGNED_READ_SESSION_COOKIE_NAME);
  const writeCookie = response.cookies.get(signedWriteSessions.WATCHLIST_SIGNED_WRITE_SESSION_COOKIE_NAME);

  assert.ok(readCookie?.value, "read session cookie should be set after a successful write");
  assert.ok(writeCookie?.value, "write session cookie should still be set for signed writes");
  for (const scope of signedReadSessions.SIGNED_READ_SESSION_SCOPES) {
    if (scope === "watchlist") continue;
    assert.equal(response.cookies.get(signedReadSessions.SIGNED_READ_SESSION_COOKIE_NAMES[scope]), undefined);
  }
  assert.equal(await signedReadSessions.verifySignedReadSession(readCookie.value, WALLET, "watchlist"), true);
  assert.equal(await signedWriteSessions.verifySignedWriteSession(writeCookie.value, WALLET, "watchlist"), true);
});

test("existing write sessions still refresh read access", async () => {
  const response = await signedCollectionRoute.maybeIssueSignedCollectionWriteSession(NextResponse.json({ ok: true }), {
    hasWriteSession: true,
    walletAddress: WALLET,
    scope: "watchlist",
  });

  const readCookie = response.cookies.get(signedReadSessions.WATCHLIST_SIGNED_READ_SESSION_COOKIE_NAME);
  const writeCookie = response.cookies.get(signedWriteSessions.WATCHLIST_SIGNED_WRITE_SESSION_COOKIE_NAME);

  assert.ok(readCookie?.value, "read session cookie should be refreshed after a session write");
  assert.equal(writeCookie, undefined);
  for (const scope of signedReadSessions.SIGNED_READ_SESSION_SCOPES) {
    if (scope === "watchlist") continue;
    assert.equal(response.cookies.get(signedReadSessions.SIGNED_READ_SESSION_COOKIE_NAMES[scope]), undefined);
  }
  assert.equal(await signedReadSessions.verifySignedReadSession(readCookie.value, WALLET, "watchlist"), true);
});

test("collection sessions can be scoped by deployment storage keys", async () => {
  const response = await signedCollectionRoute.maybeIssueSignedCollectionWriteSession(NextResponse.json({ ok: true }), {
    hasWriteSession: false,
    walletAddress: WALLET,
    scope: "watchlist",
    storageScope: "watchlist:8453:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });

  const readCookie = response.cookies.get(signedReadSessions.WATCHLIST_SIGNED_READ_SESSION_COOKIE_NAME);
  const writeCookie = response.cookies.get(signedWriteSessions.WATCHLIST_SIGNED_WRITE_SESSION_COOKIE_NAME);

  assert.ok(readCookie?.value, "read session cookie should be set");
  assert.ok(writeCookie?.value, "write session cookie should be set");
  assert.equal(
    await signedReadSessions.verifySignedReadSession(
      readCookie.value,
      WALLET,
      "watchlist",
      "watchlist:8453:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ),
    true,
  );
  assert.equal(
    await signedReadSessions.verifySignedReadSession(
      readCookie.value,
      WALLET,
      "watchlist",
      "watchlist:8453:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ),
    false,
  );
  assert.equal(
    await signedWriteSessions.verifySignedWriteSession(
      writeCookie.value,
      WALLET,
      "watchlist",
      "watchlist:8453:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ),
    true,
  );
  assert.equal(
    await signedWriteSessions.verifySignedWriteSession(
      writeCookie.value,
      WALLET,
      "watchlist",
      "watchlist:8453:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ),
    false,
  );
});
