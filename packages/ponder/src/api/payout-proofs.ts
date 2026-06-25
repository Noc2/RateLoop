import { merkleProof } from "@rateloop/node-utils/correlationScoring";
import { canonicalJsonHash } from "@rateloop/node-utils/json";
import { eq } from "ponder";
import { db } from "ponder:api";
import { payoutArtifactCache } from "ponder:schema";
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
  artifactHash?: Hex | null | undefined;
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
const DATA_URI_PREFIX = "data:";
const DATA_URI_BASE64_MAX_BYTES = Math.ceil(ARTIFACT_MAX_BYTES / 3) * 4;
const DATA_URI_PERCENT_ENCODED_MAX_BYTES = ARTIFACT_MAX_BYTES * 3;
// H-6 (2026-05-22 audit): previously an unbounded Map keyed by URI; replace with a
// hand-rolled LRU (no new dependency) so long-running indexers cannot drift into a
// slow leak once the question count grows.
const ARTIFACT_CACHE_MAX_ENTRIES = 1_000;
class LruPromiseCache {
  private readonly inner = new Map<string, Promise<unknown>>();
  constructor(private readonly maxEntries: number) {}
  get(key: string): Promise<unknown> | undefined {
    const value = this.inner.get(key);
    if (value === undefined) return undefined;
    // Touch -> move to end so the most-recently-accessed key is never the eviction target.
    this.inner.delete(key);
    this.inner.set(key, value);
    return value;
  }
  set(key: string, value: Promise<unknown>): void {
    if (this.inner.has(key)) this.inner.delete(key);
    this.inner.set(key, value);
    while (this.inner.size > this.maxEntries) {
      const oldest = this.inner.keys().next().value;
      if (oldest === undefined) break;
      this.inner.delete(oldest);
    }
  }
  delete(key: string): void {
    this.inner.delete(key);
  }
}
const artifactCache = new LruPromiseCache(ARTIFACT_CACHE_MAX_ENTRIES);
const httpsArtifactAllowlist = parseHttpsArtifactAllowlist(
  process.env.PAYOUT_ARTIFACT_HTTPS_ALLOWLIST ?? process.env.KEEPER_ARTIFACT_HTTPS_ALLOWLIST ?? "",
);

export async function resolveQuestionPayoutProof(
  params: ResolveQuestionPayoutProofParams,
): Promise<PayoutWeightProof | null> {
  if (!params.artifactUri || !params.commitKey || !params.identityKey) {
    return null;
  }

  const artifact = await fetchArtifactJson(params.artifactUri, params.artifactHash);
  if (!artifact) return null;
  if (!artifactHashMatches(artifact, params.artifactHash)) return null;

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
    .filter((payoutWeight) => payoutWeightBelongsToSnapshot(payoutWeight, params))
    .map((payoutWeight) => normalizeHex(payoutWeight.leaf, 32))
    .filter((leaf): leaf is Hex => leaf !== null);
  const leaf = normalizeHex(candidate.leaf, 32);
  if (!leaf || leaves.length === 0) return null;

  try {
    return { payoutWeight, proof: merkleProof(leaves, leaf) };
  } catch {
    return null;
  }
}

async function fetchArtifactJson(
  uri: string,
  artifactHash?: Hex | null | undefined,
): Promise<unknown | null> {
  const cached = await readCachedArtifactJson(artifactHash);
  if (cached !== null) return cached;

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

async function readCachedArtifactJson(
  artifactHash: Hex | null | undefined,
): Promise<unknown | null> {
  const normalizedArtifactHash = normalizeHex(artifactHash, 32);
  if (!normalizedArtifactHash) return null;

  try {
    const rows = await db
      .select({
        canonicalJson: payoutArtifactCache.canonicalJson,
      })
      .from(payoutArtifactCache)
      .where(eq(payoutArtifactCache.artifactHash, normalizedArtifactHash))
      .limit(1);
    const canonicalJson = rows[0]?.canonicalJson;
    return canonicalJson ? JSON.parse(canonicalJson) : null;
  } catch {
    return null;
  }
}

async function readArtifactJson(uri: string): Promise<unknown> {
  if (uri.startsWith(DATA_URI_PREFIX)) {
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
  if (value.startsWith(DATA_URI_PREFIX)) {
    return value;
  }
  if (value.startsWith("https://")) {
    return isAllowedHttpsArtifactUrl(value) ? value : null;
  }
  if (value.startsWith("http://")) {
    return isAllowedLocalHttpArtifactUrl(value) ? value : null;
  }
  if (value.startsWith("ipfs://")) {
    const gatewayUri = `https://ipfs.io/ipfs/${value.slice("ipfs://".length)}`;
    return isAllowedHttpsArtifactUrl(gatewayUri) ? gatewayUri : null;
  }
  if (value.startsWith("ar://")) {
    const gatewayUri = `https://arweave.net/${value.slice("ar://".length)}`;
    return isAllowedHttpsArtifactUrl(gatewayUri) ? gatewayUri : null;
  }
  return null;
}

function parseHttpsArtifactAllowlist(value: string): URL[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      try {
        const url = new URL(entry);
        return url.protocol === "https:" ? [url] : [];
      } catch {
        return [];
      }
    });
}

function isAllowedHttpsArtifactUrl(value: string): boolean {
  let artifactUrl: URL;
  try {
    artifactUrl = new URL(value);
  } catch {
    return false;
  }
  if (artifactUrl.protocol !== "https:") return false;

  return httpsArtifactAllowlist.some((allowedUrl) => {
    if (artifactUrl.origin !== allowedUrl.origin) return false;
    const allowedPath = stripTrailingSlash(allowedUrl.pathname);
    if (allowedPath === "") return true;
    const artifactPath = stripTrailingSlash(artifactUrl.pathname);
    return artifactPath === allowedPath || artifactPath.startsWith(`${allowedPath}/`);
  });
}

function isAllowedLocalHttpArtifactUrl(value: string): boolean {
  if (!shouldAllowLocalHttpArtifacts()) return false;

  let artifactUrl: URL;
  try {
    artifactUrl = new URL(value);
  } catch {
    return false;
  }
  if (artifactUrl.protocol !== "http:") return false;
  if (artifactUrl.username || artifactUrl.password) return false;

  return (
    artifactUrl.hostname === "localhost" ||
    artifactUrl.hostname === "127.0.0.1" ||
    artifactUrl.hostname === "[::1]"
  );
}

function shouldAllowLocalHttpArtifacts(): boolean {
  return process.env.PONDER_NETWORK === "hardhat";
}

function stripTrailingSlash(value: string): string {
  return value === "/" ? "" : value.replace(/\/+$/, "");
}

function readDataUri(uri: string) {
  const commaIndex = uri.indexOf(",");
  if (commaIndex < 0) {
    throw new Error("Invalid data URI");
  }
  const metadata = uri.slice(DATA_URI_PREFIX.length, commaIndex);
  const payload = uri.slice(commaIndex + 1);
  const metadataParts = metadata.split(";").filter(Boolean);
  const mediaType = metadataParts[0]?.toLowerCase() ?? "";
  const isBase64 = metadataParts.some((part) => part.toLowerCase() === "base64");
  if (mediaType && mediaType !== "application/json" && !mediaType.endsWith("+json")) {
    throw new Error("Payout artifact data URI must contain JSON");
  }
  const encodedBytes = Buffer.byteLength(payload, "utf8");
  if (encodedBytes > (isBase64 ? DATA_URI_BASE64_MAX_BYTES : DATA_URI_PERCENT_ENCODED_MAX_BYTES)) {
    throw new Error(`Payout artifact data URI exceeds ${ARTIFACT_MAX_BYTES} decoded bytes`);
  }

  const decoded = isBase64
    ? Buffer.from(payload, "base64").toString("utf8")
    : decodeURIComponent(payload);
  if (Buffer.byteLength(decoded, "utf8") > ARTIFACT_MAX_BYTES) {
    throw new Error(`Payout artifact data URI exceeded ${ARTIFACT_MAX_BYTES} decoded bytes`);
  }
  return decoded;
}

function artifactHashMatches(artifact: unknown, expectedHash: Hex | null | undefined) {
  const normalizedExpectedHash = normalizeHex(expectedHash, 32);
  if (!normalizedExpectedHash) return true;
  const actualHash = canonicalJsonHash(artifact);
  return actualHash.toLowerCase() === normalizedExpectedHash.toLowerCase();
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
    payoutWeightBelongsToSnapshot(payoutWeight, params) &&
    normalizeHex(payoutWeight.commitKey, 32)?.toLowerCase() ===
      params.commitKey?.toLowerCase() &&
    normalizeHex(payoutWeight.identityKey, 32)?.toLowerCase() ===
      params.identityKey?.toLowerCase()
  );
}

function payoutWeightBelongsToSnapshot(
  payoutWeight: CandidatePayoutWeight,
  params: Pick<
    ResolveQuestionPayoutProofParams,
    "domain" | "rewardPoolId" | "contentId" | "roundId"
  >,
) {
  return (
    normalizeNumber(payoutWeight.domain) === params.domain &&
    normalizeBigIntString(payoutWeight.rewardPoolId) ===
      params.rewardPoolId.toString() &&
    normalizeBigIntString(payoutWeight.contentId) ===
      params.contentId.toString() &&
    normalizeBigIntString(payoutWeight.roundId) === params.roundId.toString()
  );
}

function normalizePayoutWeight(
  value: CandidatePayoutWeight,
): PayoutWeightProof["payoutWeight"] | null {
  const domain = normalizeNumber(value.domain);
  const rewardPoolId = normalizeBigIntString(value.rewardPoolId);
  const contentId = normalizeBigIntString(value.contentId);
  const roundId = normalizeBigIntString(value.roundId);
  const commitKey = normalizeHex(value.commitKey, 32);
  const identityKey = normalizeHex(value.identityKey, 32);
  const account = normalizeHex(value.account, 20);
  const baseWeight = normalizeBigIntString(value.baseWeight);
  const independenceBps = normalizeNumber(value.independenceBps);
  const effectiveWeight = normalizeBigIntString(value.effectiveWeight);
  const reasonHash = normalizeHex(value.reasonHash, 32);

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

function normalizeHex(value: unknown, byteLength: number): Hex | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  if (value.length !== 2 + byteLength * 2) return null;
  return value as Hex;
}

function normalizeHexArray(value: unknown): Hex[] | null {
  if (!Array.isArray(value)) return null;
  const normalized = value.map((item) => normalizeHex(item, 32));
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
