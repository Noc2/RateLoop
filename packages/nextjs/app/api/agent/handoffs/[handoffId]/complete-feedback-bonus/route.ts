import { NextRequest } from "next/server";
import {
  AgentAskHandoffError,
  buildAgentAskHandoffResponse,
  listAgentAskHandoffAssets,
  loadAgentAskHandoffByToken,
  updateAgentAskHandoffFeedbackBonusStatus,
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

export async function POST(request: NextRequest, context: { params: Promise<{ handoffId: string }> }) {
  const { handoffId } = await context.params;

  return handlePublicAgentRoute({
    handler: async () => {
      const body = await parseJsonBody(request);
      if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);

      const token = readToken((body as { token?: unknown }).token);
      const transactionHashes = readAgentTransactionHashes(
        (body as { transactionHashes?: unknown }).transactionHashes,
        message => new AgentAskHandoffError(message),
      );
      const handoff = await loadAgentAskHandoffByToken({ handoffId, token });
      if (!handoff.operationKey) {
        throw new AgentAskHandoffError("Prepare this handoff before completing its Feedback Bonus.");
      }

      await updateAgentAskHandoffFeedbackBonusStatus({
        error: null,
        handoffId,
        status: "pending_confirmation",
        transactionHashes,
      });

      let result: JsonObject;
      try {
        result = (await callPublicRateLoopMcpTool({
          arguments: {
            operationKey: handoff.operationKey,
            transactionHashes,
          },
          name: "rateloop_confirm_feedback_bonus_transactions",
          requestUrl: request.url,
        })) as JsonObject;
      } catch (error) {
        await updateAgentAskHandoffFeedbackBonusStatus({
          error: error instanceof Error ? error.message : String(error),
          handoffId,
          status: "failed_confirmation",
          transactionHashes,
        });
        throw error;
      }

      await updateAgentAskHandoffFeedbackBonusStatus({
        error: null,
        handoffId,
        status: "confirmed",
        transactionHashes,
      });
      const updatedHandoff = await loadAgentAskHandoffByToken({ handoffId, token });
      const assets = await listAgentAskHandoffAssets(updatedHandoff.id);
      return {
        ...buildAgentAskHandoffResponse({ assets, handoff: updatedHandoff, includeImageData: true }),
        ask: result,
        publicUrl: typeof result.publicUrl === "string" ? result.publicUrl : null,
      };
    },
    rateLimit: AGENT_WRITE_RATE_LIMIT,
    request,
  });
}
