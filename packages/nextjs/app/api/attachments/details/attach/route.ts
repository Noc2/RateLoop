import { NextRequest, NextResponse } from "next/server";
import { ContentRegistryAbi } from "@rateloop/contracts/abis";
import { getSharedDeploymentAddress } from "@rateloop/contracts/deployments";
import { type Address, type Hex, createPublicClient, decodeEventLog, http, isAddress } from "viem";
import {
  attachQuestionDetailsToContent,
  parseQuestionDetailsIdFromDetailsUrl,
} from "~~/lib/attachments/questionDetails";
import { getServerRpcOverrides, getServerTargetNetworkById } from "~~/lib/env/server";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { normalizeContentId, normalizeWalletAddress } from "~~/lib/watchlist/contentWatch";
import { checkRateLimit } from "~~/utils/rateLimit";

type DetailsAttachRequest = {
  chainId?: unknown;
  details?: unknown;
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

const RATE_LIMIT = { limit: 30, windowMs: 60_000 };
const ATTACH_JSON_BODY_MAX_BYTES = 32 * 1024;
const MAX_ATTACH_DETAILS = 10;
const MAX_TRANSACTION_HASHES = 5;
const BYTES32_PATTERN = /^0x[a-fA-F0-9]{64}$/;

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
  logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[];
}) {
  const expectedEmitter = params.contentRegistryAddress.toLowerCase();
  const submittersByContentId = new Map<string, Address>();
  const detailsByContentId = new Map<string, Pick<DetailsAttachmentInput, "detailsHash" | "detailsUrl">>();

  for (const log of params.logs) {
    if (log.address.toLowerCase() !== expectedEmitter) continue;
    try {
      if (!log.topics[0]) continue;
      const decoded = decodeEventLog({
        abi: ContentRegistryAbi,
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]],
      }) as { eventName: string; args: Record<string, unknown> };

      if (
        decoded.eventName === "ContentSubmitted" &&
        typeof decoded.args.contentId === "bigint" &&
        typeof decoded.args.submitter === "string" &&
        isAddress(decoded.args.submitter)
      ) {
        submittersByContentId.set(decoded.args.contentId.toString(), decoded.args.submitter);
      } else if (
        decoded.eventName === "ContentDetailsSubmitted" &&
        typeof decoded.args.contentId === "bigint" &&
        typeof decoded.args.detailsUrl === "string" &&
        typeof decoded.args.detailsHash === "string" &&
        BYTES32_PATTERN.test(decoded.args.detailsHash)
      ) {
        detailsByContentId.set(decoded.args.contentId.toString(), {
          detailsHash: decoded.args.detailsHash.toLowerCase() as Hex,
          detailsUrl: decoded.args.detailsUrl,
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
  return proofs;
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
  if (!chainId || transactionHashes.length === 0 || details.length === 0) {
    return NextResponse.json({ error: "chainId, transactionHashes, and details are required." }, { status: 400 });
  }

  const context = resolveDetailsAttachContext(chainId);
  if (!context) {
    return NextResponse.json(
      { error: "Question details attachment is not configured for this chain." },
      { status: 503 },
    );
  }

  const proofs = new Map<string, ContentDetailsProof>();
  for (const transactionHash of transactionHashes) {
    const receipt = await context.publicClient.getTransactionReceipt({ hash: transactionHash }).catch(() => null);
    if (!receipt || receipt.status !== "success") continue;
    const receiptProofs = collectDetailsProofsFromReceiptLogs({
      contentRegistryAddress: context.contentRegistryAddress,
      logs: receipt.logs,
    });
    for (const [contentId, proof] of receiptProofs.entries()) {
      proofs.set(contentId, proof);
    }
  }

  let attached = 0;
  for (const detail of details) {
    const proof = proofs.get(detail.contentId);
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

  return NextResponse.json({
    attached,
    requested: details.length,
  });
}
