import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { getAddress } from "viem";
import { dbPool } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type Hash = `sha256:${string}`;

const HASH = /^sha256:[0-9a-f]{64}$/u;
const ATOMIC = /^[1-9][0-9]*$/u;
const ROUND = /^(0|[1-9][0-9]*)$/u;

export type HybridReviewCohort = "invited" | "network";
export type HybridReviewChildState = "preparing" | "ready" | "active" | "terminal" | "cancelled";
export type HybridReviewParentState = HybridReviewChildState;

export type HybridReviewChildSeed = {
  cohort: HybridReviewCohort;
  childBindingHash: Hash;
  economicsHash: Hash;
  expertiseHash: Hash;
  admissionPolicyHash: Hash;
  expectedAmountAtomic: string;
  assignmentCount: number;
};

export type HybridReviewParentSeed = {
  workspaceId: string;
  opportunityId: string;
  parentBindingHash: Hash;
  requestProfileHash: Hash;
  audiencePolicyHash: Hash;
  sourceCommitment: Hash;
  suggestionCommitment: Hash;
  children: readonly [HybridReviewChildSeed, HybridReviewChildSeed];
};

export type HybridReviewChildReadyEvidence = {
  sourceKind: "private_paid_assignment" | "public_network_assignment";
  sourceOperationReference: string;
  sourceRunId: string;
  deploymentKey: string;
  chainId: number;
  panelAddress: string;
  roundId: string;
  chainAdmissionPolicyHash: `0x${string}`;
  assignmentEvidenceHash: Hash;
  voucherPreparationHash: Hash;
  settlementBindingHash: Hash;
};

export type PersistedHybridReviewChild = HybridReviewChildSeed &
  Partial<HybridReviewChildReadyEvidence> & {
    childId: string;
    state: HybridReviewChildState;
    transitionRevision: number;
    acceptedCount: number;
    committedCount: number;
    terminalCount: number;
    settlementEvidenceHash?: Hash;
  };

export type PersistedHybridReviewOperation = {
  hybridOperationId: string;
  workspaceId: string;
  opportunityId: string;
  parentBindingHash: Hash;
  requestProfileHash: Hash;
  audiencePolicyHash: Hash;
  sourceCommitment: Hash;
  suggestionCommitment: Hash;
  state: HybridReviewParentState;
  transitionRevision: number;
  preparationEvidenceHash: Hash | null;
  resultEvidenceHash: Hash | null;
  cancellationReasonCode: string | null;
  retentionUntil: Date;
  children: [PersistedHybridReviewChild, PersistedHybridReviewChild];
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Hybrid orchestration evidence is not canonicalizable.");
  return encoded;
}

function sha256(value: unknown): Hash {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function id(prefix: string, hash: Hash) {
  return `${prefix}_${hash.slice("sha256:".length)}`;
}

function text(row: Row | undefined, field: string) {
  const value = row?.[field];
  return value === null || value === undefined ? null : String(value);
}

function number(row: Row | undefined, field: string) {
  const value = Number(row?.[field]);
  if (!Number.isSafeInteger(value)) throw new Error(`Stored ${field} is invalid.`);
  return value;
}

function date(row: Row | undefined, field: string) {
  const value = row?.[field] instanceof Date ? (row[field] as Date) : new Date(String(row?.[field]));
  if (!Number.isFinite(value.getTime())) throw new Error(`Stored ${field} is invalid.`);
  return value;
}

function addCalendarMonths(value: Date, months: number) {
  const result = new Date(value);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0, result.getUTCHours(), result.getUTCMinutes()),
  ).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
}

function childFromRow(row: Row): PersistedHybridReviewChild {
  const sourceKind = text(row, "source_kind") as HybridReviewChildReadyEvidence["sourceKind"] | null;
  return {
    childId: text(row, "child_id")!,
    cohort: text(row, "cohort") as HybridReviewCohort,
    childBindingHash: text(row, "child_binding_hash") as Hash,
    economicsHash: text(row, "economics_hash") as Hash,
    expertiseHash: text(row, "expertise_hash") as Hash,
    admissionPolicyHash: text(row, "admission_policy_hash") as Hash,
    expectedAmountAtomic: text(row, "expected_amount_atomic")!,
    assignmentCount: number(row, "assignment_count"),
    state: text(row, "state") as HybridReviewChildState,
    transitionRevision: number(row, "transition_revision"),
    acceptedCount: number(row, "accepted_count"),
    committedCount: number(row, "committed_count"),
    terminalCount: number(row, "terminal_count"),
    ...(sourceKind
      ? {
          sourceKind,
          sourceOperationReference: text(row, "source_operation_reference")!,
          sourceRunId: text(row, "source_run_id")!,
          deploymentKey: text(row, "deployment_key")!,
          chainId: number(row, "chain_id"),
          panelAddress: text(row, "panel_address")!,
          roundId: text(row, "round_id")!,
          chainAdmissionPolicyHash: text(row, "chain_admission_policy_hash") as `0x${string}`,
          assignmentEvidenceHash: text(row, "assignment_evidence_hash") as Hash,
          voucherPreparationHash: text(row, "voucher_preparation_hash") as Hash,
          settlementBindingHash: text(row, "settlement_binding_hash") as Hash,
          ...(text(row, "settlement_evidence_hash")
            ? { settlementEvidenceHash: text(row, "settlement_evidence_hash") as Hash }
            : {}),
        }
      : {}),
  };
}

function operationFromRows(parent: Row, childRows: Row[]): PersistedHybridReviewOperation {
  const children = childRows.map(childFromRow);
  if (children.length !== 2 || children[0]?.cohort !== "invited" || children[1]?.cohort !== "network") {
    throw new Error("Stored hybrid review operation does not have its exact two cohorts.");
  }
  return {
    hybridOperationId: text(parent, "hybrid_operation_id")!,
    workspaceId: text(parent, "workspace_id")!,
    opportunityId: text(parent, "opportunity_id")!,
    parentBindingHash: text(parent, "parent_binding_hash") as Hash,
    requestProfileHash: text(parent, "request_profile_hash") as Hash,
    audiencePolicyHash: text(parent, "audience_policy_hash") as Hash,
    sourceCommitment: text(parent, "source_commitment") as Hash,
    suggestionCommitment: text(parent, "suggestion_commitment") as Hash,
    state: text(parent, "state") as HybridReviewParentState,
    transitionRevision: number(parent, "transition_revision"),
    preparationEvidenceHash: text(parent, "preparation_evidence_hash") as Hash | null,
    resultEvidenceHash: text(parent, "result_evidence_hash") as Hash | null,
    cancellationReasonCode: text(parent, "cancellation_reason_code"),
    retentionUntil: date(parent, "retention_until"),
    children: [children[0], children[1]],
  };
}

function validateSeed(seed: HybridReviewParentSeed) {
  const hashes = [
    seed.parentBindingHash,
    seed.requestProfileHash,
    seed.audiencePolicyHash,
    seed.sourceCommitment,
    seed.suggestionCommitment,
    ...seed.children.flatMap(child => [
      child.childBindingHash,
      child.economicsHash,
      child.expertiseHash,
      child.admissionPolicyHash,
    ]),
  ];
  if (
    !seed.workspaceId ||
    !seed.opportunityId ||
    hashes.some(hash => !HASH.test(hash)) ||
    seed.children.length !== 2 ||
    seed.children[0].cohort !== "invited" ||
    seed.children[1].cohort !== "network" ||
    seed.children.some(
      child =>
        !ATOMIC.test(child.expectedAmountAtomic) ||
        !Number.isSafeInteger(child.assignmentCount) ||
        child.assignmentCount < 1,
    )
  ) {
    throw new TokenlessServiceError(
      "The hybrid parent or child identity is invalid.",
      409,
      "hybrid_review_binding_invalid",
    );
  }
}

function exactSeed(operation: PersistedHybridReviewOperation, seed: HybridReviewParentSeed) {
  const persisted = {
    workspaceId: operation.workspaceId,
    opportunityId: operation.opportunityId,
    parentBindingHash: operation.parentBindingHash,
    requestProfileHash: operation.requestProfileHash,
    audiencePolicyHash: operation.audiencePolicyHash,
    sourceCommitment: operation.sourceCommitment,
    suggestionCommitment: operation.suggestionCommitment,
    children: operation.children.map(child => ({
      cohort: child.cohort,
      childBindingHash: child.childBindingHash,
      economicsHash: child.economicsHash,
      expertiseHash: child.expertiseHash,
      admissionPolicyHash: child.admissionPolicyHash,
      expectedAmountAtomic: child.expectedAmountAtomic,
      assignmentCount: child.assignmentCount,
    })),
  };
  if (stableJson(persisted) !== stableJson(seed)) {
    throw new TokenlessServiceError(
      "This hybrid operation belongs to different frozen terms.",
      409,
      "hybrid_review_operation_conflict",
    );
  }
}

function exactEvidence(evidence: HybridReviewChildReadyEvidence) {
  let panelAddress: string;
  try {
    panelAddress = getAddress(evidence.panelAddress).toLowerCase();
  } catch {
    throw new TokenlessServiceError("Hybrid child round identity is invalid.", 409, "hybrid_subpanel_not_ready");
  }
  if (
    !evidence.sourceOperationReference ||
    !evidence.sourceRunId ||
    !evidence.deploymentKey ||
    !Number.isSafeInteger(evidence.chainId) ||
    evidence.chainId < 1 ||
    !ROUND.test(evidence.roundId) ||
    !/^0x[0-9a-f]{64}$/u.test(evidence.chainAdmissionPolicyHash) ||
    !HASH.test(evidence.assignmentEvidenceHash) ||
    !HASH.test(evidence.voucherPreparationHash) ||
    !HASH.test(evidence.settlementBindingHash)
  ) {
    throw new TokenlessServiceError("Hybrid child evidence is incomplete.", 409, "hybrid_subpanel_not_ready");
  }
  return { ...evidence, panelAddress };
}

async function receipt(
  client: PoolClient,
  input: {
    hybridOperationId: string;
    childId?: string;
    type:
      | "parent_prepared"
      | "child_ready"
      | "child_liability"
      | "child_terminal"
      | "child_cancelled"
      | "parent_ready"
      | "parent_active"
      | "parent_terminal"
      | "parent_cancelled";
    revision: number;
    body: unknown;
    now: Date;
  },
) {
  const evidenceHash = sha256({
    schemaVersion: "rateloop.hybrid-review-transition-evidence.v1",
    type: input.type,
    body: input.body,
  });
  const receiptHash = sha256({
    schemaVersion: "rateloop.hybrid-review-receipt.v1",
    hybridOperationId: input.hybridOperationId,
    childId: input.childId ?? null,
    type: input.type,
    revision: input.revision,
    evidenceHash,
  });
  await client.query(
    `INSERT INTO tokenless_hybrid_review_receipts
       (receipt_id,hybrid_operation_id,child_id,receipt_type,transition_revision,
        evidence_hash,receipt_hash,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (receipt_hash) DO NOTHING`,
    [
      id("hybrid_receipt", receiptHash),
      input.hybridOperationId,
      input.childId ?? null,
      input.type,
      input.revision,
      evidenceHash,
      receiptHash,
      input.now,
    ],
  );
}

async function loadLocked(client: PoolClient, hybridOperationId: string) {
  const parent = await client.query(
    "SELECT * FROM tokenless_hybrid_review_operations WHERE hybrid_operation_id=$1 FOR UPDATE",
    [hybridOperationId],
  );
  if (!parent.rows[0]) {
    throw new TokenlessServiceError("Hybrid review operation was not found.", 404, "hybrid_review_operation_not_found");
  }
  const children = await client.query(
    `SELECT * FROM tokenless_hybrid_review_children
     WHERE hybrid_operation_id=$1
     ORDER BY CASE cohort WHEN 'invited' THEN 1 ELSE 2 END ASC FOR UPDATE`,
    [hybridOperationId],
  );
  return operationFromRows(parent.rows[0], children.rows);
}

async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
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

export async function ensureHybridReviewOperation(seed: HybridReviewParentSeed, now = new Date()) {
  validateSeed(seed);
  const hybridOperationId = id("hybrid", seed.parentBindingHash);
  return transaction(async client => {
    const retention = await client.query(
      `SELECT evidence_retention_months FROM tokenless_workspace_evidence_retention_policies
       WHERE workspace_id=$1 AND superseded_at IS NULL LIMIT 1 FOR UPDATE`,
      [seed.workspaceId],
    );
    const retentionMonths = number(retention.rows[0], "evidence_retention_months");
    if (retentionMonths < 1) {
      throw new TokenlessServiceError(
        "The workspace hybrid evidence retention policy is unavailable.",
        409,
        "hybrid_review_retention_unavailable",
      );
    }
    const retentionUntil = addCalendarMonths(now, retentionMonths);
    const inserted = await client.query(
      `INSERT INTO tokenless_hybrid_review_operations
        (hybrid_operation_id,workspace_id,opportunity_id,parent_binding_hash,request_profile_hash,
         audience_policy_hash,source_commitment,suggestion_commitment,state,transition_revision,
         retention_until,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'preparing',1,$9,$10,$10)
       ON CONFLICT DO NOTHING RETURNING hybrid_operation_id`,
      [
        hybridOperationId,
        seed.workspaceId,
        seed.opportunityId,
        seed.parentBindingHash,
        seed.requestProfileHash,
        seed.audiencePolicyHash,
        seed.sourceCommitment,
        seed.suggestionCommitment,
        retentionUntil,
        now,
      ],
    );
    const parent = await client.query(
      `SELECT * FROM tokenless_hybrid_review_operations
       WHERE workspace_id=$1 AND opportunity_id=$2 FOR UPDATE`,
      [seed.workspaceId, seed.opportunityId],
    );
    if (!parent.rows[0]) {
      throw new TokenlessServiceError(
        "The hybrid operation conflicts with an existing identity.",
        409,
        "hybrid_review_operation_conflict",
      );
    }
    for (const child of seed.children) {
      await client.query(
        `INSERT INTO tokenless_hybrid_review_children
          (child_id,hybrid_operation_id,cohort,child_binding_hash,economics_hash,expertise_hash,
           admission_policy_hash,expected_amount_atomic,assignment_count,state,transition_revision,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'preparing',1,$10,$10)
         ON CONFLICT DO NOTHING`,
        [
          id(`hybrid_${child.cohort}`, child.childBindingHash),
          text(parent.rows[0], "hybrid_operation_id"),
          child.cohort,
          child.childBindingHash,
          child.economicsHash,
          child.expertiseHash,
          child.admissionPolicyHash,
          child.expectedAmountAtomic,
          child.assignmentCount,
          now,
        ],
      );
    }
    const children = await client.query(
      `SELECT * FROM tokenless_hybrid_review_children
       WHERE hybrid_operation_id=$1
       ORDER BY CASE cohort WHEN 'invited' THEN 1 ELSE 2 END ASC FOR UPDATE`,
      [text(parent.rows[0], "hybrid_operation_id")],
    );
    const operation = operationFromRows(parent.rows[0], children.rows);
    exactSeed(operation, seed);
    if (inserted.rowCount === 1) {
      await receipt(client, {
        hybridOperationId: operation.hybridOperationId,
        type: "parent_prepared",
        revision: 1,
        body: seed,
        now,
      });
    }
    return { operation, replayed: inserted.rowCount !== 1 };
  });
}

export async function recordHybridReviewChildReady(input: {
  hybridOperationId: string;
  cohort: HybridReviewCohort;
  evidence: HybridReviewChildReadyEvidence;
  now?: Date;
}) {
  const evidence = exactEvidence(input.evidence);
  const now = input.now ?? new Date();
  return transaction(async client => {
    const operation = await loadLocked(client, input.hybridOperationId);
    const child = operation.children.find(value => value.cohort === input.cohort)!;
    if (child.state !== "preparing") {
      const persisted = {
        sourceKind: child.sourceKind,
        sourceOperationReference: child.sourceOperationReference,
        sourceRunId: child.sourceRunId,
        deploymentKey: child.deploymentKey,
        chainId: child.chainId,
        panelAddress: child.panelAddress,
        roundId: child.roundId,
        chainAdmissionPolicyHash: child.chainAdmissionPolicyHash,
        assignmentEvidenceHash: child.assignmentEvidenceHash,
        voucherPreparationHash: child.voucherPreparationHash,
        settlementBindingHash: child.settlementBindingHash,
      };
      if (stableJson(persisted) !== stableJson(evidence)) {
        throw new TokenlessServiceError(
          "This hybrid child belongs to different settlement evidence.",
          409,
          "hybrid_review_child_conflict",
        );
      }
      return { child, replayed: true };
    }
    const revision = child.transitionRevision + 1;
    await receipt(client, {
      hybridOperationId: operation.hybridOperationId,
      childId: child.childId,
      type: "child_ready",
      revision,
      body: evidence,
      now,
    });
    await client.query(
      `UPDATE tokenless_hybrid_review_children
       SET source_kind=$1,source_operation_reference=$2,source_run_id=$3,deployment_key=$4,
           chain_id=$5,panel_address=$6,round_id=$7,chain_admission_policy_hash=$8,
           assignment_evidence_hash=$9,voucher_preparation_hash=$10,settlement_binding_hash=$11,
           state='ready',transition_revision=$12,updated_at=$13
       WHERE child_id=$14`,
      [
        evidence.sourceKind,
        evidence.sourceOperationReference,
        evidence.sourceRunId ?? null,
        evidence.deploymentKey,
        evidence.chainId,
        evidence.panelAddress,
        evidence.roundId,
        evidence.chainAdmissionPolicyHash,
        evidence.assignmentEvidenceHash,
        evidence.voucherPreparationHash,
        evidence.settlementBindingHash,
        revision,
        now,
        child.childId,
      ],
    );
    const updated = await loadLocked(client, operation.hybridOperationId);
    return { child: updated.children.find(value => value.cohort === input.cohort)!, replayed: false };
  });
}

export async function completeHybridReviewPreparation(input: {
  hybridOperationId: string;
  preparationEvidenceHash: Hash;
  now?: Date;
}) {
  if (!HASH.test(input.preparationEvidenceHash)) {
    throw new TokenlessServiceError("Hybrid preparation evidence is invalid.", 409, "hybrid_review_binding_invalid");
  }
  const now = input.now ?? new Date();
  return transaction(async client => {
    const operation = await loadLocked(client, input.hybridOperationId);
    if (operation.state !== "preparing") {
      if (operation.preparationEvidenceHash !== input.preparationEvidenceHash) {
        throw new TokenlessServiceError(
          "This hybrid operation belongs to different preparation evidence.",
          409,
          "hybrid_review_operation_conflict",
        );
      }
      return { operation, replayed: true };
    }
    if (operation.children.some(child => child.state !== "ready")) {
      throw new TokenlessServiceError(
        "Both hybrid children must be ready before the parent.",
        409,
        "hybrid_subpanel_not_ready",
        true,
      );
    }
    const [invited, network] = operation.children;
    if (
      invited.deploymentKey === network.deploymentKey &&
      invited.chainId === network.chainId &&
      invited.panelAddress === network.panelAddress &&
      invited.roundId === network.roundId
    ) {
      throw new TokenlessServiceError(
        "Hybrid cohorts must bind two distinct paid rounds.",
        409,
        "hybrid_round_identity_conflict",
      );
    }
    const revision = operation.transitionRevision + 1;
    await receipt(client, {
      hybridOperationId: operation.hybridOperationId,
      type: "parent_ready",
      revision,
      body: { preparationEvidenceHash: input.preparationEvidenceHash },
      now,
    });
    await client.query(
      `UPDATE tokenless_hybrid_review_operations
       SET state='ready',transition_revision=$1,preparation_evidence_hash=$2,updated_at=$3
       WHERE hybrid_operation_id=$4`,
      [revision, input.preparationEvidenceHash, now, operation.hybridOperationId],
    );
    return { operation: await loadLocked(client, operation.hybridOperationId), replayed: false };
  });
}

export async function recordHybridReviewChildLiability(input: {
  hybridOperationId: string;
  cohort: HybridReviewCohort;
  acceptedCount: number;
  committedCount: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return transaction(async client => {
    const operation = await loadLocked(client, input.hybridOperationId);
    if (operation.state === "cancelled") {
      throw new TokenlessServiceError("The hybrid operation was cancelled.", 409, "hybrid_review_cancelled");
    }
    const child = operation.children.find(value => value.cohort === input.cohort)!;
    if (
      !["ready", "active"].includes(child.state) ||
      !Number.isSafeInteger(input.acceptedCount) ||
      !Number.isSafeInteger(input.committedCount) ||
      input.acceptedCount < child.acceptedCount ||
      input.committedCount < child.committedCount ||
      input.committedCount > input.acceptedCount ||
      input.acceptedCount > child.assignmentCount
    ) {
      throw new TokenlessServiceError(
        "Hybrid child liability transition is invalid.",
        409,
        "hybrid_review_liability_conflict",
      );
    }
    if (input.acceptedCount === child.acceptedCount && input.committedCount === child.committedCount) {
      return { operation, replayed: true };
    }
    const childRevision = child.transitionRevision + 1;
    await receipt(client, {
      hybridOperationId: operation.hybridOperationId,
      childId: child.childId,
      type: "child_liability",
      revision: childRevision,
      body: { acceptedCount: input.acceptedCount, committedCount: input.committedCount },
      now,
    });
    await client.query(
      `UPDATE tokenless_hybrid_review_children
       SET state='active',accepted_count=$1,committed_count=$2,transition_revision=$3,updated_at=$4
       WHERE child_id=$5`,
      [input.acceptedCount, input.committedCount, childRevision, now, child.childId],
    );
    if (operation.state === "ready") {
      const parentRevision = operation.transitionRevision + 1;
      await receipt(client, {
        hybridOperationId: operation.hybridOperationId,
        type: "parent_active",
        revision: parentRevision,
        body: { cohort: input.cohort, acceptedCount: input.acceptedCount, committedCount: input.committedCount },
        now,
      });
      await client.query(
        `UPDATE tokenless_hybrid_review_operations
         SET state='active',transition_revision=$1,updated_at=$2
         WHERE hybrid_operation_id=$3`,
        [parentRevision, now, operation.hybridOperationId],
      );
    }
    return { operation: await loadLocked(client, operation.hybridOperationId), replayed: false };
  });
}

export async function recordHybridReviewChildTerminal(input: {
  hybridOperationId: string;
  cohort: HybridReviewCohort;
  terminalCount: number;
  settlementEvidenceHash: Hash;
  parentResultEvidenceHash?: Hash;
  now?: Date;
}) {
  if (
    !HASH.test(input.settlementEvidenceHash) ||
    (input.parentResultEvidenceHash !== undefined && !HASH.test(input.parentResultEvidenceHash))
  ) {
    throw new TokenlessServiceError("Hybrid terminal evidence is invalid.", 409, "hybrid_review_binding_invalid");
  }
  const now = input.now ?? new Date();
  return transaction(async client => {
    const operation = await loadLocked(client, input.hybridOperationId);
    const child = operation.children.find(value => value.cohort === input.cohort)!;
    if (child.state === "terminal") {
      if (
        child.terminalCount !== input.terminalCount ||
        child.settlementEvidenceHash !== input.settlementEvidenceHash
      ) {
        throw new TokenlessServiceError(
          "This hybrid child belongs to different terminal evidence.",
          409,
          "hybrid_review_child_conflict",
        );
      }
      return { operation, replayed: true };
    }
    if (
      !["ready", "active"].includes(child.state) ||
      input.terminalCount !== child.assignmentCount ||
      (input.parentResultEvidenceHash &&
        operation.children.some(value => value.cohort !== input.cohort && value.state !== "terminal"))
    ) {
      throw new TokenlessServiceError(
        "Hybrid child terminal transition is incomplete.",
        409,
        "hybrid_review_terminal_incomplete",
      );
    }
    const childRevision = child.transitionRevision + 1;
    await receipt(client, {
      hybridOperationId: operation.hybridOperationId,
      childId: child.childId,
      type: "child_terminal",
      revision: childRevision,
      body: {
        terminalCount: input.terminalCount,
        settlementEvidenceHash: input.settlementEvidenceHash,
      },
      now,
    });
    await client.query(
      `UPDATE tokenless_hybrid_review_children
       SET state='terminal',terminal_count=$1,settlement_evidence_hash=$2,
           transition_revision=$3,updated_at=$4 WHERE child_id=$5`,
      [input.terminalCount, input.settlementEvidenceHash, childRevision, now, child.childId],
    );
    let updated = await loadLocked(client, operation.hybridOperationId);
    if (updated.children.every(value => value.state === "terminal")) {
      if (!input.parentResultEvidenceHash) {
        throw new TokenlessServiceError(
          "The final hybrid child requires aggregate result evidence.",
          409,
          "hybrid_review_terminal_incomplete",
        );
      }
      const parentRevision = updated.transitionRevision + 1;
      await receipt(client, {
        hybridOperationId: operation.hybridOperationId,
        type: "parent_terminal",
        revision: parentRevision,
        body: { resultEvidenceHash: input.parentResultEvidenceHash },
        now,
      });
      await client.query(
        `UPDATE tokenless_hybrid_review_operations
         SET state='terminal',result_evidence_hash=$1,transition_revision=$2,updated_at=$3
         WHERE hybrid_operation_id=$4`,
        [input.parentResultEvidenceHash, parentRevision, now, operation.hybridOperationId],
      );
      updated = await loadLocked(client, operation.hybridOperationId);
    }
    return { operation: updated, replayed: false };
  });
}

export async function cancelHybridReviewBeforeLiability(input: {
  hybridOperationId: string;
  reasonCode: string;
  releaseChildren: (children: readonly PersistedHybridReviewChild[]) => Promise<void>;
  now?: Date;
}) {
  if (!/^[a-z0-9_]{1,128}$/u.test(input.reasonCode)) {
    throw new TokenlessServiceError(
      "Hybrid cancellation reason is invalid.",
      400,
      "hybrid_review_cancellation_invalid",
    );
  }
  const now = input.now ?? new Date();
  return transaction(async client => {
    const operation = await loadLocked(client, input.hybridOperationId);
    if (operation.state === "cancelled") return { operation, replayed: true };
    if (
      operation.state === "terminal" ||
      operation.children.some(child => child.acceptedCount > 0 || child.committedCount > 0)
    ) {
      throw new TokenlessServiceError(
        "A hybrid operation cannot cancel after any child accepts or commits.",
        409,
        "hybrid_review_cancellation_blocked",
      );
    }
    await input.releaseChildren(operation.children);
    for (const child of operation.children) {
      if (child.state === "cancelled") continue;
      const childRevision = child.transitionRevision + 1;
      await receipt(client, {
        hybridOperationId: operation.hybridOperationId,
        childId: child.childId,
        type: "child_cancelled",
        revision: childRevision,
        body: { reasonCode: input.reasonCode },
        now,
      });
      await client.query(
        `UPDATE tokenless_hybrid_review_children
         SET state='cancelled',transition_revision=$1,updated_at=$2 WHERE child_id=$3`,
        [childRevision, now, child.childId],
      );
    }
    const revision = operation.transitionRevision + 1;
    await receipt(client, {
      hybridOperationId: operation.hybridOperationId,
      type: "parent_cancelled",
      revision,
      body: { reasonCode: input.reasonCode },
      now,
    });
    await client.query(
      `UPDATE tokenless_hybrid_review_operations
       SET state='cancelled',transition_revision=$1,cancellation_reason_code=$2,updated_at=$3
       WHERE hybrid_operation_id=$4`,
      [revision, input.reasonCode, now, operation.hybridOperationId],
    );
    return { operation: await loadLocked(client, operation.hybridOperationId), replayed: false };
  });
}

export const __hybridReviewOrchestrationTestUtils = { sha256, stableJson };
