import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import {
  attachQuestionDetailsToContent,
  createQuestionDetailsFromText,
  getQuestionDetails,
  getQuestionDetailsUrl,
  parseQuestionDetailsIdFromDetailsUrl,
  sweepOrphanedQuestionDetails,
} from "~~/lib/attachments/questionDetails";
import { questionDetailsHashInput } from "~~/lib/attachments/questionDetails.shared";
import { __setDatabaseResourcesForTests, db } from "~~/lib/db";
import { questionDetails } from "~~/lib/db/schema";
import { createMemoryDatabaseResources } from "~~/lib/db/testMemory";

const originalAppUrl = process.env.APP_URL;
const originalModerationMode = process.env.RATELOOP_QUESTION_DETAILS_MODERATION_MODE;
const originalE2EProductionBuild = process.env.RATELOOP_E2E_PRODUCTION_BUILD;
const originalPublicE2EProductionBuild = process.env.NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD;
const originalOpenAiKey = process.env.OPENAI_API_KEY;
const WALLET = "0x00000000000000000000000000000000000000aa";

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  process.env.APP_URL = "https://www.rateloop.ai";
  process.env.RATELOOP_QUESTION_DETAILS_MODERATION_MODE = "disabled";
  delete process.env.OPENAI_API_KEY;
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalAppUrl === undefined) {
    delete process.env.APP_URL;
  } else {
    process.env.APP_URL = originalAppUrl;
  }
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

test("allows localhost details in the e2e production-build harness", async () => {
  delete process.env.APP_URL;
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
  assert.equal(result.detailsUrl, "http://localhost:3000/api/attachments/details/det_locale2edetails01");
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
