import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import sharp from "sharp";
import { POST as submitAsk } from "~~/app/api/agent/v1/asks/route";
import { POST as uploadImage } from "~~/app/api/agent/v1/media/images/route";
import { GET } from "~~/app/api/public-media/images/[assetId]/route";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import { createWorkspace, createWorkspaceApiKey, recordPrepaidLedgerEntry } from "~~/lib/tokenless/productCore";
import {
  type PublicQuestionMediaStore,
  __setPublicQuestionMediaRuntimeForTests,
} from "~~/lib/tokenless/publicQuestionMedia";
import {
  __setPublicQuestionMediaPreviewKeyForTests,
  issuePublicQuestionMediaPreviewCapability,
} from "~~/lib/tokenless/publicQuestionMediaPreview";
import { createTokenlessQuote } from "~~/lib/tokenless/server";

const ORIGIN = "https://tokenless.example.test";
const ASSET_ID = `pqm_${"R".repeat(32)}`;
const SECOND_ASSET_ID = `pqm_${"S".repeat(32)}`;

function audiencePolicy() {
  return {
    schemaVersion: "rateloop.human-assurance.v2" as const,
    policyId: "policy_public_media_route_test",
    version: 1,
    reviewerSource: "customer_invited" as const,
    compensation: "paid" as const,
    cohorts: [{ cohortId: "media-route-test", minimumReviewers: 3, maximumReviewers: 500 }],
    selection: "customer_named" as const,
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: [],
    assurance: {
      requirements: [
        {
          capability: "customer_invitation" as const,
          reviewerSources: ["customer_invited" as const],
          allowedProviders: ["workspace-invitation"],
        },
      ],
    },
    buyerPrivacy: { visibleFields: ["reviewer_source" as const], minimumAggregationSize: 3, suppressSmallCells: true },
    legalEligibilityRequired: true,
  };
}

class MemoryMediaStore implements PublicQuestionMediaStore {
  readonly objects = new Map<string, Uint8Array>();

  async delete(reference: string) {
    this.objects.delete(reference);
  }

  async get(reference: string) {
    const bytes = this.objects.get(reference);
    if (!bytes) throw new Error("missing image");
    return new Uint8Array(bytes);
  }

  async put(pathname: string, body: Uint8Array) {
    const reference = `memory://${pathname}`;
    this.objects.set(reference, new Uint8Array(body));
    return reference;
  }
}

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  let assetIndex = 0;
  __setPublicQuestionMediaRuntimeForTests({
    randomAssetId: () => [ASSET_ID, SECOND_ASSET_ID][assetIndex++]!,
    store: new MemoryMediaStore(),
  });
  __setPublicQuestionMediaPreviewKeyForTests(new Uint8Array(32).fill(43));
});

afterEach(() => {
  __setPublicQuestionMediaPreviewKeyForTests(null);
  __setPublicQuestionMediaRuntimeForTests(null);
  __setDatabaseResourcesForTests(null);
});

async function browser(label: string) {
  const identity = await resolveBetterAuthPrincipal({
    betterAuthUserId: `better_media_preview_${label}`,
    method: "passkey",
  });
  const session = await createAuthSession(identity);
  return { principalId: identity.principalId, token: session.token };
}

function imageRequest(url: string, token: string) {
  return new NextRequest(url, { headers: { cookie: `${AUTH_SESSION_COOKIE}=${token}` } });
}

function previewGrant(descriptor: { assetId: string; digest: string; previewCapability: string }) {
  return {
    assetId: descriptor.assetId,
    digest: descriptor.digest,
    previewCapability: descriptor.previewCapability,
  };
}

function submitRequest(input: {
  idempotencyKey: string;
  mediaPreviews: Array<{ assetId: string; digest: string; previewCapability: string }>;
  quoteId: string;
  token: string;
  workspaceId: string;
}) {
  return submitAsk(
    new NextRequest(`${ORIGIN}/api/agent/v1/asks`, {
      body: JSON.stringify({
        idempotencyKey: input.idempotencyKey,
        mediaPreviews: input.mediaPreviews,
        payment: { mode: "prepaid", workspaceId: input.workspaceId },
        quoteId: input.quoteId,
      }),
      headers: {
        "content-type": "application/json",
        cookie: `${AUTH_SESSION_COOKIE}=${input.token}`,
        "idempotency-key": input.idempotencyKey,
      },
      method: "POST",
    }),
  );
}

test("an API-key upload remains private but its exact grant lets a different browser principal preview it", async () => {
  const owner = await browser("owner");
  const member = await browser("member");
  const outsider = await browser("outsider");
  const { workspaceId } = await createWorkspace({ name: "Cross-principal preview", ownerAddress: owner.principalId });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
          VALUES (?, ?, 'member', ?)`,
    args: [workspaceId, member.principalId, new Date()],
  });
  const apiKey = await createWorkspaceApiKey({ name: "Image staging agent", workspaceId });
  const bytes = await sharp({
    create: { background: "#14213d", channels: 4, height: 32, width: 48 },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.set("clientRequestId", "route:media:preview:1");
  form.set("file", new File([bytes], "candidate.png", { type: "image/png" }));
  const uploaded = await uploadImage(
    new NextRequest(`${ORIGIN}/api/agent/v1/media/images`, {
      body: form,
      headers: { authorization: `Bearer ${apiKey.token}` },
      method: "POST",
    }),
  );
  assert.equal(uploaded.status, 201);
  const descriptor = (await uploaded.json()) as {
    assetId: string;
    digest: string;
    previewCapability: string;
    previewUrl: string;
  };
  const context = { params: Promise.resolve({ assetId: descriptor.assetId }) };
  const baseUrl = `${ORIGIN}/api/public-media/images/${descriptor.assetId}`;

  const ownerWithoutGrant = await GET(imageRequest(baseUrl, owner.token), context);
  assert.equal(ownerWithoutGrant.status, 404);

  const outsiderWithGrant = await GET(imageRequest(`${ORIGIN}${descriptor.previewUrl}`, outsider.token), context);
  assert.equal(outsiderWithGrant.status, 404);

  // Members are deliberately included because the paid-ask path grants owner/admin/member
  // principals the same ask-submission and prepaid-funding authority.
  const memberWithGrant = await GET(imageRequest(`${ORIGIN}${descriptor.previewUrl}`, member.token), context);
  assert.equal(memberWithGrant.status, 200);
  assert.equal(memberWithGrant.headers.get("cache-control"), "private, no-store");
  assert.equal(memberWithGrant.headers.get("content-type"), "image/webp");
  assert.equal(memberWithGrant.headers.get("referrer-policy"), "no-referrer");
  assert.ok((await memberWithGrant.arrayBuffer()).byteLength > 0);

  const tamperedUrl = new URL(descriptor.previewUrl, ORIGIN);
  tamperedUrl.searchParams.set("digest", `sha256:${"ff".repeat(32)}`);
  const tampered = await GET(imageRequest(tamperedUrl.toString(), owner.token), context);
  assert.equal(tampered.status, 404);

  await dbClient.execute({
    sql: "UPDATE tokenless_workspaces SET status = 'deleted', updated_at = ? WHERE workspace_id = ?",
    args: [new Date(), workspaceId],
  });
  const deactivated = await GET(imageRequest(`${ORIGIN}${descriptor.previewUrl}`, member.token), context);
  assert.equal(deactivated.status, 404);
  await dbClient.execute({
    sql: "UPDATE tokenless_workspaces SET status = 'active', updated_at = ? WHERE workspace_id = ?",
    args: [new Date(), workspaceId],
  });

  const now = new Date();
  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_subscriptions
          SET plan_key = 'early_access', price_version = 'early_access_usd_99_2026_07',
              provider_status = 'active', current_period_start = ?, current_period_end = ?, updated_at = ?
          WHERE workspace_id = ?`,
    args: [new Date(now.getTime() - 60_000), new Date(now.getTime() + 86_400_000), now, workspaceId],
  });
  const policy = audiencePolicy();
  const quoteRequest = {
    audience: { admissionPolicyHash: freezeAdmissionPolicy(policy).admissionPolicyHash, source: "customer_invited" },
    audiencePolicy: policy,
    budget: { attemptReserveAtomic: "5000000", bountyAtomic: "25000000", feeBps: 750 },
    confirmedNoSensitiveData: true,
    dataClassification: "synthetic",
    question: {
      kind: "binary",
      media: {
        kind: "images",
        items: [{ alt: "API-key staged candidate", assetId: descriptor.assetId, digest: descriptor.digest }],
      },
      prompt: "Should this staged candidate ship?",
      rationale: { mode: "optional" },
    },
    requestedPanelSize: 15,
    responseWindowSeconds: 1_200,
    visibility: "public",
  } as const;
  const quote = await createTokenlessQuote(quoteRequest);
  await recordPrepaidLedgerEntry({
    amountAtomic: (BigInt(quote.economics.totalFundedAtomic) * 5n).toString(),
    source: "cross-principal-media-route-test",
    workspaceId,
  });
  await dbClient.execute({
    sql: "UPDATE tokenless_workspaces SET status = 'deleted', updated_at = ? WHERE workspace_id = ?",
    args: [new Date(), workspaceId],
  });
  assert.equal(
    (
      await submitRequest({
        idempotencyKey: "route:media:deactivated:1",
        mediaPreviews: [previewGrant(descriptor)],
        quoteId: quote.quoteId,
        token: member.token,
        workspaceId,
      })
    ).status,
    403,
  );
  await dbClient.execute({
    sql: "UPDATE tokenless_workspaces SET status = 'active', updated_at = ? WHERE workspace_id = ?",
    args: [new Date(), workspaceId],
  });
  assert.equal(
    (
      await submitRequest({
        idempotencyKey: "route:media:outsider:1",
        mediaPreviews: [previewGrant(descriptor)],
        quoteId: quote.quoteId,
        token: outsider.token,
        workspaceId,
      })
    ).status,
    403,
  );
  const tamperedCapability = `${descriptor.previewCapability.slice(0, -1)}${
    descriptor.previewCapability.endsWith("A") ? "B" : "A"
  }`;
  assert.equal(
    (
      await submitRequest({
        idempotencyKey: "route:media:tampered:1",
        mediaPreviews: [{ ...previewGrant(descriptor), previewCapability: tamperedCapability }],
        quoteId: quote.quoteId,
        token: member.token,
        workspaceId,
      })
    ).status,
    409,
  );
  const expiredCapability = issuePublicQuestionMediaPreviewCapability({
    assetId: descriptor.assetId,
    digest: descriptor.digest,
    expiresAt: new Date(Date.now() - 1_000),
  });
  assert.equal(
    (
      await submitRequest({
        idempotencyKey: "route:media:expired:1",
        mediaPreviews: [{ ...previewGrant(descriptor), previewCapability: expiredCapability }],
        quoteId: quote.quoteId,
        token: member.token,
        workspaceId,
      })
    ).status,
    409,
  );
  const stillStaged = await dbClient.execute({
    sql: "SELECT owner_account_address, question_id FROM tokenless_public_question_media WHERE asset_id = ?",
    args: [descriptor.assetId],
  });
  assert.equal(stillStaged.rows[0]?.owner_account_address, `api_key:${apiKey.apiKeyId}`);
  assert.equal(stillStaged.rows[0]?.question_id, null);

  const idempotencyKey = "route:media:preview:submit:1";
  const submitted = await submitRequest({
    idempotencyKey,
    mediaPreviews: [previewGrant(descriptor)],
    quoteId: quote.quoteId,
    token: member.token,
    workspaceId,
  });
  assert.equal(submitted.status, 200);
  const bound = await dbClient.execute({
    sql: "SELECT owner_account_address, question_id FROM tokenless_public_question_media WHERE asset_id = ?",
    args: [descriptor.assetId],
  });
  assert.equal(bound.rows[0]?.owner_account_address, member.principalId);
  assert.match(String(bound.rows[0]?.question_id), /^qst_/u);
  const storedAsk = await dbClient.execute({
    sql: "SELECT request_json FROM tokenless_agent_asks WHERE idempotency_key = ?",
    args: [idempotencyKey],
  });
  assert.doesNotMatch(String(storedAsk.rows[0]?.request_json), /pqp1_/u);

  const replay = await submitRequest({
    idempotencyKey,
    mediaPreviews: [previewGrant(descriptor)],
    quoteId: quote.quoteId,
    token: member.token,
    workspaceId,
  });
  assert.equal(replay.status, 200);

  const secondForm = new FormData();
  secondForm.set("clientRequestId", "route:media:preview:2");
  secondForm.set("file", new File([bytes], "conflicting.png", { type: "image/png" }));
  const secondUpload = await uploadImage(
    new NextRequest(`${ORIGIN}/api/agent/v1/media/images`, {
      body: secondForm,
      headers: { authorization: `Bearer ${apiKey.token}` },
      method: "POST",
    }),
  );
  assert.equal(secondUpload.status, 201);
  const secondDescriptor = (await secondUpload.json()) as typeof descriptor;
  const conflictingQuote = await createTokenlessQuote({
    ...quoteRequest,
    question: {
      ...quoteRequest.question,
      media: {
        kind: "images",
        items: [
          {
            alt: "Conflicting staged candidate",
            assetId: secondDescriptor.assetId,
            digest: secondDescriptor.digest,
          },
        ],
      },
    },
  });
  const conflict = await submitRequest({
    idempotencyKey,
    mediaPreviews: [previewGrant(secondDescriptor)],
    quoteId: conflictingQuote.quoteId,
    token: member.token,
    workspaceId,
  });
  assert.equal(conflict.status, 409);
  const untouchedConflict = await dbClient.execute({
    sql: "SELECT owner_account_address, question_id FROM tokenless_public_question_media WHERE asset_id = ?",
    args: [secondDescriptor.assetId],
  });
  assert.equal(untouchedConflict.rows[0]?.owner_account_address, `api_key:${apiKey.apiKeyId}`);
  assert.equal(untouchedConflict.rows[0]?.question_id, null);
});
