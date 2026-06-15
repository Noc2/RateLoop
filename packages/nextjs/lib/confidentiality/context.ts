import type { NextRequest } from "next/server";
import deployedContracts from "@rateloop/contracts/deployedContracts";
import { createHash, createHmac, randomBytes } from "crypto";
import { and, eq, gte, isNull, lt } from "drizzle-orm";
import "server-only";
import {
  type Abi,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  zeroAddress,
  zeroHash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildSignedActionMessage, hashSignedActionPayload } from "~~/lib/auth/signedActions";
import { GATED_CONTEXT_SIGNED_READ_SESSION_COOKIE_NAME, verifySignedReadSession } from "~~/lib/auth/signedReadSessions";
import {
  CONFIDENTIALITY_TERMS_TEXT,
  CONFIDENTIALITY_TERMS_URI,
  CONFIDENTIALITY_TERMS_VERSION,
} from "~~/lib/confidentiality/terms";
import { db } from "~~/lib/db";
import {
  confidentialContextAccessLogs,
  confidentialityLogRoots,
  confidentialityTermsAcceptances,
  questionConfidentiality,
} from "~~/lib/db/schema";
import { getPrimaryServerTargetNetwork, getServerRpcOverrides } from "~~/lib/env/server";
import { isValidWalletAddress, normalizeWalletAddress } from "~~/lib/watchlist/contentWatch";

export const CONFIDENTIALITY_TERMS_ACTION = "confidentiality_terms:accept";
export const CONFIDENTIALITY_TERMS_CHALLENGE_TITLE = "RateLoop confidential context";
export const CONFIDENTIALITY_TERMS_DOC_HASH = createHash("sha256")
  .update(`${CONFIDENTIALITY_TERMS_VERSION}\n${CONFIDENTIALITY_TERMS_URI}\n${CONFIDENTIALITY_TERMS_TEXT}`)
  .digest("hex");
export { CONFIDENTIALITY_TERMS_TEXT, CONFIDENTIALITY_TERMS_URI, CONFIDENTIALITY_TERMS_VERSION };

const BYTES32_HEX_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const CONTENT_ID_PATTERN = /^[0-9]{1,78}$/;
const RESOURCE_ID_PATTERN = /^(att|det)_[A-Za-z0-9_-]{16,80}$/;

export type DisclosurePolicy = "after_settlement" | "private_forever";
export type ResourceKind = "image" | "details";

export interface ConfidentialityTermsPayload {
  contentHash: `0x${string}` | null;
  contentId: string;
  detailsHash: `0x${string}` | null;
  identityKey: `0x${string}` | null;
  mediaTupleHash: `0x${string}` | null;
  normalizedAddress: `0x${string}`;
  questionMetadataHash: `0x${string}` | null;
  termsDocHash: string;
  termsUri: string;
  termsVersion: string;
}

type ConfidentialityMetadataInput = {
  contentHash?: unknown;
  confidentiality?: unknown;
  detailsHash?: unknown;
  mediaTupleHash?: unknown;
  questionMetadataHash?: unknown;
};

type StoredConfidentiality = typeof questionConfidentiality.$inferSelect;

type DeployedContract = {
  address: Address;
  abi: Abi;
};

type DeployedContractsMap = Record<number, Record<string, DeployedContract | undefined> | undefined>;

type ResolvedConfidentialityViewer = {
  delegated: boolean;
  hasActiveHumanCredential: boolean;
  holder: Address | null;
  humanNullifier: `0x${string}` | null;
  identityKey: `0x${string}` | null;
};

type ConfidentialityOnchainGate = {
  hasActiveBond: (params: { contentId: string; identityKey: `0x${string}` }) => Promise<boolean>;
  isIdentityKeyBanned: (identityKey: `0x${string}`) => Promise<boolean>;
  resolveViewer: (walletAddress: `0x${string}`) => Promise<ResolvedConfidentialityViewer>;
};

type GateReadResult<T> = { ok: true; value: T } | { ok: false; error: string };

const PROTOCOL_CONFIG_CONFIDENTIALITY_ABI = [
  {
    type: "function",
    name: "confidentialityEscrow",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
] as const satisfies Abi;

const RATER_REGISTRY_CONFIDENTIALITY_ABI = [
  {
    type: "function",
    name: "isIdentityKeyBanned",
    inputs: [{ name: "identityKey", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
] as const satisfies Abi;

const CONFIDENTIALITY_ESCROW_READ_ABI = [
  {
    type: "function",
    name: "hasActiveBond",
    inputs: [
      { name: "contentId", type: "uint256" },
      { name: "identityKey", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
] as const satisfies Abi;

const CONFIDENTIALITY_ESCROW_LOG_ROOT_ABI = [
  {
    type: "function",
    name: "publishLogRoot",
    inputs: [
      { name: "epoch", type: "string" },
      { name: "merkleRoot", type: "bytes32" },
      { name: "artifactHash", type: "bytes32" },
      { name: "artifactUri", type: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const satisfies Abi;

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

let confidentialityGateOverrideForTests: ConfidentialityOnchainGate | null = null;

export function __setConfidentialityOnchainGateForTests(gate: ConfidentialityOnchainGate | null) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("__setConfidentialityOnchainGateForTests is only available in tests.");
  }
  confidentialityGateOverrideForTests = gate;
}

function isBytes32Hex(value: unknown): value is `0x${string}` {
  return typeof value === "string" && BYTES32_HEX_PATTERN.test(value);
}

function normalizeOptionalBytes32(value: unknown): `0x${string}` | null {
  return isBytes32Hex(value) ? (value.toLowerCase() as `0x${string}`) : null;
}

function normalizeContentId(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") return null;
  const normalized = value.toString().trim();
  return CONTENT_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeIdentityKey(value: unknown): `0x${string}` | null {
  return normalizeOptionalBytes32(value);
}

function normalizeBondAmount(value: unknown) {
  if (typeof value === "bigint") return value >= 0n ? value.toString() : "0";
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^[0-9]+$/.test(value.trim())) return value.trim();
  return "0";
}

function normalizeBondAsset(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return normalized === "LREP" || normalized === "USDC" ? normalized : null;
}

function parseMetadataConfidentiality(value: unknown): {
  bondAmount: string;
  bondAsset: string | null;
  disclosurePolicy: DisclosurePolicy;
  gated: boolean;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { bondAmount: "0", bondAsset: null, disclosurePolicy: "after_settlement", gated: false };
  }

  const record = value as Record<string, unknown>;
  const visibility = typeof record.visibility === "string" ? record.visibility.trim() : "public";
  const disclosure =
    record.disclosurePolicy === "private_forever" ? "private_forever" : ("after_settlement" as DisclosurePolicy);
  const bond = record.bond && typeof record.bond === "object" && !Array.isArray(record.bond) ? record.bond : null;
  return {
    bondAmount: bond ? normalizeBondAmount((bond as Record<string, unknown>).amount) : "0",
    bondAsset: bond ? normalizeBondAsset((bond as Record<string, unknown>).asset) : null,
    disclosurePolicy: disclosure,
    gated: visibility === "gated",
  };
}

export function normalizeConfidentialityTermsInput(
  body: Record<string, unknown>,
): { ok: true; payload: ConfidentialityTermsPayload } | { ok: false; error: string } {
  if (!body.address || typeof body.address !== "string" || !isValidWalletAddress(body.address)) {
    return { ok: false, error: "Invalid wallet address" };
  }
  const contentId = normalizeContentId(body.contentId);
  if (!contentId) return { ok: false, error: "Invalid content id" };

  const termsVersion =
    typeof body.termsVersion === "string" && body.termsVersion.trim()
      ? body.termsVersion.trim()
      : CONFIDENTIALITY_TERMS_VERSION;
  if (termsVersion !== CONFIDENTIALITY_TERMS_VERSION) {
    return { ok: false, error: "Unsupported terms version" };
  }

  return {
    ok: true,
    payload: {
      contentHash: normalizeOptionalBytes32(body.contentHash),
      contentId,
      detailsHash: normalizeOptionalBytes32(body.detailsHash),
      identityKey: normalizeIdentityKey(body.identityKey),
      mediaTupleHash: normalizeOptionalBytes32(body.mediaTupleHash),
      normalizedAddress: normalizeWalletAddress(body.address),
      questionMetadataHash: normalizeOptionalBytes32(body.questionMetadataHash),
      termsDocHash: CONFIDENTIALITY_TERMS_DOC_HASH,
      termsUri: CONFIDENTIALITY_TERMS_URI,
      termsVersion,
    },
  };
}

export async function buildServerConfidentialityTermsPayload(
  body: Record<string, unknown>,
): Promise<
  | { ok: true; payload: ConfidentialityTermsPayload; record: StoredConfidentiality }
  | { ok: false; error: string; status: number }
> {
  const normalized = normalizeConfidentialityTermsInput(body);
  if (!normalized.ok) return { ...normalized, status: 400 };

  const record = await getQuestionConfidentiality(normalized.payload.contentId);
  if (!record?.gated) {
    return { ok: false, status: 404, error: "Confidential context metadata unavailable" };
  }
  if (!isConfidentialityCurrentlyGated(record)) {
    return { ok: false, status: 410, error: "Confidential context is no longer gated" };
  }

  return {
    ok: true,
    payload: {
      ...normalized.payload,
      contentHash: normalizeOptionalBytes32(record.contentHash),
      detailsHash: normalizeOptionalBytes32(record.detailsHash),
      identityKey: null,
      mediaTupleHash: normalizeOptionalBytes32(record.mediaTupleHash),
      questionMetadataHash: normalizeOptionalBytes32(record.questionMetadataHash),
    },
    record,
  };
}

export function hashConfidentialityTermsPayload(payload: ConfidentialityTermsPayload) {
  return hashSignedActionPayload([
    payload.normalizedAddress,
    payload.identityKey ?? "",
    payload.contentId,
    payload.questionMetadataHash ?? "",
    payload.contentHash ?? "",
    payload.detailsHash ?? "",
    payload.mediaTupleHash ?? "",
    payload.termsVersion,
    payload.termsUri,
    payload.termsDocHash,
  ]);
}

export function buildConfidentialityTermsMessageLines(params: {
  termsDocHash: string;
  termsUri: string;
  termsVersion: string;
}) {
  return [
    `Terms URI: ${params.termsUri}`,
    `Terms Version: ${params.termsVersion}`,
    `Terms Hash: ${params.termsDocHash}`,
    `Terms: ${CONFIDENTIALITY_TERMS_TEXT}`,
  ];
}

export function buildConfidentialityTermsChallengeMessage(params: {
  address: `0x${string}`;
  payloadHash: string;
  termsDocHash: string;
  termsUri: string;
  termsVersion: string;
  nonce: string;
  expiresAt: Date;
}) {
  return buildSignedActionMessage({
    title: CONFIDENTIALITY_TERMS_CHALLENGE_TITLE,
    action: CONFIDENTIALITY_TERMS_ACTION,
    address: params.address,
    payloadHash: params.payloadHash,
    messageLines: buildConfidentialityTermsMessageLines({
      termsDocHash: params.termsDocHash,
      termsUri: params.termsUri,
      termsVersion: params.termsVersion,
    }),
    nonce: params.nonce,
    expiresAt: params.expiresAt,
  });
}

export function isConfidentialityCurrentlyGated(record: StoredConfidentiality | null | undefined) {
  return Boolean(record?.gated && !record.publishedAt);
}

export async function getQuestionConfidentiality(contentId: string) {
  const [record] = await db
    .select()
    .from(questionConfidentiality)
    .where(eq(questionConfidentiality.contentId, contentId))
    .limit(1);
  return record ?? null;
}

export async function upsertQuestionConfidentialityFromMetadata(params: {
  contentId: string;
  metadata: ConfidentialityMetadataInput | null;
  questionMetadataHash?: string | null;
}) {
  const contentId = normalizeContentId(params.contentId);
  if (!contentId || !params.metadata || typeof params.metadata !== "object" || Array.isArray(params.metadata)) return;

  const metadata = params.metadata as Record<string, unknown>;
  const confidentiality = parseMetadataConfidentiality(metadata.confidentiality);
  const now = new Date();
  await db
    .insert(questionConfidentiality)
    .values({
      bondAmount: confidentiality.bondAmount,
      bondAsset: confidentiality.bondAsset,
      contentHash: normalizeOptionalBytes32(params.metadata.contentHash),
      contentId,
      detailsHash: normalizeOptionalBytes32(params.metadata.detailsHash),
      disclosurePolicy: confidentiality.disclosurePolicy,
      gated: confidentiality.gated,
      mediaTupleHash: normalizeOptionalBytes32(params.metadata.mediaTupleHash),
      publishedAt: confidentiality.gated ? null : now,
      questionMetadataHash: normalizeOptionalBytes32(
        params.questionMetadataHash ?? params.metadata.questionMetadataHash,
      ),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: questionConfidentiality.contentId,
      set: {
        bondAmount: confidentiality.bondAmount,
        bondAsset: confidentiality.bondAsset,
        contentHash: normalizeOptionalBytes32(params.metadata.contentHash),
        detailsHash: normalizeOptionalBytes32(params.metadata.detailsHash),
        disclosurePolicy: confidentiality.disclosurePolicy,
        gated: confidentiality.gated,
        mediaTupleHash: normalizeOptionalBytes32(params.metadata.mediaTupleHash),
        questionMetadataHash: normalizeOptionalBytes32(
          params.questionMetadataHash ?? params.metadata.questionMetadataHash,
        ),
        updatedAt: now,
      },
    });
}

export async function hasConfidentialityTermsAcceptance(params: {
  contentId: string;
  payloadHash?: string;
  termsDocHash?: string;
  termsVersion?: string;
  walletAddress: `0x${string}`;
}) {
  const commonConditions = [
    eq(confidentialityTermsAcceptances.walletAddress, params.walletAddress),
    eq(confidentialityTermsAcceptances.contentId, params.contentId),
    eq(confidentialityTermsAcceptances.termsVersion, params.termsVersion ?? CONFIDENTIALITY_TERMS_VERSION),
    eq(confidentialityTermsAcceptances.termsDocHash, params.termsDocHash ?? CONFIDENTIALITY_TERMS_DOC_HASH),
  ];
  const conditions = params.payloadHash
    ? [...commonConditions, eq(confidentialityTermsAcceptances.payloadHash, params.payloadHash)]
    : commonConditions;
  const [acceptance] = await db
    .select({ id: confidentialityTermsAcceptances.id })
    .from(confidentialityTermsAcceptances)
    .where(and(...conditions))
    .limit(1);
  return Boolean(acceptance);
}

export async function recordConfidentialityTermsAcceptance(params: {
  payload: ConfidentialityTermsPayload;
  signature: `0x${string}`;
  nonce: string;
  acceptedAt?: Date;
}) {
  const acceptedAt = params.acceptedAt ?? new Date();
  const payloadHash = hashConfidentialityTermsPayload(params.payload);
  await db
    .insert(confidentialityTermsAcceptances)
    .values({
      acceptedAt,
      contentId: params.payload.contentId,
      contentHash: params.payload.contentHash,
      detailsHash: params.payload.detailsHash,
      identityKey: params.payload.identityKey,
      mediaTupleHash: params.payload.mediaTupleHash,
      nonce: params.nonce,
      payloadHash,
      questionMetadataHash: params.payload.questionMetadataHash,
      signature: params.signature,
      termsDocHash: params.payload.termsDocHash,
      termsVersion: params.payload.termsVersion,
      walletAddress: params.payload.normalizedAddress,
    })
    .onConflictDoUpdate({
      target: [
        confidentialityTermsAcceptances.walletAddress,
        confidentialityTermsAcceptances.contentId,
        confidentialityTermsAcceptances.termsVersion,
      ],
      set: {
        acceptedAt,
        contentHash: params.payload.contentHash,
        detailsHash: params.payload.detailsHash,
        identityKey: params.payload.identityKey,
        mediaTupleHash: params.payload.mediaTupleHash,
        nonce: params.nonce,
        payloadHash,
        questionMetadataHash: params.payload.questionMetadataHash,
        signature: params.signature,
        termsDocHash: params.payload.termsDocHash,
      },
    });
}

function isPositiveBondAmount(value: string | null | undefined) {
  try {
    return BigInt(value ?? "0") > 0n;
  } catch {
    return false;
  }
}

function normalizeChainAddress(value: unknown): Address | null {
  return typeof value === "string" && isAddress(value) ? getAddress(value) : null;
}

function normalizeBytes32OrNull(value: unknown): `0x${string}` | null {
  return isBytes32Hex(value) && value !== zeroHash ? (value.toLowerCase() as `0x${string}`) : null;
}

function getContractsForPrimaryServerNetwork() {
  const targetNetwork = getPrimaryServerTargetNetwork();
  if (!targetNetwork) return null;
  const contracts = (deployedContracts as unknown as DeployedContractsMap)[targetNetwork.id];
  return { contracts, targetNetwork };
}

function getServerRpcUrl(targetNetwork: Chain) {
  const rpcOverrides = getServerRpcOverrides();
  return rpcOverrides[targetNetwork.id] ?? targetNetwork.rpcUrls.default.http[0];
}

function getServerPublicClient(targetNetwork: Chain): PublicClient {
  const rpcUrl = getServerRpcUrl(targetNetwork);
  return createPublicClient({
    chain: targetNetwork,
    transport: http(rpcUrl),
  });
}

function parseResolvedConfidentialityViewer(value: unknown): ResolvedConfidentialityViewer {
  const tuple = Array.isArray(value) ? (value as readonly unknown[]) : null;
  const object =
    !tuple && value && typeof value === "object" ? (value as Record<string, unknown>) : ({} as Record<string, unknown>);

  const holder = normalizeChainAddress(tuple ? tuple[0] : object.holder);
  const identityKey = normalizeBytes32OrNull(tuple ? tuple[1] : object.identityKey);
  const humanNullifier = normalizeBytes32OrNull(tuple ? tuple[2] : object.humanNullifier);
  const hasActiveHumanCredential = Boolean(tuple ? tuple[3] : object.hasActiveHumanCredential);
  const delegated = Boolean(tuple ? tuple[4] : object.delegated);

  return {
    delegated,
    hasActiveHumanCredential,
    holder: holder && holder !== zeroAddress ? holder : null,
    humanNullifier,
    identityKey,
  };
}

async function defaultResolveViewer(
  walletAddress: `0x${string}`,
): Promise<GateReadResult<ResolvedConfidentialityViewer>> {
  const context = getContractsForPrimaryServerNetwork();
  const raterRegistry = context?.contracts?.RaterRegistry;
  if (!context || !raterRegistry) {
    return { ok: false, error: "Confidentiality identity registry is not configured" };
  }

  try {
    const resolved = await getServerPublicClient(context.targetNetwork).readContract({
      address: raterRegistry.address,
      abi: raterRegistry.abi,
      functionName: "resolveRater",
      args: [walletAddress],
    });
    return { ok: true, value: parseResolvedConfidentialityViewer(resolved) };
  } catch (error) {
    console.error("Error resolving confidential context viewer identity:", error);
    return { ok: false, error: "Confidentiality identity verification unavailable" };
  }
}

async function defaultIsIdentityKeyBanned(identityKey: `0x${string}`): Promise<GateReadResult<boolean>> {
  const context = getContractsForPrimaryServerNetwork();
  const raterRegistry = context?.contracts?.RaterRegistry;
  if (!context || !raterRegistry) {
    return { ok: false, error: "Confidentiality identity registry is not configured" };
  }

  try {
    const banned = await getServerPublicClient(context.targetNetwork).readContract({
      address: raterRegistry.address,
      abi: RATER_REGISTRY_CONFIDENTIALITY_ABI,
      functionName: "isIdentityKeyBanned",
      args: [identityKey],
    });
    return { ok: true, value: Boolean(banned) };
  } catch (error) {
    console.error("Error checking confidential context identity ban:", error);
    return { ok: false, error: "Confidentiality sanction verification unavailable" };
  }
}

async function resolveConfiguredConfidentialityEscrow(): Promise<GateReadResult<Address>> {
  const context = getContractsForPrimaryServerNetwork();
  const protocolConfig = context?.contracts?.ProtocolConfig;
  if (!context || !protocolConfig) {
    return { ok: false, error: "ProtocolConfig is not configured for confidentiality checks" };
  }

  try {
    const escrowAddress = await getServerPublicClient(context.targetNetwork).readContract({
      address: protocolConfig.address,
      abi: PROTOCOL_CONFIG_CONFIDENTIALITY_ABI,
      functionName: "confidentialityEscrow",
    });
    const normalized = normalizeChainAddress(escrowAddress);
    if (!normalized || normalized === zeroAddress) {
      return { ok: false, error: "Confidentiality escrow is not configured" };
    }
    return { ok: true, value: normalized };
  } catch (error) {
    console.error("Error resolving configured confidentiality escrow:", error);
    return { ok: false, error: "Confidentiality escrow verification unavailable" };
  }
}

async function defaultHasActiveBond(params: {
  contentId: string;
  identityKey: `0x${string}`;
}): Promise<GateReadResult<boolean>> {
  const context = getContractsForPrimaryServerNetwork();
  if (!context) {
    return { ok: false, error: "Confidentiality bond network is not configured" };
  }

  const escrow = await resolveConfiguredConfidentialityEscrow();
  if (!escrow.ok) return escrow;

  try {
    const hasActiveBond = await getServerPublicClient(context.targetNetwork).readContract({
      address: escrow.value,
      abi: CONFIDENTIALITY_ESCROW_READ_ABI,
      functionName: "hasActiveBond",
      args: [BigInt(params.contentId), params.identityKey],
    });
    return { ok: true, value: Boolean(hasActiveBond) };
  } catch (error) {
    console.error("Error checking confidential context bond:", error);
    return { ok: false, error: "Confidentiality bond verification unavailable" };
  }
}

async function resolveViewerForGatedContext(walletAddress: `0x${string}`) {
  if (confidentialityGateOverrideForTests) {
    return { ok: true as const, value: await confidentialityGateOverrideForTests.resolveViewer(walletAddress) };
  }
  return defaultResolveViewer(walletAddress);
}

async function isIdentityKeyBannedForGatedContext(identityKey: `0x${string}`) {
  if (confidentialityGateOverrideForTests) {
    return { ok: true as const, value: await confidentialityGateOverrideForTests.isIdentityKeyBanned(identityKey) };
  }
  return defaultIsIdentityKeyBanned(identityKey);
}

async function hasActiveBondForGatedContext(params: { contentId: string; identityKey: `0x${string}` }) {
  if (confidentialityGateOverrideForTests) {
    return { ok: true as const, value: await confidentialityGateOverrideForTests.hasActiveBond(params) };
  }
  return defaultHasActiveBond(params);
}

function isOwnerWalletAddress(walletAddress: `0x${string}`, ownerWalletAddress: string | null | undefined) {
  return (
    typeof ownerWalletAddress === "string" &&
    isValidWalletAddress(ownerWalletAddress) &&
    normalizeWalletAddress(ownerWalletAddress) === walletAddress
  );
}

export async function authorizeGatedContextRequest(
  request: NextRequest,
  contentId: string,
  options: { ownerWalletAddress?: string | null } = {},
) {
  const address = request.nextUrl.searchParams.get("address");
  if (!address || !isValidWalletAddress(address)) {
    return { ok: false as const, status: 401, error: "Signed wallet session required" };
  }

  const walletAddress = normalizeWalletAddress(address);
  const hasSession = await verifySignedReadSession(
    request.cookies.get(GATED_CONTEXT_SIGNED_READ_SESSION_COOKIE_NAME)?.value,
    walletAddress,
    "gated_context",
  );
  if (!hasSession) {
    return { ok: false as const, status: 401, error: "Signed wallet session required" };
  }

  if (isOwnerWalletAddress(walletAddress, options.ownerWalletAddress)) {
    return {
      ok: true as const,
      identityKey: null,
      walletAddress,
    };
  }

  const serverPayload = await buildServerConfidentialityTermsPayload({ address: walletAddress, contentId });
  if (!serverPayload.ok) {
    return { ok: false as const, status: serverPayload.status, error: serverPayload.error };
  }

  if (
    !(await hasConfidentialityTermsAcceptance({
      contentId,
      payloadHash: hashConfidentialityTermsPayload(serverPayload.payload),
      walletAddress,
    }))
  ) {
    return { ok: false as const, status: 403, error: "Confidentiality terms acceptance required" };
  }

  const resolvedViewer = await resolveViewerForGatedContext(walletAddress);
  if (!resolvedViewer.ok) {
    return { ok: false as const, status: 503, error: resolvedViewer.error };
  }

  const viewer = resolvedViewer.value;
  if (!viewer.hasActiveHumanCredential || !viewer.identityKey) {
    return { ok: false as const, status: 403, error: "Active human credential required" };
  }

  const banned = await isIdentityKeyBannedForGatedContext(viewer.identityKey);
  if (!banned.ok) {
    return { ok: false as const, status: 503, error: banned.error };
  }
  if (banned.value) {
    return { ok: false as const, status: 403, error: "Confidentiality access revoked" };
  }

  if (isPositiveBondAmount(serverPayload.record.bondAmount)) {
    const bond = await hasActiveBondForGatedContext({ contentId, identityKey: viewer.identityKey });
    if (!bond.ok) {
      return { ok: false as const, status: 503, error: bond.error };
    }
    if (!bond.value) {
      return { ok: false as const, status: 403, error: "Active confidentiality bond required" };
    }
  }

  return {
    ok: true as const,
    identityKey: viewer.identityKey,
    walletAddress,
  };
}

function getConfidentialitySecret() {
  const configured = process.env.RATELOOP_CONFIDENTIALITY_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("RATELOOP_CONFIDENTIALITY_SECRET is required for confidential context serving.");
  }
  return "rateloop-development-confidentiality-secret";
}

function hashIpAddress(request: NextRequest) {
  const value =
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "";
  if (!value) return null;
  return createHmac("sha256", getConfidentialitySecret()).update(value).digest("hex");
}

export function createConfidentialViewToken(params: {
  contentId: string;
  identityKey: string | null;
  resourceId: string;
  walletAddress: `0x${string}`;
}) {
  const viewId = randomBytes(16).toString("hex");
  return createHmac("sha256", getConfidentialitySecret())
    .update([params.identityKey ?? params.walletAddress, params.contentId, params.resourceId, viewId].join("\n"))
    .digest("hex");
}

export async function logConfidentialContextAccess(params: {
  contentId: string;
  identityKey: string | null;
  request: NextRequest;
  resourceId: string;
  resourceKind: ResourceKind;
  viewToken: string;
  walletAddress: `0x${string}`;
}) {
  if (!RESOURCE_ID_PATTERN.test(params.resourceId)) return;
  await db.insert(confidentialContextAccessLogs).values({
    contentId: params.contentId,
    identityKey: params.identityKey,
    ipHash: hashIpAddress(params.request),
    resourceId: params.resourceId,
    resourceKind: params.resourceKind,
    viewedAt: new Date(),
    viewToken: params.viewToken,
    walletAddress: params.walletAddress,
  });
}

export async function publishConfidentialContextAfterSettlement(params: { contentIds: string[]; settledAt?: Date }) {
  const contentIds = [...new Set(params.contentIds.map(normalizeContentId).filter((id): id is string => Boolean(id)))];
  if (contentIds.length === 0) return { published: 0 };

  const now = params.settledAt ?? new Date();
  let published = 0;
  for (const contentId of contentIds) {
    const rows = await db
      .update(questionConfidentiality)
      .set({ publishedAt: now, updatedAt: now })
      .where(
        and(
          eq(questionConfidentiality.contentId, contentId),
          eq(questionConfidentiality.gated, true),
          eq(questionConfidentiality.disclosurePolicy, "after_settlement"),
          isNull(questionConfidentiality.publishedAt),
        ),
      )
      .returning({ contentId: questionConfidentiality.contentId });
    published += rows.length;
  }
  return { published };
}

export async function reconcileConfidentialDisclosure(params: { settledContentIds: string[]; settledAt?: Date }) {
  return publishConfidentialContextAfterSettlement({
    contentIds: params.settledContentIds,
    settledAt: params.settledAt,
  });
}

function leafHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function merkleRoot(leaves: string[]) {
  if (leaves.length === 0) return `0x${"0".repeat(64)}`;
  let level: Array<Buffer<ArrayBufferLike>> = leaves.map(leaf => Buffer.from(leaf, "hex")).sort(Buffer.compare);
  while (level.length > 1) {
    const next: Array<Buffer<ArrayBufferLike>> = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] ?? left;
      next.push(
        createHash("sha256")
          .update(Buffer.concat([left, right]))
          .digest(),
      );
    }
    level = next;
  }
  return `0x${level[0]!.toString("hex")}`;
}

function defaultConfidentialityLogRootArtifactUrl(epoch: string) {
  const configuredBase = process.env.RATELOOP_CONFIDENTIALITY_LOG_ROOT_ARTIFACT_BASE_URL?.trim();
  if (configuredBase) {
    return `${configuredBase.replace(/\/+$/, "")}/${encodeURIComponent(epoch)}.json`;
  }
  const appUrl = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) return null;
  try {
    return new URL(`/api/confidentiality/log-roots/${encodeURIComponent(epoch)}/artifact`, appUrl).toString();
  } catch {
    return null;
  }
}

function buildConfidentialityLogRootArtifact(params: {
  acceptanceCount: number;
  accessCount: number;
  end: Date;
  epoch: string;
  leaves: string[];
  merkleRoot: string;
  start: Date;
}) {
  return {
    schemaVersion: "rateloop.confidentiality-log-root.v1",
    epoch: params.epoch,
    intervalStart: params.start.toISOString(),
    intervalEnd: params.end.toISOString(),
    merkleRoot: params.merkleRoot,
    acceptanceCount: params.acceptanceCount,
    accessCount: params.accessCount,
    leaves: params.leaves.map(leaf => `0x${leaf}`),
  };
}

function hashArtifactJson(artifactJson: string): Hex {
  return `0x${createHash("sha256").update(artifactJson).digest("hex")}` as Hex;
}

async function publishConfidentialityLogRootAnchor(params: {
  artifactHash: Hex;
  artifactUri: string | null;
  epoch: string;
  merkleRoot: Hex;
}) {
  const privateKey = process.env.RATELOOP_CONFIDENTIALITY_LOG_ROOT_ANCHOR_PRIVATE_KEY?.trim();
  if (!privateKey) return { status: "skipped" as const, reason: "anchor_private_key_unset" };
  if (!PRIVATE_KEY_PATTERN.test(privateKey)) {
    throw new Error("RATELOOP_CONFIDENTIALITY_LOG_ROOT_ANCHOR_PRIVATE_KEY must be a 32-byte hex private key.");
  }

  const context = getContractsForPrimaryServerNetwork();
  const confidentialityEscrow = context?.contracts?.ConfidentialityEscrow;
  if (!context || !confidentialityEscrow) {
    throw new Error("ConfidentialityEscrow is not configured for log-root anchoring.");
  }

  const account = privateKeyToAccount(privateKey as Hex);
  const publicClient = getServerPublicClient(context.targetNetwork);
  const walletClient = createWalletClient({
    account,
    chain: context.targetNetwork,
    transport: http(getServerRpcUrl(context.targetNetwork)),
  });
  const txHash = await walletClient.writeContract({
    address: confidentialityEscrow.address,
    abi: CONFIDENTIALITY_ESCROW_LOG_ROOT_ABI,
    functionName: "publishLogRoot",
    args: [params.epoch, params.merkleRoot, params.artifactHash, params.artifactUri ?? ""],
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  return {
    status: "submitted" as const,
    chainId: context.targetNetwork.id,
    contract: confidentialityEscrow.address,
    publisher: account.address,
    txHash,
  };
}

function epochBounds(epoch: string) {
  const start = new Date(`${epoch}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) throw new Error("Invalid confidentiality log epoch.");
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { end, start };
}

export function confidentialityEpochForDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function publishConfidentialityLogRoot(
  params: { anchor?: boolean; artifactUrl?: string | null; epoch?: string; now?: Date } = {},
) {
  const now = params.now ?? new Date();
  const epoch = params.epoch ?? confidentialityEpochForDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const { start, end } = epochBounds(epoch);

  const acceptances = await db
    .select()
    .from(confidentialityTermsAcceptances)
    .where(
      and(gte(confidentialityTermsAcceptances.acceptedAt, start), lt(confidentialityTermsAcceptances.acceptedAt, end)),
    );
  const accesses = await db
    .select()
    .from(confidentialContextAccessLogs)
    .where(and(gte(confidentialContextAccessLogs.viewedAt, start), lt(confidentialContextAccessLogs.viewedAt, end)));

  const leaves = [
    ...acceptances.map(row =>
      leafHash([
        "acceptance",
        row.walletAddress,
        row.identityKey,
        row.contentId,
        row.termsVersion,
        row.termsDocHash,
        row.payloadHash,
        row.questionMetadataHash,
        row.contentHash,
        row.detailsHash,
        row.mediaTupleHash,
        row.nonce,
        row.acceptedAt.toISOString(),
      ]),
    ),
    ...accesses.map(row =>
      leafHash([
        "access",
        row.walletAddress,
        row.identityKey,
        row.contentId,
        row.resourceKind,
        row.resourceId,
        row.viewToken,
        row.viewedAt.toISOString(),
      ]),
    ),
  ].sort();
  const root = merkleRoot(leaves);
  const artifact = buildConfidentialityLogRootArtifact({
    acceptanceCount: acceptances.length,
    accessCount: accesses.length,
    end,
    epoch,
    leaves,
    merkleRoot: root,
    start,
  });
  const artifactJson = JSON.stringify(artifact);
  const artifactHash = hashArtifactJson(artifactJson);
  const artifactUrl =
    params.artifactUrl === undefined ? defaultConfidentialityLogRootArtifactUrl(epoch) : params.artifactUrl;
  const anchor =
    params.anchor === false
      ? { status: "skipped" as const, reason: "anchor_disabled" }
      : await publishConfidentialityLogRootAnchor({
          artifactHash,
          artifactUri: artifactUrl,
          epoch,
          merkleRoot: root as Hex,
        });

  await db
    .insert(confidentialityLogRoots)
    .values({
      acceptanceCount: acceptances.length,
      accessCount: accesses.length,
      anchorChainId: anchor.status === "submitted" ? anchor.chainId : null,
      anchorContract: anchor.status === "submitted" ? anchor.contract : null,
      anchorPublishedAt: anchor.status === "submitted" ? now : null,
      anchorTxHash: anchor.status === "submitted" ? anchor.txHash : null,
      artifactHash,
      artifactJson,
      artifactUrl,
      createdAt: now,
      epoch,
      merkleRoot: root,
      publishedAt: now,
    })
    .onConflictDoUpdate({
      target: confidentialityLogRoots.epoch,
      set: {
        acceptanceCount: acceptances.length,
        accessCount: accesses.length,
        anchorChainId: anchor.status === "submitted" ? anchor.chainId : null,
        anchorContract: anchor.status === "submitted" ? anchor.contract : null,
        anchorPublishedAt: anchor.status === "submitted" ? now : null,
        anchorTxHash: anchor.status === "submitted" ? anchor.txHash : null,
        artifactHash,
        artifactJson,
        artifactUrl,
        merkleRoot: root,
        publishedAt: now,
      },
    });

  return {
    acceptanceCount: acceptances.length,
    accessCount: accesses.length,
    anchor,
    artifactHash,
    artifactUrl,
    epoch,
    merkleRoot: root,
  };
}
