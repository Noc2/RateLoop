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
      if (handoff.status === "submitted") {
        const assets = await listAgentAskHandoffAssets(handoff.id);
        return buildAgentAskHandoffResponse({ assets, handoff, includeImageData: true });
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
        ...buildAgentAskHandoffResponse({ assets, handoff: updatedHandoff, includeImageData: true }),
        ask: result,
        publicUrl: typeof result.publicUrl === "string" ? result.publicUrl : null,
      };
    },
    rateLimit: AGENT_WRITE_RATE_LIMIT,
    request,
  });
}
