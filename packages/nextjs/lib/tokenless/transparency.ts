import { TOKENLESS_SCHEMA_VERSION, type TokenlessResult, parseTokenlessResult } from "@rateloop/sdk";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import "server-only";
import { type Address, type Hash, type Hex, encodeAbiParameters, keccak256 } from "viem";
import { dbClient } from "~~/lib/db";
import { loadTokenlessChainConfig } from "~~/lib/tokenless/chain/config";
import {
  TokenlessEvidenceFinalityPendingError,
  assertCanonicalTokenlessEvidenceBlock,
  getTokenlessChainRuntime,
  loadTokenlessEvidenceFinalityPolicy,
} from "~~/lib/tokenless/chain/runtime";
import {
  type PostRoundIntegrityPolicy,
  type PostRoundIntegrityReport,
  createPostRoundIntegrityAppeal,
  evaluatePostRoundIntegrity,
} from "~~/lib/tokenless/postRoundIntegrity";
import {
  listAuthorizedTerminalPublicFeedback,
  verifyPublicRaterResponseCommitments,
} from "~~/lib/tokenless/publicRaterResponses";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { finalizeSurpriseBountyRound } from "~~/lib/tokenless/surpriseBountyService";

const WEBHOOK_EVENTS = new Set([
  "result.ready",
  "result.updated",
  "ai.rateloop.review.completed",
  "ai.rateloop.review.failed",
  "ai.rateloop.review.expired",
  "ai.rateloop.packet.anchored",
  "ai.rateloop.gate.blocked",
]);
const MAX_DELIVERY_ATTEMPTS = 8;
const WEBHOOK_DELIVERY_LEASE_MS = 60_000;
const BPS_MAX = 10_000;
const MAX_PONDER_COMMITS = 500;
const FINALIZED_ROUND_STATE = 5;
const RBTS_SCORING_VERSION = 2;
const RBTS_SCORING_SEED_DOMAIN = "rateloop-tokenless-rbts-v1";
const UINT256_MODULUS = 1n << 256n;
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const UNSIGNED_INTEGER = /^(?:0|[1-9]\d*)$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

type Row = Record<string, unknown>;
export type ResolveHostname = (hostname: string) => Promise<string[]>;

export type IndexedFinalizedEvidence = {
  deploymentKey: string;
  roundId: string;
  revealCount: number;
  upVotes: number;
  economics: TokenlessResult["economics"];
  tierMix: Record<string, number>;
  diversity: {
    independentClusters: number;
    largestClusterBps: number;
    uniqueVoteKeys: number;
  };
  analytics: AnalyticsMetrics;
  provenance: {
    assignmentCount: number;
    issuedVoucherCount: number;
    matchedAssignmentCount: number;
    validResponseCount: number;
    verifiedIdentityCount: number;
  };
  scoring: {
    entropy: string;
    scoringBeaconRound: string;
    fixedBasePayAtomic: string;
    maximumBonusAtomic: string;
    mode: "rbts" | "base_only_beacon_unavailable";
    revealSetSum: string;
    revealSetXor: string;
    scoringSeed: string;
    totalFinalizedLiabilityAtomic: string;
    totalRbtsScoreBps: string;
    /** Added in-place for mechanism-health aggregation; absent on historical evidence. */
    totalSquaredRbtsScoreBps2?: string;
    version: typeof RBTS_SCORING_VERSION;
  };
  roundTerms: {
    admissionPolicyHash: string;
    commitDeadline: string;
    contentId: string;
    termsHash: string;
  };
  chain: { blockNumber: string; blockHash: string; transactionHash: string; timestamp: string };
};

export type AnalyticsMetrics = {
  answerFingerprintRiskBps: number;
  correlationRiskBps: number;
  issuedVoucherCount: number;
  verifiedIdentityCount: number;
};

type PonderDeployment = {
  adapterAddress: string;
  chainId: number;
  deploymentKey: string;
  feedbackBonusAddress: string;
  issuerAddress: string;
  panelAddress: string;
  startBlock: number;
};

type PonderRound = Record<string, unknown>;
type PonderCommit = Record<string, unknown>;

type PostRoundIntegrityInput = {
  schemaVersion: "rateloop.post-round-integrity-input.v1";
  policy: PostRoundIntegrityPolicy;
  reports: PostRoundIntegrityReport[];
  inputsComplete: boolean;
  limitationCodes: string[];
};

function rowString(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

export function stableTransparencyJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableTransparencyJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableTransparencyJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function requireCanonicalEvidenceFinality(evidence: IndexedFinalizedEvidence) {
  try {
    const config = loadTokenlessChainConfig();
    await assertCanonicalTokenlessEvidenceBlock({
      blockHash: evidence.chain.blockHash as Hash,
      blockNumber: BigInt(evidence.chain.blockNumber),
      config,
      deploymentKey: evidence.deploymentKey,
      policy: loadTokenlessEvidenceFinalityPolicy(),
      runtime: getTokenlessChainRuntime(config),
    });
  } catch (error) {
    if (error instanceof TokenlessEvidenceFinalityPendingError) {
      throw new TokenlessServiceError(error.message, 409, "indexed_evidence_pending", true);
    }
    throw error;
  }
}

type NormativeRbtsReveal = {
  commitKey: Hex;
  predictedUpBps: number;
  vote: 0 | 1;
};

function quadraticScoreBps(predictionBps: number, actualVote: 0 | 1) {
  const squared = predictionBps * predictionBps;
  return actualVote === 1
    ? Math.floor((2 * BPS_MAX * predictionBps - squared) / BPS_MAX)
    : BPS_MAX - Math.floor(squared / BPS_MAX);
}

export function recomputeRbtsSettlement(input: {
  chainId: number;
  entropy: Hex;
  fixedBasePay: bigint;
  maximumBonus: bigint;
  mode: "rbts" | "base_only_beacon_unavailable";
  panelAddress: Address;
  reveals: NormativeRbtsReveal[];
  roundId: bigint;
}) {
  let revealSetXor = 0n;
  let revealSetSum = 0n;
  for (const reveal of input.reveals) {
    const leaf = BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }], [reveal.commitKey])));
    revealSetXor ^= leaf;
    revealSetSum = (revealSetSum + leaf) % UINT256_MODULUS;
  }
  const revealSetXorHex = `0x${revealSetXor.toString(16).padStart(64, "0")}` as Hex;
  const scoringSeed =
    input.mode === "rbts"
      ? keccak256(
          encodeAbiParameters(
            [
              { type: "string" },
              { type: "uint256" },
              { type: "address" },
              { type: "uint256" },
              { type: "uint32" },
              { type: "bytes32" },
              { type: "uint256" },
              { type: "bytes32" },
            ],
            [
              RBTS_SCORING_SEED_DOMAIN,
              BigInt(input.chainId),
              input.panelAddress,
              input.roundId,
              input.reveals.length,
              revealSetXorHex,
              revealSetSum,
              input.entropy,
            ],
          ),
        )
      : (ZERO_BYTES32 as Hex);
  const ranked =
    input.mode === "rbts"
      ? input.reveals
          .map(reveal => ({
            ...reveal,
            rankHash: keccak256(
              encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [scoringSeed, reveal.commitKey]),
            ),
          }))
          .sort((left, right) => {
            const rankOrder =
              BigInt(left.rankHash) < BigInt(right.rankHash)
                ? -1
                : BigInt(left.rankHash) > BigInt(right.rankHash)
                  ? 1
                  : 0;
            if (rankOrder !== 0) return rankOrder;
            return BigInt(left.commitKey) < BigInt(right.commitKey)
              ? -1
              : BigInt(left.commitKey) > BigInt(right.commitKey)
                ? 1
                : 0;
          })
      : input.reveals;
  const byKey = new Map(input.reveals.map(reveal => [reveal.commitKey.toLowerCase(), reveal]));
  const scores = new Map<
    string,
    {
      finalizedPayout: bigint;
      informationScoreBps: number;
      peerCommitKey: Hex;
      predictionScoreBps: number;
      rbtsScoreBps: number;
      referenceCommitKey: Hex;
    }
  >();
  let totalFinalizedLiability = 0n;
  let totalRbtsScoreBps = 0n;
  for (const [index, rankedReveal] of ranked.entries()) {
    const referenceCommitKey =
      input.mode === "rbts" ? ranked[(index + 1) % ranked.length].commitKey : (ZERO_BYTES32 as Hex);
    const peerCommitKey = input.mode === "rbts" ? ranked[(index + 2) % ranked.length].commitKey : (ZERO_BYTES32 as Hex);
    const own = byKey.get(rankedReveal.commitKey.toLowerCase())!;
    const reference = byKey.get(referenceCommitKey.toLowerCase());
    const peer = byKey.get(peerCommitKey.toLowerCase());
    let informationScoreBps = 0;
    let predictionScoreBps = 0;
    let rbtsScoreBps = 0;
    if (input.mode === "rbts") {
      const delta = Math.min(reference!.predictedUpBps, BPS_MAX - reference!.predictedUpBps);
      const shadowPredictionBps =
        own.vote === 1 ? reference!.predictedUpBps + delta : reference!.predictedUpBps - delta;
      informationScoreBps = quadraticScoreBps(shadowPredictionBps, peer!.vote);
      predictionScoreBps = quadraticScoreBps(own.predictedUpBps, peer!.vote);
      rbtsScoreBps = Math.floor((informationScoreBps + predictionScoreBps) / 2);
    }
    const finalizedPayout = input.fixedBasePay + (input.maximumBonus * BigInt(rbtsScoreBps)) / BigInt(BPS_MAX);
    scores.set(own.commitKey.toLowerCase(), {
      finalizedPayout,
      informationScoreBps,
      peerCommitKey,
      predictionScoreBps,
      rbtsScoreBps,
      referenceCommitKey,
    });
    totalFinalizedLiability += finalizedPayout;
    totalRbtsScoreBps += BigInt(rbtsScoreBps);
  }
  return {
    revealSetSum,
    revealSetXor: revealSetXorHex,
    scores,
    scoringSeed,
    totalFinalizedLiability,
    totalRbtsScoreBps,
  };
}

function bps(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > BPS_MAX) {
    throw new TokenlessServiceError(`${name} must be an integer from 0 to 10000.`, 400, "invalid_analytics");
  }
  return value;
}

function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TokenlessServiceError(`${name} is malformed.`, 409, "indexed_evidence_invalid");
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, name: string, pattern?: RegExp) {
  if (typeof value !== "string" || value.length === 0 || (pattern && !pattern.test(value))) {
    throw new TokenlessServiceError(`${name} is malformed.`, 409, "indexed_evidence_invalid");
  }
  return value;
}

function integerValue(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TokenlessServiceError(`${name} is malformed.`, 409, "indexed_evidence_invalid");
  }
  return value;
}

function unsignedValue(value: unknown, name: string) {
  return stringValue(value, name, UNSIGNED_INTEGER);
}

function exactAddress(value: unknown, name: string) {
  return stringValue(value, name, ADDRESS).toLowerCase();
}

function exactBytes32(value: unknown, name: string) {
  return stringValue(value, name, BYTES32).toLowerCase();
}

function ratioBps(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : Math.floor((numerator * BPS_MAX) / denominator);
}

function duplicateRiskBps(values: string[]) {
  return ratioBps(values.length - new Set(values).size, values.length);
}

function configuredPonderUrl(raw = process.env.TOKENLESS_PONDER_URL ?? process.env.NEXT_PUBLIC_PONDER_URL) {
  const value = raw?.trim() || (process.env.NODE_ENV === "production" ? "" : "http://127.0.0.1:42069");
  if (!value)
    throw new TokenlessServiceError("Ponder evidence source is not configured.", 503, "ponder_unavailable", true);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TokenlessServiceError("Ponder evidence source is invalid.", 503, "ponder_unavailable", true);
  }
  if (url.username || url.password || url.hash || !["http:", "https:"].includes(url.protocol)) {
    throw new TokenlessServiceError("Ponder evidence source is invalid.", 503, "ponder_unavailable", true);
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new TokenlessServiceError("Ponder evidence source must use HTTPS.", 503, "ponder_unavailable", true);
  }
  return url;
}

function ponderEndpoint(base: URL, path: string) {
  const url = new URL(base.toString());
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  url.search = "";
  return url;
}

async function fetchPonderJson(fetchImpl: typeof fetch, url: URL, name: string) {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new TokenlessServiceError(`${name} is not available.`, 409, "indexed_evidence_pending", true);
  }
  if (!response.ok) {
    throw new TokenlessServiceError(`${name} is not available.`, 409, "indexed_evidence_pending", true);
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new TokenlessServiceError(`${name} returned malformed JSON.`, 409, "indexed_evidence_invalid");
  }
}

function webhookKey(raw = process.env.TOKENLESS_WEBHOOK_ENCRYPTION_KEY) {
  if (!raw) throw new Error("TOKENLESS_WEBHOOK_ENCRYPTION_KEY is required.");
  const key = Buffer.from(raw, "base64url");
  if (key.length !== 32) throw new Error("TOKENLESS_WEBHOOK_ENCRYPTION_KEY must encode exactly 32 bytes.");
  return key;
}

function encryptSecret(secret: string, rawKey?: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", webhookKey(rawKey), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(value => value.toString("base64url")).join(".");
}

function decryptSecret(value: string, rawKey?: string) {
  const parts = value.split(".").map(part => Buffer.from(part, "base64url"));
  if (parts.length !== 3 || parts[0].length !== 12 || parts[1].length !== 16) {
    throw new Error("Stored webhook signing secret is malformed.");
  }
  const decipher = createDecipheriv("aes-256-gcm", webhookKey(rawKey), parts[0]);
  decipher.setAuthTag(parts[1]);
  return Buffer.concat([decipher.update(parts[2]), decipher.final()]).toString("utf8");
}

export function decryptWebhookSigningSecret(value: string, rawKey?: string) {
  return decryptSecret(value, rawKey);
}

function ipv4ToNumber(octets: number[]) {
  return ((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3];
}

// IANA IPv4 Special-Purpose Address Registry entries whose "Globally Reachable"
// value is False (plus the multicast and reserved blocks). Any address inside
// one of these ranges must never be used as a webhook destination.
const NON_GLOBAL_IPV4_CIDRS: ReadonlyArray<readonly [number, number]> = [
  [ipv4ToNumber([0, 0, 0, 0]), 8], // "this network"
  [ipv4ToNumber([10, 0, 0, 0]), 8], // private
  [ipv4ToNumber([100, 64, 0, 0]), 10], // carrier-grade NAT
  [ipv4ToNumber([127, 0, 0, 0]), 8], // loopback
  [ipv4ToNumber([169, 254, 0, 0]), 16], // link-local
  [ipv4ToNumber([172, 16, 0, 0]), 12], // private
  [ipv4ToNumber([192, 0, 0, 0]), 24], // IETF protocol assignments
  [ipv4ToNumber([192, 0, 2, 0]), 24], // TEST-NET-1 documentation
  [ipv4ToNumber([192, 88, 99, 0]), 24], // 6to4 relay anycast
  [ipv4ToNumber([192, 168, 0, 0]), 16], // private
  [ipv4ToNumber([198, 18, 0, 0]), 15], // benchmarking
  [ipv4ToNumber([198, 51, 100, 0]), 24], // TEST-NET-2 documentation
  [ipv4ToNumber([203, 0, 113, 0]), 24], // TEST-NET-3 documentation
  [ipv4ToNumber([224, 0, 0, 0]), 4], // multicast
  [ipv4ToNumber([240, 0, 0, 0]), 4], // reserved incl. 255.255.255.255 broadcast
];

function isNonGlobalIpv4(octets: number[]) {
  const value = ipv4ToNumber(octets);
  return NON_GLOBAL_IPV4_CIDRS.some(([network, prefix]) => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) >>> 0 === (network & mask) >>> 0;
  });
}

function ipv6ToBigInt(value: string): bigint | null {
  // Fold an embedded dotted-quad (e.g. ::ffff:192.168.0.1) into hex groups.
  let text = value;
  const embedded = text.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (embedded) {
    const octets = embedded.slice(1, 5).map(Number);
    if (octets.some(part => part > 255)) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${text.slice(0, embedded.index)}${high}:${low}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = halves.length === 2 ? [...head, ...Array(missing).fill("0"), ...tail] : head;
  if (groups.length !== 8) return null;
  let result = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    result = (result << 16n) | BigInt(parseInt(group, 16));
  }
  return result;
}

const NON_GLOBAL_IPV6_CIDRS: ReadonlyArray<readonly [bigint, number]> = [
  [ipv6ToBigInt("::")!, 128], // unspecified
  [ipv6ToBigInt("::1")!, 128], // loopback
  [ipv6ToBigInt("64:ff9b:1::")!, 48], // local-use IPv4/IPv6 translation (RFC 8215)
  [ipv6ToBigInt("100::")!, 64], // discard-only
  [ipv6ToBigInt("2001:db8::")!, 32], // documentation
  [ipv6ToBigInt("3fff::")!, 20], // documentation (RFC 9637)
  [ipv6ToBigInt("fc00::")!, 7], // unique local
  [ipv6ToBigInt("fe80::")!, 10], // link-local
  [ipv6ToBigInt("fec0::")!, 10], // deprecated site-local
  [ipv6ToBigInt("ff00::")!, 8], // multicast
];

const IPV4_MAPPED_PREFIX = ipv6ToBigInt("::ffff:0:0")! >> 32n; // ::ffff:0:0/96
const NAT64_PREFIX = ipv6ToBigInt("64:ff9b::")! >> 32n; // 64:ff9b::/96

function isNonGlobalIpv6(value: string) {
  const bits = ipv6ToBigInt(value);
  if (bits === null) return true; // fail closed on any unparseable form
  const high96 = bits >> 32n;
  const embeddedOctets = [
    Number((bits >> 24n) & 0xffn),
    Number((bits >> 16n) & 0xffn),
    Number((bits >> 8n) & 0xffn),
    Number(bits & 0xffn),
  ];
  // IPv4-mapped (::ffff:0:0/96), deprecated IPv4-compatible (::/96, excluding
  // :: and ::1), and NAT64 (64:ff9b::/96) all embed an IPv4 address whose own
  // routability governs the connection.
  if (high96 === IPV4_MAPPED_PREFIX) return isNonGlobalIpv4(embeddedOctets);
  if (high96 === NAT64_PREFIX) return isNonGlobalIpv4(embeddedOctets);
  if (high96 === 0n && bits !== 0n && bits !== 1n) return isNonGlobalIpv4(embeddedOctets);
  return NON_GLOBAL_IPV6_CIDRS.some(([network, prefix]) => {
    const shift = 128n - BigInt(prefix);
    return bits >> shift === network >> shift;
  });
}

// True for any host that is not a single, globally routable unicast IP address.
// Hostnames that cannot be classified statically (they resolve later) are not
// rejected here; assertPublicWebhookDestination validates the resolved IPs.
function isNonGlobalHost(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")) return true;
  if (isIP(normalized) === 4) return isNonGlobalIpv4(normalized.split(".").map(Number));
  if (isIP(normalized) === 6) return isNonGlobalIpv6(normalized);
  return false;
}

export function validateWebhookUrl(value: string, production = process.env.NODE_ENV === "production") {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TokenlessServiceError("Webhook URL is invalid.", 400, "invalid_webhook_url");
  }
  if (url.username || url.password || url.hash || url.protocol !== "https:") {
    throw new TokenlessServiceError(
      "Webhook URL must be a credential-free HTTPS URL without a fragment.",
      400,
      "invalid_webhook_url",
    );
  }
  if (isNonGlobalHost(url.hostname)) {
    throw new TokenlessServiceError("Webhook URL cannot target a private or local host.", 400, "invalid_webhook_url");
  }
  if (production && url.port && url.port !== "443") {
    throw new TokenlessServiceError(
      "Production webhook URLs must use the standard HTTPS port.",
      400,
      "invalid_webhook_url",
    );
  }
  return url.toString();
}

async function defaultResolveHostname(hostname: string) {
  return (await lookup(hostname, { all: true, verbatim: true })).map(result => result.address);
}

// Resolves the destination hostname exactly once, rejects the delivery if any
// resolved address is not globally routable, and returns the single address the
// caller must pin for the actual connection. Pinning the resolved IP closes the
// DNS-rebinding window between validation and the fetch.
export async function assertPublicWebhookDestination(
  url: string,
  resolver: ResolveHostname = defaultResolveHostname,
): Promise<string> {
  let addresses: string[];
  try {
    addresses = await resolver(new URL(url).hostname);
  } catch {
    throw new TokenlessServiceError("Webhook hostname could not be resolved.", 400, "invalid_webhook_url");
  }
  if (addresses.length === 0 || addresses.some(address => !isIP(address) || isNonGlobalHost(address))) {
    throw new TokenlessServiceError(
      "Webhook hostname cannot resolve to a private or local address.",
      400,
      "invalid_webhook_url",
    );
  }
  return addresses[0];
}

export type WebhookFetch = (input: string, init: RequestInit & { pinnedAddress: string }) => Promise<Response>;

// Default webhook transport. Connects to the pre-validated, pinned IP while
// keeping the original hostname for TLS SNI and the Host header, so the socket
// can never reach an address other than the one that passed validation.
export const deliverOverPinnedAddress: WebhookFetch = async (input, init) => {
  const url = new URL(input);
  const headers = new Headers(init.headers);
  headers.set("host", url.host);
  const body = typeof init.body === "string" ? init.body : "";
  const pinned = init.pinnedAddress;
  const family = isIP(pinned);
  if (family === 0) throw new Error("Pinned webhook address is not an IP literal.");
  return await new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        servername: url.hostname,
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method: init.method ?? "POST",
        headers: Object.fromEntries(headers.entries()),
        lookup: (_hostname, _options, callback) => callback(null, pinned, family),
      },
      response => {
        response.resume();
        response.on("end", () => resolve(new Response(null, { status: response.statusCode ?? 502 })));
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.setTimeout(10_000, () => request.destroy(new Error("Webhook delivery timed out.")));
    init.signal?.addEventListener("abort", () => request.destroy(new Error("Webhook delivery aborted.")));
    if (body) request.write(body);
    request.end();
  });
};

function parseEventTypes(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(item => typeof item !== "string" || !WEBHOOK_EVENTS.has(item))
  ) {
    throw new TokenlessServiceError(
      "eventTypes must contain supported webhook event names.",
      400,
      "invalid_webhook_events",
    );
  }
  return [...new Set(value as string[])].sort();
}

async function requireWorkspaceMember(accountAddress: string, workspaceId: string, management = false) {
  const result = await dbClient.execute({
    sql: `SELECT m.role FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
          WHERE m.workspace_id = ? AND m.account_address = ? AND w.status = 'active' LIMIT 1`,
    args: [workspaceId, accountAddress.toLowerCase()],
  });
  const role = rowString(result.rows[0] as Row | undefined, "role");
  if (!role || (management && role !== "owner" && role !== "admin")) {
    throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  }
}

export async function createWorkspaceWebhook(input: {
  accountAddress: string;
  workspaceId: string;
  url: string;
  eventTypes: string[];
  encryptionKey?: string;
  resolveHostname?: ResolveHostname;
}) {
  await requireWorkspaceMember(input.accountAddress, input.workspaceId, true);
  const url = validateWebhookUrl(input.url);
  await assertPublicWebhookDestination(url, input.resolveHostname);
  const eventTypes = parseEventTypes(input.eventTypes);
  const signingSecret = `rlwhsec_${randomBytes(32).toString("base64url")}`;
  const endpointId = `whe_${randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  try {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_webhook_endpoints
            (endpoint_id, workspace_id, url, event_types_json, secret_ciphertext, secret_key_version, active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'v1', true, ?, ?)`,
      args: [
        endpointId,
        input.workspaceId,
        url,
        JSON.stringify(eventTypes),
        encryptSecret(signingSecret, input.encryptionKey),
        now,
        now,
      ],
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new TokenlessServiceError("That webhook URL is already configured.", 409, "webhook_exists");
    }
    throw error;
  }
  return { endpointId, eventTypes, signingSecret, url };
}

export async function listWorkspaceWebhooks(input: { accountAddress: string; workspaceId: string }) {
  await requireWorkspaceMember(input.accountAddress, input.workspaceId, true);
  const result = await dbClient.execute({
    sql: `SELECT endpoint_id, url, event_types_json, active, created_at, updated_at
          FROM tokenless_webhook_endpoints WHERE workspace_id = ? ORDER BY created_at DESC`,
    args: [input.workspaceId],
  });
  return result.rows.map(value => {
    const row = value as Row;
    return {
      endpointId: rowString(row, "endpoint_id"),
      url: rowString(row, "url"),
      eventTypes: JSON.parse(rowString(row, "event_types_json") ?? "[]"),
      active: Boolean(row.active),
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    };
  });
}

export async function deactivateWorkspaceWebhook(input: {
  accountAddress: string;
  workspaceId: string;
  endpointId: string;
}) {
  await requireWorkspaceMember(input.accountAddress, input.workspaceId, true);
  const result = await dbClient.execute({
    sql: `UPDATE tokenless_webhook_endpoints SET active = false, updated_at = ?
          WHERE endpoint_id = ? AND workspace_id = ? AND active = true`,
    args: [new Date(), input.endpointId, input.workspaceId],
  });
  if (result.rowCount !== 1) throw new TokenlessServiceError("Webhook not found.", 404, "webhook_not_found");
}

export async function subscribeAskWebhook(input: {
  operationKey: string;
  workspaceId: string;
  registration?: { url: string; eventTypes: string[] };
}) {
  if (!input.registration) return false;
  const url = validateWebhookUrl(input.registration.url);
  const eventTypes = parseEventTypes(input.registration.eventTypes);
  const endpoint = await dbClient.execute({
    sql: `SELECT endpoint_id, event_types_json FROM tokenless_webhook_endpoints
          WHERE workspace_id = ? AND url = ? AND active = true LIMIT 1`,
    args: [input.workspaceId, url],
  });
  const row = endpoint.rows[0] as Row | undefined;
  const endpointId = rowString(row, "endpoint_id");
  const configured = new Set<string>(JSON.parse(rowString(row, "event_types_json") ?? "[]"));
  if (!endpointId || eventTypes.some(eventType => !configured.has(eventType))) {
    throw new TokenlessServiceError(
      "Configure this webhook URL and event set in workspace settings first.",
      409,
      "webhook_not_configured",
    );
  }
  await dbClient.execute({
    sql: `INSERT INTO tokenless_ask_webhook_subscriptions
          (subscription_id, operation_key, endpoint_id, event_types_json, created_at)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT (operation_key, endpoint_id) DO NOTHING`,
    args: [
      `whs_${digest(`${input.operationKey}:${endpointId}`).slice(0, 32)}`,
      input.operationKey,
      endpointId,
      JSON.stringify(eventTypes),
      new Date(),
    ],
  });
  return true;
}

function validateFinalizedEvidence(value: IndexedFinalizedEvidence) {
  if (
    !UNSIGNED_INTEGER.test(value.roundId) ||
    !value.deploymentKey ||
    !Number.isSafeInteger(value.revealCount) ||
    value.revealCount < 1 ||
    !Number.isSafeInteger(value.upVotes) ||
    value.upVotes < 0 ||
    value.upVotes > value.revealCount
  ) {
    throw new TokenlessServiceError("Indexed round evidence is invalid.", 400, "invalid_round_evidence");
  }
  if (
    value.scoring.version !== RBTS_SCORING_VERSION ||
    !UNSIGNED_INTEGER.test(value.scoring.scoringBeaconRound) ||
    !UNSIGNED_INTEGER.test(value.scoring.revealSetSum) ||
    !UNSIGNED_INTEGER.test(value.scoring.totalFinalizedLiabilityAtomic) ||
    !UNSIGNED_INTEGER.test(value.scoring.totalRbtsScoreBps) ||
    (value.scoring.totalSquaredRbtsScoreBps2 !== undefined &&
      !UNSIGNED_INTEGER.test(value.scoring.totalSquaredRbtsScoreBps2)) ||
    !UNSIGNED_INTEGER.test(value.scoring.fixedBasePayAtomic) ||
    !UNSIGNED_INTEGER.test(value.scoring.maximumBonusAtomic) ||
    !BYTES32.test(value.scoring.entropy) ||
    !BYTES32.test(value.scoring.revealSetXor) ||
    !BYTES32.test(value.scoring.scoringSeed) ||
    !["rbts", "base_only_beacon_unavailable"].includes(value.scoring.mode) ||
    (value.scoring.mode === "rbts" &&
      (value.scoring.scoringSeed.toLowerCase() === ZERO_BYTES32 ||
        value.scoring.entropy.toLowerCase() === ZERO_BYTES32)) ||
    (value.scoring.mode === "base_only_beacon_unavailable" &&
      (value.scoring.scoringSeed.toLowerCase() !== ZERO_BYTES32 ||
        value.scoring.entropy.toLowerCase() !== ZERO_BYTES32))
  ) {
    throw new TokenlessServiceError("RBTS settlement evidence is malformed.", 400, "invalid_round_evidence");
  }
  if (
    Object.values(value.tierMix).some(count => !Number.isSafeInteger(count) || count < 0) ||
    Object.values(value.tierMix).reduce((sum, count) => sum + count, 0) !== value.revealCount
  ) {
    throw new TokenlessServiceError("Tier mix must account for every reveal.", 400, "invalid_round_evidence");
  }
  bps(value.diversity.largestClusterBps, "diversity.largestClusterBps");
  if (value.diversity.uniqueVoteKeys !== value.revealCount || value.diversity.independentClusters < 1) {
    throw new TokenlessServiceError(
      "Diversity metadata does not match the indexed reveal set.",
      400,
      "invalid_round_evidence",
    );
  }
  if (
    !UNSIGNED_INTEGER.test(value.chain.blockNumber) ||
    !BYTES32.test(value.chain.blockHash) ||
    !BYTES32.test(value.chain.transactionHash) ||
    !UNSIGNED_INTEGER.test(value.chain.timestamp)
  ) {
    throw new TokenlessServiceError("Chain finality evidence is malformed.", 400, "invalid_round_evidence");
  }
  const fundedAmounts = [
    value.economics.bounty.fundedAtomic,
    value.economics.fee.fundedAtomic,
    value.economics.attemptReserve.fundedAtomic,
    value.economics.totalFundedAtomic,
  ];
  if (fundedAmounts.some(amount => !UNSIGNED_INTEGER.test(amount))) {
    throw new TokenlessServiceError("Round evidence funding is malformed.", 400, "invalid_round_evidence");
  }
  const funded = BigInt(fundedAmounts[0]) + BigInt(fundedAmounts[1]) + BigInt(fundedAmounts[2]);
  if (funded !== BigInt(value.economics.totalFundedAtomic)) {
    throw new TokenlessServiceError("Round evidence funding does not conserve.", 400, "invalid_round_evidence");
  }
  if (
    !BYTES32.test(value.roundTerms.admissionPolicyHash) ||
    !UNSIGNED_INTEGER.test(value.roundTerms.commitDeadline) ||
    !BYTES32.test(value.roundTerms.contentId) ||
    !BYTES32.test(value.roundTerms.termsHash)
  ) {
    throw new TokenlessServiceError("Frozen round terms are malformed.", 400, "invalid_round_evidence");
  }
  bps(value.analytics.answerFingerprintRiskBps, "answerFingerprintRiskBps");
  bps(value.analytics.correlationRiskBps, "correlationRiskBps");
  if (
    !Number.isSafeInteger(value.analytics.issuedVoucherCount) ||
    value.analytics.issuedVoucherCount < 0 ||
    !Number.isSafeInteger(value.analytics.verifiedIdentityCount) ||
    value.analytics.verifiedIdentityCount < 0
  ) {
    throw new TokenlessServiceError(
      "Issuance analytics counts must be non-negative integers.",
      400,
      "invalid_analytics",
    );
  }
}

function exactIndexedIdentity(input: { deployment: PonderDeployment; execution: Row; round: PonderRound; terms: Row }) {
  const deploymentKey = rowString(input.execution, "deployment_key")!;
  const deploymentKeyParts = deploymentKey.toLowerCase().split(":");
  const expected = {
    deploymentKey,
    chainId: Number(input.execution.chain_id),
    deploymentBlock: rowString(input.execution, "deployment_block")!,
    panelAddress: rowString(input.execution, "panel_address")!.toLowerCase(),
    issuerAddress: rowString(input.execution, "issuer_address")!.toLowerCase(),
    adapterAddress: rowString(input.execution, "x402_submitter_address")!.toLowerCase(),
    feedbackBonusAddress: exactAddress(deploymentKeyParts[5], "Deployment-key feedback bonus address"),
    roundId: rowString(input.execution, "round_id")!,
    funder: rowString(input.execution, "funder_address")!.toLowerCase(),
  };
  if (
    !expected.deploymentKey.toLowerCase().startsWith("tokenless-v4:") ||
    input.deployment.deploymentKey.toLowerCase() !== expected.deploymentKey.toLowerCase() ||
    input.deployment.chainId !== expected.chainId ||
    input.deployment.startBlock !== Number(expected.deploymentBlock) ||
    exactAddress(input.deployment.panelAddress, "Ponder panel address") !== expected.panelAddress ||
    exactAddress(input.deployment.issuerAddress, "Ponder issuer address") !== expected.issuerAddress ||
    exactAddress(input.deployment.adapterAddress, "Ponder adapter address") !== expected.adapterAddress ||
    exactAddress(input.deployment.feedbackBonusAddress, "Ponder feedback bonus address") !==
      expected.feedbackBonusAddress ||
    stringValue(input.round.deploymentKey, "Indexed deployment key").toLowerCase() !==
      expected.deploymentKey.toLowerCase() ||
    unsignedValue(input.round.roundId, "Indexed round id") !== expected.roundId ||
    exactAddress(input.round.funder, "Indexed funder") !== expected.funder
  ) {
    throw new TokenlessServiceError(
      "Indexed evidence does not match the deployment-pinned execution.",
      409,
      "evidence_identity_mismatch",
    );
  }
  const exactTerms: Array<[unknown, unknown, string, (value: unknown, name: string) => string]> = [
    [input.round.contentId, input.terms.contentId, "contentId", exactBytes32],
    [input.round.termsHash, input.terms.termsHash, "termsHash", exactBytes32],
    [input.round.beaconNetworkHash, input.terms.beaconNetworkHash, "beaconNetworkHash", exactBytes32],
    [input.round.admissionPolicyHash, input.terms.admissionPolicyHash, "admissionPolicyHash", exactBytes32],
    [input.round.feeRecipient, input.terms.feeRecipient, "feeRecipient", exactAddress],
    [input.round.bountyAmount, input.terms.bountyAmount, "bountyAmount", unsignedValue],
    [input.round.feeAmount, input.terms.feeAmount, "feeAmount", unsignedValue],
    [input.round.attemptReserve, input.terms.attemptReserve, "attemptReserve", unsignedValue],
    [input.round.attemptCompensation, input.terms.attemptCompensation, "attemptCompensation", unsignedValue],
    [input.round.commitDeadline, input.terms.commitDeadline, "commitDeadline", unsignedValue],
    [input.round.revealDeadline, input.terms.revealDeadline, "revealDeadline", unsignedValue],
    [input.round.beaconFailureDeadline, input.terms.beaconFailureDeadline, "beaconFailureDeadline", unsignedValue],
    [input.round.beaconRound, input.terms.beaconRound, "beaconRound", unsignedValue],
    [input.round.scoringBeaconRound, input.terms.scoringBeaconRound, "scoringBeaconRound", unsignedValue],
    [input.round.claimGracePeriod, input.terms.claimGracePeriod, "claimGracePeriod", unsignedValue],
  ];
  if (
    exactTerms.some(
      ([indexed, frozen, name, parse]) => parse(indexed, `Indexed ${name}`) !== parse(frozen, `Frozen ${name}`),
    )
  ) {
    throw new TokenlessServiceError("Indexed round terms do not match the frozen terms.", 409, "round_terms_mismatch");
  }
  if (
    integerValue(input.round.minimumReveals, "Indexed minimum reveals") !==
      integerValue(input.terms.minimumReveals, "Frozen minimum reveals") ||
    integerValue(input.round.maximumCommits, "Indexed maximum commits") !==
      integerValue(input.terms.maximumCommits, "Frozen maximum commits")
  ) {
    throw new TokenlessServiceError("Indexed round terms do not match the frozen terms.", 409, "round_terms_mismatch");
  }
}

async function assuranceProvenance(input: {
  roundId: string;
  contentId: string;
  admissionPolicyHash: string;
  revealCount: number;
  minimumReveals: number;
  revealedCommitsByAccount: Map<string, { committedAt: number; responseHash: string; vote: 0 | 1 }>;
}) {
  const cases = await dbClient.execute({
    sql: `SELECT run_id, case_id FROM tokenless_assurance_run_cases
          WHERE round_id = ? AND lower(content_id) = ? AND lower(admission_policy_hash) = ? LIMIT 2`,
    args: [input.roundId, input.contentId.toLowerCase(), input.admissionPolicyHash.toLowerCase()],
  });
  if (cases.rows.length > 1) {
    throw new TokenlessServiceError(
      "Indexed round maps to multiple assurance cases.",
      409,
      "evidence_identity_mismatch",
    );
  }
  const linked = cases.rows[0] as Row | undefined;
  const defaultPolicy: PostRoundIntegrityPolicy = {
    minimumReports: Math.max(3, input.minimumReveals),
    minimumAssignmentCoverageBps: BPS_MAX,
    maximumClusterShareBps: 5_000,
    maximumAnswerFingerprintShareBps: 4_000,
    maximumCommitBurstShareBps: 6_000,
    commitBurstWindowSeconds: 5,
    maximumRecentCoassignments: 0,
  };
  if (!linked) {
    return {
      assignmentCount: 0,
      matchedAssignmentCount: 0,
      validResponseCount: 0,
      correlationRiskBps: 0,
      integrityInput: {
        schemaVersion: "rateloop.post-round-integrity-input.v1",
        policy: defaultPolicy,
        reports: [],
        inputsComplete: false,
        limitationCodes: ["assurance_case_missing", "assignment_provenance_missing"],
      } satisfies PostRoundIntegrityInput,
    };
  }
  const runId = rowString(linked, "run_id")!;
  // The chain reveal is the canonical paid-response evidence. Voucher issuance
  // already bound vote key -> account -> this frozen assignment provenance.
  // Do not gate publication on the separate enterprise-response table, and do
  // not discard accepted paid work because its assignment lease later expired.
  const assignments = await dbClient.execute({
    sql: `SELECT reviewer_account_address, integrity_reviewer_lookup, integrity_cluster_pseudonym,
                 provider_subject_hashes_json, integrity_provenance_json, integrity_provenance_hash
          FROM tokenless_assurance_assignments WHERE run_id = ?`,
    args: [runId],
  });
  const reports: PostRoundIntegrityReport[] = [];
  const limitationCodes = new Set<string>();
  let policy: PostRoundIntegrityPolicy | null = null;
  let matchedAssignmentCount = 0;
  for (const value of assignments.rows) {
    const assignment = value as Row;
    const account = rowString(assignment, "reviewer_account_address")?.toLowerCase() ?? "";
    const commit = input.revealedCommitsByAccount.get(account);
    if (!commit) continue;
    matchedAssignmentCount += 1;
    try {
      const provenanceJson = stringValue(assignment.integrity_provenance_json, "Assignment integrity provenance");
      if (`sha256:${digest(provenanceJson)}` !== rowString(assignment, "integrity_provenance_hash")) {
        throw new Error("hash mismatch");
      }
      const provenance = objectValue(JSON.parse(provenanceJson), "Assignment integrity provenance");
      const constraints = objectValue(provenance.constraints, "Assignment integrity constraints");
      const providerSubjectHashes = Array.isArray(provenance.providerSubjectHashes)
        ? provenance.providerSubjectHashes.map(String)
        : [];
      const reviewerLookup = stringValue(provenance.reviewerLookup, "Assignment reviewer lookup");
      const clusterPseudonym = stringValue(provenance.clusterPseudonym, "Assignment cluster pseudonym");
      const recentCoassignments = integerValue(provenance.recentCoassignments, "Assignment recent coassignments");
      if (
        reviewerLookup !== rowString(assignment, "integrity_reviewer_lookup") ||
        clusterPseudonym !== rowString(assignment, "integrity_cluster_pseudonym") ||
        stableTransparencyJson(providerSubjectHashes) !== rowString(assignment, "provider_subject_hashes_json")
      ) {
        throw new Error("column binding mismatch");
      }
      const candidatePolicy: PostRoundIntegrityPolicy = {
        minimumReports: Math.max(3, input.minimumReveals),
        minimumAssignmentCoverageBps: BPS_MAX,
        maximumClusterShareBps: integerValue(constraints.maxClusterShareBps, "Assignment maximum cluster share"),
        maximumAnswerFingerprintShareBps: 4_000,
        maximumCommitBurstShareBps: 6_000,
        commitBurstWindowSeconds: 5,
        maximumRecentCoassignments: integerValue(
          constraints.maxRecentCoassignments,
          "Assignment maximum recent coassignments",
        ),
      };
      if (policy && stableTransparencyJson(policy) !== stableTransparencyJson(candidatePolicy)) {
        throw new Error("mixed frozen constraints");
      }
      policy = candidatePolicy;
      reports.push({
        reviewerLookup,
        clusterPseudonym,
        providerSubjectHashes,
        vote: commit.vote,
        responseHash: commit.responseHash,
        committedAt: commit.committedAt,
        recentCoassignments,
        assignmentMatched: true,
      });
    } catch {
      limitationCodes.add("assignment_provenance_invalid");
    }
  }
  if (!policy) limitationCodes.add("integrity_policy_missing");
  if (reports.length !== input.revealCount) limitationCodes.add("assignment_provenance_partial");
  const mismatch = Math.abs(input.revealCount - reports.length);
  return {
    assignmentCount: assignments.rows.length,
    matchedAssignmentCount,
    validResponseCount: reports.length,
    correlationRiskBps: ratioBps(Math.min(mismatch, input.revealCount), input.revealCount),
    integrityInput: {
      schemaVersion: "rateloop.post-round-integrity-input.v1",
      policy: policy ?? defaultPolicy,
      reports,
      inputsComplete: policy !== null && reports.length === input.revealCount,
      limitationCodes: [...limitationCodes].sort(),
    } satisfies PostRoundIntegrityInput,
  };
}

async function deriveFinalizedRoundEvidenceBundle(input: {
  operationKey: string;
  fetchImpl?: typeof fetch;
  ponderUrl?: string;
}) {
  const source = await dbClient.execute({
    sql: `SELECT o.workspace_id, e.*, a.economics_json
          FROM tokenless_ask_ownership o
          JOIN tokenless_chain_executions e ON e.operation_key = o.operation_key
          JOIN tokenless_agent_asks a ON a.operation_key = o.operation_key
          WHERE o.operation_key = ? LIMIT 1`,
    args: [input.operationKey],
  });
  const execution = source.rows[0] as Row | undefined;
  if (!execution || !rowString(execution, "workspace_id") || !rowString(execution, "round_id")) {
    throw new TokenlessServiceError("Ask chain execution was not found.", 404, "ask_not_found");
  }
  if (rowString(execution, "state") !== "confirmed") {
    throw new TokenlessServiceError("Ask chain execution is not confirmed.", 409, "indexed_evidence_pending", true);
  }
  const terms = objectValue(JSON.parse(rowString(execution, "round_terms_json")!), "Frozen round terms") as Row;
  const base = configuredPonderUrl(input.ponderUrl);
  const roundUrl = ponderEndpoint(base, `/rounds/${encodeURIComponent(rowString(execution, "round_id")!)}`);
  const commitsUrl = ponderEndpoint(base, `/rounds/${encodeURIComponent(rowString(execution, "round_id")!)}/commits`);
  commitsUrl.searchParams.set("limit", String(MAX_PONDER_COMMITS));
  const fetchImpl = input.fetchImpl ?? fetch;
  const [rawDeployment, rawRound, rawCommits] = await Promise.all([
    fetchPonderJson(fetchImpl, ponderEndpoint(base, "/deployment"), "Ponder deployment"),
    fetchPonderJson(fetchImpl, roundUrl, "Indexed round"),
    fetchPonderJson(fetchImpl, commitsUrl, "Indexed commits"),
  ]);
  const deployment = objectValue(rawDeployment, "Ponder deployment") as unknown as PonderDeployment;
  const round = objectValue(rawRound, "Indexed round") as PonderRound;
  if (!Array.isArray(rawCommits)) {
    throw new TokenlessServiceError("Indexed commits are malformed.", 409, "indexed_evidence_invalid");
  }
  exactIndexedIdentity({ deployment, execution, round, terms });
  const state = integerValue(round.state, "Indexed round state");
  const revealCount = integerValue(round.revealCount, "Indexed reveal count");
  const frozenRevealCount = integerValue(round.frozenRevealCount, "Indexed frozen reveal count");
  const commitCount = integerValue(round.commitCount, "Indexed commit count");
  const upVotes = integerValue(round.upVotes, "Indexed up vote count");
  if (
    state !== FINALIZED_ROUND_STATE ||
    revealCount < 1 ||
    frozenRevealCount !== revealCount ||
    upVotes > revealCount ||
    commitCount > MAX_PONDER_COMMITS ||
    rawCommits.length !== commitCount
  ) {
    throw new TokenlessServiceError(
      "Indexed round is not completely finalized.",
      409,
      "indexed_evidence_pending",
      true,
    );
  }
  const finalizedBlock = unsignedValue(round.finalizedBlock, "Finalized block");
  const finalizedAt = unsignedValue(round.finalizedAt, "Finalized timestamp");
  if (
    BigInt(finalizedBlock) < BigInt(rowString(execution, "deployment_block")!) ||
    BigInt(finalizedBlock) < BigInt(unsignedValue(round.createdBlock, "Created block"))
  ) {
    throw new TokenlessServiceError("Finalization predates the pinned deployment.", 409, "evidence_identity_mismatch");
  }
  const commits = rawCommits.map((value, index) => objectValue(value, `Indexed commit ${index}`) as PonderCommit);
  const revealed = commits.filter(commit => commit.revealed === true);
  if (revealed.length !== revealCount) {
    throw new TokenlessServiceError(
      "Indexed reveal count does not match the commit projection.",
      409,
      "indexed_evidence_invalid",
    );
  }
  const voteKeys = revealed.map((commit, index) => exactAddress(commit.voteKey, `Reveal ${index} vote key`));
  const nullifiers = revealed.map((commit, index) => exactBytes32(commit.nullifier, `Reveal ${index} nullifier`));
  const responseHashes = revealed.map((commit, index) =>
    exactBytes32(commit.responseHash, `Reveal ${index} response hash`),
  );
  if (new Set(voteKeys).size !== revealCount || new Set(nullifiers).size !== revealCount) {
    throw new TokenlessServiceError("Indexed reveal identities are not unique.", 409, "indexed_evidence_invalid");
  }
  const indexedUpVotes = revealed.reduce((sum, commit, index) => {
    const vote = integerValue(commit.vote, `Reveal ${index} vote`);
    if (vote !== 0 && vote !== 1)
      throw new TokenlessServiceError("Indexed vote is invalid.", 409, "indexed_evidence_invalid");
    return sum + vote;
  }, 0);
  if (indexedUpVotes !== upVotes) {
    throw new TokenlessServiceError(
      "Indexed votes do not match the finalized aggregate.",
      409,
      "indexed_evidence_invalid",
    );
  }
  const scoringVersion = integerValue(round.scoringVersion, "Indexed scoring version");
  const scoringModeValue = integerValue(round.scoringMode, "Indexed scoring mode");
  const scoringMode = scoringModeValue === 1 ? "rbts" : scoringModeValue === 2 ? "base_only_beacon_unavailable" : null;
  const scoreCursor = integerValue(round.scoreCursor, "Indexed score cursor");
  const fixedBasePay = unsignedValue(round.fixedBasePay, "Indexed fixed base pay");
  const maximumBonus = unsignedValue(round.maximumBonus, "Indexed maximum bonus");
  const totalRbtsScoreBps = unsignedValue(round.totalRbtsScoreBps, "Indexed total RBTS score");
  const totalFinalizedLiability = unsignedValue(round.totalFinalizedLiability, "Indexed total finalized liability");
  const scoringSeed = exactBytes32(round.scoringSeed, "Indexed scoring seed");
  const revealSetXor = exactBytes32(round.revealSetXor, "Indexed reveal-set XOR");
  const revealSetSum = unsignedValue(round.revealSetSum, "Indexed reveal-set sum");
  const scoringBeaconRound = unsignedValue(round.scoringBeaconRound, "Indexed scoring beacon round");
  const entropy = exactBytes32(round.entropy, "Indexed scoring entropy");
  const maximumCommits = integerValue(round.maximumCommits, "Indexed maximum commits");
  if (maximumCommits < 3 || maximumCommits > MAX_PONDER_COMMITS) {
    throw new TokenlessServiceError("Indexed maximum commits is invalid.", 409, "indexed_evidence_invalid");
  }
  const maximumSeatPay = BigInt(unsignedValue(round.bountyAmount, "Indexed bounty amount")) / BigInt(maximumCommits);
  const normativeFixedBasePay = (maximumSeatPay * 8_000n) / 10_000n;
  const normativeMaximumBonus = maximumSeatPay - normativeFixedBasePay;
  if (
    scoringVersion !== RBTS_SCORING_VERSION ||
    !scoringMode ||
    scoreCursor !== revealCount ||
    BigInt(fixedBasePay) !== normativeFixedBasePay ||
    BigInt(maximumBonus) !== normativeMaximumBonus ||
    (scoringMode === "rbts" && (scoringSeed === ZERO_BYTES32 || entropy === ZERO_BYTES32)) ||
    (scoringMode === "base_only_beacon_unavailable" && (scoringSeed !== ZERO_BYTES32 || entropy !== ZERO_BYTES32))
  ) {
    throw new TokenlessServiceError("Indexed RBTS settlement is incomplete.", 409, "indexed_evidence_invalid");
  }
  const normativeReveals = revealed.map((commit, index) => {
    const vote = integerValue(commit.vote, `Reveal ${index} vote`);
    const predictedUpBps = integerValue(commit.predictedUpBps, `Reveal ${index} prediction`);
    if (vote !== 0 && vote !== 1) {
      throw new TokenlessServiceError("Indexed vote is invalid.", 409, "indexed_evidence_invalid");
    }
    if (predictedUpBps < 100 || predictedUpBps > 9_900 || predictedUpBps % 100 !== 0) {
      throw new TokenlessServiceError("Indexed prediction is invalid.", 409, "indexed_evidence_invalid");
    }
    return {
      commitKey: exactBytes32(commit.commitKey, `Reveal ${index} commit key`) as Hex,
      predictedUpBps,
      vote: vote as 0 | 1,
    };
  });
  if (new Set(normativeReveals.map(reveal => reveal.commitKey)).size !== revealCount) {
    throw new TokenlessServiceError("Indexed reveal commit keys are not unique.", 409, "indexed_evidence_invalid");
  }
  const normativeSettlement = recomputeRbtsSettlement({
    chainId: deployment.chainId,
    entropy: entropy as Hex,
    fixedBasePay: BigInt(fixedBasePay),
    maximumBonus: BigInt(maximumBonus),
    mode: scoringMode,
    panelAddress: exactAddress(deployment.panelAddress, "Ponder panel address") as Address,
    reveals: normativeReveals,
    roundId: BigInt(unsignedValue(round.roundId, "Indexed round id")),
  });
  if (
    normativeSettlement.revealSetXor !== revealSetXor ||
    normativeSettlement.revealSetSum !== BigInt(revealSetSum) ||
    normativeSettlement.scoringSeed !== scoringSeed ||
    normativeSettlement.totalRbtsScoreBps !== BigInt(totalRbtsScoreBps) ||
    normativeSettlement.totalFinalizedLiability !== BigInt(totalFinalizedLiability)
  ) {
    throw new TokenlessServiceError(
      "Indexed RBTS aggregate evidence is inconsistent.",
      409,
      "indexed_evidence_invalid",
    );
  }
  for (const [index, commit] of revealed.entries()) {
    const commitKey = exactBytes32(commit.commitKey, `Reveal ${index} commit key`);
    const referenceCommitKey = exactBytes32(commit.referenceCommitKey, `Reveal ${index} reference key`);
    const peerCommitKey = exactBytes32(commit.peerCommitKey, `Reveal ${index} peer key`);
    const informationScoreBps = integerValue(commit.informationScoreBps, `Reveal ${index} information score`);
    const predictionScoreBps = integerValue(commit.predictionScoreBps, `Reveal ${index} prediction score`);
    const rbtsScoreBps = integerValue(commit.rbtsScoreBps, `Reveal ${index} RBTS score`);
    const finalizedPayout = BigInt(unsignedValue(commit.finalizedPayout, `Reveal ${index} finalized payout`));
    const normativeScore = normativeSettlement.scores.get(commitKey);
    if (
      !normativeScore ||
      referenceCommitKey !== normativeScore.referenceCommitKey ||
      peerCommitKey !== normativeScore.peerCommitKey ||
      informationScoreBps !== normativeScore.informationScoreBps ||
      predictionScoreBps !== normativeScore.predictionScoreBps ||
      rbtsScoreBps !== normativeScore.rbtsScoreBps ||
      finalizedPayout !== normativeScore.finalizedPayout
    ) {
      throw new TokenlessServiceError("Indexed RBTS score evidence is inconsistent.", 409, "indexed_evidence_invalid");
    }
  }
  const totalSquaredRbtsScoreBps2 = [...normativeSettlement.scores.values()]
    .reduce((total, score) => total + BigInt(score.rbtsScoreBps) * BigInt(score.rbtsScoreBps), 0n)
    .toString();
  const vouchersResult = await dbClient.execute({
    sql: `SELECT v.vote_key, v.admission_policy_hash, v.content_id, v.issuer_address,
                 v.assurance_snapshot_hash, p.account_address, s.snapshot_json,
                 s.reviewer_source, s.snapshot_hash
          FROM tokenless_paid_vouchers v
          JOIN tokenless_rater_profiles p ON p.rater_id = v.rater_id
          JOIN tokenless_voucher_assurance_snapshots s ON s.voucher_id = v.voucher_id
          WHERE v.chain_id = ? AND lower(v.panel_address) = ? AND v.round_id = ?`,
    args: [
      Number(execution.chain_id),
      rowString(execution, "panel_address")!.toLowerCase(),
      rowString(execution, "round_id")!,
    ],
  });
  const vouchers = new Map(
    vouchersResult.rows.map(value => {
      const voucher = value as Row;
      return [rowString(voucher, "vote_key")!.toLowerCase(), voucher] as const;
    }),
  );
  const revealedVouchers = voteKeys.map(voteKey => vouchers.get(voteKey));
  if (
    revealedVouchers.some(value => !value) ||
    revealedVouchers.some(
      value =>
        rowString(value, "content_id")?.toLowerCase() !== exactBytes32(round.contentId, "Indexed content id") ||
        rowString(value, "issuer_address")?.toLowerCase() !== rowString(execution, "issuer_address")?.toLowerCase() ||
        rowString(value, "admission_policy_hash")?.toLowerCase() !==
          exactBytes32(round.admissionPolicyHash, "Indexed admission policy hash"),
    )
  ) {
    throw new TokenlessServiceError("Indexed reveals do not match issued vouchers.", 409, "evidence_source_mismatch");
  }
  const tierMix: Record<string, number> = {};
  const identityCounts = new Map<string, number>();
  const revealedCommitsByAccount = new Map<string, { committedAt: number; responseHash: string; vote: 0 | 1 }>();
  for (const [index, voucher] of (revealedVouchers as Row[]).entries()) {
    const snapshotJson = stringValue(voucher.snapshot_json, "Voucher assurance snapshot");
    const snapshotHash = stringValue(voucher.snapshot_hash, "Voucher assurance snapshot hash");
    const voucherSnapshotHash = stringValue(voucher.assurance_snapshot_hash, "Voucher-bound assurance snapshot hash");
    if (`sha256:${digest(snapshotJson)}` !== snapshotHash || voucherSnapshotHash !== snapshotHash) {
      throw new TokenlessServiceError("Voucher assurance provenance hash is invalid.", 409, "evidence_source_mismatch");
    }
    const snapshot = objectValue(JSON.parse(snapshotJson), "Voucher assurance snapshot");
    if (snapshot.reviewerSource !== voucher.reviewer_source || !Array.isArray(snapshot.assertions)) {
      throw new TokenlessServiceError("Voucher assurance provenance is inconsistent.", 409, "evidence_source_mismatch");
    }
    const assertions = snapshot.assertions as Array<{
      providerId?: unknown;
      subjectReferenceHash?: unknown;
    }>;
    const providers = [...new Set(assertions.map(value => stringValue(value.providerId, "Voucher provider")))].sort();
    const subjects = [
      ...new Set(assertions.map(value => stringValue(value.subjectReferenceHash, "Voucher identity subject"))),
    ].sort();
    if (!providers.length || !subjects.length) {
      throw new TokenlessServiceError("Voucher assurance provenance is incomplete.", 409, "evidence_source_mismatch");
    }
    const tier = `providers:${providers.join("+")}`;
    tierMix[tier] = (tierMix[tier] ?? 0) + 1;
    const identity = subjects.join("+");
    identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1);
    const account = exactAddress(voucher.account_address, "Voucher account");
    const commit = revealed[index];
    const vote = integerValue(commit.vote, `Reveal ${index} vote`);
    const committedAtValue = unsignedValue(commit.committedAt, `Reveal ${index} committed timestamp`);
    if (BigInt(committedAtValue) > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new TokenlessServiceError(
        `Reveal ${index} committed timestamp is malformed.`,
        409,
        "indexed_evidence_invalid",
      );
    }
    revealedCommitsByAccount.set(account, {
      committedAt: Number(committedAtValue),
      responseHash: responseHashes[index],
      vote: vote as 0 | 1,
    });
  }
  const assurance = await assuranceProvenance({
    roundId: rowString(execution, "round_id")!,
    contentId: exactBytes32(round.contentId, "Indexed content id"),
    admissionPolicyHash: exactBytes32(round.admissionPolicyHash, "Indexed admission policy hash"),
    revealCount,
    minimumReveals: integerValue(round.minimumReveals, "Indexed minimum reveals"),
    revealedCommitsByAccount,
  });
  const issuedIdentities = new Set(
    vouchersResult.rows.map(value => {
      const snapshot = JSON.parse(rowString(value as Row, "snapshot_json")!) as {
        assertions: Array<{
          subjectReferenceHash?: unknown;
        }>;
      };
      const assertions = snapshot.assertions;
      return [...new Set(assertions.map(assertion => String(assertion.subjectReferenceHash)))].sort().join("+");
    }),
  );
  const largestIdentityCluster = Math.max(...identityCounts.values());
  const quoteEconomics = objectValue(JSON.parse(rowString(execution, "economics_json")!), "Stored economics");
  const fee = objectValue(quoteEconomics.fee, "Stored fee economics");
  const bountyAmount = unsignedValue(round.bountyAmount, "Indexed bounty amount");
  const feeAmount = unsignedValue(round.feeAmount, "Indexed fee amount");
  const attemptReserve = unsignedValue(round.attemptReserve, "Indexed attempt reserve");
  const liability = BigInt(totalFinalizedLiability);
  if (liability > BigInt(bountyAmount)) {
    throw new TokenlessServiceError("Finalized liability exceeds the bounty.", 409, "indexed_evidence_invalid");
  }
  const bountyRefund = BigInt(bountyAmount) - liability;
  const funderRefund = unsignedValue(round.funderRefund, "Indexed funder refund");
  if (BigInt(funderRefund) !== BigInt(attemptReserve) + bountyRefund) {
    throw new TokenlessServiceError("Indexed finalized refund does not conserve.", 409, "indexed_evidence_invalid");
  }
  const totalFundedAtomic = (BigInt(bountyAmount) + BigInt(feeAmount) + BigInt(attemptReserve)).toString();
  if (totalFundedAtomic !== rowString(execution, "total_funded_atomic")) {
    throw new TokenlessServiceError(
      "Indexed funding does not match the pinned execution.",
      409,
      "round_terms_mismatch",
    );
  }
  const evidence: IndexedFinalizedEvidence = {
    deploymentKey: rowString(execution, "deployment_key")!,
    roundId: rowString(execution, "round_id")!,
    revealCount,
    upVotes,
    economics: {
      asset: "USDC",
      decimals: 6,
      bounty: {
        fundedAtomic: bountyAmount,
        paidAtomic: totalFinalizedLiability,
        refundedAtomic: bountyRefund.toString(),
      },
      fee: {
        bps: integerValue(fee.bps, "Stored fee bps"),
        fundedAtomic: feeAmount,
        paidAtomic: feeAmount,
        refundedAtomic: "0",
      },
      attemptReserve: { fundedAtomic: attemptReserve, compensatedAtomic: "0", refundedAtomic: attemptReserve },
      refund: {
        bountyAtomic: bountyRefund.toString(),
        feeAtomic: "0",
        attemptReserveAtomic: attemptReserve,
        totalAtomic: funderRefund,
      },
      compensation: {
        perAcceptedRevealCapAtomic: unsignedValue(round.attemptCompensation, "Indexed attempt compensation"),
        recipientCount: 0,
        totalAtomic: "0",
      },
      totalFundedAtomic,
    },
    tierMix,
    diversity: {
      independentClusters: identityCounts.size,
      largestClusterBps: ratioBps(largestIdentityCluster, revealCount),
      uniqueVoteKeys: new Set(voteKeys).size,
    },
    analytics: {
      answerFingerprintRiskBps: duplicateRiskBps(responseHashes),
      correlationRiskBps: assurance.correlationRiskBps,
      issuedVoucherCount: vouchersResult.rows.length,
      verifiedIdentityCount: issuedIdentities.size,
    },
    provenance: {
      assignmentCount: assurance.assignmentCount,
      issuedVoucherCount: vouchersResult.rows.length,
      matchedAssignmentCount: assurance.matchedAssignmentCount,
      validResponseCount: assurance.validResponseCount,
      verifiedIdentityCount: issuedIdentities.size,
    },
    scoring: {
      entropy,
      scoringBeaconRound,
      fixedBasePayAtomic: fixedBasePay,
      maximumBonusAtomic: maximumBonus,
      mode: scoringMode,
      revealSetSum,
      revealSetXor,
      scoringSeed,
      totalFinalizedLiabilityAtomic: totalFinalizedLiability,
      totalRbtsScoreBps,
      totalSquaredRbtsScoreBps2,
      version: RBTS_SCORING_VERSION,
    },
    roundTerms: {
      admissionPolicyHash: exactBytes32(round.admissionPolicyHash, "Indexed admission policy hash"),
      commitDeadline: unsignedValue(round.commitDeadline, "Indexed commit deadline"),
      contentId: exactBytes32(round.contentId, "Indexed content id"),
      termsHash: exactBytes32(round.termsHash, "Indexed terms hash"),
    },
    chain: {
      blockNumber: finalizedBlock,
      blockHash: exactBytes32(round.finalizedBlockHash, "Finalized block hash"),
      transactionHash: exactBytes32(round.finalizedTxHash, "Finalized transaction hash"),
      timestamp: finalizedAt,
    },
  };
  validateFinalizedEvidence(evidence);
  await verifyPublicRaterResponseCommitments({
    operationKey: input.operationKey,
    reveals: voteKeys.map((voteKey, index) => ({ voteKey, responseHash: responseHashes[index] as Hex })),
  });
  return { evidence, integrityInput: assurance.integrityInput, surpriseReports: normativeReveals };
}

export async function deriveFinalizedRoundEvidence(input: {
  operationKey: string;
  fetchImpl?: typeof fetch;
  ponderUrl?: string;
}) {
  return (await deriveFinalizedRoundEvidenceBundle(input)).evidence;
}

function immutableFinalizedEvidenceIdentity(evidence: IndexedFinalizedEvidence) {
  return {
    ...evidence,
    analytics: { ...evidence.analytics, correlationRiskBps: 0 },
    provenance: {
      ...evidence.provenance,
      assignmentCount: 0,
      matchedAssignmentCount: 0,
      validResponseCount: 0,
    },
  };
}

export async function appendFinalizedRoundEvidence(input: {
  operationKey: string;
  fetchImpl?: typeof fetch;
  ponderUrl?: string;
}) {
  const { evidence, integrityInput, surpriseReports } = await deriveFinalizedRoundEvidenceBundle(input);
  await requireCanonicalEvidenceFinality(evidence);
  await finalizeSurpriseBountyRound({
    operationKey: input.operationKey,
    deploymentKey: evidence.deploymentKey,
    roundId: evidence.roundId,
    reports: surpriseReports,
  });
  const ownership = await dbClient.execute({
    sql: "SELECT workspace_id FROM tokenless_ask_ownership WHERE operation_key = ? LIMIT 1",
    args: [input.operationKey],
  });
  const workspaceId = rowString(ownership.rows[0] as Row | undefined, "workspace_id");
  if (!workspaceId) throw new TokenlessServiceError("Ask chain execution was not found.", 404, "ask_not_found");
  if (
    !UNSIGNED_INTEGER.test(evidence.chain.timestamp) ||
    BigInt(evidence.chain.timestamp) > BigInt(Math.floor(Date.now() / 1_000) + 300)
  ) {
    throw new TokenlessServiceError("Finalization timestamp is invalid.", 409, "indexed_evidence_invalid");
  }
  const evidenceJson = stableTransparencyJson(evidence);
  const evidenceHash = digest(`round.finalized:${evidenceJson}`);
  const eventId = `tpe_${digest(`${input.operationKey}:${evidenceHash}`).slice(0, 32)}`;
  const existingEvidence = await dbClient.execute({
    sql: `SELECT event_id, evidence_hash, evidence_json FROM tokenless_transparency_events
          WHERE operation_key = ? AND event_type = 'round.finalized' LIMIT 1`,
    args: [input.operationKey],
  });
  const existingRow = existingEvidence.rows[0] as Row | undefined;
  const existingHash = rowString(existingRow, "evidence_hash");
  if (existingHash) {
    if (existingHash !== evidenceHash) {
      const storedEvidence = JSON.parse(rowString(existingRow, "evidence_json")!) as IndexedFinalizedEvidence;
      if (
        stableTransparencyJson(immutableFinalizedEvidenceIdentity(storedEvidence)) !==
        stableTransparencyJson(immutableFinalizedEvidenceIdentity(evidence))
      ) {
        throw new TokenlessServiceError("Finalized evidence is immutable for this ask.", 409, "evidence_conflict");
      }
      await appendPostRoundIntegrityInput({
        operationKey: input.operationKey,
        evidenceHash: existingHash,
        integrityInput,
      });
      return { eventId: rowString(existingRow, "event_id")!, evidenceHash: existingHash };
    }
    await appendPostRoundIntegrityInput({ operationKey: input.operationKey, evidenceHash, integrityInput });
    return { eventId, evidenceHash };
  }
  const sequenceResult = await dbClient.execute({
    sql: "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM tokenless_transparency_events WHERE operation_key = ?",
    args: [input.operationKey],
  });
  const sequence = Number(rowString(sequenceResult.rows[0] as Row | undefined, "sequence") ?? "1");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_transparency_events
          (event_id, operation_key, workspace_id, deployment_key, round_id, sequence, event_type, evidence_hash, evidence_json, occurred_at, recorded_at)
          VALUES (?, ?, ?, ?, ?, ?, 'round.finalized', ?, ?, ?, ?)
          ON CONFLICT (operation_key, evidence_hash) DO NOTHING`,
    args: [
      eventId,
      input.operationKey,
      workspaceId,
      evidence.deploymentKey,
      evidence.roundId,
      sequence,
      evidenceHash,
      evidenceJson,
      new Date(Number(evidence.chain.timestamp) * 1_000),
      new Date(),
    ],
  });
  await appendPostRoundIntegrityInput({ operationKey: input.operationKey, evidenceHash, integrityInput });
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_asks SET status = 'submitted', verdict_status = 'pending', updated_at = ?
          WHERE operation_key = ? AND result_json IS NULL`,
    args: [new Date(), input.operationKey],
  });
  return { eventId, evidenceHash };
}

async function appendPostRoundIntegrityInput(input: {
  operationKey: string;
  evidenceHash: string;
  integrityInput: PostRoundIntegrityInput;
}) {
  const inputJson = stableTransparencyJson({ evidenceHash: input.evidenceHash, ...input.integrityInput });
  const inputHash = `sha256:${digest(inputJson)}`;
  const existing = await dbClient.execute({
    sql: `SELECT input_id FROM tokenless_post_round_integrity_inputs
          WHERE operation_key = ? AND input_hash = ? LIMIT 1`,
    args: [input.operationKey, inputHash],
  });
  if (existing.rows.length > 0) return rowString(existing.rows[0] as Row, "input_id")!;
  const versionResult = await dbClient.execute({
    sql: `SELECT COALESCE(MAX(input_version), 0) + 1 AS input_version
          FROM tokenless_post_round_integrity_inputs WHERE operation_key = ?`,
    args: [input.operationKey],
  });
  const inputVersion = Number(rowString(versionResult.rows[0] as Row, "input_version") ?? "1");
  const inputId = `pri_${digest(`${input.operationKey}:${inputHash}`).slice(0, 32)}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_post_round_integrity_inputs
          (input_id, operation_key, evidence_hash, input_version, input_hash, policy_json,
           reports_json, inputs_complete, limitation_codes_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (operation_key, input_hash) DO NOTHING`,
    args: [
      inputId,
      input.operationKey,
      input.evidenceHash,
      inputVersion,
      inputHash,
      stableTransparencyJson(input.integrityInput.policy),
      stableTransparencyJson(input.integrityInput.reports),
      input.integrityInput.inputsComplete,
      stableTransparencyJson(input.integrityInput.limitationCodes),
      new Date(),
    ],
  });
  return inputId;
}

function evidenceRoot(hashes: string[]) {
  return digest(`rateloop-transparency-v1:${hashes.join(":")}`);
}

function selectedChoice(request: Row, scoreBps: number) {
  const question = request.question as Row | undefined;
  if (question?.kind === "head_to_head") {
    const option = scoreBps >= 5_000 ? (question.optionA as Row | undefined) : (question.optionB as Row | undefined);
    return typeof option?.key === "string" ? option.key : null;
  }
  return scoreBps >= 5_000 ? "yes" : "no";
}

export function wilsonIntervalBps(successes: number, sampleSize: number) {
  if (
    !Number.isSafeInteger(successes) ||
    !Number.isSafeInteger(sampleSize) ||
    sampleSize <= 0 ||
    successes < 0 ||
    successes > sampleSize
  ) {
    throw new TokenlessServiceError("Wilson interval inputs are invalid.", 400, "invalid_analytics");
  }
  const z = 1.959963984540054;
  const p = successes / sampleSize;
  const zSquared = z * z;
  const denominator = 1 + zSquared / sampleSize;
  const center = (p + zSquared / (2 * sampleSize)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / sampleSize + zSquared / (4 * sampleSize * sampleSize))) / denominator;
  return {
    lower: Math.max(0, Math.floor((center - margin) * BPS_MAX)),
    upper: Math.min(BPS_MAX, Math.ceil((center + margin) * BPS_MAX)),
  };
}

export async function reviewAndPublishResult(input: { operationKey: string; appOrigin: string; now?: Date }) {
  const now = input.now ?? new Date();
  const eventResult = await dbClient.execute({
    sql: `SELECT evidence_json, evidence_hash FROM tokenless_transparency_events
          WHERE operation_key = ? AND event_type = 'round.finalized' ORDER BY sequence ASC`,
    args: [input.operationKey],
  });
  if (eventResult.rows.length === 0)
    throw new TokenlessServiceError("Finalized round evidence is not indexed.", 409, "evidence_pending");
  const evidence = JSON.parse(
    rowString(eventResult.rows.at(-1) as Row | undefined, "evidence_json")!,
  ) as IndexedFinalizedEvidence;
  validateFinalizedEvidence(evidence);
  const root = evidenceRoot(eventResult.rows.map(value => rowString(value as Row, "evidence_hash")!));
  const integrityResult = await dbClient.execute({
    sql: `SELECT input_hash, policy_json, reports_json, inputs_complete, limitation_codes_json
          FROM tokenless_post_round_integrity_inputs
          WHERE operation_key = ? AND evidence_hash = ?
          ORDER BY input_version DESC LIMIT 1`,
    args: [input.operationKey, rowString(eventResult.rows.at(-1) as Row, "evidence_hash")!],
  });
  const integrity = integrityResult.rows[0] as Row | undefined;
  if (!integrity) {
    throw new TokenlessServiceError(
      "Post-round integrity inputs are not indexed.",
      409,
      "integrity_evidence_pending",
      true,
    );
  }
  const evaluation = evaluatePostRoundIntegrity({
    policy: JSON.parse(rowString(integrity, "policy_json")!) as PostRoundIntegrityPolicy,
    reports: JSON.parse(rowString(integrity, "reports_json")!) as PostRoundIntegrityReport[],
    inputsComplete: Boolean(integrity.inputs_complete),
    limitationCodes: JSON.parse(rowString(integrity, "limitation_codes_json") ?? "[]") as string[],
  });
  const existingReview = await dbClient.execute({
    sql: `SELECT review_id, review_version, reason_codes_json FROM tokenless_analytics_reviews
          WHERE operation_key = ? AND evaluation_hash = ? LIMIT 1`,
    args: [input.operationKey, evaluation.evaluationHash],
  });
  const askResult = await dbClient.execute({
    sql: `SELECT a.economics_json, q.request_json, q.response_json
          FROM tokenless_agent_asks a JOIN tokenless_agent_quotes q ON q.quote_id = a.quote_id
          WHERE a.operation_key = ? LIMIT 1`,
    args: [input.operationKey],
  });
  const ask = askResult.rows[0] as Row | undefined;
  if (!ask) throw new TokenlessServiceError("Ask not found.", 404, "ask_not_found");
  const quote = JSON.parse(rowString(ask, "response_json")!) as Row;
  const request = JSON.parse(rowString(ask, "request_json")!) as Row;
  const audience = quote.audience as Row;
  const commitDeadlineMilliseconds = Number(BigInt(evidence.roundTerms.commitDeadline) * 1_000n);
  const commitDeadline = new Date(commitDeadlineMilliseconds);
  if (!Number.isSafeInteger(commitDeadlineMilliseconds) || !Number.isFinite(commitDeadline.getTime())) {
    throw new TokenlessServiceError("Frozen commit deadline is invalid.", 409, "invalid_round_evidence");
  }
  const preferenceShareBps = Math.floor((evidence.upVotes * BPS_MAX) / evidence.revealCount);
  const intervalBps = wilsonIntervalBps(evidence.upVotes, evidence.revealCount);
  const terminal = evaluation.status !== "pending";
  const feedback = await listAuthorizedTerminalPublicFeedback({ operationKey: input.operationKey, terminal });
  const result = parseTokenlessResult({
    schemaVersion: TOKENLESS_SCHEMA_VERSION,
    operationKey: input.operationKey,
    roundId: evidence.roundId,
    verdictStatus: evaluation.status,
    terminal,
    responseWindowSeconds: quote.responseWindowSeconds,
    commitDeadline: commitDeadline.toISOString(),
    requestProfile: quote.requestProfile ?? null,
    reviewEconomics: quote.reviewEconomics ?? null,
    economics: evidence.economics,
    audience: {
      admissionPolicyHash: audience.admissionPolicyHash,
      label: audience.label,
      participantCount: evidence.revealCount,
      source: audience.source,
    },
    verdict:
      evaluation.status === "publishable"
        ? {
            intervalBps,
            preferenceShareBps,
            selected: selectedChoice(request, preferenceShareBps),
          }
        : null,
    feedback,
    methodologyUrl: `${input.appOrigin.replace(/\/$/, "")}/docs/how-it-works`,
    updatedAt: now.toISOString(),
  });
  if (existingReview.rows.length === 0) {
    const versionResult = await dbClient.execute({
      sql: "SELECT COALESCE(MAX(review_version), 0) + 1 AS review_version FROM tokenless_analytics_reviews WHERE operation_key = ?",
      args: [input.operationKey],
    });
    const reviewVersion = Number(rowString(versionResult.rows[0] as Row, "review_version") ?? "1");
    const reviewId = `anr_${digest(`${input.operationKey}:${evaluation.evaluationHash}`).slice(0, 32)}`;
    await dbClient.execute({
      sql: `INSERT INTO tokenless_analytics_reviews
            (review_id, operation_key, review_version, decision, evidence_root, tier_mix_json, diversity_json,
             metrics_json, reason_codes_json, reviewed_at, evaluation_schema_version, evaluation_hash,
             aggregates_json, limitation_codes_json, remediation, effect, payout_effect)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (operation_key, evaluation_hash) DO NOTHING`,
      args: [
        reviewId,
        input.operationKey,
        reviewVersion,
        evaluation.status,
        root,
        stableTransparencyJson(evidence.tierMix),
        stableTransparencyJson(evidence.diversity),
        stableTransparencyJson(evidence.analytics),
        stableTransparencyJson(evaluation.reasonCodes),
        now,
        evaluation.schemaVersion,
        evaluation.evaluationHash,
        stableTransparencyJson(evaluation.aggregates),
        stableTransparencyJson(evaluation.limitationCodes),
        evaluation.remediation,
        evaluation.effect,
        evaluation.payoutEffect,
      ],
    });
  }
  if (evaluation.status === "pending") {
    await dbClient.execute({
      sql: `UPDATE tokenless_agent_asks SET status = 'submitted', verdict_status = 'pending', updated_at = ?
            WHERE operation_key = ? AND result_json IS NULL`,
      args: [now, input.operationKey],
    });
    return { evidenceRoot: root, publicationId: null, reasonCodes: evaluation.reasonCodes, evaluation, result };
  }
  const existingPublication = await dbClient.execute({
    sql: `SELECT publication_id, evidence_root, evaluation_hash, result_json
          FROM tokenless_result_publications WHERE operation_key = ? LIMIT 1`,
    args: [input.operationKey],
  });
  const existing = existingPublication.rows[0] as Row | undefined;
  if (existing) {
    if (
      rowString(existing, "evidence_root") !== root ||
      rowString(existing, "evaluation_hash") !== evaluation.evaluationHash
    ) {
      throw new TokenlessServiceError("Published result evidence is immutable.", 409, "publication_conflict");
    }
    return {
      evidenceRoot: root,
      publicationId: rowString(existing, "publication_id")!,
      reasonCodes: evaluation.reasonCodes,
      evaluation,
      result: parseTokenlessResult(JSON.parse(rowString(existing, "result_json")!)),
    };
  }
  await requireCanonicalEvidenceFinality(evidence);
  const publicationId = `pub_${digest(`${input.operationKey}:${root}:${evaluation.evaluationHash}`).slice(0, 32)}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_result_publications
          (publication_id, operation_key, publication_version, verdict_status, evidence_root, result_json, published_at, evaluation_hash)
          VALUES (?, ?, 1, ?, ?, ?, ?, ?) ON CONFLICT (operation_key, publication_version) DO NOTHING`,
    args: [
      publicationId,
      input.operationKey,
      evaluation.status,
      root,
      JSON.stringify(result),
      now,
      evaluation.evaluationHash,
    ],
  });
  await dbClient.execute({
    sql: "UPDATE tokenless_agent_asks SET status = 'submitted', verdict_status = ?, result_json = ?, updated_at = ? WHERE operation_key = ?",
    args: [evaluation.status, JSON.stringify(result), now, input.operationKey],
  });
  await enqueuePublicationWebhooks({
    publicationId,
    operationKey: input.operationKey,
    result,
    appOrigin: input.appOrigin,
    now,
  });
  return { evidenceRoot: root, publicationId, reasonCodes: evaluation.reasonCodes, evaluation, result };
}

export async function appendPostRoundIntegrityReviewRecord(input: {
  operationKey: string;
  evaluationHash: string;
  recordType: "appeal" | "remediation";
  reasonCode: string;
  details?: Record<string, unknown>;
  submittedBy: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  if (!input.submittedBy.trim()) {
    throw new TokenlessServiceError("Integrity review submitter is required.", 400, "invalid_integrity_record");
  }
  const ownership = await dbClient.execute({
    sql: "SELECT workspace_id FROM tokenless_ask_ownership WHERE operation_key = ? LIMIT 1",
    args: [input.operationKey],
  });
  const workspaceId = rowString(ownership.rows[0] as Row | undefined, "workspace_id");
  if (!workspaceId) throw new TokenlessServiceError("Result not found.", 404, "result_not_found");
  await requireWorkspaceMember(input.submittedBy, workspaceId);
  const evaluation = await dbClient.execute({
    sql: `SELECT evaluation_hash FROM tokenless_analytics_reviews
          WHERE operation_key = ? AND evaluation_hash = ? LIMIT 1`,
    args: [input.operationKey, input.evaluationHash],
  });
  if (evaluation.rows.length === 0) {
    throw new TokenlessServiceError("Integrity evaluation was not found.", 404, "integrity_evaluation_not_found");
  }
  const appealBinding = createPostRoundIntegrityAppeal({
    evaluationHash: input.evaluationHash,
    appealId: `appeal_${digest(`${input.operationKey}:${input.submittedBy}:${now.toISOString()}`).slice(0, 32)}`,
    reasonCode: input.reasonCode,
    submittedAt: now.toISOString(),
  });
  const detailsJson = stableTransparencyJson(input.details ?? {});
  const recordHash = `sha256:${digest(
    stableTransparencyJson({
      appealBinding,
      recordType: input.recordType,
      details: JSON.parse(detailsJson),
      submittedBy: input.submittedBy,
    }),
  )}`;
  const recordId = `pir_${digest(`${input.operationKey}:${recordHash}`).slice(0, 32)}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_post_round_integrity_records
          (record_id, operation_key, evaluation_hash, record_type, reason_code, details_json,
           record_hash, submitted_by, effect, payout_effect, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'append_only_review', 'none', ?)
          ON CONFLICT (operation_key, record_hash) DO NOTHING`,
    args: [
      recordId,
      input.operationKey,
      input.evaluationHash,
      input.recordType,
      input.reasonCode,
      detailsJson,
      recordHash,
      input.submittedBy,
      now,
    ],
  });
  return {
    recordId,
    recordHash,
    effect: "append_only_review" as const,
    payoutEffect: "none" as const,
  };
}

async function enqueuePublicationWebhooks(input: {
  publicationId: string;
  operationKey: string;
  result: TokenlessResult;
  appOrigin: string;
  now: Date;
}) {
  const subscriptions = await dbClient.execute({
    sql: `SELECT s.endpoint_id, s.event_types_json FROM tokenless_ask_webhook_subscriptions s
          JOIN tokenless_webhook_endpoints e ON e.endpoint_id = s.endpoint_id
          WHERE s.operation_key = ? AND e.active = true`,
    args: [input.operationKey],
  });
  for (const value of subscriptions.rows) {
    const row = value as Row;
    const events = new Set<string>(JSON.parse(rowString(row, "event_types_json") ?? "[]"));
    if (!events.has("result.ready")) continue;
    const endpointId = rowString(row, "endpoint_id")!;
    const idempotencyKey = `whd_${digest(`${endpointId}:${input.publicationId}:result.ready`).slice(0, 40)}`;
    const payload = {
      schemaVersion: TOKENLESS_SCHEMA_VERSION,
      eventId: input.publicationId,
      eventType: "result.ready",
      occurredAt: input.now.toISOString(),
      operationKey: input.operationKey,
      verdictStatus: input.result.verdictStatus,
      resultUrl: `${input.appOrigin.replace(/\/$/, "")}/api/agent/v1/results/${encodeURIComponent(input.operationKey)}`,
    };
    await dbClient.execute({
      sql: `INSERT INTO tokenless_webhook_deliveries
            (delivery_id, publication_id, endpoint_id, event_type, idempotency_key, payload_json, attempt_count, state, next_attempt_at, created_at, updated_at)
            VALUES (?, ?, ?, 'result.ready', ?, ?, 0, 'pending', ?, ?, ?)
            ON CONFLICT (idempotency_key) DO NOTHING`,
      args: [
        idempotencyKey,
        input.publicationId,
        endpointId,
        idempotencyKey,
        stableTransparencyJson(payload),
        input.now,
        input.now,
        input.now,
      ],
    });
  }
}

export async function deliverPendingWebhooks(
  input: {
    fetchImpl?: WebhookFetch;
    now?: Date;
    limit?: number;
    encryptionKey?: string;
    resolveHostname?: ResolveHostname;
    operationKey?: string;
  } = {},
) {
  const fetchImpl = input.fetchImpl ?? deliverOverPinnedAddress;
  const now = input.now ?? new Date();
  const operationFilter = input.operationKey ? "AND p.operation_key = ?" : "";
  const due = await dbClient.execute({
    sql: `SELECT d.delivery_id, d.idempotency_key, d.payload_json, d.attempt_count, d.lease_generation,
                 e.url, e.secret_ciphertext
          FROM tokenless_webhook_deliveries d
          JOIN tokenless_webhook_endpoints e ON e.endpoint_id = d.endpoint_id
          JOIN tokenless_result_publications p ON p.publication_id = d.publication_id
          WHERE e.active = true AND (
            (d.state IN ('pending', 'retry') AND d.next_attempt_at <= ?)
            OR (d.state = 'delivering' AND d.lease_expires_at <= ?)
          )
          ${operationFilter}
          ORDER BY d.next_attempt_at ASC LIMIT ?`,
    args: [
      now,
      now,
      ...(input.operationKey ? [input.operationKey] : []),
      Math.min(Math.max(input.limit ?? 25, 1), 100),
    ],
  });
  const outcomes = [];
  for (const value of due.rows) {
    const row = value as Row;
    const deliveryId = rowString(row, "delivery_id")!;
    // Claim the row with a fresh lease generation, reclaiming any delivering row
    // whose lease has expired (a crash between claim and completion). A stale
    // worker's later completion write is fenced by the generation it captured.
    const previousGeneration = Number(row.lease_generation ?? 0);
    const claimGeneration = previousGeneration + 1;
    const leaseExpiresAt = new Date(now.getTime() + WEBHOOK_DELIVERY_LEASE_MS);
    const claimed = await dbClient.execute({
      sql: `UPDATE tokenless_webhook_deliveries
            SET state = 'delivering', lease_expires_at = ?, lease_generation = ?, updated_at = ?
            WHERE delivery_id = ? AND lease_generation = ? AND (
              state IN ('pending', 'retry') OR (state = 'delivering' AND lease_expires_at <= ?)
            )`,
      args: [leaseExpiresAt, claimGeneration, now, deliveryId, previousGeneration, now],
    });
    if (claimed.rowCount !== 1) continue;
    const payload = rowString(row, "payload_json")!;
    const timestamp = String(Math.floor(now.getTime() / 1_000));
    const signature = `v1=${createHmac(
      "sha256",
      decryptSecret(rowString(row, "secret_ciphertext")!, input.encryptionKey),
    )
      .update(`${timestamp}.${payload}`)
      .digest("hex")}`;
    const attempt = Number(row.attempt_count) + 1;
    try {
      const pinnedAddress = await assertPublicWebhookDestination(rowString(row, "url")!, input.resolveHostname);
      const response = await fetchImpl(rowString(row, "url")!, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "rateloop-delivery-id": rowString(row, "idempotency_key")!,
          "rateloop-signature": signature,
          "rateloop-timestamp": timestamp,
        },
        body: payload,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        pinnedAddress,
      });
      if (response.ok) {
        const completed = await dbClient.execute({
          sql: `UPDATE tokenless_webhook_deliveries SET state = 'delivered', attempt_count = ?, response_status = ?, last_error = NULL, delivered_at = ?, lease_expires_at = NULL, updated_at = ? WHERE delivery_id = ? AND lease_generation = ? AND state = 'delivering'`,
          args: [attempt, response.status, now, now, deliveryId, claimGeneration],
        });
        // The lease was reclaimed by another worker mid-flight; drop this write.
        if (completed.rowCount !== 1) continue;
        outcomes.push({ deliveryId, state: "delivered" });
        continue;
      }
      throw Object.assign(new Error(`HTTP ${response.status}`), { responseStatus: response.status });
    } catch (error) {
      const dead = attempt >= MAX_DELIVERY_ATTEMPTS;
      const delayMs = Math.min(30_000 * 2 ** (attempt - 1), 3_600_000);
      const message = error instanceof Error ? error.message.slice(0, 500) : "Delivery failed";
      const responseStatus = (error as { responseStatus?: number }).responseStatus ?? null;
      const rescheduled = await dbClient.execute({
        sql: `UPDATE tokenless_webhook_deliveries SET state = ?, attempt_count = ?, response_status = ?, last_error = ?, next_attempt_at = ?, lease_expires_at = NULL, updated_at = ? WHERE delivery_id = ? AND lease_generation = ? AND state = 'delivering'`,
        args: [
          dead ? "dead" : "retry",
          attempt,
          responseStatus,
          message,
          new Date(now.getTime() + delayMs),
          now,
          deliveryId,
          claimGeneration,
        ],
      });
      // A newer worker owns the lease; do not overwrite its progress.
      if (rescheduled.rowCount !== 1) continue;
      outcomes.push({ deliveryId, state: dead ? "dead" : "retry" });
    }
  }
  return outcomes;
}

export async function inspectWorkspaceTransparency(input: {
  accountAddress: string;
  workspaceId: string;
  operationKey: string;
}) {
  await requireWorkspaceMember(input.accountAddress, input.workspaceId);
  const ownership = await dbClient.execute({
    sql: "SELECT operation_key FROM tokenless_ask_ownership WHERE operation_key = ? AND workspace_id = ? LIMIT 1",
    args: [input.operationKey, input.workspaceId],
  });
  if (ownership.rows.length === 0) throw new TokenlessServiceError("Result not found.", 404, "result_not_found");
  const [events, surpriseBounties, reviews, records, publications, deliveries] = await Promise.all([
    dbClient.execute({
      sql: "SELECT event_id, sequence, event_type, deployment_key, round_id, evidence_hash, evidence_json, occurred_at, recorded_at FROM tokenless_transparency_events WHERE operation_key = ? ORDER BY sequence ASC",
      args: [input.operationKey],
    }),
    dbClient.execute({
      sql: `SELECT version, state, round_id, policy_json, guaranteed_base_per_report_atomic,
                   maximum_bonus_per_report_atomic, maximum_liability_atomic, sample_size, actual_up_bps,
                   mean_predicted_up_bps, surprisingly_popular_outcome, allocation_hash, evidence_hash,
                   total_bonus_atomic, paid_bonus_atomic, finalized_at, completed_at
            FROM tokenless_surprise_bounty_rounds WHERE operation_key = ? LIMIT 1`,
      args: [input.operationKey],
    }),
    dbClient.execute({
      sql: `SELECT review_id, review_version, decision, evidence_root, tier_mix_json, diversity_json,
                   metrics_json, reason_codes_json, evaluation_schema_version, evaluation_hash,
                   aggregates_json, limitation_codes_json, remediation, effect, payout_effect, reviewed_at
            FROM tokenless_analytics_reviews WHERE operation_key = ? ORDER BY review_version ASC`,
      args: [input.operationKey],
    }),
    dbClient.execute({
      sql: `SELECT record_id, evaluation_hash, record_type, reason_code, details_json, record_hash,
                   submitted_by, effect, payout_effect, created_at
            FROM tokenless_post_round_integrity_records WHERE operation_key = ? ORDER BY created_at ASC`,
      args: [input.operationKey],
    }),
    dbClient.execute({
      sql: "SELECT publication_id, publication_version, verdict_status, evidence_root, result_json, published_at FROM tokenless_result_publications WHERE operation_key = ? ORDER BY publication_version ASC",
      args: [input.operationKey],
    }),
    dbClient.execute({
      sql: `SELECT d.delivery_id, d.event_type, d.idempotency_key, d.attempt_count, d.state, d.next_attempt_at, d.response_status, d.last_error, d.delivered_at, e.url
                            FROM tokenless_webhook_deliveries d JOIN tokenless_result_publications p ON p.publication_id = d.publication_id
                            JOIN tokenless_webhook_endpoints e ON e.endpoint_id = d.endpoint_id
                            WHERE p.operation_key = ? ORDER BY d.created_at ASC`,
      args: [input.operationKey],
    }),
  ]);
  const parseJsonColumns = (rows: readonly Row[], columns: string[]) =>
    rows.map(row =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          columns.includes(key) && typeof value === "string"
            ? JSON.parse(value)
            : value instanceof Date
              ? value.toISOString()
              : value,
        ]),
      ),
    );
  return {
    operationKey: input.operationKey,
    events: parseJsonColumns(events.rows as Row[], ["evidence_json"]),
    analyticsReviews: parseJsonColumns(reviews.rows as Row[], [
      "tier_mix_json",
      "diversity_json",
      "metrics_json",
      "reason_codes_json",
      "aggregates_json",
      "limitation_codes_json",
    ]),
    integrityReviewRecords: parseJsonColumns(records.rows as Row[], ["details_json"]),
    publications: parseJsonColumns(publications.rows as Row[], ["result_json"]),
    webhookDeliveries: parseJsonColumns(deliveries.rows as Row[], []),
    surpriseBounties: parseJsonColumns(surpriseBounties.rows as Row[], ["policy_json"]),
  };
}

export const __transparencyTestUtils = { decryptSecret, digest, encryptSecret, evidenceRoot };
