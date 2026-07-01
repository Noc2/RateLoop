import type { NextRequest } from "next/server";
import deployedContracts from "@rateloop/contracts/deployedContracts";
import { ROUND_STATE } from "@rateloop/contracts/protocol";
import { createHash, createHmac, randomBytes } from "crypto";
import { and, asc, eq, gte, isNull, lt } from "drizzle-orm";
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
import {
  GATED_CONTEXT_SIGNED_READ_SESSION_COOKIE_NAME,
  OWNER_CONTEXT_SIGNED_READ_SESSION_COOKIE_NAME,
  verifySignedReadSession,
} from "~~/lib/auth/signedReadSessions";
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
import { getOptionalAppUrl, getServerRpcOverrides, getServerTargetNetworkById } from "~~/lib/env/server";
import { resolveContentDeploymentScope } from "~~/lib/protocolDeployment";
import { isValidWalletAddress, normalizeWalletAddress } from "~~/lib/watchlist/contentWatch";
import { ponderApi } from "~~/services/ponder/client";
import { publicEnv } from "~~/utils/env/public";

export const CONFIDENTIALITY_TERMS_ACTION = "confidentiality_terms:accept";
export const CONFIDENTIALITY_TERMS_CHALLENGE_TITLE = "RateLoop confidential context";
export const CONFIDENTIALITY_TERMS_DOC_HASH = createHash("sha256")
  .update(`${CONFIDENTIALITY_TERMS_VERSION}\n${CONFIDENTIALITY_TERMS_URI}\n${CONFIDENTIALITY_TERMS_TEXT}`)
  .digest("hex");
export { CONFIDENTIALITY_TERMS_TEXT, CONFIDENTIALITY_TERMS_URI, CONFIDENTIALITY_TERMS_VERSION };

const BYTES32_HEX_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const CONTENT_ID_PATTERN = /^[0-9]{1,78}$/;
const RESOURCE_ID_PATTERN = /^(att|det)_[A-Za-z0-9_-]{16,80}$/;
const CONFIDENTIAL_CONTEXT_ACCESS_LOG_DEDUPE_MS = 60_000;

export type DisclosurePolicy = "after_settlement" | "private_forever";
export type ResourceKind = "image" | "details";

export interface ConfidentialityTermsPayload {
  contentHash: `0x${string}` | null;
  contentId: string;
  deploymentKey: string;
  detailsHash: `0x${string}` | null;
  frontendAddress: `0x${string}`;
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

export type ConfidentialityDeploymentScope = {
  chainId: number | null;
  contentRegistryAddress: `0x${string}` | null;
  deploymentKey: string;
};

type ConfidentialityDeploymentScopeInput = {
  chainId?: number | null;
  contentRegistryAddress?: string | null;
  deploymentKey?: string | null;
  frontendAddress?: string | null;
};

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
      { name: "frontend", type: "address" },
      { name: "epoch", type: "string" },
      { name: "merkleRoot", type: "bytes32" },
      { name: "artifactHash", type: "bytes32" },
      { name: "artifactUri", type: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const satisfies Abi;

function normalizeDeploymentKey(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function normalizeDeploymentAddress(value: unknown): `0x${string}` | null {
  return typeof value === "string" && isAddress(value) ? (value.toLowerCase() as `0x${string}`) : null;
}

function normalizeDeploymentChainId(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function toConfidentialityDeploymentScope(
  scope: NonNullable<ReturnType<typeof resolveContentDeploymentScope>>,
): ConfidentialityDeploymentScope {
  return {
    chainId: scope.chainId,
    contentRegistryAddress: scope.contentRegistryAddress,
    deploymentKey: scope.deploymentKey,
  };
}

function getConfiguredConfidentialityDeploymentScopes(): ConfidentialityDeploymentScope[] {
  return Object.keys(deployedContracts as unknown as DeployedContractsMap)
    .map(chainId => Number(chainId))
    .filter(chainId => Number.isSafeInteger(chainId) && chainId > 0 && Boolean(getServerTargetNetworkById(chainId)))
    .map(chainId => resolveContentDeploymentScope(chainId))
    .filter((scope): scope is NonNullable<ReturnType<typeof resolveContentDeploymentScope>> => Boolean(scope))
    .map(toConfidentialityDeploymentScope);
}

export function resolveCurrentConfidentialityDeploymentScope(): ConfidentialityDeploymentScope | null {
  const scopes = getConfiguredConfidentialityDeploymentScopes();
  return scopes.length === 1 ? scopes[0] : null;
}

export function resolveConfidentialityDeploymentScope(
  input: ConfidentialityDeploymentScopeInput = {},
): ConfidentialityDeploymentScope | null {
  const chainId = normalizeDeploymentChainId(input.chainId);
  const contentRegistryAddress = normalizeDeploymentAddress(input.contentRegistryAddress);
  const deploymentKey = normalizeDeploymentKey(input.deploymentKey);

  if (chainId || contentRegistryAddress || deploymentKey) {
    const matchingScopes = getConfiguredConfidentialityDeploymentScopes().filter(scope => {
      if (chainId && scope.chainId !== chainId) return false;
      if (contentRegistryAddress && scope.contentRegistryAddress !== contentRegistryAddress) return false;
      if (deploymentKey && scope.deploymentKey !== deploymentKey) return false;
      return true;
    });
    return matchingScopes.length === 1 ? matchingScopes[0] : null;
  }

  return resolveCurrentConfidentialityDeploymentScope();
}

function normalizeFrontendAddress(value: unknown): `0x${string}` | null {
  return typeof value === "string" && isAddress(value) ? (getAddress(value) as `0x${string}`) : null;
}

function isLegacyConfidentialityFrontendAddress(value: unknown) {
  return normalizeFrontendAddress(value) === zeroAddress;
}

function storedFrontendAddressOrFallback(value: unknown, fallback: `0x${string}`) {
  return isLegacyConfidentialityFrontendAddress(value) ? fallback : normalizeFrontendAddress(value) ?? fallback;
}

export function resolveConfidentialityFrontendAddress(
  input: Pick<ConfidentialityDeploymentScopeInput, "frontendAddress"> = {},
): `0x${string}` | null {
  return (
    normalizeFrontendAddress(input.frontendAddress) ??
    normalizeFrontendAddress(publicEnv.frontendCode) ??
    normalizeFrontendAddress(process.env.NEXT_PUBLIC_FRONTEND_CODE)
  );
}

function requireConfidentialityFrontendAddress(
  input: Pick<ConfidentialityDeploymentScopeInput, "frontendAddress"> = {},
): `0x${string}` {
  const frontendAddress = resolveConfidentialityFrontendAddress(input);
  if (!frontendAddress) {
    throw new Error("NEXT_PUBLIC_FRONTEND_CODE is required for frontend-scoped confidentiality logs.");
  }
  return frontendAddress;
}

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

let confidentialityGateOverrideForTests: ConfidentialityOnchainGate | null = null;
let confidentialitySettledAtLookupOverrideForTests: ((contentId: string) => Promise<Date | null>) | null = null;

export function __setConfidentialityOnchainGateForTests(gate: ConfidentialityOnchainGate | null) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("__setConfidentialityOnchainGateForTests is only available in tests.");
  }
  confidentialityGateOverrideForTests = gate;
}

export function __setConfidentialitySettledAtLookupForTests(
  lookup: ((contentId: string) => Promise<Date | null>) | null,
) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("__setConfidentialitySettledAtLookupForTests is only available in tests.");
  }
  confidentialitySettledAtLookupOverrideForTests = lookup;
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
    return { bondAmount: "0", bondAsset: null, disclosurePolicy: "private_forever", gated: false };
  }

  const record = value as Record<string, unknown>;
  const visibility = typeof record.visibility === "string" ? record.visibility.trim() : "public";
  const disclosure =
    record.disclosurePolicy === "after_settlement" || record.disclosurePolicy === "private_until_settlement"
      ? ("after_settlement" as DisclosurePolicy)
      : ("private_forever" as DisclosurePolicy);
  const bond = record.bond && typeof record.bond === "object" && !Array.isArray(record.bond) ? record.bond : null;
  return {
    bondAmount: bond ? normalizeBondAmount((bond as Record<string, unknown>).amount) : "0",
    bondAsset: bond ? normalizeBondAsset((bond as Record<string, unknown>).asset) : null,
    disclosurePolicy: visibility === "gated" ? disclosure : "after_settlement",
    gated: visibility === "gated",
  };
}

export function normalizeConfidentialityTermsInput(
  body: Record<string, unknown>,
  options: ConfidentialityDeploymentScopeInput = {},
): { ok: true; payload: ConfidentialityTermsPayload } | { ok: false; error: string } {
  if (!body.address || typeof body.address !== "string" || !isValidWalletAddress(body.address)) {
    return { ok: false, error: "Invalid wallet address" };
  }
  const contentId = normalizeContentId(body.contentId);
  if (!contentId) return { ok: false, error: "Invalid content id" };
  const deploymentScope = resolveConfidentialityDeploymentScope({
    chainId: options.chainId ?? normalizeDeploymentChainId(body.chainId),
    contentRegistryAddress:
      options.contentRegistryAddress ??
      (typeof body.contentRegistryAddress === "string" ? body.contentRegistryAddress : null),
    deploymentKey: options.deploymentKey ?? (typeof body.deploymentKey === "string" ? body.deploymentKey : null),
  });
  if (!deploymentScope) return { ok: false, error: "Confidentiality deployment is not configured" };
  const frontendAddress = resolveConfidentialityFrontendAddress({
    frontendAddress: typeof body.frontendAddress === "string" ? body.frontendAddress : options.frontendAddress,
  });
  if (!frontendAddress) return { ok: false, error: "Confidentiality frontend is not configured" };

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
      deploymentKey: deploymentScope.deploymentKey,
      detailsHash: normalizeOptionalBytes32(body.detailsHash),
      frontendAddress,
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
  options: ConfidentialityDeploymentScopeInput = {},
): Promise<
  | { ok: true; payload: ConfidentialityTermsPayload; record: StoredConfidentiality }
  | { ok: false; error: string; status: number }
> {
  const normalized = normalizeConfidentialityTermsInput(body, options);
  if (!normalized.ok) return { ...normalized, status: 400 };

  const record = await getQuestionConfidentiality(normalized.payload.contentId, {
    deploymentKey: normalized.payload.deploymentKey,
  });
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
      deploymentKey: record.deploymentKey ?? normalized.payload.deploymentKey,
      detailsHash: normalizeOptionalBytes32(record.detailsHash),
      frontendAddress: storedFrontendAddressOrFallback(record.frontendAddress, normalized.payload.frontendAddress),
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
    payload.deploymentKey,
    payload.frontendAddress,
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

export async function getQuestionConfidentiality(contentId: string, options: ConfidentialityDeploymentScopeInput = {}) {
  const normalizedContentId = normalizeContentId(contentId);
  const deploymentScope = resolveConfidentialityDeploymentScope(options);
  const frontendAddress = resolveConfidentialityFrontendAddress(options);
  if (!normalizedContentId || !deploymentScope || !frontendAddress) return null;

  const [exactRecord] = await db
    .select()
    .from(questionConfidentiality)
    .where(
      and(
        eq(questionConfidentiality.deploymentKey, deploymentScope.deploymentKey),
        eq(questionConfidentiality.frontendAddress, frontendAddress),
        eq(questionConfidentiality.contentId, normalizedContentId),
      ),
    )
    .limit(1);
  if (exactRecord) return exactRecord;

  const [legacyFrontendRecord] = await db
    .select()
    .from(questionConfidentiality)
    .where(
      and(
        eq(questionConfidentiality.deploymentKey, deploymentScope.deploymentKey),
        eq(questionConfidentiality.frontendAddress, zeroAddress),
        eq(questionConfidentiality.contentId, normalizedContentId),
      ),
    )
    .limit(1);
  if (legacyFrontendRecord) return legacyFrontendRecord;

  const [legacyDeploymentRecord] = await db
    .select()
    .from(questionConfidentiality)
    .where(
      and(
        isNull(questionConfidentiality.deploymentKey),
        eq(questionConfidentiality.frontendAddress, zeroAddress),
        eq(questionConfidentiality.contentId, normalizedContentId),
      ),
    )
    .limit(1);
  return legacyDeploymentRecord ?? null;
}

export async function upsertQuestionConfidentialityFromMetadata(params: {
  chainId?: number | null;
  contentId: string;
  contentRegistryAddress?: string | null;
  deploymentKey?: string | null;
  frontendAddress?: string | null;
  metadata: ConfidentialityMetadataInput | null;
  questionMetadataHash?: string | null;
}) {
  const contentId = normalizeContentId(params.contentId);
  if (!contentId || !params.metadata || typeof params.metadata !== "object" || Array.isArray(params.metadata)) return;
  const deploymentScope = resolveConfidentialityDeploymentScope(params);
  if (!deploymentScope) return;
  const frontendAddress = requireConfidentialityFrontendAddress(params);

  const metadata = params.metadata as Record<string, unknown>;
  const confidentiality = parseMetadataConfidentiality(metadata.confidentiality);
  const now = new Date();
  await db
    .insert(questionConfidentiality)
    .values({
      bondAmount: confidentiality.bondAmount,
      bondAsset: confidentiality.bondAsset,
      chainId: deploymentScope.chainId,
      contentHash: normalizeOptionalBytes32(params.metadata.contentHash),
      contentId,
      contentRegistryAddress: deploymentScope.contentRegistryAddress,
      deploymentKey: deploymentScope.deploymentKey,
      detailsHash: normalizeOptionalBytes32(params.metadata.detailsHash),
      disclosurePolicy: confidentiality.disclosurePolicy,
      frontendAddress,
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
      target: [
        questionConfidentiality.deploymentKey,
        questionConfidentiality.frontendAddress,
        questionConfidentiality.contentId,
      ],
      set: {
        bondAmount: confidentiality.bondAmount,
        bondAsset: confidentiality.bondAsset,
        chainId: deploymentScope.chainId,
        contentHash: normalizeOptionalBytes32(params.metadata.contentHash),
        contentRegistryAddress: deploymentScope.contentRegistryAddress,
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
  chainId?: number | null;
  contentRegistryAddress?: string | null;
  contentId: string;
  deploymentKey?: string | null;
  frontendAddress?: string | null;
  payloadHash?: string;
  termsDocHash?: string;
  termsVersion?: string;
  walletAddress: `0x${string}`;
}) {
  const deploymentScope = resolveConfidentialityDeploymentScope(params);
  const frontendAddress = resolveConfidentialityFrontendAddress(params);
  if (!deploymentScope || !frontendAddress) return false;

  const commonConditions = [
    eq(confidentialityTermsAcceptances.deploymentKey, deploymentScope.deploymentKey),
    eq(confidentialityTermsAcceptances.frontendAddress, frontendAddress),
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
  const deploymentScope = resolveConfidentialityDeploymentScope({ deploymentKey: params.payload.deploymentKey });
  await db
    .insert(confidentialityTermsAcceptances)
    .values({
      acceptedAt,
      chainId: deploymentScope?.chainId ?? null,
      contentId: params.payload.contentId,
      contentRegistryAddress: deploymentScope?.contentRegistryAddress ?? null,
      contentHash: params.payload.contentHash,
      deploymentKey: params.payload.deploymentKey,
      detailsHash: params.payload.detailsHash,
      frontendAddress: params.payload.frontendAddress,
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
        confidentialityTermsAcceptances.deploymentKey,
        confidentialityTermsAcceptances.frontendAddress,
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

function getContractsForConfidentialityDeploymentScope(deploymentScope: ConfidentialityDeploymentScope) {
  const targetNetwork =
    typeof deploymentScope.chainId === "number" ? getServerTargetNetworkById(deploymentScope.chainId) : null;
  if (!targetNetwork) return null;
  const contentScope = resolveContentDeploymentScope(targetNetwork.id);
  if (
    !contentScope ||
    contentScope.deploymentKey !== deploymentScope.deploymentKey ||
    contentScope.contentRegistryAddress !== deploymentScope.contentRegistryAddress
  ) {
    return null;
  }
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
  deploymentScope: ConfidentialityDeploymentScope,
): Promise<GateReadResult<ResolvedConfidentialityViewer>> {
  const context = getContractsForConfidentialityDeploymentScope(deploymentScope);
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

async function defaultIsIdentityKeyBanned(
  identityKey: `0x${string}`,
  deploymentScope: ConfidentialityDeploymentScope,
): Promise<GateReadResult<boolean>> {
  const context = getContractsForConfidentialityDeploymentScope(deploymentScope);
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

async function resolveConfiguredConfidentialityEscrow(
  deploymentScope: ConfidentialityDeploymentScope,
): Promise<GateReadResult<Address>> {
  const context = getContractsForConfidentialityDeploymentScope(deploymentScope);
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
  deploymentScope: ConfidentialityDeploymentScope;
  identityKey: `0x${string}`;
}): Promise<GateReadResult<boolean>> {
  const context = getContractsForConfidentialityDeploymentScope(params.deploymentScope);
  if (!context) {
    return { ok: false, error: "Confidentiality bond network is not configured" };
  }

  const escrow = await resolveConfiguredConfidentialityEscrow(params.deploymentScope);
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

async function resolveViewerForGatedContext(
  walletAddress: `0x${string}`,
  deploymentScope: ConfidentialityDeploymentScope,
) {
  if (confidentialityGateOverrideForTests) {
    return { ok: true as const, value: await confidentialityGateOverrideForTests.resolveViewer(walletAddress) };
  }
  return defaultResolveViewer(walletAddress, deploymentScope);
}

async function isIdentityKeyBannedForGatedContext(
  identityKey: `0x${string}`,
  deploymentScope: ConfidentialityDeploymentScope,
) {
  if (confidentialityGateOverrideForTests) {
    return { ok: true as const, value: await confidentialityGateOverrideForTests.isIdentityKeyBanned(identityKey) };
  }
  return defaultIsIdentityKeyBanned(identityKey, deploymentScope);
}

async function hasActiveBondForGatedContext(params: {
  contentId: string;
  deploymentScope: ConfidentialityDeploymentScope;
  identityKey: `0x${string}`;
}) {
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
  options: { ownerWalletAddress?: string | null } & ConfidentialityDeploymentScopeInput = {},
) {
  const deploymentScope = resolveConfidentialityDeploymentScope(options);
  if (!deploymentScope) {
    return { ok: false as const, status: 503, error: "Confidentiality deployment is not configured" };
  }
  const frontendAddress = resolveConfidentialityFrontendAddress(options);
  if (!frontendAddress) {
    return { ok: false as const, status: 503, error: "Confidentiality frontend is not configured" };
  }

  const address = request.nextUrl.searchParams.get("address");
  if (!address || !isValidWalletAddress(address)) {
    return { ok: false as const, status: 401, error: "Signed wallet session required" };
  }

  const walletAddress = normalizeWalletAddress(address);
  const isOwner = isOwnerWalletAddress(walletAddress, options.ownerWalletAddress);
  const hasOwnerContextSession = isOwner
    ? await verifySignedReadSession(
        request.cookies.get(OWNER_CONTEXT_SIGNED_READ_SESSION_COOKIE_NAME)?.value,
        walletAddress,
        "owner_context",
      )
    : false;
  if (isOwner && hasOwnerContextSession) {
    return {
      ok: true as const,
      deploymentKey: deploymentScope.deploymentKey,
      frontendAddress,
      identityKey: null,
      walletAddress,
    };
  }

  const hasGatedContextSession = await verifySignedReadSession(
    request.cookies.get(GATED_CONTEXT_SIGNED_READ_SESSION_COOKIE_NAME)?.value,
    walletAddress,
    "gated_context",
  );
  if (!hasGatedContextSession) {
    return { ok: false as const, status: 401, error: "Signed wallet session required" };
  }

  const serverPayload = await buildServerConfidentialityTermsPayload(
    { address: walletAddress, contentId, frontendAddress },
    deploymentScope,
  );
  if (!serverPayload.ok) {
    return { ok: false as const, status: serverPayload.status, error: serverPayload.error };
  }

  if (
    !(await hasConfidentialityTermsAcceptance({
      contentId,
      deploymentKey: deploymentScope.deploymentKey,
      frontendAddress,
      payloadHash: hashConfidentialityTermsPayload(serverPayload.payload),
      walletAddress,
    }))
  ) {
    return { ok: false as const, status: 403, error: "Confidentiality terms acceptance required" };
  }

  const resolvedViewer = await resolveViewerForGatedContext(walletAddress, deploymentScope);
  if (!resolvedViewer.ok) {
    return { ok: false as const, status: 503, error: resolvedViewer.error };
  }

  const viewer = resolvedViewer.value;
  if (!viewer.hasActiveHumanCredential || !viewer.identityKey) {
    return { ok: false as const, status: 403, error: "Active human credential required" };
  }

  const banned = await isIdentityKeyBannedForGatedContext(viewer.identityKey, deploymentScope);
  if (!banned.ok) {
    return { ok: false as const, status: 503, error: banned.error };
  }
  if (banned.value) {
    return { ok: false as const, status: 403, error: "Confidentiality access revoked" };
  }

  if (isPositiveBondAmount(serverPayload.record.bondAmount)) {
    const bond = await hasActiveBondForGatedContext({
      contentId,
      deploymentScope,
      identityKey: viewer.identityKey,
    });
    if (!bond.ok) {
      return { ok: false as const, status: 503, error: bond.error };
    }
    if (!bond.value) {
      return { ok: false as const, status: 403, error: "Active confidentiality bond required" };
    }
  }

  return {
    ok: true as const,
    deploymentKey: deploymentScope.deploymentKey,
    frontendAddress: serverPayload.payload.frontendAddress,
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
  deploymentKey: string;
  frontendAddress: string;
  identityKey: string | null;
  resourceId: string;
  walletAddress: `0x${string}`;
}) {
  const viewId = randomBytes(16).toString("hex");
  return createHmac("sha256", getConfidentialitySecret())
    .update(
      [
        params.identityKey ?? params.walletAddress,
        params.deploymentKey,
        params.frontendAddress,
        params.contentId,
        params.resourceId,
        viewId,
      ].join("\n"),
    )
    .digest("hex");
}

export async function logConfidentialContextAccess(params: {
  chainId?: number | null;
  contentRegistryAddress?: string | null;
  contentId: string;
  deploymentKey?: string | null;
  frontendAddress?: string | null;
  identityKey: string | null;
  request: NextRequest;
  resourceId: string;
  resourceKind: ResourceKind;
  viewToken: string;
  walletAddress: `0x${string}`;
}) {
  if (!RESOURCE_ID_PATTERN.test(params.resourceId)) return;
  const deploymentScope = resolveConfidentialityDeploymentScope(params);
  const frontendAddress = resolveConfidentialityFrontendAddress(params);
  if (!deploymentScope || !frontendAddress) return;
  const viewedAt = new Date();
  const dedupeSince = new Date(viewedAt.getTime() - CONFIDENTIAL_CONTEXT_ACCESS_LOG_DEDUPE_MS);
  const [recentAccess] = await db
    .select({ id: confidentialContextAccessLogs.id })
    .from(confidentialContextAccessLogs)
    .where(
      and(
        eq(confidentialContextAccessLogs.deploymentKey, deploymentScope.deploymentKey),
        eq(confidentialContextAccessLogs.frontendAddress, frontendAddress),
        eq(confidentialContextAccessLogs.contentId, params.contentId),
        params.identityKey
          ? eq(confidentialContextAccessLogs.identityKey, params.identityKey)
          : isNull(confidentialContextAccessLogs.identityKey),
        eq(confidentialContextAccessLogs.resourceId, params.resourceId),
        eq(confidentialContextAccessLogs.resourceKind, params.resourceKind),
        eq(confidentialContextAccessLogs.walletAddress, params.walletAddress),
        gte(confidentialContextAccessLogs.viewedAt, dedupeSince),
      ),
    )
    .limit(1);
  if (recentAccess) return;

  await db.insert(confidentialContextAccessLogs).values({
    chainId: deploymentScope.chainId,
    contentId: params.contentId,
    contentRegistryAddress: deploymentScope.contentRegistryAddress,
    deploymentKey: deploymentScope.deploymentKey,
    frontendAddress,
    identityKey: params.identityKey,
    ipHash: hashIpAddress(params.request),
    resourceId: params.resourceId,
    resourceKind: params.resourceKind,
    viewedAt,
    viewToken: params.viewToken,
    walletAddress: params.walletAddress,
  });
}

export async function publishConfidentialContextAfterSettlement(params: { contentIds: string[]; settledAt?: Date }) {
  const contentIds = [...new Set(params.contentIds.map(normalizeContentId).filter((id): id is string => Boolean(id)))];
  if (contentIds.length === 0) return { published: 0 };
  const deploymentScope = resolveCurrentConfidentialityDeploymentScope();
  const frontendAddress = resolveConfidentialityFrontendAddress();
  if (!deploymentScope || !frontendAddress) return { published: 0 };

  const now = params.settledAt ?? new Date();
  let published = 0;
  for (const contentId of contentIds) {
    const rows = await db
      .update(questionConfidentiality)
      .set({ publishedAt: now, updatedAt: now })
      .where(
        and(
          eq(questionConfidentiality.deploymentKey, deploymentScope.deploymentKey),
          eq(questionConfidentiality.frontendAddress, frontendAddress),
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

function normalizePositiveLimit(value: unknown, fallback: number, max: number) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

async function lookupSettledAtForConfidentialContent(contentId: string) {
  if (confidentialitySettledAtLookupOverrideForTests) {
    return confidentialitySettledAtLookupOverrideForTests(contentId);
  }

  const rounds = await ponderApi.getAllRounds({ contentId, state: String(ROUND_STATE.Settled) });
  const settledTimes = rounds
    .map(round => (round.settledAt ? new Date(round.settledAt) : null))
    .filter((date): date is Date => Boolean(date && !Number.isNaN(date.getTime())))
    .sort((left, right) => left.getTime() - right.getTime());
  return settledTimes[0] ?? null;
}

export async function findDueConfidentialDisclosureContent(params: { limit?: number; scanLimit?: number } = {}) {
  const limit = normalizePositiveLimit(params.limit, 100, 500);
  const scanLimit = normalizePositiveLimit(params.scanLimit, Math.max(limit * 10, 500), 5_000);
  const deploymentScope = resolveCurrentConfidentialityDeploymentScope();
  const frontendAddress = resolveConfidentialityFrontendAddress();
  if (!deploymentScope || !frontendAddress) return { checked: 0, due: [], errors: [] };
  const candidates = await db
    .select({ contentId: questionConfidentiality.contentId })
    .from(questionConfidentiality)
    .where(
      and(
        eq(questionConfidentiality.deploymentKey, deploymentScope.deploymentKey),
        eq(questionConfidentiality.frontendAddress, frontendAddress),
        eq(questionConfidentiality.gated, true),
        eq(questionConfidentiality.disclosurePolicy, "after_settlement"),
        isNull(questionConfidentiality.publishedAt),
      ),
    )
    .orderBy(asc(questionConfidentiality.createdAt))
    .limit(scanLimit);

  const due: Array<{ contentId: string; settledAt: Date }> = [];
  const errors: Array<{ contentId: string; error: string }> = [];
  let checked = 0;
  for (const candidate of candidates) {
    if (due.length >= limit) break;
    checked += 1;
    try {
      const settledAt = await lookupSettledAtForConfidentialContent(candidate.contentId);
      if (settledAt) due.push({ contentId: candidate.contentId, settledAt });
    } catch (error) {
      errors.push({
        contentId: candidate.contentId,
        error: error instanceof Error ? error.message : "Unable to check settlement status",
      });
    }
  }

  return {
    checked,
    due,
    errors,
  };
}

export async function reconcileDueConfidentialDisclosure(params: { limit?: number; scanLimit?: number } = {}) {
  const dueResult = await findDueConfidentialDisclosureContent(params);
  let published = 0;
  for (const item of dueResult.due) {
    const result = await publishConfidentialContextAfterSettlement({
      contentIds: [item.contentId],
      settledAt: item.settledAt,
    });
    published += result.published;
  }

  return {
    checked: dueResult.checked,
    due: dueResult.due.length,
    errors: dueResult.errors,
    published,
  };
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

function defaultConfidentialityLogRootArtifactUrl(epoch: string, deploymentKey: string, frontendAddress: string) {
  const configuredBase = process.env.RATELOOP_CONFIDENTIALITY_LOG_ROOT_ARTIFACT_BASE_URL?.trim();
  if (configuredBase) {
    return `${configuredBase.replace(/\/+$/, "")}/${encodeURIComponent(deploymentKey)}/${encodeURIComponent(
      frontendAddress,
    )}/${encodeURIComponent(epoch)}.json`;
  }
  const appUrl = getOptionalAppUrl();
  if (!appUrl) return null;
  try {
    const url = new URL(`/api/confidentiality/log-roots/${encodeURIComponent(epoch)}/artifact`, appUrl);
    url.searchParams.set("deploymentKey", deploymentKey);
    url.searchParams.set("frontendAddress", frontendAddress);
    return url.toString();
  } catch {
    return null;
  }
}

function buildConfidentialityLogRootArtifact(params: {
  acceptanceCount: number;
  accessCount: number;
  chainId: number | null;
  contentRegistryAddress: string | null;
  deploymentKey: string;
  end: Date;
  epoch: string;
  frontendAddress: string;
  recorderAddress: string | null;
  leaves: string[];
  merkleRoot: string;
  start: Date;
}) {
  return {
    schemaVersion: "rateloop.confidentiality-log-root.v3",
    epoch: params.epoch,
    deploymentKey: params.deploymentKey,
    frontendAddress: params.frontendAddress,
    recorderAddress: params.recorderAddress,
    chainId: params.chainId,
    contentRegistryAddress: params.contentRegistryAddress,
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

function getConfiguredAccessRecorderAddress(): `0x${string}` | null {
  const privateKey = process.env.RATELOOP_CONFIDENTIALITY_ACCESS_RECORDER_PRIVATE_KEY?.trim();
  if (!privateKey || !PRIVATE_KEY_PATTERN.test(privateKey)) return null;
  return privateKeyToAccount(privateKey as Hex).address as `0x${string}`;
}

async function publishConfidentialityLogRootAnchor(params: {
  artifactHash: Hex;
  artifactUri: string | null;
  epoch: string;
  frontendAddress: `0x${string}`;
  merkleRoot: Hex;
}) {
  const privateKey = process.env.RATELOOP_CONFIDENTIALITY_ACCESS_RECORDER_PRIVATE_KEY?.trim();
  if (!privateKey) return { status: "skipped" as const, reason: "access_recorder_private_key_unset" };
  if (!PRIVATE_KEY_PATTERN.test(privateKey)) {
    throw new Error("RATELOOP_CONFIDENTIALITY_ACCESS_RECORDER_PRIVATE_KEY must be a 32-byte hex private key.");
  }

  const deploymentScope = resolveCurrentConfidentialityDeploymentScope();
  const context = deploymentScope ? getContractsForConfidentialityDeploymentScope(deploymentScope) : null;
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
    args: [params.frontendAddress, params.epoch, params.merkleRoot, params.artifactHash, params.artifactUri ?? ""],
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

type ConfidentialityLogRootAnchorResult =
  | Awaited<ReturnType<typeof publishConfidentialityLogRootAnchor>>
  | { status: "failed"; reason: string };

async function attemptConfidentialityLogRootAnchor(params: {
  artifactHash: Hex;
  artifactUri: string | null;
  epoch: string;
  frontendAddress: `0x${string}`;
  merkleRoot: Hex;
}): Promise<ConfidentialityLogRootAnchorResult> {
  try {
    return await publishConfidentialityLogRootAnchor(params);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to publish confidentiality log-root anchor.";
    console.error("[confidentiality] failed to publish log-root anchor.", {
      epoch: params.epoch,
      frontendAddress: params.frontendAddress,
      reason,
    });
    return { status: "failed", reason };
  }
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
  params: {
    anchor?: boolean;
    artifactUrl?: string | null;
    epoch?: string;
    now?: Date;
    requireAnchor?: boolean;
  } & ConfidentialityDeploymentScopeInput = {},
) {
  const now = params.now ?? new Date();
  const epoch = params.epoch ?? confidentialityEpochForDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const { start, end } = epochBounds(epoch);
  const deploymentScope = resolveConfidentialityDeploymentScope(params);
  if (!deploymentScope) {
    throw new Error("Confidentiality deployment is not configured for log-root publishing.");
  }
  const frontendAddress = requireConfidentialityFrontendAddress(params);

  const acceptances = await db
    .select()
    .from(confidentialityTermsAcceptances)
    .where(
      and(
        eq(confidentialityTermsAcceptances.deploymentKey, deploymentScope.deploymentKey),
        eq(confidentialityTermsAcceptances.frontendAddress, frontendAddress),
        gte(confidentialityTermsAcceptances.acceptedAt, start),
        lt(confidentialityTermsAcceptances.acceptedAt, end),
      ),
    );
  const accesses = await db
    .select()
    .from(confidentialContextAccessLogs)
    .where(
      and(
        eq(confidentialContextAccessLogs.deploymentKey, deploymentScope.deploymentKey),
        eq(confidentialContextAccessLogs.frontendAddress, frontendAddress),
        gte(confidentialContextAccessLogs.viewedAt, start),
        lt(confidentialContextAccessLogs.viewedAt, end),
      ),
    );

  const leaves = [
    ...acceptances.map(row =>
      leafHash([
        "acceptance",
        row.deploymentKey,
        row.frontendAddress,
        row.chainId,
        row.contentRegistryAddress,
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
        row.deploymentKey,
        row.frontendAddress,
        row.chainId,
        row.contentRegistryAddress,
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
    chainId: deploymentScope.chainId,
    contentRegistryAddress: deploymentScope.contentRegistryAddress,
    deploymentKey: deploymentScope.deploymentKey,
    end,
    epoch,
    frontendAddress,
    leaves,
    merkleRoot: root,
    recorderAddress: getConfiguredAccessRecorderAddress(),
    start,
  });
  const artifactJson = JSON.stringify(artifact);
  const artifactHash = hashArtifactJson(artifactJson);
  const artifactUrl =
    params.artifactUrl === undefined
      ? defaultConfidentialityLogRootArtifactUrl(epoch, deploymentScope.deploymentKey, frontendAddress)
      : params.artifactUrl;

  const selectExistingRoot = async () => {
    const [row] = await db
      .select({
        acceptanceCount: confidentialityLogRoots.acceptanceCount,
        accessCount: confidentialityLogRoots.accessCount,
        anchorChainId: confidentialityLogRoots.anchorChainId,
        anchorContract: confidentialityLogRoots.anchorContract,
        anchorPublishedAt: confidentialityLogRoots.anchorPublishedAt,
        anchorTxHash: confidentialityLogRoots.anchorTxHash,
        artifactHash: confidentialityLogRoots.artifactHash,
        artifactJson: confidentialityLogRoots.artifactJson,
        artifactUrl: confidentialityLogRoots.artifactUrl,
        chainId: confidentialityLogRoots.chainId,
        contentRegistryAddress: confidentialityLogRoots.contentRegistryAddress,
        deploymentKey: confidentialityLogRoots.deploymentKey,
        frontendAddress: confidentialityLogRoots.frontendAddress,
        merkleRoot: confidentialityLogRoots.merkleRoot,
        publishedAt: confidentialityLogRoots.publishedAt,
      })
      .from(confidentialityLogRoots)
      .where(
        and(
          eq(confidentialityLogRoots.deploymentKey, deploymentScope.deploymentKey),
          eq(confidentialityLogRoots.frontendAddress, frontendAddress),
          eq(confidentialityLogRoots.epoch, epoch),
        ),
      )
      .limit(1);
    return row;
  };

  const existingRootPublication = (existingRoot: NonNullable<Awaited<ReturnType<typeof selectExistingRoot>>>) => {
    if (
      existingRoot.artifactHash !== artifactHash ||
      existingRoot.artifactJson !== artifactJson ||
      existingRoot.merkleRoot !== root
    ) {
      throw new Error("Confidentiality log root already sealed for epoch with a different artifact.");
    }
    if (params.requireAnchor && !existingRoot.anchorTxHash) {
      throw new Error("Confidentiality log root was already sealed without an on-chain anchor.");
    }
    return {
      acceptanceCount: existingRoot.acceptanceCount,
      accessCount: existingRoot.accessCount,
      anchor: existingRoot.anchorTxHash
        ? {
            status: "already_anchored" as const,
            chainId: existingRoot.anchorChainId,
            contract: existingRoot.anchorContract,
            publishedAt: existingRoot.anchorPublishedAt,
            txHash: existingRoot.anchorTxHash,
          }
        : { status: "already_published" as const, reason: "append_only_epoch" },
      artifactHash: existingRoot.artifactHash,
      artifactUrl: existingRoot.artifactUrl,
      chainId: existingRoot.chainId,
      contentRegistryAddress: existingRoot.contentRegistryAddress,
      deploymentKey: existingRoot.deploymentKey,
      frontendAddress: existingRoot.frontendAddress,
      epoch,
      merkleRoot: existingRoot.merkleRoot,
    };
  };

  const existingRoot = await selectExistingRoot();
  if (existingRoot) {
    return existingRootPublication(existingRoot);
  }

  const anchor =
    params.anchor === false
      ? { status: "skipped" as const, reason: "anchor_disabled" }
      : await attemptConfidentialityLogRootAnchor({
          artifactHash,
          artifactUri: artifactUrl,
          epoch,
          frontendAddress,
          merkleRoot: root as Hex,
        });

  if (params.requireAnchor && anchor.status !== "submitted") {
    throw new Error(`Confidentiality log-root anchor required before sealing epoch (${anchor.status}).`);
  }

  const inserted = await db
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
      chainId: deploymentScope.chainId,
      contentRegistryAddress: deploymentScope.contentRegistryAddress,
      createdAt: now,
      deploymentKey: deploymentScope.deploymentKey,
      epoch,
      frontendAddress,
      merkleRoot: root,
      publishedAt: now,
    })
    .onConflictDoNothing({
      target: [
        confidentialityLogRoots.deploymentKey,
        confidentialityLogRoots.frontendAddress,
        confidentialityLogRoots.epoch,
      ],
    })
    .returning({ epoch: confidentialityLogRoots.epoch });

  if (inserted.length === 0) {
    const sealedRoot = await selectExistingRoot();
    if (!sealedRoot) throw new Error("Confidentiality log root insert conflicted before the sealed root was visible.");
    return existingRootPublication(sealedRoot);
  }

  return {
    acceptanceCount: acceptances.length,
    accessCount: accesses.length,
    anchor,
    artifactHash,
    artifactUrl,
    chainId: deploymentScope.chainId,
    contentRegistryAddress: deploymentScope.contentRegistryAddress,
    deploymentKey: deploymentScope.deploymentKey,
    frontendAddress,
    epoch,
    merkleRoot: root,
  };
}
