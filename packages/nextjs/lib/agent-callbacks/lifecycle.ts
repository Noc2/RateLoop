import { enqueueAgentCallbackEvent } from "./events";
import { buildAgentCallbackPayload, callbackEventId } from "./payload";
import { publicWebhookAgentId } from "./publicWebhooks";
import type { AgentCallbackEventType } from "./types";
import { ROUND_STATE } from "@rateloop/contracts/protocol";
import { buildAgentLiveAskGuidance } from "~~/lib/agent/liveAskGuidance";
import { dbClient } from "~~/lib/db";
import { buildContentFeedbackRoundContext, listContentFeedback } from "~~/lib/feedback/contentFeedback";
import { resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";
import { PonderHttpError, ponderApi } from "~~/services/ponder/client";

type ManagedLifecycleCandidate = {
  agentId: string;
  chainId: number;
  clientRequestId: string;
  contentId: string;
  operationKey: `0x${string}`;
  sortAt: Date;
};

type ManagedLifecycleCursor = Pick<ManagedLifecycleCandidate, "operationKey" | "sortAt">;

const PRODUCTION_AGENT_LIFECYCLE_TARGET_CHAIN_IDS = new Set([8453, 84532]);

type AgentLifecycleDependencies = {
  enqueueAgentCallbackEvent: typeof enqueueAgentCallbackEvent;
  getContentById: typeof ponderApi.getContentById;
  listCandidates: (params: {
    after?: ManagedLifecycleCursor | null;
    limit: number;
    targetChainIds?: ReadonlySet<number> | null;
  }) => Promise<ManagedLifecycleCandidate[]>;
  listContentFeedback: typeof listContentFeedback;
};

let lifecycleTestOverrides: Partial<AgentLifecycleDependencies> | null = null;
let targetChainIdsTestOverride: Set<number> | null | undefined;

function getLifecycleDependencies(): AgentLifecycleDependencies {
  return {
    enqueueAgentCallbackEvent: lifecycleTestOverrides?.enqueueAgentCallbackEvent ?? enqueueAgentCallbackEvent,
    getContentById: lifecycleTestOverrides?.getContentById ?? ponderApi.getContentById,
    listCandidates: lifecycleTestOverrides?.listCandidates ?? listManagedLifecycleCandidates,
    listContentFeedback: lifecycleTestOverrides?.listContentFeedback ?? listContentFeedback,
  };
}

export function __setAgentLifecycleTestOverridesForTests(overrides: Partial<AgentLifecycleDependencies> | null) {
  lifecycleTestOverrides = overrides;
}

export function __setAgentLifecycleTargetChainIdsForTests(chainIds: readonly number[] | null | undefined) {
  targetChainIdsTestOverride =
    chainIds === undefined ? undefined : chainIds === null ? null : new Set(chainIds.filter(Number.isSafeInteger));
}

function toOptionalUnixSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === "bigint") return Number(value >= 0n ? value : 0n);
  if (typeof value === "string" && /^\d+$/.test(value)) return Number.parseInt(value, 10);
  return null;
}

function latestRound(rounds: unknown[]) {
  return Array.isArray(rounds) ? ((rounds[0] as Record<string, unknown> | null | undefined) ?? null) : null;
}

function isTerminalRoundState(state: unknown) {
  return (
    state === ROUND_STATE.Settled ||
    state === ROUND_STATE.Cancelled ||
    state === ROUND_STATE.Tied ||
    state === ROUND_STATE.RevealFailed
  );
}

function configuredTargetChainIds() {
  if (targetChainIdsTestOverride !== undefined) return targetChainIdsTestOverride;
  if (process.env.NODE_ENV !== "production") return null;
  const raw = process.env.NEXT_PUBLIC_TARGET_NETWORKS?.trim();
  if (!raw) return new Set<number>();
  const exactIds = raw
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  if (exactIds.length === 0 || exactIds.some(value => !/^\d+$/.test(value))) {
    return new Set<number>();
  }
  const chainIds = exactIds.map(value => Number(value));
  if (
    chainIds.some(
      chainId =>
        !Number.isSafeInteger(chainId) || chainId <= 0 || !PRODUCTION_AGENT_LIFECYCLE_TARGET_CHAIN_IDS.has(chainId),
    )
  ) {
    return new Set<number>();
  }
  return new Set(chainIds);
}

function normalizeTargetChainIds(chainIds: ReadonlySet<number> | null | undefined) {
  if (!chainIds) return null;
  return Array.from(chainIds)
    .filter(chainId => Number.isSafeInteger(chainId) && chainId > 0)
    .sort((a, b) => a - b);
}

function lifecycleEventsForContent(params: {
  feedbackPublicCount: number;
  nowSeconds: number;
  response: Awaited<ReturnType<typeof ponderApi.getContentById>>;
}) {
  const events: AgentCallbackEventType[] = [];
  const openRound = params.response.content.openRound;
  const newestRound = latestRound(params.response.rounds);
  const newestRoundState = newestRound?.state ?? null;

  if (openRound) {
    events.push("question.open");

    const estimatedSettlementTime = toOptionalUnixSeconds(openRound.estimatedSettlementTime);
    if (estimatedSettlementTime !== null && estimatedSettlementTime <= params.nowSeconds) {
      events.push("question.settling");
    }
  }

  if (isTerminalRoundState(newestRoundState)) {
    events.push("question.settled");
    if (params.feedbackPublicCount > 0) {
      events.push("feedback.unlocked");
    }
  }

  return events;
}

function isMissingPonderContentError(error: unknown) {
  return error instanceof PonderHttpError && error.status === 404;
}

function readOriginalClientRequestIdFromReceipt(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as { originalClientRequestId?: unknown };
    return typeof parsed.originalClientRequestId === "string" ? parsed.originalClientRequestId : null;
  } catch {
    return null;
  }
}

async function listManagedLifecycleCandidates(params: {
  after?: ManagedLifecycleCursor | null;
  limit: number;
  targetChainIds?: ReadonlySet<number> | null;
}) {
  const managedSortExpression = "COALESCE(submissions.submitted_at, submissions.updated_at, reservations.updated_at)";
  const publicSortExpression = "COALESCE(submissions.submitted_at, submissions.updated_at)";
  const targetChainIds = normalizeTargetChainIds(params.targetChainIds);
  if (targetChainIds && targetChainIds.length === 0) return [];

  const targetChainPlaceholders = targetChainIds?.map(() => "?").join(", ") ?? "";
  const managedTargetChainFilter = targetChainPlaceholders
    ? `AND reservations.chain_id IN (${targetChainPlaceholders})`
    : "";
  const publicTargetChainFilter = targetChainPlaceholders
    ? `AND submissions.chain_id IN (${targetChainPlaceholders})`
    : "";
  const result = await dbClient.execute({
    args: [
      ...(targetChainIds ?? []),
      ...(targetChainIds ?? []),
      params.after?.sortAt ?? null,
      params.after?.sortAt ?? null,
      params.after?.sortAt ?? null,
      params.after?.operationKey ?? null,
      params.limit,
    ],
    sql: `
      WITH lifecycle_candidates AS (
        SELECT
          reservations.agent_id,
          reservations.chain_id,
          reservations.client_request_id,
          submissions.content_id,
          reservations.operation_key,
          NULL AS payment_receipt,
          NULL AS payer_address,
          ${managedSortExpression} AS sort_at
        FROM mcp_agent_budget_reservations AS reservations
        INNER JOIN x402_question_submissions AS submissions
          ON submissions.operation_key = reservations.operation_key
        WHERE submissions.status = 'submitted'
          AND submissions.content_id IS NOT NULL
          ${managedTargetChainFilter}

        UNION ALL

        SELECT
          NULL AS agent_id,
          submissions.chain_id,
          submissions.client_request_id,
          submissions.content_id,
          submissions.operation_key,
          submissions.payment_receipt,
          submissions.payer_address,
          ${publicSortExpression} AS sort_at
        FROM x402_question_submissions AS submissions
        WHERE submissions.status = 'submitted'
          AND submissions.content_id IS NOT NULL
          AND submissions.payer_address IS NOT NULL
          AND (
            submissions.client_request_id LIKE 'wallet:%'
            OR submissions.payment_receipt LIKE '%"mode":"permissionless-wallet-plan"%'
            OR submissions.payment_receipt LIKE '%"mode":"permissionless-x402-authorization"%'
          )
          AND (
            submissions.payment_receipt IS NULL
            OR submissions.payment_receipt NOT LIKE '%"agentId"%'
          )
          ${publicTargetChainFilter}
      )
      SELECT *
      FROM lifecycle_candidates
      WHERE (
        CAST(? AS timestamptz) IS NULL
        OR sort_at > ?
        OR (sort_at = ? AND operation_key > ?)
      )
      ORDER BY sort_at ASC, operation_key ASC
      LIMIT ?
    `,
  });

  return result.rows.map(row => {
    const chainId = Number(row.chain_id);
    const payerAddress = typeof row.payer_address === "string" ? row.payer_address : "";
    const agentId =
      typeof row.agent_id === "string" && row.agent_id
        ? row.agent_id
        : publicWebhookAgentId({ chainId, walletAddress: payerAddress });
    return {
      agentId,
      chainId,
      clientRequestId: readOriginalClientRequestIdFromReceipt(row.payment_receipt) ?? String(row.client_request_id),
      contentId: String(row.content_id),
      operationKey: String(row.operation_key) as `0x${string}`,
      sortAt: row.sort_at instanceof Date ? row.sort_at : new Date(String(row.sort_at)),
    };
  });
}

export async function sweepAgentLifecycleCallbacks(params: { limit?: number; now?: Date } = {}) {
  const maxCandidates = Math.max(1, Math.min(params.limit ?? 25, 100));
  const pageSize = Math.min(maxCandidates, 100);
  const now = params.now ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const dependencies = getLifecycleDependencies();
  const targetChainIds = configuredTargetChainIds();
  const emitted = {
    bountyLowResponse: 0,
    feedbackUnlocked: 0,
    questionOpen: 0,
    questionSettled: 0,
    questionSettling: 0,
  };
  let scanned = 0;
  let hasMore = false;
  let cursor: ManagedLifecycleCursor | null = null;

  if (targetChainIds?.size === 0) {
    return { emitted, hasMore, scanned };
  }

  while (scanned < maxCandidates) {
    const remaining = maxCandidates - scanned;
    const requestedLimit = Math.min(pageSize, remaining);
    const candidates = await dependencies.listCandidates({
      after: cursor,
      limit: requestedLimit,
      targetChainIds,
    });
    if (candidates.length === 0) break;

    for (const candidate of candidates) {
      if (scanned >= maxCandidates) {
        hasMore = true;
        break;
      }

      if (targetChainIds && !targetChainIds.has(candidate.chainId)) {
        continue;
      }

      const deployment = resolveProtocolDeploymentScope(candidate.chainId);
      if (!deployment) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            `[agent-lifecycle] Skipping candidate ${candidate.contentId}: unsupported chain ${candidate.chainId}`,
          );
        }
        scanned += 1;
        continue;
      }
      const deploymentOptions = {
        chainId: candidate.chainId,
        deploymentKey: deployment.deploymentKey,
      };
      let response: Awaited<ReturnType<typeof ponderApi.getContentById>>;
      try {
        response = await dependencies.getContentById(candidate.contentId, deploymentOptions);
      } catch (error) {
        if (isMissingPonderContentError(error)) {
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              `[agent-lifecycle] Skipping candidate ${candidate.contentId}: content not found in deployment ${deployment.deploymentKey}`,
            );
          }
          scanned += 1;
          continue;
        }

        throw error;
      }
      const feedbackContext = buildContentFeedbackRoundContext(
        Array.isArray(response.rounds) ? response.rounds : [],
        response.content.openRound?.roundId ?? null,
      );
      const feedback = await dependencies.listContentFeedback({
        chainId: candidate.chainId,
        contentId: candidate.contentId,
        context: feedbackContext,
        deploymentKey: deployment.deploymentKey,
      });
      const liveAskGuidance = buildAgentLiveAskGuidance({
        content: response.content,
        nowSeconds,
      });

      for (const eventType of lifecycleEventsForContent({
        feedbackPublicCount: feedback.items.length,
        nowSeconds,
        response,
      })) {
        await dependencies.enqueueAgentCallbackEvent({
          agentId: candidate.agentId,
          eventId: callbackEventId(candidate.operationKey, eventType),
          eventType,
          payload: buildAgentCallbackPayload({
            body: {
              contentId: candidate.contentId,
              status:
                eventType === "question.open"
                  ? "open"
                  : eventType === "question.settling"
                    ? "settling"
                    : eventType === "question.settled"
                      ? "settled"
                      : "feedback_unlocked",
            },
            chainId: candidate.chainId,
            clientRequestId: candidate.clientRequestId,
            eventType,
            operationKey: candidate.operationKey,
          }),
        });

        if (eventType === "question.open") emitted.questionOpen += 1;
        if (eventType === "question.settling") emitted.questionSettling += 1;
        if (eventType === "question.settled") emitted.questionSettled += 1;
        if (eventType === "feedback.unlocked") emitted.feedbackUnlocked += 1;
      }

      if (
        liveAskGuidance &&
        liveAskGuidance.lowResponseRisk === "high" &&
        liveAskGuidance.recommendedAction !== "wait"
      ) {
        await dependencies.enqueueAgentCallbackEvent({
          agentId: candidate.agentId,
          eventId: callbackEventId(candidate.operationKey, "bounty.low_response"),
          eventType: "bounty.low_response",
          payload: buildAgentCallbackPayload({
            body: {
              contentId: candidate.contentId,
              liveAskGuidance,
              status: "low_response",
            },
            chainId: candidate.chainId,
            clientRequestId: candidate.clientRequestId,
            eventType: "bounty.low_response",
            operationKey: candidate.operationKey,
          }),
        });
        emitted.bountyLowResponse += 1;
      }

      scanned += 1;
    }

    const lastCandidate = candidates.at(-1);
    if (!lastCandidate) break;
    if (
      cursor &&
      lastCandidate.operationKey === cursor.operationKey &&
      lastCandidate.sortAt.getTime() === cursor.sortAt.getTime()
    ) {
      break;
    }
    cursor = {
      operationKey: lastCandidate.operationKey,
      sortAt: lastCandidate.sortAt,
    };
    if (candidates.length < requestedLimit) break;
    if (scanned >= maxCandidates) {
      hasMore = true;
      break;
    }
  }

  return {
    emitted,
    hasMore,
    scanned,
  };
}
