import { ROUND_STATE } from "@rateloop/contracts/protocol";
import { createHash } from "crypto";
import { type Address, type Hex, isAddress } from "viem";
import {
  AGENT_CALLBACK_EVENT_TYPES,
  type AgentCallbackEventType,
  enqueueAgentCallbackEvent,
  listAgentCallbackEventsByEventIdPrefix,
  upsertAgentCallbackSubscription,
} from "~~/lib/agent-callbacks";
import { buildAgentCallbackPayload, callbackEventId, getAgentPublicQuestionUrl } from "~~/lib/agent-callbacks/payload";
import { assertSafeAgentCallbackUrl } from "~~/lib/agent-callbacks/urlSafety";
import { buildAgentFastLaneGuidance } from "~~/lib/agent/fastLane";
import { buildAgentLegalNotice } from "~~/lib/agent/legalNotice";
import { buildAgentLiveAskGuidance } from "~~/lib/agent/liveAskGuidance";
import { buildAgentResultPackage, resolveAgentBountyEligibilityScope } from "~~/lib/agent/resultPackage";
import {
  agentAskHumansInputSchema,
  agentAskHumansOutputSchema,
  agentBalanceOutputSchema,
  agentConfirmAskTransactionsInputSchema,
  agentConfirmFeedbackBonusTransactionsInputSchema,
  agentOperationLookupInputSchema,
  agentQuestionStatusOutputSchema,
  agentQuoteInputSchema,
  agentQuoteOutputSchema,
  resultPackageOutputSchema,
  templateListOutputSchema,
} from "~~/lib/agent/schemas";
import { findAgentResultTemplate, listAgentResultTemplates } from "~~/lib/agent/templates";
import { attachImagesToOperation } from "~~/lib/attachments/imageAttachments";
import { buildContentFeedbackRoundContext, listContentFeedback } from "~~/lib/feedback/contentFeedback";
import { MCP_SCOPES, type McpAgentAuth, type McpScope } from "~~/lib/mcp/auth";
import {
  McpBudgetError,
  getMcpAgentBudgetSummary,
  getMcpBudgetReservation,
  getMcpBudgetReservationByClientRequest,
  reserveMcpAgentBudget,
  updateMcpBudgetReservation,
} from "~~/lib/mcp/budget";
import {
  X402QuestionInputError,
  type X402QuestionPayload,
  X402_USDC_DECIMALS,
  parseX402QuestionRequest,
} from "~~/lib/x402/questionPayload";
import {
  type X402FeedbackBonusRequest,
  X402QuestionConfigError,
  X402QuestionConflictError,
  buildPermissionlessWalletClientRequestId,
  confirmAgentWalletQuestionSubmissionRequest,
  confirmFeedbackBonusQuestionSubmissionRequest,
  getX402QuestionSubmissionByClientRequest,
  getX402QuestionSubmissionByOperationKey,
  preflightX402QuestionSubmission,
  prepareAgentWalletQuestionSubmissionRequest,
  prepareFeedbackBonusQuestionSubmissionRequest,
  prepareNativeX402QuestionSubmissionRequest,
  preparePermissionlessNativeX402QuestionSubmissionRequest,
  preparePermissionlessWalletQuestionSubmissionRequest,
  resolveX402QuestionConfig,
  toPermissionlessWalletPayload,
  x402QuestionSubmissionRecordBody,
} from "~~/lib/x402/questionSubmission";
import {
  type PonderContentItem,
  type PonderRaterParticipationStatusResponse,
  type PonderVoteItem,
  ponderApi,
} from "~~/services/ponder/client";

type JsonObject = Record<string, unknown>;

type McpToolDefinition = {
  annotations?: {
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    readOnlyHint?: boolean;
  };
  description: string;
  inputSchema: JsonObject;
  name: string;
  outputSchema?: JsonObject;
  requiredScope: McpScope;
  title: string;
};

type AskHumansMode = "sync" | "async";
type AskHumansPaymentMode = "wallet_calls" | "x402_authorization";
type BackgroundTaskScheduler = (task: () => Promise<void> | void) => void;

type McpToolDependencies = {
  confirmAgentWalletQuestionSubmissionRequest: typeof confirmAgentWalletQuestionSubmissionRequest;
  confirmFeedbackBonusQuestionSubmissionRequest: typeof confirmFeedbackBonusQuestionSubmissionRequest;
  enqueueAgentCallbackEvent: typeof enqueueAgentCallbackEvent;
  getAllVotes: typeof ponderApi.getAllVotes;
  getContentById: typeof ponderApi.getContentById;
  getRaterParticipationStatus: typeof ponderApi.getRaterParticipationStatus;
  getMcpAgentBudgetSummary: typeof getMcpAgentBudgetSummary;
  prepareAgentWalletQuestionSubmissionRequest: typeof prepareAgentWalletQuestionSubmissionRequest;
  prepareFeedbackBonusQuestionSubmissionRequest: typeof prepareFeedbackBonusQuestionSubmissionRequest;
  prepareNativeX402QuestionSubmissionRequest: typeof prepareNativeX402QuestionSubmissionRequest;
  preparePermissionlessNativeX402QuestionSubmissionRequest: typeof preparePermissionlessNativeX402QuestionSubmissionRequest;
  preparePermissionlessWalletQuestionSubmissionRequest: typeof preparePermissionlessWalletQuestionSubmissionRequest;
  preflightX402QuestionSubmission: typeof preflightX402QuestionSubmission;
  reserveMcpAgentBudget: typeof reserveMcpAgentBudget;
  resolveX402QuestionConfig: typeof resolveX402QuestionConfig;
  updateMcpBudgetReservation: typeof updateMcpBudgetReservation;
  upsertAgentCallbackSubscription: typeof upsertAgentCallbackSubscription;
};

let mcpToolTestOverrides: Partial<McpToolDependencies> | null = null;

function getMcpToolDependencies(): McpToolDependencies {
  return {
    confirmAgentWalletQuestionSubmissionRequest:
      mcpToolTestOverrides?.confirmAgentWalletQuestionSubmissionRequest ?? confirmAgentWalletQuestionSubmissionRequest,
    confirmFeedbackBonusQuestionSubmissionRequest:
      mcpToolTestOverrides?.confirmFeedbackBonusQuestionSubmissionRequest ??
      confirmFeedbackBonusQuestionSubmissionRequest,
    enqueueAgentCallbackEvent: mcpToolTestOverrides?.enqueueAgentCallbackEvent ?? enqueueAgentCallbackEvent,
    getAllVotes: mcpToolTestOverrides?.getAllVotes ?? (params => ponderApi.getAllVotes(params)),
    getContentById: mcpToolTestOverrides?.getContentById ?? ponderApi.getContentById,
    getRaterParticipationStatus:
      mcpToolTestOverrides?.getRaterParticipationStatus ?? ponderApi.getRaterParticipationStatus,
    getMcpAgentBudgetSummary: mcpToolTestOverrides?.getMcpAgentBudgetSummary ?? getMcpAgentBudgetSummary,
    prepareAgentWalletQuestionSubmissionRequest:
      mcpToolTestOverrides?.prepareAgentWalletQuestionSubmissionRequest ?? prepareAgentWalletQuestionSubmissionRequest,
    prepareFeedbackBonusQuestionSubmissionRequest:
      mcpToolTestOverrides?.prepareFeedbackBonusQuestionSubmissionRequest ??
      prepareFeedbackBonusQuestionSubmissionRequest,
    prepareNativeX402QuestionSubmissionRequest:
      mcpToolTestOverrides?.prepareNativeX402QuestionSubmissionRequest ?? prepareNativeX402QuestionSubmissionRequest,
    preparePermissionlessNativeX402QuestionSubmissionRequest:
      mcpToolTestOverrides?.preparePermissionlessNativeX402QuestionSubmissionRequest ??
      preparePermissionlessNativeX402QuestionSubmissionRequest,
    preparePermissionlessWalletQuestionSubmissionRequest:
      mcpToolTestOverrides?.preparePermissionlessWalletQuestionSubmissionRequest ??
      preparePermissionlessWalletQuestionSubmissionRequest,
    preflightX402QuestionSubmission:
      mcpToolTestOverrides?.preflightX402QuestionSubmission ?? preflightX402QuestionSubmission,
    reserveMcpAgentBudget: mcpToolTestOverrides?.reserveMcpAgentBudget ?? reserveMcpAgentBudget,
    resolveX402QuestionConfig: mcpToolTestOverrides?.resolveX402QuestionConfig ?? resolveX402QuestionConfig,
    updateMcpBudgetReservation: mcpToolTestOverrides?.updateMcpBudgetReservation ?? updateMcpBudgetReservation,
    upsertAgentCallbackSubscription:
      mcpToolTestOverrides?.upsertAgentCallbackSubscription ?? upsertAgentCallbackSubscription,
  };
}

export function __setMcpToolTestOverridesForTests(overrides: Partial<McpToolDependencies> | null) {
  mcpToolTestOverrides = overrides;
}

export class McpToolError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "McpToolError";
    this.status = status;
  }
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    annotations: {
      idempotentHint: true,
      openWorldHint: true,
      readOnlyHint: true,
    },
    description: "List RateLoop categories that paid asks can target.",
    inputSchema: {
      additionalProperties: false,
      properties: {},
      type: "object",
    },
    name: "rateloop_list_categories",
    requiredScope: MCP_SCOPES.read,
    title: "List RateLoop Categories",
  },
  {
    annotations: {
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: true,
    },
    description: "List off-chain result interpretation templates used by RateLoop agent asks.",
    inputSchema: {
      additionalProperties: false,
      properties: {},
      type: "object",
    },
    name: "rateloop_list_result_templates",
    outputSchema: templateListOutputSchema,
    requiredScope: MCP_SCOPES.read,
    title: "List Result Templates",
  },
  {
    annotations: {
      idempotentHint: true,
      openWorldHint: true,
      readOnlyHint: true,
    },
    description:
      "Preflight and price a paid question before reserving spend. Returns Terms and Privacy Notice links for low-friction operator review.",
    inputSchema: agentQuoteInputSchema,
    name: "rateloop_quote_question",
    outputSchema: agentQuoteOutputSchema,
    requiredScope: MCP_SCOPES.quote,
    title: "Quote Human Ask",
  },
  {
    annotations: {
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
      readOnlyHint: false,
    },
    description:
      "Prepare a paid human-feedback ask and return either wallet transaction calls or a native x402 USDC authorization request, plus Terms and Privacy Notice links. Public wallet-mode asks are not submitted until the wallet signs and the hashes are confirmed.",
    inputSchema: agentAskHumansInputSchema,
    name: "rateloop_ask_humans",
    outputSchema: agentAskHumansOutputSchema,
    requiredScope: MCP_SCOPES.ask,
    title: "Ask Humans",
  },
  {
    annotations: {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
      readOnlyHint: false,
    },
    description: "Confirm wallet-executed RateLoop ask transactions and attach the submitted content ids to the ask.",
    inputSchema: agentConfirmAskTransactionsInputSchema,
    name: "rateloop_confirm_ask_transactions",
    outputSchema: agentQuestionStatusOutputSchema,
    requiredScope: MCP_SCOPES.ask,
    title: "Confirm Ask Transactions",
  },
  {
    annotations: {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
      readOnlyHint: false,
    },
    description: "Confirm wallet-executed Feedback Bonus transactions and attach the funded bonus pool to the ask.",
    inputSchema: agentConfirmFeedbackBonusTransactionsInputSchema,
    name: "rateloop_confirm_feedback_bonus_transactions",
    outputSchema: agentQuestionStatusOutputSchema,
    requiredScope: MCP_SCOPES.ask,
    title: "Confirm Feedback Bonus Transactions",
  },
  {
    annotations: {
      idempotentHint: true,
      openWorldHint: true,
      readOnlyHint: true,
    },
    description: "Get paid ask operation status by operationKey or chainId plus clientRequestId.",
    inputSchema: agentOperationLookupInputSchema,
    name: "rateloop_get_question_status",
    outputSchema: agentQuestionStatusOutputSchema,
    requiredScope: MCP_SCOPES.read,
    title: "Get Question Status",
  },
  {
    annotations: {
      idempotentHint: true,
      openWorldHint: true,
      readOnlyHint: true,
    },
    description: "Fetch the public human signal for a submitted question.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        chainId: { description: "Chain id used with clientRequestId lookup.", type: "integer" },
        clientRequestId: { description: "Client idempotency key returned by rateloop_ask_humans.", type: "string" },
        contentId: { description: "RateLoop content id.", type: "string" },
        operationKey: { description: "RateLoop operation key returned by quote or ask.", type: "string" },
        walletAddress: {
          description:
            "Required for public wallet-mode lookup by chainId and clientRequestId. Not needed when operationKey is provided.",
          pattern: "^0x[a-fA-F0-9]{40}$",
          type: "string",
        },
      },
      type: "object",
    },
    name: "rateloop_get_result",
    outputSchema: resultPackageOutputSchema,
    requiredScope: MCP_SCOPES.read,
    title: "Get Human Result",
  },
  {
    annotations: {
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: true,
    },
    description: "Show this authenticated agent's managed MCP budget and caps.",
    inputSchema: {
      additionalProperties: false,
      properties: {},
      type: "object",
    },
    name: "rateloop_get_agent_balance",
    outputSchema: agentBalanceOutputSchema,
    requiredScope: MCP_SCOPES.balance,
    title: "Get Agent Balance",
  },
];

const PUBLIC_MCP_TOOL_NAMES = new Set([
  "rateloop_list_categories",
  "rateloop_list_result_templates",
  "rateloop_quote_question",
  "rateloop_ask_humans",
  "rateloop_confirm_ask_transactions",
  "rateloop_confirm_feedback_bonus_transactions",
  "rateloop_get_question_status",
  "rateloop_get_result",
]);

export const PUBLIC_MCP_TOOLS = MCP_TOOLS.filter(tool => PUBLIC_MCP_TOOL_NAMES.has(tool.name));

function asObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new McpToolError("Tool arguments must be an object.");
  }
  return value as JsonObject;
}

function questionPayloadArgs(args: JsonObject): JsonObject {
  const payloadArgs = { ...args };
  delete payloadArgs.feedbackBonus;
  return payloadArgs;
}

function parseMaxPaymentAmount(value: unknown): bigint {
  const rawValue =
    typeof value === "number" || typeof value === "bigint" || typeof value === "string" ? String(value) : "";
  if (!/^\d+$/.test(rawValue.trim())) {
    throw new McpToolError("maxPaymentAmount must be a non-negative integer string.");
  }
  return BigInt(rawValue);
}

function parseAtomicAmount(value: unknown, fieldName: string): bigint {
  const rawValue =
    typeof value === "number" || typeof value === "bigint" || typeof value === "string" ? String(value).trim() : "";
  if (!/^\d+$/.test(rawValue)) {
    throw new McpToolError(`${fieldName} must be a non-negative integer string.`);
  }
  return BigInt(rawValue);
}

function parseOptionalFeedbackBonus(
  args: JsonObject,
  payload: X402QuestionPayload,
  walletAddress: Address,
): X402FeedbackBonusRequest | null {
  const raw = args.feedbackBonus;
  if (raw === undefined || raw === null || raw === false) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new McpToolError("feedbackBonus must be an object when provided.");
  }
  if (payload.questions.length !== 1) {
    throw new McpToolError("Feedback Bonuses are currently supported for single-question asks only.");
  }

  const value = raw as JsonObject;
  const asset = typeof value.asset === "string" ? value.asset.trim().toUpperCase() : "USDC";
  if (asset !== "USDC") {
    throw new McpToolError("feedbackBonus.asset must be USDC.");
  }
  const amount = parseAtomicAmount(value.amount, "feedbackBonus.amount");
  if (amount <= 0n) {
    throw new McpToolError("feedbackBonus.amount must be greater than zero.");
  }
  const feedbackClosesAt = parseAtomicAmount(
    value.feedbackClosesAt ?? payload.bounty.rewardPoolExpiresAt,
    "feedbackBonus.feedbackClosesAt",
  );
  if (feedbackClosesAt <= 0n) {
    throw new McpToolError("feedbackBonus.feedbackClosesAt must be greater than zero.");
  }
  if (payload.bounty.rewardPoolExpiresAt > 0n && feedbackClosesAt > payload.bounty.rewardPoolExpiresAt) {
    throw new McpToolError("feedbackBonus.feedbackClosesAt cannot be after bounty.rewardPoolExpiresAt.");
  }

  const awarder = typeof value.awarder === "string" && value.awarder.trim() ? value.awarder.trim() : walletAddress;
  if (!isAddress(awarder)) {
    throw new McpToolError("feedbackBonus.awarder must be an EVM address.");
  }

  return {
    amount,
    asset: "USDC",
    awarder,
    feedbackClosesAt,
  };
}

function feedbackBonusAmount(feedbackBonus: X402FeedbackBonusRequest | null) {
  return feedbackBonus?.amount ?? 0n;
}

function buildFeedbackBonusGuidance(feedbackBonus: X402FeedbackBonusRequest | null, payload: X402QuestionPayload) {
  return {
    included: Boolean(feedbackBonus),
    note: feedbackBonus
      ? "The Feedback Bonus is funded after the question transaction confirms and rewards useful hidden rater feedback."
      : "Consider adding a small Feedback Bonus for qualitative AI review questions where written rationale is valuable.",
    recommended: payload.questions.length === 1,
    suggestedAmountAtomic: feedbackBonus ? feedbackBonus.amount.toString() : "2000000",
  };
}

function buildPendingFeedbackBonusBody(feedbackBonus: X402FeedbackBonusRequest | null) {
  if (!feedbackBonus) {
    return {
      enabled: false,
      status: "not_requested",
    };
  }

  return {
    amount: feedbackBonus.amount.toString(),
    asset: "USDC",
    awarder: feedbackBonus.awarder,
    enabled: true,
    feedbackClosesAt: feedbackBonus.feedbackClosesAt.toString(),
    nextTool: "rateloop_confirm_ask_transactions",
    status: "pending_question_confirmation",
  };
}

function applyFeedbackBonusPaymentFields(body: JsonObject, feedbackBonus: X402FeedbackBonusRequest | null): JsonObject {
  if (!feedbackBonus || !body.payment || typeof body.payment !== "object" || Array.isArray(body.payment)) return body;
  const payment = body.payment as JsonObject;
  const bountyAmount = parseAtomicAmount(payment.bountyAmount ?? payment.amount, "payment.amount");
  const feedbackAmount = feedbackBonusAmount(feedbackBonus);
  return {
    ...body,
    payment: {
      ...payment,
      feedbackBonusAmount: feedbackAmount.toString(),
      totalAmount: (bountyAmount + feedbackAmount).toString(),
    },
  };
}

function parseAgentWalletAddress(args: JsonObject, agent: McpAgentAuth): Address {
  const scopedAddress = agent.walletAddress?.trim() || "";
  const suppliedAddress =
    typeof args.walletAddress === "string"
      ? args.walletAddress.trim()
      : typeof args.agentWalletAddress === "string"
        ? args.agentWalletAddress.trim()
        : "";
  const rawAddress = scopedAddress || suppliedAddress;
  if (!isAddress(rawAddress)) {
    throw new McpToolError(
      "walletAddress is required and must be the user-controlled smart wallet or scoped agent wallet that will sign the transaction plan.",
      400,
    );
  }
  if (scopedAddress && suppliedAddress && scopedAddress.toLowerCase() !== suppliedAddress.toLowerCase()) {
    throw new McpToolError("walletAddress does not match the scoped MCP agent wallet.", 403);
  }

  return rawAddress;
}

function parsePublicWalletAddress(args: JsonObject): Address {
  const rawAddress =
    typeof args.walletAddress === "string"
      ? args.walletAddress.trim()
      : typeof args.agentWalletAddress === "string"
        ? args.agentWalletAddress.trim()
        : "";
  if (!isAddress(rawAddress)) {
    throw new McpToolError(
      "walletAddress is required for permissionless asks and must be the wallet that signs the transaction plan.",
      400,
    );
  }

  return rawAddress;
}

function assertNoPublicWebhook(args: JsonObject) {
  const hasWebhookUrl = typeof args.webhookUrl === "string" && args.webhookUrl.trim().length > 0;
  const hasWebhookSecret = typeof args.webhookSecret === "string" && args.webhookSecret.trim().length > 0;
  const hasWebhookEvents = Array.isArray(args.webhookEvents) && args.webhookEvents.length > 0;
  if (hasWebhookUrl || hasWebhookSecret || hasWebhookEvents) {
    throw new McpToolError("Callbacks require a managed agent token and are unavailable in public wallet mode.", 401);
  }
}

function parseAskHumansMode(value: unknown): AskHumansMode {
  if (value === undefined || value === null) return "sync";
  if (value === "sync" || value === "async") return value;
  throw new McpToolError("mode must be either sync or async.");
}

function parseAskHumansPaymentMode(value: unknown): AskHumansPaymentMode {
  if (value === undefined || value === null || value === "") return "wallet_calls";
  if (value === "wallet_calls" || value === "agent_wallet") return "wallet_calls";
  if (value === "x402_authorization" || value === "native_x402" || value === "x402") return "x402_authorization";
  throw new McpToolError("paymentMode must be wallet_calls or x402_authorization.");
}

async function parseWebhookOptions(args: JsonObject): Promise<{
  events: AgentCallbackEventType[];
  secret: string;
  url: string;
} | null> {
  const url = typeof args.webhookUrl === "string" ? args.webhookUrl.trim() : "";
  if (!url) return null;
  const secret = typeof args.webhookSecret === "string" ? args.webhookSecret.trim() : "";
  if (!secret) {
    throw new McpToolError("webhookSecret is required when webhookUrl is provided.");
  }

  let callbackUrl: string;
  try {
    callbackUrl = await assertSafeAgentCallbackUrl(url, "webhookUrl");
  } catch (error) {
    throw new McpToolError(error instanceof Error ? error.message : "webhookUrl must be a valid URL.");
  }

  const rawEvents = Array.isArray(args.webhookEvents)
    ? args.webhookEvents.filter((event): event is string => typeof event === "string")
    : [];
  const events =
    rawEvents.length > 0
      ? rawEvents.filter((event): event is AgentCallbackEventType =>
          AGENT_CALLBACK_EVENT_TYPES.includes(event as AgentCallbackEventType),
        )
      : ([
          "question.submitting",
          "question.submitted",
          "question.open",
          "question.settling",
          "question.failed",
          "question.settled",
          "feedback.unlocked",
          "bounty.low_response",
        ] satisfies AgentCallbackEventType[]);

  if (events.length === 0) {
    throw new McpToolError("webhookEvents must include at least one supported event type.");
  }

  return {
    events,
    secret,
    url: callbackUrl,
  };
}

function normalizeMcpPayment(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const payment = value as JsonObject;
  const asset = typeof payment.asset === "string" ? payment.asset : "";
  return {
    ...payment,
    asset: "USDC",
    decimals: X402_USDC_DECIMALS,
    tokenAddress: asset.startsWith("0x") ? asset : payment.tokenAddress,
  };
}

function normalizeMcpQuestionBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const body = value as JsonObject;
  return {
    ...body,
    payment: normalizeMcpPayment(body.payment),
  };
}

function normalizeCallbackDeliveries(
  deliveries: Awaited<ReturnType<typeof listAgentCallbackEventsByEventIdPrefix>>,
): Array<Record<string, unknown>> {
  return deliveries.map(delivery => ({
    attemptCount: delivery.attemptCount,
    callbackUrl: delivery.callbackUrl,
    deliveredAt: delivery.deliveredAt ? delivery.deliveredAt.toISOString() : null,
    eventId: delivery.eventId,
    eventType: delivery.eventType,
    lastError: delivery.lastError,
    nextAttemptAt: delivery.nextAttemptAt.toISOString(),
    status: delivery.status,
    subscriptionId: delivery.subscriptionId,
  }));
}

function agentStatusHints(body: JsonObject, latestRoundState: number | null = null) {
  const status = typeof body.status === "string" ? body.status : "not_found";
  const ready =
    latestRoundState === ROUND_STATE.Settled ||
    latestRoundState === ROUND_STATE.Cancelled ||
    latestRoundState === ROUND_STATE.Tied ||
    latestRoundState === ROUND_STATE.RevealFailed;
  const terminal = ready || status === "failed" || status === "not_found";

  return {
    nextAction:
      status === "failed" ? "manual_review" : ready ? "call_rateloop_get_result" : "poll_rateloop_get_question_status",
    pollAfterMs: terminal ? null : 5_000,
    ready,
    resultTool: ready ? "rateloop_get_result" : null,
    terminal,
  };
}

async function attachFeedbackBonusPlan(
  body: JsonObject,
  dependencies: McpToolDependencies,
  warnings: string[],
): Promise<JsonObject> {
  const feedbackBonus = body.feedbackBonus;
  const enabled =
    feedbackBonus &&
    typeof feedbackBonus === "object" &&
    !Array.isArray(feedbackBonus) &&
    (feedbackBonus as JsonObject).enabled === true;
  const status = enabled ? String((feedbackBonus as JsonObject).status ?? "") : "";
  const operationKey = typeof body.operationKey === "string" ? body.operationKey : "";
  if (!enabled || status !== "awaiting_wallet_signature" || !/^0x[a-fA-F0-9]{64}$/.test(operationKey)) {
    return body;
  }

  try {
    const result = await dependencies.prepareFeedbackBonusQuestionSubmissionRequest({
      operationKey: operationKey as `0x${string}`,
    });
    const planBody = normalizeMcpQuestionBody(result.body) as JsonObject;
    const planFeedbackBonus =
      planBody.feedbackBonus && typeof planBody.feedbackBonus === "object" && !Array.isArray(planBody.feedbackBonus)
        ? (planBody.feedbackBonus as JsonObject)
        : {};
    return {
      ...body,
      feedbackBonus: {
        ...(feedbackBonus as JsonObject),
        ...planFeedbackBonus,
        confirmTool: "rateloop_confirm_feedback_bonus_transactions",
      },
    };
  } catch (error) {
    console.error("[mcp] feedback bonus plan unavailable", error);
    warnings.push("feedback_bonus_plan_unavailable");
    return body;
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function buildManagedMcpClientRequestId(agent: McpAgentAuth, clientRequestId: string) {
  return `mcp:${sha256(`${agent.id}:${clientRequestId}`).slice(0, 48)}`;
}

function getQuestionImageUrls(payload: X402QuestionPayload) {
  return payload.questions.flatMap(question => question.imageUrls);
}

function assertManagedQuestionCategoriesAllowed(agent: McpAgentAuth, payload: X402QuestionPayload) {
  if (!agent.allowedCategoryIds) return;

  for (const question of payload.questions) {
    const categoryId = question.categoryId.toString();
    if (!agent.allowedCategoryIds.has(categoryId)) {
      throw new McpToolError(`This MCP agent is not allowed to ask in category ${categoryId}.`, 403);
    }
  }
}

function toManagedMcpPayload(agent: McpAgentAuth, payload: X402QuestionPayload): X402QuestionPayload {
  return {
    ...payload,
    clientRequestId: buildManagedMcpClientRequestId(agent, payload.clientRequestId),
  };
}

async function lookupQuestionOperation(args: JsonObject, agent: McpAgentAuth) {
  const operationKey = await resolveManagedOperationKey(args, agent);
  if (!operationKey) return null;
  return getX402QuestionSubmissionByOperationKey(operationKey);
}

function hasOperationLookupArgs(args: JsonObject) {
  if (typeof args.operationKey === "string" && args.operationKey.trim().length > 0) return true;
  const hasChainId = args.chainId !== undefined && args.chainId !== null && String(args.chainId).trim().length > 0;
  const hasClientRequestId = typeof args.clientRequestId === "string" && args.clientRequestId.trim().length > 0;
  return hasChainId || hasClientRequestId;
}

async function resolveManagedOperationKey(args: JsonObject, agent: McpAgentAuth): Promise<`0x${string}` | null> {
  const operationKey = typeof args.operationKey === "string" ? args.operationKey.trim() : "";
  if (operationKey) {
    if (!/^0x[a-fA-F0-9]{64}$/.test(operationKey)) {
      throw new McpToolError("operationKey must be a 32-byte hex string.");
    }
    const reservation = await getMcpBudgetReservation(operationKey as `0x${string}`);
    if (reservation && reservation.agentId !== agent.id) {
      throw new McpToolError("Operation was not submitted by this MCP agent.", 404);
    }
    return operationKey as `0x${string}`;
  }

  const chainId = Number.parseInt(String(args.chainId ?? ""), 10);
  const clientRequestId = typeof args.clientRequestId === "string" ? args.clientRequestId.trim() : "";
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || !clientRequestId) {
    throw new McpToolError("Provide operationKey or both chainId and clientRequestId.");
  }

  const reservation = await getMcpBudgetReservationByClientRequest({
    agentId: agent.id,
    chainId,
    clientRequestId,
  });
  return reservation?.operationKey ?? null;
}

async function resolvePublicOperationKey(args: JsonObject): Promise<`0x${string}` | null> {
  const operationKey = typeof args.operationKey === "string" ? args.operationKey.trim() : "";
  if (operationKey) {
    if (!/^0x[a-fA-F0-9]{64}$/.test(operationKey)) {
      throw new McpToolError("operationKey must be a 32-byte hex string.");
    }
    return operationKey as `0x${string}`;
  }

  const chainId = Number.parseInt(String(args.chainId ?? ""), 10);
  const clientRequestId = typeof args.clientRequestId === "string" ? args.clientRequestId.trim() : "";
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || !clientRequestId) {
    throw new McpToolError("Provide operationKey or chainId, clientRequestId, and walletAddress.");
  }
  const walletAddress = parsePublicWalletAddress(args);
  const publicClientRequestId = buildPermissionlessWalletClientRequestId({
    chainId,
    clientRequestId,
    walletAddress,
  });
  const record = await getX402QuestionSubmissionByClientRequest({
    chainId,
    clientRequestId: publicClientRequestId,
  });
  return record?.operationKey ?? null;
}

async function lookupPublicQuestionOperation(args: JsonObject) {
  const operationKey = await resolvePublicOperationKey(args);
  if (!operationKey) return null;
  return getX402QuestionSubmissionByOperationKey(operationKey);
}

async function loadCallbackDeliveryStatus(operationKey: `0x${string}`, agentId: string) {
  return normalizeCallbackDeliveries(
    await listAgentCallbackEventsByEventIdPrefix({
      agentId,
      eventIdPrefix: `${operationKey}:`,
    }),
  );
}

function formatQuoteResult(
  params: Awaited<ReturnType<typeof preflightX402QuestionSubmission>>,
  payload: X402QuestionPayload,
  config: ReturnType<typeof resolveX402QuestionConfig>,
  options: { feedbackBonus?: X402FeedbackBonusRequest | null; walletPolicyRequired?: boolean } = {},
) {
  const feedbackBonus = options.feedbackBonus ?? null;
  const totalAmount = params.paymentAmount + feedbackBonusAmount(feedbackBonus);
  return {
    canSubmit: true,
    fastLane: buildAgentFastLaneGuidance({
      bounty: payload.bounty,
      questionCount: payload.questions.length,
      roundConfig: payload.roundConfig,
    }),
    feedbackBonus: buildPendingFeedbackBonusBody(feedbackBonus),
    feedbackBonusGuidance: buildFeedbackBonusGuidance(feedbackBonus, payload),
    legalNotice: buildAgentLegalNotice(),
    operationKey: params.operation.operationKey,
    payment: {
      amount: totalAmount.toString(),
      asset: "USDC",
      bountyAmount: payload.bounty.amount.toString(),
      decimals: X402_USDC_DECIMALS,
      feedbackBonusAmount: feedbackBonusAmount(feedbackBonus).toString(),
      spender: config.questionRewardPoolEscrowAddress,
      tokenAddress: config.usdcAddress,
      totalAmount: totalAmount.toString(),
    },
    payloadHash: params.operation.payloadHash,
    questionCount: params.resolvedCategoryIds.length,
    resolvedCategoryIds: params.resolvedCategoryIds.map(categoryId => categoryId.toString()),
    walletPolicyRequired: options.walletPolicyRequired ?? true,
  };
}

async function quoteQuestion(args: JsonObject, agent: McpAgentAuth) {
  const dependencies = getMcpToolDependencies();
  const payload = parseX402QuestionRequest(questionPayloadArgs(args));
  assertManagedQuestionCategoriesAllowed(agent, payload);
  const walletAddress = parseAgentWalletAddress(args, agent);
  const feedbackBonus = parseOptionalFeedbackBonus(args, payload, walletAddress);
  const managedPayload = toManagedMcpPayload(agent, payload);
  const config = dependencies.resolveX402QuestionConfig(managedPayload.chainId);
  if (feedbackBonus && !config.feedbackBonusEscrowAddress) {
    throw new McpToolError("Feedback Bonus escrow is not deployed for the requested chain.", 503);
  }
  const quote = await dependencies.preflightX402QuestionSubmission({
    agentId: agent.id,
    config,
    ownerWalletAddress: walletAddress,
    payload: managedPayload,
  });
  return {
    ...formatQuoteResult(quote, payload, config, { feedbackBonus }),
    clientRequestId: payload.clientRequestId,
  };
}

async function quotePublicQuestion(args: JsonObject) {
  const dependencies = getMcpToolDependencies();
  const payload = parseX402QuestionRequest(questionPayloadArgs(args));
  const walletAddress = parsePublicWalletAddress(args);
  const feedbackBonus = parseOptionalFeedbackBonus(args, payload, walletAddress);
  const permissionlessPayload = toPermissionlessWalletPayload(payload, walletAddress);
  const config = dependencies.resolveX402QuestionConfig(permissionlessPayload.chainId);
  if (feedbackBonus && !config.feedbackBonusEscrowAddress) {
    throw new McpToolError("Feedback Bonus escrow is not deployed for the requested chain.", 503);
  }
  const quote = await dependencies.preflightX402QuestionSubmission({
    config,
    ownerWalletAddress: walletAddress,
    payload: permissionlessPayload,
  });
  return {
    ...formatQuoteResult(quote, payload, config, { feedbackBonus, walletPolicyRequired: false }),
    clientRequestId: payload.clientRequestId,
    wallet: {
      address: walletAddress,
      fundingMode: "permissionless_wallet",
      note: "The wallet signer controls whether to execute the returned plan; RateLoop does not enforce a managed policy.",
    },
  };
}

function latestRoundFromContentResponse(response: Awaited<ReturnType<typeof ponderApi.getContentById>>) {
  const rounds = Array.isArray(response.rounds) ? response.rounds : [];
  return rounds[0] ?? null;
}

function normalizeHexId(value: string | null | undefined) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function isRaterEligibleForBounty(
  mode: number | null | undefined,
  status: PonderRaterParticipationStatusResponse | undefined,
) {
  if (mode === 0) return true;
  if (!status) return false;

  const verifiedHuman = status.humanCredential.verified;
  if (mode === 1) return verifiedHuman;
  return false;
}

function defaultAgentResultTemplate() {
  return (
    findAgentResultTemplate("generic_rating") ?? {
      id: "generic_rating",
      ratingSystem: "rateloop.robust_bts_binary.v1",
      version: 1,
    }
  );
}

function emptyResultDistribution() {
  return {
    conservativeRatingBps: null,
    down: { count: 0, share: null, stake: "0" },
    rating: null,
    ratingBps: null,
    revealedCount: 0,
    state: null,
    stateLabel: null,
    up: { count: 0, share: null, stake: "0" },
  };
}

function buildPendingQuestionResultPackage(params: { failed: boolean; operation: JsonObject | null; status: string }) {
  const template = defaultAgentResultTemplate();
  const distribution = emptyResultDistribution();
  return {
    answer: params.failed ? "failed" : "pending",
    answerScopes: {
      allAnswers: {
        distribution,
        label: "All answers",
        note: "Every revealed answer contributes to the open public result.",
      },
      bountyEligibleAnswers: {
        distribution,
        label: "Bounty-eligible answers",
        note: "No scoped bounty result is available until the question is submitted on-chain.",
        policy: {
          eligibilityDataHash: null,
          label: "Everyone",
          mode: 0,
        },
        qualifiedRoundCount: 0,
        rewardPoolCount: 0,
      },
    },
    cohortSummary: null,
    confidence: {
      level: "none",
      score: 0,
    },
    distribution,
    dissentingView: null,
    featureTest: null,
    feedbackQuality: {
      actionability: "none",
      objectionCount: 0,
      publicNoteCount: 0,
      sourceUrlCount: 0,
    },
    liveAskGuidance: null,
    limitations: ["The question has not reached a public RateLoop result page yet."],
    majorObjections: [],
    methodology: {
      ratingSystem: template.ratingSystem,
      sources: ["rateloop.agent_question_submission"],
      templateId: template.id,
      templateVersion: template.version,
    },
    operation: params.operation,
    pollAfterMs: params.failed ? null : 5_000,
    protocolState: {
      latestRound: null,
      status: params.status || "not_found",
    },
    publicUrl: null,
    ready: false,
    result: null,
    wait: {
      code: params.failed ? "failed_submission" : "still_settling",
      recoverWith: params.failed ? "inspect_status_error" : "rateloop_get_question_status",
    },
    recommendedNextAction: params.failed ? "manual_review" : "wait_for_settlement",
    rationaleSummary: params.failed
      ? "The submission failed before a public RateLoop result was available."
      : "The human result is not ready yet.",
    sourceUrls: [],
    stakeMass: {
      down: "0",
      total: "0",
      unit: "raw_staked_voting_power",
      up: "0",
    },
    voteCount: 0,
  };
}

async function loadBountyEligibleVotes(params: {
  content: PonderContentItem;
  dependencies: McpToolDependencies;
  latestRound: ReturnType<typeof latestRoundFromContentResponse>;
}): Promise<PonderVoteItem[] | null> {
  const { mode } = resolveAgentBountyEligibilityScope(params.content);
  if (mode === null || mode === 0 || !params.latestRound?.roundId) return null;

  let votes: PonderVoteItem[];
  try {
    votes = await params.dependencies.getAllVotes({
      contentId: params.content.id,
      roundId: String(params.latestRound.roundId),
    });
  } catch {
    return null;
  }
  const revealedVotes = votes.filter(vote => vote.revealed && vote.isUp !== null);
  const raterAddresses = [
    ...new Set(revealedVotes.map(vote => normalizeHexId(vote.identityVoter ?? vote.voter))),
  ].filter(Boolean);
  const statuses = new Map<string, PonderRaterParticipationStatusResponse>();
  await Promise.all(
    raterAddresses.map(async address => {
      try {
        statuses.set(address, await params.dependencies.getRaterParticipationStatus(address));
      } catch {
        // Missing status data should not make an agent result fail; it simply makes the eligible-only view conservative.
      }
    }),
  );

  return revealedVotes.filter(vote =>
    isRaterEligibleForBounty(mode, statuses.get(normalizeHexId(vote.identityVoter ?? vote.voter))),
  );
}

async function buildQuestionResultForRecord(
  args: JsonObject,
  record: Awaited<ReturnType<typeof getX402QuestionSubmissionByOperationKey>> | null,
) {
  const dependencies = getMcpToolDependencies();
  const directContentId = typeof args.contentId === "string" ? args.contentId.trim() : "";
  const operation = normalizeMcpQuestionBody(x402QuestionSubmissionRecordBody(record));
  const operationContentIds =
    operation && typeof operation === "object" && Array.isArray((operation as JsonObject).contentIds)
      ? ((operation as JsonObject).contentIds as unknown[]).filter(
          (contentId): contentId is string => typeof contentId === "string" && contentId.length > 0,
        )
      : [];
  if (directContentId && operationContentIds.length > 0 && !operationContentIds.includes(directContentId)) {
    throw new McpToolError("contentId does not belong to this ask.", 404);
  }
  if (!directContentId && operationContentIds.length > 1) {
    throw new McpToolError("This ask produced multiple contentIds. Provide contentId to fetch a specific result.", 409);
  }
  const contentId =
    directContentId ||
    (operation && typeof operation === "object" && typeof (operation as JsonObject).contentId === "string"
      ? ((operation as JsonObject).contentId as string)
      : null);

  if (!contentId) {
    const status = operation && typeof operation === "object" ? String((operation as JsonObject).status ?? "") : "";
    const failed = status === "failed";
    return buildPendingQuestionResultPackage({
      failed,
      operation: operation && typeof operation === "object" ? (operation as JsonObject) : null,
      status,
    });
  }

  const response = await dependencies.getContentById(contentId);
  const latestRound = latestRoundFromContentResponse(response);
  const feedbackContext = buildContentFeedbackRoundContext(
    Array.isArray(response.rounds) ? response.rounds : [],
    response.content.openRound?.roundId ?? null,
  );
  const feedback = await listContentFeedback({ contentId, context: feedbackContext });
  const bountyEligibleVotes = await loadBountyEligibleVotes({
    content: response.content,
    dependencies,
    latestRound,
  });
  const resultPackage = buildAgentResultPackage({
    audienceContext: response.audienceContext,
    bountyEligibleVotes,
    content: response.content,
    feedback: feedback.items,
    latestRound,
    publicUrl: getAgentPublicQuestionUrl(contentId),
  });

  return {
    operation: record ? normalizeMcpQuestionBody(x402QuestionSubmissionRecordBody(record)) : null,
    ...resultPackage,
  };
}

async function buildQuestionResult(args: JsonObject, agent: McpAgentAuth) {
  return buildQuestionResultForRecord(
    args,
    hasOperationLookupArgs(args) ? await lookupQuestionOperation(args, agent) : null,
  );
}

async function buildPublicQuestionResult(args: JsonObject) {
  return buildQuestionResultForRecord(
    args,
    hasOperationLookupArgs(args) ? await lookupPublicQuestionOperation(args) : null,
  );
}

export async function callPublicRateLoopMcpTool(params: { arguments: unknown; name: string }): Promise<unknown> {
  if (!PUBLIC_MCP_TOOL_NAMES.has(params.name)) {
    throw new McpToolError(`Tool requires managed MCP authentication: ${params.name}`, 401);
  }

  const dependencies = getMcpToolDependencies();
  const args = asObject(params.arguments ?? {});

  switch (params.name) {
    case "rateloop_list_categories":
      return ponderApi.getCategories();

    case "rateloop_list_result_templates":
      return { templates: listAgentResultTemplates() };

    case "rateloop_quote_question":
      return quotePublicQuestion(args);

    case "rateloop_ask_humans": {
      parseAskHumansMode(args.mode);
      assertNoPublicWebhook(args);
      const paymentMode = parseAskHumansPaymentMode(args.paymentMode ?? args.fundingMode);
      const payload = parseX402QuestionRequest(questionPayloadArgs(args));
      const walletAddress = parsePublicWalletAddress(args);
      const feedbackBonus = parseOptionalFeedbackBonus(args, payload, walletAddress);
      const permissionlessPayload = toPermissionlessWalletPayload(payload, walletAddress);
      const config = dependencies.resolveX402QuestionConfig(permissionlessPayload.chainId);
      if (feedbackBonus && !config.feedbackBonusEscrowAddress) {
        throw new McpToolError("Feedback Bonus escrow is not deployed for the requested chain.", 503);
      }
      const quote = await dependencies.preflightX402QuestionSubmission({
        config,
        ownerWalletAddress: walletAddress,
        payload: permissionlessPayload,
      });
      const totalPaymentAmount = quote.paymentAmount + feedbackBonusAmount(feedbackBonus);
      const maxPaymentAmount = parseMaxPaymentAmount(args.maxPaymentAmount);
      if (totalPaymentAmount > maxPaymentAmount) {
        throw new McpToolError("Quoted payment exceeds maxPaymentAmount.");
      }

      const result =
        paymentMode === "x402_authorization"
          ? await dependencies.preparePermissionlessNativeX402QuestionSubmissionRequest({
              feedbackBonus,
              paymentAuthorization:
                typeof args.paymentAuthorization === "object" && args.paymentAuthorization
                  ? (args.paymentAuthorization as Record<string, unknown>)
                  : null,
              payload,
              walletAddress,
            })
          : await dependencies.preparePermissionlessWalletQuestionSubmissionRequest({
              feedbackBonus,
              payload,
              walletAddress,
            });
      const body = applyFeedbackBonusPaymentFields(normalizeMcpQuestionBody(result.body) as JsonObject, feedbackBonus);
      const warnings: string[] = [];
      try {
        await attachImagesToOperation({
          imageUrls: getQuestionImageUrls(payload),
          operationKey: quote.operation.operationKey,
          clientRequestId: payload.clientRequestId,
          ownerWalletAddress: walletAddress,
        });
      } catch (error) {
        console.error("[mcp-public] image attachment association failed", error);
        warnings.push("image_attachment_association_failed");
      }

      return {
        ...body,
        clientRequestId: payload.clientRequestId,
        confirmTool: "rateloop_confirm_ask_transactions",
        fastLane: buildAgentFastLaneGuidance({
          bounty: payload.bounty,
          questionCount: payload.questions.length,
          roundConfig: payload.roundConfig,
        }),
        feedbackBonus: buildPendingFeedbackBonusBody(feedbackBonus),
        feedbackBonusGuidance: buildFeedbackBonusGuidance(feedbackBonus, payload),
        legalNotice: buildAgentLegalNotice(),
        managedBudget: null,
        pollAfterMs: 5_000,
        publicUrl: null,
        statusTool: "rateloop_get_question_status",
        walletPolicyRequired: false,
        webhook: null,
        warnings,
      };
    }

    case "rateloop_confirm_ask_transactions": {
      const operationKey = await resolvePublicOperationKey(args);
      if (!operationKey) {
        throw new McpToolError("Provide operationKey for the ask to confirm.");
      }
      const rawHashes = Array.isArray(args.transactionHashes) ? args.transactionHashes : [];
      const transactionHashes = rawHashes.filter((hash): hash is Hex => typeof hash === "string") as Hex[];
      const result = await dependencies.confirmAgentWalletQuestionSubmissionRequest({
        operationKey,
        transactionHashes,
      });
      let body = normalizeMcpQuestionBody(result.body) as JsonObject;
      const warnings: string[] = [];
      body = await attachFeedbackBonusPlan(body, dependencies, warnings);
      return {
        ...body,
        publicUrl: getAgentPublicQuestionUrl(typeof body.contentId === "string" ? body.contentId : null),
        warnings,
        ...agentStatusHints(body),
      };
    }

    case "rateloop_confirm_feedback_bonus_transactions": {
      const operationKey = await resolvePublicOperationKey(args);
      if (!operationKey) {
        throw new McpToolError("Provide operationKey for the Feedback Bonus to confirm.");
      }
      const rawHashes = Array.isArray(args.transactionHashes) ? args.transactionHashes : [];
      const transactionHashes = rawHashes.filter((hash): hash is Hex => typeof hash === "string") as Hex[];
      const result = await dependencies.confirmFeedbackBonusQuestionSubmissionRequest({
        operationKey,
        transactionHashes,
      });
      const body = normalizeMcpQuestionBody(result.body) as JsonObject;
      return {
        ...body,
        warnings: [],
      };
    }

    case "rateloop_get_question_status": {
      const operationKey = await resolvePublicOperationKey(args);
      const record = operationKey ? await getX402QuestionSubmissionByOperationKey(operationKey) : null;
      let liveAskGuidance: ReturnType<typeof buildAgentLiveAskGuidance> = null;
      let latestRoundState: number | null = null;
      if (record?.contentId) {
        try {
          const contentResponse = await dependencies.getContentById(record.contentId);
          const rawLatestRoundState = latestRoundFromContentResponse(contentResponse)?.state;
          latestRoundState =
            typeof rawLatestRoundState === "number" && Number.isFinite(rawLatestRoundState)
              ? rawLatestRoundState
              : null;
          liveAskGuidance = buildAgentLiveAskGuidance({ content: contentResponse.content });
        } catch (error) {
          console.error("[mcp-public] live ask guidance unavailable", error);
        }
      }
      const body = {
        ...(normalizeMcpQuestionBody(x402QuestionSubmissionRecordBody(record)) as JsonObject),
        callbackDeliveries: [],
        liveAskGuidance,
        publicUrl: getAgentPublicQuestionUrl(record?.contentId ?? null),
      };
      return {
        ...body,
        ...agentStatusHints(body, latestRoundState),
      };
    }

    case "rateloop_get_result":
      return buildPublicQuestionResult(args);

    default:
      throw new McpToolError(`Unknown tool: ${params.name}`, 404);
  }
}

export async function callRateLoopMcpTool(params: {
  agent: McpAgentAuth;
  arguments: unknown;
  name: string;
  scheduleBackgroundTask?: BackgroundTaskScheduler;
}) {
  const dependencies = getMcpToolDependencies();
  const args = asObject(params.arguments ?? {});

  switch (params.name) {
    case "rateloop_list_categories":
      return ponderApi.getCategories();

    case "rateloop_list_result_templates":
      return { templates: listAgentResultTemplates() };

    case "rateloop_quote_question":
      return quoteQuestion(args, params.agent);

    case "rateloop_ask_humans": {
      parseAskHumansMode(args.mode);
      const paymentMode = parseAskHumansPaymentMode(args.paymentMode ?? args.fundingMode);
      const payload = parseX402QuestionRequest(questionPayloadArgs(args));
      assertManagedQuestionCategoriesAllowed(params.agent, payload);
      const webhook = await parseWebhookOptions(args);
      const walletAddress = parseAgentWalletAddress(args, params.agent);
      const feedbackBonus = parseOptionalFeedbackBonus(args, payload, walletAddress);
      const managedPayload = toManagedMcpPayload(params.agent, payload);
      const config = dependencies.resolveX402QuestionConfig(managedPayload.chainId);
      if (feedbackBonus && !config.feedbackBonusEscrowAddress) {
        throw new McpToolError("Feedback Bonus escrow is not deployed for the requested chain.", 503);
      }
      const quote = await dependencies.preflightX402QuestionSubmission({
        agentId: params.agent.id,
        config,
        ownerWalletAddress: walletAddress,
        payload: managedPayload,
      });
      const fastLane = buildAgentFastLaneGuidance({
        bounty: payload.bounty,
        questionCount: payload.questions.length,
        roundConfig: payload.roundConfig,
      });
      const totalPaymentAmount = quote.paymentAmount + feedbackBonusAmount(feedbackBonus);
      const maxPaymentAmount = parseMaxPaymentAmount(args.maxPaymentAmount);
      if (totalPaymentAmount > maxPaymentAmount) {
        throw new McpToolError("Quoted payment exceeds maxPaymentAmount.");
      }

      await dependencies.reserveMcpAgentBudget({
        agent: params.agent,
        amount: totalPaymentAmount,
        categoryId: payload.questions[0]?.categoryId.toString() ?? "0",
        chainId: payload.chainId,
        clientRequestId: payload.clientRequestId,
        operationKey: quote.operation.operationKey,
        payloadHash: quote.operation.payloadHash,
      });

      const callbackWarnings: string[] = [];
      if (webhook) {
        await dependencies.upsertAgentCallbackSubscription({
          agentId: params.agent.id,
          callbackUrl: webhook.url,
          eventTypes: webhook.events,
          secret: webhook.secret,
        });
      }

      const enqueueCallbackEvent = async (eventType: AgentCallbackEventType, body: JsonObject) => {
        if (!webhook) return;
        try {
          await dependencies.enqueueAgentCallbackEvent({
            agentId: params.agent.id,
            eventId: callbackEventId(quote.operation.operationKey, eventType),
            eventType,
            payload: buildAgentCallbackPayload({
              body,
              chainId: payload.chainId,
              clientRequestId: payload.clientRequestId,
              eventType,
              operationKey: quote.operation.operationKey,
            }),
          });
        } catch (error) {
          console.error("[mcp] callback enqueue failed", error);
          callbackWarnings.push(`callback_enqueue_failed:${eventType}`);
        }
      };

      const webhookInfo = webhook
        ? {
            delivery: "signed_hmac_sha256",
            events: webhook.events,
            registered: true,
            signatureHeaders: [
              "x-rateloop-callback-id",
              "x-rateloop-callback-timestamp",
              "x-rateloop-callback-signature",
            ],
          }
        : null;

      let result:
        | Awaited<ReturnType<typeof prepareAgentWalletQuestionSubmissionRequest>>
        | Awaited<ReturnType<typeof prepareNativeX402QuestionSubmissionRequest>>;
      try {
        result =
          paymentMode === "x402_authorization"
            ? await dependencies.prepareNativeX402QuestionSubmissionRequest({
                agentId: params.agent.id,
                feedbackBonus,
                paymentAuthorization:
                  typeof args.paymentAuthorization === "object" && args.paymentAuthorization
                    ? (args.paymentAuthorization as Record<string, unknown>)
                    : null,
                payload: managedPayload,
                walletAddress,
              })
            : await dependencies.prepareAgentWalletQuestionSubmissionRequest({
                agentId: params.agent.id,
                feedbackBonus,
                payload: managedPayload,
                walletAddress,
              });
      } catch (error) {
        await dependencies.updateMcpBudgetReservation({
          error: error instanceof Error ? error.message : String(error),
          operationKey: quote.operation.operationKey,
          status: "failed",
        });
        await enqueueCallbackEvent("question.failed", {
          error: error instanceof Error ? error.message : String(error),
          status: "failed",
        });
        throw error;
      }

      const body = applyFeedbackBonusPaymentFields(result.body as JsonObject, feedbackBonus);
      const warnings: string[] = [];
      try {
        await attachImagesToOperation({
          imageUrls: getQuestionImageUrls(payload),
          operationKey: quote.operation.operationKey,
          clientRequestId: payload.clientRequestId,
          agentId: params.agent.id,
          ownerWalletAddress: walletAddress,
        });
      } catch (error) {
        console.error("[mcp] image attachment association failed", error);
        warnings.push("image_attachment_association_failed");
      }
      await enqueueCallbackEvent("question.submitting", body);

      let managedBudget: Awaited<ReturnType<typeof getMcpAgentBudgetSummary>> | null = null;
      try {
        managedBudget = await dependencies.getMcpAgentBudgetSummary(params.agent);
      } catch (error) {
        console.error("[mcp] budget summary unavailable after wallet plan", error);
        warnings.push("managed_budget_unavailable");
      }

      return {
        ...(normalizeMcpQuestionBody(body) as JsonObject),
        clientRequestId: payload.clientRequestId,
        confirmTool: "rateloop_confirm_ask_transactions",
        fastLane,
        feedbackBonus: buildPendingFeedbackBonusBody(feedbackBonus),
        feedbackBonusGuidance: buildFeedbackBonusGuidance(feedbackBonus, payload),
        legalNotice: buildAgentLegalNotice(),
        managedBudget,
        pollAfterMs: 5_000,
        publicUrl: null,
        statusTool: "rateloop_get_question_status",
        webhook: webhookInfo,
        warnings: [...warnings, ...callbackWarnings],
      };
    }

    case "rateloop_confirm_ask_transactions": {
      const operationKey = await resolveManagedOperationKey(args, params.agent);
      if (!operationKey) {
        throw new McpToolError("Provide operationKey for the ask to confirm.");
      }
      const rawHashes = Array.isArray(args.transactionHashes) ? args.transactionHashes : [];
      const transactionHashes = rawHashes.filter((hash): hash is Hex => typeof hash === "string") as Hex[];
      const result = await dependencies.confirmAgentWalletQuestionSubmissionRequest({
        operationKey,
        transactionHashes,
      });
      let body = normalizeMcpQuestionBody(result.body) as JsonObject;
      const warnings: string[] = [];
      body = await attachFeedbackBonusPlan(body, dependencies, warnings);
      try {
        await dependencies.updateMcpBudgetReservation({
          contentId: typeof body.contentId === "string" ? body.contentId : null,
          operationKey,
          status: "submitted",
        });
      } catch (error) {
        console.error("[mcp] confirmed ask bookkeeping update failed", error);
        warnings.push("submitted_budget_update_failed");
      }
      try {
        await dependencies.enqueueAgentCallbackEvent({
          agentId: params.agent.id,
          eventId: callbackEventId(operationKey, "question.submitted"),
          eventType: "question.submitted",
          payload: buildAgentCallbackPayload({
            body,
            chainId: typeof body.chainId === "number" ? body.chainId : 0,
            clientRequestId: typeof body.clientRequestId === "string" ? body.clientRequestId : "",
            eventType: "question.submitted",
            operationKey,
          }),
        });
      } catch (error) {
        console.error("[mcp] callback enqueue failed", error);
        warnings.push("callback_enqueue_failed:question.submitted");
      }

      return {
        ...body,
        publicUrl: getAgentPublicQuestionUrl(typeof body.contentId === "string" ? body.contentId : null),
        warnings,
        ...agentStatusHints(body),
      };
    }

    case "rateloop_confirm_feedback_bonus_transactions": {
      const operationKey = await resolveManagedOperationKey(args, params.agent);
      if (!operationKey) {
        throw new McpToolError("Provide operationKey for the Feedback Bonus to confirm.");
      }
      const rawHashes = Array.isArray(args.transactionHashes) ? args.transactionHashes : [];
      const transactionHashes = rawHashes.filter((hash): hash is Hex => typeof hash === "string") as Hex[];
      const result = await dependencies.confirmFeedbackBonusQuestionSubmissionRequest({
        operationKey,
        transactionHashes,
      });
      const body = normalizeMcpQuestionBody(result.body) as JsonObject;
      return {
        ...body,
        warnings: [],
      };
    }

    case "rateloop_get_question_status": {
      const operationKey = await resolveManagedOperationKey(args, params.agent);
      const record = await lookupQuestionOperation(args, params.agent);
      let liveAskGuidance: ReturnType<typeof buildAgentLiveAskGuidance> = null;
      let latestRoundState: number | null = null;
      if (record?.contentId) {
        try {
          const contentResponse = await dependencies.getContentById(record.contentId);
          const rawLatestRoundState = latestRoundFromContentResponse(contentResponse)?.state;
          latestRoundState =
            typeof rawLatestRoundState === "number" && Number.isFinite(rawLatestRoundState)
              ? rawLatestRoundState
              : null;
          liveAskGuidance = buildAgentLiveAskGuidance({ content: contentResponse.content });
        } catch (error) {
          console.error("[mcp] live ask guidance unavailable", error);
        }
      }
      const body = {
        ...(normalizeMcpQuestionBody(x402QuestionSubmissionRecordBody(record)) as JsonObject),
        callbackDeliveries: operationKey ? await loadCallbackDeliveryStatus(operationKey, params.agent.id) : [],
        liveAskGuidance,
        publicUrl: getAgentPublicQuestionUrl(record?.contentId ?? null),
      };
      return {
        ...body,
        ...agentStatusHints(body, latestRoundState),
      };
    }

    case "rateloop_get_result":
      return buildQuestionResult(args, params.agent);

    case "rateloop_get_agent_balance":
      return getMcpAgentBudgetSummary(params.agent);

    default:
      throw new McpToolError(`Unknown tool: ${params.name}`, 404);
  }
}

export function getMcpToolDefinition(name: string) {
  return MCP_TOOLS.find(tool => tool.name === name) ?? null;
}

export function getMcpToolRequiredScope(name: string): McpScope | null {
  return getMcpToolDefinition(name)?.requiredScope ?? null;
}

type AgentToolErrorCode =
  | "category_disallowed"
  | "duplicate_ask"
  | "failed_submission"
  | "insufficient_budget"
  | "invalid_arguments"
  | "invalid_media"
  | "max_payment_exceeded"
  | "service_unavailable"
  | "unsupported_template"
  | "wallet_address_required";

function classifyToolError(error: unknown): {
  code: AgentToolErrorCode;
  recoverWith: string;
  retryable: boolean;
} {
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (error instanceof X402QuestionInputError) {
    if (message.includes("imageurls") || message.includes("videourl") || message.includes("media")) {
      return { code: "invalid_media", recoverWith: "fix_media_urls", retryable: false };
    }
    if (message.includes("template")) {
      return { code: "unsupported_template", recoverWith: "call_rateloop_list_result_templates", retryable: false };
    }
    return { code: "invalid_arguments", recoverWith: "fix_tool_arguments", retryable: false };
  }

  if (error instanceof McpBudgetError) {
    if (message.includes("category")) {
      return { code: "category_disallowed", recoverWith: "choose_allowed_category_or_update_agent", retryable: false };
    }
    if (message.includes("different question payload") || message.includes("operation key")) {
      return {
        code: "duplicate_ask",
        recoverWith: "reuse_original_request_or_change_clientRequestId",
        retryable: false,
      };
    }
    if (message.includes("budget") || message.includes("remaining daily") || message.includes("per-ask")) {
      return { code: "insufficient_budget", recoverWith: "reduce_bounty_or_raise_agent_budget", retryable: false };
    }
    return { code: "failed_submission", recoverWith: "inspect_budget_reservation", retryable: false };
  }

  if (error instanceof McpToolError && message.includes("not allowed to ask in category")) {
    return { code: "category_disallowed", recoverWith: "choose_allowed_category_or_update_agent", retryable: false };
  }

  if (error instanceof X402QuestionConflictError) {
    return { code: "duplicate_ask", recoverWith: "reuse_original_request_or_change_clientRequestId", retryable: false };
  }

  if (error instanceof X402QuestionConfigError) {
    return {
      code: "service_unavailable",
      recoverWith: "check_server_chain_and_payment_configuration",
      retryable: true,
    };
  }

  if (error instanceof McpToolError) {
    if (message.includes("walletaddress")) {
      return { code: "wallet_address_required", recoverWith: "include_walletAddress", retryable: false };
    }
    if (message.includes("quoted payment exceeds") || message.includes("maxpaymentamount")) {
      return { code: "max_payment_exceeded", recoverWith: "increase_maxPaymentAmount_or_requote", retryable: false };
    }
    return { code: "invalid_arguments", recoverWith: "fix_tool_arguments", retryable: false };
  }

  return { code: "failed_submission", recoverWith: "retry_or_contact_operator", retryable: true };
}

export function normalizeToolError(error: unknown) {
  if (
    error instanceof McpToolError ||
    error instanceof McpBudgetError ||
    error instanceof X402QuestionConfigError ||
    error instanceof X402QuestionConflictError ||
    error instanceof X402QuestionInputError
  ) {
    const classified = classifyToolError(error);
    return {
      code: classified.code,
      originalCode: error.name,
      message: error.message,
      recoverWith: classified.recoverWith,
      retryable: classified.retryable,
      status: "status" in error && typeof error.status === "number" ? error.status : 400,
    };
  }

  const classified = classifyToolError(error);
  return {
    code: classified.code,
    message: error instanceof Error ? error.message : "Unknown MCP tool error",
    recoverWith: classified.recoverWith,
    retryable: classified.retryable,
    status: 500,
  };
}
