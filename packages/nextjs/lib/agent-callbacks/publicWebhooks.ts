import { AGENT_CALLBACK_EVENT_TYPES, type AgentCallbackEventType, isAgentCallbackEventType } from "./types";
import { assertSafeAgentCallbackUrl } from "./urlSafety";
import { createHash } from "crypto";
import "server-only";
import { buildSignedActionMessage, hashSignedActionPayload } from "~~/lib/auth/signedActions";
import { isValidWalletAddress, normalizeWalletAddress } from "~~/lib/watchlist/contentWatch";

export const PUBLIC_WEBHOOK_CHALLENGE_TITLE = "RateLoop public webhook";
export const REGISTER_PUBLIC_WEBHOOK_ACTION = "agent_callbacks:register_public_webhook";

type NormalizedResult<TPayload> = { ok: true; payload: TPayload } | { ok: false; error: string };

export type PublicWebhookRegistrationPayload = {
  callbackUrl: string;
  chainId: number;
  eventTypes: AgentCallbackEventType[];
  normalizedAddress: `0x${string}`;
  secretHash: string;
};

export function publicWebhookAgentId(params: { chainId: number; walletAddress: string }) {
  return `wallet:${params.chainId}:${params.walletAddress.toLowerCase()}`;
}

function normalizePublicWebhookEvents(eventTypes: string[]) {
  return [...new Set(eventTypes.map(type => type.trim()).filter(isAgentCallbackEventType))].sort();
}

export async function normalizePublicWebhookRegistrationInput(params: {
  callbackUrl: string;
  chainId: number;
  eventTypes: string[];
  secret: string;
  walletAddress: string;
}): Promise<NormalizedResult<PublicWebhookRegistrationPayload>> {
  if (!Number.isSafeInteger(params.chainId) || params.chainId <= 0) {
    return { ok: false, error: "Invalid chain id." };
  }
  if (!isValidWalletAddress(params.walletAddress)) {
    return { ok: false, error: "Invalid wallet address." };
  }

  const secret = params.secret.trim();
  if (!secret) {
    return { ok: false, error: "webhookSecret is required when webhookUrl is provided." };
  }

  const eventTypes =
    params.eventTypes.length > 0
      ? normalizePublicWebhookEvents(params.eventTypes)
      : normalizePublicWebhookEvents([...AGENT_CALLBACK_EVENT_TYPES]);
  if (eventTypes.length === 0) {
    return { ok: false, error: "webhookEvents must include at least one supported event type." };
  }

  try {
    return {
      ok: true,
      payload: {
        callbackUrl: await assertSafeAgentCallbackUrl(params.callbackUrl, "webhookUrl"),
        chainId: params.chainId,
        eventTypes,
        normalizedAddress: normalizeWalletAddress(params.walletAddress),
        secretHash: createHash("sha256").update(secret).digest("hex"),
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "webhookUrl must be a valid URL." };
  }
}

export function hashPublicWebhookRegistrationPayload(payload: PublicWebhookRegistrationPayload) {
  return hashSignedActionPayload([
    String(payload.chainId),
    payload.normalizedAddress,
    payload.callbackUrl,
    payload.eventTypes.join(","),
    payload.secretHash,
  ]);
}

export function buildPublicWebhookRegistrationMessage(params: {
  payload: PublicWebhookRegistrationPayload;
  payloadHash: string;
  nonce: string;
  expiresAt: Date;
}) {
  return buildSignedActionMessage({
    action: REGISTER_PUBLIC_WEBHOOK_ACTION,
    address: params.payload.normalizedAddress,
    expiresAt: params.expiresAt,
    nonce: params.nonce,
    payloadHash: params.payloadHash,
    title: PUBLIC_WEBHOOK_CHALLENGE_TITLE,
  });
}
