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
type ConfidentialityContextModule = typeof import("~~/lib/confidentiality/context");
type ConfidentialityTermsChallengeRoute = typeof import("./challenge/route");
type ConfidentialityTermsRoute = typeof import("./route");

const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const WALLET = account.address;
const NORMALIZED_WALLET = WALLET.toLowerCase() as `0x${string}`;
const CONTENT_ID = "42";

let dbModule: DbModule;
let dbTestMemory: DbTestMemoryModule;
let rateLimit: RateLimitModule;
let signedReadSessions: SignedReadSessionsModule;
let confidentiality: ConfidentialityContextModule;
let challengeRoute: ConfidentialityTermsChallengeRoute;
let termsRoute: ConfidentialityTermsRoute;

function jsonRequest(pathname: string, body: Record<string, unknown>) {
  return new NextRequest(`https://rateloop.ai${pathname}`, {
    body: JSON.stringify(body),
    headers: new Headers({ "content-type": "application/json", "x-real-ip": "198.51.100.7" }),
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
  rateLimit = await import("~~/utils/rateLimit");
  signedReadSessions = await import("~~/lib/auth/signedReadSessions");
  confidentiality = await import("~~/lib/confidentiality/context");
  challengeRoute = await import("./challenge/route");
  termsRoute = await import("./route");
});

beforeEach(async () => {
  dbModule.__setDatabaseResourcesForTests(dbTestMemory.createMemoryDatabaseResources());
  rateLimit.__setRateLimitStoreForTests(dbModule.dbClient);
});

after(() => {
  rateLimit.__setRateLimitStoreForTests(null);
  dbModule.__setDatabaseResourcesForTests(null);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("NODE_ENV", originalNodeEnv);
});

test("confidentiality terms accept route records acceptance and issues gated context read session", async () => {
  const payload = {
    address: WALLET,
    contentHash: `0x${"1".repeat(64)}`,
    contentId: CONTENT_ID,
    detailsHash: `0x${"2".repeat(64)}`,
    questionMetadataHash: `0x${"3".repeat(64)}`,
  };

  const challengeResponse = await challengeRoute.POST(jsonRequest("/api/confidentiality/terms/challenge", payload));
  assert.equal(challengeResponse.status, 200);
  const challenge = (await challengeResponse.json()) as {
    challengeId: string;
    message: string;
    termsDocHash: string;
    termsUri: string;
    termsVersion: string;
  };
  assert.match(challenge.message, new RegExp(`Terms URI: ${confidentiality.CONFIDENTIALITY_TERMS_URI}`));

  const signature = await account.signMessage({ message: challenge.message });
  const acceptResponse = await termsRoute.POST(
    jsonRequest("/api/confidentiality/terms", {
      ...payload,
      challengeId: challenge.challengeId,
      signature,
      termsVersion: challenge.termsVersion,
    }),
  );

  assert.equal(acceptResponse.status, 200);
  assert.deepEqual(await acceptResponse.json(), {
    accepted: true,
    termsDocHash: challenge.termsDocHash,
    termsUri: challenge.termsUri,
    termsVersion: challenge.termsVersion,
  });

  const cookie = acceptResponse.cookies.get(signedReadSessions.GATED_CONTEXT_SIGNED_READ_SESSION_COOKIE_NAME);
  assert.ok(cookie?.value, "gated context read cookie should be set");
  assert.equal(
    await signedReadSessions.verifySignedReadSession(cookie.value, NORMALIZED_WALLET, "gated_context"),
    true,
  );

  const rows = await dbModule.dbClient.execute({
    sql: `
      SELECT wallet_address, content_id, terms_version, terms_doc_hash
      FROM confidentiality_terms_acceptances
    `,
  });
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].wallet_address, NORMALIZED_WALLET);
  assert.equal(rows.rows[0].content_id, CONTENT_ID);
  assert.equal(rows.rows[0].terms_version, challenge.termsVersion);
  assert.equal(rows.rows[0].terms_doc_hash, challenge.termsDocHash);
});

test("confidentiality terms accept route reports pending storage migration clearly", async () => {
  const payload = {
    address: WALLET,
    contentId: CONTENT_ID,
  };

  const challengeResponse = await challengeRoute.POST(
    jsonRequest("/api/confidentiality/terms/challenge", payload),
  );
  assert.equal(challengeResponse.status, 200);
  const challenge = (await challengeResponse.json()) as {
    challengeId: string;
    message: string;
    termsVersion: string;
  };
  const signature = await account.signMessage({ message: challenge.message });

  await dbModule.dbClient.execute("DROP TABLE confidentiality_terms_acceptances");

  const acceptResponse = await termsRoute.POST(
    jsonRequest("/api/confidentiality/terms", {
      ...payload,
      challengeId: challenge.challengeId,
      signature,
      termsVersion: challenge.termsVersion,
    }),
  );
  const body = (await acceptResponse.json()) as Record<string, unknown>;

  assert.equal(acceptResponse.status, 503);
  assert.equal(body.code, "service_unavailable");
  assert.equal(body.retryable, true);
  assert.match(String(body.message), /0005_confidentiality\.sql/);
});
