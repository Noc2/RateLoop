import { NextRequest } from "next/server";
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

type JsonObject = Record<string, unknown>;

function readToken(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new AgentAskHandoffError("token is required.");
}

const MAX_TRANSACTION_HASHES = 32;

function readTransactionHashes(value: unknown): Hex[] {
  if (!Array.isArray(value)) {
    throw new AgentAskHandoffError("transactionHashes must be an array.");
  }
  if (value.length > MAX_TRANSACTION_HASHES) {
    throw new AgentAskHandoffError(
      `transactionHashes must contain at most ${MAX_TRANSACTION_HASHES} transaction hashes.`,
    );
  }
  const hashes = value.filter((hash): hash is Hex => typeof hash === "string") as Hex[];
  if (hashes.length === 0 || hashes.length !== value.length || hashes.some(hash => !/^0x[a-fA-F0-9]{64}$/.test(hash))) {
    throw new AgentAskHandoffError("transactionHashes must contain at least one transaction hash.");
  }
  return hashes;
}

function readJsonObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function readFeedbackBonusTransactionPlan(result: JsonObject): JsonObject | null {
  const feedbackBonus = readJsonObject(result.feedbackBonus);
  if (!feedbackBonus || feedbackBonus.status !== "awaiting_wallet_signature") return null;
  return readJsonObject(feedbackBonus.transactionPlan);
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
      const confirmsFeedbackBonus = handoff.status === "feedback_bonus_prepared";
      if (!handoff.operationKey || (handoff.status !== "prepared" && !confirmsFeedbackBonus)) {
        throw new AgentAskHandoffError("Prepare this handoff before completing it.");
      }

      const result = (await callPublicRateLoopMcpTool({
        arguments: {
          operationKey: handoff.operationKey,
          transactionHashes,
        },
        name: confirmsFeedbackBonus
          ? "rateloop_confirm_feedback_bonus_transactions"
          : "rateloop_confirm_ask_transactions",
        requestUrl: request.url,
      })) as JsonObject;
      const feedbackBonusTransactionPlan = confirmsFeedbackBonus ? null : readFeedbackBonusTransactionPlan(result);
      const nextStatus = feedbackBonusTransactionPlan
        ? "feedback_bonus_prepared"
        : result.status === "submitted"
          ? "submitted"
          : "prepared";
      const storedTransactionHashes = confirmsFeedbackBonus
        ? [...handoff.transactionHashes, ...transactionHashes]
        : transactionHashes;
      await updateAgentAskHandoffStatus({
        handoffId,
        status: nextStatus,
        transactionHashes: storedTransactionHashes,
        transactionPlan: feedbackBonusTransactionPlan ?? undefined,
      });
      const updatedHandoff = await loadAgentAskHandoffByToken({ handoffId, token });
      const assets = await listAgentAskHandoffAssets(updatedHandoff.id);
      return {
        ...buildAgentAskHandoffResponse({ assets, handoff: updatedHandoff, includeImageData: true }),
        ask: result,
        nextAction:
          nextStatus === "feedback_bonus_prepared"
            ? "Execute the Feedback Bonus transactionPlan.calls in the connected wallet, then confirm transaction hashes."
            : undefined,
        publicUrl: typeof result.publicUrl === "string" ? result.publicUrl : null,
      };
    },
    rateLimit: AGENT_WRITE_RATE_LIMIT,
    request,
  });
}
