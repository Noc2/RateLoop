import { createHash, randomBytes } from "crypto";
import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import "server-only";
import { type Address, type Chain, type Hex, createPublicClient, http } from "viem";
import { db } from "~~/lib/db";
import { signedActionChallenges } from "~~/lib/db/schema";

const SIGNED_ACTION_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const STALE_USED_CHALLENGE_MS = 24 * 60 * 60 * 1000;

type SignedActionVerificationClient = {
  verifyMessage: (params: { address: Address; message: string; signature: Hex }) => Promise<boolean>;
};

let signedActionVerificationClient: SignedActionVerificationClient | null = null;
let signedActionVerificationClientOverride: SignedActionVerificationClient | null = null;

export function hashSignedActionPayload(parts: string[]): string {
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

export function buildSignedActionMessage(params: {
  title: string;
  action: string;
  address: `0x${string}`;
  payloadHash: string;
  messageLines?: readonly string[];
  nonce: string;
  expiresAt: Date;
}): string {
  const messageLines = params.messageLines?.filter(line => line.trim().length > 0) ?? [];

  return [
    params.title,
    "",
    `Action: ${params.action}`,
    `Wallet: ${params.address}`,
    `Payload Hash: ${params.payloadHash}`,
    ...messageLines,
    `Nonce: ${params.nonce}`,
    `Expires At: ${params.expiresAt.toISOString()}`,
  ].join("\n");
}

function createSignedActionChallenge(params: {
  title: string;
  action: string;
  address: `0x${string}`;
  payloadHash: string;
  messageLines?: readonly string[];
  ttlMs?: number;
}) {
  // Truncate to whole seconds so signing and verification always serialize the same timestamp.
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  const expiresAt = new Date(now.getTime() + (params.ttlMs ?? SIGNED_ACTION_CHALLENGE_TTL_MS));
  const challengeId = randomBytes(16).toString("hex");
  const nonce = randomBytes(16).toString("hex");
  const message = buildSignedActionMessage({
    title: params.title,
    action: params.action,
    address: params.address,
    payloadHash: params.payloadHash,
    messageLines: params.messageLines,
    nonce,
    expiresAt,
  });

  return {
    challengeId,
    nonce,
    payloadHash: params.payloadHash,
    expiresAt,
    createdAt: now,
    message,
  };
}

export async function issueSignedActionChallenge(params: {
  title: string;
  action: string;
  walletAddress: `0x${string}`;
  payloadHash: string;
  messageLines?: readonly string[];
  ttlMs?: number;
}) {
  const challenge = createSignedActionChallenge({
    title: params.title,
    action: params.action,
    address: params.walletAddress,
    payloadHash: params.payloadHash,
    messageLines: params.messageLines,
    ttlMs: params.ttlMs,
  });

  await cleanupSignedActionChallenges(challenge.createdAt);
  await persistSignedActionChallenge({
    challengeId: challenge.challengeId,
    action: params.action,
    walletAddress: params.walletAddress,
    payloadHash: challenge.payloadHash,
    nonce: challenge.nonce,
    expiresAt: challenge.expiresAt,
    createdAt: challenge.createdAt,
  });

  return {
    challengeId: challenge.challengeId,
    message: challenge.message,
    expiresAt: challenge.expiresAt.toISOString(),
  };
}

export async function ensureSignedActionChallengeTable() {
  // Schema is managed via Drizzle migrations.
}

async function getSignedActionVerificationClient(): Promise<SignedActionVerificationClient> {
  if (signedActionVerificationClientOverride) {
    return signedActionVerificationClientOverride;
  }

  if (signedActionVerificationClient) {
    return signedActionVerificationClient;
  }

  const { publicEnv } = await import("~~/utils/env/public");
  const targetNetwork = publicEnv.targetNetworks[0];
  const rpcUrl = publicEnv.rpcOverrides[targetNetwork.id] ?? targetNetwork.rpcUrls.default.http[0];

  signedActionVerificationClient = createPublicClient({
    chain: targetNetwork as Chain,
    transport: http(rpcUrl),
  });

  return signedActionVerificationClient;
}

export function __setSignedActionVerificationClientForTests(client: SignedActionVerificationClient | null) {
  signedActionVerificationClientOverride = client;
}

async function cleanupSignedActionChallenges(now = new Date()) {
  await ensureSignedActionChallengeTable();

  const staleUsedBefore = new Date(now.getTime() - STALE_USED_CHALLENGE_MS);
  await db
    .delete(signedActionChallenges)
    .where(
      or(
        lt(signedActionChallenges.expiresAt, now),
        and(isNotNull(signedActionChallenges.usedAt), lt(signedActionChallenges.usedAt, staleUsedBefore)),
      ),
    );
}

async function persistSignedActionChallenge(params: {
  challengeId: string;
  action: string;
  walletAddress: `0x${string}`;
  payloadHash: string;
  nonce: string;
  expiresAt: Date;
  createdAt: Date;
}) {
  await ensureSignedActionChallengeTable();

  await db.insert(signedActionChallenges).values({
    id: params.challengeId,
    walletAddress: params.walletAddress,
    action: params.action,
    payloadHash: params.payloadHash,
    nonce: params.nonce,
    expiresAt: params.expiresAt,
    createdAt: params.createdAt,
    usedAt: null,
  });
}

export function mapSignedActionError(error: unknown): { status: number; error: string } | null {
  const code = error instanceof Error ? error.message : typeof error === "string" ? error : null;

  switch (code) {
    case "CHALLENGE_USED":
      return { status: 409, error: "Challenge already used" };
    case "CHALLENGE_EXPIRED":
      return { status: 401, error: "Challenge expired" };
    case "INVALID_CHALLENGE":
    case "INVALID_SIGNATURE":
      return { status: 401, error: "Invalid signature challenge" };
    default:
      return null;
  }
}

export async function verifyAndConsumeSignedActionChallenge(
  tx: any,
  params: {
    challengeId: string;
    action: string;
    walletAddress: `0x${string}`;
    payloadHash: string;
    signature: `0x${string}`;
    buildMessage: (args: { nonce: string; expiresAt: Date }) => string;
    now?: Date;
  },
) {
  const now = params.now ?? new Date();
  const [challenge] = await tx
    .select()
    .from(signedActionChallenges)
    .where(eq(signedActionChallenges.id, params.challengeId))
    .limit(1);

  if (!challenge) {
    throw new Error("INVALID_CHALLENGE");
  }

  if (
    challenge.action !== params.action ||
    challenge.walletAddress !== params.walletAddress ||
    challenge.payloadHash !== params.payloadHash
  ) {
    throw new Error("INVALID_CHALLENGE");
  }

  if (challenge.usedAt) {
    throw new Error("CHALLENGE_USED");
  }

  if (challenge.expiresAt <= now) {
    throw new Error("CHALLENGE_EXPIRED");
  }

  const message = params.buildMessage({
    nonce: challenge.nonce,
    expiresAt: challenge.expiresAt,
  });

  try {
    const verificationClient = await getSignedActionVerificationClient();
    const isValid = await verificationClient.verifyMessage({
      address: params.walletAddress,
      message,
      signature: params.signature,
    });

    if (!isValid) {
      throw new Error("INVALID_SIGNATURE");
    }
  } catch {
    throw new Error("INVALID_SIGNATURE");
  }

  const claimedChallenge = await tx
    .update(signedActionChallenges)
    .set({ usedAt: now })
    .where(and(eq(signedActionChallenges.id, challenge.id), isNull(signedActionChallenges.usedAt)))
    .returning({ id: signedActionChallenges.id });

  if (claimedChallenge.length === 0) {
    throw new Error("CHALLENGE_USED");
  }

  return challenge;
}
