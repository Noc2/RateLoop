import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import { getLiveFeedbackBonusAwardDependencies } from "~~/lib/tokenless/feedbackBonusAwardLiveDependencies";
import type { FeedbackBonusHumanWalletAuthorization } from "~~/lib/tokenless/feedbackBonusHumanWalletExecution";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
const ATOMIC_PATTERN = /^[1-9][0-9]*$/u;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/u;

export type FeedbackBonusAwardInboxItem = {
  workspaceId: string;
  opportunityId: string;
  feedbackId: string;
  feedbackBody: string;
  responseHash: string;
  payoutCommitment: string;
  remainingPoolAtomic: string;
  depositedPoolAtomic: string;
  feedbackDeadline: string;
  awardDeadline: string;
  pool: { chainId: string; contractAddress: string; poolId: string };
};

export type FeedbackBonusAwardReceipt = {
  transactionHash: string;
  confirmedAt: Date;
};

export type PreparedFeedbackBonusAward = {
  intentId: string;
  workspaceId: string;
  opportunityId: string;
  feedbackId: string;
  responseHash: string;
  voteKey: string;
  payoutCommitment: string;
  awarderWallet: string;
  amountAtomic: string;
  pool: { chainId: string; contractAddress: string; poolId: string };
  confirmedReceipt: FeedbackBonusAwardReceipt | null;
};

export type FeedbackBonusAwardRepository = {
  listEligible(input: { workspaceId: string; awarderAccount: string; now: Date }): Promise<Row[]>;
  prepare(input: {
    workspaceId: string;
    awarderAccount: string;
    feedbackId: string;
    amountAtomic: string;
    idempotencyKey: string;
    now: Date;
  }): Promise<PreparedFeedbackBonusAward>;
  confirm(input: PreparedFeedbackBonusAward & FeedbackBonusAwardReceipt): Promise<void>;
  fail(input: { intentId: string; failureCode: string; now: Date }): Promise<void>;
};

export type FeedbackBonusAwardDependencies = {
  repository: FeedbackBonusAwardRepository;
  readFeedbackBody(input: { bodyReference: string; workspaceId: string; awarderAccount: string }): Promise<string>;
  prepareHumanAward(input: PreparedFeedbackBonusAward): Promise<FeedbackBonusHumanWalletAuthorization>;
  confirmHumanAward(input: {
    award: PreparedFeedbackBonusAward;
    transactionHash: string;
  }): Promise<FeedbackBonusAwardReceipt>;
};

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function date(value: unknown, field: string) {
  const result = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(result.getTime())) throw new Error(`Stored ${field} is invalid.`);
  return result;
}

function atomic(value: unknown, field: string) {
  if (typeof value !== "string" || !ATOMIC_PATTERN.test(value)) {
    throw new TokenlessServiceError(
      `${field} must be a positive USDC atomic amount.`,
      400,
      "invalid_feedback_bonus_award",
    );
  }
  return BigInt(value).toString();
}

function idempotencyKey(value: unknown) {
  if (typeof value !== "string" || !IDEMPOTENCY_PATTERN.test(value)) {
    throw new TokenlessServiceError("A valid idempotency key is required.", 400, "invalid_feedback_bonus_award");
  }
  return value;
}

function exactPrepared(row: Row): PreparedFeedbackBonusAward {
  const confirmedTransactionHash = text(row, "confirmed_transaction_hash");
  const confirmedAt = row.confirmed_at;
  if ((confirmedTransactionHash === null) !== (confirmedAt === null || confirmedAt === undefined)) {
    throw new Error("Stored Feedback Bonus receipt is incomplete.");
  }
  return {
    intentId: text(row, "intent_id")!,
    workspaceId: text(row, "workspace_id")!,
    opportunityId: text(row, "opportunity_id")!,
    feedbackId: text(row, "feedback_id")!,
    responseHash: text(row, "response_hash")!,
    voteKey: text(row, "vote_key")!,
    payoutCommitment: text(row, "payout_commitment")!,
    awarderWallet: text(row, "awarder_wallet")!,
    amountAtomic: text(row, "amount_atomic")!,
    pool: {
      chainId: text(row, "chain_id")!,
      contractAddress: text(row, "contract_address")!,
      poolId: text(row, "pool_id")!,
    },
    confirmedReceipt:
      confirmedTransactionHash === null
        ? null
        : { transactionHash: confirmedTransactionHash, confirmedAt: date(confirmedAt, "award confirmation") },
  };
}

async function withTransaction<Value>(operation: (client: PoolClient) => Promise<Value>) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const value = await operation(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const databaseFeedbackBonusAwardRepository: FeedbackBonusAwardRepository = {
  async listEligible(input) {
    const result = await dbPool.query(
      `SELECT p.*, f.feedback_id, f.response_hash, f.vote_key, f.payout_commitment, f.body_reference
       FROM tokenless_feedback_bonus_pools p
       JOIN tokenless_feedback_bonus_feedback f
         ON f.workspace_id = p.workspace_id AND f.opportunity_id = p.opportunity_id
       LEFT JOIN tokenless_feedback_bonus_award_intents i
         ON i.workspace_id = f.workspace_id AND i.opportunity_id = f.opportunity_id AND i.feedback_id = f.feedback_id
       WHERE p.workspace_id = $1 AND p.awarder_account = $2
         AND p.awarder_wallet IS NOT NULL
         AND p.status IN ('funded','award_open')
         AND p.feedback_deadline < $3 AND p.award_deadline >= $3
         AND p.awarded_amount_atomic < p.deposited_amount_atomic
         AND f.eligibility_status = 'eligible' AND f.awarded_at IS NULL AND i.intent_id IS NULL
       ORDER BY p.award_deadline ASC, f.registered_at ASC`,
      [input.workspaceId, input.awarderAccount, input.now],
    );
    return result.rows as Row[];
  },

  async prepare(input) {
    return withTransaction(async client => {
      const previous = await client.query(
        `SELECT i.*, p.chain_id, p.contract_address, p.pool_id, p.awarder_wallet,
                f.response_hash, f.vote_key, f.payout_commitment,
                r.transaction_hash AS confirmed_transaction_hash, r.confirmed_at
         FROM tokenless_feedback_bonus_award_intents i
         JOIN tokenless_feedback_bonus_pools p
           ON p.workspace_id = i.workspace_id AND p.opportunity_id = i.opportunity_id
         JOIN tokenless_feedback_bonus_feedback f
           ON f.workspace_id = i.workspace_id AND f.opportunity_id = i.opportunity_id AND f.feedback_id = i.feedback_id
         LEFT JOIN tokenless_feedback_bonus_award_receipts r ON r.intent_id = i.intent_id
         WHERE i.workspace_id = $1 AND i.idempotency_key = $2 FOR UPDATE OF i`,
        [input.workspaceId, input.idempotencyKey],
      );
      const existing = previous.rows[0] as Row | undefined;
      if (existing) {
        if (
          text(existing, "feedback_id") !== input.feedbackId ||
          text(existing, "amount_atomic") !== input.amountAtomic ||
          text(existing, "awarder_account") !== input.awarderAccount
        ) {
          throw new TokenlessServiceError(
            "This idempotency key is already bound to a different award.",
            409,
            "feedback_bonus_award_conflict",
          );
        }
        if (text(existing, "status") === "failed") {
          const retried = await client.query(
            `UPDATE tokenless_feedback_bonus_award_intents
             SET status = 'prepared', failure_code = NULL, updated_at = $2
             WHERE intent_id = $1 RETURNING *`,
            [text(existing, "intent_id"), input.now],
          );
          return exactPrepared({ ...existing, ...(retried.rows[0] as Row), confirmed_at: null });
        }
        return exactPrepared(existing);
      }
      const locked = await client.query(
        `SELECT p.*, f.feedback_id, f.response_hash, f.vote_key, f.payout_commitment, f.eligibility_status, f.awarded_at
         FROM tokenless_feedback_bonus_pools p
         JOIN tokenless_feedback_bonus_feedback f
           ON f.workspace_id = p.workspace_id AND f.opportunity_id = p.opportunity_id
         WHERE p.workspace_id = $1 AND f.feedback_id = $2 FOR UPDATE OF p, f`,
        [input.workspaceId, input.feedbackId],
      );
      const row = locked.rows[0] as Row | undefined;
      if (!row || !text(row, "awarder_wallet")) {
        throw new TokenlessServiceError(
          "Feedback Bonus award authority is not frozen for this pool.",
          409,
          "feedback_bonus_awarder_wallet_unavailable",
        );
      }
      const remaining = BigInt(text(row, "deposited_amount_atomic")!) - BigInt(text(row, "awarded_amount_atomic")!);
      if (
        text(row, "awarder_account") !== input.awarderAccount ||
        text(row, "eligibility_status") !== "eligible" ||
        row.awarded_at !== null ||
        !["funded", "award_open"].includes(text(row, "status") ?? "") ||
        date(row.feedback_deadline, "feedback deadline") >= input.now ||
        date(row.award_deadline, "award deadline") < input.now
      ) {
        throw new TokenlessServiceError(
          "This feedback is not awardable by this account.",
          403,
          "feedback_bonus_award_not_authorized",
        );
      }
      if (BigInt(input.amountAtomic) > remaining) {
        throw new TokenlessServiceError(
          `This pool has ${remaining} USDC atomic units left.`,
          409,
          "feedback_bonus_pool_insufficient",
        );
      }
      const intentId = `fbai_${randomUUID().replaceAll("-", "")}`;
      const inserted = await client.query(
        `INSERT INTO tokenless_feedback_bonus_award_intents
         (intent_id, workspace_id, opportunity_id, feedback_id, idempotency_key, awarder_account,
          payout_commitment, amount_atomic, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'prepared',$9,$9)
         RETURNING *`,
        [
          intentId,
          input.workspaceId,
          text(row, "opportunity_id"),
          input.feedbackId,
          input.idempotencyKey,
          input.awarderAccount,
          text(row, "payout_commitment"),
          input.amountAtomic,
          input.now,
        ],
      );
      return exactPrepared({ ...row, ...(inserted.rows[0] as Row) });
    });
  },

  async confirm(input) {
    await withTransaction(async client => {
      const current = await client.query(
        `SELECT i.*, p.awarded_amount_atomic, p.deposited_amount_atomic
         FROM tokenless_feedback_bonus_award_intents i
         JOIN tokenless_feedback_bonus_pools p
           ON p.workspace_id = i.workspace_id AND p.opportunity_id = i.opportunity_id
         WHERE i.intent_id = $1 FOR UPDATE OF i, p`,
        [input.intentId],
      );
      const row = current.rows[0] as Row | undefined;
      if (!row) throw new Error("Prepared Feedback Bonus award disappeared.");
      if (text(row, "status") === "confirmed") return;
      if (text(row, "status") !== "prepared" && text(row, "status") !== "submitted") {
        throw new Error("Prepared Feedback Bonus award is no longer confirmable.");
      }
      const nextAwarded = BigInt(text(row, "awarded_amount_atomic")!) + BigInt(input.amountAtomic);
      if (nextAwarded > BigInt(text(row, "deposited_amount_atomic")!)) {
        throw new Error("Confirmed Feedback Bonus award exceeds the frozen pool.");
      }
      await client.query(
        `INSERT INTO tokenless_feedback_bonus_award_receipts
         (receipt_id,intent_id,chain_id,contract_address,transaction_hash,pool_id,response_hash,
          payout_commitment,amount_atomic,confirmed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (intent_id) DO NOTHING`,
        [
          `fbar_${randomUUID().replaceAll("-", "")}`,
          input.intentId,
          input.pool.chainId,
          input.pool.contractAddress,
          input.transactionHash.toLowerCase(),
          input.pool.poolId,
          input.responseHash,
          input.payoutCommitment,
          input.amountAtomic,
          input.confirmedAt,
        ],
      );
      await client.query(
        `UPDATE tokenless_feedback_bonus_award_intents SET status = 'confirmed', updated_at = $2 WHERE intent_id = $1`,
        [input.intentId, input.confirmedAt],
      );
      await client.query(
        `UPDATE tokenless_feedback_bonus_feedback SET awarded_at = $4
         WHERE workspace_id = $1 AND opportunity_id = $2 AND feedback_id = $3 AND awarded_at IS NULL`,
        [input.workspaceId, input.opportunityId, input.feedbackId, input.confirmedAt],
      );
      await client.query(
        `UPDATE tokenless_feedback_bonus_pools
         SET awarded_amount_atomic = $3, status = CASE WHEN $3 = deposited_amount_atomic THEN 'exhausted' ELSE 'award_open' END,
             projection_revision = projection_revision + 1, synced_at = $4
         WHERE workspace_id = $1 AND opportunity_id = $2`,
        [input.workspaceId, input.opportunityId, nextAwarded.toString(), input.confirmedAt],
      );
    });
  },

  async fail(input) {
    await dbPool.query(
      `UPDATE tokenless_feedback_bonus_award_intents
       SET status = 'failed', failure_code = $2, updated_at = $3
       WHERE intent_id = $1 AND status IN ('prepared','submitted')`,
      [input.intentId, input.failureCode, input.now],
    );
  },
};

export function createFeedbackBonusAwardService(dependencies: FeedbackBonusAwardDependencies) {
  async function confirmOrRequireReconciliation(
    prepared: PreparedFeedbackBonusAward,
    receipt: FeedbackBonusAwardReceipt,
  ) {
    try {
      await dependencies.repository.confirm({ ...prepared, ...receipt });
    } catch {
      throw new TokenlessServiceError(
        "The Feedback Bonus was confirmed onchain but its local receipt still needs reconciliation.",
        503,
        "feedback_bonus_receipt_reconciliation_required",
        true,
      );
    }
    return { intentId: prepared.intentId, status: "confirmed" as const, receipt };
  }

  return {
    async list(input: { accountAddress: string; workspaceId: string; now?: Date }) {
      const awarderAccount = normalizeAccountSubject(input.accountAddress);
      const now = input.now ?? new Date();
      const rows = await dependencies.repository.listEligible({ workspaceId: input.workspaceId, awarderAccount, now });
      const items: FeedbackBonusAwardInboxItem[] = [];
      for (const row of rows) {
        const feedbackBody = (
          await dependencies.readFeedbackBody({
            bodyReference: text(row, "body_reference")!,
            workspaceId: input.workspaceId,
            awarderAccount,
          })
        ).trim();
        if (!feedbackBody) continue;
        const deposited = BigInt(text(row, "deposited_amount_atomic")!);
        const awarded = BigInt(text(row, "awarded_amount_atomic")!);
        items.push({
          workspaceId: input.workspaceId,
          opportunityId: text(row, "opportunity_id")!,
          feedbackId: text(row, "feedback_id")!,
          feedbackBody,
          responseHash: text(row, "response_hash")!,
          payoutCommitment: text(row, "payout_commitment")!,
          remainingPoolAtomic: (deposited - awarded).toString(),
          depositedPoolAtomic: deposited.toString(),
          feedbackDeadline: date(row.feedback_deadline, "feedback deadline").toISOString(),
          awardDeadline: date(row.award_deadline, "award deadline").toISOString(),
          pool: {
            chainId: text(row, "chain_id")!,
            contractAddress: text(row, "contract_address")!,
            poolId: text(row, "pool_id")!,
          },
        });
      }
      return { items };
    },

    async prepareAward(input: {
      accountAddress: string;
      workspaceId: string;
      feedbackId: string;
      amountAtomic: string;
      idempotencyKey: string;
      now?: Date;
    }) {
      const awarderAccount = normalizeAccountSubject(input.accountAddress);
      const prepared = await dependencies.repository.prepare({
        workspaceId: input.workspaceId,
        awarderAccount,
        feedbackId: input.feedbackId,
        amountAtomic: atomic(input.amountAtomic, "Award amount"),
        idempotencyKey: idempotencyKey(input.idempotencyKey),
        now: input.now ?? new Date(),
      });
      if (prepared.confirmedReceipt) {
        return { intentId: prepared.intentId, status: "confirmed" as const, receipt: prepared.confirmedReceipt };
      }
      const authorization = await dependencies.prepareHumanAward(prepared);
      return {
        intentId: prepared.intentId,
        status: "human_wallet_required" as const,
        authorization,
      };
    },

    async confirmAward(input: {
      accountAddress: string;
      workspaceId: string;
      feedbackId: string;
      amountAtomic: string;
      idempotencyKey: string;
      transactionHash: string;
      now?: Date;
    }) {
      const awarderAccount = normalizeAccountSubject(input.accountAddress);
      const prepared = await dependencies.repository.prepare({
        workspaceId: input.workspaceId,
        awarderAccount,
        feedbackId: input.feedbackId,
        amountAtomic: atomic(input.amountAtomic, "Award amount"),
        idempotencyKey: idempotencyKey(input.idempotencyKey),
        now: input.now ?? new Date(),
      });
      if (prepared.confirmedReceipt) {
        return { intentId: prepared.intentId, status: "confirmed" as const, receipt: prepared.confirmedReceipt };
      }
      const receipt = await dependencies.confirmHumanAward({
        award: prepared,
        transactionHash: input.transactionHash,
      });
      return confirmOrRequireReconciliation(prepared, receipt);
    },
  };
}

let liveDependencies: Omit<FeedbackBonusAwardDependencies, "repository"> | null = null;

export function installFeedbackBonusAwardDependencies(
  dependencies: Omit<FeedbackBonusAwardDependencies, "repository"> | null,
) {
  liveDependencies = dependencies;
}

export function feedbackBonusAwardDependenciesInstalled() {
  return true;
}

function liveService() {
  const dependencies = liveDependencies ?? getLiveFeedbackBonusAwardDependencies();
  return createFeedbackBonusAwardService({ repository: databaseFeedbackBonusAwardRepository, ...dependencies });
}

export function listFeedbackBonusAwardInbox(input: { accountAddress: string; workspaceId: string }) {
  return liveService().list(input);
}

export function prepareFeedbackBonusAwardForHuman(input: {
  accountAddress: string;
  workspaceId: string;
  feedbackId: string;
  amountAtomic: string;
  idempotencyKey: string;
}) {
  return liveService().prepareAward(input);
}

export function confirmFeedbackBonusAwardForHuman(input: {
  accountAddress: string;
  workspaceId: string;
  feedbackId: string;
  amountAtomic: string;
  idempotencyKey: string;
  transactionHash: string;
}) {
  return liveService().confirmAward(input);
}
