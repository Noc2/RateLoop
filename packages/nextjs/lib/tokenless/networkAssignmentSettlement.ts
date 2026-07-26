import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { getAddress } from "viem";
import { dbPool } from "~~/lib/db";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import { assuranceReviewerKey, getAssuranceResponseKeyrings } from "~~/lib/tokenless/assuranceResponses";
import { type RaterSettlementSnapshot, tokenlessCommitKey } from "~~/lib/tokenless/rater/settlementRecovery";
import { getRaterSettlementSnapshot } from "~~/lib/tokenless/raterSettlementService";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type Hash = `sha256:${string}`;

const HASH = /^sha256:[0-9a-f]{64}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const UNSIGNED = /^(0|[1-9][0-9]*)$/u;
const PRE_SUBMISSION_LOCAL_COMMIT_STATES = ["prepared", "signed", "retry"] as const;
const FINALIZING_LOCAL_COMMIT_STATES = ["submitted", "confirmed"] as const;
const ACTIVE_RECOVERY_WORK_STATES = ["pending", "retry", "processing"] as const;
const RECOVERY_SCHEDULING_GRACE_MS = 15 * 60 * 1_000;
const RECOVERABLE_LOCAL_COMMIT_STATES = [
  ...PRE_SUBMISSION_LOCAL_COMMIT_STATES,
  ...FINALIZING_LOCAL_COMMIT_STATES,
] as const;

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function integer(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value)) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function date(row: Row | undefined, key: string) {
  const value = row?.[key] instanceof Date ? (row[key] as Date) : new Date(String(row?.[key]));
  if (!Number.isFinite(value.getTime())) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function commitBlocksVoucherExpiry(row: Row | undefined, now: Date) {
  const state = text(row, "state");
  if ((FINALIZING_LOCAL_COMMIT_STATES as readonly string[]).includes(state ?? "")) return true;
  if (!(PRE_SUBMISSION_LOCAL_COMMIT_STATES as readonly string[]).includes(state ?? "")) return false;
  if (date(row, "updated_at").getTime() > now.getTime() - RECOVERY_SCHEDULING_GRACE_MS) return true;
  return (ACTIVE_RECOVERY_WORK_STATES as readonly string[]).includes(text(row, "recovery_state") ?? "");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error("Network settlement evidence is not canonicalizable.");
  return result;
}

function sha256(value: unknown): Hash {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function parseObject(value: unknown, field: string) {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`Stored ${field} is invalid.`);
  }
}

function unsigned(value: unknown, field: string) {
  const result = String(value ?? "");
  if (!UNSIGNED.test(result)) throw new Error(`Stored ${field} is invalid.`);
  return result;
}

export type ExactNetworkRoundBinding = {
  caseId: string;
  operationKey: string;
  deploymentKey: string;
  chainId: number;
  panelAddress: string;
  roundId: string;
  contentId: string;
  admissionPolicyHash: string;
  roundTermsHash: Hash;
  totalFundedAtomic: string;
  maximumCommits: number;
  voucherDeadline?: Date;
};

export async function loadExactNetworkRoundBindings(
  client: Pick<PoolClient, "query">,
  input: {
    workspaceId: string;
    runId: string;
    audiencePolicyHash: Hash;
    audiencePolicyJson: string;
    targetCount: number;
    now: Date;
  },
): Promise<ExactNetworkRoundBinding[]> {
  const frozenExpected = freezeAdmissionPolicy(JSON.parse(input.audiencePolicyJson));
  if (
    frozenExpected.policy.reviewerSource !== "rateloop_network" ||
    frozenExpected.policy.compensation !== "paid" ||
    `sha256:${frozenExpected.admissionPolicyHash.slice(2)}` !== input.audiencePolicyHash
  ) {
    throw new TokenlessServiceError(
      "The frozen network policy does not match its admission identity.",
      409,
      "network_round_binding_invalid",
    );
  }
  const result = await client.query(
    `SELECT rc.case_id,rc.content_id,rc.admission_policy_hash,rc.round_id,rc.round_status,
            rc.network_operation_key,rc.network_deployment_key,rc.network_chain_id,
            rc.network_panel_address,rc.network_round_id,
            e.operation_key,e.deployment_key,e.chain_id,e.panel_address,e.round_terms_json,
            e.total_funded_atomic,e.state AS execution_state,e.confirmed_at,
            own.workspace_id AS operation_workspace_id,q.terms_json,
            voucher.content_id AS voucher_content_id,
            voucher.admission_policy_hash AS voucher_admission_policy_hash,
            voucher.maximum_commits,voucher.voucher_deadline,voucher.status AS voucher_status
     FROM tokenless_assurance_run_cases rc
     LEFT JOIN tokenless_chain_executions e
       ON e.operation_key=rc.network_operation_key
      AND e.deployment_key=rc.network_deployment_key
      AND e.chain_id=rc.network_chain_id
      AND lower(e.panel_address)=lower(rc.network_panel_address)
      AND e.round_id=rc.network_round_id
      AND lower(e.content_id)=lower(rc.content_id)
     LEFT JOIN tokenless_ask_ownership own ON own.operation_key=e.operation_key
     LEFT JOIN tokenless_question_records q ON q.question_id=own.question_id
     LEFT JOIN tokenless_voucher_rounds voucher
       ON voucher.chain_id=e.chain_id AND voucher.panel_address=e.panel_address
      AND voucher.round_id=e.round_id
     WHERE rc.run_id=$1 ORDER BY rc.position ASC`,
    [input.runId],
  );
  if (!result.rowCount) {
    throw new TokenlessServiceError("The network run has no funded cases.", 409, "network_round_binding_pending", true);
  }
  if (new Set(result.rows.map(value => text(value as Row, "case_id"))).size !== result.rows.length) {
    throw new TokenlessServiceError(
      "A network run case resolved to more than one funded round.",
      409,
      "network_round_binding_invalid",
    );
  }
  return result.rows.map(value => {
    const row = value as Row;
    if (
      !text(row, "operation_key") ||
      !text(row, "deployment_key") ||
      text(row, "network_operation_key") !== text(row, "operation_key") ||
      text(row, "network_deployment_key") !== text(row, "deployment_key") ||
      integer(row, "network_chain_id") !== integer(row, "chain_id") ||
      !sameAddress(row.network_panel_address, row.panel_address) ||
      text(row, "network_round_id") !== text(row, "round_id") ||
      !row.round_terms_json ||
      !row.terms_json ||
      !text(row, "voucher_content_id")
    ) {
      throw new TokenlessServiceError(
        "Every selected network case requires one exact confirmed funded round.",
        409,
        "network_round_binding_pending",
        true,
      );
    }
    const roundTerms = parseObject(row.round_terms_json, "network round terms");
    const productTerms = parseObject(row.terms_json, "network product terms");
    const audiencePolicy = productTerms.audiencePolicy;
    const frozenActual = freezeAdmissionPolicy(audiencePolicy);
    const productEconomics = productTerms.economics as
      | {
          bounty?: { fundedAtomic?: unknown };
          fee?: { fundedAtomic?: unknown };
          attemptReserve?: { fundedAtomic?: unknown };
          totalFundedAtomic?: unknown;
        }
      | undefined;
    const productPanel = productTerms.panel as { requestedSize?: unknown } | undefined;
    const totalFundedAtomic = unsigned(row.total_funded_atomic, "network funded amount");
    const bounty = BigInt(unsigned(roundTerms.bountyAmount, "network bounty amount"));
    const fee = BigInt(unsigned(roundTerms.feeAmount, "network fee amount"));
    const reserve = BigInt(unsigned(roundTerms.attemptReserve, "network attempt reserve"));
    const maximumCommits = integer(row, "maximum_commits");
    const roundMaximumCommits = Number(roundTerms.maximumCommits);
    const admissionPolicyHash = text(row, "admission_policy_hash")?.toLowerCase() ?? "";
    if (
      text(row, "execution_state") !== "confirmed" ||
      !row.confirmed_at ||
      text(row, "operation_workspace_id") !== input.workspaceId ||
      !["open", "submitted", "revealable", "settling"].includes(text(row, "round_status") ?? "") ||
      text(row, "voucher_status") !== "open" ||
      date(row, "voucher_deadline") <= input.now ||
      maximumCommits !== input.targetCount ||
      roundMaximumCommits !== input.targetCount ||
      text(row, "content_id")?.toLowerCase() !== text(row, "voucher_content_id")?.toLowerCase() ||
      admissionPolicyHash !== text(row, "voucher_admission_policy_hash")?.toLowerCase() ||
      admissionPolicyHash !== frozenExpected.admissionPolicyHash.toLowerCase() ||
      frozenActual.policyJson !== frozenExpected.policyJson ||
      frozenActual.admissionPolicyHash.toLowerCase() !== admissionPolicyHash ||
      frozenActual.policy.reviewerSource !== "rateloop_network" ||
      frozenActual.policy.compensation !== "paid" ||
      String(productEconomics?.bounty?.fundedAtomic ?? "") !== bounty.toString() ||
      String(productEconomics?.fee?.fundedAtomic ?? "") !== fee.toString() ||
      String(productEconomics?.attemptReserve?.fundedAtomic ?? "") !== reserve.toString() ||
      String(productEconomics?.totalFundedAtomic ?? "") !== totalFundedAtomic ||
      Number(productPanel?.requestedSize) !== input.targetCount ||
      BigInt(totalFundedAtomic) !== bounty + fee + reserve
    ) {
      throw new TokenlessServiceError(
        "Every selected network case requires one exact confirmed funded round.",
        409,
        "network_round_binding_pending",
        true,
      );
    }
    const panelAddress = getAddress(text(row, "panel_address")!).toLowerCase();
    const contentId = text(row, "content_id")?.toLowerCase() ?? "";
    if (!BYTES32.test(contentId) || !BYTES32.test(admissionPolicyHash)) {
      throw new TokenlessServiceError(
        "The funded network round identity is invalid.",
        409,
        "network_round_binding_invalid",
      );
    }
    return {
      caseId: text(row, "case_id")!,
      operationKey: text(row, "operation_key")!,
      deploymentKey: text(row, "deployment_key")!,
      chainId: integer(row, "chain_id"),
      panelAddress,
      roundId: text(row, "round_id")!,
      contentId,
      admissionPolicyHash,
      roundTermsHash: sha256(roundTerms),
      totalFundedAtomic,
      maximumCommits,
      voucherDeadline: date(row, "voucher_deadline"),
    };
  });
}

type NetworkSelectionIdentity = {
  assignmentId: string;
  raterId: string;
  runId: string;
  subpanelId: string;
  selectionBatchId: string;
  integrityProvenanceHash: Hash;
  integrityReviewerLookup: string;
};

function integrityReviewerCommitment(
  input: Pick<NetworkSelectionIdentity, "assignmentId" | "runId" | "integrityReviewerLookup">,
) {
  return sha256({
    schemaVersion: "rateloop.network-integrity-reviewer-commitment.v1",
    assignmentId: input.assignmentId,
    runId: input.runId,
    reviewerLookup: input.integrityReviewerLookup,
  });
}

function reviewerRoundReservationHash(
  input: Pick<NetworkSelectionIdentity, "raterId"> & { round: ExactNetworkRoundBinding },
) {
  return sha256({
    schemaVersion: "rateloop.network-reviewer-round-reservation.v1",
    raterId: input.raterId,
    round: {
      deploymentKey: input.round.deploymentKey,
      chainId: input.round.chainId,
      panelAddress: getAddress(input.round.panelAddress),
      roundId: input.round.roundId,
    },
  });
}

function selectionBindingHash(
  input: Omit<NetworkSelectionIdentity, "integrityReviewerLookup"> & {
    integrityReviewerCommitment: Hash;
    reviewerRoundReservationHash: Hash;
    round: ExactNetworkRoundBinding;
  },
) {
  return sha256({
    schemaVersion: "rateloop.network-selection-binding.v1",
    assignment: {
      assignmentId: input.assignmentId,
      runId: input.runId,
      caseId: input.round.caseId,
      subpanelId: input.subpanelId,
    },
    selection: {
      batchId: input.selectionBatchId,
      integrityProvenanceHash: input.integrityProvenanceHash,
      reviewerCommitment: input.integrityReviewerCommitment,
      reviewerRoundReservationHash: input.reviewerRoundReservationHash,
    },
    round: {
      caseId: input.round.caseId,
      operationKey: input.round.operationKey,
      deploymentKey: input.round.deploymentKey,
      chainId: input.round.chainId,
      panelAddress: input.round.panelAddress,
      roundId: input.round.roundId,
      contentId: input.round.contentId,
      admissionPolicyHash: input.round.admissionPolicyHash,
      roundTermsHash: input.round.roundTermsHash,
      totalFundedAtomic: input.round.totalFundedAtomic,
      maximumCommits: input.round.maximumCommits,
    },
  });
}

async function insertReceipt(
  client: Pick<PoolClient, "query">,
  input: {
    bindingId: string;
    receiptType: "selection_bound" | "voucher_issued" | "voucher_consumed" | "settlement_terminal";
    revision: number;
    payload: Record<string, unknown>;
    now: Date;
  },
) {
  const payload = { schemaVersion: "rateloop.network-assignment-settlement-receipt.v1", ...input.payload };
  await client.query(
    `INSERT INTO tokenless_network_assignment_settlement_receipts
     (receipt_id,binding_id,receipt_type,transition_revision,receipt_json,receipt_hash,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      `nasr_${randomUUID().replaceAll("-", "")}`,
      input.bindingId,
      input.receiptType,
      input.revision,
      stableJson(payload),
      sha256(payload),
      input.now,
    ],
  );
}

export async function bindSelectedNetworkAssignment(
  client: Pick<PoolClient, "query">,
  input: NetworkSelectionIdentity & {
    rounds: readonly ExactNetworkRoundBinding[];
    now: Date;
  },
) {
  if (!HASH.test(input.integrityProvenanceHash) || !input.integrityReviewerLookup || !input.rounds.length) {
    throw new Error("Selected network assignment identity is incomplete.");
  }
  const hashes: Hash[] = [];
  const reviewerCommitment = integrityReviewerCommitment(input);
  for (const round of input.rounds) {
    const roundReservationHash = reviewerRoundReservationHash({ ...input, round });
    const bindingHash = selectionBindingHash({
      ...input,
      integrityReviewerCommitment: reviewerCommitment,
      reviewerRoundReservationHash: roundReservationHash,
      round,
    });
    const bindingId = `nas_${randomUUID().replaceAll("-", "")}`;
    await client.query(
      `INSERT INTO tokenless_network_assignment_settlements
       (binding_id,assignment_id,run_id,case_id,operation_key,selection_batch_id,
        subpanel_id,selection_binding_hash,integrity_provenance_hash,integrity_reviewer_commitment,
        reviewer_round_reservation_hash,deployment_key,chain_id,panel_address,round_id,content_id,admission_policy_hash,
        round_terms_hash,total_funded_atomic,maximum_commits,state,transition_revision,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
               'selected',1,$21,$21)`,
      [
        bindingId,
        input.assignmentId,
        input.runId,
        round.caseId,
        round.operationKey,
        input.selectionBatchId,
        input.subpanelId,
        bindingHash,
        input.integrityProvenanceHash,
        reviewerCommitment,
        roundReservationHash,
        round.deploymentKey,
        round.chainId,
        round.panelAddress,
        round.roundId,
        round.contentId,
        round.admissionPolicyHash,
        round.roundTermsHash,
        round.totalFundedAtomic,
        round.maximumCommits,
        input.now,
      ],
    );
    await insertReceipt(client, {
      bindingId,
      receiptType: "selection_bound",
      revision: 1,
      payload: {
        bindingId,
        assignmentId: input.assignmentId,
        selectionBindingHash: bindingHash,
        selectionBatchId: input.selectionBatchId,
        integrityProvenanceHash: input.integrityProvenanceHash,
        integrityReviewerCommitment: reviewerCommitment,
        reviewerRoundReservationHash: roundReservationHash,
        round,
        selectedAt: input.now.toISOString(),
      },
      now: input.now,
    });
    hashes.push(bindingHash);
  }
  return {
    marker: `selection:${input.selectionBatchId}:${sha256({
      assignmentId: input.assignmentId,
      bindings: hashes,
    }).slice("sha256:".length)}`,
    selectionBindingHashes: hashes,
  };
}

export type NetworkVoucherSelection = {
  bindingId: string;
  assignmentId: string;
  selectionBindingHash: Hash;
  operationKey: string;
  deploymentKey: string;
  chainId: number;
  panelAddress: string;
  roundId: string;
  contentId: string;
  admissionPolicyHash: string;
  integrity: Record<string, unknown>;
};

export async function loadExactNetworkVoucherSelection(
  client: Pick<PoolClient, "query">,
  input: {
    principalId: string;
    assignmentId: string;
    selectionBindingHash: Hash;
    chainId: number;
    panelAddress: string;
    roundId: string;
    contentId: string;
    admissionPolicyHash: string;
    now: Date;
  },
): Promise<NetworkVoucherSelection> {
  const result = await client.query(
    `SELECT settlement.*,assignment.integrity_provenance_json,
            assignment.integrity_provenance_hash AS assignment_integrity_provenance_hash,
            assignment.integrity_reviewer_lookup AS assignment_integrity_reviewer_lookup,
            assignment.run_id AS assignment_run_id,assignment.subpanel_id AS assignment_subpanel_id,
            assignment.selection_batch_id AS assignment_selection_batch_id,
            assignment.rater_id,profile.principal_id,assignment.status AS assignment_status,
            assignment.reservation_expires_at,assignment.assignment_expires_at,
            run.status AS run_status,
            execution.operation_key AS execution_operation_key,
            execution.deployment_key AS execution_deployment_key,
            execution.chain_id AS execution_chain_id,
            execution.panel_address AS execution_panel_address,
            execution.round_id AS execution_round_id,
            execution.content_id AS execution_content_id,
            execution.state AS execution_state,
            execution.round_terms_json AS execution_round_terms_json,
            execution.total_funded_atomic AS execution_total_funded_atomic,
            voucher.maximum_commits AS voucher_maximum_commits,
            voucher.content_id AS voucher_content_id,
            voucher.admission_policy_hash AS voucher_admission_policy_hash,
            voucher.voucher_deadline,voucher.status AS voucher_status,
            reachability.state AS reachability_state,
            opportunity.status AS opportunity_status,
            lifecycle.state AS opportunity_lifecycle_state,
            question.visibility AS question_visibility,
            question.data_classification AS question_data_classification,
            question.moderation_status AS question_moderation_status,
            question.confirmed_no_sensitive_data,
            content.moderation_status AS content_moderation_status
     FROM tokenless_network_assignment_settlements settlement
     JOIN tokenless_assurance_assignments assignment
       ON assignment.assignment_id=settlement.assignment_id
      AND assignment.run_id=settlement.run_id
      AND assignment.subpanel_id=settlement.subpanel_id
     JOIN tokenless_assurance_runs run ON run.run_id=assignment.run_id
     JOIN tokenless_rater_profiles profile ON profile.rater_id=assignment.rater_id
     JOIN tokenless_chain_executions execution
       ON execution.operation_key=settlement.operation_key
      AND execution.deployment_key=settlement.deployment_key
      AND execution.chain_id=settlement.chain_id
      AND lower(execution.panel_address)=lower(settlement.panel_address)
      AND execution.round_id=settlement.round_id
      AND lower(execution.content_id)=lower(settlement.content_id)
     JOIN tokenless_voucher_rounds voucher
       ON voucher.chain_id=settlement.chain_id
      AND lower(voucher.panel_address)=lower(settlement.panel_address)
      AND voucher.round_id=settlement.round_id
     JOIN tokenless_public_network_review_bindings reachability
       ON reachability.state='audience_ready'
      AND reachability.operation_key=settlement.operation_key
      AND reachability.run_id=settlement.run_id
      AND reachability.case_id=settlement.case_id
      AND reachability.deployment_key=settlement.deployment_key
      AND reachability.chain_id=settlement.chain_id
      AND lower(reachability.panel_address)=lower(settlement.panel_address)
      AND reachability.round_id=settlement.round_id
      AND lower(reachability.product_content_id)=lower(settlement.content_id)
      AND lower(reachability.admission_policy_hash)=lower(settlement.admission_policy_hash)
      AND reachability.round_terms_hash=settlement.round_terms_hash
      AND reachability.total_funded_atomic=settlement.total_funded_atomic
      AND reachability.maximum_commits=settlement.maximum_commits
     JOIN tokenless_agent_review_opportunities opportunity
       ON opportunity.workspace_id=reachability.workspace_id
      AND opportunity.opportunity_id=reachability.opportunity_id
     JOIN tokenless_agent_review_opportunity_lifecycles lifecycle
       ON lifecycle.workspace_id=opportunity.workspace_id
      AND lifecycle.opportunity_id=opportunity.opportunity_id
     JOIN tokenless_ask_ownership ownership
       ON ownership.operation_key=settlement.operation_key
      AND ownership.workspace_id=reachability.workspace_id
     JOIN tokenless_question_records question
       ON question.question_id=ownership.question_id
      AND lower(question.content_id)=lower(settlement.content_id)
     JOIN tokenless_content_records content ON content.content_id=question.content_id
     WHERE settlement.assignment_id=$1
       AND settlement.chain_id=$2 AND lower(settlement.panel_address)=lower($3)
       AND settlement.round_id=$4 AND lower(settlement.content_id)=lower($5)
     LIMIT 1 FOR UPDATE OF run,assignment,execution,voucher,settlement,reachability,opportunity,lifecycle,ownership,question,content`,
    [input.assignmentId, input.chainId, input.panelAddress, input.roundId, input.contentId],
  );
  const row = result.rows[0] as Row | undefined;
  const activeUntil = row
    ? text(row, "assignment_status") === "accepted"
      ? date(row, "assignment_expires_at")
      : date(row, "reservation_expires_at")
    : null;
  const currentRoundTermsHash = row?.execution_round_terms_json
    ? sha256(parseObject(row.execution_round_terms_json, "network round terms"))
    : null;
  if (
    !row ||
    !activeUntil ||
    text(row, "principal_id") !== input.principalId ||
    !["frozen", "recruiting", "collecting"].includes(text(row, "run_status") ?? "") ||
    text(row, "assignment_status") !== "accepted" ||
    activeUntil <= input.now ||
    text(row, "state") !== "selected" ||
    text(row, "operation_key") !== text(row, "execution_operation_key") ||
    text(row, "deployment_key") !== text(row, "execution_deployment_key") ||
    integer(row, "execution_chain_id") !== input.chainId ||
    getAddress(text(row, "panel_address")!) !== getAddress(input.panelAddress) ||
    getAddress(text(row, "execution_panel_address")!) !== getAddress(input.panelAddress) ||
    text(row, "round_id") !== text(row, "execution_round_id") ||
    text(row, "content_id")?.toLowerCase() !== text(row, "execution_content_id")?.toLowerCase() ||
    text(row, "execution_state") !== "confirmed" ||
    currentRoundTermsHash !== text(row, "round_terms_hash") ||
    text(row, "execution_total_funded_atomic") !== text(row, "total_funded_atomic") ||
    integer(row, "voucher_maximum_commits") !== integer(row, "maximum_commits") ||
    text(row, "voucher_content_id")?.toLowerCase() !== text(row, "content_id")?.toLowerCase() ||
    text(row, "voucher_admission_policy_hash")?.toLowerCase() !== text(row, "admission_policy_hash")?.toLowerCase() ||
    text(row, "voucher_status") !== "open" ||
    text(row, "reachability_state") !== "audience_ready" ||
    text(row, "question_visibility") !== "public" ||
    !["public", "synthetic", "redacted"].includes(text(row, "question_data_classification") ?? "") ||
    text(row, "question_moderation_status") !== "approved" ||
    row.confirmed_no_sensitive_data !== true ||
    text(row, "content_moderation_status") !== "approved" ||
    date(row, "voucher_deadline") <= input.now ||
    text(row, "selection_binding_hash") !== input.selectionBindingHash ||
    text(row, "admission_policy_hash")?.toLowerCase() !== input.admissionPolicyHash.toLowerCase() ||
    text(row, "integrity_provenance_hash") !== text(row, "assignment_integrity_provenance_hash")
  ) {
    throw new TokenlessServiceError(
      "The voucher request does not match an active selected network seat.",
      409,
      "network_selection_binding_mismatch",
    );
  }
  const integrity = parseObject(row.integrity_provenance_json, "network integrity provenance");
  if (sha256(integrity) !== text(row, "integrity_provenance_hash")) {
    throw new TokenlessServiceError(
      "The selected network integrity evidence has changed.",
      409,
      "network_selection_binding_mismatch",
    );
  }
  const exactRound = {
    caseId: text(row, "case_id")!,
    operationKey: text(row, "operation_key")!,
    deploymentKey: text(row, "deployment_key")!,
    chainId: integer(row, "chain_id"),
    panelAddress: text(row, "panel_address")!,
    roundId: text(row, "round_id")!,
    contentId: text(row, "content_id")!,
    admissionPolicyHash: text(row, "admission_policy_hash")!,
    roundTermsHash: text(row, "round_terms_hash") as Hash,
    totalFundedAtomic: text(row, "total_funded_atomic")!,
    maximumCommits: integer(row, "maximum_commits"),
  };
  const identity = {
    assignmentId: input.assignmentId,
    raterId: text(row, "rater_id")!,
    runId: text(row, "assignment_run_id")!,
    subpanelId: text(row, "assignment_subpanel_id")!,
    selectionBatchId: text(row, "assignment_selection_batch_id")!,
    integrityProvenanceHash: text(row, "integrity_provenance_hash") as Hash,
    integrityReviewerLookup: text(row, "assignment_integrity_reviewer_lookup")!,
  };
  const reviewerCommitment = integrityReviewerCommitment(identity);
  const reservationHash = reviewerRoundReservationHash({ ...identity, round: exactRound });
  if (
    reviewerCommitment !== text(row, "integrity_reviewer_commitment") ||
    reservationHash !== text(row, "reviewer_round_reservation_hash") ||
    selectionBindingHash({
      ...identity,
      integrityReviewerCommitment: reviewerCommitment,
      reviewerRoundReservationHash: reservationHash,
      round: exactRound,
    }) !== text(row, "selection_binding_hash")
  ) {
    throw new TokenlessServiceError(
      "The selected network seat cryptographic binding is inconsistent.",
      409,
      "network_selection_binding_mismatch",
    );
  }
  return {
    bindingId: text(row, "binding_id")!,
    assignmentId: input.assignmentId,
    selectionBindingHash: input.selectionBindingHash,
    operationKey: text(row, "operation_key")!,
    deploymentKey: text(row, "deployment_key")!,
    chainId: integer(row, "chain_id"),
    panelAddress: getAddress(text(row, "panel_address")!),
    roundId: text(row, "round_id")!,
    contentId: text(row, "content_id")!,
    admissionPolicyHash: text(row, "admission_policy_hash")!,
    integrity,
  };
}

export async function attachIssuedNetworkVoucher(
  client: Pick<PoolClient, "query">,
  input: NetworkVoucherSelection & { voucherId: string; issuedAt: Date },
) {
  const locked = await client.query(
    `SELECT settlement.operation_key,settlement.deployment_key,settlement.chain_id,
            settlement.panel_address,settlement.round_id,settlement.content_id,
            settlement.admission_policy_hash
     FROM tokenless_network_assignment_settlements settlement
     JOIN tokenless_paid_vouchers voucher ON voucher.voucher_id=$5
       AND voucher.network_assignment_id=settlement.assignment_id
       AND voucher.network_selection_binding_hash=settlement.selection_binding_hash
       AND voucher.network_operation_key=settlement.operation_key
       AND voucher.network_deployment_key=settlement.deployment_key
       AND voucher.chain_id=settlement.chain_id
       AND lower(voucher.panel_address)=lower(settlement.panel_address)
       AND voucher.round_id=settlement.round_id
       AND lower(voucher.content_id)=lower(settlement.content_id)
     WHERE settlement.binding_id=$1 AND settlement.state='selected'
       AND settlement.selection_binding_hash=$2
       AND settlement.operation_key=$3 AND settlement.deployment_key=$4
       AND settlement.chain_id=$6 AND lower(settlement.panel_address)=lower($7)
       AND settlement.round_id=$8 AND lower(settlement.content_id)=lower($9)
       AND lower(settlement.admission_policy_hash)=lower($10)
       AND lower(voucher.admission_policy_hash)=lower(settlement.admission_policy_hash)
     LIMIT 1 FOR UPDATE OF settlement,voucher`,
    [
      input.bindingId,
      input.selectionBindingHash,
      input.operationKey,
      input.deploymentKey,
      input.voucherId,
      input.chainId,
      input.panelAddress,
      input.roundId,
      input.contentId,
      input.admissionPolicyHash,
    ],
  );
  const row = locked.rows[0] as Row | undefined;
  if (!row) {
    throw new TokenlessServiceError(
      "The selected network seat changed before voucher issuance.",
      409,
      "network_selection_binding_mismatch",
    );
  }
  await insertReceipt(client, {
    bindingId: input.bindingId,
    receiptType: "voucher_issued",
    revision: 2,
    payload: {
      bindingId: input.bindingId,
      assignmentId: input.assignmentId,
      selectionBindingHash: input.selectionBindingHash,
      voucherId: input.voucherId,
      operationKey: text(row, "operation_key"),
      deploymentKey: text(row, "deployment_key"),
      roundId: text(row, "round_id"),
      contentId: text(row, "content_id"),
      issuedAt: input.issuedAt.toISOString(),
    },
    now: input.issuedAt,
  });
  const updated = await client.query(
    `UPDATE tokenless_network_assignment_settlements
     SET voucher_id=$1,state='voucher_issued',transition_revision=2,updated_at=$2
     WHERE binding_id=$3 AND state='selected' AND selection_binding_hash=$4
       AND operation_key=$5 AND deployment_key=$6`,
    [
      input.voucherId,
      input.issuedAt,
      input.bindingId,
      input.selectionBindingHash,
      input.operationKey,
      input.deploymentKey,
    ],
  );
  if (updated.rowCount !== 1) {
    throw new TokenlessServiceError(
      "The selected network seat changed before voucher issuance.",
      409,
      "network_selection_binding_mismatch",
    );
  }
}

export async function markNetworkVoucherConsumed(
  client: Pick<PoolClient, "query">,
  input: { voucherId: string; commitId: string; transactionHash: string; committedAt: Date },
) {
  const locked = await client.query(
    `SELECT settlement.*
     FROM tokenless_network_assignment_settlements settlement
     WHERE settlement.voucher_id=$1 LIMIT 1 FOR UPDATE`,
    [input.voucherId],
  );
  const row = locked.rows[0] as Row | undefined;
  if (!row) return { networkBinding: false, replayed: false };
  if (text(row, "state") === "committed" || text(row, "state") === "terminal") {
    const receipt = await client.query(
      `SELECT receipt_json FROM tokenless_network_assignment_settlement_receipts
       WHERE binding_id=$1 AND receipt_type='voucher_consumed' AND transition_revision=3
       LIMIT 1`,
      [text(row, "binding_id")],
    );
    const consumed = parseObject(
      (receipt.rows[0] as Row | undefined)?.receipt_json,
      "network voucher consumption receipt",
    );
    if (
      String(consumed.commitId ?? "") !== input.commitId ||
      String(consumed.transactionHash ?? "").toLowerCase() !== input.transactionHash.toLowerCase()
    ) {
      throw new TokenlessServiceError(
        "The network voucher was consumed by a different commit.",
        409,
        "network_voucher_consumption_conflict",
      );
    }
    return { networkBinding: true, replayed: true };
  }
  if (text(row, "state") !== "voucher_issued") {
    throw new TokenlessServiceError(
      "The selected network voucher is not consumable.",
      409,
      "network_voucher_consumption_conflict",
    );
  }
  await insertReceipt(client, {
    bindingId: text(row, "binding_id")!,
    receiptType: "voucher_consumed",
    revision: 3,
    payload: {
      bindingId: text(row, "binding_id"),
      assignmentId: text(row, "assignment_id"),
      selectionBindingHash: text(row, "selection_binding_hash"),
      voucherId: input.voucherId,
      commitId: input.commitId,
      transactionHash: input.transactionHash,
      committedAt: input.committedAt.toISOString(),
    },
    now: input.committedAt,
  });
  const updated = await client.query(
    `UPDATE tokenless_network_assignment_settlements
     SET state='committed',transition_revision=3,committed_at=$1,updated_at=$1
     WHERE binding_id=$2 AND state='voucher_issued' AND transition_revision=2`,
    [input.committedAt, text(row, "binding_id")],
  );
  if (updated.rowCount !== 1) {
    throw new TokenlessServiceError(
      "The selected network voucher changed before consumption.",
      409,
      "network_voucher_consumption_conflict",
    );
  }
  return { networkBinding: true, replayed: false };
}

export async function releaseSelectedNetworkAssignmentsForAccountDeletion(
  client: Pick<PoolClient, "query">,
  input: { principalId: string; receiptDigest: string; now: Date },
) {
  const selected = await client.query(
    `SELECT settlement.binding_id,settlement.assignment_id,settlement.selection_binding_hash,
            settlement.transition_revision
     FROM tokenless_network_assignment_settlements settlement
     JOIN tokenless_assurance_assignments assignment
       ON assignment.assignment_id=settlement.assignment_id
     JOIN tokenless_rater_profiles profile ON profile.rater_id=assignment.rater_id
     WHERE profile.principal_id=$1 AND assignment.status='released' AND settlement.state='selected'
     ORDER BY settlement.binding_id ASC FOR UPDATE`,
    [input.principalId],
  );
  const receiptHash = `sha256:${input.receiptDigest}`;
  if (!HASH.test(receiptHash)) throw new Error("Account deletion receipt digest is invalid.");
  let released = 0;
  for (const value of selected.rows) {
    const row = value as Row;
    const revision = integer(row, "transition_revision") + 1;
    const evidence = {
      schemaVersion: "rateloop.network-assignment-terminal-evidence.v1",
      bindingId: text(row, "binding_id"),
      assignmentId: text(row, "assignment_id"),
      selectionBindingHash: text(row, "selection_binding_hash"),
      outcome: "not_accepted",
      accountDeletionReceiptHash: receiptHash,
      terminalAt: input.now.toISOString(),
    };
    const evidenceHash = sha256(evidence);
    const settlementReference = `account-deletion:${receiptHash}`;
    await insertReceipt(client, {
      bindingId: text(row, "binding_id")!,
      receiptType: "settlement_terminal",
      revision,
      payload: evidence,
      now: input.now,
    });
    const updated = await client.query(
      `UPDATE tokenless_network_assignment_settlements
       SET state='terminal',transition_revision=$1,terminal_outcome='not_accepted',
           settlement_reference=$2,settlement_evidence_hash=$3,terminal_at=$4,updated_at=$4
       WHERE binding_id=$5 AND state='selected' AND transition_revision=$6`,
      [
        revision,
        settlementReference,
        evidenceHash,
        input.now,
        text(row, "binding_id"),
        integer(row, "transition_revision"),
      ],
    );
    if (updated.rowCount !== 1) {
      throw new Error("Network assignment release lost its locked settlement transition.");
    }
    released += 1;
  }
  return { released };
}

type NetworkSettlementLoad = (input: {
  principalId: string;
  deploymentKey: string;
  chainId: number;
  panelAddress: string;
  roundId: string;
  voteKey: string;
  now: Date;
}) => Promise<RaterSettlementSnapshot>;

function expiredSelectionTerminalOutcome(assignmentStatus: string | null, confidentialityAcceptedAt: unknown) {
  return assignmentStatus === "accepted" || confidentialityAcceptedAt
    ? ("not_submitted" as const)
    : ("not_accepted" as const);
}

function expiredSelectionIsStillDue(row: Row, now: Date) {
  if (!["frozen", "recruiting", "collecting"].includes(text(row, "run_status") ?? "")) return true;
  const status = text(row, "status");
  if (status === "released" || status === "expired") return true;
  const deadline =
    status === "reserved" ? row.reservation_expires_at : status === "accepted" ? row.assignment_expires_at : null;
  if (!deadline) return false;
  const expiresAt = deadline instanceof Date ? deadline : new Date(String(deadline));
  return Number.isFinite(expiresAt.getTime()) && expiresAt <= now;
}

function sameAddress(left: unknown, right: unknown) {
  try {
    return getAddress(String(left)) === getAddress(String(right));
  } catch {
    return false;
  }
}

function committedPersistenceIdentityMatches(row: Row) {
  try {
    return (
      text(row, "operation_key") === text(row, "voucher_operation_key") &&
      text(row, "deployment_key") === text(row, "voucher_deployment_key") &&
      text(row, "deployment_key") === text(row, "commit_deployment_key") &&
      integer(row, "chain_id") === integer(row, "voucher_chain_id") &&
      sameAddress(row.panel_address, row.voucher_panel_address) &&
      text(row, "round_id") === text(row, "voucher_round_id") &&
      text(row, "round_id") === text(row, "commit_round_id") &&
      text(row, "content_id")?.toLowerCase() === text(row, "voucher_content_id")?.toLowerCase() &&
      sameAddress(row.voucher_vote_key, row.commit_vote_key) &&
      text(row, "voucher_id") === text(row, "commit_voucher_id")
    );
  } catch {
    return false;
  }
}

function committedBindingFingerprint(row: Row) {
  return sha256({
    bindingId: text(row, "binding_id"),
    operationKey: text(row, "operation_key"),
    deploymentKey: text(row, "deployment_key"),
    chainId: integer(row, "chain_id"),
    panelAddress: getAddress(text(row, "panel_address")!),
    roundId: text(row, "round_id"),
    contentId: text(row, "content_id")?.toLowerCase(),
    voucherId: text(row, "voucher_id"),
    commitId: text(row, "commit_id"),
    voteKey: getAddress(text(row, "commit_vote_key")!),
    transactionHash: text(row, "transaction_hash"),
    principalId: text(row, "principal_id"),
  });
}

function committedSnapshotIdentityMatches(row: Row, snapshot: RaterSettlementSnapshot) {
  try {
    const voteKey = getAddress(text(row, "commit_vote_key")!);
    return (
      snapshot.chainId === integer(row, "chain_id") &&
      sameAddress(snapshot.panelAddress, row.panel_address) &&
      snapshot.roundId === text(row, "round_id") &&
      getAddress(snapshot.voteKey) === voteKey &&
      snapshot.commitKey.toLowerCase() === tokenlessCommitKey(BigInt(snapshot.roundId), voteKey).toLowerCase()
    );
  } catch {
    return false;
  }
}

function terminalSettlement(snapshot: RaterSettlementSnapshot, now: Date) {
  const claimAmount =
    snapshot.claimKind === "payout"
      ? BigInt(snapshot.finalizedPayoutAtomic)
      : snapshot.claimKind === "compensation"
        ? BigInt(snapshot.compensationAtomic)
        : 0n;
  if (snapshot.claimed) {
    return snapshot.claimKind === "compensation" ? ("compensated" as const) : ("paid" as const);
  }
  if (
    snapshot.claimKind &&
    claimAmount > 0n &&
    snapshot.claimDeadline &&
    BigInt(Math.floor(now.getTime() / 1_000)) > BigInt(snapshot.claimDeadline)
  ) {
    return "claim_expired" as const;
  }
  if (
    ["finalized", "zero_commit_refunded", "under_quorum_compensated", "beacon_failure_compensated"].includes(
      snapshot.roundStatus,
    ) &&
    (!snapshot.claimKind || claimAmount === 0n)
  ) {
    return "no_payout" as const;
  }
  return null;
}

function networkSettlementFailureEvidence(error: unknown) {
  const code =
    error instanceof TokenlessServiceError
      ? error.code
      : error instanceof Error
        ? error.name
        : "unknown_network_settlement_error";
  return {
    code,
    digest: sha256({ schemaVersion: "rateloop.network-settlement-failure.v1", code }),
  };
}

async function recordNetworkSettlementFailure(bindingId: string, error: unknown, now: Date) {
  const evidence = networkSettlementFailureEvidence(error);
  await dbPool.query(
    `INSERT INTO tokenless_network_settlement_failures
     (binding_id,status,attempt_count,first_failed_at,last_failed_at,next_retry_at,
      last_error_code,last_error_digest,operator_alert_state,resolved_at,updated_at)
     VALUES ($1,'retrying',1,$2,$2,$3,$4,$5,'pending',NULL,$2)
     ON CONFLICT (binding_id) DO UPDATE SET
       attempt_count=LEAST(5,tokenless_network_settlement_failures.attempt_count+1),
       status=CASE WHEN tokenless_network_settlement_failures.attempt_count+1 >= 5 THEN 'dead' ELSE 'retrying' END,
       last_failed_at=EXCLUDED.last_failed_at,
       next_retry_at=CASE
         WHEN tokenless_network_settlement_failures.attempt_count+1 >= 5 THEN NULL
         ELSE EXCLUDED.next_retry_at
       END,
       last_error_code=EXCLUDED.last_error_code,last_error_digest=EXCLUDED.last_error_digest,
       operator_alert_state='pending',resolved_at=NULL,updated_at=EXCLUDED.updated_at`,
    [bindingId, now, new Date(now.getTime() + 60_000), evidence.code, evidence.digest],
  );
}

async function resolveNetworkSettlementFailure(client: Pick<PoolClient, "query">, bindingId: string, now: Date) {
  await client.query(
    `UPDATE tokenless_network_settlement_failures
     SET status='resolved',next_retry_at=NULL,operator_alert_state='resolved',
         resolved_at=$1,updated_at=$1
     WHERE binding_id=$2 AND status<>'resolved'`,
    [now, bindingId],
  );
}

export async function reconcileNetworkAssignmentSettlements(
  input: { now?: Date; limit?: number; loadSettlement?: NetworkSettlementLoad } = {},
) {
  const now = input.now ?? new Date();
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const loadSettlement: NetworkSettlementLoad =
    input.loadSettlement ??
    (value =>
      getRaterSettlementSnapshot({
        principalId: value.principalId,
        roundId: value.roundId,
        voteKey: value.voteKey,
        now: value.now,
      }));
  const expiredSelections = await dbPool.query(
    `SELECT settlement.binding_id,settlement.assignment_id,settlement.selection_binding_hash,
            settlement.transition_revision,assignment.status,assignment.confidentiality_accepted_at,
            assignment.reservation_expires_at,assignment.assignment_expires_at,run.status AS run_status
     FROM tokenless_network_assignment_settlements settlement
     JOIN tokenless_assurance_assignments assignment
       ON assignment.assignment_id=settlement.assignment_id
      AND assignment.run_id=settlement.run_id
      AND assignment.subpanel_id=settlement.subpanel_id
     JOIN tokenless_assurance_runs run ON run.run_id=assignment.run_id
     LEFT JOIN tokenless_network_settlement_failures failure
       ON failure.binding_id=settlement.binding_id
     WHERE settlement.state='selected'
       AND (
         failure.binding_id IS NULL OR failure.status='resolved'
         OR (failure.status='retrying' AND failure.next_retry_at <= $1)
       )
       AND (
         run.status NOT IN ('frozen','recruiting','collecting')
         OR assignment.status IN ('released','expired')
         OR (assignment.status='reserved' AND assignment.reservation_expires_at <= $1)
         OR (assignment.status='accepted' AND assignment.assignment_expires_at <= $1)
       )
     ORDER BY settlement.updated_at ASC,settlement.binding_id ASC LIMIT $2`,
    [now, limit],
  );
  let terminal = 0;
  for (const value of expiredSelections.rows) {
    const candidate = value as Row;
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        `SELECT settlement.binding_id,settlement.assignment_id,settlement.selection_binding_hash,
                settlement.transition_revision,settlement.state,assignment.status,
                assignment.confidentiality_accepted_at,assignment.reservation_expires_at,
                assignment.assignment_expires_at,run.status AS run_status
         FROM tokenless_network_assignment_settlements settlement
         JOIN tokenless_assurance_assignments assignment
           ON assignment.assignment_id=settlement.assignment_id
          AND assignment.run_id=settlement.run_id
          AND assignment.subpanel_id=settlement.subpanel_id
         JOIN tokenless_assurance_runs run ON run.run_id=assignment.run_id
         WHERE settlement.binding_id=$1
         LIMIT 1 FOR UPDATE OF settlement,assignment`,
        [text(candidate, "binding_id")],
      );
      const row = current.rows[0] as Row | undefined;
      if (!row || text(row, "state") !== "selected" || !expiredSelectionIsStillDue(row, now)) {
        await resolveNetworkSettlementFailure(client, text(candidate, "binding_id")!, now);
        await client.query("COMMIT");
        continue;
      }
      const terminalOutcome = expiredSelectionTerminalOutcome(text(row, "status"), row.confidentiality_accepted_at);
      const evidence = {
        schemaVersion: "rateloop.network-assignment-terminal-evidence.v1",
        bindingId: text(row, "binding_id"),
        assignmentId: text(row, "assignment_id"),
        selectionBindingHash: text(row, "selection_binding_hash"),
        assignmentStatus: text(row, "status"),
        outcome: terminalOutcome,
        terminalAt: now.toISOString(),
      };
      const evidenceHash = sha256(evidence);
      const revision = integer(row, "transition_revision") + 1;
      await insertReceipt(client, {
        bindingId: text(row, "binding_id")!,
        receiptType: "settlement_terminal",
        revision,
        payload: evidence,
        now,
      });
      const updated = await client.query(
        `UPDATE tokenless_network_assignment_settlements
         SET state='terminal',transition_revision=$1,terminal_outcome=$2,
             settlement_reference=$3,settlement_evidence_hash=$4,terminal_at=$5,updated_at=$5
         WHERE binding_id=$6 AND state='selected' AND transition_revision=$7`,
        [
          revision,
          terminalOutcome,
          `assignment-closed:${text(row, "assignment_id")}`,
          evidenceHash,
          now,
          text(row, "binding_id"),
          integer(row, "transition_revision"),
        ],
      );
      if (updated.rowCount !== 1) {
        throw new TokenlessServiceError(
          "The expired network selection changed before settlement.",
          409,
          "network_settlement_transition_conflict",
          true,
        );
      }
      terminal += 1;
      await resolveNetworkSettlementFailure(client, text(candidate, "binding_id")!, now);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      await recordNetworkSettlementFailure(text(candidate, "binding_id")!, error, now);
    } finally {
      client.release();
    }
  }
  const expiredVouchers = await dbPool.query(
    `SELECT settlement.binding_id,settlement.assignment_id,settlement.selection_binding_hash,
            settlement.voucher_id,settlement.transition_revision
     FROM tokenless_network_assignment_settlements settlement
     JOIN tokenless_paid_vouchers voucher ON voucher.voucher_id=settlement.voucher_id
     LEFT JOIN tokenless_network_settlement_failures failure
       ON failure.binding_id=settlement.binding_id
     LEFT JOIN (
       SELECT commit.voucher_id
       FROM tokenless_rater_commits commit
       LEFT JOIN tokenless_scheduled_work_items recovery
         ON recovery.kind='recover_rater_commit' AND recovery.subject_key=commit.commit_id
       WHERE commit.state=ANY($3::text[])
          OR (
            commit.state=ANY($5::text[])
            AND (commit.updated_at > $4 OR recovery.state=ANY($6::text[]))
          )
       GROUP BY commit.voucher_id
     ) recoverable ON recoverable.voucher_id=settlement.voucher_id
     WHERE settlement.state='voucher_issued' AND voucher.expires_at <= $1
       AND (
         failure.binding_id IS NULL OR failure.status='resolved'
         OR (failure.status='retrying' AND failure.next_retry_at <= $1)
       )
       AND recoverable.voucher_id IS NULL
     ORDER BY settlement.updated_at ASC,settlement.binding_id ASC LIMIT $2`,
    [
      now,
      limit,
      [...FINALIZING_LOCAL_COMMIT_STATES],
      new Date(now.getTime() - RECOVERY_SCHEDULING_GRACE_MS),
      [...PRE_SUBMISSION_LOCAL_COMMIT_STATES],
      [...ACTIVE_RECOVERY_WORK_STATES],
    ],
  );
  for (const value of expiredVouchers.rows) {
    const candidate = value as Row;
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const lockedVoucher = await client.query(
        `SELECT voucher_id,expires_at FROM tokenless_paid_vouchers
         WHERE voucher_id=$1 LIMIT 1 FOR UPDATE`,
        [text(candidate, "voucher_id")],
      );
      const current = await client.query(
        `SELECT settlement.binding_id,settlement.assignment_id,settlement.selection_binding_hash,
                settlement.voucher_id,settlement.transition_revision,settlement.state
         FROM tokenless_network_assignment_settlements settlement
         WHERE settlement.binding_id=$1 AND settlement.voucher_id=$2
         LIMIT 1 FOR UPDATE`,
        [text(candidate, "binding_id"), text(candidate, "voucher_id")],
      );
      const voucherRow = lockedVoucher.rows[0] as Row | undefined;
      const row = current.rows[0] as Row | undefined;
      const commitResult = row
        ? await client.query(
            `SELECT commit_id,state,updated_at FROM tokenless_rater_commits
             WHERE voucher_id=$1
             LIMIT 1 FOR UPDATE`,
            [text(row, "voucher_id")],
          )
        : null;
      const commit = commitResult?.rows[0] as Row | undefined;
      let commitWithRecovery = commit;
      if (
        commit &&
        (PRE_SUBMISSION_LOCAL_COMMIT_STATES as readonly string[]).includes(text(commit, "state") ?? "") &&
        date(commit, "updated_at").getTime() <= now.getTime() - RECOVERY_SCHEDULING_GRACE_MS
      ) {
        await client.query(
          `INSERT INTO tokenless_scheduled_work_items
           (item_id,kind,subject_key,state,attempt_count,next_attempt_at,last_error,dead_at,created_at,updated_at)
           VALUES ($1,'recover_rater_commit',$2,'dead',20,$3,
                   'Rater commit recovery was not active before voucher settlement expiry.',$3,$3,$3)
           ON CONFLICT (kind,subject_key) DO NOTHING`,
          [`swi_${randomUUID().replaceAll("-", "")}`, text(commit, "commit_id"), now],
        );
        const recovery = await client.query(
          `SELECT state FROM tokenless_scheduled_work_items
           WHERE kind='recover_rater_commit' AND subject_key=$1 LIMIT 1 FOR UPDATE`,
          [text(commit, "commit_id")],
        );
        commitWithRecovery = {
          ...commit,
          recovery_state: text(recovery.rows[0] as Row | undefined, "state"),
        };
      }
      if (
        !voucherRow ||
        !row ||
        text(row, "state") !== "voucher_issued" ||
        date(voucherRow, "expires_at") > now ||
        commitBlocksVoucherExpiry(commitWithRecovery, now)
      ) {
        await resolveNetworkSettlementFailure(client, text(candidate, "binding_id")!, now);
        await client.query("COMMIT");
        continue;
      }
      if (commit && (PRE_SUBMISSION_LOCAL_COMMIT_STATES as readonly string[]).includes(text(commit, "state") ?? "")) {
        const failed = await client.query(
          `UPDATE tokenless_rater_commits
           SET state='failed',failure_code=$1,updated_at=$2
           WHERE commit_id=$3 AND state=ANY($4::text[])`,
          [
            text(commitWithRecovery, "recovery_state") === "dead" ? "recovery_dead_lettered" : "recovery_not_scheduled",
            now,
            text(commit, "commit_id"),
            [...PRE_SUBMISSION_LOCAL_COMMIT_STATES],
          ],
        );
        if (failed.rowCount !== 1) {
          throw new TokenlessServiceError(
            "The local rater commit changed before expired voucher settlement.",
            409,
            "network_settlement_transition_conflict",
            true,
          );
        }
      }
      const evidence = {
        schemaVersion: "rateloop.network-assignment-terminal-evidence.v1",
        bindingId: text(row, "binding_id"),
        assignmentId: text(row, "assignment_id"),
        selectionBindingHash: text(row, "selection_binding_hash"),
        voucherId: text(row, "voucher_id"),
        outcome: "not_submitted",
        terminalAt: now.toISOString(),
      };
      const evidenceHash = sha256(evidence);
      const revision = integer(row, "transition_revision") + 1;
      await insertReceipt(client, {
        bindingId: text(row, "binding_id")!,
        receiptType: "settlement_terminal",
        revision,
        payload: evidence,
        now,
      });
      const updated = await client.query(
        `UPDATE tokenless_network_assignment_settlements
         SET state='terminal',transition_revision=$1,terminal_outcome='not_submitted',
             settlement_reference=$2,settlement_evidence_hash=$3,terminal_at=$4,updated_at=$4
         WHERE binding_id=$5 AND state='voucher_issued' AND transition_revision=$6`,
        [
          revision,
          `voucher-expired:${text(row, "voucher_id")}`,
          evidenceHash,
          now,
          text(row, "binding_id"),
          integer(row, "transition_revision"),
        ],
      );
      if (updated.rowCount !== 1) {
        throw new TokenlessServiceError(
          "The expired network voucher changed before settlement.",
          409,
          "network_settlement_transition_conflict",
          true,
        );
      }
      terminal += 1;
      await resolveNetworkSettlementFailure(client, text(candidate, "binding_id")!, now);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      await recordNetworkSettlementFailure(text(candidate, "binding_id")!, error, now);
    } finally {
      client.release();
    }
  }
  const due = await dbPool.query(
    `SELECT settlement.binding_id,settlement.assignment_id,settlement.run_id,settlement.case_id,
            settlement.selection_binding_hash,settlement.operation_key,settlement.deployment_key,
            settlement.chain_id,settlement.panel_address,settlement.round_id,
            settlement.content_id,settlement.voucher_id,settlement.transition_revision,settlement.state,
            commit.commit_id,commit.voucher_id AS commit_voucher_id,
            commit.deployment_key AS commit_deployment_key,commit.round_id AS commit_round_id,
            commit.vote_key AS commit_vote_key,commit.transaction_hash,commit.state AS commit_state,
            voucher.network_operation_key AS voucher_operation_key,
            voucher.network_deployment_key AS voucher_deployment_key,
            voucher.chain_id AS voucher_chain_id,voucher.panel_address AS voucher_panel_address,
            voucher.round_id AS voucher_round_id,voucher.content_id AS voucher_content_id,
            voucher.vote_key AS voucher_vote_key,voucher.rater_id,profile.principal_id
     FROM tokenless_network_assignment_settlements settlement
     JOIN tokenless_paid_vouchers voucher ON voucher.voucher_id=settlement.voucher_id
     JOIN tokenless_rater_profiles profile ON profile.rater_id=voucher.rater_id
     JOIN tokenless_rater_commits commit ON commit.voucher_id=voucher.voucher_id
     LEFT JOIN tokenless_network_settlement_failures failure
       ON failure.binding_id=settlement.binding_id
     WHERE settlement.state='committed' AND commit.state='confirmed'
       AND (
         failure.binding_id IS NULL OR failure.status='resolved'
         OR (failure.status='retrying' AND failure.next_retry_at <= $2)
       )
     ORDER BY settlement.updated_at ASC,settlement.binding_id ASC LIMIT $1`,
    [limit, now],
  );
  let retry = 0;
  for (const value of due.rows) {
    const row = value as Row;
    try {
      if (!committedPersistenceIdentityMatches(row)) {
        throw new TokenlessServiceError(
          "The committed network settlement has conflicting durable round identities.",
          409,
          "network_settlement_identity_mismatch",
        );
      }
      const snapshot = await loadSettlement({
        principalId: text(row, "principal_id")!,
        deploymentKey: text(row, "deployment_key")!,
        chainId: integer(row, "chain_id"),
        panelAddress: text(row, "panel_address")!,
        roundId: text(row, "round_id")!,
        voteKey: text(row, "commit_vote_key")!,
        now,
      });
      if (!committedSnapshotIdentityMatches(row, snapshot)) {
        throw new TokenlessServiceError(
          "The returned network settlement does not match the exact committed round.",
          409,
          "network_settlement_identity_mismatch",
        );
      }
      const outcome = terminalSettlement(snapshot, now);
      if (!outcome) {
        retry += 1;
        continue;
      }
      const commitKey = tokenlessCommitKey(BigInt(text(row, "round_id")!), getAddress(text(row, "commit_vote_key")!));
      const evidence = {
        schemaVersion: "rateloop.network-assignment-terminal-evidence.v1",
        bindingId: text(row, "binding_id"),
        assignmentId: text(row, "assignment_id"),
        selectionBindingHash: text(row, "selection_binding_hash"),
        deploymentKey: text(row, "deployment_key"),
        roundId: text(row, "round_id"),
        contentId: text(row, "content_id"),
        voucherId: text(row, "voucher_id"),
        commitId: text(row, "commit_id"),
        commitKey,
        transactionHash: text(row, "transaction_hash"),
        outcome,
        settlement: snapshot,
        terminalAt: now.toISOString(),
      };
      const evidenceHash = sha256(evidence);
      const settlementReference = `chain:${text(row, "deployment_key")}:${text(row, "round_id")}:${commitKey}:${outcome}`;
      const client = await dbPool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT assignment_id FROM tokenless_assurance_assignments WHERE assignment_id=$1 FOR UPDATE",
          [text(row, "assignment_id")],
        );
        const locked = await client.query(
          `SELECT settlement.binding_id,settlement.assignment_id,settlement.run_id,settlement.case_id,
                  settlement.selection_binding_hash,settlement.operation_key,settlement.deployment_key,
                  settlement.chain_id,settlement.panel_address,settlement.round_id,
                  settlement.content_id,settlement.voucher_id,settlement.transition_revision,settlement.state,
                  commit.commit_id,commit.voucher_id AS commit_voucher_id,
                  commit.deployment_key AS commit_deployment_key,commit.round_id AS commit_round_id,
                  commit.vote_key AS commit_vote_key,commit.transaction_hash,commit.state AS commit_state,
                  voucher.network_operation_key AS voucher_operation_key,
                  voucher.network_deployment_key AS voucher_deployment_key,
                  voucher.chain_id AS voucher_chain_id,voucher.panel_address AS voucher_panel_address,
                  voucher.round_id AS voucher_round_id,voucher.content_id AS voucher_content_id,
                  voucher.vote_key AS voucher_vote_key,voucher.rater_id,profile.principal_id
           FROM tokenless_network_assignment_settlements settlement
           JOIN tokenless_paid_vouchers voucher ON voucher.voucher_id=settlement.voucher_id
           JOIN tokenless_rater_profiles profile ON profile.rater_id=voucher.rater_id
           JOIN tokenless_rater_commits commit ON commit.voucher_id=voucher.voucher_id
           WHERE settlement.binding_id=$1
           LIMIT 1 FOR UPDATE OF settlement,voucher,commit`,
          [text(row, "binding_id")],
        );
        const lockedRow = locked.rows[0] as Row | undefined;
        if (
          !lockedRow ||
          text(lockedRow, "state") !== "committed" ||
          integer(lockedRow, "transition_revision") !== 3 ||
          text(lockedRow, "commit_state") !== "confirmed" ||
          !committedPersistenceIdentityMatches(lockedRow) ||
          committedBindingFingerprint(lockedRow) !== committedBindingFingerprint(row)
        ) {
          throw new TokenlessServiceError(
            "The committed network settlement changed before terminal evidence was stored.",
            409,
            "network_settlement_transition_conflict",
            true,
          );
        }
        await insertReceipt(client, {
          bindingId: text(row, "binding_id")!,
          receiptType: "settlement_terminal",
          revision: 4,
          payload: evidence,
          now,
        });
        const updated = await client.query(
          `UPDATE tokenless_network_assignment_settlements
           SET state='terminal',transition_revision=4,terminal_outcome=$1,settlement_reference=$2,
               settlement_evidence_hash=$3,terminal_at=$4,updated_at=$4
           WHERE binding_id=$5 AND state='committed' AND transition_revision=3 RETURNING binding_id`,
          [outcome, settlementReference, evidenceHash, now, text(row, "binding_id")],
        );
        if (updated.rowCount !== 1) {
          throw new TokenlessServiceError(
            "The committed network settlement changed before terminal evidence was stored.",
            409,
            "network_settlement_transition_conflict",
            true,
          );
        }
        const keys = getAssuranceResponseKeyrings().reviewerMapping;
        const reviewerKeys = [...keys.keys.keys()].map(version =>
          assuranceReviewerKey({ accountAddress: text(row, "rater_id")!, runId: text(row, "run_id")! }, keys, version),
        );
        const responses = await client.query(
          `UPDATE tokenless_assurance_responses
           SET settlement_reference=$1,settlement_evidence_hash=$2,updated_at=$3
           WHERE run_id=$4 AND case_id=$5 AND reviewer_key=ANY($6::text[])
             AND (
               (settlement_reference IS NULL AND settlement_evidence_hash IS NULL)
               OR (settlement_reference=$1 AND settlement_evidence_hash=$2)
             )`,
          [settlementReference, evidenceHash, now, text(row, "run_id"), text(row, "case_id"), reviewerKeys],
        );
        if ((responses.rowCount ?? 0) > 1) {
          throw new TokenlessServiceError(
            "More than one network response matched exact terminal settlement evidence.",
            409,
            "network_response_settlement_conflict",
          );
        }
        terminal += 1;
        await resolveNetworkSettlementFailure(client, text(row, "binding_id")!, now);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      await recordNetworkSettlementFailure(text(row, "binding_id")!, error, now);
      retry += 1;
      continue;
    }
  }
  return {
    scanned: (expiredSelections.rowCount ?? 0) + (expiredVouchers.rowCount ?? 0) + (due.rowCount ?? 0),
    terminal,
    retry,
  };
}

export const __networkAssignmentSettlementTestUtils = {
  commitBlocksVoucherExpiry,
  expiredSelectionTerminalOutcome,
  selectionBindingHash,
  sha256,
  terminalSettlement,
  recoverableLocalCommitStates: RECOVERABLE_LOCAL_COMMIT_STATES,
};
