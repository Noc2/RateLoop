import { NextRequest } from "next/server";
import { POST } from "./route";
import { ContentRegistryAbi } from "@rateloop/contracts/abis";
import { getSharedDeploymentAddress } from "@rateloop/contracts/deployments";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { type Address, type Hex, encodeAbiParameters, encodeEventTopics } from "viem";
import { setDetailsAttachRouteTestOverrides } from "~~/lib/attachments/detailsAttachRouteTestOverrides";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testMemory";
import { resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";
import { ponderApi } from "~~/services/ponder/client";
import { __setRateLimitStoreForTests } from "~~/utils/rateLimit";

const CHAIN_ID = 31337;
const SUBMITTER = "0x00000000000000000000000000000000000000aa" as const;
const TRANSACTION_HASH = `0x${"a".repeat(64)}` as const;
const MEDIA_VALIDATOR = "0x00000000000000000000000000000000000000bb" as const;

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("https://rateloop.ai/api/attachments/details/attach", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function buildContentSubmittedLog(params: {
  address: Address;
  contentHash?: Hex;
  contentId: bigint;
  submitter: Address;
}) {
  return {
    address: params.address,
    data: encodeAbiParameters(
      [
        { name: "contentHash", type: "bytes32" },
        { name: "url", type: "string" },
        { name: "title", type: "string" },
        { name: "tags", type: "string" },
      ],
      [params.contentHash ?? `0x${"1".repeat(64)}`, "", "Question", "agents"],
    ),
    topics: encodeEventTopics({
      abi: ContentRegistryAbi,
      eventName: "ContentSubmitted",
      args: {
        categoryId: 5n,
        contentId: params.contentId,
        submitter: params.submitter,
      },
    }).filter((topic): topic is Hex => !!topic),
  };
}

function buildQuestionContentAnchoredLog(params: {
  address: Address;
  contentId: bigint;
  mediaType?: number;
  questionMetadataHash: Hex;
  resultSpecHash: Hex;
}) {
  return {
    address: params.address,
    data: encodeAbiParameters(
      [
        { name: "mediaIndex", type: "uint256" },
        { name: "url", type: "string" },
        { name: "questionMetadataHash", type: "bytes32" },
        { name: "resultSpecHash", type: "bytes32" },
      ],
      [0n, "", params.questionMetadataHash, params.resultSpecHash],
    ),
    topics: encodeEventTopics({
      abi: ContentRegistryAbi,
      eventName: "QuestionContentAnchored",
      args: {
        contentId: params.contentId,
        mediaType: params.mediaType ?? 0,
      },
    }).filter((topic): topic is Hex => !!topic),
  };
}

function installReceipt(logs: unknown[]) {
  setDetailsAttachRouteTestOverrides({
    createPublicClient: () =>
      ({
        getTransactionReceipt: async () => ({
          logs,
          status: "success",
          transactionHash: TRANSACTION_HASH,
        }),
        readContract: async () => MEDIA_VALIDATOR,
      }) as never,
  });
}

async function insertDetails(params: { detailsHash: Hex; detailsId: string; gated: boolean }) {
  const now = new Date();
  await dbClient.execute({
    sql: `
      INSERT INTO question_details (
        id,
        uploader_kind,
        owner_wallet_address,
        agent_id,
        size_bytes,
        sha256,
        normalized_text,
        status,
        moderation_status,
        requires_gated_access,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      params.detailsId,
      "wallet",
      SUBMITTER,
      null,
      18,
      params.detailsHash.slice(2),
      "Expanded details",
      "approved",
      "approved",
      params.gated,
      now,
      now,
    ],
  });
}

async function insertImage(params: { imageId: string; sha256: string }) {
  const now = new Date();
  await dbClient.execute({
    sql: `
      INSERT INTO question_image_attachments (
        id,
        uploader_kind,
        owner_wallet_address,
        agent_id,
        original_filename,
        mime_type,
        size_bytes,
        sha256,
        status,
        moderation_status,
        requires_gated_access,
        created_at,
        updated_at,
        approved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      params.imageId,
      "wallet",
      SUBMITTER,
      null,
      "mockup.webp",
      "image/webp",
      128,
      params.sha256,
      "approved",
      "approved",
      true,
      now,
      now,
      now,
    ],
  });
}

beforeEach(() => {
  const resources = createMemoryDatabaseResources();
  __setDatabaseResourcesForTests(resources);
  __setRateLimitStoreForTests(resources.client);
});

afterEach(() => {
  setDetailsAttachRouteTestOverrides(null);
  __setRateLimitStoreForTests(null);
  __setDatabaseResourcesForTests(null);
});

test("attaches gated details and images with content submission proof", async () => {
  const contentRegistryAddress = getSharedDeploymentAddress(CHAIN_ID, "ContentRegistry");
  assert.ok(contentRegistryAddress);
  installReceipt([
    buildContentSubmittedLog({
      address: contentRegistryAddress,
      contentId: 123n,
      submitter: SUBMITTER,
    }),
  ]);

  const detailsId = "det_routegatedattach01";
  const detailsHash = `0x${"6".repeat(64)}` as const;
  const detailsUrl = `https://www.rateloop.ai/api/attachments/details/${detailsId}`;
  const imageId = "att_routegatedattach01";
  const imageSha256 = "b".repeat(64);
  const imageUrl = `https://www.rateloop.ai/api/attachments/images/${imageId}.webp#sha256=0x${imageSha256}`;
  await insertDetails({ detailsHash, detailsId, gated: true });
  await insertImage({ imageId, sha256: imageSha256 });

  const response = await POST(
    makeRequest({
      chainId: CHAIN_ID,
      details: [{ contentId: "123", detailsHash, detailsUrl }],
      images: [{ contentId: "123", imageUrls: [imageUrl] }],
      transactionHashes: [TRANSACTION_HASH],
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.attached, 1);
  assert.equal(body.imagesAttached, 1);

  const details = await dbClient.execute({
    sql: "SELECT content_id FROM question_details WHERE id = ?",
    args: [detailsId],
  });
  assert.equal(details.rows[0]?.content_id, "123");
  const image = await dbClient.execute({
    sql: "SELECT content_id FROM question_image_attachments WHERE id = ?",
    args: [imageId],
  });
  assert.equal(image.rows[0]?.content_id, "123");

  installReceipt([
    buildContentSubmittedLog({
      address: contentRegistryAddress,
      contentId: 124n,
      submitter: SUBMITTER,
    }),
  ]);

  const relinkResponse = await POST(
    makeRequest({
      chainId: CHAIN_ID,
      details: [{ contentId: "124", detailsHash, detailsUrl }],
      transactionHashes: [TRANSACTION_HASH],
    }),
  );
  const relinkBody = await relinkResponse.json();

  assert.equal(relinkResponse.status, 200);
  assert.equal(relinkBody.attached, 0);
  const relinkedDetails = await dbClient.execute({
    sql: "SELECT content_id FROM question_details WHERE id = ?",
    args: [detailsId],
  });
  assert.equal(relinkedDetails.rows[0]?.content_id, "123");
});

test("syncs verified question metadata with the protocol deployment key", async () => {
  const contentRegistryAddress = getSharedDeploymentAddress(CHAIN_ID, "ContentRegistry");
  const protocolDeployment = resolveProtocolDeploymentScope(CHAIN_ID);
  assert.ok(contentRegistryAddress);
  assert.ok(protocolDeployment);

  const questionMetadataHash = `0x${"8".repeat(64)}` as const;
  const resultSpecHash = `0x${"9".repeat(64)}` as const;
  installReceipt([
    buildContentSubmittedLog({
      address: contentRegistryAddress,
      contentId: 123n,
      submitter: SUBMITTER,
    }),
    buildQuestionContentAnchoredLog({
      address: MEDIA_VALIDATOR,
      contentId: 123n,
      questionMetadataHash,
      resultSpecHash,
    }),
  ]);

  const originalSyncQuestionMetadata = ponderApi.syncQuestionMetadata;
  const syncCalls: Parameters<typeof ponderApi.syncQuestionMetadata>[] = [];
  ponderApi.syncQuestionMetadata = async (...args) => {
    syncCalls.push(args);
    return { errors: [], requested: 1, skipped: 0, updated: 1 };
  };

  try {
    const response = await POST(
      makeRequest({
        chainId: CHAIN_ID,
        metadata: [
          {
            contentId: "123",
            questionMetadata: null,
            questionMetadataHash,
            resultSpecHash,
            targetAudience: null,
          },
        ],
        transactionHashes: [TRANSACTION_HASH],
      }),
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.metadataIndexed, 1);
  } finally {
    ponderApi.syncQuestionMetadata = originalSyncQuestionMetadata;
  }

  assert.equal(syncCalls.length, 1);
  assert.equal(syncCalls[0]?.[1]?.deploymentKey, protocolDeployment.deploymentKey);
});

test("does not attach public details from content submission proof alone", async () => {
  const contentRegistryAddress = getSharedDeploymentAddress(CHAIN_ID, "ContentRegistry");
  assert.ok(contentRegistryAddress);
  installReceipt([
    buildContentSubmittedLog({
      address: contentRegistryAddress,
      contentId: 123n,
      submitter: SUBMITTER,
    }),
  ]);

  const detailsId = "det_routepublicattach";
  const detailsHash = `0x${"7".repeat(64)}` as const;
  const detailsUrl = `https://www.rateloop.ai/api/attachments/details/${detailsId}`;
  await insertDetails({ detailsHash, detailsId, gated: false });

  const response = await POST(
    makeRequest({
      chainId: CHAIN_ID,
      details: [{ contentId: "123", detailsHash, detailsUrl }],
      transactionHashes: [TRANSACTION_HASH],
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.attached, 0);
  const details = await dbClient.execute({
    sql: "SELECT content_id FROM question_details WHERE id = ?",
    args: [detailsId],
  });
  assert.equal(details.rows[0]?.content_id, null);
});
