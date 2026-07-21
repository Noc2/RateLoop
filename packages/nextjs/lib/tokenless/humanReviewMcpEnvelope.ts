import { parseHumanReviewResultEnvelope } from "@rateloop/sdk";
import { createHash } from "node:crypto";
import "server-only";
import { dbPool } from "~~/lib/db";
import type { AgentMcpPrincipal } from "~~/lib/tokenless/agentIntegrations";
import {
  type HumanReviewGateServerState,
  issueHumanReviewAdvisorySkipEvidence,
  issueHumanReviewAdvisoryTerminalEvidence,
} from "~~/lib/tokenless/humanReviewGateEvidence";
import {
  type SelectionPolicySnapshot,
  hashHumanReviewSelectionPolicySnapshot,
} from "~~/lib/tokenless/humanReviewResultObservation";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type IntegrationPrincipal = Extract<AgentMcpPrincipal, { kind: "integration" }>;
type LifecycleState = HumanReviewGateServerState["lifecycle"]["state"];

const TERMINAL_STATES = new Set<LifecycleState>([
  "skipped",
  "completed",
  "inconclusive",
  "failed_terminal",
  "cancelled_before_commit",
]);

function terminalDisposition(state: LifecycleState): HumanReviewGateServerState["terminalDisposition"] {
  if (
    state === "skipped" ||
    state === "completed" ||
    state === "inconclusive" ||
    state === "failed_terminal" ||
    state === "cancelled_before_commit"
  ) {
    return state;
  }
  return null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Human-review MCP gate state is not canonicalizable.");
  return encoded;
}

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function text(row: Row, key: string) {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

function integer(row: Row, key: string) {
  const value = Number(row[key]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function date(row: Row, key: string) {
  const value = row[key];
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Stored ${key} is invalid.`);
  return parsed;
}

function jsonObject(value: unknown, key: string) {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`Stored ${key} is invalid.`);
  }
}

function reasonCodes(value: unknown) {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!Array.isArray(parsed) || parsed.some(item => typeof item !== "string")) throw new Error();
    return parsed as string[];
  } catch {
    throw new Error("Stored human-review lifecycle reasons are invalid.");
  }
}

function lifecycleState(row: Row): LifecycleState {
  const value = text(row, "lifecycle_state") as LifecycleState | null;
  if (
    value !== "skipped" &&
    value !== "approval_required" &&
    value !== "request_ready" &&
    value !== "pending" &&
    value !== "blocked" &&
    value !== "completed" &&
    value !== "inconclusive" &&
    value !== "failed_terminal" &&
    value !== "cancelled_before_commit"
  ) {
    throw new Error("Stored human-review lifecycle is invalid for an MCP gate envelope.");
  }
  return value;
}

function selectionSnapshot(row: Row): SelectionPolicySnapshot {
  return {
    schemaVersion: "rateloop.human-review-selection-policy.v1",
    workspaceId: text(row, "workspace_id")!,
    agentId: text(row, "agent_id")!,
    agentVersionId: text(row, "agent_version_id")!,
    policyId: text(row, "policy_id")!,
    version: integer(row, "policy_version"),
    mode: text(row, "policy_mode")!,
    agreementThresholdBps: integer(row, "agreement_threshold_bps"),
    productionFloorBps: integer(row, "production_floor_bps"),
    fixedRateBps:
      row.fixed_rate_bps === null || row.fixed_rate_bps === undefined ? null : integer(row, "fixed_rate_bps"),
    maximumUnreviewedGap: integer(row, "maximum_unreviewed_gap"),
    rules: jsonObject(row.rules_json, "selection policy rules"),
    audience: jsonObject(row.audience_policy_json, "selection audience policy"),
    publishingPolicyId: text(row, "review_publishing_policy_id"),
  };
}

function routeLane(row: Row) {
  const audience = text(row, "profile_audience");
  const compensation = text(row, "compensation_mode");
  if (audience === "public_network" && compensation === "usdc") return "public_paid" as const;
  if (audience === "private_invited" && compensation === "usdc") return "private_paid" as const;
  if (audience === "private_invited" && compensation === "unpaid") return "private_unpaid" as const;
  if (audience === "hybrid") return "hybrid" as const;
  throw new Error("Stored human-review route lane is invalid.");
}

function responseDeadline(row: Row) {
  if (row.private_response_deadline !== null && row.private_response_deadline !== undefined) {
    return date(row, "private_response_deadline");
  }
  if (row.approval_expires_at !== null && row.approval_expires_at !== undefined) {
    return date(row, "approval_expires_at");
  }
  const roundTerms = text(row, "round_terms_json");
  if (roundTerms) {
    const parsed = jsonObject(roundTerms, "round terms");
    if (typeof parsed.commitDeadline !== "string" || !/^(0|[1-9]\d*)$/u.test(parsed.commitDeadline)) {
      throw new Error("Stored review commit deadline is invalid.");
    }
    const milliseconds = Number(BigInt(parsed.commitDeadline) * 1_000n);
    if (!Number.isSafeInteger(milliseconds)) throw new Error("Stored review commit deadline is invalid.");
    return new Date(milliseconds);
  }
  return new Date(date(row, "opportunity_created_at").getTime() + integer(row, "response_window_seconds") * 1_000);
}

function requestReference(row: Row) {
  const reference = text(row, "operation_key") ?? text(row, "private_delivery_id") ?? text(row, "approval_id");
  return reference ?? null;
}

function resultReference(row: Row, state: LifecycleState) {
  const stored = text(row, "result_envelope_commitment");
  if (stored) return stored;
  if (state !== "completed" && state !== "inconclusive" && state !== "failed_terminal") return null;
  return sha256({
    schemaVersion: "rateloop.human-review-terminal-reference.v1",
    workspaceId: text(row, "workspace_id"),
    opportunityId: text(row, "opportunity_id"),
    lifecycle: { state, revision: integer(row, "state_revision") },
    terminalAt: date(row, "terminal_at").toISOString(),
  });
}

function terminalResult(row: Row, state: LifecycleState) {
  const storedResultSemantics = text(row, "frozen_result_semantics");
  if (storedResultSemantics !== "assurance" && storedResultSemantics !== "feedback") {
    throw new Error("Stored human-review result semantics are invalid.");
  }
  const resultSemantics: "assurance" | "feedback" = storedResultSemantics;
  const privateEnvelopeJson = text(row, "private_result_envelope_json");
  const privateCommitment = text(row, "private_result_commitment");
  const observedCommitment = text(row, "observed_result_commitment");
  const observedOutcome = text(row, "observed_outcome");
  const observedSemantics = text(row, "observed_result_semantics");
  let resultCommitment: `sha256:${string}` | null = null;
  let resultOutcome: "positive" | "negative" | "inconclusive" | "failed" | "cancelled" | null = null;
  if (privateEnvelopeJson !== null || privateCommitment !== null) {
    if (
      privateEnvelopeJson === null ||
      privateCommitment === null ||
      !/^sha256:[0-9a-f]{64}$/u.test(privateCommitment)
    ) {
      throw new Error("Stored private human-review result is incomplete.");
    }
    const envelope = parseHumanReviewResultEnvelope(JSON.parse(privateEnvelopeJson) as unknown);
    if (
      envelope.workspaceId !== text(row, "workspace_id") ||
      envelope.integrationId !== text(row, "integration_id") ||
      envelope.opportunityId !== text(row, "opportunity_id") ||
      envelope.lifecycle.state !== state ||
      envelope.commitments.result !== privateCommitment
    ) {
      throw new Error("Stored private human-review result does not match its frozen opportunity.");
    }
    resultCommitment = privateCommitment as `sha256:${string}`;
    resultOutcome = envelope.outcome;
  }
  if (observedCommitment !== null || observedOutcome !== null || observedSemantics !== null) {
    if (
      observedCommitment === null ||
      !/^sha256:[0-9a-f]{64}$/u.test(observedCommitment) ||
      !["positive", "negative", "inconclusive", "failed", "cancelled"].includes(observedOutcome ?? "") ||
      observedSemantics !== resultSemantics
    ) {
      throw new Error("Stored observed human-review result is invalid.");
    }
    if (
      (resultCommitment !== null && resultCommitment !== observedCommitment) ||
      (resultOutcome !== null && resultOutcome !== observedOutcome)
    ) {
      throw new Error("Stored human-review result projections disagree.");
    }
    resultCommitment = observedCommitment as `sha256:${string}`;
    resultOutcome = observedOutcome as typeof resultOutcome;
  }
  const releaseDisposition =
    state === "completed" &&
    resultSemantics === "assurance" &&
    resultOutcome === "positive" &&
    resultCommitment !== null
      ? ("authorized_positive" as const)
      : ("not_authorized" as const);
  return { resultSemantics, resultOutcome, resultCommitment, releaseDisposition };
}

async function loadAuthoritativeState(principal: IntegrationPrincipal, opportunityId: string) {
  const queryResult = await dbPool.query(
    `SELECT i.integration_id,o.workspace_id,o.opportunity_id,o.scope_id,o.agent_id,o.agent_version_id,
            o.policy_id,o.policy_version,o.decision,o.suggestion_commitment,o.operation_key,
            o.created_at AS opportunity_created_at,
            l.state AS lifecycle_state,l.state_revision,l.reason_codes_json,l.state_entered_at,l.terminal_at,
            p.mode AS policy_mode,p.agreement_threshold_bps,p.production_floor_bps,p.fixed_rate_bps,
            p.maximum_unreviewed_gap,p.rules_json,p.audience_policy_json,
            p.publishing_policy_id AS review_publishing_policy_id,
            b.binding_id,b.version AS binding_version,b.canonical_hash AS binding_hash,b.authority,
            rp.profile_id,rp.version AS profile_version,rp.profile_hash,rp.audience AS profile_audience,
            rp.compensation_mode,rp.response_window_seconds,rp.result_semantics AS frozen_result_semantics,
            private_delivery.delivery_id AS private_delivery_id,
            private_delivery.response_deadline AS private_response_deadline,
            private_delivery.result_envelope_json AS private_result_envelope_json,
            private_delivery.result_commitment AS private_result_commitment,
            chain_execution.round_terms_json,
            approval.approval_id,approval.expires_at AS approval_expires_at,
            observation.result_envelope_commitment,
            observation.result_commitment AS observed_result_commitment,
            observation.outcome AS observed_outcome,
            observation.result_semantics AS observed_result_semantics
     FROM tokenless_agent_integrations i
     JOIN tokenless_agent_review_opportunities o
       ON o.workspace_id=i.workspace_id AND o.agent_id=i.agent_id AND o.agent_version_id=i.agent_version_id
     JOIN tokenless_agent_executions execution
       ON execution.execution_id=o.execution_id AND execution.integration_id=i.integration_id
     JOIN tokenless_agent_review_opportunity_lifecycles l
       ON l.workspace_id=o.workspace_id AND l.opportunity_id=o.opportunity_id
     JOIN tokenless_agent_review_policies p
       ON p.workspace_id=o.workspace_id AND p.policy_id=o.policy_id AND p.version=o.policy_version
     JOIN tokenless_agent_human_review_bindings b
       ON b.workspace_id=o.workspace_id AND b.binding_id=o.human_review_binding_id
      AND b.version=o.human_review_binding_version
     JOIN tokenless_agent_review_request_profiles rp
       ON rp.workspace_id=o.workspace_id AND rp.profile_id=o.request_profile_id
      AND rp.version=o.request_profile_version AND rp.profile_hash=o.request_profile_hash
     LEFT JOIN tokenless_private_unpaid_review_deliveries private_delivery
       ON private_delivery.workspace_id=o.workspace_id AND private_delivery.opportunity_id=o.opportunity_id
     LEFT JOIN tokenless_chain_executions chain_execution ON chain_execution.operation_key=o.operation_key
     LEFT JOIN (
       SELECT workspace_id,opportunity_id,MAX(revision) AS latest_revision
       FROM tokenless_agent_review_approval_requests GROUP BY workspace_id,opportunity_id
     ) latest_approval ON latest_approval.workspace_id=o.workspace_id AND latest_approval.opportunity_id=o.opportunity_id
     LEFT JOIN tokenless_agent_review_approval_requests approval
       ON approval.workspace_id=latest_approval.workspace_id
      AND approval.opportunity_id=latest_approval.opportunity_id AND approval.revision=latest_approval.latest_revision
     LEFT JOIN tokenless_agent_human_review_result_observations observation
       ON observation.workspace_id=o.workspace_id AND observation.opportunity_id=o.opportunity_id
     WHERE i.integration_id=$1 AND i.status='active' AND o.opportunity_id=$2`,
    [principal.integration.integrationId, opportunityId],
  );
  const row = queryResult.rows[0] as Row | undefined;
  if (!row) {
    throw new TokenlessServiceError("Review opportunity not found.", 404, "review_opportunity_not_found");
  }
  const state = lifecycleState(row);
  const decision = text(row, "decision") as "required" | "recommended" | "skip";
  if (decision !== "required" && decision !== "recommended" && decision !== "skip") {
    throw new Error("Stored review decision is invalid.");
  }
  const selectionPolicy = selectionSnapshot(row);
  const policyHash = hashHumanReviewSelectionPolicySnapshot(selectionPolicy) as `sha256:${string}`;
  const bindingHash = text(row, "binding_hash") as `sha256:${string}`;
  const profileHash = text(row, "profile_hash") as `sha256:${string}`;
  const outputCommitment = text(row, "suggestion_commitment") as `sha256:${string}`;
  const scopeCommitment = sha256({
    schemaVersion: "rateloop.human-review-gate-scope.v1",
    workspaceId: text(row, "workspace_id"),
    integrationId: principal.integration.integrationId,
    agentId: text(row, "agent_id"),
    agentVersionId: text(row, "agent_version_id"),
    scopeId: text(row, "scope_id"),
    selectionPolicy: { id: text(row, "policy_id"), version: integer(row, "policy_version"), hash: policyHash },
    binding: { id: text(row, "binding_id"), version: integer(row, "binding_version"), hash: bindingHash },
    requestProfile: { id: text(row, "profile_id"), version: integer(row, "profile_version"), hash: profileHash },
  });
  const terminal = terminalResult(row, state);
  const serverState: HumanReviewGateServerState = {
    schemaVersion: "rateloop.human-review-gate-server-state.v1",
    workspaceId: text(row, "workspace_id")!,
    integrationId: principal.integration.integrationId,
    agentId: text(row, "agent_id")!,
    agentVersionId: text(row, "agent_version_id")!,
    scopeId: text(row, "scope_id")!,
    opportunityId: text(row, "opportunity_id")!,
    lifecycle: { state, revision: integer(row, "state_revision") },
    references: {
      operationKey: text(row, "operation_key"),
      requestReference: requestReference(row),
      resultReference: resultReference(row, state),
    },
    reviewDecision: decision,
    terminalDisposition: terminalDisposition(state),
    selectionPolicy: { id: selectionPolicy.policyId, version: selectionPolicy.version, hash: policyHash },
    humanReviewBinding: { id: text(row, "binding_id")!, version: integer(row, "binding_version"), hash: bindingHash },
    requestProfile: { id: text(row, "profile_id")!, version: integer(row, "profile_version"), hash: profileHash },
    outputCommitment,
    scopeCommitment,
    inconclusiveReleaseAllowed: false,
    ...terminal,
  };
  return { row, serverState, state, decision, scopeCommitment };
}

export async function projectHumanReviewMcpEnvelope(input: {
  principal: IntegrationPrincipal;
  opportunityId: string;
  rawResult: unknown;
}) {
  const loaded = await loadAuthoritativeState(input.principal, input.opportunityId);
  const { row, serverState, state, decision, scopeCommitment } = loaded;
  const resolver = { resolve: async () => structuredClone(serverState) };
  let terminalEvidence = null;
  try {
    terminalEvidence =
      state === "skipped"
        ? await issueHumanReviewAdvisorySkipEvidence({
            resolver,
            expected: {
              workspaceId: serverState.workspaceId,
              integrationId: serverState.integrationId,
              opportunityId: serverState.opportunityId,
              lifecycleRevision: serverState.lifecycle.revision,
              outputCommitment: serverState.outputCommitment,
              policyBindingHash: serverState.humanReviewBinding.hash,
              scopeCommitment,
            },
          })
        : TERMINAL_STATES.has(state)
          ? await issueHumanReviewAdvisoryTerminalEvidence({
              resolver,
              expected: {
                workspaceId: serverState.workspaceId,
                integrationId: serverState.integrationId,
                opportunityId: serverState.opportunityId,
                lifecycleRevision: serverState.lifecycle.revision,
                outputCommitment: serverState.outputCommitment,
                policyBindingHash: serverState.humanReviewBinding.hash,
              },
            })
          : null;
  } catch (error) {
    if (
      !(
        error instanceof TokenlessServiceError &&
        (error.code === "assurance_evidence_signing_unavailable" ||
          error.code === "review_gate_evidence_signing_unavailable" ||
          error.code === "review_gate_evidence_verification_unavailable")
      )
    ) {
      throw error;
    }
    // The business tool remains usable. An unsigned terminal/skip envelope
    // deliberately leaves the advisory gate armed until signing recovers.
    terminalEvidence = null;
  }
  const terminal = TERMINAL_STATES.has(state);
  const deadline = terminal ? null : responseDeadline(row);
  const raw =
    input.rawResult && typeof input.rawResult === "object" && !Array.isArray(input.rawResult)
      ? (input.rawResult as Record<string, unknown>)
      : {};
  return {
    ...raw,
    schemaVersion: "rateloop.human-review-tool-envelope.v1" as const,
    workspaceId: serverState.workspaceId,
    integrationId: serverState.integrationId,
    opportunityId: serverState.opportunityId,
    decision,
    lifecycle: {
      state,
      revision: serverState.lifecycle.revision,
      terminal,
      reasonCodes: reasonCodes(row.reason_codes_json),
      stateEnteredAt: date(row, "state_entered_at").toISOString(),
    },
    frozen: {
      selectionPolicy: { id: serverState.selectionPolicy.id, version: serverState.selectionPolicy.version },
      binding: serverState.humanReviewBinding,
      requestProfile: serverState.requestProfile,
      evaluationCommitment: serverState.outputCommitment,
    },
    route: {
      lane: routeLane(row),
      authority: text(row, "authority") as "check_only" | "prepare_for_approval" | "ask_automatically",
    },
    continuation:
      deadline === null
        ? null
        : {
            cursor: String(serverState.lifecycle.revision),
            retryAfterMs: 1_000,
            expiresAt: deadline.toISOString(),
          },
    terminalEvidence,
    rawResult: input.rawResult,
  };
}

export const __humanReviewMcpEnvelopeTestUtils = { sha256 };
