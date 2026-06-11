import type { NextRequest } from "next/server";
import { createHash, createHmac, randomBytes } from "crypto";
import { and, eq, gte, isNull, lt } from "drizzle-orm";
import "server-only";
import { buildSignedActionMessage, hashSignedActionPayload } from "~~/lib/auth/signedActions";
import { GATED_CONTEXT_SIGNED_READ_SESSION_COOKIE_NAME, verifySignedReadSession } from "~~/lib/auth/signedReadSessions";
import { db } from "~~/lib/db";
import {
  confidentialContextAccessLogs,
  confidentialityLogRoots,
  confidentialityTermsAcceptances,
  questionConfidentiality,
} from "~~/lib/db/schema";
import { isValidWalletAddress, normalizeWalletAddress } from "~~/lib/watchlist/contentWatch";

export const CONFIDENTIALITY_TERMS_ACTION = "confidentiality_terms:accept";
export const CONFIDENTIALITY_TERMS_CHALLENGE_TITLE = "RateLoop confidential context";
export const CONFIDENTIALITY_TERMS_VERSION = "2026-06";
export const CONFIDENTIALITY_TERMS_URI = "/legal/terms#confidential-context";
export const CONFIDENTIALITY_TERMS_TEXT =
  "I agree not to record, copy, share, publish, or discuss this confidential RateLoop question context except as needed to rate it on RateLoop.";
export const CONFIDENTIALITY_TERMS_DOC_HASH = createHash("sha256")
  .update(`${CONFIDENTIALITY_TERMS_VERSION}\n${CONFIDENTIALITY_TERMS_URI}\n${CONFIDENTIALITY_TERMS_TEXT}`)
  .digest("hex");

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

export function buildConfidentialityTermsChallengeMessage(params: {
  address: `0x${string}`;
  payloadHash: string;
  nonce: string;
  expiresAt: Date;
}) {
  return buildSignedActionMessage({
    title: CONFIDENTIALITY_TERMS_CHALLENGE_TITLE,
    action: CONFIDENTIALITY_TERMS_ACTION,
    address: params.address,
    payloadHash: params.payloadHash,
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
  termsVersion?: string;
  walletAddress: `0x${string}`;
}) {
  const [acceptance] = await db
    .select({ id: confidentialityTermsAcceptances.id })
    .from(confidentialityTermsAcceptances)
    .where(
      and(
        eq(confidentialityTermsAcceptances.walletAddress, params.walletAddress),
        eq(confidentialityTermsAcceptances.contentId, params.contentId),
        eq(confidentialityTermsAcceptances.termsVersion, params.termsVersion ?? CONFIDENTIALITY_TERMS_VERSION),
      ),
    )
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
  await db
    .insert(confidentialityTermsAcceptances)
    .values({
      acceptedAt,
      contentId: params.payload.contentId,
      identityKey: params.payload.identityKey,
      nonce: params.nonce,
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
        identityKey: params.payload.identityKey,
        nonce: params.nonce,
        signature: params.signature,
        termsDocHash: params.payload.termsDocHash,
      },
    });
}

export async function authorizeGatedContextRequest(request: NextRequest, contentId: string) {
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

  if (!(await hasConfidentialityTermsAcceptance({ contentId, walletAddress }))) {
    return { ok: false as const, status: 403, error: "Confidentiality terms acceptance required" };
  }

  const confidentiality = await getQuestionConfidentiality(contentId);
  if (confidentiality && confidentiality.bondAmount !== "0") {
    return { ok: false as const, status: 403, error: "Confidentiality bond verification required" };
  }

  return {
    ok: true as const,
    identityKey: null as `0x${string}` | null,
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

function epochBounds(epoch: string) {
  const start = new Date(`${epoch}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) throw new Error("Invalid confidentiality log epoch.");
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { end, start };
}

export function confidentialityEpochForDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function publishConfidentialityLogRoot(params: { epoch?: string; now?: Date } = {}) {
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
  ];
  const root = merkleRoot(leaves);
  const artifactHash = leafHash({ epoch, leaves, root });

  await db
    .insert(confidentialityLogRoots)
    .values({
      acceptanceCount: acceptances.length,
      accessCount: accesses.length,
      artifactHash: `0x${artifactHash}`,
      artifactUrl: null,
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
        artifactHash: `0x${artifactHash}`,
        artifactUrl: null,
        merkleRoot: root,
        publishedAt: now,
      },
    });

  return {
    acceptanceCount: acceptances.length,
    accessCount: accesses.length,
    artifactHash: `0x${artifactHash}`,
    epoch,
    merkleRoot: root,
  };
}
