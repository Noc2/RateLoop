import { merkleProof } from "@rateloop/node-utils/correlationScoring";
import type { Hex } from "viem";

export interface PayoutWeightProof {
  payoutWeight: {
    domain: number;
    rewardPoolId: string;
    contentId: string;
    roundId: string;
    commitKey: Hex;
    identityKey: Hex;
    account: Hex;
    baseWeight: string;
    independenceBps: number;
    effectiveWeight: string;
    reasonHash: Hex;
  };
  proof: Hex[];
}

interface ResolveQuestionPayoutProofParams {
  artifactUri: string | null | undefined;
  domain: number;
  rewardPoolId: bigint;
  contentId: bigint;
  roundId: bigint;
  commitKey: Hex | null | undefined;
  identityKey: Hex | null | undefined;
}

interface CandidatePayoutWeight {
  domain?: unknown;
  rewardPoolId?: unknown;
  contentId?: unknown;
  roundId?: unknown;
  commitKey?: unknown;
  identityKey?: unknown;
  account?: unknown;
  baseWeight?: unknown;
  independenceBps?: unknown;
  effectiveWeight?: unknown;
  reasonHash?: unknown;
  leaf?: unknown;
  proof?: unknown;
}

const ARTIFACT_FETCH_TIMEOUT_MS = 5_000;
// H-5 (2026-05-22 audit): reject payloads larger than this before consuming them so
// a misconfigured or hostile artifact host cannot OOM the indexer through slow-read.
const ARTIFACT_MAX_BYTES = 10_000_000;
const artifactCache = new Map<string, Promise<unknown>>();
const httpsArtifactAllowlist = (
  process.env.PAYOUT_ARTIFACT_HTTPS_ALLOWLIST ?? ""
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export async function resolveQuestionPayoutProof(
  params: ResolveQuestionPayoutProofParams,
): Promise<PayoutWeightProof | null> {
  if (!params.artifactUri || !params.commitKey || !params.identityKey) {
    return null;
  }

  const artifact = await fetchArtifactJson(params.artifactUri);
  if (!artifact) return null;

  const payoutWeights = collectPayoutWeights(artifact);
  const candidate = payoutWeights.find((payoutWeight) =>
    payoutWeightMatches(payoutWeight, params),
  );
  if (!candidate) return null;

  const payoutWeight = normalizePayoutWeight(candidate);
  if (!payoutWeight) return null;

  const embeddedProof = normalizeHexArray(candidate.proof);
  if (embeddedProof) {
    return { payoutWeight, proof: embeddedProof };
  }

  const leaves = payoutWeights
    .map((payoutWeight) => normalizeHex(payoutWeight.leaf))
    .filter((leaf): leaf is Hex => leaf !== null);
  const leaf = normalizeHex(candidate.leaf);
  if (!leaf || leaves.length === 0) return null;

  try {
    return { payoutWeight, proof: merkleProof(leaves, leaf) };
  } catch {
    return null;
  }
}

async function fetchArtifactJson(uri: string): Promise<unknown | null> {
  const normalizedUri = normalizeArtifactUri(uri);
  if (!normalizedUri) return null;

  let promise = artifactCache.get(normalizedUri);
  if (!promise) {
    promise = readArtifactJson(normalizedUri);
    artifactCache.set(normalizedUri, promise);
  }

  try {
    return await promise;
  } catch {
    artifactCache.delete(normalizedUri);
    return null;
  }
}

async function readArtifactJson(uri: string): Promise<unknown> {
  if (uri.startsWith("data:")) {
    return JSON.parse(readDataUri(uri));
  }

  const response = await fetch(uri, {
    signal: AbortSignal.timeout(ARTIFACT_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Payout artifact request failed: ${response.status}`);
  }
  // Fast path: the server told us how big the body is — refuse before reading.
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const declaredLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declaredLength) && declaredLength > ARTIFACT_MAX_BYTES) {
      throw new Error(`Payout artifact too large: ${declaredLength} > ${ARTIFACT_MAX_BYTES} bytes`);
    }
  }
  // Slow path: stream the body and bail past the cap so a server that omits
  // content-length still cannot make us read an unbounded payload.
  if (!response.body) {
    return response.json();
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const reader = response.body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > ARTIFACT_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`Payout artifact exceeded ${ARTIFACT_MAX_BYTES} bytes during read`);
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(combined));
}

function normalizeArtifactUri(uri: string): string | null {
  const value = uri.trim();
  if (!value) return null;
  if (value.startsWith("data:")) {
    return value;
  }
  if (value.startsWith("https://")) {
    return httpsArtifactAllowlist.some((prefix) => value.startsWith(prefix))
      ? value
      : null;
  }
  if (value.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${value.slice("ipfs://".length)}`;
  }
  if (value.startsWith("ar://")) {
    return `https://arweave.net/${value.slice("ar://".length)}`;
  }
  return null;
}

function readDataUri(uri: string) {
  const commaIndex = uri.indexOf(",");
  if (commaIndex < 0) {
    throw new Error("Invalid data URI");
  }
  const metadata = uri.slice(0, commaIndex);
  const payload = uri.slice(commaIndex + 1);
  if (metadata.endsWith(";base64")) {
    return Buffer.from(payload, "base64").toString("utf8");
  }
  return decodeURIComponent(payload);
}

function collectPayoutWeights(artifact: unknown): CandidatePayoutWeight[] {
  const weights: CandidatePayoutWeight[] = [];
  collectPayoutWeightsFromNode(artifact, weights);
  return weights;
}

function collectPayoutWeightsFromNode(
  node: unknown,
  weights: CandidatePayoutWeight[],
) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const entry of node) {
      collectPayoutWeightsFromNode(entry, weights);
    }
    return;
  }

  const record = node as Record<string, unknown>;
  if (record.commitKey !== undefined && record.identityKey !== undefined) {
    weights.push(record as CandidatePayoutWeight);
  }
  for (const key of [
    "payoutWeights",
    "payoutWeightLeaves",
    "leaves",
    "claims",
  ]) {
    const value = record[key];
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry && typeof entry === "object") {
          weights.push(entry as CandidatePayoutWeight);
        }
      }
    }
  }
  collectPayoutWeightsFromNode(record.roundPayoutSnapshots, weights);
}

function payoutWeightMatches(
  payoutWeight: CandidatePayoutWeight,
  params: ResolveQuestionPayoutProofParams,
) {
  return (
    normalizeNumber(payoutWeight.domain) === params.domain &&
    normalizeBigIntString(payoutWeight.rewardPoolId) ===
      params.rewardPoolId.toString() &&
    normalizeBigIntString(payoutWeight.contentId) ===
      params.contentId.toString() &&
    normalizeBigIntString(payoutWeight.roundId) === params.roundId.toString() &&
    normalizeHex(payoutWeight.commitKey)?.toLowerCase() ===
      params.commitKey?.toLowerCase() &&
    normalizeHex(payoutWeight.identityKey)?.toLowerCase() ===
      params.identityKey?.toLowerCase()
  );
}

function normalizePayoutWeight(
  value: CandidatePayoutWeight,
): PayoutWeightProof["payoutWeight"] | null {
  const domain = normalizeNumber(value.domain);
  const rewardPoolId = normalizeBigIntString(value.rewardPoolId);
  const contentId = normalizeBigIntString(value.contentId);
  const roundId = normalizeBigIntString(value.roundId);
  const commitKey = normalizeHex(value.commitKey);
  const identityKey = normalizeHex(value.identityKey);
  const account = normalizeHex(value.account);
  const baseWeight = normalizeBigIntString(value.baseWeight);
  const independenceBps = normalizeNumber(value.independenceBps);
  const effectiveWeight = normalizeBigIntString(value.effectiveWeight);
  const reasonHash = normalizeHex(value.reasonHash);

  if (
    domain === null ||
    rewardPoolId === null ||
    contentId === null ||
    roundId === null ||
    commitKey === null ||
    identityKey === null ||
    account === null ||
    baseWeight === null ||
    independenceBps === null ||
    effectiveWeight === null ||
    reasonHash === null
  ) {
    return null;
  }

  return {
    domain,
    rewardPoolId,
    contentId,
    roundId,
    commitKey,
    identityKey,
    account,
    baseWeight,
    independenceBps,
    effectiveWeight,
    reasonHash,
  };
}

function normalizeHex(value: unknown): Hex | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  return value as Hex;
}

function normalizeHexArray(value: unknown): Hex[] | null {
  if (!Array.isArray(value)) return null;
  const normalized = value.map(normalizeHex);
  return normalized.every((item): item is Hex => item !== null)
    ? normalized
    : null;
}

function normalizeBigIntString(value: unknown): string | null {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value.toString();
  }
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  return null;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return value;
  if (typeof value === "bigint" && value <= BigInt(Number.MAX_SAFE_INTEGER))
    return Number(value);
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}
