import { createHash } from "node:crypto";
import "server-only";
import { type Address, getAddress } from "viem";
import { dbClient } from "~~/lib/db";
import { type TokenlessChainConfig, loadTokenlessChainConfig } from "~~/lib/tokenless/chain/config";
import { type TokenlessChainRuntime, getTokenlessChainRuntime } from "~~/lib/tokenless/chain/runtime";

type Row = Record<string, unknown>;
type ManagedNonceRole = "prepaid_funder" | "gas_only_relayer" | "surprise_bonus_funder";
type NonceBusinessKind = "chain_execution" | "rater_commit" | "surprise_bounty";

type ReservedIntent = {
  businessKey: string;
  businessKind: NonceBusinessKind;
  hash: string | null;
  nonce: number;
  recoveryVersion: number;
  signed: string | null;
  state: string;
};

function rowString(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function safeNonce(value: unknown, label: string) {
  const nonce = Number(value);
  if (!Number.isSafeInteger(nonce) || nonce < 0) throw new Error(`${label} is invalid.`);
  return nonce;
}

function stableId(prefix: string, value: string) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 40)}`;
}

function workKind(intent: ReservedIntent) {
  if (intent.businessKind === "chain_execution") return "recover_chain_execution";
  if (intent.businessKind === "rater_commit") return "recover_rater_commit";
  return null;
}

async function reservedIntents(input: { deploymentKey: string; role: ManagedNonceRole }): Promise<ReservedIntent[]> {
  let result: Awaited<ReturnType<typeof dbClient.execute>>;
  if (input.role === "prepaid_funder") {
    result = await dbClient.execute({
      sql: `SELECT operation_key AS business_key, 'chain_execution' AS business_kind,
                   approval_nonce AS reserved_nonce, approval_signed_transaction AS signed_transaction,
                   approval_transaction_hash AS transaction_hash, transaction_recovery_version, state
            FROM tokenless_chain_executions
            WHERE deployment_key = ? AND payment_mode = 'prepaid' AND state <> 'confirmed'
              AND approval_nonce IS NOT NULL
            UNION ALL
            SELECT operation_key AS business_key, 'chain_execution' AS business_kind,
                   submission_nonce AS reserved_nonce, submission_signed_transaction AS signed_transaction,
                   submission_transaction_hash AS transaction_hash, transaction_recovery_version, state
            FROM tokenless_chain_executions
            WHERE deployment_key = ? AND payment_mode = 'prepaid' AND state <> 'confirmed'
              AND submission_nonce IS NOT NULL`,
      args: [input.deploymentKey, input.deploymentKey],
    });
  } else if (input.role === "gas_only_relayer") {
    result = await dbClient.execute({
      sql: `SELECT operation_key AS business_key, 'chain_execution' AS business_kind,
                   submission_nonce AS reserved_nonce, submission_signed_transaction AS signed_transaction,
                   submission_transaction_hash AS transaction_hash, transaction_recovery_version, state
            FROM tokenless_chain_executions
            WHERE deployment_key = ? AND payment_mode = 'x402' AND state <> 'confirmed'
              AND submission_nonce IS NOT NULL
            UNION ALL
            SELECT commit_id AS business_key, 'rater_commit' AS business_kind,
                   relay_nonce AS reserved_nonce, relay_signed_transaction AS signed_transaction,
                   transaction_hash, transaction_recovery_version, state
            FROM tokenless_rater_commits
            WHERE deployment_key = ? AND state NOT IN ('confirmed', 'failed') AND relay_nonce IS NOT NULL`,
      args: [input.deploymentKey, input.deploymentKey],
    });
  } else {
    result = await dbClient.execute({
      sql: `SELECT e.entitlement_id AS business_key, 'surprise_bounty' AS business_kind,
                   e.transfer_nonce AS reserved_nonce, e.transfer_signed_transaction AS signed_transaction,
                   e.transfer_transaction_hash AS transaction_hash, e.transaction_recovery_version, e.state
            FROM tokenless_surprise_bounty_entitlements e
            JOIN tokenless_surprise_bounty_rounds r ON r.bounty_round_id = e.bounty_round_id
            WHERE r.deployment_key = ? AND e.state <> 'paid' AND e.transfer_nonce IS NOT NULL`,
      args: [input.deploymentKey],
    });
  }
  return result.rows
    .map(value => {
      const row = value as Row;
      return {
        businessKey: rowString(row, "business_key")!,
        businessKind: rowString(row, "business_kind") as NonceBusinessKind,
        hash: rowString(row, "transaction_hash"),
        nonce: safeNonce(row.reserved_nonce, "Reserved transaction nonce"),
        recoveryVersion: Number(row.transaction_recovery_version ?? 0),
        signed: rowString(row, "signed_transaction"),
        state: rowString(row, "state")!,
      };
    })
    .sort((left, right) => left.nonce - right.nonce || left.businessKey.localeCompare(right.businessKey));
}

function structurallyRecoverable(intent: ReservedIntent) {
  if (intent.recoveryVersion !== 1) return false;
  if ((intent.signed === null) !== (intent.hash === null)) return false;
  return intent.state !== "reconciliation_required";
}

async function reopenIntent(intent: ReservedIntent, now: Date) {
  if (intent.businessKind === "surprise_bounty") {
    const reopened = await dbClient.execute({
      sql: `UPDATE tokenless_surprise_bounty_entitlements
            SET state = 'retry', next_attempt_at = ?, updated_at = ?
            WHERE entitlement_id = ? AND transaction_recovery_version = 1
              AND state IN ('ready', 'paying', 'retry')`,
      args: [now, now, intent.businessKey],
    });
    return reopened.rowCount === 1;
  }
  const kind = workKind(intent)!;
  const itemId = stableId("swi", `${kind}:${intent.businessKey}`);
  const reopened = await dbClient.execute({
    sql: `INSERT INTO tokenless_scheduled_work_items
          (item_id, kind, subject_key, state, attempt_count, next_attempt_at, created_at, updated_at)
          VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)
          ON CONFLICT (kind, subject_key) DO UPDATE
          SET state = 'pending', attempt_count = 0, next_attempt_at = EXCLUDED.next_attempt_at,
              completed_at = NULL, dead_at = NULL, updated_at = EXCLUDED.updated_at
          WHERE tokenless_scheduled_work_items.state IN ('completed', 'dead')
            AND COALESCE(tokenless_scheduled_work_items.last_error, '') NOT LIKE 'nonce_integrity:%'`,
    args: [itemId, kind, intent.businessKey, now, now, now],
  });
  return reopened.rowCount === 1;
}

async function blockedByIntegrityFinding(intent: ReservedIntent) {
  const kind = workKind(intent);
  if (!kind) return false;
  const result = await dbClient.execute({
    sql: `SELECT item_id FROM tokenless_scheduled_work_items
          WHERE kind = ? AND subject_key = ? AND state = 'dead'
            AND last_error LIKE 'nonce_integrity:%' LIMIT 1`,
    args: [kind, intent.businessKey],
  });
  return result.rows.length === 1;
}

async function upsertFinding(input: {
  address: Address;
  allocatorNextNonce: number;
  businessKey: string | null;
  businessKind: NonceBusinessKind | null;
  deploymentKey: string;
  diagnosticCode: string;
  networkPendingNonce: number;
  now: Date;
  reservedNonce: number;
  role: ManagedNonceRole;
  state: "pending" | "reconciliation_required";
}) {
  const findingId = stableId("nrf", `${input.deploymentKey}:${input.address.toLowerCase()}:${input.reservedNonce}`);
  await dbClient.execute({
    sql: `INSERT INTO tokenless_evm_nonce_recovery_findings
          (finding_id, deployment_key, signer_address, signer_role, reserved_nonce,
           business_kind, business_key, state, diagnostic_code, allocator_next_nonce,
           network_pending_nonce, first_detected_at, last_detected_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (deployment_key, signer_address, reserved_nonce) DO UPDATE
          SET signer_role = EXCLUDED.signer_role,
              business_kind = EXCLUDED.business_kind,
              business_key = EXCLUDED.business_key,
              state = CASE
                WHEN tokenless_evm_nonce_recovery_findings.state = 'reconciliation_required'
                  THEN 'reconciliation_required'
                ELSE EXCLUDED.state
              END,
              diagnostic_code = CASE
                WHEN tokenless_evm_nonce_recovery_findings.state = 'reconciliation_required'
                  THEN tokenless_evm_nonce_recovery_findings.diagnostic_code
                ELSE EXCLUDED.diagnostic_code
              END,
              allocator_next_nonce = EXCLUDED.allocator_next_nonce,
              network_pending_nonce = EXCLUDED.network_pending_nonce,
              last_detected_at = EXCLUDED.last_detected_at,
              resolved_at = NULL`,
    args: [
      findingId,
      input.deploymentKey,
      input.address.toLowerCase(),
      input.role,
      input.reservedNonce,
      input.businessKind,
      input.businessKey,
      input.state,
      input.diagnosticCode,
      input.allocatorNextNonce,
      input.networkPendingNonce,
      input.now,
      input.now,
    ],
  });
}

async function resolveConsumedFindings(input: {
  address: Address;
  deploymentKey: string;
  networkPendingNonce: number;
  now: Date;
}) {
  await dbClient.execute({
    sql: `UPDATE tokenless_evm_nonce_recovery_findings
          SET state = 'resolved', resolved_at = ?, last_detected_at = ?
          WHERE deployment_key = ? AND signer_address = ? AND state <> 'resolved'
            AND reserved_nonce < ?`,
    args: [input.now, input.now, input.deploymentKey, input.address.toLowerCase(), input.networkPendingNonce],
  });
}

export async function sweepManagedEvmNonceDrift(
  input: {
    config?: TokenlessChainConfig;
    limit?: number;
    now?: Date;
    runtime?: TokenlessChainRuntime;
  } = {},
) {
  const config = input.config ?? loadTokenlessChainConfig();
  const runtime = input.runtime ?? getTokenlessChainRuntime(config);
  const now = input.now ?? new Date();
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const roles = [
    runtime.prepaidAccount
      ? { address: getAddress(runtime.prepaidAccount.address), role: "prepaid_funder" as const }
      : null,
    runtime.relayerAccount
      ? { address: getAddress(runtime.relayerAccount.address), role: "gas_only_relayer" as const }
      : null,
    runtime.surpriseBonusAccount
      ? { address: getAddress(runtime.surpriseBonusAccount.address), role: "surprise_bonus_funder" as const }
      : null,
  ].filter((value): value is { address: Address; role: ManagedNonceRole } => value !== null);
  const summary = { checked: 0, pending: 0, reconciliationRequired: 0, reopened: 0, unavailable: 0 };
  for (const role of roles.slice(0, limit)) {
    summary.checked += 1;
    let networkPendingNonce: number;
    try {
      networkPendingNonce = safeNonce(
        await runtime.publicClient.getTransactionCount({ address: role.address, blockTag: "pending" }),
        "Network pending nonce",
      );
    } catch {
      summary.unavailable += 1;
      continue;
    }
    const allocator = await dbClient.execute({
      sql: `SELECT next_nonce FROM tokenless_chain_signer_nonces
            WHERE deployment_key = ? AND signer_address = ? LIMIT 1`,
      args: [config.deploymentKey, role.address.toLowerCase()],
    });
    const allocatorRow = allocator.rows[0] as Row | undefined;
    if (!allocatorRow) continue;
    const allocatorNextNonce = safeNonce(allocatorRow.next_nonce, "Allocator next nonce");
    await resolveConsumedFindings({
      address: role.address,
      deploymentKey: config.deploymentKey,
      networkPendingNonce,
      now,
    });
    if (allocatorNextNonce <= networkPendingNonce) continue;
    const intents = await reservedIntents({ deploymentKey: config.deploymentKey, role: role.role });
    const exactCandidates = intents.filter(intent => intent.nonce === networkPendingNonce);
    if (exactCandidates.length !== 1) {
      await upsertFinding({
        address: role.address,
        allocatorNextNonce,
        businessKey: null,
        businessKind: null,
        deploymentKey: config.deploymentKey,
        diagnosticCode: exactCandidates.length > 1 ? "duplicate_reserved_nonce" : "orphaned_nonce_gap",
        networkPendingNonce,
        now,
        reservedNonce: networkPendingNonce,
        role: role.role,
        state: "reconciliation_required",
      });
      summary.reconciliationRequired += 1;
      continue;
    }
    const candidate = exactCandidates[0]!;
    const recoverable = structurallyRecoverable(candidate) && !(await blockedByIntegrityFinding(candidate));
    if (recoverable && (await reopenIntent(candidate, now))) summary.reopened += 1;
    await upsertFinding({
      address: role.address,
      allocatorNextNonce,
      businessKey: candidate.businessKey,
      businessKind: candidate.businessKind,
      deploymentKey: config.deploymentKey,
      diagnosticCode: recoverable ? "reserved_nonce_recovery_due" : "reserved_nonce_reconciliation_required",
      networkPendingNonce,
      now,
      reservedNonce: candidate.nonce,
      role: role.role,
      state: recoverable ? "pending" : "reconciliation_required",
    });
    if (recoverable) summary.pending += 1;
    else summary.reconciliationRequired += 1;
  }
  return summary;
}

export async function unresolvedManagedEvmNonceFindings() {
  const result = await dbClient.execute(
    `SELECT COUNT(*) AS unresolved,
            COUNT(*) FILTER (WHERE state = 'reconciliation_required') AS reconciliation_required
     FROM tokenless_evm_nonce_recovery_findings WHERE state <> 'resolved'`,
  );
  const row = result.rows[0] as Row | undefined;
  return {
    unresolved: safeNonce(row?.unresolved ?? 0, "Unresolved nonce finding count"),
    reconciliationRequired: safeNonce(row?.reconciliation_required ?? 0, "Nonce reconciliation finding count"),
  };
}
