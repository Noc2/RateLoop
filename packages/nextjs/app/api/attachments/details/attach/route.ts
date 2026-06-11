import { NextRequest, NextResponse } from "next/server";
import { ContentRegistryAbi } from "@rateloop/contracts/abis";
import { getSharedDeploymentAddress } from "@rateloop/contracts/deployments";
import { canonicalJsonHash } from "@rateloop/node-utils/json";
import { type TargetAudience, normalizeTargetAudience } from "@rateloop/node-utils/profileSelfReport";
import { type Address, type Hex, createPublicClient, decodeEventLog, http, isAddress } from "viem";
import { attachImagesToContent } from "~~/lib/attachments/imageAttachments";
import {
  attachQuestionDetailsToContent,
  parseQuestionDetailsIdFromDetailsUrl,
} from "~~/lib/attachments/questionDetails";
import { upsertQuestionConfidentialityFromMetadata } from "~~/lib/confidentiality/context";
import { getServerRpcOverrides, getServerTargetNetworkById } from "~~/lib/env/server";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { normalizeContentId, normalizeWalletAddress } from "~~/lib/watchlist/contentWatch";
import { ponderApi } from "~~/services/ponder/client";
import { checkRateLimit } from "~~/utils/rateLimit";

type DetailsAttachRequest = {
  chainId?: unknown;
  details?: unknown;
  metadata?: unknown;
  transactionHash?: unknown;
  transactionHashes?: unknown;
};

type DetailsAttachmentInput = {
  contentId: string;
  detailsHash: Hex;
  detailsUrl: string;
};

type ContentDetailsProof = DetailsAttachmentInput & {
  submitter: Address;
};

type QuestionMetadataInput = {
  contentId: string;
  questionMetadata: unknown | null;
  questionMetadataHash: Hex;
  questionMetadataUri: string | null;
  resultSpecHash: Hex;
  targetAudience: TargetAudience | null;
};

type QuestionMetadataProof = {
  contentId: string;
  questionMetadataHash: Hex;
  questionMetadataUri: string | null;
  resultSpecHash: Hex;
};

type ImageAttachmentProof = {
  contentId: string;
  imageUrls: string[];
  submitter: Address;
};

const RATE_LIMIT = { limit: 30, windowMs: 60_000 };
const ATTACH_JSON_BODY_MAX_BYTES = 32 * 1024;
const MAX_ATTACH_DETAILS = 10;
const MAX_ATTACH_METADATA = 25;
const MAX_TRANSACTION_HASHES = 5;
const BYTES32_PATTERN = /^0x[a-fA-F0-9]{64}$/;

const CONTENT_REGISTRY_MEDIA_VALIDATOR_ABI = [
  {
    inputs: [],
    name: "submissionMediaValidator",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readChainId(value: unknown) {
  const chainId = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(chainId) && chainId > 0 ? chainId : null;
}

function readTransactionHashes(payload: DetailsAttachRequest): Hex[] {
  const values = Array.isArray(payload.transactionHashes)
    ? payload.transactionHashes
    : payload.transactionHash
      ? [payload.transactionHash]
      : [];
  const hashes = values
    .map(value => (typeof value === "string" ? value.trim() : ""))
    .filter((value): value is Hex => BYTES32_PATTERN.test(value));
  return [...new Set(hashes.map(hash => hash.toLowerCase() as Hex))].slice(0, MAX_TRANSACTION_HASHES);
}

function readDetailsAttachments(value: unknown): DetailsAttachmentInput[] {
  if (!Array.isArray(value)) return [];
  const attachments: DetailsAttachmentInput[] = [];
  for (const entry of value.slice(0, MAX_ATTACH_DETAILS)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const contentId = normalizeContentId(record.contentId);
    const detailsUrl = typeof record.detailsUrl === "string" ? record.detailsUrl.trim() : "";
    const detailsHash = typeof record.detailsHash === "string" ? record.detailsHash.trim().toLowerCase() : "";
    if (!contentId || !parseQuestionDetailsIdFromDetailsUrl(detailsUrl) || !BYTES32_PATTERN.test(detailsHash)) continue;
    attachments.push({
      contentId,
      detailsHash: detailsHash as Hex,
      detailsUrl,
    });
  }
  return attachments;
}

function readQuestionMetadataAttachments(value: unknown): QuestionMetadataInput[] {
  if (!Array.isArray(value)) return [];
  const metadata: QuestionMetadataInput[] = [];
  for (const entry of value.slice(0, MAX_ATTACH_METADATA)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const contentId = normalizeContentId(record.contentId);
    const questionMetadataHash =
      typeof record.questionMetadataHash === "string" ? record.questionMetadataHash.trim().toLowerCase() : "";
    const resultSpecHash = typeof record.resultSpecHash === "string" ? record.resultSpecHash.trim().toLowerCase() : "";
    if (!contentId || !BYTES32_PATTERN.test(questionMetadataHash) || !BYTES32_PATTERN.test(resultSpecHash)) continue;
    const questionMetadata = record.questionMetadata ?? null;
    if (questionMetadata !== null && canonicalJsonHash(questionMetadata).toLowerCase() !== questionMetadataHash) {
      throw new Error("questionMetadata does not match questionMetadataHash.");
    }
    metadata.push({
      contentId,
      questionMetadata,
      questionMetadataHash: questionMetadataHash as Hex,
      questionMetadataUri:
        typeof record.questionMetadataUri === "string" ? record.questionMetadataUri.trim() || null : null,
      resultSpecHash: resultSpecHash as Hex,
      targetAudience: normalizeTargetAudience(record.targetAudience),
    });
  }
  return metadata;
}

function resolveDetailsAttachContext(chainId: number) {
  const targetNetwork = getServerTargetNetworkById(chainId);
  const contentRegistryAddress = getSharedDeploymentAddress(chainId, "ContentRegistry");
  const rpcUrl = targetNetwork ? (getServerRpcOverrides()[chainId] ?? targetNetwork.rpcUrls.default.http[0]) : null;
  if (!targetNetwork || !contentRegistryAddress || !rpcUrl) return null;
  return {
    contentRegistryAddress,
    publicClient: createPublicClient({
      chain: targetNetwork,
      transport: http(rpcUrl),
    }),
  };
}

function collectDetailsProofsFromReceiptLogs(params: {
  contentRegistryAddress: Address;
  mediaValidatorAddress: Address | null;
  logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[];
}) {
  const expectedEmitter = params.contentRegistryAddress.toLowerCase();
  const expectedMediaValidatorEmitter = params.mediaValidatorAddress?.toLowerCase() ?? null;
  const submittersByContentId = new Map<string, Address>();
  const detailsByContentId = new Map<string, Pick<DetailsAttachmentInput, "detailsHash" | "detailsUrl">>();
  const metadataByContentId = new Map<string, Omit<QuestionMetadataProof, "contentId">>();
  const imageUrlsByContentId = new Map<string, string[]>();

  for (const log of params.logs) {
    try {
      if (!log.topics[0]) continue;
      const normalizedAddress = log.address.toLowerCase();
      if (normalizedAddress !== expectedEmitter && normalizedAddress !== expectedMediaValidatorEmitter) continue;
      const decoded = decodeEventLog({
        abi: ContentRegistryAbi,
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]],
      }) as { eventName: string; args: Record<string, unknown> };

      if (
        decoded.eventName === "ContentSubmitted" &&
        normalizedAddress === expectedEmitter &&
        typeof decoded.args.contentId === "bigint" &&
        typeof decoded.args.submitter === "string" &&
        isAddress(decoded.args.submitter)
      ) {
        submittersByContentId.set(decoded.args.contentId.toString(), decoded.args.submitter);
      } else if (
        decoded.eventName === "ContentDetailsSubmitted" &&
        normalizedAddress === expectedEmitter &&
        typeof decoded.args.contentId === "bigint" &&
        typeof decoded.args.detailsUrl === "string" &&
        typeof decoded.args.detailsHash === "string" &&
        BYTES32_PATTERN.test(decoded.args.detailsHash)
      ) {
        detailsByContentId.set(decoded.args.contentId.toString(), {
          detailsHash: decoded.args.detailsHash.toLowerCase() as Hex,
          detailsUrl: decoded.args.detailsUrl,
        });
      } else if (
        decoded.eventName === "QuestionContentAnchored" &&
        normalizedAddress === expectedMediaValidatorEmitter &&
        typeof decoded.args.contentId === "bigint" &&
        typeof decoded.args.questionMetadataHash === "string" &&
        BYTES32_PATTERN.test(decoded.args.questionMetadataHash) &&
        typeof decoded.args.resultSpecHash === "string" &&
        BYTES32_PATTERN.test(decoded.args.resultSpecHash)
      ) {
        const key = decoded.args.contentId.toString();
        if (
          decoded.args.mediaType === 1 &&
          typeof decoded.args.mediaIndex === "bigint" &&
          typeof decoded.args.url === "string"
        ) {
          const imageUrls = imageUrlsByContentId.get(key) ?? [];
          imageUrls[Number(decoded.args.mediaIndex)] = decoded.args.url;
          imageUrlsByContentId.set(key, imageUrls);
        }
        metadataByContentId.set(key, {
          questionMetadataHash: decoded.args.questionMetadataHash.toLowerCase() as Hex,
          questionMetadataUri: null,
          resultSpecHash: decoded.args.resultSpecHash.toLowerCase() as Hex,
        });
      }
    } catch {
      // Ignore unrelated logs emitted by tokens, escrows, or older registry ABIs.
    }
  }

  const proofs = new Map<string, ContentDetailsProof>();
  for (const [contentId, submitter] of submittersByContentId.entries()) {
    const details = detailsByContentId.get(contentId);
    if (!details) continue;
    proofs.set(contentId, {
      contentId,
      detailsHash: details.detailsHash,
      detailsUrl: details.detailsUrl,
      submitter,
    });
  }
  const metadataProofs = new Map<string, QuestionMetadataProof>();
  for (const [contentId, metadata] of metadataByContentId.entries()) {
    if (!submittersByContentId.has(contentId)) continue;
    metadataProofs.set(contentId, {
      contentId,
      questionMetadataHash: metadata.questionMetadataHash,
      questionMetadataUri: metadata.questionMetadataUri,
      resultSpecHash: metadata.resultSpecHash,
    });
  }
  const imageProofs = new Map<string, ImageAttachmentProof>();
  for (const [contentId, imageUrls] of imageUrlsByContentId.entries()) {
    const submitter = submittersByContentId.get(contentId);
    const compactImageUrls = imageUrls.filter(Boolean);
    if (!submitter || compactImageUrls.length === 0) continue;
    imageProofs.set(contentId, {
      contentId,
      imageUrls: compactImageUrls,
      submitter,
    });
  }
  return { detailsProofs: proofs, imageProofs, metadataProofs };
}

export async function POST(request: NextRequest) {
  const limited = await checkRateLimit(request, RATE_LIMIT);
  if (limited) return limited;

  const body = await parseJsonBody(request, { maxBytes: ATTACH_JSON_BODY_MAX_BYTES });
  if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);
  const payload = body as DetailsAttachRequest;

  const chainId = readChainId(payload.chainId);
  const transactionHashes = readTransactionHashes(payload);
  const details = readDetailsAttachments(payload.details);
  let metadata: QuestionMetadataInput[];
  try {
    metadata = readQuestionMetadataAttachments(payload.metadata);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid question metadata." },
      { status: 400 },
    );
  }
  if (!chainId || transactionHashes.length === 0 || (details.length === 0 && metadata.length === 0)) {
    return NextResponse.json(
      { error: "chainId, transactionHashes, and details or metadata are required." },
      { status: 400 },
    );
  }

  const context = resolveDetailsAttachContext(chainId);
  if (!context) {
    return NextResponse.json(
      { error: "Question details attachment is not configured for this chain." },
      { status: 503 },
    );
  }

  const mediaValidatorAddress = await context.publicClient
    .readContract({
      abi: CONTENT_REGISTRY_MEDIA_VALIDATOR_ABI,
      address: context.contentRegistryAddress,
      functionName: "submissionMediaValidator",
    })
    .catch(() => null);

  const detailsProofs = new Map<string, ContentDetailsProof>();
  const imageProofs = new Map<string, ImageAttachmentProof>();
  const metadataProofs = new Map<string, QuestionMetadataProof>();
  for (const transactionHash of transactionHashes) {
    const receipt = await context.publicClient.getTransactionReceipt({ hash: transactionHash }).catch(() => null);
    if (!receipt || receipt.status !== "success") continue;
    const receiptProofs = collectDetailsProofsFromReceiptLogs({
      contentRegistryAddress: context.contentRegistryAddress,
      mediaValidatorAddress: mediaValidatorAddress && isAddress(mediaValidatorAddress) ? mediaValidatorAddress : null,
      logs: receipt.logs,
    });
    for (const [contentId, proof] of receiptProofs.detailsProofs.entries()) {
      detailsProofs.set(contentId, proof);
    }
    for (const [contentId, proof] of receiptProofs.imageProofs.entries()) {
      imageProofs.set(contentId, proof);
    }
    for (const [contentId, proof] of receiptProofs.metadataProofs.entries()) {
      metadataProofs.set(contentId, proof);
    }
  }

  let attached = 0;
  for (const detail of details) {
    const proof = detailsProofs.get(detail.contentId);
    if (
      !proof ||
      proof.detailsUrl !== detail.detailsUrl ||
      proof.detailsHash.toLowerCase() !== detail.detailsHash.toLowerCase()
    ) {
      continue;
    }
    if (
      await attachQuestionDetailsToContent({
        contentId: detail.contentId,
        detailsUrl: detail.detailsUrl,
        ownerWalletAddress: normalizeWalletAddress(proof.submitter),
      })
    ) {
      attached += 1;
    }
  }

  let imagesAttached = 0;
  for (const proof of imageProofs.values()) {
    imagesAttached += await attachImagesToContent({
      contentId: proof.contentId,
      imageUrls: proof.imageUrls,
      ownerWalletAddress: normalizeWalletAddress(proof.submitter),
    });
  }

  const verifiedMetadata = metadata.filter(entry => {
    const proof = metadataProofs.get(entry.contentId);
    return (
      proof &&
      proof.questionMetadataHash.toLowerCase() === entry.questionMetadataHash.toLowerCase() &&
      (entry.questionMetadataUri === null ||
        proof.questionMetadataUri === null ||
        proof.questionMetadataUri === entry.questionMetadataUri) &&
      proof.resultSpecHash.toLowerCase() === entry.resultSpecHash.toLowerCase()
    );
  });
  let metadataIndexed = 0;
  let metadataSkipped = metadata.length - verifiedMetadata.length;
  const warnings: string[] = [];
  if (verifiedMetadata.length > 0) {
    await Promise.all(
      verifiedMetadata.map(entry =>
        upsertQuestionConfidentialityFromMetadata({
          contentId: entry.contentId,
          metadata: entry.questionMetadata as Record<string, unknown> | null,
          questionMetadataHash: entry.questionMetadataHash,
        }),
      ),
    );
    try {
      const result = await ponderApi.syncQuestionMetadata(verifiedMetadata);
      metadataIndexed = result.updated;
      metadataSkipped += result.skipped;
      if (result.errors.length > 0) {
        warnings.push(...result.errors.map(error => `metadata_sync_error:${error}`));
      }
    } catch (error) {
      console.warn("Unable to sync question metadata to Ponder.", error);
      warnings.push("metadata_sync_unavailable");
    }
  }

  return NextResponse.json({
    attached,
    imagesAttached,
    requested: details.length,
    metadataIndexed,
    metadataRequested: metadata.length,
    metadataSkipped,
    warnings,
  });
}
