import { NextRequest } from "next/server";
import { GET as getDetails } from "../../app/api/attachments/details/[detailsId]/route";
import { GET as getImage } from "../../app/api/attachments/images/[attachmentId]/route";
import { GET as getGatedContext } from "../../app/api/confidentiality/context/route";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import { getImageAttachmentVariantPathname, readLocalImageAttachment } from "~~/lib/attachments/imageAttachments";
import {
  OWNER_CONTEXT_SIGNED_READ_SESSION_COOKIE_NAME,
  getSignedReadSessionCookie,
  issueSignedReadSession,
} from "~~/lib/auth/signedReadSessions";
import {
  CONFIDENTIALITY_TERMS_DOC_HASH,
  CONFIDENTIALITY_TERMS_URI,
  CONFIDENTIALITY_TERMS_VERSION,
  __setConfidentialityOnchainGateForTests,
  recordConfidentialityTermsAcceptance,
  resolveCurrentConfidentialityDeploymentScope,
  upsertQuestionConfidentialityFromMetadata,
} from "~~/lib/confidentiality/context";
import { __setDatabaseResourcesForTests, db, dbClient } from "~~/lib/db";
import { questionDetails, questionImageAttachments } from "~~/lib/db/schema";
import { createMemoryDatabaseResources } from "~~/lib/db/testMemory";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

const env = process.env as Record<string, string | undefined>;
const originalDatabaseUrl = env.DATABASE_URL;
const originalNodeEnv = env.NODE_ENV;
const originalConfidentialitySecret = env.RATELOOP_CONFIDENTIALITY_SECRET;
const originalLocalImageDir = env.RATELOOP_LOCAL_IMAGE_ATTACHMENT_DIR;

const ATTACHMENT_ID = "att_routegateimage01";
const PUBLIC_ATTACHMENT_ID = "att_routepublicimg01";
const CONTENT_ID = "42";
const PUBLIC_CONTENT_ID = "43";
const DETAILS_ID = "det_routegatedetail01";
const DETAILS_TEXT = "Sensitive unreleased positioning copy.";
const WALLET = "0x1234567890abcdef1234567890abcdef12345678" as const;
const RATER_WALLET = "0x2234567890abcdef1234567890abcdef12345678" as const;
const IDENTITY_KEY = `0x${"a".repeat(64)}` as const;

let tempDir: string | null = null;

function currentDeploymentScope() {
  const scope = resolveCurrentConfidentialityDeploymentScope();
  assert.ok(scope);
  return scope;
}

function restoreEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

async function seedGatedConfidentiality() {
  const scope = currentDeploymentScope();
  await upsertQuestionConfidentialityFromMetadata({
    chainId: scope.chainId,
    contentId: CONTENT_ID,
    contentRegistryAddress: scope.contentRegistryAddress,
    deploymentKey: scope.deploymentKey,
    metadata: {
      confidentiality: {
        bond: { amount: "0", asset: "LREP" },
        disclosurePolicy: "after_settlement",
        visibility: "gated",
      },
    },
  });
}

async function seedGatedDetails() {
  const now = new Date("2026-06-11T12:00:00.000Z");
  const scope = currentDeploymentScope();
  await db.insert(questionDetails).values({
    id: DETAILS_ID,
    chainId: scope.chainId,
    contentId: CONTENT_ID,
    contentRegistryAddress: scope.contentRegistryAddress,
    deploymentKey: scope.deploymentKey,
    uploaderKind: "wallet",
    ownerWalletAddress: WALLET,
    sizeBytes: new TextEncoder().encode(DETAILS_TEXT).byteLength,
    sha256: createHash("sha256").update(DETAILS_TEXT).digest("hex"),
    normalizedText: DETAILS_TEXT,
    status: "approved",
    moderationStatus: "approved",
    createdAt: now,
    updatedAt: now,
  });
}

async function seedGatedImage() {
  const now = new Date("2026-06-11T12:00:00.000Z");
  const scope = currentDeploymentScope();
  const attachmentDir = path.join(tempDir!, "question-attachments", ATTACHMENT_ID);
  await mkdir(attachmentDir, { recursive: true });
  await writeFile(path.join(attachmentDir, "image.webp"), ONE_PIXEL_PNG);

  await db.insert(questionImageAttachments).values({
    id: ATTACHMENT_ID,
    chainId: scope.chainId,
    contentId: CONTENT_ID,
    contentRegistryAddress: scope.contentRegistryAddress,
    deploymentKey: scope.deploymentKey,
    uploaderKind: "wallet",
    ownerWalletAddress: WALLET,
    normalizedBlobPathname: `local://question-attachments/${ATTACHMENT_ID}/image.webp`,
    originalFilename: "secret-mockup.png",
    mimeType: "image/webp",
    sizeBytes: ONE_PIXEL_PNG.length,
    sha256: "a".repeat(64),
    status: "approved",
    moderationStatus: "approved",
    createdAt: now,
    updatedAt: now,
  });
}

async function seedPublicImage() {
  const now = new Date("2026-06-11T12:00:00.000Z");
  const scope = currentDeploymentScope();
  const attachmentDir = path.join(tempDir!, "question-attachments", PUBLIC_ATTACHMENT_ID);
  await mkdir(attachmentDir, { recursive: true });
  await writeFile(path.join(attachmentDir, "image.webp"), ONE_PIXEL_PNG);

  await db.insert(questionImageAttachments).values({
    id: PUBLIC_ATTACHMENT_ID,
    chainId: scope.chainId,
    contentId: PUBLIC_CONTENT_ID,
    contentRegistryAddress: scope.contentRegistryAddress,
    deploymentKey: scope.deploymentKey,
    uploaderKind: "wallet",
    ownerWalletAddress: WALLET,
    normalizedBlobPathname: `local://question-attachments/${PUBLIC_ATTACHMENT_ID}/image.webp`,
    originalFilename: "public-mockup.png",
    mimeType: "image/webp",
    sizeBytes: ONE_PIXEL_PNG.length,
    sha256: "b".repeat(64),
    status: "approved",
    moderationStatus: "approved",
    createdAt: now,
    updatedAt: now,
  });
}

async function buildSignedGatedContextCookie(walletAddress: `0x${string}` = WALLET) {
  const session = await issueSignedReadSession(walletAddress, "gated_context");
  const cookie = getSignedReadSessionCookie("gated_context", session);
  return `${cookie.name}=${cookie.value}`;
}

async function buildSignedOwnerContextCookie(walletAddress: `0x${string}` = WALLET) {
  const session = await issueSignedReadSession(walletAddress, "owner_context");
  const cookie = getSignedReadSessionCookie("owner_context", session);
  assert.equal(cookie.name, OWNER_CONTEXT_SIGNED_READ_SESSION_COOKIE_NAME);
  return `${cookie.name}=${cookie.value}`;
}

async function acceptTermsAndBuildCookie(nonce: string, walletAddress: `0x${string}` = RATER_WALLET) {
  const scope = currentDeploymentScope();
  await recordConfidentialityTermsAcceptance({
    acceptedAt: new Date("2026-06-11T12:01:00.000Z"),
    nonce,
    payload: {
      contentHash: null,
      contentId: CONTENT_ID,
      deploymentKey: scope.deploymentKey,
      detailsHash: null,
      identityKey: null,
      mediaTupleHash: null,
      normalizedAddress: walletAddress,
      questionMetadataHash: null,
      termsDocHash: CONFIDENTIALITY_TERMS_DOC_HASH,
      termsUri: CONFIDENTIALITY_TERMS_URI,
      termsVersion: CONFIDENTIALITY_TERMS_VERSION,
    },
    signature: "0xab",
  });
  return buildSignedGatedContextCookie(walletAddress);
}

beforeEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = await mkdtemp(path.join(tmpdir(), "rateloop-gated-attachment-routes-"));
  env.DATABASE_URL = "memory:";
  env.NODE_ENV = "test";
  env.RATELOOP_CONFIDENTIALITY_SECRET = "test-confidentiality-route-secret";
  env.RATELOOP_LOCAL_IMAGE_ATTACHMENT_DIR = tempDir;
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  __setConfidentialityOnchainGateForTests({
    hasActiveBond: async () => true,
    isIdentityKeyBanned: async () => false,
    resolveViewer: async () => ({
      delegated: false,
      hasActiveHumanCredential: true,
      holder: WALLET,
      humanNullifier: `0x${"b".repeat(64)}`,
      identityKey: IDENTITY_KEY,
    }),
  });
  await seedGatedConfidentiality();
});

after(async () => {
  __setConfidentialityOnchainGateForTests(null);
  __setDatabaseResourcesForTests(null);
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("NODE_ENV", originalNodeEnv);
  restoreEnv("RATELOOP_CONFIDENTIALITY_SECRET", originalConfidentialitySecret);
  restoreEnv("RATELOOP_LOCAL_IMAGE_ATTACHMENT_DIR", originalLocalImageDir);
});

test("gated details require a signed accepted wallet session and avoid public cache headers", async () => {
  await seedGatedDetails();
  const denied = await getDetails(new NextRequest(`https://www.rateloop.ai/api/attachments/details/${DETAILS_ID}`), {
    params: Promise.resolve({ detailsId: DETAILS_ID }),
  });

  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get("cache-control"), "private, no-store");
  assert.equal(denied.headers.get("x-robots-tag"), "noindex, noimageindex");
  assert.equal(denied.headers.get("access-control-allow-origin"), null);

  const cookie = await acceptTermsAndBuildCookie("nonce-details");
  const allowed = await getDetails(
    new NextRequest(`https://www.rateloop.ai/api/attachments/details/${DETAILS_ID}?address=${RATER_WALLET}`, {
      headers: {
        cookie,
        "x-real-ip": "198.51.100.12",
      },
    }),
    { params: Promise.resolve({ detailsId: DETAILS_ID }) },
  );

  assert.equal(allowed.status, 200);
  assert.equal(await allowed.text(), DETAILS_TEXT);
  assert.equal(allowed.headers.get("cache-control"), "private, no-store");
  assert.equal(allowed.headers.get("x-robots-tag"), "noindex, noimageindex");
  assert.equal(allowed.headers.get("access-control-allow-origin"), null);
  assert.match(allowed.headers.get("x-rateloop-view-token") ?? "", /^[a-f0-9]{64}$/);
  assert.match(allowed.headers.get("x-rateloop-details-hash") ?? "", /^0x[a-f0-9]{64}$/);

  const rows = await dbClient.execute(
    "SELECT content_id, identity_key, resource_id, resource_kind FROM confidential_context_access_logs",
  );
  assert.deepEqual(rows.rows, [
    {
      content_id: CONTENT_ID,
      identity_key: IDENTITY_KEY,
      resource_id: DETAILS_ID,
      resource_kind: "details",
    },
  ]);
});

test("gated details route throttles guessed ids before lookup", async () => {
  for (let index = 0; index < 121; index += 1) {
    const detailsId = `det_routefloodcase${String(index).padStart(4, "0")}`;
    const response = await getDetails(
      new NextRequest(`https://www.rateloop.ai/api/attachments/details/${detailsId}`, {
        headers: { "user-agent": "gated-details-route-flood" },
      }),
      { params: Promise.resolve({ detailsId }) },
    );

    if (index < 120) {
      assert.equal(response.status, 404);
    } else {
      assert.equal(response.status, 429);
      assert.ok(Number(response.headers.get("retry-after")) > 0);
      assert.equal((await response.json()).code, "rate_limit_exceeded");
    }
  }
});

test("gated details throttle repeated authorized resource reads and dedupe access logs", async () => {
  await seedGatedDetails();
  const cookie = await acceptTermsAndBuildCookie("nonce-details-throttle");

  for (let index = 0; index < 31; index += 1) {
    const response = await getDetails(
      new NextRequest(`https://www.rateloop.ai/api/attachments/details/${DETAILS_ID}?address=${RATER_WALLET}`, {
        headers: {
          cookie,
          "user-agent": "gated-details-resource-flood",
        },
      }),
      { params: Promise.resolve({ detailsId: DETAILS_ID }) },
    );

    if (index < 30) {
      assert.equal(response.status, 200);
      assert.equal(await response.text(), DETAILS_TEXT);
    } else {
      assert.equal(response.status, 429);
      assert.equal((await response.json()).code, "rate_limit_exceeded");
    }
  }

  const rows = await dbClient.execute({
    sql: "SELECT COUNT(*) AS access_count FROM confidential_context_access_logs WHERE resource_id = ?",
    args: [DETAILS_ID],
  });
  assert.equal(Number(rows.rows[0]?.access_count ?? 0), 1);
});

test("gated details allow the attachment owner with a signed wallet session without terms acceptance", async () => {
  await seedGatedDetails();
  const cookie = await buildSignedOwnerContextCookie(WALLET);

  const allowed = await getDetails(
    new NextRequest(`https://www.rateloop.ai/api/attachments/details/${DETAILS_ID}?address=${WALLET}`, {
      headers: {
        cookie,
        "x-real-ip": "198.51.100.14",
      },
    }),
    { params: Promise.resolve({ detailsId: DETAILS_ID }) },
  );

  assert.equal(allowed.status, 200);
  assert.equal(await allowed.text(), DETAILS_TEXT);
  assert.equal(allowed.headers.get("cache-control"), "private, no-store");
  assert.match(allowed.headers.get("x-rateloop-view-token") ?? "", /^[a-f0-9]{64}$/);

  const rows = await dbClient.execute(
    "SELECT content_id, identity_key, resource_id, resource_kind FROM confidential_context_access_logs",
  );
  assert.deepEqual(rows.rows, [
    {
      content_id: CONTENT_ID,
      identity_key: null,
      resource_id: DETAILS_ID,
      resource_kind: "details",
    },
  ]);
});

test("gated details do not allow owner bypass from a gated context cookie alone", async () => {
  await seedGatedDetails();
  const cookie = await buildSignedGatedContextCookie(WALLET);

  const denied = await getDetails(
    new NextRequest(`https://www.rateloop.ai/api/attachments/details/${DETAILS_ID}?address=${WALLET}`, {
      headers: { cookie },
    }),
    { params: Promise.resolve({ detailsId: DETAILS_ID }) },
  );

  assert.equal(denied.status, 403);
  assert.equal(await denied.text(), '{"error":"Confidentiality terms acceptance required"}');
  assert.equal(denied.headers.get("cache-control"), "private, no-store");
});

test("gated details still require terms acceptance for signed non-owner sessions", async () => {
  await seedGatedDetails();
  const cookie = await buildSignedGatedContextCookie(RATER_WALLET);

  const denied = await getDetails(
    new NextRequest(`https://www.rateloop.ai/api/attachments/details/${DETAILS_ID}?address=${RATER_WALLET}`, {
      headers: { cookie },
    }),
    { params: Promise.resolve({ detailsId: DETAILS_ID }) },
  );

  assert.equal(denied.status, 403);
  assert.equal(await denied.text(), '{"error":"Confidentiality terms acceptance required"}');
  assert.equal(denied.headers.get("cache-control"), "private, no-store");
});

test("gated context manifest returns authorized private attachment fetch URLs", async () => {
  await seedGatedDetails();
  await seedGatedImage();
  const now = new Date("2026-06-11T12:02:00.000Z");
  await db.insert(questionDetails).values({
    id: "det_legacygatedetail1",
    contentId: CONTENT_ID,
    deploymentKey: "31337:0x0000000000000000000000000000000000000001",
    uploaderKind: "wallet",
    ownerWalletAddress: RATER_WALLET,
    sizeBytes: 6,
    sha256: createHash("sha256").update("legacy").digest("hex"),
    normalizedText: "legacy",
    status: "approved",
    moderationStatus: "approved",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(questionImageAttachments).values({
    id: "att_legacygateimage1",
    contentId: CONTENT_ID,
    deploymentKey: "31337:0x0000000000000000000000000000000000000001",
    uploaderKind: "wallet",
    ownerWalletAddress: RATER_WALLET,
    normalizedBlobPathname: `local://question-attachments/${ATTACHMENT_ID}/image.webp`,
    originalFilename: "legacy.png",
    mimeType: "image/webp",
    sizeBytes: ONE_PIXEL_PNG.length,
    sha256: "b".repeat(64),
    status: "approved",
    moderationStatus: "approved",
    createdAt: now,
    updatedAt: now,
  });

  const requestUrl = `https://www.rateloop.ai/api/confidentiality/context?contentId=${CONTENT_ID}&address=${WALLET}`;
  const denied = await getGatedContext(new NextRequest(requestUrl));

  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await denied.json(), { error: "Signed wallet session required" });

  const cookie = await buildSignedOwnerContextCookie(WALLET);
  const allowed = await getGatedContext(new NextRequest(requestUrl, { headers: { cookie } }));
  const body = (await allowed.json()) as {
    contentId: string;
    details: Array<{ id: string; sha256: string | null; url: string }>;
    images: Array<{ id: string; mediaIndex: number; mediaType: string; sha256: string | null; url: string }>;
  };

  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("cache-control"), "private, no-store");
  assert.equal(body.contentId, CONTENT_ID);
  assert.deepEqual(body.details, [
    {
      id: DETAILS_ID,
      sha256: `0x${createHash("sha256").update(DETAILS_TEXT).digest("hex")}`,
      url: `/api/attachments/details/${DETAILS_ID}?address=${WALLET}`,
    },
  ]);
  assert.deepEqual(body.images, [
    {
      id: ATTACHMENT_ID,
      mediaIndex: 0,
      mediaType: "image",
      sha256: `0x${"a".repeat(64)}`,
      url: `/api/attachments/images/${ATTACHMENT_ID}.webp?address=${WALLET}#sha256=0x${"a".repeat(64)}`,
    },
  ]);
});

test("pending gated hosted attachments fail closed before content linkage", async () => {
  const now = new Date("2026-06-11T12:00:00.000Z");
  await db.insert(questionDetails).values({
    id: DETAILS_ID,
    uploaderKind: "wallet",
    ownerWalletAddress: WALLET,
    requiresGatedAccess: true,
    sizeBytes: new TextEncoder().encode(DETAILS_TEXT).byteLength,
    sha256: createHash("sha256").update(DETAILS_TEXT).digest("hex"),
    normalizedText: DETAILS_TEXT,
    status: "approved",
    moderationStatus: "approved",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(questionImageAttachments).values({
    id: ATTACHMENT_ID,
    uploaderKind: "wallet",
    ownerWalletAddress: WALLET,
    requiresGatedAccess: true,
    normalizedBlobPathname: `local://question-attachments/${ATTACHMENT_ID}/image.webp`,
    originalFilename: "secret-mockup.png",
    mimeType: "image/webp",
    sizeBytes: ONE_PIXEL_PNG.length,
    sha256: "a".repeat(64),
    status: "approved",
    moderationStatus: "approved",
    createdAt: now,
    updatedAt: now,
  });

  const details = await getDetails(new NextRequest(`https://www.rateloop.ai/api/attachments/details/${DETAILS_ID}`), {
    params: Promise.resolve({ detailsId: DETAILS_ID }),
  });
  assert.equal(details.status, 404);
  assert.equal(details.headers.get("cache-control"), "private, no-store");
  assert.equal(details.headers.get("x-robots-tag"), "noindex, noimageindex");
  assert.equal(await details.text(), '{"error":"Question details not found."}');

  const image = await getImage(
    new NextRequest(`https://www.rateloop.ai/api/attachments/images/${ATTACHMENT_ID}.webp`),
    {
      params: Promise.resolve({ attachmentId: `${ATTACHMENT_ID}.webp` }),
    },
  );
  assert.equal(image.status, 404);
  assert.equal(image.headers.get("cache-control"), "private, no-store");
  assert.equal(await image.text(), "Not found");
});

test("unlinked public details are not served before submission", async () => {
  const now = new Date("2026-06-11T12:00:00.000Z");
  await db.insert(questionDetails).values({
    id: DETAILS_ID,
    uploaderKind: "wallet",
    ownerWalletAddress: WALLET,
    sizeBytes: new TextEncoder().encode(DETAILS_TEXT).byteLength,
    sha256: createHash("sha256").update(DETAILS_TEXT).digest("hex"),
    normalizedText: DETAILS_TEXT,
    status: "approved",
    moderationStatus: "approved",
    createdAt: now,
    updatedAt: now,
  });

  const details = await getDetails(new NextRequest(`https://www.rateloop.ai/api/attachments/details/${DETAILS_ID}`), {
    params: Promise.resolve({ detailsId: DETAILS_ID }),
  });
  assert.equal(details.status, 404);
  assert.equal(details.headers.get("cache-control"), "private, no-store");
});

test("unlinked public images serve preview variants before submission", async () => {
  const now = new Date("2026-06-11T12:00:00.000Z");
  const attachmentDir = path.join(tempDir!, "question-attachments", PUBLIC_ATTACHMENT_ID);
  await mkdir(attachmentDir, { recursive: true });
  await writeFile(path.join(attachmentDir, "image.webp"), ONE_PIXEL_PNG);

  await db.insert(questionImageAttachments).values({
    id: PUBLIC_ATTACHMENT_ID,
    uploaderKind: "wallet",
    ownerWalletAddress: WALLET,
    normalizedBlobPathname: `local://question-attachments/${PUBLIC_ATTACHMENT_ID}/image.webp`,
    originalFilename: "draft-mockup.png",
    mimeType: "image/webp",
    sizeBytes: ONE_PIXEL_PNG.length,
    sha256: "c".repeat(64),
    status: "approved",
    moderationStatus: "approved",
    createdAt: now,
    updatedAt: now,
  });

  const response = await getImage(
    new NextRequest(`https://www.rateloop.ai/api/attachments/images/${PUBLIC_ATTACHMENT_ID}.webp?variant=preview`),
    { params: Promise.resolve({ attachmentId: `${PUBLIC_ATTACHMENT_ID}.webp` }) },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, noimageindex");
  assert.ok((await response.arrayBuffer()).byteLength > 0);
});

test("public images serve and backfill requested display variants", async () => {
  await seedPublicImage();
  const normalizedPathname = `local://question-attachments/${PUBLIC_ATTACHMENT_ID}/image.webp`;
  const feedPathname = getImageAttachmentVariantPathname(normalizedPathname, "feed");
  assert.equal(await readLocalImageAttachment(feedPathname), null);

  const response = await getImage(
    new NextRequest(`https://www.rateloop.ai/api/attachments/images/${PUBLIC_ATTACHMENT_ID}.webp?variant=feed`),
    { params: Promise.resolve({ attachmentId: `${PUBLIC_ATTACHMENT_ID}.webp` }) },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.ok((await response.arrayBuffer()).byteLength > 0);
  assert.ok(await readLocalImageAttachment(feedPathname));
});

test("gated images require accepted wallet sessions and return watermarked no-store bytes", async () => {
  await seedGatedImage();
  const denied = await getImage(
    new NextRequest(`https://www.rateloop.ai/api/attachments/images/${ATTACHMENT_ID}.webp`),
    { params: Promise.resolve({ attachmentId: `${ATTACHMENT_ID}.webp` }) },
  );

  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get("cache-control"), "private, no-store");

  const cookie = await acceptTermsAndBuildCookie("nonce-image");
  const allowed = await getImage(
    new NextRequest(`https://www.rateloop.ai/api/attachments/images/${ATTACHMENT_ID}.webp?address=${RATER_WALLET}`, {
      headers: {
        cookie,
        "x-real-ip": "198.51.100.13",
      },
    }),
    { params: Promise.resolve({ attachmentId: `${ATTACHMENT_ID}.webp` }) },
  );

  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("cache-control"), "private, no-store");
  assert.equal(allowed.headers.get("content-type"), "image/webp");
  assert.equal(allowed.headers.get("x-robots-tag"), "noindex, noimageindex");
  assert.match(allowed.headers.get("x-rateloop-view-token") ?? "", /^[a-f0-9]{64}$/);
  assert.ok((await allowed.arrayBuffer()).byteLength > 0);

  const rows = await dbClient.execute(
    "SELECT content_id, identity_key, resource_id, resource_kind FROM confidential_context_access_logs",
  );
  assert.deepEqual(rows.rows, [
    {
      content_id: CONTENT_ID,
      identity_key: IDENTITY_KEY,
      resource_id: ATTACHMENT_ID,
      resource_kind: "image",
    },
  ]);
});

test("gated image route throttles guessed ids before lookup", async () => {
  for (let index = 0; index < 121; index += 1) {
    const attachmentId = `att_imagefloodcase${String(index).padStart(4, "0")}`;
    const response = await getImage(
      new NextRequest(`https://www.rateloop.ai/api/attachments/images/${attachmentId}.webp`, {
        headers: { "user-agent": "gated-image-route-flood" },
      }),
      { params: Promise.resolve({ attachmentId: `${attachmentId}.webp` }) },
    );

    if (index < 120) {
      assert.equal(response.status, 404);
    } else {
      assert.equal(response.status, 429);
      assert.ok(Number(response.headers.get("retry-after")) > 0);
      assert.equal((await response.json()).code, "rate_limit_exceeded");
    }
  }
});

test("gated images throttle repeated authorized resource reads and dedupe access logs", async () => {
  await seedGatedImage();
  const cookie = await acceptTermsAndBuildCookie("nonce-image-throttle");

  for (let index = 0; index < 31; index += 1) {
    const response = await getImage(
      new NextRequest(`https://www.rateloop.ai/api/attachments/images/${ATTACHMENT_ID}.webp?address=${RATER_WALLET}`, {
        headers: {
          cookie,
          "user-agent": "gated-image-resource-flood",
        },
      }),
      { params: Promise.resolve({ attachmentId: `${ATTACHMENT_ID}.webp` }) },
    );

    if (index < 30) {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/webp");
      assert.ok((await response.arrayBuffer()).byteLength > 0);
    } else {
      assert.equal(response.status, 429);
      assert.equal((await response.json()).code, "rate_limit_exceeded");
    }
  }

  const rows = await dbClient.execute({
    sql: "SELECT COUNT(*) AS access_count FROM confidential_context_access_logs WHERE resource_id = ?",
    args: [ATTACHMENT_ID],
  });
  assert.equal(Number(rows.rows[0]?.access_count ?? 0), 1);
});

test("gated images allow the attachment owner with a signed wallet session without terms acceptance", async () => {
  await seedGatedImage();
  const cookie = await buildSignedOwnerContextCookie(WALLET);

  const allowed = await getImage(
    new NextRequest(`https://www.rateloop.ai/api/attachments/images/${ATTACHMENT_ID}.webp?address=${WALLET}`, {
      headers: {
        cookie,
        "x-real-ip": "198.51.100.15",
      },
    }),
    { params: Promise.resolve({ attachmentId: `${ATTACHMENT_ID}.webp` }) },
  );

  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("cache-control"), "private, no-store");
  assert.equal(allowed.headers.get("content-type"), "image/webp");
  assert.match(allowed.headers.get("x-rateloop-view-token") ?? "", /^[a-f0-9]{64}$/);
  assert.ok((await allowed.arrayBuffer()).byteLength > 0);

  const rows = await dbClient.execute(
    "SELECT content_id, identity_key, resource_id, resource_kind FROM confidential_context_access_logs",
  );
  assert.deepEqual(rows.rows, [
    {
      content_id: CONTENT_ID,
      identity_key: null,
      resource_id: ATTACHMENT_ID,
      resource_kind: "image",
    },
  ]);
});
