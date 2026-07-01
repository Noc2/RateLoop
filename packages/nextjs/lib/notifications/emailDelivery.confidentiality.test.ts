import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { resolveContentDeploymentScope, resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";

const env = process.env as Record<string, string | undefined>;
const originalAppUrl = env.APP_URL;
const originalDatabaseUrl = env.DATABASE_URL;
const originalDeliverySecret = env.NOTIFICATION_DELIVERY_SECRET;
const originalFrontendCode = env.NEXT_PUBLIC_FRONTEND_CODE;
const originalNodeEnv = env.NODE_ENV;
const originalPonderUrl = env.NEXT_PUBLIC_PONDER_URL;
const originalResendApiKey = env.RESEND_API_KEY;
const originalResendFromEmail = env.RESEND_FROM_EMAIL;
const originalFetch = globalThis.fetch;

const WALLET = "0x1234567890abcdef1234567890abcdef12345678";
const CONTENT_ID = "77";
const SECRET_TITLE = "Secret launch concept";
const SECRET_DESCRIPTION = "Confidential positioning details for the unreleased prototype.";

type DbModule = typeof import("~~/lib/db");
type DbTestMemoryModule = typeof import("~~/lib/db/testing/testMemory");
type DbSchemaModule = typeof import("~~/lib/db/schema");
type ConfidentialityContextModule = typeof import("~~/lib/confidentiality/context");
type EmailDeliveryModule = typeof import("./emailDelivery");
type PonderClientModule = typeof import("~~/services/ponder/client");

let dbModule: DbModule;
let dbTestMemory: DbTestMemoryModule;
let dbSchema: DbSchemaModule;
let confidentiality: ConfidentialityContextModule;
let emailDelivery: EmailDeliveryModule;
let ponderClient: PonderClientModule;
let sentEmails: Array<{ subject: string; text: string; html: string }> = [];
const TEST_PONDER_DEPLOYMENT = resolveProtocolDeploymentScope(31337);
const TEST_CONTENT_DEPLOYMENT = resolveContentDeploymentScope(31337)!;

function restoreEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

function installFetchMock() {
  sentEmails = [];
  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url;

    if (url === "https://ponder.example/health") {
      return new Response("ok", { status: 200 });
    }

    if (url === "https://ponder.example/deployment") {
      assert.ok(TEST_PONDER_DEPLOYMENT);
      return new Response(
        JSON.stringify({
          configured: true,
          chainId: TEST_PONDER_DEPLOYMENT.chainId,
          contentRegistryAddress: TEST_PONDER_DEPLOYMENT.contentRegistryAddress,
          feedbackRegistryAddress: TEST_PONDER_DEPLOYMENT.feedbackRegistryAddress,
          deploymentKey: TEST_PONDER_DEPLOYMENT.deploymentKey,
        }),
        { headers: { "content-type": "application/json" } },
      );
    }

    if (url.startsWith("https://ponder.example/notification-events/")) {
      const settlingAt = Math.floor(Date.now() / 1000) + 30 * 60;
      return new Response(
        JSON.stringify({
          settlingSoon: [
            {
              id: "77-1",
              contentId: CONTENT_ID,
              roundId: "1",
              title: SECRET_TITLE,
              description: SECRET_DESCRIPTION,
              url: "https://example.com/private",
              submitter: "0x00000000000000000000000000000000000000aa",
              categoryId: "5",
              roundStartTime: String(settlingAt - 1200),
              estimatedSettlementTime: String(settlingAt),
              profileName: null,
              source: "watched",
            },
          ],
          followedSubmissions: [
            {
              contentId: CONTENT_ID,
              title: SECRET_TITLE,
              description: SECRET_DESCRIPTION,
              url: "https://example.com/private",
              createdAt: "2026-06-11T12:00:00.000Z",
              categoryId: "5",
              submitter: "0x00000000000000000000000000000000000000aa",
              profileName: "Curator",
            },
          ],
          followedResolutions: [],
          trackedResolutions: [],
        }),
        { headers: { "content-type": "application/json" } },
      );
    }

    if (url === "https://api.resend.com/emails") {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        html?: string;
        subject?: string;
        text?: string;
      };
      sentEmails.push({
        html: body.html ?? "",
        subject: body.subject ?? "",
        text: body.text ?? "",
      });
      return new Response(JSON.stringify({ id: "email_123" }), {
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;
}

before(async () => {
  env.APP_URL = "https://www.rateloop.ai";
  env.DATABASE_URL = "memory:";
  env.NODE_ENV = "test";
  env.NOTIFICATION_DELIVERY_SECRET = "notification-secret";
  env.NEXT_PUBLIC_FRONTEND_CODE = "0x3333333333333333333333333333333333333333";
  env.NEXT_PUBLIC_PONDER_URL = "https://ponder.example";
  env.RESEND_API_KEY = "resend-test-key";
  env.RESEND_FROM_EMAIL = "RateLoop <notifications@rateloop.ai>";

  dbModule = await import("~~/lib/db");
  dbTestMemory = await import("~~/lib/db/testing/testMemory");
  dbSchema = await import("~~/lib/db/schema");
  confidentiality = await import("~~/lib/confidentiality/context");
  ponderClient = await import("~~/services/ponder/client");
  emailDelivery = await import("./emailDelivery");
});

beforeEach(async () => {
  dbModule.__setDatabaseResourcesForTests(dbTestMemory.createMemoryDatabaseResources());
  ponderClient.invalidatePonderCache({ clearLastKnownGood: true });
  installFetchMock();
  const now = new Date("2026-06-11T12:00:00.000Z");
  await dbModule.db.insert(dbSchema.notificationEmailSubscriptions).values({
    walletAddress: WALLET,
    email: "rater@example.com",
    verifiedAt: now,
    verificationToken: null,
    verificationExpiresAt: null,
    roundResolved: false,
    settlingSoonHour: true,
    settlingSoonDay: false,
    followedSubmission: true,
    followedResolution: false,
    createdAt: now,
    updatedAt: now,
  });
  await dbModule.db.insert(dbSchema.watchedContent).values({
    walletAddress: WALLET,
    contentId: CONTENT_ID,
    deploymentKey: TEST_CONTENT_DEPLOYMENT.deploymentKey,
    chainId: TEST_CONTENT_DEPLOYMENT.chainId,
    contentRegistryAddress: TEST_CONTENT_DEPLOYMENT.contentRegistryAddress,
    createdAt: now,
  });
  await confidentiality.upsertQuestionConfidentialityFromMetadata({
    contentId: CONTENT_ID,
    metadata: {
      confidentiality: {
        disclosurePolicy: "after_settlement",
        visibility: "gated",
      },
    },
  });
});

after(() => {
  globalThis.fetch = originalFetch;
  ponderClient.invalidatePonderCache({ clearLastKnownGood: true });
  dbModule.__setDatabaseResourcesForTests(null);
  restoreEnv("APP_URL", originalAppUrl);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("NODE_ENV", originalNodeEnv);
  restoreEnv("NOTIFICATION_DELIVERY_SECRET", originalDeliverySecret);
  restoreEnv("NEXT_PUBLIC_FRONTEND_CODE", originalFrontendCode);
  restoreEnv("NEXT_PUBLIC_PONDER_URL", originalPonderUrl);
  restoreEnv("RESEND_API_KEY", originalResendApiKey);
  restoreEnv("RESEND_FROM_EMAIL", originalResendFromEmail);
});

test("notification emails redact gated titles and descriptions before delivery", async () => {
  env.APP_URL = "https://www.rateloop.ai/rateloop";
  const result = await emailDelivery.deliverNotificationEmails();

  assert.equal(result.sent, 2);
  assert.equal(sentEmails.length, 2);
  for (const email of sentEmails) {
    assert.ok(!email.subject.includes(SECRET_TITLE));
    assert.ok(!email.text.includes(SECRET_TITLE));
    assert.ok(!email.text.includes(SECRET_DESCRIPTION));
    assert.ok(!email.html.includes(SECRET_TITLE));
    assert.ok(!email.html.includes(SECRET_DESCRIPTION));
    assert.ok(email.text.includes("https://www.rateloop.ai/rateloop/"));
    assert.ok(email.html.includes("https://www.rateloop.ai/rateloop/"));
  }
  assert.ok(sentEmails.some(email => email.text.includes("Private RateLoop question")));

  const deliveryRows = await dbModule.db.select().from(dbSchema.notificationEmailDeliveries);
  assert.equal(deliveryRows.length, 2);
  for (const row of deliveryRows) {
    assert.equal(row.deploymentKey, TEST_CONTENT_DEPLOYMENT.deploymentKey);
    assert.equal(row.chainId, TEST_CONTENT_DEPLOYMENT.chainId);
    assert.equal(row.contentRegistryAddress, TEST_CONTENT_DEPLOYMENT.contentRegistryAddress);
    assert.match(row.eventKey, new RegExp(`^${TEST_CONTENT_DEPLOYMENT.deploymentKey}:`));
  }
});
