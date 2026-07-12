import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import {
  attachQuestionDetailsToContent,
  createQuestionDetailsFromText,
  getQuestionDetails,
  getQuestionDetailsSubmissionValidationError,
  getQuestionDetailsUrl,
  parseQuestionDetailsIdFromDetailsUrl,
  sweepOrphanedQuestionDetails,
} from "~~/lib/attachments/questionDetails";
import { questionDetailsHashInput } from "~~/lib/attachments/questionDetails.shared";
import { __setDatabaseResourcesForTests, db } from "~~/lib/db";
import { questionDetails } from "~~/lib/db/schema";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";

const env = process.env as Record<string, string | undefined>;
const originalAppUrl = env.APP_URL;
const originalNextPublicAppUrl = env.NEXT_PUBLIC_APP_URL;
const originalNodeEnv = env.NODE_ENV;
const originalModerationMode = env.RATELOOP_QUESTION_DETAILS_MODERATION_MODE;
const originalE2EProductionBuild = env.RATELOOP_E2E_PRODUCTION_BUILD;
const originalPublicE2EProductionBuild = env.NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD;
const originalOpenAiKey = env.OPENAI_API_KEY;
const originalVercelUrl = env.VERCEL_URL;
const WALLET = "0x00000000000000000000000000000000000000aa";

function restoreEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  process.env.APP_URL = "https://www.rateloop.ai";
  process.env.RATELOOP_QUESTION_DETAILS_MODERATION_MODE = "disabled";
  delete process.env.OPENAI_API_KEY;
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  restoreEnv("APP_URL", originalAppUrl);
  restoreEnv("NEXT_PUBLIC_APP_URL", originalNextPublicAppUrl);
  restoreEnv("NODE_ENV", originalNodeEnv);
  if (originalModerationMode === undefined) {
    delete process.env.RATELOOP_QUESTION_DETAILS_MODERATION_MODE;
  } else {
    process.env.RATELOOP_QUESTION_DETAILS_MODERATION_MODE = originalModerationMode;
  }
  if (originalOpenAiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAiKey;
  }
  if (originalE2EProductionBuild === undefined) {
    delete process.env.RATELOOP_E2E_PRODUCTION_BUILD;
  } else {
    process.env.RATELOOP_E2E_PRODUCTION_BUILD = originalE2EProductionBuild;
  }
  if (originalPublicE2EProductionBuild === undefined) {
    delete process.env.NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD;
  } else {
    process.env.NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD = originalPublicE2EProductionBuild;
  }
  restoreEnv("VERCEL_URL", originalVercelUrl);
});

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function questionDetailsSha256Hex(params: {
  detailsId: string;
  normalizedText: string;
  requiresGatedAccess?: boolean;
}) {
  return sha256Hex(questionDetailsHashInput(params));
}

async function createApprovedQuestionDetails(params: {
  agentId?: string;
  detailsId: string;
  ownerWalletAddress?: `0x${string}` | null;
  text: string;
}) {
  const normalizedText = params.text.trim();
  return createQuestionDetailsFromText({
    detailsId: params.detailsId,
    requestUrl: "https://www.rateloop.ai/api/attachments/details/upload",
    sha256: questionDetailsSha256Hex({ detailsId: params.detailsId, normalizedText }),
    sizeBytes: new TextEncoder().encode(normalizedText).byteLength,
    text: normalizedText,
    uploader: params.agentId
      ? {
          kind: "agent",
          agentId: params.agentId,
          ownerWalletAddress: params.ownerWalletAddress ?? null,
        }
      : {
          kind: "wallet",
          ownerWalletAddress: params.ownerWalletAddress ?? WALLET,
        },
  });
}

test("builds public question details URLs from the configured app origin", () => {
  assert.equal(
    getQuestionDetailsUrl("https://preview.example/api/attachments/details/upload", "det_questiondetails01"),
    "https://www.rateloop.ai/api/attachments/details/det_questiondetails01",
  );
});

test("uses only hardened configured app origins for question details URLs in production", () => {
  env.NODE_ENV = "production";
  env.APP_URL = "https://evil.example";
  delete env.NEXT_PUBLIC_APP_URL;

  assert.equal(
    getQuestionDetailsUrl("https://preview.example/api/attachments/details/upload", "det_questiondetails01"),
    "https://www.rateloop.ai/api/attachments/details/det_questiondetails01",
  );
  assert.equal(
    parseQuestionDetailsIdFromDetailsUrl("https://evil.example/api/attachments/details/det_questiondetails01"),
    null,
  );

  env.NEXT_PUBLIC_APP_URL = "https://safe.rateloop.ai";
  assert.equal(
    parseQuestionDetailsIdFromDetailsUrl("https://safe.rateloop.ai/api/attachments/details/det_questiondetails01"),
    "det_questiondetails01",
  );

  env.APP_URL = "https://rateloop-tokenless-random.vercel.app";
  delete env.NEXT_PUBLIC_APP_URL;
  assert.equal(
    getQuestionDetailsUrl("https://www.rateloop.ai/api/attachments/details/upload", "det_questiondetails01"),
    "https://rateloop-tokenless-random.vercel.app/api/attachments/details/det_questiondetails01",
  );
  assert.equal(
    parseQuestionDetailsIdFromDetailsUrl(
      "https://rateloop-tokenless-random.vercel.app/api/attachments/details/det_questiondetails01",
    ),
    "det_questiondetails01",
  );
});

test("parses local details ids only from exact public details URLs", () => {
  assert.equal(
    parseQuestionDetailsIdFromDetailsUrl("https://www.rateloop.ai/api/attachments/details/det_questiondetails01"),
    "det_questiondetails01",
  );
  assert.equal(
    parseQuestionDetailsIdFromDetailsUrl("https://evil.example/api/attachments/details/det_questiondetails01"),
    null,
  );
  assert.equal(
    parseQuestionDetailsIdFromDetailsUrl(
      "https://user:pass@www.rateloop.ai/api/attachments/details/det_questiondetails01",
    ),
    null,
  );
  assert.equal(
    parseQuestionDetailsIdFromDetailsUrl(
      "https://www.rateloop.ai.evil.example/api/attachments/details/det_questiondetails01",
    ),
    null,
  );
});

test("stores normalized approved details with a verifiable sha256 hash", async () => {
  const normalizedText = "Line one\nLine two";
  const sha256 = sha256Hex(normalizedText);
  const result = await createQuestionDetailsFromText({
    detailsId: "det_questiondetails01",
    requestUrl: "https://preview.example/api/attachments/details/upload",
    sha256,
    sizeBytes: new TextEncoder().encode(normalizedText).byteLength,
    text: "  Line one\r\nLine two  ",
    uploader: {
      kind: "wallet",
      ownerWalletAddress: WALLET,
    },
  });

  assert.equal(result.status, "approved");
  assert.equal(result.detailsHash, `0x${sha256}`);
  assert.equal(result.detailsUrl, "https://www.rateloop.ai/api/attachments/details/det_questiondetails01");

  const stored = await getQuestionDetails("det_questiondetails01");
  assert.equal(stored?.normalizedText, normalizedText);
  assert.equal(stored?.ownerWalletAddress, WALLET);
  assert.equal(stored?.requiresGatedAccess, false);
  assert.equal(stored?.status, "approved");
});

test("persists gated access intent for approved details at upload time", async () => {
  const normalizedText = "Private launch notes";
  const detailsId = "det_gateduploaddetail";
  const sha256 = questionDetailsSha256Hex({ detailsId, normalizedText, requiresGatedAccess: true });
  const result = await createQuestionDetailsFromText({
    detailsId,
    requestUrl: "https://preview.example/api/attachments/details/upload",
    requiresGatedAccess: true,
    sha256,
    sizeBytes: new TextEncoder().encode(normalizedText).byteLength,
    text: normalizedText,
    uploader: {
      kind: "wallet",
      ownerWalletAddress: WALLET,
    },
  });

  assert.equal(result.status, "approved");
  assert.equal(result.detailsHash, `0x${sha256}`);
  assert.notEqual(result.detailsHash, `0x${sha256Hex(normalizedText)}`);
  const stored = await getQuestionDetails("det_gateduploaddetail");
  assert.equal(stored?.requiresGatedAccess, true);
});

test("does not publish details from localhost because on-chain details URLs must be public HTTPS", async () => {
  process.env.APP_URL = "http://localhost:3000";
  delete process.env.RATELOOP_E2E_PRODUCTION_BUILD;
  delete process.env.NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD;
  const normalizedText = "Local-only details";
  const result = await createQuestionDetailsFromText({
    detailsId: "det_localdetailsurl01",
    requestUrl: "http://localhost:3000/api/attachments/details/upload",
    sha256: sha256Hex(normalizedText),
    sizeBytes: new TextEncoder().encode(normalizedText).byteLength,
    text: normalizedText,
    uploader: {
      kind: "wallet",
      ownerWalletAddress: WALLET,
    },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.detailsHash, null);
  assert.equal(result.detailsUrl, null);
  assert.match(result.error ?? "", /public HTTPS origin/);

  const stored = await getQuestionDetails("det_localdetailsurl01");
  assert.equal(stored?.normalizedText, null);
  assert.equal(stored?.status, "failed");
});

test("publishes public details URLs in the e2e production-build harness", async () => {
  process.env.APP_URL = "http://localhost:3000";
  delete process.env.RATELOOP_QUESTION_DETAILS_MODERATION_MODE;
  process.env.RATELOOP_E2E_PRODUCTION_BUILD = "true";
  const normalizedText = "Local e2e hosted details";
  const result = await createQuestionDetailsFromText({
    detailsId: "det_locale2edetails01",
    requestUrl: "http://localhost:3000/api/attachments/details/upload",
    sha256: sha256Hex(normalizedText),
    sizeBytes: new TextEncoder().encode(normalizedText).byteLength,
    text: normalizedText,
    uploader: {
      kind: "wallet",
      ownerWalletAddress: WALLET,
    },
  });

  assert.equal(result.status, "approved");
  assert.equal(result.detailsUrl, "https://www.rateloop.ai/api/attachments/details/det_locale2edetails01");
  const stored = await getQuestionDetails("det_locale2edetails01");
  assert.equal(stored?.normalizedText, normalizedText);
});

test("stores failed details without publishing text when size or hash validation fails", async () => {
  const result = await createQuestionDetailsFromText({
    detailsId: "det_questiondetails02",
    requestUrl: "https://www.rateloop.ai/api/attachments/details/upload",
    sha256: "0".repeat(64),
    sizeBytes: 999,
    text: "Actual text",
    uploader: {
      kind: "wallet",
      ownerWalletAddress: WALLET,
    },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.detailsHash, null);
  assert.equal(result.detailsUrl, null);
  const stored = await getQuestionDetails("det_questiondetails02");
  assert.equal(stored?.normalizedText, null);
  assert.match(stored?.error ?? "", /size/i);
});

test("attaches approved wallet details to a submitted content id by normalized owner", async () => {
  const result = await createApprovedQuestionDetails({
    detailsId: "det_attachwalletdetail",
    ownerWalletAddress: WALLET,
    text: "Wallet owned details",
  });
  assert.equal(result.status, "approved");
  assert.ok(result.detailsUrl);

  const attached = await attachQuestionDetailsToContent({
    contentId: "42",
    detailsUrl: result.detailsUrl,
    ownerWalletAddress: "0x00000000000000000000000000000000000000AA",
  });

  assert.equal(attached, true);
  const stored = await getQuestionDetails("det_attachwalletdetail");
  assert.equal(stored?.contentId, "42");
});

test("keeps approved details bound to the original content and deployment scope", async () => {
  const result = await createApprovedQuestionDetails({
    detailsId: "det_relinkguarddetail",
    ownerWalletAddress: WALLET,
    text: "Details that should stay with their first question",
  });
  assert.equal(result.status, "approved");
  assert.ok(result.detailsUrl);

  const deploymentScope = {
    chainId: 31337,
    contentRegistryAddress: "0x0000000000000000000000000000000000000001",
    deploymentKey: "31337:0x0000000000000000000000000000000000000001",
  };

  const firstAttach = await attachQuestionDetailsToContent({
    ...deploymentScope,
    contentId: "42",
    detailsUrl: result.detailsUrl,
    ownerWalletAddress: WALLET,
  });
  const idempotentAttach = await attachQuestionDetailsToContent({
    ...deploymentScope,
    contentId: "42",
    detailsUrl: result.detailsUrl,
    ownerWalletAddress: WALLET,
  });
  const crossContentAttach = await attachQuestionDetailsToContent({
    ...deploymentScope,
    contentId: "43",
    detailsUrl: result.detailsUrl,
    ownerWalletAddress: WALLET,
  });
  const crossDeploymentAttach = await attachQuestionDetailsToContent({
    ...deploymentScope,
    contentId: "42",
    deploymentKey: "31337:0x0000000000000000000000000000000000000002",
    detailsUrl: result.detailsUrl,
    ownerWalletAddress: WALLET,
  });

  assert.equal(firstAttach, true);
  assert.equal(idempotentAttach, true);
  assert.equal(crossContentAttach, false);
  assert.equal(crossDeploymentAttach, false);
  const stored = await getQuestionDetails("det_relinkguarddetail");
  assert.equal(stored?.contentId, "42");
  assert.equal(stored?.deploymentKey, deploymentScope.deploymentKey);
});

test("attaches approved agent details to a submitted content id by agent id", async () => {
  const result = await createApprovedQuestionDetails({
    agentId: "agent-1",
    detailsId: "det_attachagentdetail",
    ownerWalletAddress: null,
    text: "Agent owned details",
  });
  assert.equal(result.status, "approved");
  assert.ok(result.detailsUrl);

  const attached = await attachQuestionDetailsToContent({
    agentId: "agent-1",
    contentId: "43",
    detailsUrl: result.detailsUrl,
  });

  assert.equal(attached, true);
  const stored = await getQuestionDetails("det_attachagentdetail");
  assert.equal(stored?.contentId, "43");
});

test("does not attach details for a different uploader identity", async () => {
  const result = await createApprovedQuestionDetails({
    detailsId: "det_attachwrongidentity",
    ownerWalletAddress: WALLET,
    text: "Wrong owner details",
  });
  assert.equal(result.status, "approved");
  assert.ok(result.detailsUrl);

  const attached = await attachQuestionDetailsToContent({
    contentId: "44",
    detailsUrl: result.detailsUrl,
    ownerWalletAddress: "0x00000000000000000000000000000000000000bb",
  });

  assert.equal(attached, false);
  const stored = await getQuestionDetails("det_attachwrongidentity");
  assert.equal(stored?.contentId, null);
});

test("does not attach failed details even when the local details URL is guessed", async () => {
  await createQuestionDetailsFromText({
    detailsId: "det_attachfaileddetail",
    requestUrl: "https://www.rateloop.ai/api/attachments/details/upload",
    sha256: "0".repeat(64),
    sizeBytes: 999,
    text: "Failed details",
    uploader: {
      kind: "wallet",
      ownerWalletAddress: WALLET,
    },
  });

  const attached = await attachQuestionDetailsToContent({
    contentId: "45",
    detailsUrl: "https://www.rateloop.ai/api/attachments/details/det_attachfaileddetail",
    ownerWalletAddress: WALLET,
  });

  assert.equal(attached, false);
  const stored = await getQuestionDetails("det_attachfaileddetail");
  assert.equal(stored?.contentId, null);
});

test("validates hosted details ownership, hash, status, and attachment state before submission", async () => {
  const result = await createApprovedQuestionDetails({
    detailsId: "det_submitvaliddetail",
    ownerWalletAddress: WALLET,
    text: "Submission details",
  });
  assert.ok(result.detailsUrl);
  assert.ok(result.detailsHash);

  assert.equal(
    await getQuestionDetailsSubmissionValidationError({
      details: [{ detailsHash: result.detailsHash, detailsUrl: result.detailsUrl }],
      ownerWalletAddress: "0x00000000000000000000000000000000000000AA",
    }),
    null,
  );
  assert.equal(
    await getQuestionDetailsSubmissionValidationError({
      details: [{ detailsHash: `0x${"b".repeat(64)}`, detailsUrl: result.detailsUrl }],
      ownerWalletAddress: WALLET,
    }),
    "Uploaded detailsUrl must match the approved details hash.",
  );
  assert.equal(
    await getQuestionDetailsSubmissionValidationError({
      details: [{ detailsHash: result.detailsHash, detailsUrl: result.detailsUrl }],
      ownerWalletAddress: "0x00000000000000000000000000000000000000bb",
    }),
    "detailsUrl must belong to the submitting wallet or agent.",
  );

  await db.update(questionDetails).set({ contentId: "77" }).where(eq(questionDetails.id, "det_submitvaliddetail"));
  assert.equal(
    await getQuestionDetailsSubmissionValidationError({
      details: [{ detailsHash: result.detailsHash, detailsUrl: result.detailsUrl }],
      ownerWalletAddress: WALLET,
    }),
    "detailsUrl is already attached to a submitted question.",
  );

  await createQuestionDetailsFromText({
    detailsId: "det_submitfaileddetail",
    requestUrl: "https://www.rateloop.ai/api/attachments/details/upload",
    sha256: "0".repeat(64),
    sizeBytes: 999,
    text: "Failed details",
    uploader: {
      kind: "wallet",
      ownerWalletAddress: WALLET,
    },
  });
  assert.equal(
    await getQuestionDetailsSubmissionValidationError({
      details: [
        {
          detailsHash: `0x${"0".repeat(64)}`,
          detailsUrl: "https://www.rateloop.ai/api/attachments/details/det_submitfaileddetail",
        },
      ],
      ownerWalletAddress: WALLET,
    }),
    "detailsUrl must come from approved RateLoop details uploads.",
  );
});

test("sweeps old failed and blocked details while retaining approved immutable details", async () => {
  const now = new Date("2026-06-05T12:00:00.000Z");
  const old = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const fresh = new Date(now.getTime() - 30 * 1000);
  await db.insert(questionDetails).values([
    {
      id: "det_oldapproveddetail",
      uploaderKind: "wallet",
      ownerWalletAddress: WALLET,
      sizeBytes: 8,
      sha256: sha256Hex("approved"),
      normalizedText: "approved",
      status: "approved",
      moderationStatus: "approved",
      createdAt: old,
      updatedAt: old,
    },
    {
      id: "det_oldfaileddetail",
      uploaderKind: "wallet",
      ownerWalletAddress: WALLET,
      sizeBytes: 8,
      sha256: sha256Hex("failed"),
      status: "failed",
      moderationStatus: "failed",
      createdAt: old,
      updatedAt: old,
    },
    {
      id: "det_oldblockeddetail",
      uploaderKind: "wallet",
      ownerWalletAddress: WALLET,
      sizeBytes: 8,
      sha256: sha256Hex("blocked"),
      status: "blocked",
      moderationStatus: "blocked",
      createdAt: old,
      updatedAt: old,
    },
    {
      id: "det_freshfaileddetail",
      uploaderKind: "wallet",
      ownerWalletAddress: WALLET,
      sizeBytes: 8,
      sha256: sha256Hex("fresh"),
      status: "failed",
      moderationStatus: "failed",
      createdAt: fresh,
      updatedAt: fresh,
    },
  ]);

  const result = await sweepOrphanedQuestionDetails({ now, unattachedTtlMs: 60 * 60 * 1000 });
  assert.equal(result.deleted, 2);
  assert.equal(result.scanned, 2);

  const approved = await getQuestionDetails("det_oldapproveddetail");
  assert.equal(approved?.status, "approved");
  const freshFailed = await getQuestionDetails("det_freshfaileddetail");
  assert.equal(freshFailed?.status, "failed");
  const [deleted] = await db.select().from(questionDetails).where(eq(questionDetails.id, "det_oldfaileddetail"));
  assert.equal(deleted?.status, "deleted");
  assert.equal(deleted?.normalizedText, null);
});
