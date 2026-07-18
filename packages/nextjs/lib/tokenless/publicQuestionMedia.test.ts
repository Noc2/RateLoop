import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import sharp from "sharp";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  attachProductAsk,
  createWorkspace,
  createWorkspaceApiKey,
  prepareProductAsk,
  recordPrepaidLedgerEntry,
  releasePreparedProductAsk,
} from "~~/lib/tokenless/productCore";
import {
  PUBLIC_QUESTION_IMAGE_MAX_BYTES,
  type PublicQuestionMediaStore,
  __setPublicQuestionMediaRuntimeForTests,
  deleteStagedPublicQuestionImage,
  readPublicQuestionImage,
  stagePublicQuestionImage,
  sweepExpiredPublicQuestionMedia,
} from "~~/lib/tokenless/publicQuestionMedia";
import { __setPublicQuestionMediaPreviewKeyForTests } from "~~/lib/tokenless/publicQuestionMediaPreview";
import { TokenlessServiceError, createTokenlessAsk, createTokenlessQuote } from "~~/lib/tokenless/server";

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
  __setPublicQuestionMediaPreviewKeyForTests(new Uint8Array(32).fill(42));
  workspaceId = (await createWorkspace({ name: "Media workspace", ownerAddress: OWNER })).workspaceId;
  const now = new Date();
  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_subscriptions
          SET plan_key = 'early_access', price_version = 'early_access_usd_99_2026_07',
              provider_status = 'active', current_period_start = ?, current_period_end = ?, updated_at = ?
          WHERE workspace_id = ?`,
    args: [new Date(now.getTime() - 60_000), new Date(now.getTime() + 86_400_000), now, workspaceId],
  });
});

afterEach(() => {
  __setPublicQuestionMediaPreviewKeyForTests(null);
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
  assert.match(first.previewCapability, /^pqp1_[0-9a-z]{6,12}_[A-Za-z0-9_-]{43}$/);
  assert.equal(first.previewExpiresAt, "2026-07-15T10:00:00.000Z");
  assert.match(first.previewUrl, new RegExp(`${ASSET_ID}\\?`));
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

test("expired unbound previews fail closed and the bounded sweep deletes their private objects", async () => {
  await stagePublicQuestionImage({
    accountAddress: OWNER,
    bytes: await png(),
    clientRequestId: "upload:test:expiry",
    filename: "expiry.png",
    now: new Date("2026-07-14T12:00:00.000Z"),
    workspaceId,
  });
  await assert.rejects(
    () =>
      readPublicQuestionImage({
        accountAddress: OWNER,
        assetId: ASSET_ID,
        now: new Date("2026-07-15T12:00:01.000Z"),
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "public_media_not_found",
  );
  assert.deepEqual(await sweepExpiredPublicQuestionMedia({ limit: 10, now: new Date("2026-07-15T12:00:01.000Z") }), {
    deleted: 1,
    failed: [],
  });
  assert.equal(store.objects.size, 0);
  const rows = await dbClient.execute("SELECT technical_status FROM tokenless_public_question_media");
  assert.equal(rows.rows[0]?.technical_status, "deleted");
});

test("expired upload idempotency never returns a dead grant before or after bounded sweeping", async () => {
  const stagedAt = new Date("2026-07-14T12:00:00.000Z");
  const staged = await stagePublicQuestionImage({
    accountAddress: OWNER,
    bytes: await png(),
    clientRequestId: "upload:test:expired-replay",
    filename: "expired-replay.png",
    now: stagedAt,
    workspaceId,
  });
  const targetExpiry = new Date(staged.previewExpiresAt);
  for (let index = 0; index < 21; index += 1) {
    const assetId = `pqm_${String(index).padStart(32, "B")}`;
    const createdAt = new Date(stagedAt.getTime() - (index + 1) * 60_000);
    await dbClient.execute({
      sql: `INSERT INTO tokenless_public_question_media
            (asset_id, workspace_id, owner_account_address, client_request_id, digest, storage_ref,
             content_type, original_filename, size_bytes, width, height, technical_status,
             moderation_status, expires_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'image/webp', 'old.webp', 10, 1, 1, 'ready', 'pending', ?, ?, ?)`,
      args: [
        assetId,
        workspaceId,
        OWNER,
        `upload:test:old:${index}`,
        `sha256:${index.toString(16).padStart(64, "0")}`,
        `memory://old/${index}`,
        new Date(targetExpiry.getTime() - (index + 1) * 60_000),
        createdAt,
        createdAt,
      ],
    });
  }
  const retryAt = new Date(targetExpiry.getTime() + 1_000);
  assert.equal((await sweepExpiredPublicQuestionMedia({ limit: 20, now: retryAt })).deleted, 20);
  const stillReady = await dbClient.execute({
    sql: "SELECT technical_status FROM tokenless_public_question_media WHERE asset_id = ?",
    args: [staged.assetId],
  });
  assert.equal(stillReady.rows[0]?.technical_status, "ready");
  const retry = () =>
    stagePublicQuestionImage({
      accountAddress: OWNER,
      bytes: new Uint8Array([1]),
      clientRequestId: "upload:test:expired-replay",
      filename: "expired-replay.png",
      now: retryAt,
      workspaceId,
    });
  await assert.rejects(
    retry,
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "public_media_idempotency_expired",
  );
  await sweepExpiredPublicQuestionMedia({ limit: 100, now: retryAt });
  await assert.rejects(
    retry,
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "public_media_idempotency_expired",
  );
});

test("ask preparation binds exact owner assets and public reads stay closed until moderation approval", async () => {
  const now = new Date();
  const staged = await stagePublicQuestionImage({
    accountAddress: OWNER,
    bytes: await png(),
    clientRequestId: "upload:test:binding",
    filename: "binding.png",
    now,
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
    responseWindowSeconds: 1_200,
    visibility: "public",
  });
  await recordPrepaidLedgerEntry({
    amountAtomic: quote.economics.totalFundedAtomic,
    source: "media-test",
    workspaceId,
  });
  const request = {
    idempotencyKey: "media:test:binding",
    payment: { mode: "prepaid" as const, workspaceId },
    quoteId: quote.quoteId,
  };
  const prepared = await prepareProductAsk({
    principal: { accountAddress: OWNER, kind: "session" },
    request,
  });
  const ask = await createTokenlessAsk(request, request.idempotencyKey, "https://tokenless.example");
  await attachProductAsk(prepared, ask);

  const bound = await dbClient.execute({
    sql: "SELECT question_id FROM tokenless_public_question_media WHERE asset_id = ?",
    args: [staged.assetId],
  });
  assert.equal(bound.rows[0]?.question_id, prepared.questionId);
  assert.equal(
    (
      await readPublicQuestionImage({
        accountAddress: OWNER,
        assetId: staged.assetId,
        now: new Date(now.getTime() + 1_000),
      })
    ).public,
    false,
  );
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
  const publicImage = await readPublicQuestionImage({ assetId: staged.assetId });
  assert.equal(publicImage.public, true);
  assert.equal(publicImage.digest, staged.digest);
});

test("workspace API keys stage and bind the same canonical descriptor without public upload tools", async () => {
  const key = await createWorkspaceApiKey({ name: "Media agent", workspaceId });
  const now = new Date();
  const staged = await stagePublicQuestionImage({
    apiKeyId: key.apiKeyId,
    bytes: await png(),
    clientRequestId: "upload:agent:binding",
    filename: "agent.png",
    now,
    workspaceId,
  });
  await assert.rejects(
    () => readPublicQuestionImage({ accountAddress: OWNER, assetId: staged.assetId, now }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "public_media_not_found",
  );
  const crossPrincipalPreview = await readPublicQuestionImage({
    accountAddress: OWNER,
    assetId: staged.assetId,
    now,
    previewCapability: staged.previewCapability,
    previewDigest: staged.digest,
  });
  assert.equal(crossPrincipalPreview.public, false);
  assert.equal(crossPrincipalPreview.digest, staged.digest);
  await assert.rejects(
    () =>
      readPublicQuestionImage({
        accountAddress: OWNER,
        assetId: staged.assetId,
        now,
        previewCapability: staged.previewCapability,
        previewDigest: `sha256:${"ff".repeat(32)}`,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "public_media_not_found",
  );
  await assert.rejects(
    () =>
      readPublicQuestionImage({
        accountAddress: OWNER,
        assetId: staged.assetId,
        now: new Date(staged.previewExpiresAt),
        previewCapability: staged.previewCapability,
        previewDigest: staged.digest,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "public_media_not_found",
  );
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
    responseWindowSeconds: 1_200,
  });
  await recordPrepaidLedgerEntry({
    amountAtomic: quote.economics.totalFundedAtomic,
    source: "agent-media-test",
    workspaceId,
  });
  const request = {
    idempotencyKey: "media:agent:binding",
    payment: { mode: "prepaid" as const, workspaceId },
    quoteId: quote.quoteId,
  };
  const prepared = await prepareProductAsk({
    principal: { apiKeyId: key.apiKeyId, kind: "api_key", role: "member", workspaceId },
    request,
  });
  const ask = await createTokenlessAsk(request, request.idempotencyKey, "https://tokenless.example");
  await attachProductAsk(prepared, ask);
  const bound = await dbClient.execute({
    sql: "SELECT owner_account_address, question_id FROM tokenless_public_question_media WHERE asset_id = ?",
    args: [staged.assetId],
  });
  assert.deepEqual(bound.rows, [
    { owner_account_address: `api_key:${key.apiKeyId}`, question_id: prepared.questionId },
  ]);
});

test("a downstream attach failure rolls back the capability bridge and permits an exact safe retry", async () => {
  const key = await createWorkspaceApiKey({ name: "Rollback media agent", workspaceId });
  const staged = await stagePublicQuestionImage({
    apiKeyId: key.apiKeyId,
    bytes: await png(),
    clientRequestId: "upload:agent:rollback",
    filename: "rollback.png",
    now: new Date(),
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
        items: [{ alt: "Rollback candidate", assetId: staged.assetId, digest: staged.digest }],
      },
      prompt: "Should the rollback candidate ship?",
      rationale: { mode: "optional" },
    },
    requestedPanelSize: 15,
    responseWindowSeconds: 1_200,
    visibility: "public",
  });
  await recordPrepaidLedgerEntry({
    amountAtomic: quote.economics.totalFundedAtomic,
    source: "media-rollback-test",
    workspaceId,
  });
  const request = {
    idempotencyKey: "media:agent:rollback",
    payment: { mode: "prepaid" as const, workspaceId },
    quoteId: quote.quoteId,
  };
  const mediaPreviews = [
    { assetId: staged.assetId, digest: staged.digest, previewCapability: staged.previewCapability },
  ];
  const prepared = await prepareProductAsk({
    mediaPreviews,
    principal: { accountAddress: OWNER, kind: "session" },
    request,
  });
  const ask = await createTokenlessAsk(request, request.idempotencyKey, "https://tokenless.example");
  await dbClient.execute({
    sql: "DELETE FROM tokenless_prepaid_reservations WHERE reservation_id = ?",
    args: [prepared.paymentReference],
  });
  await assert.rejects(
    () => attachProductAsk(prepared, ask),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "payment_conflict",
  );
  const rolledBack = await dbClient.execute({
    sql: "SELECT owner_account_address, question_id FROM tokenless_public_question_media WHERE asset_id = ?",
    args: [staged.assetId],
  });
  assert.deepEqual(rolledBack.rows, [{ owner_account_address: `api_key:${key.apiKeyId}`, question_id: null }]);
  assert.equal(
    Number(
      (
        await dbClient.execute({
          sql: "SELECT COUNT(*) AS count FROM tokenless_question_records WHERE question_id = ?",
          args: [prepared.questionId],
        })
      ).rows[0]?.count,
    ),
    0,
  );
  await releasePreparedProductAsk(prepared);

  const retry = await prepareProductAsk({
    mediaPreviews,
    principal: { accountAddress: OWNER, kind: "session" },
    request,
  });
  await attachProductAsk(retry, ask);
  const bound = await dbClient.execute({
    sql: "SELECT owner_account_address, question_id FROM tokenless_public_question_media WHERE asset_id = ?",
    args: [staged.assetId],
  });
  assert.deepEqual(bound.rows, [{ owner_account_address: OWNER, question_id: retry.questionId }]);
});
