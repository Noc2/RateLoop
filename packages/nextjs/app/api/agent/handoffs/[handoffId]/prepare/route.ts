import { NextRequest, NextResponse } from "next/server";
import { type Address, type Hex, isAddress } from "viem";
import {
  AgentAskHandoffError,
  assertHandoffCanPrepare,
  buildAgentAskHandoffResponse,
  buildAskBodyWithUploadedHandoffImages,
  listAgentAskHandoffAssets,
  loadAgentAskHandoffByToken,
  updateAgentAskHandoffAsset,
  updateAgentAskHandoffStatus,
} from "~~/lib/agent/handoffs";
import {
  AGENT_WRITE_RATE_LIMIT,
  handlePublicAgentRoute,
  isJsonObjectBody,
  jsonBodyErrorResponse,
  parseJsonBody,
} from "~~/lib/agent/http";
import {
  IMAGE_UPLOAD_CHALLENGE_TITLE,
  UPLOAD_IMAGE_ACTION,
  hashImageUploadChallengePayload,
  normalizeImageUploadChallengeInput,
} from "~~/lib/auth/imageUploadChallenge";
import { issueSignedActionChallenge } from "~~/lib/auth/signedActions";
import { callPublicRateLoopMcpTool } from "~~/lib/mcp/tools";

type JsonObject = Record<string, unknown>;

type ImageSignatureInput = {
  assetId: string;
  challengeId: string;
  signature: Hex;
};

const IMAGE_UPLOAD_POLL_INTERVAL_MS = 1_250;
const IMAGE_UPLOAD_POLL_TIMEOUT_MS = 45_000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function readWalletAddress(value: unknown): Address {
  if (typeof value === "string" && isAddress(value)) return value as Address;
  throw new AgentAskHandoffError("walletAddress is required and must be an EVM address.");
}

function readChainId(value: unknown): number {
  const chainId = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new AgentAskHandoffError("chainId is required and must be a positive integer.");
  }
  return chainId;
}

function resolvePrepareChainId(
  handoff: Awaited<ReturnType<typeof loadAgentAskHandoffByToken>>,
  requestedChainId: number,
) {
  if (!handoff.chainId) return requestedChainId;
  if (handoff.chainId !== requestedChainId) {
    throw new AgentAskHandoffError(
      `This handoff is for chain ${handoff.chainId}, but prepare was requested for chain ${requestedChainId}. Switch the wallet to chain ${handoff.chainId} and try again.`,
      409,
    );
  }
  return handoff.chainId;
}

function readToken(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new AgentAskHandoffError("token is required.");
}

function readImageSignatures(value: unknown): ImageSignatureInput[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new AgentAskHandoffError("imageSignatures must be an array.");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new AgentAskHandoffError(`imageSignatures[${index}] must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    const assetId = typeof record.assetId === "string" ? record.assetId.trim() : "";
    const challengeId = typeof record.challengeId === "string" ? record.challengeId.trim() : "";
    const signature = typeof record.signature === "string" ? record.signature.trim() : "";
    if (!assetId || !challengeId || !/^0x([a-fA-F0-9]{2})*$/.test(signature)) {
      throw new AgentAskHandoffError(`imageSignatures[${index}] must include assetId, challengeId, and signature.`);
    }
    return { assetId, challengeId, signature: signature as Hex };
  });
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readResultString(result: JsonObject, field: string) {
  const value = result[field];
  return typeof value === "string" ? value : "";
}

function readApprovedImageUrl(result: JsonObject) {
  const imageUrl = readResultString(result, "imageUrl");
  return readResultString(result, "status") === "approved" && imageUrl ? imageUrl : null;
}

function throwForTerminalImageUploadStatus(result: JsonObject): never | null {
  const status = readResultString(result, "status");
  const error = readResultString(result, "error");
  if (status === "blocked") {
    throw new AgentAskHandoffError(error ? `Image upload was blocked: ${error}` : "Image upload was blocked.");
  }
  if (status === "failed") {
    throw new AgentAskHandoffError(error ? `Image upload failed: ${error}` : "Image upload failed.");
  }
  if (status === "deleted") {
    throw new AgentAskHandoffError("Image upload failed because the attachment was deleted.");
  }
  return null;
}

async function waitForApprovedImageUrl(params: {
  attachmentId: string;
  initialResult: JsonObject;
  requestUrl: string;
}) {
  let result = params.initialResult;
  const startedAt = Date.now();

  while (Date.now() - startedAt < IMAGE_UPLOAD_POLL_TIMEOUT_MS) {
    const approvedImageUrl = readApprovedImageUrl(result);
    if (approvedImageUrl) return approvedImageUrl;

    throwForTerminalImageUploadStatus(result);
    await wait(IMAGE_UPLOAD_POLL_INTERVAL_MS);

    result = (await callPublicRateLoopMcpTool({
      arguments: { attachmentId: params.attachmentId },
      name: "rateloop_get_image_upload_status",
      requestUrl: params.requestUrl,
    })) as JsonObject;
  }

  throw new AgentAskHandoffError("Image moderation is still processing. Refresh and try submitting again.");
}

async function buildUploadChallenges(params: {
  assets: Awaited<ReturnType<typeof listAgentAskHandoffAssets>>;
  chainId: number;
  draftRevision: number;
  handoffId: string;
  walletAddress: Address;
}) {
  const challenges = [];
  for (const asset of params.assets.filter(asset => asset.status === "staged")) {
    const normalized = normalizeImageUploadChallengeInput({
      address: params.walletAddress,
      attachmentId: asset.attachmentId,
      filename: asset.originalFilename,
      mimeType: asset.mimeType,
      sha256: asset.sha256,
      sizeBytes: asset.sizeBytes,
    });
    if (!normalized.ok) {
      throw new AgentAskHandoffError(normalized.error);
    }
    const challenge = await issueSignedActionChallenge({
      action: UPLOAD_IMAGE_ACTION,
      payloadHash: hashImageUploadChallengePayload(normalized.payload),
      title: IMAGE_UPLOAD_CHALLENGE_TITLE,
      walletAddress: normalized.payload.normalizedAddress,
    });
    challenges.push({
      assetId: asset.id,
      attachmentId: asset.attachmentId,
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt,
      message: challenge.message,
    });
  }

  await updateAgentAskHandoffStatus({
    chainId: params.chainId,
    expectedDraftRevision: params.draftRevision,
    handoffId: params.handoffId,
    status: "awaiting_image_signatures",
    walletAddress: params.walletAddress,
  });
  return challenges;
}

async function uploadSignedImages(params: {
  assets: Awaited<ReturnType<typeof listAgentAskHandoffAssets>>;
  handoffId: string;
  imageSignatures: ImageSignatureInput[];
  requestUrl: string;
  walletAddress: Address;
}) {
  const signaturesByAssetId = new Map(params.imageSignatures.map(signature => [signature.assetId, signature]));
  const stagedAssets = params.assets.filter(asset => asset.status === "staged");
  if (stagedAssets.some(asset => !signaturesByAssetId.has(asset.id))) {
    throw new AgentAskHandoffError("Every staged image needs a wallet signature before upload.");
  }

  await updateAgentAskHandoffStatus({
    handoffId: params.handoffId,
    status: "uploading_images",
    walletAddress: params.walletAddress,
  });

  for (const asset of stagedAssets) {
    const signature = signaturesByAssetId.get(asset.id);
    if (!signature) continue;
    try {
      const result = (await callPublicRateLoopMcpTool({
        arguments: {
          attachmentId: asset.attachmentId,
          challengeId: signature.challengeId,
          filename: asset.originalFilename,
          imageBase64: asset.imageBase64,
          mimeType: asset.mimeType,
          sha256: asset.sha256,
          signature: signature.signature,
          sizeBytes: asset.sizeBytes,
          walletAddress: params.walletAddress,
        },
        name: "rateloop_upload_image",
        requestUrl: params.requestUrl,
      })) as JsonObject;
      const imageUrl = await waitForApprovedImageUrl({
        attachmentId: asset.attachmentId,
        initialResult: result,
        requestUrl: params.requestUrl,
      });
      await updateAgentAskHandoffAsset({
        assetId: asset.id,
        imageUrl,
        status: "uploaded",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateAgentAskHandoffAsset({
        assetId: asset.id,
        error: message,
        status: "failed",
      });
      await updateAgentAskHandoffStatus({
        error: message,
        handoffId: params.handoffId,
        status: "failed",
        walletAddress: params.walletAddress,
      });
      throw error;
    }
  }
}

async function prepareAsk(params: {
  chainId: number;
  handoffId: string;
  requestUrl: string;
  token: string;
  walletAddress: Address;
}) {
  const handoff = await loadAgentAskHandoffByToken({ handoffId: params.handoffId, token: params.token });
  const assets = await listAgentAskHandoffAssets(handoff.id);
  const askBody = {
    ...buildAskBodyWithUploadedHandoffImages({ assets, handoff }),
    chainId: params.chainId,
  };
  const prepared = (await callPublicRateLoopMcpTool({
    arguments: {
      ...askBody,
      paymentMode: "wallet_calls",
      walletAddress: params.walletAddress,
    },
    name: "rateloop_ask_humans",
    requestUrl: params.requestUrl,
  })) as JsonObject;
  const operationKey = typeof prepared.operationKey === "string" ? prepared.operationKey : null;
  const payloadHash = typeof prepared.payloadHash === "string" ? prepared.payloadHash : null;
  const transactionPlan =
    prepared.transactionPlan && typeof prepared.transactionPlan === "object" && !Array.isArray(prepared.transactionPlan)
      ? (prepared.transactionPlan as JsonObject)
      : null;

  await updateAgentAskHandoffStatus({
    chainId: params.chainId,
    expectedDraftRevision: handoff.draftRevision,
    handoffId: params.handoffId,
    operationKey,
    payloadHash,
    preparedDraftRevision: handoff.draftRevision,
    status: "prepared",
    transactionPlan,
    walletAddress: params.walletAddress,
  });

  const updatedHandoff = await loadAgentAskHandoffByToken({ handoffId: params.handoffId, token: params.token });
  const updatedAssets = await listAgentAskHandoffAssets(updatedHandoff.id);
  return {
    ...buildAgentAskHandoffResponse({ assets: updatedAssets, handoff: updatedHandoff, includeImageData: true }),
    ask: prepared,
    confirmUrl: `/api/agent/handoffs/${encodeURIComponent(params.handoffId)}/complete`,
    nextAction: "Execute transactionPlan.calls in the connected wallet, then confirm transaction hashes.",
  };
}

export async function POST(request: NextRequest, context: { params: Promise<{ handoffId: string }> }) {
  const { handoffId } = await context.params;

  return handlePublicAgentRoute({
    handler: async () => {
      const body = await parseJsonBody(request, { maxBytes: 16 * 1024 * 1024 });
      if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);

      const token = readToken((body as { token?: unknown }).token);
      const walletAddress = readWalletAddress((body as { walletAddress?: unknown }).walletAddress);
      const requestedChainId = readChainId((body as { chainId?: unknown }).chainId);
      const imageSignatures = readImageSignatures((body as { imageSignatures?: unknown }).imageSignatures);
      const handoff = await loadAgentAskHandoffByToken({ handoffId, token });
      const chainId = resolvePrepareChainId(handoff, requestedChainId);
      assertHandoffCanPrepare(handoff);
      if (handoff.walletAddress && handoff.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        return NextResponse.json({ error: "Connected wallet does not match this handoff." }, { status: 403 });
      }
      if (handoff.status === "prepared") {
        if (handoff.preparedDraftRevision !== handoff.draftRevision) {
          return NextResponse.json(
            { error: "Prepared transaction plan is stale. Review the saved draft and prepare again." },
            { status: 409 },
          );
        }
        const assets = await listAgentAskHandoffAssets(handoff.id);
        return buildAgentAskHandoffResponse({ assets, handoff, includeImageData: true });
      }

      let assets = await listAgentAskHandoffAssets(handoff.id);
      const stagedAssets = assets.filter(asset => asset.status === "staged");
      if (stagedAssets.length > 0 && imageSignatures.length === 0) {
        const uploadChallenges = await buildUploadChallenges({
          assets,
          chainId,
          draftRevision: handoff.draftRevision,
          handoffId,
          walletAddress,
        });
        const updatedHandoff = await loadAgentAskHandoffByToken({ handoffId, token });
        assets = await listAgentAskHandoffAssets(updatedHandoff.id);
        return {
          ...buildAgentAskHandoffResponse({ assets, handoff: updatedHandoff, includeImageData: true }),
          nextAction:
            "Sign each upload challenge in the connected wallet, then call prepare again with imageSignatures.",
          uploadChallenges,
        };
      }
      if (stagedAssets.length > 0) {
        await uploadSignedImages({
          assets,
          handoffId,
          imageSignatures,
          requestUrl: request.url,
          walletAddress,
        });
      }

      return prepareAsk({ chainId, handoffId, requestUrl: request.url, token, walletAddress });
    },
    rateLimit: AGENT_WRITE_RATE_LIMIT,
    request,
  });
}
