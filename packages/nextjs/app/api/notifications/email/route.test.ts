import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import {
  NOTIFICATION_EMAIL_CHALLENGE_TITLE,
  UPDATE_NOTIFICATION_EMAIL_ACTION,
  hashNotificationEmailPayload,
  normalizeNotificationEmailInput,
} from "~~/lib/auth/notificationEmails";
import { notificationEmailSubscriptions } from "~~/lib/db/schema";

const env = process.env as Record<string, string | undefined>;
const originalAppUrl = env.APP_URL;
const originalDatabaseUrl = env.DATABASE_URL;
const originalNodeEnv = env.NODE_ENV;
const originalResendApiKey = env.RESEND_API_KEY;
const originalResendFromEmail = env.RESEND_FROM_EMAIL;
const originalTrustedHeaders = env.RATE_LIMIT_TRUSTED_IP_HEADERS;

const WALLET = "0x1234567890abcdef1234567890abcdef12345678" as const;
const OTHER_WALLET = "0x2234567890abcdef1234567890abcdef12345678" as const;
const TAKEN_EMAIL = "taken@example.com";

type DbModule = typeof import("~~/lib/db");
type DbTestMemoryModule = typeof import("~~/lib/db/testMemory");
type SignedActionsModule = typeof import("~~/lib/auth/signedActions");
type RouteModule = typeof import("./route");

let dbModule: DbModule;
let dbTestMemory: DbTestMemoryModule;
let signedActions: SignedActionsModule;
let route: RouteModule;

function restoreEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

function configureEnv() {
  env.APP_URL = "https://www.rateloop.ai";
  env.DATABASE_URL = "memory:";
  env.NODE_ENV = "production";
  env.RATE_LIMIT_TRUSTED_IP_HEADERS = "x-forwarded-for";
  env.RESEND_API_KEY = "test_resend_key";
  env.RESEND_FROM_EMAIL = "RateLoop <notifications@rateloop.ai>";
}

async function buildSignedUpdateBody(params: { email: string }) {
  const body = {
    address: WALLET,
    email: params.email,
    followedResolution: false,
    followedSubmission: true,
    roundResolved: true,
    settlingSoonDay: true,
    settlingSoonHour: false,
  };
  const normalized = normalizeNotificationEmailInput(body);
  assert.equal(normalized.ok, true);
  if (!normalized.ok) throw new Error("invalid test payload");

  const payloadHash = hashNotificationEmailPayload(normalized.payload);
  const challenge = await signedActions.issueSignedActionChallenge({
    action: UPDATE_NOTIFICATION_EMAIL_ACTION,
    payloadHash,
    title: NOTIFICATION_EMAIL_CHALLENGE_TITLE,
    walletAddress: WALLET,
  });

  return {
    ...body,
    challengeId: challenge.challengeId,
    signature: "0x1234",
  };
}

before(async () => {
  configureEnv();
  dbModule = await import("~~/lib/db");
  dbTestMemory = await import("~~/lib/db/testMemory");
  signedActions = await import("~~/lib/auth/signedActions");
  route = await import("./route");
});

beforeEach(() => {
  configureEnv();
  dbModule.__setDatabaseResourcesForTests(dbTestMemory.createMemoryDatabaseResources());
  signedActions.__setSignedActionVerificationClientForTests({
    async verifyMessage() {
      return true;
    },
  });
});

after(() => {
  signedActions.__setSignedActionVerificationClientForTests(null);
  dbModule.__setDatabaseResourcesForTests(null);
  restoreEnv("APP_URL", originalAppUrl);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("NODE_ENV", originalNodeEnv);
  restoreEnv("RATE_LIMIT_TRUSTED_IP_HEADERS", originalTrustedHeaders);
  restoreEnv("RESEND_API_KEY", originalResendApiKey);
  restoreEnv("RESEND_FROM_EMAIL", originalResendFromEmail);
});

test("email settings update does not disclose that an email belongs to another wallet", async () => {
  const now = new Date("2026-06-25T12:00:00.000Z");
  await dbModule.db.insert(notificationEmailSubscriptions).values({
    walletAddress: OTHER_WALLET,
    email: TAKEN_EMAIL,
    verifiedAt: now,
    verificationToken: null,
    verificationExpiresAt: null,
    roundResolved: true,
    settlingSoonHour: false,
    settlingSoonDay: true,
    followedSubmission: true,
    followedResolution: false,
    createdAt: now,
    updatedAt: now,
  });

  const response = await route.PUT(
    new NextRequest("https://www.rateloop.ai/api/notifications/email", {
      body: JSON.stringify(await buildSignedUpdateBody({ email: TAKEN_EMAIL })),
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.90",
      },
      method: "PUT",
    }),
  );
  const body = await response.json();
  const serialized = JSON.stringify(body);

  assert.equal(response.status, 202);
  assert.equal(body.ok, true);
  assert.equal(body.verificationSent, true);
  assert.notEqual(body.settings.email, TAKEN_EMAIL);
  assert.match(body.message, /verification email/i);
  assert.equal(serialized.includes(TAKEN_EMAIL), false);
  assert.equal(serialized.includes("belongs to another wallet"), false);
});
