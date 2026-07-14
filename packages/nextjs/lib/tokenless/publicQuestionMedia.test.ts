import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import sharp from "sharp";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  createWorkspace,
  createWorkspaceApiKey,
  prepareProductAsk,
  recordPrepaidLedgerEntry,
} from "~~/lib/tokenless/productCore";
import {
  PUBLIC_QUESTION_IMAGE_MAX_BYTES,
  type PublicQuestionMediaStore,
  __setPublicQuestionMediaRuntimeForTests,
  deleteStagedPublicQuestionImage,
  readPublicQuestionImage,
  stagePublicQuestionImage,
} from "~~/lib/tokenless/publicQuestionMedia";
import { TokenlessServiceError, createTokenlessQuote } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";
const OUTSIDER = "0x2222222222222222222222222222222222222222";
const ASSET_ID = `pqm_${"A".repeat(32)}`;

class MemoryMediaStore implements PublicQuestionMediaStore {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();

  async delete(reference: string) {
    this.objects.delete(reference);
  }

  async get(reference: string) {
    const object = this.objects.get(reference);
    if (!object) throw new Error("missing object");
    return new Uint8Array(object.body);
  }

  async put(pathname: string, body: Uint8Array, contentType: string) {
    const reference = `memory://${pathname}`;
    this.objects.set(reference, { body: new Uint8Array(body), contentType });
    return reference;
  }
}

let store: MemoryMediaStore;
let workspaceId: string;

beforeEach(async () => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  store = new MemoryMediaStore();
  __setPublicQuestionMediaRuntimeForTests({ randomAssetId: () => ASSET_ID, store });
  workspaceId = (await createWorkspace({ name: "Media workspace", ownerAddress: OWNER })).workspaceId;
});

afterEach(() => {
  __setPublicQuestionMediaRuntimeForTests(null);
  __setDatabaseResourcesForTests(null);
});

async function png() {
  return new Uint8Array(
    await sharp({
      create: { background: { alpha: 1, b: 220, g: 140, r: 40 }, channels: 4, height: 32, width: 48 },
    })
      .png()
      .toBuffer(),
  );
}

test("staged images are byte-verified, normalized, private, and idempotent", async () => {
  const bytes = await png();
  const first = await stagePublicQuestionImage({
    accountAddress: OWNER,
    bytes,
    clientRequestId: "upload:test:0001",
    filename: "candidate.png",
    now: new Date("2026-07-14T10:00:00.000Z"),
    workspaceId,
  });
  const replay = await stagePublicQuestionImage({
    accountAddress: OWNER,
    bytes,
    clientRequestId: "upload:test:0001",
    filename: "candidate.png",
    now: new Date("2026-07-14T10:05:00.000Z"),
    workspaceId,
  });

  assert.deepEqual(replay, first);
  assert.equal(first.assetId, ASSET_ID);
  assert.match(first.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first.contentType, "image/webp");
  assert.equal(first.width, 48);
  assert.equal(first.height, 32);
  assert.match(first.previewUrl, new RegExp(`${ASSET_ID}$`));
  assert.equal(store.objects.size, 1);
  const stored = [...store.objects.values()][0];
  assert.ok(stored);
  assert.equal(stored.contentType, "image/webp");
  assert.equal((await sharp(stored.body).metadata()).format, "webp");

  const rows = await dbClient.execute(
    "SELECT technical_status, moderation_status, storage_ref FROM tokenless_public_question_media",
  );
  assert.deepEqual(
    rows.rows.map(row => ({ moderation: row.moderation_status, status: row.technical_status })),
    [{ moderation: "pending", status: "ready" }],
  );
  assert.match(String(rows.rows[0]?.storage_ref), /^memory:\/\//);
  const quota = await dbClient.execute("SELECT upload_count FROM tokenless_public_media_daily_quotas");
  assert.equal(Number(quota.rows[0]?.upload_count), 1);
});

test("image staging rejects spoofed bytes, oversized bodies, and non-members without leaving objects", async () => {
  await assert.rejects(
    async () =>
      stagePublicQuestionImage({
        accountAddress: OWNER,
        bytes: new TextEncoder().encode("not really a png"),
        clientRequestId: "upload:test:bad1",
        filename: "spoof.png",
        workspaceId,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_public_media_image",
  );
  await assert.rejects(
    async () =>
      stagePublicQuestionImage({
        accountAddress: OWNER,
        bytes: new Uint8Array(PUBLIC_QUESTION_IMAGE_MAX_BYTES + 1),
        clientRequestId: "upload:test:bad2",
        filename: "huge.png",
        workspaceId,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_public_media_size",
  );
  await assert.rejects(
    async () =>
      stagePublicQuestionImage({
        accountAddress: OUTSIDER,
        bytes: await png(),
        clientRequestId: "upload:test:bad3",
        filename: "outsider.png",
        workspaceId,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_not_found",
  );
  assert.equal(store.objects.size, 0);
});

test("daily quota is atomic and deleting an unbound staged image removes its private object", async () => {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_public_media_daily_quotas
          (workspace_id, owner_account_address, day_key, upload_count, upload_bytes, updated_at)
          VALUES (?, ?, '2026-07-14', 20, 1, ?)`,
    args: [workspaceId, OWNER, new Date("2026-07-14T11:00:00.000Z")],
  });
  await assert.rejects(
    async () =>
      stagePublicQuestionImage({
        accountAddress: OWNER,
        bytes: await png(),
        clientRequestId: "upload:test:quota",
        filename: "quota.png",
        now: new Date("2026-07-14T11:00:00.000Z"),
        workspaceId,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "public_media_quota_exceeded",
  );
  assert.equal(store.objects.size, 0);

  await dbClient.execute("DELETE FROM tokenless_public_media_daily_quotas");
  await stagePublicQuestionImage({
    accountAddress: OWNER,
    bytes: await png(),
    clientRequestId: "upload:test:delete",
    filename: "delete.png",
    now: new Date("2026-07-14T12:00:00.000Z"),
    workspaceId,
  });
  assert.equal(store.objects.size, 1);
  assert.deepEqual(await deleteStagedPublicQuestionImage({ accountAddress: OWNER, assetId: ASSET_ID, workspaceId }), {
    deleted: true,
  });
  assert.equal(store.objects.size, 0);
});

test("ask preparation binds exact owner assets and public reads stay closed until moderation approval", async () => {
  const staged = await stagePublicQuestionImage({
    accountAddress: OWNER,
    bytes: await png(),
    clientRequestId: "upload:test:binding",
    filename: "binding.png",
    now: new Date("2026-07-14T12:00:00.000Z"),
    workspaceId,
  });
  const quote = await createTokenlessQuote({
    audience: { admissionPolicyHash: `0x${"ab".repeat(32)}`, source: "customer_invited" },
    budget: { attemptReserveAtomic: "5000000", bountyAtomic: "25000000", feeBps: 750 },
    confirmedNoSensitiveData: true,
    dataClassification: "synthetic",
    question: {
      kind: "binary",
      media: {
        kind: "images",
        items: [{ alt: "Synthetic test image", assetId: staged.assetId, digest: staged.digest }],
      },
      prompt: "Should this image be published?",
      rationale: { mode: "optional" },
    },
    requestedPanelSize: 15,
    visibility: "public",
  });
  await recordPrepaidLedgerEntry({
    amountAtomic: quote.economics.totalFundedAtomic,
    source: "media-test",
    workspaceId,
  });
  const prepared = await prepareProductAsk({
    principal: { accountAddress: OWNER, kind: "session" },
    request: {
      idempotencyKey: "media:test:binding",
      payment: { mode: "prepaid", workspaceId },
      quoteId: quote.quoteId,
    },
  });

  const bound = await dbClient.execute({
    sql: "SELECT question_id FROM tokenless_public_question_media WHERE asset_id = ?",
    args: [staged.assetId],
  });
  assert.equal(bound.rows[0]?.question_id, prepared.questionId);
  assert.equal((await readPublicQuestionImage({ accountAddress: OWNER, assetId: staged.assetId })).public, false);
  await assert.rejects(
    () => readPublicQuestionImage({ assetId: staged.assetId }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "public_media_not_found",
  );

  await dbClient.execute({
    sql: "UPDATE tokenless_content_records SET moderation_status = 'approved' WHERE content_id = (SELECT content_id FROM tokenless_question_records WHERE question_id = ?)",
    args: [prepared.questionId],
  });
  await dbClient.execute({
    sql: "UPDATE tokenless_question_records SET moderation_status = 'approved' WHERE question_id = ?",
    args: [prepared.questionId],
  });
  await dbClient.execute({
    sql: "UPDATE tokenless_public_question_media SET moderation_status = 'approved' WHERE asset_id = ?",
    args: [staged.assetId],
  });
  assert.equal((await readPublicQuestionImage({ assetId: staged.assetId })).public, true);
});

test("workspace API keys stage and bind the same canonical descriptor without public upload tools", async () => {
  const key = await createWorkspaceApiKey({ name: "Media agent", workspaceId });
  const staged = await stagePublicQuestionImage({
    apiKeyId: key.apiKeyId,
    bytes: await png(),
    clientRequestId: "upload:agent:binding",
    filename: "agent.png",
    workspaceId,
  });
  const quote = await createTokenlessQuote({
    audience: { admissionPolicyHash: `0x${"ab".repeat(32)}`, source: "customer_invited" },
    budget: { attemptReserveAtomic: "5000000", bountyAtomic: "25000000", feeBps: 750 },
    question: {
      kind: "binary",
      media: {
        kind: "images",
        items: [{ alt: "Agent supplied context", assetId: staged.assetId, digest: staged.digest }],
      },
      prompt: "Should this agent-supplied image ship?",
      rationale: { mode: "optional" },
    },
    requestedPanelSize: 15,
  });
  await recordPrepaidLedgerEntry({
    amountAtomic: quote.economics.totalFundedAtomic,
    source: "agent-media-test",
    workspaceId,
  });
  const prepared = await prepareProductAsk({
    principal: { apiKeyId: key.apiKeyId, kind: "api_key", role: "member", workspaceId },
    request: {
      idempotencyKey: "media:agent:binding",
      payment: { mode: "prepaid", workspaceId },
      quoteId: quote.quoteId,
    },
  });
  const bound = await dbClient.execute({
    sql: "SELECT owner_account_address, question_id FROM tokenless_public_question_media WHERE asset_id = ?",
    args: [staged.assetId],
  });
  assert.deepEqual(bound.rows, [
    { owner_account_address: `api_key:${key.apiKeyId}`, question_id: prepared.questionId },
  ]);
});
