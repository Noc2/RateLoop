import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { getAddress, isAddress, isHash, zeroAddress } from "viem";
import { dbClient, dbPool } from "~~/lib/db";
import type { PreparedHumanReviewRequest } from "~~/lib/tokenless/humanReviewRequestPreparation";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type Hash = `0x${string}`;

const ATOMIC = /^[1-9][0-9]*$/u;
const PROFILE_HASH = /^sha256:[0-9a-f]{64}$/u;
const BODY_REFERENCE = /^rateloop\.feedback-body\.v1:(public_rater_response|assurance_response):[A-Za-z0-9_-]{1,160}$/u;

export type FeedbackBonusPoolTerms = {
  workspaceId: string;
  opportunityId: string;
  agentId: string;
  requestProfile: { id: string; version: number; hash: `sha256:${string}` };
  reviewId: Hash;
  contentId: Hash;
  admissionPolicyHash: Hash;
  depositedAmountAtomic: string;
  feedbackDeadline: Date;
  awardDeadline: Date;
  humanAwarderSubject: string;
  awarderWallet: string;
  funderWallet: string;
  consent: {
    reference: string;
    authorizedBy: string;
    baseMaximumChargeAtomic: string;
    feedbackBonusMaximumAtomic: string;
    totalMaximumConsentAtomic: string;
  };
};

export type FeedbackBonusPoolCreatedReceipt = {
  chainId: number;
  contractAddress: string;
  transactionHash: Hash;
  blockNumber: bigint;
  logIndex: number;
  event: {
    poolId: string;
    reviewId: Hash;
    contentId: Hash;
    admissionPolicyHash: Hash;
    payer: string;
    funder: string;
    awarder: string;
    amountAtomic: string;
    feedbackDeadline: Date;
    awardDeadline: Date;
  };
};

export type FeedbackBonusPoolBinding = {
  schemaVersion: "rateloop.feedback-bonus-pool-binding.v1";
  workspaceId: string;
  opportunityId: string;
  chainId: number;
  contractAddress: string;
  poolId: string;
  reviewId: Hash;
  contentId: Hash;
  depositedAmountAtomic: string;
  feedbackDeadline: string;
  awardDeadline: string;
  replayed: boolean;
};

export type FeedbackBonusPoolDependencies = {
  createAndFundPool(input: {
    idempotencyKey: string;
    reviewId: Hash;
    contentId: Hash;
    admissionPolicyHash: Hash;
    amountAtomic: string;
    feedbackDeadline: Date;
    awardDeadline: Date;
    funderWallet: string;
    awarderWallet: string;
  }): Promise<FeedbackBonusPoolCreatedReceipt>;
};

export type FeedbackRegisteredReceipt = {
  chainId: number;
  contractAddress: string;
  transactionHash: Hash;
  blockNumber: bigint;
  logIndex: number;
  event: {
    poolId: string;
    feedbackKey: Hash;
    responseHash: Hash;
    voteKey: string;
    payoutCommitment: Hash;
  };
};

function value(row: Row | undefined, key: string) {
  const entry = row?.[key];
  return entry === null || entry === undefined ? null : String(entry);
}

function exactAddress(input: string, field: string) {
  if (!isAddress(input) || input.toLowerCase() === zeroAddress) {
    throw new TokenlessServiceError(
      `${field} must resolve to a non-zero EVM wallet.`,
      409,
      "feedback_bonus_wallet_unresolved",
    );
  }
  return getAddress(input);
}

function exactHash(input: string, field: string) {
  if (!isHash(input)) {
    throw new TokenlessServiceError(`${field} must be bytes32.`, 409, "feedback_bonus_chain_binding_invalid");
  }
  return input.toLowerCase() as Hash;
}

function exactAtomic(input: string, field: string) {
  if (!ATOMIC.test(input)) {
    throw new TokenlessServiceError(
      `${field} must be a positive USDC atomic amount.`,
      409,
      "feedback_bonus_economics_invalid",
    );
  }
  return BigInt(input);
}

function exactUnsignedAtomic(input: string, field: string) {
  if (!/^(0|[1-9][0-9]*)$/u.test(input)) {
    throw new TokenlessServiceError(`${field} must be a USDC atomic amount.`, 409, "feedback_bonus_economics_invalid");
  }
  return BigInt(input);
}

function exactDate(input: Date, field: string) {
  if (!(input instanceof Date) || !Number.isFinite(input.getTime())) {
    throw new TokenlessServiceError(`${field} is invalid.`, 409, "feedback_bonus_deadline_invalid");
  }
  return input;
}

function idempotencyKey(input: FeedbackBonusPoolTerms) {
  return `feedback-bonus-pool:${createHash("sha256")
    .update(`${input.workspaceId}\0${input.opportunityId}\0${input.requestProfile.hash}\0${input.reviewId}`)
    .digest("hex")}`;
}

function canonicalTerms(input: FeedbackBonusPoolTerms) {
  if (
    !input.workspaceId ||
    !input.opportunityId ||
    !input.agentId ||
    !input.requestProfile.id ||
    !Number.isSafeInteger(input.requestProfile.version) ||
    input.requestProfile.version < 1 ||
    !PROFILE_HASH.test(input.requestProfile.hash) ||
    !input.humanAwarderSubject ||
    !input.consent.reference ||
    !input.consent.authorizedBy
  ) {
    throw new TokenlessServiceError(
      "Frozen Feedback Bonus terms are incomplete.",
      409,
      "feedback_bonus_binding_invalid",
    );
  }
  const amount = exactAtomic(input.depositedAmountAtomic, "Feedback Bonus pool");
  const bonusConsent = exactAtomic(input.consent.feedbackBonusMaximumAtomic, "Feedback Bonus consent");
  const baseConsent = exactUnsignedAtomic(input.consent.baseMaximumChargeAtomic, "Base-review consent");
  const totalConsent = exactUnsignedAtomic(input.consent.totalMaximumConsentAtomic, "Total payment consent");
  if (amount !== bonusConsent || baseConsent < 0n || totalConsent !== baseConsent + bonusConsent) {
    throw new TokenlessServiceError(
      "Feedback Bonus consent must be separate from and additive to the base review maximum.",
      409,
      "feedback_bonus_consent_mismatch",
    );
  }
  const awarderWallet = exactAddress(input.awarderWallet, "Feedback Bonus human awarder");
  const funderWallet = exactAddress(input.funderWallet, "Feedback Bonus refund recipient");
  const feedbackDeadline = exactDate(input.feedbackDeadline, "Feedback deadline");
  const awardDeadline = exactDate(input.awardDeadline, "Award deadline");
  if (awardDeadline <= feedbackDeadline) {
    throw new TokenlessServiceError(
      "Feedback Bonus award deadline must follow the feedback deadline.",
      409,
      "feedback_bonus_deadline_invalid",
    );
  }
  return {
    ...input,
    reviewId: exactHash(input.reviewId, "Feedback Bonus review ID"),
    contentId: exactHash(input.contentId, "Feedback Bonus content ID"),
    admissionPolicyHash: exactHash(input.admissionPolicyHash, "Feedback Bonus admission policy"),
    depositedAmountAtomic: amount.toString(),
    awarderWallet,
    funderWallet,
    feedbackDeadline,
    awardDeadline,
  };
}

function assertPoolReceipt(terms: ReturnType<typeof canonicalTerms>, receipt: FeedbackBonusPoolCreatedReceipt) {
  const event = receipt.event;
  if (
    !Number.isSafeInteger(receipt.chainId) ||
    receipt.chainId < 1 ||
    !isHash(receipt.transactionHash) ||
    receipt.blockNumber < 1n ||
    !Number.isSafeInteger(receipt.logIndex) ||
    receipt.logIndex < 0 ||
    !ATOMIC.test(event.poolId) ||
    exactHash(event.reviewId, "PoolCreated review ID") !== terms.reviewId ||
    exactHash(event.contentId, "PoolCreated content ID") !== terms.contentId ||
    exactHash(event.admissionPolicyHash, "PoolCreated admission policy") !== terms.admissionPolicyHash ||
    exactAddress(event.funder, "PoolCreated funder") !== terms.funderWallet ||
    exactAddress(event.awarder, "PoolCreated awarder") !== terms.awarderWallet ||
    event.amountAtomic !== terms.depositedAmountAtomic ||
    event.feedbackDeadline.getTime() !== terms.feedbackDeadline.getTime() ||
    event.awardDeadline.getTime() !== terms.awardDeadline.getTime()
  ) {
    throw new TokenlessServiceError(
      "The chain receipt does not contain the exact frozen PoolCreated event.",
      502,
      "feedback_bonus_pool_receipt_mismatch",
    );
  }
  return {
    ...receipt,
    contractAddress: exactAddress(receipt.contractAddress, "Feedback Bonus contract"),
  };
}

function poolBinding(row: Row, replayed: boolean): FeedbackBonusPoolBinding {
  return {
    schemaVersion: "rateloop.feedback-bonus-pool-binding.v1",
    workspaceId: value(row, "workspace_id")!,
    opportunityId: value(row, "opportunity_id")!,
    chainId: Number(row.chain_id),
    contractAddress: value(row, "contract_address")!,
    poolId: value(row, "pool_id")!,
    reviewId: value(row, "review_id") as Hash,
    contentId: value(row, "content_id") as Hash,
    depositedAmountAtomic: value(row, "deposited_amount_atomic")!,
    feedbackDeadline: new Date(String(row.feedback_deadline)).toISOString(),
    awardDeadline: new Date(String(row.award_deadline)).toISOString(),
    replayed,
  };
}

function assertExistingPool(row: Row, terms: ReturnType<typeof canonicalTerms>) {
  if (
    value(row, "agent_id") !== terms.agentId ||
    value(row, "request_profile_id") !== terms.requestProfile.id ||
    Number(row.request_profile_version) !== terms.requestProfile.version ||
    value(row, "request_profile_hash") !== terms.requestProfile.hash ||
    value(row, "review_id") !== terms.reviewId ||
    value(row, "content_id") !== terms.contentId ||
    value(row, "awarder_account") !== terms.humanAwarderSubject ||
    getAddress(value(row, "awarder_wallet")!) !== terms.awarderWallet ||
    value(row, "deposited_amount_atomic") !== terms.depositedAmountAtomic ||
    new Date(String(row.feedback_deadline)).getTime() !== terms.feedbackDeadline.getTime() ||
    new Date(String(row.award_deadline)).getTime() !== terms.awardDeadline.getTime()
  ) {
    throw new TokenlessServiceError(
      "This opportunity is already bound to different Feedback Bonus terms.",
      409,
      "feedback_bonus_pool_conflict",
    );
  }
}

async function assertLocalFeedbackBinding(
  client: PoolClient,
  input: {
    workspaceId: string;
    opportunityId: string;
    bodyReference: string;
    responseHash: string;
    voteKey: string;
  },
) {
  const [, kind, responseId] = input.bodyReference.match(BODY_REFERENCE)!;
  const result =
    kind === "public_rater_response"
      ? await client.query(
          `SELECT r.response_hash,r.vote_key
           FROM tokenless_public_rater_responses r
           JOIN tokenless_agent_review_opportunities o
             ON o.operation_key=r.operation_key AND o.workspace_id=$1 AND o.opportunity_id=$2
           WHERE r.response_id=$3 LIMIT 1`,
          [input.workspaceId, input.opportunityId, responseId],
        )
      : await client.query(
          `SELECT r.response_digest AS response_hash,r.reviewer_key AS vote_key
           FROM tokenless_assurance_responses r
           JOIN tokenless_agent_review_opportunities o
             ON o.run_id=r.run_id AND o.workspace_id=$1 AND o.opportunity_id=$2
           WHERE r.response_id=$3 LIMIT 1`,
          [input.workspaceId, input.opportunityId, responseId],
        );
  const row = result.rows[0] as Row | undefined;
  if (
    !row ||
    value(row, "response_hash")?.toLowerCase() !== input.responseHash.toLowerCase() ||
    value(row, "vote_key")?.toLowerCase() !== input.voteKey.toLowerCase()
  ) {
    throw new TokenlessServiceError(
      "The local feedback body is not attached to this opportunity and exact chain response.",
      409,
      "feedback_bonus_body_binding_mismatch",
    );
  }
}

export function createFeedbackBonusPoolService(dependencies?: FeedbackBonusPoolDependencies) {
  return async function ensureFeedbackBonusPool(input: FeedbackBonusPoolTerms): Promise<FeedbackBonusPoolBinding> {
    const terms = canonicalTerms(input);
    const client = await dbPool.connect();
    const lockKey = `feedback-bonus:${terms.workspaceId}:${terms.opportunityId}`;
    try {
      await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockKey]);
      const frozen = await client.query(
        `SELECT p.feedback_bonus_enabled,p.feedback_bonus_pool_atomic,p.feedback_bonus_awarder_kind,
                p.feedback_bonus_awarder_account,p.feedback_bonus_award_window_seconds,p.created_by
         FROM tokenless_agent_review_opportunities o
         JOIN tokenless_agent_review_request_profiles p
           ON p.workspace_id=o.workspace_id AND p.profile_id=o.request_profile_id
          AND p.version=o.request_profile_version AND p.profile_hash=o.request_profile_hash
         WHERE o.workspace_id=$1 AND o.opportunity_id=$2 AND o.agent_id=$3
           AND p.profile_id=$4 AND p.version=$5 AND p.profile_hash=$6
         LIMIT 1`,
        [
          terms.workspaceId,
          terms.opportunityId,
          terms.agentId,
          terms.requestProfile.id,
          terms.requestProfile.version,
          terms.requestProfile.hash,
        ],
      );
      const profile = frozen.rows[0] as Row | undefined;
      const configuredSubject =
        value(profile, "feedback_bonus_awarder_kind") === "designated"
          ? value(profile, "feedback_bonus_awarder_account")
          : value(profile, "created_by");
      if (
        !profile ||
        !(profile.feedback_bonus_enabled === true || profile.feedback_bonus_enabled === "t") ||
        value(profile, "feedback_bonus_pool_atomic") !== terms.depositedAmountAtomic ||
        configuredSubject !== terms.humanAwarderSubject ||
        value(profile, "created_by") !== terms.consent.authorizedBy ||
        Number(profile.feedback_bonus_award_window_seconds) * 1_000 !==
          terms.awardDeadline.getTime() - terms.feedbackDeadline.getTime()
      ) {
        throw new TokenlessServiceError(
          "The opportunity does not carry these exact enabled and human-authorized Feedback Bonus terms.",
          409,
          "feedback_bonus_profile_binding_mismatch",
        );
      }
      const existing = await client.query(
        `SELECT * FROM tokenless_feedback_bonus_pools WHERE workspace_id=$1 AND opportunity_id=$2 LIMIT 1`,
        [terms.workspaceId, terms.opportunityId],
      );
      if (existing.rows[0]) {
        assertExistingPool(existing.rows[0] as Row, terms);
        return poolBinding(existing.rows[0] as Row, true);
      }
      if (!dependencies) {
        throw new TokenlessServiceError(
          "Feedback Bonus funding is unavailable until the hosted service can return an exact PoolCreated receipt.",
          503,
          "feedback_bonus_pool_execution_unavailable",
          true,
        );
      }
      const receipt = assertPoolReceipt(
        terms,
        await dependencies.createAndFundPool({
          idempotencyKey: idempotencyKey(terms),
          reviewId: terms.reviewId,
          contentId: terms.contentId,
          admissionPolicyHash: terms.admissionPolicyHash,
          amountAtomic: terms.depositedAmountAtomic,
          feedbackDeadline: terms.feedbackDeadline,
          awardDeadline: terms.awardDeadline,
          funderWallet: terms.funderWallet,
          awarderWallet: terms.awarderWallet,
        }),
      );
      const inserted = await client.query(
        `INSERT INTO tokenless_feedback_bonus_pools
         (workspace_id,opportunity_id,agent_id,request_profile_id,request_profile_version,request_profile_hash,
          chain_id,contract_address,pool_id,review_id,content_id,awarder_account,awarder_wallet,deposited_amount_atomic,
          awarded_amount_atomic,feedback_deadline,award_deadline,status,projection_revision,synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,0,$15,$16,'funded',1,$17)
         RETURNING *`,
        [
          terms.workspaceId,
          terms.opportunityId,
          terms.agentId,
          terms.requestProfile.id,
          terms.requestProfile.version,
          terms.requestProfile.hash,
          receipt.chainId,
          receipt.contractAddress.toLowerCase(),
          receipt.event.poolId,
          terms.reviewId,
          terms.contentId,
          terms.humanAwarderSubject,
          terms.awarderWallet.toLowerCase(),
          terms.depositedAmountAtomic,
          terms.feedbackDeadline,
          terms.awardDeadline,
          new Date(),
        ],
      );
      return poolBinding(inserted.rows[0] as Row, false);
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]).catch(() => undefined);
      client.release();
    }
  };
}

export const ensureFeedbackBonusPool = createFeedbackBonusPoolService();

function bytes32(label: string, values: readonly string[]): Hash {
  return `0x${createHash("sha256")
    .update(`${label}\0${values.join("\0")}`)
    .digest("hex")}`;
}

async function resolveHumanWallet(subject: string) {
  if (isAddress(subject) && subject.toLowerCase() !== zeroAddress) return getAddress(subject);
  // Wallet bindings currently expose funding, payout, and recovery purposes.
  // Awarding controls requester-funded USDC without receiving it, so the
  // human's purpose-bound funding wallet is the only accepted signing wallet.
  const result = await dbClient.execute({
    sql: `SELECT wallet_address FROM tokenless_wallet_bindings
          WHERE principal_id=? AND purpose='funding' AND revoked_at IS NULL
          ORDER BY last_used_at DESC LIMIT 1`,
    args: [subject],
  });
  const wallet = value(result.rows[0] as Row | undefined, "wallet_address");
  return exactAddress(wallet ?? "", "Feedback Bonus human wallet");
}

export async function ensureFeedbackBonusPoolForDelivery(input: {
  workspaceId: string;
  agentId: string;
  opportunityId: string;
  admissionPolicyHash: `sha256:${string}` | Hash;
  preparation: PreparedHumanReviewRequest;
  feedbackDeadline: Date;
  poolService?: ReturnType<typeof createFeedbackBonusPoolService>;
}) {
  if (!input.preparation.feedbackBonusEconomics.enabled) return null;
  const profile = await dbClient.execute({
    sql: `SELECT p.created_by,p.feedback_bonus_awarder_kind,p.feedback_bonus_awarder_account
          FROM tokenless_agent_review_request_profiles p
          JOIN tokenless_agent_review_opportunities o
            ON o.workspace_id=p.workspace_id AND o.request_profile_id=p.profile_id
           AND o.request_profile_version=p.version AND o.request_profile_hash=p.profile_hash
          WHERE o.workspace_id=? AND o.opportunity_id=? AND o.agent_id=? LIMIT 1`,
    args: [input.workspaceId, input.opportunityId, input.agentId],
  });
  const row = profile.rows[0] as Row | undefined;
  const requesterSubject = value(row, "created_by");
  const awarderSubject =
    value(row, "feedback_bonus_awarder_kind") === "designated"
      ? value(row, "feedback_bonus_awarder_account")
      : requesterSubject;
  if (!requesterSubject || !awarderSubject) {
    throw new TokenlessServiceError(
      "The frozen Feedback Bonus human identities are unavailable.",
      409,
      "feedback_bonus_profile_binding_mismatch",
    );
  }
  const [funderWallet, awarderWallet] = await Promise.all([
    resolveHumanWallet(requesterSubject),
    resolveHumanWallet(awarderSubject),
  ]);
  const bonus = input.preparation.feedbackBonusEconomics;
  const awardDeadline = new Date(input.feedbackDeadline.getTime() + bonus.awardWindowSeconds! * 1_000);
  const profileReference = input.preparation.preparedRequest.requestProfile;
  const service = input.poolService ?? ensureFeedbackBonusPool;
  return service({
    workspaceId: input.workspaceId,
    opportunityId: input.opportunityId,
    agentId: input.agentId,
    requestProfile: {
      id: profileReference.id,
      version: profileReference.version,
      hash: profileReference.hash as `sha256:${string}`,
    },
    reviewId: bytes32("rateloop.feedback-bonus.review.v1", [input.workspaceId, input.opportunityId]),
    contentId: bytes32("rateloop.feedback-bonus.content.v1", [
      input.preparation.preparedRequest.contentCommitments.source,
      input.preparation.preparedRequest.contentCommitments.suggestion,
    ]),
    admissionPolicyHash: exactHash(
      input.admissionPolicyHash.replace(/^sha256:/u, "0x"),
      "Feedback Bonus admission policy",
    ),
    depositedAmountAtomic: bonus.poolAtomic,
    feedbackDeadline: input.feedbackDeadline,
    awardDeadline,
    humanAwarderSubject: awarderSubject,
    awarderWallet,
    funderWallet,
    consent: {
      reference: `request-profile:${profileReference.id}:${profileReference.version}:${profileReference.hash}`,
      authorizedBy: requesterSubject,
      baseMaximumChargeAtomic: input.preparation.maximumChargeAtomic,
      feedbackBonusMaximumAtomic: bonus.poolAtomic,
      totalMaximumConsentAtomic: input.preparation.maximumConsentAtomic,
    },
  });
}

export async function projectFeedbackRegistered(input: {
  workspaceId: string;
  opportunityId: string;
  feedbackId: string;
  bodyReference: string;
  receipt: FeedbackRegisteredReceipt;
  registeredAt: Date;
}) {
  if (!input.feedbackId || !BODY_REFERENCE.test(input.bodyReference)) {
    throw new TokenlessServiceError(
      "FeedbackRegistered projection requires an exact local versioned feedback-body binding.",
      409,
      "feedback_bonus_body_reference_invalid",
    );
  }
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const poolResult = await client.query(
      `SELECT * FROM tokenless_feedback_bonus_pools WHERE workspace_id=$1 AND opportunity_id=$2 FOR UPDATE`,
      [input.workspaceId, input.opportunityId],
    );
    const pool = poolResult.rows[0] as Row | undefined;
    if (
      !pool ||
      Number(pool.chain_id) !== input.receipt.chainId ||
      value(pool, "contract_address") !== input.receipt.contractAddress.toLowerCase() ||
      value(pool, "pool_id") !== input.receipt.event.poolId ||
      !isHash(input.receipt.transactionHash) ||
      input.receipt.blockNumber < 1n ||
      !Number.isSafeInteger(input.receipt.logIndex) ||
      input.receipt.logIndex < 0 ||
      !isHash(input.receipt.event.feedbackKey) ||
      !isHash(input.receipt.event.responseHash) ||
      !isHash(input.receipt.event.payoutCommitment) ||
      !isAddress(input.receipt.event.voteKey)
    ) {
      throw new TokenlessServiceError(
        "The FeedbackRegistered receipt does not match the exact projected pool.",
        409,
        "feedback_bonus_feedback_receipt_mismatch",
      );
    }
    const existing = await client.query(
      `SELECT * FROM tokenless_feedback_bonus_feedback
       WHERE workspace_id=$1 AND opportunity_id=$2 AND feedback_id=$3 FOR UPDATE`,
      [input.workspaceId, input.opportunityId, input.feedbackId],
    );
    const values = {
      responseHash: input.receipt.event.responseHash.toLowerCase(),
      voteKey: getAddress(input.receipt.event.voteKey).toLowerCase(),
      payoutCommitment: input.receipt.event.payoutCommitment.toLowerCase(),
    };
    await assertLocalFeedbackBinding(client, {
      workspaceId: input.workspaceId,
      opportunityId: input.opportunityId,
      bodyReference: input.bodyReference,
      responseHash: values.responseHash,
      voteKey: values.voteKey,
    });
    if (existing.rows[0]) {
      const row = existing.rows[0] as Row;
      if (
        value(row, "response_hash") !== values.responseHash ||
        value(row, "vote_key") !== values.voteKey ||
        value(row, "payout_commitment") !== values.payoutCommitment ||
        value(row, "body_reference") !== input.bodyReference
      ) {
        throw new TokenlessServiceError(
          "FeedbackRegistered replay conflicts with the existing local feedback binding.",
          409,
          "feedback_bonus_feedback_conflict",
        );
      }
      await client.query("COMMIT");
      return { feedbackId: input.feedbackId, replayed: true } as const;
    }
    await client.query(
      `INSERT INTO tokenless_feedback_bonus_feedback
       (workspace_id,opportunity_id,feedback_id,response_hash,vote_key,payout_commitment,body_reference,
        eligibility_status,registered_at,awarded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'eligible',$8,NULL)`,
      [
        input.workspaceId,
        input.opportunityId,
        input.feedbackId,
        values.responseHash,
        values.voteKey,
        values.payoutCommitment,
        input.bodyReference,
        input.registeredAt,
      ],
    );
    await client.query(
      `UPDATE tokenless_feedback_bonus_pools
       SET status=CASE WHEN status='funded' THEN 'award_open' ELSE status END,
           projection_revision=projection_revision+1,synced_at=$3
       WHERE workspace_id=$1 AND opportunity_id=$2`,
      [input.workspaceId, input.opportunityId, input.registeredAt],
    );
    await client.query("COMMIT");
    return { feedbackId: input.feedbackId, replayed: false } as const;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function feedbackBonusPoolDependenciesInstalled(dependencies?: FeedbackBonusPoolDependencies) {
  return Boolean(dependencies);
}

export const __feedbackBonusPoolProjectionTestUtils = { bytes32, idempotencyKey };
