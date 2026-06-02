import { NextRequest, NextResponse } from "next/server";
import { type Hex } from "viem";
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
import { callPublicRateLoopMcpTool } from "~~/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function readToken(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new AgentAskHandoffError("token is required.");
}

function readTransactionHashes(value: unknown): Hex[] {
  if (!Array.isArray(value)) {
    throw new AgentAskHandoffError("transactionHashes must be an array.");
  }
  const hashes = value.filter((hash): hash is Hex => typeof hash === "string") as Hex[];
  if (hashes.length === 0 || hashes.length !== value.length || hashes.some(hash => !/^0x[a-fA-F0-9]{64}$/.test(hash))) {
    throw new AgentAskHandoffError("transactionHashes must contain at least one transaction hash.");
  }
  return hashes;
}

export async function POST(request: NextRequest, context: { params: Promise<{ handoffId: string }> }) {
  const { handoffId } = await context.params;

  return handlePublicAgentRoute({
    handler: async () => {
      const body = await parseJsonBody(request);
      if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);

      const token = readToken((body as { token?: unknown }).token);
      const transactionHashes = readTransactionHashes((body as { transactionHashes?: unknown }).transactionHashes);
      const handoff = await loadAgentAskHandoffByToken({ handoffId, token });
      if (handoff.status === "submitted") {
        const assets = await listAgentAskHandoffAssets(handoff.id);
        return buildAgentAskHandoffResponse({ assets, handoff, includeImageData: true });
      }
      if (!handoff.operationKey || handoff.status !== "prepared") {
        return NextResponse.json({ error: "Prepare this handoff before completing it." }, { status: 400 });
      }

      const result = (await callPublicRateLoopMcpTool({
        arguments: {
          operationKey: handoff.operationKey,
          transactionHashes,
        },
        name: "rateloop_confirm_ask_transactions",
        requestUrl: request.url,
      })) as Record<string, unknown>;
      await updateAgentAskHandoffStatus({
        handoffId,
        status: result.status === "submitted" ? "submitted" : "prepared",
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
