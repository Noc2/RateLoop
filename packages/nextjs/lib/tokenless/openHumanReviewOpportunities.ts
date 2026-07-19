import "server-only";
import { dbClient } from "~~/lib/db";
import type { AgentMcpPrincipal } from "~~/lib/tokenless/agentIntegrations";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type IntegrationPrincipal = Extract<AgentMcpPrincipal, { kind: "integration" }>;
type Row = Record<string, unknown>;

const DEFAULT_LIMIT = 20;
const MAXIMUM_LIMIT = 50;
const MAXIMUM_CURSOR_LENGTH = 1_024;
const CURSOR_VERSION = 1;
const ACTIVE_STATES = ["approval_required", "request_ready", "pending", "blocked"] as const;

type ActiveState = (typeof ACTIVE_STATES)[number];
type Cursor = { version: 1; createdAt: string; opportunityId: string };

export type OpenHumanReviewOpportunity = {
  opportunityId: string;
  workflowKey: string;
  riskTier: string;
  createdAt: string;
  lifecycle: {
    state: ActiveState;
    revision: number;
    stateEnteredAt: string;
    updatedAt: string;
  };
  nextAction: "rateloop_request_review" | "rateloop_wait_for_review" | "rateloop_get_agent_context";
};

export type OpenHumanReviewOpportunityPage = {
  schemaVersion: "rateloop.open-human-reviews.v1";
  items: OpenHumanReviewOpportunity[];
  nextCursor: string | null;
};

function invalidQuery(message: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_open_review_query");
}

function text(row: Row, key: string) {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Database returned an invalid ${key}.`);
  }
  return value;
}

function integer(row: Row, key: string) {
  const value = Number(row[key]);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Database returned an invalid ${key}.`);
  }
  return value;
}

function timestamp(value: unknown, key: string) {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Database returned an invalid ${key}.`);
  }
  return parsed.toISOString();
}

function activeState(value: unknown): ActiveState {
  if (typeof value !== "string" || !ACTIVE_STATES.includes(value as ActiveState)) {
    throw new Error("Database returned an invalid active lifecycle state.");
  }
  return value as ActiveState;
}

function nextAction(state: ActiveState): OpenHumanReviewOpportunity["nextAction"] {
  if (state === "approval_required" || state === "request_ready") return "rateloop_request_review";
  if (state === "pending") return "rateloop_wait_for_review";
  return "rateloop_get_agent_context";
}

function encodeCursor(value: Cursor) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value: string): Cursor {
  if (value.length === 0 || value.length > MAXIMUM_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    return invalidQuery("Open-review cursor is invalid.");
  }
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      return invalidQuery("Open-review cursor is invalid.");
    }
    const record = decoded as Record<string, unknown>;
    if (
      Object.keys(record).sort().join(",") !== "createdAt,opportunityId,version" ||
      record.version !== CURSOR_VERSION ||
      typeof record.createdAt !== "string" ||
      new Date(record.createdAt).toISOString() !== record.createdAt ||
      typeof record.opportunityId !== "string" ||
      record.opportunityId.length < 1 ||
      record.opportunityId.length > 160
    ) {
      return invalidQuery("Open-review cursor is invalid.");
    }
    return {
      version: CURSOR_VERSION,
      createdAt: record.createdAt,
      opportunityId: record.opportunityId,
    };
  } catch (error) {
    if (error instanceof TokenlessServiceError) throw error;
    return invalidQuery("Open-review cursor is invalid.");
  }
}

function requestedLimit(value: number | undefined) {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAXIMUM_LIMIT) {
    return invalidQuery(`Open-review limit must be between 1 and ${MAXIMUM_LIMIT}.`);
  }
  return value;
}

function opportunity(row: Row): OpenHumanReviewOpportunity {
  const state = activeState(row.state);
  return {
    opportunityId: text(row, "opportunity_id"),
    workflowKey: text(row, "workflow_key"),
    riskTier: text(row, "risk_tier"),
    createdAt: timestamp(row.created_at, "created_at"),
    lifecycle: {
      state,
      revision: integer(row, "state_revision"),
      stateEnteredAt: timestamp(row.state_entered_at, "state_entered_at"),
      updatedAt: timestamp(row.updated_at, "updated_at"),
    },
    nextAction: nextAction(state),
  };
}

export async function listOpenHumanReviewOpportunities(input: {
  principal: IntegrationPrincipal;
  cursor?: string;
  limit?: number;
}): Promise<OpenHumanReviewOpportunityPage> {
  const limit = requestedLimit(input.limit);
  const cursor = input.cursor === undefined ? null : decodeCursor(input.cursor);
  const binding = input.principal.integration;
  const cursorClause = cursor ? "AND (o.created_at < ? OR (o.created_at = ? AND o.opportunity_id < ?))" : "";
  const result = await dbClient.execute({
    sql: `SELECT o.opportunity_id, o.created_at,
                 scope.workflow_key, scope.risk_tier,
                 lifecycle.state, lifecycle.state_revision,
                 lifecycle.state_entered_at, lifecycle.updated_at
          FROM tokenless_agent_integrations integration
          JOIN tokenless_agent_executions execution
            ON execution.integration_id = integration.integration_id
           AND execution.workspace_id = integration.workspace_id
           AND execution.agent_id = integration.agent_id
           AND execution.agent_version_id = integration.agent_version_id
          JOIN tokenless_agent_review_opportunities o
            ON o.execution_id = execution.execution_id
           AND o.workspace_id = integration.workspace_id
           AND o.agent_id = integration.agent_id
           AND o.agent_version_id = integration.agent_version_id
          JOIN tokenless_agent_evaluation_scopes scope
            ON scope.workspace_id = o.workspace_id
           AND scope.scope_id = o.scope_id
           AND scope.agent_id = o.agent_id
           AND scope.agent_version_id = o.agent_version_id
          JOIN tokenless_agent_review_opportunity_lifecycles lifecycle
            ON lifecycle.workspace_id = o.workspace_id
           AND lifecycle.opportunity_id = o.opportunity_id
          WHERE integration.integration_id = ?
            AND integration.workspace_id = ?
            AND integration.agent_id = ?
            AND integration.agent_version_id = ?
            AND integration.status = 'active'
            AND lifecycle.terminal_at IS NULL
            AND lifecycle.state IN ('approval_required', 'request_ready', 'pending', 'blocked')
            ${cursorClause}
          ORDER BY o.created_at DESC, o.opportunity_id DESC
          LIMIT ?`,
    args: [
      binding.integrationId,
      binding.workspaceId,
      binding.agentId,
      binding.agentVersionId,
      ...(cursor ? [new Date(cursor.createdAt), new Date(cursor.createdAt), cursor.opportunityId] : []),
      limit + 1,
    ],
  });
  const rows = result.rows as Row[];
  const items = rows.slice(0, limit).map(opportunity);
  const last = rows.length > limit ? items.at(-1) : undefined;
  return {
    schemaVersion: "rateloop.open-human-reviews.v1",
    items,
    nextCursor: last
      ? encodeCursor({ version: CURSOR_VERSION, createdAt: last.createdAt, opportunityId: last.opportunityId })
      : null,
  };
}
