import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { privateKeyToAccount } from "viem/accounts";

const env = process.env as Record<string, string | undefined>;
const originalDatabaseUrl = env.DATABASE_URL;
const originalNodeEnv = env.NODE_ENV;

env.DATABASE_URL = "memory:";
env.NODE_ENV = "test";

type DbModule = typeof import("~~/lib/db");
type DbTestMemoryModule = typeof import("~~/lib/db/testMemory");
type RateLimitModule = typeof import("~~/utils/rateLimit");
type SignedReadSessionsModule = typeof import("~~/lib/auth/signedReadSessions");
type SignedWriteSessionsModule = typeof import("~~/lib/auth/signedWriteSessions");
type PrivateSessionChallengeRoute = typeof import("./challenge/route");
type PrivateSessionRoute = typeof import("./route");

const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const WALLET = account.address;
const NORMALIZED_WALLET = WALLET.toLowerCase() as `0x${string}`;

let dbModule: DbModule;
let dbTestMemory: DbTestMemoryModule;
let rateLimit: RateLimitModule;
let signedReadSessions: SignedReadSessionsModule;
let signedWriteSessions: SignedWriteSessionsModule;
let challengeRoute: PrivateSessionChallengeRoute;
let privateSessionRoute: PrivateSessionRoute;

function jsonRequest(pathname: string, body: Record<string, unknown>) {
  return new NextRequest(`https://rateloop.ai${pathname}`, {
    body: JSON.stringify(body),
    headers: new Headers({ "content-type": "application/json" }),
    method: "POST",
  });
}

function restoreEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

before(async () => {
  dbModule = await import("~~/lib/db");
  dbTestMemory = await import("~~/lib/db/testMemory");
  dbModule.__setDatabaseResourcesForTests(dbTestMemory.createMemoryDatabaseResources());
  rateLimit = await import("~~/utils/rateLimit");
  rateLimit.__setRateLimitStoreForTests(dbModule.dbClient);
  signedReadSessions = await import("~~/lib/auth/signedReadSessions");
  signedWriteSessions = await import("~~/lib/auth/signedWriteSessions");
  challengeRoute = await import("./challenge/route");
  privateSessionRoute = await import("./route");
});

beforeEach(async () => {
  await dbModule.dbClient.execute("DELETE FROM api_rate_limits");
  await dbModule.dbClient.execute("DELETE FROM signed_action_challenges");
  await dbModule.dbClient.execute("DELETE FROM signed_read_sessions");
  await dbModule.dbClient.execute("DELETE FROM signed_write_sessions");
});

after(() => {
  rateLimit.__setRateLimitStoreForTests(null);
  dbModule.__setDatabaseResourcesForTests(null);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("NODE_ENV", originalNodeEnv);
});

test("private account read challenge creates only signed read sessions", async () => {
  const challengeResponse = await challengeRoute.POST(
    jsonRequest("/api/account/private-session/challenge", { address: WALLET, scope: "agent_policies" }),
  );
  const challenge = (await challengeResponse.json()) as { challengeId: string; message: string };
  assert.match(challenge.message, /Read Scope: agent policies/);
  assert.match(challenge.message, /This signature does not grant gated rater context access/);
  const signature = await account.signMessage({ message: challenge.message });

  const response = await privateSessionRoute.POST(
    jsonRequest("/api/account/private-session", {
      address: WALLET,
      challengeId: challenge.challengeId,
      scope: "agent_policies",
      signature,
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, hasSession: true });

  const agentPoliciesCookie = response.cookies.get(signedReadSessions.AGENT_POLICIES_SIGNED_READ_SESSION_COOKIE_NAME);
  assert.ok(agentPoliciesCookie?.value, "agent policies read cookie should be set");

  for (const scope of signedReadSessions.SIGNED_READ_SESSION_SCOPES) {
    if (scope === "agent_policies") continue;
    assert.equal(response.cookies.get(signedReadSessions.SIGNED_READ_SESSION_COOKIE_NAMES[scope]), undefined);
  }

  assert.equal(
    await signedReadSessions.verifySignedReadSession(agentPoliciesCookie.value, NORMALIZED_WALLET, "agent_policies"),
    true,
  );
  assert.equal(
    await signedReadSessions.verifySignedReadSession(agentPoliciesCookie.value, NORMALIZED_WALLET, "gated_context"),
    false,
  );
  assert.equal(response.cookies.get(signedWriteSessions.WATCHLIST_SIGNED_WRITE_SESSION_COOKIE_NAME), undefined);

  const sessionResponse = await privateSessionRoute.GET(
    new NextRequest(
      `https://rateloop.ai/api/account/private-session?address=${encodeURIComponent(WALLET)}&scope=agent_policies`,
      {
        headers: new Headers({
          cookie: `${agentPoliciesCookie.name}=${agentPoliciesCookie.value}`,
        }),
      },
    ),
  );

  assert.equal(sessionResponse.status, 200);
  assert.deepEqual(await sessionResponse.json(), { hasSession: true });
});

test("private account read challenge scope cannot be expanded on redeem", async () => {
  const challengeResponse = await challengeRoute.POST(
    jsonRequest("/api/account/private-session/challenge", { address: WALLET, scope: "watchlist" }),
  );
  const challenge = (await challengeResponse.json()) as { challengeId: string; message: string };
  assert.match(challenge.message, /Read Scope: watchlist/);
  assert.doesNotMatch(challenge.message, /notification email/);
  const signature = await account.signMessage({ message: challenge.message });

  const expandedResponse = await privateSessionRoute.POST(
    jsonRequest("/api/account/private-session", {
      address: WALLET,
      challengeId: challenge.challengeId,
      scope: "notification_email",
      signature,
    }),
  );
  assert.equal(expandedResponse.status, 401);

  const response = await privateSessionRoute.POST(
    jsonRequest("/api/account/private-session", {
      address: WALLET,
      challengeId: challenge.challengeId,
      scope: "watchlist",
      signature,
    }),
  );

  assert.equal(response.status, 200);
  const watchlistCookie = response.cookies.get(signedReadSessions.WATCHLIST_SIGNED_READ_SESSION_COOKIE_NAME);
  assert.ok(watchlistCookie?.value);
  assert.equal(
    await signedReadSessions.verifySignedReadSession(watchlistCookie.value, NORMALIZED_WALLET, "watchlist"),
    true,
  );
  assert.equal(response.cookies.get(signedReadSessions.NOTIFICATION_EMAIL_SIGNED_READ_SESSION_COOKIE_NAME), undefined);
  assert.equal(response.cookies.get(signedReadSessions.GATED_CONTEXT_SIGNED_READ_SESSION_COOKIE_NAME), undefined);
});

test("private account read challenge rejects gated context scope", async () => {
  const challengeResponse = await challengeRoute.POST(
    jsonRequest("/api/account/private-session/challenge", {
      address: WALLET,
      scope: "gated_context",
    }),
  );

  assert.equal(challengeResponse.status, 400);
  assert.deepEqual(await challengeResponse.json(), { error: "Invalid read scope" });
});
