import "server-only";
import { buildSignedActionMessage, hashSignedActionPayload } from "~~/lib/auth/signedActions";
import type { SignedReadSessionScope } from "~~/lib/auth/signedReadSessions";
import { isValidWalletAddress, normalizeWalletAddress } from "~~/lib/watchlist/contentWatch";

export const PRIVATE_ACCOUNT_ACCESS_CHALLENGE_TITLE = "RateLoop account access";
export const READ_PRIVATE_ACCOUNT_ACTION = "account:read_private";
export const PRIVATE_ACCOUNT_READ_SESSION_SCOPES = [
  "watchlist",
  "notification_preferences",
  "notification_email",
  "agent_policies",
  "owner_context",
] as const satisfies readonly SignedReadSessionScope[];

export type PrivateAccountReadScope = (typeof PRIVATE_ACCOUNT_READ_SESSION_SCOPES)[number];
const PRIVATE_ACCOUNT_READ_SCOPE_SET = new Set<string>(PRIVATE_ACCOUNT_READ_SESSION_SCOPES);
const PRIVATE_ACCOUNT_READ_SCOPE_LABELS: Record<PrivateAccountReadScope, string> = {
  watchlist: "watchlist",
  notification_preferences: "notification preferences",
  notification_email: "notification email",
  agent_policies: "agent policies",
  owner_context: "owner private context",
};

type PrivateAccountReadPayload = {
  normalizedAddress: `0x${string}`;
  scope: PrivateAccountReadScope;
};

type NormalizedResult<TPayload> = { ok: true; payload: TPayload } | { ok: false; error: string };

function normalizePrivateAccountReadScope(value: unknown): NormalizedResult<{ scope: PrivateAccountReadScope }> {
  if (typeof value !== "string" || !PRIVATE_ACCOUNT_READ_SCOPE_SET.has(value)) {
    return { ok: false, error: "Invalid read scope" };
  }

  return { ok: true, payload: { scope: value as PrivateAccountReadScope } };
}

export function describePrivateAccountReadScope(scope: PrivateAccountReadScope) {
  return PRIVATE_ACCOUNT_READ_SCOPE_LABELS[scope];
}

export function buildPrivateAccountReadChallengeMessageLines(scope: PrivateAccountReadScope) {
  return [
    `Read Scope: ${describePrivateAccountReadScope(scope)}`,
    scope === "owner_context" ? "Owner private context sessions expire after 12 hours." : "",
    "This signature does not grant gated rater context access.",
  ];
}

export function normalizePrivateAccountReadInput(
  body: Record<string, unknown>,
): NormalizedResult<PrivateAccountReadPayload> {
  if (!body.address || typeof body.address !== "string" || !isValidWalletAddress(body.address)) {
    return { ok: false, error: "Invalid wallet address" };
  }

  const normalizedScope = normalizePrivateAccountReadScope(body.scope);
  if (!normalizedScope.ok) {
    return normalizedScope;
  }

  return {
    ok: true,
    payload: {
      normalizedAddress: normalizeWalletAddress(body.address),
      scope: normalizedScope.payload.scope,
    },
  };
}

export function hashPrivateAccountReadPayload(payload: PrivateAccountReadPayload) {
  return hashSignedActionPayload([payload.normalizedAddress, payload.scope]);
}

export function buildPrivateAccountReadChallengeMessage(params: {
  address: `0x${string}`;
  payloadHash: string;
  scope: PrivateAccountReadScope;
  nonce: string;
  expiresAt: Date;
}) {
  return buildSignedActionMessage({
    title: PRIVATE_ACCOUNT_ACCESS_CHALLENGE_TITLE,
    action: READ_PRIVATE_ACCOUNT_ACTION,
    address: params.address,
    payloadHash: params.payloadHash,
    messageLines: buildPrivateAccountReadChallengeMessageLines(params.scope),
    nonce: params.nonce,
    expiresAt: params.expiresAt,
  });
}
