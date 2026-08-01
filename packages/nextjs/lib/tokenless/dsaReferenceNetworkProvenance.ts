import { canonicalizeRfc8785, sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";
import { dsaEvidenceCommitTimestamp, dsaEvidenceTransactionTimestamp } from "~~/lib/tokenless/dsaEvidenceClock";
import {
  type DsaReferenceLabel,
  type DsaReferenceLabelAgreement,
  type DsaSelectedEvaluationUnit,
  buildDsaReferenceLabelSetEvidence,
} from "~~/lib/tokenless/dsaReferenceLabelSets";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const DSA_REFERENCE_NETWORK_UNIT_SCHEMA_VERSION = "rateloop.dsa-reference-network-unit.v1" as const;
export const DSA_REFERENCE_NETWORK_ADJUDICATION_SCHEMA_VERSION =
  "rateloop.dsa-reference-network-adjudication.v1" as const;
export const DSA_REFERENCE_NETWORK_BRIDGE_SCHEMA_VERSION =
  "rateloop.dsa-reference-network-label-set-bridge.v1" as const;
export const DSA_REFERENCE_NETWORK_CHOICE_MAPPING = "candidate_pass_baseline_fail_tie_uncertain_v1" as const;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const EVENT_ID = /^dsan_evt_[0-9a-f]{40}$/u;
const EVENT_TYPES = ["invited", "accepted", "declined", "assigned", "opened", "completed", "timed_out"] as const;

export type DsaReferenceNetworkEventType = (typeof EVENT_TYPES)[number];
export type DsaReferenceNetworkTerminalState = "declined" | "completed" | "timed_out";
export type DsaReferenceNetworkChoice = "candidate" | "baseline" | "tie";

export type DsaReferenceNetworkIdentity = Readonly<{
  workspaceId: string;
  projectId: string;
  benchmarkId: string;
  activationReference: string;
  opportunityId: string;
  bindingId: string;
  runId: string;
  caseId: string;
  deploymentKey: string;
  chainId: number;
  panelAddress: string;
  roundId: string;
  epochId: string;
  unitId: string;
}>;

export type DsaReferenceNetworkLifecycleEvent = DsaReferenceNetworkIdentity &
  Readonly<{
    invitationId: string;
    eventId: string;
    sequence: number;
    eventType: DsaReferenceNetworkEventType;
    reviewerPrincipalId: string;
    assertedByKind: "reviewer" | "allocator";
    assertedByPrincipalId: string;
    assignmentId: string | null;
    reviewerKey: string | null;
    responseId: string | null;
    responseDigest: `sha256:${string}` | null;
    responseReviewerSource: "rateloop_network" | null;
    responseValidity: "valid" | null;
    responseLabel: DsaReferenceLabel | null;
    terminalState: DsaReferenceNetworkTerminalState | null;
    timeoutStage: "invited" | "accepted" | "assigned" | "opened" | null;
    occurredAt: string;
    eventJson: string;
    eventHash: `sha256:${string}`;
  }>;

type LifecycleInput = DsaReferenceNetworkIdentity &
  Readonly<{
    invitationId: string;
    eventId: string;
    sequence: number;
    eventType: DsaReferenceNetworkEventType;
    reviewerPrincipalId: string;
    assertedByKind: "reviewer" | "allocator";
    assertedByPrincipalId: string;
    assignmentId?: string | null;
    reviewerKey?: string | null;
    responseId?: string | null;
    responseDigest?: `sha256:${string}` | null;
    responseChoice?: DsaReferenceNetworkChoice | null;
    timeoutStage?: "invited" | "accepted" | "assigned" | "opened" | null;
    occurredAt: string;
    responseDeadlineAt: string;
    previous?: DsaReferenceNetworkLifecycleEvent | null;
  }>;

type Row = Record<string, unknown>;

function invalid(message: string, field?: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_dsa_reference_network_provenance", false, field);
}

function portableCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function timestamp(value: string, field: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    invalid(`${field} must be a canonical UTC timestamp.`, field);
  }
  return value;
}

function text(row: Row, field: string) {
  const value = row[field];
  return value === null || value === undefined ? null : String(value);
}

function count(row: Row, field: string) {
  const value = Number(row[field]);
  if (!Number.isSafeInteger(value) || value < 0) invalid(`Stored ${field} is invalid.`);
  return value;
}

export function dsaReferenceNetworkRoot(domain: string, rows: readonly string[]) {
  const hash = createHash("sha256");
  hash.update(domain, "utf8");
  hash.update(Buffer.from([0]));
  hash.update(rows.join("\n"), "utf8");
  return `sha256:${hash.digest("hex")}` as const;
}

export function deriveDsaReferenceNetworkLabel(choice: DsaReferenceNetworkChoice): DsaReferenceLabel {
  if (choice === "candidate") return "pass";
  if (choice === "baseline") return "fail";
  if (choice === "tie") return "uncertain";
  invalid("The response choice is not supported by the frozen network mapping.", "responseChoice");
}

function sameIdentity(left: DsaReferenceNetworkIdentity, right: DsaReferenceNetworkIdentity) {
  return (
    [
      "workspaceId",
      "projectId",
      "benchmarkId",
      "activationReference",
      "opportunityId",
      "bindingId",
      "runId",
      "caseId",
      "deploymentKey",
      "chainId",
      "panelAddress",
      "roundId",
      "epochId",
      "unitId",
    ] as const
  ).every(key => left[key] === right[key]);
}

export function assertDsaReferenceNetworkTransition(
  previous: DsaReferenceNetworkLifecycleEvent | null | undefined,
  next: Pick<
    LifecycleInput,
    "eventType" | "sequence" | "assignmentId" | "reviewerKey" | "reviewerPrincipalId" | "timeoutStage"
  > &
    DsaReferenceNetworkIdentity,
) {
  if (!previous) {
    if (next.eventType !== "invited" || next.sequence !== 1) invalid("An invitation must begin with invited.");
    return;
  }
  const allowed =
    (previous.eventType === "invited" &&
      (next.eventType === "accepted" || next.eventType === "declined" || next.eventType === "timed_out")) ||
    (previous.eventType === "accepted" && (next.eventType === "assigned" || next.eventType === "timed_out")) ||
    (previous.eventType === "assigned" && (next.eventType === "opened" || next.eventType === "timed_out")) ||
    (previous.eventType === "opened" && (next.eventType === "completed" || next.eventType === "timed_out"));
  if (!allowed || next.sequence !== previous.sequence + 1) invalid("The lifecycle transition or sequence is invalid.");
  if (!sameIdentity(previous, next) || previous.reviewerPrincipalId !== next.reviewerPrincipalId) {
    invalid("The lifecycle identity cannot change.");
  }
  if (
    (next.eventType === "opened" ||
      next.eventType === "completed" ||
      (next.eventType === "timed_out" && (next.timeoutStage === "assigned" || next.timeoutStage === "opened"))) &&
    ((next.assignmentId ?? null) !== previous.assignmentId || (next.reviewerKey ?? null) !== previous.reviewerKey)
  ) {
    invalid("The assignment provenance cannot change.");
  }
}

export function buildDsaReferenceNetworkLifecycleEvent(input: LifecycleInput): DsaReferenceNetworkLifecycleEvent {
  if (!EVENT_ID.test(input.eventId) || !EVENT_TYPES.includes(input.eventType))
    invalid("Lifecycle identity is invalid.");
  const occurredAt = timestamp(input.occurredAt, "occurredAt");
  const deadline = timestamp(input.responseDeadlineAt, "responseDeadlineAt");
  assertDsaReferenceNetworkTransition(input.previous, input);
  const assignmentId = input.assignmentId ?? null;
  const reviewerKey = input.reviewerKey ?? null;
  const responseId = input.responseId ?? null;
  const responseDigest = input.responseDigest ?? null;
  const completed = input.eventType === "completed";
  const timeoutStage = input.eventType === "timed_out" ? (input.timeoutStage ?? null) : null;
  if (input.eventType === "timed_out" && timeoutStage !== input.previous?.eventType) {
    invalid("The timeout stage must match the frozen lifecycle stage.");
  }
  const assigned =
    input.eventType === "assigned" ||
    input.eventType === "opened" ||
    completed ||
    (input.eventType === "timed_out" && (timeoutStage === "assigned" || timeoutStage === "opened"));
  const requiredActorKind = ["invited", "assigned", "timed_out"].includes(input.eventType) ? "allocator" : "reviewer";
  if (
    input.assertedByKind !== requiredActorKind ||
    (requiredActorKind === "reviewer" && input.assertedByPrincipalId !== input.reviewerPrincipalId) ||
    (requiredActorKind === "allocator" && input.assertedByPrincipalId === input.reviewerPrincipalId)
  ) {
    invalid("The lifecycle event was asserted by the wrong actor.");
  }
  if (assigned !== Boolean(assignmentId && reviewerKey))
    invalid("Assignment provenance has the wrong lifecycle shape.");
  if (completed !== Boolean(responseId && responseDigest && input.responseChoice)) {
    invalid("Completed response provenance has the wrong lifecycle shape.");
  }
  if (responseDigest && !SHA256.test(responseDigest)) invalid("responseDigest is invalid.", "responseDigest");
  if (input.eventType === "timed_out" && occurredAt < deadline)
    invalid("An invitation cannot time out before its deadline.");
  const terminalState = (
    input.eventType === "declined" || completed || input.eventType === "timed_out" ? input.eventType : null
  ) as DsaReferenceNetworkTerminalState | null;
  const payload = {
    ...pickIdentity(input),
    invitationId: input.invitationId,
    eventId: input.eventId,
    sequence: input.sequence,
    eventType: input.eventType,
    reviewerPrincipalId: input.reviewerPrincipalId,
    assertedByKind: input.assertedByKind,
    assertedByPrincipalId: input.assertedByPrincipalId,
    assignmentId,
    reviewerKey,
    responseId,
    responseDigest,
    responseReviewerSource: completed ? ("rateloop_network" as const) : null,
    responseValidity: completed ? ("valid" as const) : null,
    responseLabel: completed ? deriveDsaReferenceNetworkLabel(input.responseChoice!) : null,
    terminalState,
    timeoutStage,
    occurredAt,
  };
  return { ...payload, eventJson: canonicalizeRfc8785(payload), eventHash: sha256Rfc8785(payload) };
}

function pickIdentity(input: DsaReferenceNetworkIdentity): DsaReferenceNetworkIdentity {
  return {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    benchmarkId: input.benchmarkId,
    activationReference: input.activationReference,
    opportunityId: input.opportunityId,
    bindingId: input.bindingId,
    runId: input.runId,
    caseId: input.caseId,
    deploymentKey: input.deploymentKey,
    chainId: input.chainId,
    panelAddress: input.panelAddress,
    roundId: input.roundId,
    epochId: input.epochId,
    unitId: input.unitId,
  };
}

export async function recordDsaReferenceNetworkLifecycleEvent(
  client: PoolClient,
  input: Omit<LifecycleInput, "occurredAt" | "previous" | "assertedByKind" | "assertedByPrincipalId"> & {
    authenticatedActorKind: "reviewer" | "allocator";
    authenticatedActorPrincipalId: string;
  },
) {
  const requiredActorKind = ["invited", "assigned", "timed_out"].includes(input.eventType) ? "allocator" : "reviewer";
  if (
    input.authenticatedActorKind !== requiredActorKind ||
    (requiredActorKind === "reviewer" && input.authenticatedActorPrincipalId !== input.reviewerPrincipalId) ||
    (requiredActorKind === "allocator" && input.authenticatedActorPrincipalId === input.reviewerPrincipalId)
  ) {
    throw new TokenlessServiceError(
      "The authenticated actor cannot assert this lifecycle transition.",
      403,
      "dsa_reference_network_actor_forbidden",
    );
  }
  const previousResult = await client.query(
    `SELECT * FROM tokenless_dsa_reference_network_lifecycle_events
     WHERE workspace_id=$1 AND invitation_id=$2 ORDER BY sequence DESC LIMIT 1 FOR UPDATE`,
    [input.workspaceId, input.invitationId],
  );
  const previous = previousResult.rows[0] ? lifecycleEventFromRow(previousResult.rows[0] as Row) : null;
  const occurredAt = (await dsaEvidenceTransactionTimestamp(client)).toISOString();
  const { authenticatedActorKind, authenticatedActorPrincipalId, ...eventInput } = input;
  const event = buildDsaReferenceNetworkLifecycleEvent({
    ...eventInput,
    previous,
    occurredAt,
    assertedByKind: authenticatedActorKind,
    assertedByPrincipalId: authenticatedActorPrincipalId,
  });
  await client.query(
    `INSERT INTO tokenless_dsa_reference_network_lifecycle_events
     (workspace_id,project_id,benchmark_id,activation_reference,opportunity_id,binding_id,run_id,case_id,
      deployment_key,chain_id,panel_address,round_id,epoch_id,unit_id,invitation_id,event_id,sequence,event_type,
      reviewer_principal_id,asserted_by_kind,asserted_by_principal_id,assignment_id,reviewer_key,response_id,response_digest,response_reviewer_source,
      response_validity,response_label,terminal_state,event_json,event_hash,occurred_at)
     VALUES (${Array.from({ length: 32 }, (_, index) => `$${index + 1}`).join(",")})`,
    [
      ...identityValues(event),
      event.invitationId,
      event.eventId,
      event.sequence,
      event.eventType,
      event.reviewerPrincipalId,
      event.assertedByKind,
      event.assertedByPrincipalId,
      event.assignmentId,
      event.reviewerKey,
      event.responseId,
      event.responseDigest,
      event.responseReviewerSource,
      event.responseValidity,
      event.responseLabel,
      event.terminalState,
      event.eventJson,
      event.eventHash,
      event.occurredAt,
    ],
  );
  return event;
}

async function requireActiveManagerProject(
  client: PoolClient,
  authenticatedManagerPrincipalId: string,
  identity: Pick<DsaReferenceNetworkIdentity, "workspaceId" | "projectId">,
) {
  const result = await client.query(
    `SELECT 1
     FROM tokenless_workspace_members m
     JOIN tokenless_workspaces w ON w.workspace_id=m.workspace_id AND w.status='active'
     JOIN tokenless_assurance_projects p
       ON p.workspace_id=m.workspace_id AND p.project_id=$2 AND p.status='active'
     JOIN tokenless_principals principal
       ON principal.principal_id=m.account_address AND principal.status='active'
     WHERE m.workspace_id=$1 AND m.account_address=$3 AND m.role IN ('owner','admin')
     LIMIT 1 FOR SHARE OF m,w,p,principal`,
    [identity.workspaceId, identity.projectId, authenticatedManagerPrincipalId],
  );
  if (result.rowCount !== 1) {
    throw new TokenlessServiceError(
      "Network benchmark project not found.",
      404,
      "dsa_reference_network_project_not_found",
    );
  }
  return authenticatedManagerPrincipalId;
}

async function inSerializableTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query(
      `SELECT set_config('lock_timeout','2s',true),set_config('statement_timeout','30s',true),
              set_config('idle_in_transaction_session_timeout','30s',true)`,
    );
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function registerDsaReferenceNetworkUnit(
  input: DsaReferenceNetworkIdentity & {
    authenticatedManagerPrincipalId: string;
    sourceDecisionBinding: `sha256:${string}`;
    sourceEvaluationBinding: `sha256:${string}`;
    sourceEvaluationHash: `sha256:${string}`;
    systemIdentity: `sha256:${string}`;
    automatedOutcome: "pass" | "fail";
    manifestRowHash: `sha256:${string}`;
    baselineArtifactId: string;
    candidateArtifactId: string;
    variantAArtifactId: string;
    variantBArtifactId: string;
    blindingCommitment: string;
    requiredCompletedResponseCount: number;
    responseDeadlineAt: string;
  },
) {
  return inSerializableTransaction(async client => {
    const actor = await requireActiveManagerProject(client, input.authenticatedManagerPrincipalId, input);
    const createdAt = (await dsaEvidenceTransactionTimestamp(client)).toISOString();
    const payload = {
      schemaVersion: DSA_REFERENCE_NETWORK_UNIT_SCHEMA_VERSION,
      ...pickIdentity(input),
      manifestSelected: true as const,
      sourceDecisionBinding: input.sourceDecisionBinding,
      sourceEvaluationBinding: input.sourceEvaluationBinding,
      sourceEvaluationHash: input.sourceEvaluationHash,
      systemIdentity: input.systemIdentity,
      automatedOutcome: input.automatedOutcome,
      manifestRowHash: input.manifestRowHash,
      choiceMapping: DSA_REFERENCE_NETWORK_CHOICE_MAPPING,
      baselineArtifactId: input.baselineArtifactId,
      candidateArtifactId: input.candidateArtifactId,
      variantAArtifactId: input.variantAArtifactId,
      variantBArtifactId: input.variantBArtifactId,
      blindingCommitment: input.blindingCommitment,
      choiceMappingHash: sha256Rfc8785({
        choiceMapping: DSA_REFERENCE_NETWORK_CHOICE_MAPPING,
        baselineArtifactId: input.baselineArtifactId,
        candidateArtifactId: input.candidateArtifactId,
        variantAArtifactId: input.variantAArtifactId,
        variantBArtifactId: input.variantBArtifactId,
        blindingCommitment: input.blindingCommitment,
      }),
      requiredCompletedResponseCount: input.requiredCompletedResponseCount,
      responseDeadlineAt: timestamp(input.responseDeadlineAt, "responseDeadlineAt"),
      createdBy: actor,
      createdAt,
    };
    const unitJson = canonicalizeRfc8785(payload);
    const unitHash = sha256Rfc8785(payload);
    await client.query(
      `INSERT INTO tokenless_dsa_reference_network_units
       (workspace_id,project_id,benchmark_id,activation_reference,opportunity_id,binding_id,run_id,case_id,
        deployment_key,chain_id,panel_address,round_id,epoch_id,unit_id,manifest_selected,source_decision_binding,
        source_evaluation_binding,source_evaluation_hash,system_identity,automated_outcome,manifest_row_hash,
        choice_mapping,baseline_artifact_id,candidate_artifact_id,variant_a_artifact_id,variant_b_artifact_id,
        blinding_commitment,choice_mapping_json,choice_mapping_hash,
        required_completed_response_count,response_deadline_at,schema_version,unit_json,unit_hash,
        created_by,created_at)
       VALUES (${Array.from({ length: 36 }, (_, index) => `$${index + 1}`).join(",")})`,
      [
        ...identityValues(input),
        true,
        input.sourceDecisionBinding,
        input.sourceEvaluationBinding,
        input.sourceEvaluationHash,
        input.systemIdentity,
        input.automatedOutcome,
        input.manifestRowHash,
        DSA_REFERENCE_NETWORK_CHOICE_MAPPING,
        input.baselineArtifactId,
        input.candidateArtifactId,
        input.variantAArtifactId,
        input.variantBArtifactId,
        input.blindingCommitment,
        canonicalizeRfc8785({
          choiceMapping: DSA_REFERENCE_NETWORK_CHOICE_MAPPING,
          baselineArtifactId: input.baselineArtifactId,
          candidateArtifactId: input.candidateArtifactId,
          variantAArtifactId: input.variantAArtifactId,
          variantBArtifactId: input.variantBArtifactId,
          blindingCommitment: input.blindingCommitment,
        }),
        payload.choiceMappingHash,
        input.requiredCompletedResponseCount,
        payload.responseDeadlineAt,
        payload.schemaVersion,
        unitJson,
        unitHash,
        actor,
        createdAt,
      ],
    );
    return { ...payload, unitJson, unitHash };
  });
}

function identityValues(identity: DsaReferenceNetworkIdentity) {
  return [
    identity.workspaceId,
    identity.projectId,
    identity.benchmarkId,
    identity.activationReference,
    identity.opportunityId,
    identity.bindingId,
    identity.runId,
    identity.caseId,
    identity.deploymentKey,
    identity.chainId,
    identity.panelAddress,
    identity.roundId,
    identity.epochId,
    identity.unitId,
  ];
}

function lifecycleEventFromRow(row: Row): DsaReferenceNetworkLifecycleEvent {
  const payload = JSON.parse(text(row, "event_json")!) as Omit<
    DsaReferenceNetworkLifecycleEvent,
    "eventJson" | "eventHash"
  >;
  return { ...payload, eventJson: text(row, "event_json")!, eventHash: text(row, "event_hash") as `sha256:${string}` };
}

export type DsaReferenceNetworkAdjudication = Readonly<{
  unitId: string;
  invitedCount: number;
  acceptedCount: number;
  declinedCount: number;
  assignedCount: number;
  openedCount: number;
  completedCount: number;
  timedOutCount: number;
  lifecycleRoot: `sha256:${string}`;
  responseRoot: `sha256:${string}`;
  finalLabel: DsaReferenceLabel;
  agreementState: DsaReferenceLabelAgreement;
  adjudicatedBy: string | null;
  adjudicationHash: `sha256:${string}`;
}>;

export function aggregateDsaReferenceNetworkAdjudications(adjudications: readonly DsaReferenceNetworkAdjudication[]) {
  if (adjudications.length === 0 || new Set(adjudications.map(value => value.unitId)).size !== adjudications.length) {
    invalid("Bridge adjudications must contain distinct selected units.");
  }
  const rows = [...adjudications].sort((left, right) => portableCompare(left.unitId, right.unitId));
  const sum = (
    field:
      | "invitedCount"
      | "acceptedCount"
      | "declinedCount"
      | "assignedCount"
      | "openedCount"
      | "completedCount"
      | "timedOutCount",
  ) => rows.reduce((total, row) => total + row[field], 0);
  return {
    selectedUnitCount: rows.length,
    invitedCount: sum("invitedCount"),
    acceptedCount: sum("acceptedCount"),
    declinedCount: sum("declinedCount"),
    assignedCount: sum("assignedCount"),
    openedCount: sum("openedCount"),
    completedCount: sum("completedCount"),
    timedOutCount: sum("timedOutCount"),
    lifecycleRoot: dsaReferenceNetworkRoot(
      "rateloop.dsa-reference-network-label-set-lifecycle.v1",
      rows.map(row => `${row.unitId}|${row.lifecycleRoot}`),
    ),
    responseRoot: dsaReferenceNetworkRoot(
      "rateloop.dsa-reference-network-label-set-responses.v1",
      rows.map(row => `${row.unitId}|${row.responseRoot}`),
    ),
    adjudicationRoot: dsaReferenceNetworkRoot(
      "rateloop.dsa-reference-network-label-set-adjudications.v1",
      rows.map(row => `${row.unitId}|${row.adjudicationHash}`),
    ),
  };
}

export function buildDsaReferenceNetworkAdjudication(input: {
  identity: DsaReferenceNetworkIdentity;
  events: readonly DsaReferenceNetworkLifecycleEvent[];
  requiredCompletedResponseCount: number;
  adjudicatedBy?: string | null;
  adjudicatedLabel?: DsaReferenceLabel | null;
  adjudicatedAt: string;
}) {
  const events = [...input.events].sort(
    (left, right) => portableCompare(left.invitationId, right.invitationId) || left.sequence - right.sequence,
  );
  if (events.some(event => !sameIdentity(event, input.identity)))
    invalid("Adjudication contains unrelated lifecycle evidence.");
  const completed = events.filter(event => event.eventType === "completed");
  const invitedCount = events.filter(event => event.eventType === "invited").length;
  const acceptedCount = events.filter(event => event.eventType === "accepted").length;
  const declinedCount = events.filter(event => event.eventType === "declined").length;
  const assignedCount = events.filter(event => event.eventType === "assigned").length;
  const openedCount = events.filter(event => event.eventType === "opened").length;
  const timedOutCount = events.filter(event => event.eventType === "timed_out").length;
  if (completed.length < input.requiredCompletedResponseCount)
    invalid("Terminal network response coverage is incomplete.");
  if (
    invitedCount < acceptedCount ||
    acceptedCount < assignedCount ||
    assignedCount < openedCount ||
    openedCount < completed.length ||
    invitedCount !== declinedCount + completed.length + timedOutCount
  ) {
    invalid("Every invited reviewer must reach one typed terminal state before adjudication.");
  }
  const labels = new Set(completed.map(event => event.responseLabel));
  const agreementState: DsaReferenceLabelAgreement = labels.size === 1 ? "agreed" : "adjudicated";
  if (agreementState === "agreed" && (input.adjudicatedBy || input.adjudicatedLabel)) {
    invalid("An agreed network result cannot be overridden.");
  }
  if (agreementState === "adjudicated" && (!input.adjudicatedBy || !input.adjudicatedLabel)) {
    invalid("Disagreeing terminal responses require independent adjudication.");
  }
  if (input.adjudicatedBy && events.some(event => event.reviewerPrincipalId === input.adjudicatedBy)) {
    invalid("A network reviewer cannot adjudicate the same unit.");
  }
  const finalLabel = agreementState === "agreed" ? completed[0]!.responseLabel! : input.adjudicatedLabel!;
  const counts = Object.fromEntries(
    EVENT_TYPES.map(type => [type, events.filter(event => event.eventType === type).length]),
  );
  const lifecycleRoot = dsaReferenceNetworkRoot(
    "rateloop.dsa-reference-network-lifecycle.v1",
    events.map(event => `${event.invitationId}|${event.sequence}|${event.eventHash}`),
  );
  const responseRoot = dsaReferenceNetworkRoot(
    "rateloop.dsa-reference-network-responses.v1",
    completed
      .sort((left, right) => portableCompare(left.invitationId, right.invitationId))
      .map(
        event =>
          `${event.invitationId}|${event.responseId}|${event.responseDigest}|${event.responseLabel}|${event.eventHash}`,
      ),
  );
  const payload = {
    schemaVersion: DSA_REFERENCE_NETWORK_ADJUDICATION_SCHEMA_VERSION,
    workspaceId: input.identity.workspaceId,
    epochId: input.identity.epochId,
    unitId: input.identity.unitId,
    invitedCount: counts.invited!,
    acceptedCount: counts.accepted!,
    declinedCount: counts.declined!,
    assignedCount: counts.assigned!,
    openedCount: counts.opened!,
    completedCount: counts.completed!,
    timedOutCount: counts.timed_out!,
    lifecycleRoot,
    responseRoot,
    finalLabel,
    agreementState,
    adjudicatedBy: input.adjudicatedBy ?? null,
    adjudicatedAt: timestamp(input.adjudicatedAt, "adjudicatedAt"),
  };
  return { ...payload, adjudicationJson: canonicalizeRfc8785(payload), adjudicationHash: sha256Rfc8785(payload) };
}

export async function adjudicateDsaReferenceNetworkUnit(input: {
  authenticatedManagerPrincipalId: string;
  workspaceId: string;
  epochId: string;
  unitId: string;
  adjudicatedLabel?: DsaReferenceLabel | null;
}) {
  return inSerializableTransaction(async client => {
    const unitResult = await client.query(
      `SELECT * FROM tokenless_dsa_reference_network_units
       WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3 FOR UPDATE`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    const unit = unitResult.rows[0] as Row | undefined;
    if (!unit) invalid("The selected reference-network unit does not exist.");
    const identity = identityFromRow(unit);
    const actor = await requireActiveManagerProject(client, input.authenticatedManagerPrincipalId, identity);
    const eventResult = await client.query(
      `SELECT * FROM tokenless_dsa_reference_network_lifecycle_events
       WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3
       ORDER BY encode(convert_to(invitation_id,'UTF8'),'hex'),sequence FOR SHARE`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    const events = (eventResult.rows as Row[]).map(lifecycleEventFromRow);
    const distinctLabels = new Set(
      events.filter(event => event.eventType === "completed").map(event => event.responseLabel),
    );
    const evidence = buildDsaReferenceNetworkAdjudication({
      identity,
      events,
      requiredCompletedResponseCount: count(unit, "required_completed_response_count"),
      adjudicatedBy: distinctLabels.size === 1 ? null : actor,
      adjudicatedLabel: input.adjudicatedLabel ?? null,
      adjudicatedAt: (await dsaEvidenceTransactionTimestamp(client)).toISOString(),
    });
    await client.query(
      `INSERT INTO tokenless_dsa_reference_network_adjudications
       (workspace_id,project_id,benchmark_id,activation_reference,opportunity_id,binding_id,run_id,case_id,
        deployment_key,chain_id,panel_address,round_id,epoch_id,unit_id,invited_count,accepted_count,declined_count,
        assigned_count,opened_count,completed_count,timed_out_count,lifecycle_root,response_root,final_label,
        agreement_state,adjudicated_by,schema_version,adjudication_json,adjudication_hash,adjudicated_at)
       VALUES (${Array.from({ length: 30 }, (_, index) => `$${index + 1}`).join(",")})`,
      [
        ...identityValues(identity),
        evidence.invitedCount,
        evidence.acceptedCount,
        evidence.declinedCount,
        evidence.assignedCount,
        evidence.openedCount,
        evidence.completedCount,
        evidence.timedOutCount,
        evidence.lifecycleRoot,
        evidence.responseRoot,
        evidence.finalLabel,
        evidence.agreementState,
        evidence.adjudicatedBy,
        evidence.schemaVersion,
        evidence.adjudicationJson,
        evidence.adjudicationHash,
        evidence.adjudicatedAt,
      ],
    );
    return evidence;
  });
}

function identityFromRow(row: Row): DsaReferenceNetworkIdentity {
  return {
    workspaceId: text(row, "workspace_id")!,
    projectId: text(row, "project_id")!,
    benchmarkId: text(row, "benchmark_id")!,
    activationReference: text(row, "activation_reference")!,
    opportunityId: text(row, "opportunity_id")!,
    bindingId: text(row, "binding_id")!,
    runId: text(row, "run_id")!,
    caseId: text(row, "case_id")!,
    deploymentKey: text(row, "deployment_key")!,
    chainId: count(row, "chain_id"),
    panelAddress: text(row, "panel_address")!,
    roundId: text(row, "round_id")!,
    epochId: text(row, "epoch_id")!,
    unitId: text(row, "unit_id")!,
  };
}

async function insertLabels(
  client: PoolClient,
  labels: ReturnType<typeof buildDsaReferenceLabelSetEvidence>["labels"],
) {
  for (const label of labels) {
    await client.query(
      `INSERT INTO tokenless_dsa_reference_labels
       (workspace_id,label_set_id,epoch_id,unit_id,evaluation_id,provider_decision_id,decision_version,
        manifest_selected,source_decision_binding,source_evaluation_binding,source_evaluation_hash,system_identity,
        system_id,system_version,automated_outcome,evaluation_hash,evaluation_projection_hash,manifest_row_hash,
        reference_label,agreement_state,adjudication_evidence_digest,label_json,label_hash,adjudicated_by,created_at)
       VALUES (${Array.from({ length: 25 }, (_, index) => `$${index + 1}`).join(",")})`,
      [
        label.workspaceId,
        label.labelSetId,
        label.epochId,
        label.unitId,
        label.evaluationId,
        label.providerDecisionId,
        label.decisionVersion,
        label.manifestSelected,
        label.sourceDecisionBinding,
        label.sourceEvaluationBinding,
        label.sourceEvaluationHash,
        label.systemIdentity,
        label.systemId,
        label.systemVersion,
        label.automatedOutcome,
        label.evaluationHash,
        label.evaluationProjectionHash,
        label.manifestRowHash,
        label.referenceLabel,
        label.agreementState,
        label.adjudicationEvidenceDigest,
        label.labelJson,
        label.labelHash,
        label.adjudicatedBy,
        label.createdAt,
      ],
    );
  }
}

export async function freezeDsaReferenceNetworkLabelSet(input: {
  workspaceId: string;
  epochId: string;
  authenticatedManagerPrincipalId: string;
  referenceDefinitionVersion: string;
  referenceDefinitionHash: `sha256:${string}`;
}) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const sourceFrozenAt = await dsaEvidenceTransactionTimestamp(client);
    const contextResult = await client.query(
      `SELECT e.project_id,e.benchmark_id,e.activation_reference,e.deployment_key,
              s.commitment_digest,s.sample_digest,s.manifest_root
       FROM tokenless_dsa_reference_sampling_epochs e
       JOIN tokenless_dsa_reference_samples s ON s.workspace_id=e.workspace_id AND s.epoch_id=e.epoch_id
       WHERE e.workspace_id=$1 AND e.epoch_id=$2 FOR SHARE`,
      [input.workspaceId, input.epochId],
    );
    const context = contextResult.rows[0] as Row | undefined;
    if (!context) invalid("The reference sampling epoch does not exist.");
    const actor = await requireActiveManagerProject(client, input.authenticatedManagerPrincipalId, {
      workspaceId: input.workspaceId,
      projectId: text(context, "project_id")!,
    });
    const rows = (
      await client.query(
        `SELECT m.unit_id,p.evaluation_id,p.provider_decision_id,p.decision_version,m.source_decision_binding,
              m.source_evaluation_binding,m.source_evaluation_hash,m.system_identity,p.system_id,p.system_version,
              m.automated_outcome,p.evaluation_hash,p.projection_hash AS evaluation_projection_hash,m.manifest_row_hash,
              a.final_label,a.agreement_state,a.adjudication_hash,a.invited_count,a.accepted_count,a.declined_count,
              a.assigned_count,a.opened_count,a.completed_count,a.timed_out_count,a.lifecycle_root,a.response_root
       FROM tokenless_dsa_reference_sample_manifest m
       JOIN tokenless_dsa_reference_evaluation_projections p
         ON p.workspace_id=m.workspace_id AND p.epoch_id=m.epoch_id AND p.unit_id=m.unit_id
       JOIN tokenless_dsa_reference_network_units u
         ON u.workspace_id=m.workspace_id AND u.epoch_id=m.epoch_id AND u.unit_id=m.unit_id
       JOIN tokenless_dsa_reference_network_adjudications a
         ON a.workspace_id=u.workspace_id AND a.epoch_id=u.epoch_id AND a.unit_id=u.unit_id
       WHERE m.workspace_id=$1 AND m.epoch_id=$2 AND m.selected=true
       ORDER BY encode(convert_to(m.unit_id,'UTF8'),'hex') FOR SHARE`,
        [input.workspaceId, input.epochId],
      )
    ).rows as Row[];
    if (rows.length === 0) invalid("No completely adjudicated selected network units exist.");
    const selectedUnits: DsaSelectedEvaluationUnit[] = rows.map(row => ({
      unitId: text(row, "unit_id")!,
      evaluationId: text(row, "evaluation_id")!,
      providerDecisionId: text(row, "provider_decision_id")!,
      decisionVersion: count(row, "decision_version"),
      sourceDecisionBinding: text(row, "source_decision_binding") as `sha256:${string}`,
      sourceEvaluationBinding: text(row, "source_evaluation_binding") as `sha256:${string}`,
      sourceEvaluationHash: text(row, "source_evaluation_hash") as `sha256:${string}`,
      systemIdentity: text(row, "system_identity") as `sha256:${string}`,
      systemId: text(row, "system_id")!,
      systemVersion: text(row, "system_version")!,
      automatedOutcome: text(row, "automated_outcome") as "pass" | "fail",
      evaluationHash: text(row, "evaluation_hash") as `sha256:${string}`,
      evaluationProjectionHash: text(row, "evaluation_projection_hash") as `sha256:${string}`,
      manifestRowHash: text(row, "manifest_row_hash") as `sha256:${string}`,
    }));
    const frozenAt = await dsaEvidenceCommitTimestamp(client);
    const evidence = buildDsaReferenceLabelSetEvidence({
      workspaceId: input.workspaceId,
      epochId: input.epochId,
      commitmentDigest: text(context, "commitment_digest") as `sha256:${string}`,
      sampleDigest: text(context, "sample_digest") as `sha256:${string}`,
      manifestRoot: text(context, "manifest_root") as `sha256:${string}`,
      referenceDefinitionVersion: input.referenceDefinitionVersion,
      referenceDefinitionHash: input.referenceDefinitionHash,
      selectedUnits,
      labels: rows.map(row => ({
        unitId: text(row, "unit_id")!,
        referenceLabel: text(row, "final_label") as DsaReferenceLabel,
        agreementState: text(row, "agreement_state") as DsaReferenceLabelAgreement,
        adjudicationEvidenceDigest: text(row, "adjudication_hash") as `sha256:${string}`,
      })),
      sourceFrozenAt: sourceFrozenAt.toISOString(),
      frozenAt: frozenAt.toISOString(),
      createdBy: actor,
    });
    const set = evidence.set;
    await client.query(
      `INSERT INTO tokenless_dsa_reference_label_sets
       (workspace_id,label_set_id,epoch_id,schema_version,commitment_digest,sample_digest,manifest_root,
        reference_definition_version,reference_definition_hash,expected_selected_count,selected_manifest_root,
        label_root,adjudication_evidence_root,pass_label_count,fail_label_count,uncertain_label_count,coverage_gap,
        set_json,set_hash,source_frozen_at,frozen_at,created_by,derivation_source)
       VALUES (${Array.from({ length: 23 }, (_, index) => `$${index + 1}`).join(",")})`,
      [
        set.workspaceId,
        set.labelSetId,
        set.epochId,
        set.schemaVersion,
        set.commitmentDigest,
        set.sampleDigest,
        set.manifestRoot,
        set.referenceDefinitionVersion,
        set.referenceDefinitionHash,
        set.expectedSelectedCount,
        set.selectedManifestRoot,
        set.labelRoot,
        set.adjudicationEvidenceRoot,
        set.passLabelCount,
        set.failLabelCount,
        set.uncertainLabelCount,
        set.coverageGap,
        set.setJson,
        set.setHash,
        set.sourceFrozenAt,
        set.frozenAt,
        set.createdBy,
        "rateloop_network",
      ],
    );
    await insertLabels(client, evidence.labels);
    const aggregate = aggregateDsaReferenceNetworkAdjudications(
      rows.map(row => ({
        unitId: text(row, "unit_id")!,
        invitedCount: count(row, "invited_count"),
        acceptedCount: count(row, "accepted_count"),
        declinedCount: count(row, "declined_count"),
        assignedCount: count(row, "assigned_count"),
        openedCount: count(row, "opened_count"),
        completedCount: count(row, "completed_count"),
        timedOutCount: count(row, "timed_out_count"),
        lifecycleRoot: text(row, "lifecycle_root") as `sha256:${string}`,
        responseRoot: text(row, "response_root") as `sha256:${string}`,
        finalLabel: text(row, "final_label") as DsaReferenceLabel,
        agreementState: text(row, "agreement_state") as DsaReferenceLabelAgreement,
        adjudicatedBy: null,
        adjudicationHash: text(row, "adjudication_hash") as `sha256:${string}`,
      })),
    );
    const bridgePayload = {
      schemaVersion: DSA_REFERENCE_NETWORK_BRIDGE_SCHEMA_VERSION,
      workspaceId: input.workspaceId,
      projectId: text(context, "project_id")!,
      benchmarkId: text(context, "benchmark_id")!,
      activationReference: text(context, "activation_reference")!,
      deploymentKey: text(context, "deployment_key")!,
      epochId: input.epochId,
      labelSetId: set.labelSetId,
      labelRoot: set.labelRoot,
      setHash: set.setHash,
      selectedUnitCount: aggregate.selectedUnitCount,
      invitedCount: aggregate.invitedCount,
      acceptedCount: aggregate.acceptedCount,
      declinedCount: aggregate.declinedCount,
      assignedCount: aggregate.assignedCount,
      openedCount: aggregate.openedCount,
      completedCount: aggregate.completedCount,
      timedOutCount: aggregate.timedOutCount,
      lifecycleRoot: aggregate.lifecycleRoot,
      responseRoot: aggregate.responseRoot,
      adjudicationRoot: aggregate.adjudicationRoot,
      reportingMode: "descriptive_panel_vs_network_only",
      populationClaim: false,
      operationalRollupEligible: false,
      adaptiveReuseAllowed: false,
      createdBy: actor,
      createdAt: frozenAt.toISOString(),
    } as const;
    await client.query(
      `INSERT INTO tokenless_dsa_reference_network_label_set_bridges
       (workspace_id,project_id,benchmark_id,activation_reference,deployment_key,epoch_id,label_set_id,label_root,set_hash,
        selected_unit_count,invited_count,accepted_count,declined_count,assigned_count,opened_count,completed_count,
        timed_out_count,lifecycle_root,response_root,adjudication_root,reporting_mode,population_claim,
        operational_rollup_eligible,adaptive_reuse_allowed,schema_version,bridge_json,bridge_hash,created_by,created_at)
       VALUES (${Array.from({ length: 29 }, (_, index) => `$${index + 1}`).join(",")})`,
      [
        input.workspaceId,
        bridgePayload.projectId,
        bridgePayload.benchmarkId,
        bridgePayload.activationReference,
        bridgePayload.deploymentKey,
        input.epochId,
        set.labelSetId,
        set.labelRoot,
        set.setHash,
        rows.length,
        bridgePayload.invitedCount,
        bridgePayload.acceptedCount,
        bridgePayload.declinedCount,
        bridgePayload.assignedCount,
        bridgePayload.openedCount,
        bridgePayload.completedCount,
        bridgePayload.timedOutCount,
        aggregate.lifecycleRoot,
        aggregate.responseRoot,
        aggregate.adjudicationRoot,
        bridgePayload.reportingMode,
        false,
        false,
        false,
        bridgePayload.schemaVersion,
        canonicalizeRfc8785(bridgePayload),
        sha256Rfc8785(bridgePayload),
        actor,
        bridgePayload.createdAt,
      ],
    );
    await client.query("COMMIT");
    return { ...evidence, bridge: { ...bridgePayload, bridgeHash: sha256Rfc8785(bridgePayload) } };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
