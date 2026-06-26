import { NextRequest } from "next/server";
import { AGENT_APP_BASE_URL_REQUIRED_MESSAGE, resolveAgentAppBaseUrl } from "~~/lib/agent/appBaseUrl";
import { agentRouteErrorResponse, parseJsonBody } from "~~/lib/agent/http";
import { AgentPolicyLifecycleError, revokeAgentPolicyToken, rotateAgentPolicyToken } from "~~/lib/agent/policies";
import {
  REVOKE_AGENT_POLICY_TOKEN_ACTION,
  ROTATE_AGENT_POLICY_TOKEN_ACTION,
  buildAgentPolicyChallengeMessage,
  hashAgentPolicyManagementPayload,
  normalizeAgentPolicyManagementInput,
} from "~~/lib/auth/agentPolicies";
import { createSignedReadResponse, verifySignedActionChallenge } from "~~/lib/auth/signedRouteHelpers";
import { buildAppRelativeUrl } from "~~/lib/url/appRelative";
import { checkRateLimit } from "~~/utils/rateLimit";

const WRITE_RATE_LIMIT = { limit: 20, windowMs: 60_000 };
const POLICY_TOKEN_ROUTE_PATH = "/api/agent/policies/token";

function buildMcpConfig(token: string, appBaseUrl: string, agentWalletAddress: string) {
  return {
    mcpServers: {
      rateloop: {
        headers: {
          Authorization: `Bearer ${token}`,
          "MCP-Protocol-Version": "2025-11-25",
        },
        paymentModes: ["wallet_calls", "eip3009_usdc_authorization", "x402_authorization"],
        transport: "streamable-http",
        url: buildAppRelativeUrl(appBaseUrl, "/api/mcp").toString(),
        walletAddress: agentWalletAddress,
      },
    },
  };
}

async function verifyManagementAction(
  body: Record<string, unknown> & { signature?: `0x${string}`; challengeId?: string },
  action: typeof ROTATE_AGENT_POLICY_TOKEN_ACTION | typeof REVOKE_AGENT_POLICY_TOKEN_ACTION,
) {
  if (!body.signature || !body.challengeId) {
    return { ok: false as const, response: agentRouteErrorResponse("Missing or invalid fields", 400) };
  }

  const normalized = normalizeAgentPolicyManagementInput(body);
  if (!normalized.ok) {
    return { ok: false as const, response: agentRouteErrorResponse(normalized.error, 400) };
  }

  const payloadHash = hashAgentPolicyManagementPayload(normalized.payload);
  const challengeFailure = await verifySignedActionChallenge({
    challengeId: String(body.challengeId),
    action,
    walletAddress: normalized.payload.normalizedAddress,
    payloadHash,
    signature: body.signature,
    buildMessage: ({ nonce, expiresAt }) =>
      buildAgentPolicyChallengeMessage({
        action,
        address: normalized.payload.normalizedAddress,
        payloadHash,
        nonce,
        expiresAt,
      }),
  });
  if (challengeFailure) return { ok: false as const, response: challengeFailure };

  return { ok: true as const, payload: normalized.payload };
}

export async function POST(request: NextRequest) {
  const limited = await checkRateLimit(request, WRITE_RATE_LIMIT);
  if (limited) return limited;

  try {
    const body = await parseJsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return agentRouteErrorResponse("Invalid JSON body", 400);
    }

    const verified = await verifyManagementAction(body, ROTATE_AGENT_POLICY_TOKEN_ACTION);
    if (!verified.ok) return verified.response;

    const appBaseUrl = resolveAgentAppBaseUrl(request.url, POLICY_TOKEN_ROUTE_PATH);
    if (!appBaseUrl) {
      return agentRouteErrorResponse(AGENT_APP_BASE_URL_REQUIRED_MESSAGE, 503, {
        recoverWith: "configure_app_url",
      });
    }

    const { policy, token } = await rotateAgentPolicyToken({
      ownerWalletAddress: verified.payload.normalizedAddress,
      policyId: verified.payload.policyId,
    });
    return createSignedReadResponse(verified.payload.normalizedAddress, "agent_policies", {
      ok: true,
      policy,
      token,
      mcpConfig: buildMcpConfig(token, appBaseUrl, policy.agentWalletAddress),
    });
  } catch (error) {
    if (error instanceof AgentPolicyLifecycleError) {
      return agentRouteErrorResponse(error.message, 409);
    }
    console.error("Error rotating agent policy token:", error);
    return agentRouteErrorResponse("Failed to rotate agent policy token", 500);
  }
}

export async function DELETE(request: NextRequest) {
  const limited = await checkRateLimit(request, WRITE_RATE_LIMIT);
  if (limited) return limited;

  try {
    const body = await parseJsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return agentRouteErrorResponse("Invalid JSON body", 400);
    }

    const verified = await verifyManagementAction(body, REVOKE_AGENT_POLICY_TOKEN_ACTION);
    if (!verified.ok) return verified.response;

    const policy = await revokeAgentPolicyToken({
      ownerWalletAddress: verified.payload.normalizedAddress,
      policyId: verified.payload.policyId,
    });
    return createSignedReadResponse(verified.payload.normalizedAddress, "agent_policies", { ok: true, policy });
  } catch (error) {
    console.error("Error revoking agent policy token:", error);
    return agentRouteErrorResponse("Failed to revoke agent policy token", 500);
  }
}
