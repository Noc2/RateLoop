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
            e.operation_key,e.deployment_key,e.chain_id,e.panel_address,e.round_terms_json,
            e.total_funded_atomic,e.state AS execution_state,e.confirmed_at,
            own.workspace_id AS operation_workspace_id,q.terms_json,
            voucher.content_id AS voucher_content_id,
            voucher.admission_policy_hash AS voucher_admission_policy_hash,
            voucher.maximum_commits,voucher.voucher_deadline,voucher.status AS voucher_status
     FROM tokenless_assurance_run_cases rc
     LEFT JOIN tokenless_chain_executions e
       ON CAST(e.round_id AS text)=rc.round_id AND lower(e.content_id)=lower(rc.content_id)
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
  return result.rows.map(value => {
    const row = value as Row;
    if (
      !text(row, "operation_key") ||
      !text(row, "deployment_key") ||
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
    };
  });
}

type NetworkSelectionIdentity = {
  assignmentId: string;
  runId: string;
  subpanelId: string;
  selectionBatchId: string;
  integrityProvenanceHash: Hash;
  integrityReviewerLookup: string;
};

function selectionBindingHash(input: NetworkSelectionIdentity & { round: ExactNetworkRoundBinding }) {
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
      reviewerLookup: input.integrityReviewerLookup,
    },
    round: input.round,
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
  for (const round of input.rounds) {
    const bindingHash = selectionBindingHash({ ...input, round });
    const bindingId = `nas_${randomUUID().replaceAll("-", "")}`;
    await client.query(
      `INSERT INTO tokenless_network_assignment_settlements
       (binding_id,assignment_id,run_id,case_id,operation_key,selection_batch_id,
        selection_binding_hash,integrity_provenance_hash,integrity_reviewer_lookup,
        deployment_key,chain_id,panel_address,round_id,content_id,admission_policy_hash,
        round_terms_hash,total_funded_atomic,maximum_commits,state,transition_revision,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
               'selected',1,$19,$19)`,
      [
        bindingId,
        input.assignmentId,
        input.runId,
        round.caseId,
        round.operationKey,
        input.selectionBatchId,
        bindingHash,
        input.integrityProvenanceHash,
        input.integrityReviewerLookup,
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
        integrityReviewerLookup: input.integrityReviewerLookup,
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
  integrity: Record<string, unknown>;
};

export async function loadExactNetworkVoucherSelection(
  client: Pick<PoolClient, "query">,
  input: {
    principalId: string;
    assignmentId: string;
    selectionBindingHash: Hash;
    roundId: string;
    contentId: string;
    admissionPolicyHash: string;
    now: Date;
  },
): Promise<NetworkVoucherSelection> {
  const result = await client.query(
    `SELECT settlement.*,assignment.integrity_provenance_json,
            assignment.integrity_provenance_hash AS assignment_integrity_provenance_hash,
            assignment.rater_id,profile.principal_id,assignment.status AS assignment_status,
            assignment.reservation_expires_at,assignment.assignment_expires_at
     FROM tokenless_network_assignment_settlements settlement
     JOIN tokenless_assurance_assignments assignment
       ON assignment.assignment_id=settlement.assignment_id
     JOIN tokenless_rater_profiles profile ON profile.rater_id=assignment.rater_id
     WHERE settlement.assignment_id=$1 AND settlement.round_id=$2
       AND lower(settlement.content_id)=lower($3) LIMIT 1 FOR UPDATE OF settlement,assignment`,
    [input.assignmentId, input.roundId, input.contentId],
  );
  const row = result.rows[0] as Row | undefined;
  const activeUntil = row
    ? text(row, "assignment_status") === "accepted"
      ? date(row, "assignment_expires_at")
      : date(row, "reservation_expires_at")
    : null;
  if (
    !row ||
    !activeUntil ||
    text(row, "principal_id") !== input.principalId ||
    !["reserved", "accepted"].includes(text(row, "assignment_status") ?? "") ||
    activeUntil <= input.now ||
    text(row, "state") !== "selected" ||
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
  return {
    bindingId: text(row, "binding_id")!,
    assignmentId: input.assignmentId,
    selectionBindingHash: input.selectionBindingHash,
    integrity,
  };
}

export async function attachIssuedNetworkVoucher(
  client: Pick<PoolClient, "query">,
  input: NetworkVoucherSelection & { voucherId: string; issuedAt: Date },
) {
  const updated = await client.query(
    `UPDATE tokenless_network_assignment_settlements
     SET voucher_id=$1,state='voucher_issued',transition_revision=2,updated_at=$2
     WHERE binding_id=$3 AND state='selected' AND selection_binding_hash=$4
     RETURNING operation_key,round_id,content_id`,
    [input.voucherId, input.issuedAt, input.bindingId, input.selectionBindingHash],
  );
  const row = updated.rows[0] as Row | undefined;
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
      roundId: text(row, "round_id"),
      contentId: text(row, "content_id"),
      issuedAt: input.issuedAt.toISOString(),
    },
    now: input.issuedAt,
  });
}

export async function markNetworkVoucherConsumed(
  client: Pick<PoolClient, "query">,
  input: { voucherId: string; commitId: string; transactionHash: string; committedAt: Date },
) {
  const locked = await client.query(
    `SELECT * FROM tokenless_network_assignment_settlements
     WHERE voucher_id=$1 LIMIT 1 FOR UPDATE`,
    [input.voucherId],
  );
  const row = locked.rows[0] as Row | undefined;
  if (!row) return { networkBinding: false, replayed: false };
  if (text(row, "state") === "committed" || text(row, "state") === "terminal") {
    return { networkBinding: true, replayed: true };
  }
  if (text(row, "state") !== "voucher_issued") {
    throw new TokenlessServiceError(
      "The selected network voucher is not consumable.",
      409,
      "network_voucher_consumption_conflict",
    );
  }
  await client.query(
    `UPDATE tokenless_network_assignment_settlements
     SET state='committed',transition_revision=3,committed_at=$1,updated_at=$1
     WHERE binding_id=$2 AND state='voucher_issued'`,
    [input.committedAt, text(row, "binding_id")],
  );
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
    await insertReceipt(client, {
      bindingId: text(row, "binding_id")!,
      receiptType: "settlement_terminal",
      revision,
      payload: evidence,
      now: input.now,
    });
    released += 1;
  }
  return { released };
}

type NetworkSettlementLoad = (input: {
  principalId: string;
  roundId: string;
  voteKey: string;
  now: Date;
}) => Promise<RaterSettlementSnapshot>;

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
  const expiredVouchers = await dbPool.query(
    `SELECT settlement.binding_id,settlement.assignment_id,settlement.selection_binding_hash,
            settlement.voucher_id,settlement.transition_revision
     FROM tokenless_network_assignment_settlements settlement
     JOIN tokenless_paid_vouchers voucher ON voucher.voucher_id=settlement.voucher_id
     WHERE settlement.state='voucher_issued' AND voucher.expires_at <= $1
     ORDER BY settlement.updated_at ASC,settlement.binding_id ASC LIMIT $2`,
    [now, limit],
  );
  let terminal = 0;
  for (const value of expiredVouchers.rows) {
    const row = value as Row;
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
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const revision = integer(row, "transition_revision") + 1;
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
      if (updated.rowCount === 1) {
        await insertReceipt(client, {
          bindingId: text(row, "binding_id")!,
          receiptType: "settlement_terminal",
          revision,
          payload: evidence,
          now,
        });
        terminal += 1;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  const due = await dbPool.query(
    `SELECT settlement.binding_id,settlement.assignment_id,settlement.run_id,settlement.case_id,
            settlement.selection_binding_hash,settlement.deployment_key,settlement.round_id,
            settlement.content_id,settlement.voucher_id,
            commit.commit_id,commit.vote_key,commit.transaction_hash,
            voucher.rater_id,profile.principal_id
     FROM tokenless_network_assignment_settlements settlement
     JOIN tokenless_paid_vouchers voucher ON voucher.voucher_id=settlement.voucher_id
     JOIN tokenless_rater_profiles profile ON profile.rater_id=voucher.rater_id
     JOIN tokenless_rater_commits commit ON commit.voucher_id=voucher.voucher_id
     WHERE settlement.state='committed' AND commit.state='confirmed'
     ORDER BY settlement.updated_at ASC,settlement.binding_id ASC LIMIT $1`,
    [limit],
  );
  let retry = 0;
  for (const value of due.rows) {
    const row = value as Row;
    try {
      const snapshot = await loadSettlement({
        principalId: text(row, "principal_id")!,
        roundId: text(row, "round_id")!,
        voteKey: text(row, "vote_key")!,
        now,
      });
      const outcome = terminalSettlement(snapshot, now);
      if (!outcome) {
        retry += 1;
        continue;
      }
      const commitKey = tokenlessCommitKey(BigInt(text(row, "round_id")!), getAddress(text(row, "vote_key")!));
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
        const updated = await client.query(
          `UPDATE tokenless_network_assignment_settlements
           SET state='terminal',transition_revision=4,terminal_outcome=$1,settlement_reference=$2,
               settlement_evidence_hash=$3,terminal_at=$4,updated_at=$4
           WHERE binding_id=$5 AND state='committed' RETURNING binding_id`,
          [outcome, settlementReference, evidenceHash, now, text(row, "binding_id")],
        );
        if (updated.rowCount === 1) {
          await insertReceipt(client, {
            bindingId: text(row, "binding_id")!,
            receiptType: "settlement_terminal",
            revision: 4,
            payload: evidence,
            now,
          });
          const keys = getAssuranceResponseKeyrings().reviewerMapping;
          const reviewerKeys = [...keys.keys.keys()].map(version =>
            assuranceReviewerKey(
              { accountAddress: text(row, "rater_id")!, runId: text(row, "run_id")! },
              keys,
              version,
            ),
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
          if (responses.rowCount !== 1) {
            throw new TokenlessServiceError(
              "The exact network response settlement binding is unavailable.",
              409,
              "network_response_settlement_pending",
              true,
            );
          }
          terminal += 1;
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      if (error instanceof TokenlessServiceError && error.retryable) {
        retry += 1;
        continue;
      }
      throw error;
    }
  }
  return { scanned: (expiredVouchers.rowCount ?? 0) + (due.rowCount ?? 0), terminal, retry };
}

export const __networkAssignmentSettlementTestUtils = {
  selectionBindingHash,
  sha256,
  terminalSettlement,
};
