import { NextRequest } from "next/server";
import {
  AgentAskHandoffError,
  buildAgentAskHandoffResponse,
  listAgentAskHandoffAssets,
  loadAgentAskHandoffByToken,
  updateAgentAskHandoffStatus,
} from "~~/lib/agent/handoffs";
import {
  AGENT_WRITE_RATE_LIMIT,
  handlePublicAgentRoute,
  isJsonObjectBody,
  jsonBodyErrorResponse,
  parseJsonBody,
} from "~~/lib/agent/http";
import { readAgentTransactionHashes } from "~~/lib/agent/transactionHashes";
import { callPublicRateLoopMcpTool } from "~~/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type JsonObject = Record<string, unknown>;

function readToken(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new AgentAskHandoffError("token is required.");
}

function readIncludeImageData(value: unknown) {
  return value === true || value === "true";
}

function hasRequestedFeedbackBonus(requestBody: JsonObject) {
  const feedbackBonus = requestBody.feedbackBonus;
  if (!feedbackBonus || typeof feedbackBonus !== "object" || Array.isArray(feedbackBonus)) return false;
  const amount = (feedbackBonus as JsonObject).amount;
  if (typeof amount === "number") return Number.isFinite(amount) && amount > 0;
  if (typeof amount === "string") {
    try {
      return BigInt(amount.trim()) > 0n;
    } catch {
      return false;
    }
  }
  return false;
}

function canRecoverSubmittedFeedbackBonusPlan(handoff: Awaited<ReturnType<typeof loadAgentAskHandoffByToken>>) {
  return Boolean(
    handoff &&
      handoff.status === "submitted" &&
      handoff.operationKey &&
      handoff.transactionHashes.length > 0 &&
      hasRequestedFeedbackBonus(handoff.requestBody) &&
      handoff.feedbackBonusTransactionHashes.length === 0 &&
      handoff.feedbackBonusStatus !== "confirmed",
  );
}

export async function POST(request: NextRequest, context: { params: Promise<{ handoffId: string }> }) {
  const { handoffId } = await context.params;

  return handlePublicAgentRoute({
    handler: async () => {
      const body = await parseJsonBody(request);
      if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);

      const token = readToken((body as { token?: unknown }).token);
      const includeImageData = readIncludeImageData((body as { includeImageData?: unknown }).includeImageData);
      const transactionHashes = readAgentTransactionHashes(
        (body as { transactionHashes?: unknown }).transactionHashes,
        message => new AgentAskHandoffError(message),
      );
      const handoff = await loadAgentAskHandoffByToken({ handoffId, token });
      if (handoff.status === "submitted") {
        const assets = await listAgentAskHandoffAssets(handoff.id);
        const response = buildAgentAskHandoffResponse({ assets, handoff, includeImageData });
        if (!canRecoverSubmittedFeedbackBonusPlan(handoff)) {
          return response;
        }
        const result = (await callPublicRateLoopMcpTool({
          arguments: {
            operationKey: handoff.operationKey,
            transactionHashes: handoff.transactionHashes,
          },
          name: "rateloop_confirm_ask_transactions",
          requestUrl: request.url,
        })) as JsonObject;
        return {
          ...response,
          ask: result,
          publicUrl: typeof result.publicUrl === "string" ? result.publicUrl : null,
        };
      }
      if (handoff.status === "expired" && handoff.operationKey) {
        throw new AgentAskHandoffError(
          `This handoff expired after preparation. If wallet transactions were already submitted, recover by calling rateloop_confirm_ask_transactions with operationKey ${handoff.operationKey} and the submitted transaction hashes; do not rebroadcast the wallet calls. Otherwise ask the agent for a fresh handoff link.`,
          410,
        );
      }
      if (!handoff.operationKey || (handoff.status !== "prepared" && handoff.status !== "failed")) {
        throw new AgentAskHandoffError("Prepare this handoff before completing it.");
      }

      let result: JsonObject;
      try {
        result = (await callPublicRateLoopMcpTool({
          arguments: {
            operationKey: handoff.operationKey,
            transactionHashes,
          },
          name: "rateloop_confirm_ask_transactions",
          requestUrl: request.url,
        })) as JsonObject;
      } catch (error) {
        await updateAgentAskHandoffStatus({
          error: error instanceof Error ? error.message : String(error),
          handoffId,
          status: "failed",
          transactionHashes,
        });
        throw error;
      }
      const nextStatus = result.status === "submitted" ? "submitted" : "prepared";
      await updateAgentAskHandoffStatus({
        error: null,
        handoffId,
        status: nextStatus,
        transactionHashes,
        transactionPlan: nextStatus === "submitted" ? null : undefined,
      });
      const updatedHandoff = await loadAgentAskHandoffByToken({ handoffId, token });
      const assets = await listAgentAskHandoffAssets(updatedHandoff.id);
      return {
        ...buildAgentAskHandoffResponse({ assets, handoff: updatedHandoff, includeImageData }),
        ask: result,
        publicUrl: typeof result.publicUrl === "string" ? result.publicUrl : null,
      };
    },
    rateLimit: AGENT_WRITE_RATE_LIMIT,
    request,
  });
}
