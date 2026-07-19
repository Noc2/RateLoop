import {
  type HumanAssuranceAudiencePolicy,
  type TokenlessAskRequest,
  type TokenlessAskResponse,
  type TokenlessQuoteRequest,
  buildTokenlessPrivateReviewCommitmentQuestion,
  normalizeTokenlessQuoteRequest,
} from "@rateloop/sdk";
import { createHash, randomUUID } from "node:crypto";
import "server-only";
import { getAddress } from "viem";
import { requireWorkspacePaidPanels } from "~~/lib/billing/entitlements";
import { dbPool } from "~~/lib/db";
import { paidAssignmentSeatIdentityCommitment } from "~~/lib/privacy/paidAssignmentSeatIdentityErasure";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import { loadTokenlessChainConfig } from "~~/lib/tokenless/chain/config";
import type {
  HumanReviewDerivedEconomics,
  HumanReviewPreparedRequest,
} from "~~/lib/tokenless/humanReviewRequestPreparation";
import {
  type PreparedProductAsk,
  type ProductPrincipal,
  attachProductAsk,
  prepareProductAsk,
  releasePreparedProductAsk,
} from "~~/lib/tokenless/productCore";
import { TokenlessServiceError, createInternalPrivateReviewQuote, createTokenlessAsk } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type Hash = `sha256:${string}`;
type Bytes32 = `0x${string}`;
type PrivatePaidPrincipal = Extract<ProductPrincipal, { kind: "api_key" }>;

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/u;
const ATOMIC_PATTERN = /^(0|[1-9][0-9]*)$/u;

export type PaidAssignmentOperationState =
  | "prepared"
  | "quote_created"
  | "ask_prepared"
  | "ask_attached"
  | "round_bound";

export type PaidAssignmentOperationReviewer = {
  principalId: string;
  raterId: string;
  payoutAccount: string;
};

export type PrivatePaidAssignmentOperationRequest = {
  principal: PrivatePaidPrincipal;
  appOrigin: string;
  integrationId: string;
  opportunityId: string;
  privateReviewId: string;
  projectId: string;
  cohortId: string;
  privateGroup: { id: string; policyVersion: number; policyHash: Hash };
  reviewers: readonly PaidAssignmentOperationReviewer[];
  audiencePolicyHash: Hash;
  admissionPolicy: HumanAssuranceAudiencePolicy;
  publishingPolicy: { id: string; version: number };
  preparedRequest: HumanReviewPreparedRequest;
  preparedRequestHash: Hash;
  economics: HumanReviewDerivedEconomics;
  economicsHash: Hash;
  now?: Date;
};

export type PaidAssignmentRoundBinding = {
  deploymentKey: string;
  chainId: number;
  panelAddress: string;
  roundId: string;
  contentId: string;
  termsHash: string;
  roundTermsHash: Hash;
  paymentMode: "prepaid";
  paymentReference: string;
  commitDeadline: Date;
  confirmedAt: Date;
  boundAt: Date;
};

export type PaidAssignmentOperation = {
  operationId: string;
  workspaceId: string;
  opportunityId: string;
  requestIdempotencyKey: string;
  requestHash: Hash;
  preparedRequestHash: Hash;
  economicsHash: Hash;
  reviewerSetHash: Hash;
  audiencePolicyHash: Hash;
  chainAdmissionPolicyHash: Bytes32;
  admissionPolicyJson: string;
  artifactCommitmentsJson: string;
  artifactBindingHash: Hash;
  expectedAmountAtomic: string;
  state: PaidAssignmentOperationState;
  transitionRevision: number;
  quoteId: string | null;
  quoteExpiresAt: Date | null;
  askOperationKey: string | null;
  prepaidReservationId: string | null;
  policyReservationId: string | null;
  round: PaidAssignmentRoundBinding | null;
};

export type PaidAssignmentOperationResult = PaidAssignmentOperation & {
  readyForAssignment: boolean;
  replayed: boolean;
};

export type PaidAssignmentSeatPreparation = {
  principalId: string;
  raterId: string;
  payoutAccount: string;
  assignmentId: string;
  voucherIssuanceId: string;
};

type PersistedSeat = PaidAssignmentOperationReviewer & {
  position: number;
  seatId: string;
  identityCommitment: string;
};

type OperationSeed = Omit<
  PaidAssignmentOperation,
  | "askOperationKey"
  | "policyReservationId"
  | "prepaidReservationId"
  | "quoteId"
  | "quoteExpiresAt"
  | "round"
  | "state"
  | "transitionRevision"
> & {
  apiKeyId: string;
  publishingPolicyId: string;
  publishingPolicyVersion: number;
  seats: PersistedSeat[];
};

type RoundCandidate = {
  askOperationKey: string;
  askQuoteId: string;
  askRoundId: string | null;
  askCommitDeadline: Date | null;
  executionState: string | null;
  paymentMode: string | null;
  paymentReference: string | null;
  deploymentKey: string | null;
  chainId: number | null;
  panelAddress: string | null;
  executionRoundId: string | null;
  contentId: string | null;
  termsHash: string | null;
  roundTermsJson: string | null;
  totalFundedAtomic: string | null;
  confirmedAt: Date | null;
  voucherContentId: string | null;
  voucherAdmissionPolicyHash: string | null;
  voucherMaximumCommits: number | null;
  voucherNotBefore: Date | null;
  voucherDeadline: Date | null;
  voucherStatus: string | null;
  prepaidStatus: string | null;
  prepaidOperationKey: string | null;
  prepaidAmountAtomic: string | null;
  policyStatus: string | null;
  policyOperationKey: string | null;
  policyAmountAtomic: string | null;
  quoteRequestJson: string | null;
  questionContentId: string | null;
  questionTermsHash: string | null;
  questionContentJson: string | null;
  questionTermsJson: string | null;
};

export type PaidAssignmentChainIdentity = {
  deploymentKey: string;
  chainId: number;
  panelAddress: string;
};

export type PaidAssignmentOperationRepository = {
  ensure(seed: OperationSeed, now: Date): Promise<{ operation: PaidAssignmentOperation; replayed: boolean }>;
  claimActivation(
    operationId: string,
    owner: string,
    now: Date,
  ): Promise<{ operation: PaidAssignmentOperation; acquired: boolean }>;
  recoverExpired(operationId: string, owner: string, now: Date): Promise<PaidAssignmentOperation>;
  attachQuote(
    operationId: string,
    owner: string,
    quoteId: string,
    quoteExpiresAt: Date,
    now: Date,
  ): Promise<PaidAssignmentOperation>;
  attachPreparedAsk(
    operationId: string,
    owner: string,
    input: {
      quoteId: string;
      prepaidReservationId: string;
      policyReservationId: string;
      amountAtomic: string;
    },
    now: Date,
  ): Promise<PaidAssignmentOperation>;
  attachAsk(
    operationId: string,
    owner: string,
    input: {
      quoteId: string;
      askOperationKey: string;
      prepaidReservationId: string;
      policyReservationId: string;
      amountAtomic: string;
    },
    now: Date,
  ): Promise<PaidAssignmentOperation>;
  failActivation(operationId: string, owner: string, errorCode: string, now: Date): Promise<void>;
  bindExactRound(
    operationId: string,
    request: PrivatePaidAssignmentOperationRequest,
    identity: PaidAssignmentChainIdentity,
    now: Date,
  ): Promise<PaidAssignmentOperation>;
  revalidateExactRound(
    operationId: string,
    request: PrivatePaidAssignmentOperationRequest,
    identity: PaidAssignmentChainIdentity,
    now: Date,
  ): Promise<PaidAssignmentOperation>;
};

export type PaidAssignmentProductGateway = {
  createQuote(
    request: TokenlessQuoteRequest,
    principal: PrivatePaidPrincipal,
  ): Promise<{ quoteId: string; expiresAt: string }>;
  prepareAsk(input: { principal: PrivatePaidPrincipal; request: TokenlessAskRequest }): Promise<PreparedProductAsk>;
  createAsk(
    request: TokenlessAskRequest,
    idempotencyKey: string,
    appOrigin: string,
    idempotencyScope: string,
  ): Promise<TokenlessAskResponse>;
  attachAsk(prepared: PreparedProductAsk, ask: TokenlessAskResponse): Promise<void>;
  releaseAsk(prepared: PreparedProductAsk): Promise<void>;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Paid-assignment value is not canonicalizable.");
  return encoded;
}

function sha256(value: unknown): Hash {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function identifier(prefix: string, value: unknown) {
  return `${prefix}_${sha256(value).slice("sha256:".length, "sha256:".length + 40)}`;
}

function rowText(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowDate(row: Row | undefined, key: string) {
  const value = row?.[key];
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Stored ${key} is invalid.`);
  return parsed;
}

function operationFromRow(row: Row): PaidAssignmentOperation {
  const state = rowText(row, "state") as PaidAssignmentOperationState;
  const boundAt = rowDate(row, "bound_at");
  const round =
    state === "round_bound"
      ? {
          deploymentKey: rowText(row, "deployment_key")!,
          chainId: Number(row.chain_id),
          panelAddress: rowText(row, "panel_address")!,
          roundId: rowText(row, "round_id")!,
          contentId: rowText(row, "content_id")!,
          termsHash: rowText(row, "terms_hash")!,
          roundTermsHash: rowText(row, "round_terms_hash") as Hash,
          paymentMode: "prepaid" as const,
          paymentReference: rowText(row, "payment_reference")!,
          commitDeadline: rowDate(row, "commit_deadline")!,
          confirmedAt: rowDate(row, "confirmed_at")!,
          boundAt: boundAt!,
        }
      : null;
  return {
    operationId: rowText(row, "operation_id")!,
    workspaceId: rowText(row, "workspace_id")!,
    opportunityId: rowText(row, "opportunity_id")!,
    requestIdempotencyKey: rowText(row, "request_idempotency_key")!,
    requestHash: rowText(row, "request_hash") as Hash,
    preparedRequestHash: rowText(row, "prepared_request_hash") as Hash,
    economicsHash: rowText(row, "economics_hash") as Hash,
    reviewerSetHash: rowText(row, "reviewer_set_hash") as Hash,
    audiencePolicyHash: rowText(row, "audience_policy_hash") as Hash,
    chainAdmissionPolicyHash: rowText(row, "chain_admission_policy_hash") as Bytes32,
    admissionPolicyJson: rowText(row, "admission_policy_json")!,
    artifactCommitmentsJson: rowText(row, "artifact_commitments_json")!,
    artifactBindingHash: rowText(row, "artifact_binding_hash") as Hash,
    expectedAmountAtomic: rowText(row, "expected_amount_atomic")!,
    state,
    transitionRevision: Number(row.transition_revision),
    quoteId: rowText(row, "quote_id"),
    quoteExpiresAt: rowDate(row, "quote_expires_at"),
    askOperationKey: rowText(row, "ask_operation_key"),
    prepaidReservationId: rowText(row, "prepaid_reservation_id"),
    policyReservationId: rowText(row, "policy_reservation_id"),
    round,
  };
}

function receipt(operationId: string, sequence: number, receiptType: string, payload: unknown, now: Date) {
  const document = {
    schemaVersion: "rateloop.paid-assignment-receipt.v1",
    operationId,
    sequence,
    receiptType,
    payload,
    occurredAt: now.toISOString(),
  };
  const receiptJson = stableJson(document);
  const receiptHash = sha256(document);
  return {
    receiptId: identifier("parec", { operationId, sequence, receiptHash }),
    receiptJson,
    receiptHash,
  };
}

async function insertOperationReceipt(
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rowCount: number | null; rows: Row[] }> },
  operationId: string,
  operationRevision: number,
  receiptType: string,
  payload: unknown,
  now: Date,
) {
  const value = receipt(operationId, operationRevision, receiptType, payload, now);
  const inserted = await client.query(
    `INSERT INTO tokenless_paid_assignment_receipts
       (receipt_id,operation_id,seat_id,sequence,operation_revision,seat_revision,
        receipt_type,receipt_version,receipt_json,receipt_hash,created_at)
     VALUES ($1,$2,NULL,$3,$3,NULL,$4,1,$5,$6,$7)
     ON CONFLICT (operation_id,operation_revision) DO NOTHING RETURNING receipt_id`,
    [value.receiptId, operationId, operationRevision, receiptType, value.receiptJson, value.receiptHash, now],
  );
  if (inserted.rowCount === 1) return;
  const existing = await client.query(
    `SELECT receipt_type,receipt_json,receipt_hash FROM tokenless_paid_assignment_receipts
     WHERE operation_id=$1 AND operation_revision=$2 LIMIT 1`,
    [operationId, operationRevision],
  );
  const row = existing.rows[0];
  if (
    rowText(row, "receipt_type") !== receiptType ||
    rowText(row, "receipt_json") !== value.receiptJson ||
    rowText(row, "receipt_hash") !== value.receiptHash
  ) {
    throw new TokenlessServiceError(
      "The immutable paid-assignment receipt conflicts with this transition.",
      409,
      "paid_assignment_receipt_conflict",
    );
  }
}

function assertOperationMatchesSeed(operation: PaidAssignmentOperation, seed: OperationSeed) {
  if (
    operation.operationId !== seed.operationId ||
    operation.workspaceId !== seed.workspaceId ||
    operation.opportunityId !== seed.opportunityId ||
    operation.requestIdempotencyKey !== seed.requestIdempotencyKey ||
    operation.requestHash !== seed.requestHash ||
    operation.preparedRequestHash !== seed.preparedRequestHash ||
    operation.economicsHash !== seed.economicsHash ||
    operation.reviewerSetHash !== seed.reviewerSetHash ||
    operation.audiencePolicyHash !== seed.audiencePolicyHash ||
    operation.chainAdmissionPolicyHash !== seed.chainAdmissionPolicyHash ||
    operation.admissionPolicyJson !== seed.admissionPolicyJson ||
    operation.artifactCommitmentsJson !== seed.artifactCommitmentsJson ||
    operation.artifactBindingHash !== seed.artifactBindingHash ||
    operation.expectedAmountAtomic !== seed.expectedAmountAtomic
  ) {
    throw new TokenlessServiceError(
      "This paid-assignment operation belongs to different frozen terms.",
      409,
      "paid_assignment_operation_conflict",
    );
  }
}

const ACTIVATION_LEASE_MS = 2 * 60_000;

function requireActivationOwner(row: Row | undefined, owner: string, now: Date) {
  if (
    !row ||
    rowText(row, "activation_owner") !== owner ||
    !rowDate(row, "activation_expires_at") ||
    rowDate(row, "activation_expires_at")! <= now
  ) {
    throw new TokenlessServiceError(
      "Paid-assignment activation is owned by another worker.",
      409,
      "paid_assignment_activation_in_progress",
      true,
    );
  }
}

const databaseRepository: PaidAssignmentOperationRepository = {
  async ensure(seed, now) {
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO tokenless_paid_assignment_operations
           (operation_id,workspace_id,opportunity_id,lane,api_key_id,publishing_policy_id,
            publishing_policy_version,request_idempotency_key,request_hash,prepared_request_hash,
            economics_hash,reviewer_set_hash,audience_policy_hash,chain_admission_policy_hash,
            admission_policy_json,artifact_commitments_json,artifact_binding_hash,
            expected_amount_atomic,state,transition_revision,created_at,updated_at)
         VALUES ($1,$2,$3,'private_invited_paid',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                 'prepared',1,$18,$18)
         ON CONFLICT DO NOTHING RETURNING operation_id`,
        [
          seed.operationId,
          seed.workspaceId,
          seed.opportunityId,
          seed.apiKeyId,
          seed.publishingPolicyId,
          seed.publishingPolicyVersion,
          seed.requestIdempotencyKey,
          seed.requestHash,
          seed.preparedRequestHash,
          seed.economicsHash,
          seed.reviewerSetHash,
          seed.audiencePolicyHash,
          seed.chainAdmissionPolicyHash,
          seed.admissionPolicyJson,
          seed.artifactCommitmentsJson,
          seed.artifactBindingHash,
          seed.expectedAmountAtomic,
          now,
        ],
      );
      let existing = await client.query(
        `SELECT * FROM tokenless_paid_assignment_operations
         WHERE workspace_id=$1 AND request_idempotency_key=$2 LIMIT 1 FOR UPDATE`,
        [seed.workspaceId, seed.requestIdempotencyKey],
      );
      if (!existing.rows[0]) {
        existing = await client.query(
          `SELECT * FROM tokenless_paid_assignment_operations
           WHERE workspace_id=$1 AND opportunity_id=$2 AND lane='private_invited_paid' LIMIT 1 FOR UPDATE`,
          [seed.workspaceId, seed.opportunityId],
        );
      }
      const row = existing.rows[0];
      if (!row) {
        throw new TokenlessServiceError(
          "The paid-assignment operation conflicts with an existing immutable identity.",
          409,
          "paid_assignment_operation_conflict",
        );
      }
      const operation = operationFromRow(row);
      assertOperationMatchesSeed(operation, seed);
      const storedMetadata = await client.query(
        `SELECT api_key_id,publishing_policy_id,publishing_policy_version
         FROM tokenless_paid_assignment_operations WHERE operation_id=$1`,
        [operation.operationId],
      );
      const metadata = storedMetadata.rows[0];
      if (
        rowText(metadata, "api_key_id") !== seed.apiKeyId ||
        rowText(metadata, "publishing_policy_id") !== seed.publishingPolicyId ||
        Number(metadata?.publishing_policy_version) !== seed.publishingPolicyVersion
      ) {
        throw new TokenlessServiceError(
          "This paid-assignment operation belongs to a different publishing grant.",
          409,
          "paid_assignment_operation_conflict",
        );
      }
      for (const seat of seed.seats) {
        await client.query(
          `INSERT INTO tokenless_paid_assignment_seats
             (seat_id,operation_id,position,reviewer_principal_id,rater_id,payout_account,
              identity_commitment,state,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'planned',$8,$8) ON CONFLICT (operation_id,position) DO NOTHING`,
          [
            seat.seatId,
            operation.operationId,
            seat.position,
            seat.principalId,
            seat.raterId,
            seat.payoutAccount,
            seat.identityCommitment,
            now,
          ],
        );
      }
      const storedSeats = await client.query(
        `SELECT seat_id,position,reviewer_principal_id,rater_id,payout_account,identity_commitment
         FROM tokenless_paid_assignment_seats WHERE operation_id=$1 ORDER BY position ASC FOR UPDATE`,
        [operation.operationId],
      );
      const exactSeats = storedSeats.rows.map(value => ({
        seatId: rowText(value, "seat_id"),
        position: Number(value.position),
        principalId: rowText(value, "reviewer_principal_id"),
        raterId: rowText(value, "rater_id"),
        payoutAccount: rowText(value, "payout_account"),
        identityCommitment: rowText(value, "identity_commitment"),
      }));
      if (stableJson(exactSeats) !== stableJson(seed.seats)) {
        throw new TokenlessServiceError(
          "This paid-assignment operation belongs to a different reviewer set.",
          409,
          "paid_assignment_operation_conflict",
        );
      }
      if (inserted.rowCount === 1) {
        await insertOperationReceipt(
          client,
          operation.operationId,
          1,
          "operation_prepared",
          {
            requestHash: operation.requestHash,
            reviewerSetHash: operation.reviewerSetHash,
            expectedAmountAtomic: operation.expectedAmountAtomic,
          },
          now,
        );
      }
      await client.query("COMMIT");
      return { operation, replayed: inserted.rowCount !== 1 };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async claimActivation(operationId, owner, now) {
    const expiresAt = new Date(now.getTime() + ACTIVATION_LEASE_MS);
    const claimed = await dbPool.query(
      `UPDATE tokenless_paid_assignment_operations
       SET activation_owner=$1,activation_expires_at=$2,
           activation_attempt_count=activation_attempt_count+1,last_error_code=NULL,updated_at=$3
       WHERE operation_id=$4 AND state IN ('prepared','quote_created','ask_prepared')
         AND (activation_owner IS NULL OR activation_expires_at <= $3 OR activation_owner=$1)
       RETURNING *`,
      [owner, expiresAt, now, operationId],
    );
    if (claimed.rowCount === 1) return { operation: operationFromRow(claimed.rows[0]!), acquired: true };
    const current = await dbPool.query(
      "SELECT * FROM tokenless_paid_assignment_operations WHERE operation_id=$1 LIMIT 1",
      [operationId],
    );
    if (!current.rows[0])
      throw new TokenlessServiceError("Paid assignment not found.", 404, "paid_assignment_not_found");
    return { operation: operationFromRow(current.rows[0]), acquired: false };
  },

  async recoverExpired(operationId, owner, now) {
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        "SELECT * FROM tokenless_paid_assignment_operations WHERE operation_id=$1 FOR UPDATE",
        [operationId],
      );
      const row = current.rows[0];
      requireActivationOwner(row, owner, now);
      let operation = operationFromRow(row!);
      if (!operation.quoteExpiresAt || operation.quoteExpiresAt > now) {
        await client.query("COMMIT");
        return operation;
      }
      if (operation.state !== "quote_created" && operation.state !== "ask_prepared") {
        throw new TokenlessServiceError(
          "Only an unattached expired quote can be recovered.",
          409,
          "paid_assignment_quote_conflict",
        );
      }
      if (operation.state === "ask_prepared") {
        const prepaid = await client.query(
          `UPDATE tokenless_prepaid_reservations SET status='released',updated_at=$1
           WHERE reservation_id=$2 AND status='reserved' AND operation_key IS NULL`,
          [now, operation.prepaidReservationId],
        );
        const policy = await client.query(
          `UPDATE tokenless_agent_policy_budget_reservations SET status='released',updated_at=$1
           WHERE reservation_id=$2 AND status='reserved' AND operation_key IS NULL`,
          [now, operation.policyReservationId],
        );
        if (prepaid.rowCount !== 1 || policy.rowCount !== 1) {
          throw new TokenlessServiceError(
            "Expired ask funding is already bound and cannot be reset.",
            409,
            "paid_assignment_recovery_conflict",
          );
        }
      }
      const revision = operation.transitionRevision + 1;
      const updated = await client.query(
        `UPDATE tokenless_paid_assignment_operations
         SET state='prepared',transition_revision=$1,quote_id=NULL,quote_expires_at=NULL,
             prepaid_reservation_id=NULL,policy_reservation_id=NULL,last_error_code=NULL,updated_at=$2
         WHERE operation_id=$3 RETURNING *`,
        [revision, now, operationId],
      );
      operation = operationFromRow(updated.rows[0]!);
      await insertOperationReceipt(
        client,
        operationId,
        revision,
        "quote_expired_recovered",
        { recoveredState: rowText(row, "state") },
        now,
      );
      await client.query("COMMIT");
      return operation;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async attachQuote(operationId, owner, quoteId, quoteExpiresAt, now) {
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        "SELECT * FROM tokenless_paid_assignment_operations WHERE operation_id=$1 FOR UPDATE",
        [operationId],
      );
      requireActivationOwner(current.rows[0], owner, now);
      let operation = operationFromRow(current.rows[0]!);
      if (operation.quoteId && operation.quoteId !== quoteId) {
        throw new TokenlessServiceError(
          "The operation already has a different quote.",
          409,
          "paid_assignment_quote_conflict",
        );
      }
      if (operation.state === "prepared") {
        const revision = operation.transitionRevision + 1;
        const updated = await client.query(
          `UPDATE tokenless_paid_assignment_operations
           SET quote_id=$1,quote_expires_at=$2,state='quote_created',transition_revision=$3,updated_at=$4
           WHERE operation_id=$5 RETURNING *`,
          [quoteId, quoteExpiresAt, revision, now, operationId],
        );
        operation = operationFromRow(updated.rows[0]!);
        await insertOperationReceipt(
          client,
          operationId,
          revision,
          "quote_created",
          { quoteId, quoteExpiresAt: quoteExpiresAt.toISOString() },
          now,
        );
      }
      await client.query("COMMIT");
      return operation;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async attachPreparedAsk(operationId, owner, input, now) {
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        "SELECT * FROM tokenless_paid_assignment_operations WHERE operation_id=$1 FOR UPDATE",
        [operationId],
      );
      requireActivationOwner(current.rows[0], owner, now);
      let operation = operationFromRow(current.rows[0]!);
      if (
        operation.quoteId !== input.quoteId ||
        operation.expectedAmountAtomic !== input.amountAtomic ||
        (operation.prepaidReservationId && operation.prepaidReservationId !== input.prepaidReservationId) ||
        (operation.policyReservationId && operation.policyReservationId !== input.policyReservationId)
      ) {
        throw new TokenlessServiceError(
          "The operation already has a different ask.",
          409,
          "paid_assignment_ask_conflict",
        );
      }
      if (operation.state === "quote_created") {
        const revision = operation.transitionRevision + 1;
        const updated = await client.query(
          `UPDATE tokenless_paid_assignment_operations
           SET prepaid_reservation_id=$1,policy_reservation_id=$2,
               state='ask_prepared',transition_revision=$3,updated_at=$4 WHERE operation_id=$5 RETURNING *`,
          [input.prepaidReservationId, input.policyReservationId, revision, now, operationId],
        );
        operation = operationFromRow(updated.rows[0]!);
        await insertOperationReceipt(
          client,
          operationId,
          revision,
          "ask_prepared",
          {
            quoteId: input.quoteId,
            prepaidReservationId: input.prepaidReservationId,
            policyReservationId: input.policyReservationId,
            amountAtomic: input.amountAtomic,
          },
          now,
        );
      }
      await client.query("COMMIT");
      return operation;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async attachAsk(operationId, owner, input, now) {
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        "SELECT * FROM tokenless_paid_assignment_operations WHERE operation_id=$1 FOR UPDATE",
        [operationId],
      );
      requireActivationOwner(current.rows[0], owner, now);
      let operation = operationFromRow(current.rows[0]!);
      if (
        operation.quoteId !== input.quoteId ||
        operation.expectedAmountAtomic !== input.amountAtomic ||
        operation.prepaidReservationId !== input.prepaidReservationId ||
        operation.policyReservationId !== input.policyReservationId ||
        (operation.askOperationKey && operation.askOperationKey !== input.askOperationKey)
      ) {
        throw new TokenlessServiceError(
          "The operation already has a different ask.",
          409,
          "paid_assignment_ask_conflict",
        );
      }
      if (operation.state === "ask_prepared") {
        const revision = operation.transitionRevision + 1;
        const updated = await client.query(
          `UPDATE tokenless_paid_assignment_operations
           SET ask_operation_key=$1,state='ask_attached',transition_revision=$2,
               activation_owner=NULL,activation_expires_at=NULL,updated_at=$3
           WHERE operation_id=$4 RETURNING *`,
          [input.askOperationKey, revision, now, operationId],
        );
        operation = operationFromRow(updated.rows[0]!);
        await insertOperationReceipt(
          client,
          operationId,
          revision,
          "ask_attached",
          {
            quoteId: input.quoteId,
            askOperationKey: input.askOperationKey,
            prepaidReservationId: input.prepaidReservationId,
            policyReservationId: input.policyReservationId,
            amountAtomic: input.amountAtomic,
          },
          now,
        );
      }
      await client.query("COMMIT");
      return operation;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async failActivation(operationId, owner, errorCode, now) {
    await dbPool.query(
      `UPDATE tokenless_paid_assignment_operations
       SET activation_owner=NULL,activation_expires_at=NULL,last_error_code=$1,updated_at=$2
       WHERE operation_id=$3 AND activation_owner=$4 AND state IN ('prepared','quote_created','ask_prepared')`,
      [errorCode, now, operationId, owner],
    );
  },

  bindExactRound: (operationId, request, identity, now) =>
    validateDatabaseRound(operationId, request, identity, now, true),
  revalidateExactRound: (operationId, request, identity, now) =>
    validateDatabaseRound(operationId, request, identity, now, false),
};

const productGateway: PaidAssignmentProductGateway = {
  async createQuote(request, principal) {
    return createInternalPrivateReviewQuote(request, {
      kind: "api_key",
      workspaceId: principal.workspaceId,
      apiKeyId: principal.apiKeyId,
    });
  },
  prepareAsk: input => prepareProductAsk(input),
  createAsk: createTokenlessAsk,
  attachAsk: attachProductAsk,
  releaseAsk: releasePreparedProductAsk,
};

function normalizeReviewers(reviewers: readonly PaidAssignmentOperationReviewer[]) {
  if (reviewers.length < 1 || reviewers.length > 500) {
    throw new TokenlessServiceError(
      "A paid assignment requires 1-500 exact reviewers.",
      409,
      "paid_assignment_invalid",
    );
  }
  const normalized = reviewers.map(reviewer => ({
    principalId: reviewer.principalId,
    raterId: reviewer.raterId,
    payoutAccount: getAddress(reviewer.payoutAccount).toLowerCase(),
  }));
  normalized.sort((left, right) => left.payoutAccount.localeCompare(right.payoutAccount));
  if (
    new Set(normalized.map(value => value.principalId)).size !== normalized.length ||
    new Set(normalized.map(value => value.raterId)).size !== normalized.length ||
    new Set(normalized.map(value => value.payoutAccount)).size !== normalized.length
  ) {
    throw new TokenlessServiceError("Paid assignment reviewers must be unique.", 409, "paid_assignment_invalid");
  }
  return normalized;
}

function jsonStrings(value: unknown, label: string) {
  try {
    const parsed = JSON.parse(String(value));
    if (!Array.isArray(parsed) || parsed.some(entry => typeof entry !== "string")) throw new Error();
    return parsed as string[];
  } catch {
    throw new TokenlessServiceError(`The stored ${label} is invalid.`, 500, "paid_assignment_authorization_invalid");
  }
}

async function authorizePaidAssignment(input: PrivatePaidAssignmentOperationRequest, seed: OperationSeed, now: Date) {
  await requireWorkspacePaidPanels(seed.workspaceId, now);
  const requestedScopes = input.principal.scopes ?? [];
  if (!requestedScopes.includes("panel:publish") || !requestedScopes.includes("payment:submit")) {
    throw new TokenlessServiceError("This API key cannot publish and fund a paid panel.", 403, "insufficient_scope");
  }
  const result = await dbPool.query(
    `SELECT k.workspace_id AS key_workspace_id,k.role AS key_role,k.scopes_json,k.policy_id AS key_policy_id,
            k.revoked_at AS key_revoked_at,k.expires_at AS key_expires_at,w.status AS workspace_status,
            p.*,o.source_evidence_hash,o.suggestion_commitment,o.request_profile_id,o.request_profile_version,
            o.request_profile_hash,l.state AS lifecycle_state,rp.audience_policy_json AS review_audience_policy_json
     FROM tokenless_workspace_api_keys k
     JOIN tokenless_workspaces w ON w.workspace_id=k.workspace_id
     JOIN tokenless_agent_publishing_policies p
       ON p.workspace_id=k.workspace_id AND p.policy_id=k.policy_id
     JOIN tokenless_agent_review_opportunities o
       ON o.workspace_id=k.workspace_id AND o.opportunity_id=$2
     JOIN tokenless_agent_review_opportunity_lifecycles l
       ON l.workspace_id=o.workspace_id AND l.opportunity_id=o.opportunity_id
     JOIN tokenless_agent_review_policies rp
       ON rp.workspace_id=o.workspace_id AND rp.policy_id=o.policy_id AND rp.version=o.policy_version
     WHERE k.key_id=$1 LIMIT 1`,
    [seed.apiKeyId, seed.opportunityId],
  );
  const row = result.rows[0] as Row | undefined;
  const storedScopes = row ? jsonStrings(row.scopes_json, "API-key scopes") : [];
  const active =
    row &&
    rowText(row, "key_workspace_id") === seed.workspaceId &&
    rowText(row, "workspace_status") === "active" &&
    rowText(row, "key_role") === input.principal.role &&
    rowText(row, "key_policy_id") === seed.publishingPolicyId &&
    Number(row.version) === seed.publishingPolicyVersion &&
    !row.key_revoked_at &&
    (!row.key_expires_at || new Date(String(row.key_expires_at)) > now) &&
    row.enabled === true &&
    !row.revoked_at &&
    new Date(String(row.effective_at)) <= now &&
    (!row.expires_at || new Date(String(row.expires_at)) > now) &&
    storedScopes.includes("panel:publish") &&
    storedScopes.includes("payment:submit") &&
    ["request_ready", "pending"].includes(rowText(row, "lifecycle_state") ?? "");
  if (!active) {
    throw new TokenlessServiceError(
      "The API key, workspace, publishing policy, or opportunity is no longer authorized.",
      403,
      "paid_assignment_authorization_required",
    );
  }
  const modes = jsonStrings(row.allowed_payment_modes_json, "allowed payment modes");
  const projects = jsonStrings(row.allowed_project_ids_json, "allowed projects");
  const sources = jsonStrings(row.allowed_reviewer_sources_json, "allowed reviewer sources");
  const admissionHashes = jsonStrings(row.allowed_admission_policy_hashes_json, "allowed admission policies").map(
    value => value.toLowerCase(),
  );
  const classifications = jsonStrings(row.allowed_data_classifications_json, "allowed data classifications");
  const classification = input.preparedRequest.audience.privateSensitivity ?? "internal";
  const frozenReviewPolicy = freezeAdmissionPolicy(JSON.parse(String(row.review_audience_policy_json)));
  if (
    !modes.includes("prepaid") ||
    (projects.length > 0 && !projects.includes(input.projectId)) ||
    (sources.length > 0 && !sources.includes("customer_invited")) ||
    !admissionHashes.includes(seed.chainAdmissionPolicyHash.toLowerCase()) ||
    (classifications.length > 0 && !classifications.includes(classification)) ||
    BigInt(seed.expectedAmountAtomic) > BigInt(String(row.max_panel_atomic)) ||
    BigInt(input.economics.baseBountyAtomic) > BigInt(String(row.max_bounty_atomic)) ||
    BigInt(input.economics.attemptReserveAtomic) > BigInt(String(row.max_attempt_reserve_atomic)) ||
    input.economics.feeBps > Number(row.max_fee_bps) ||
    input.economics.panelSize > Number(row.max_panel_size) ||
    rowText(row, "source_evidence_hash") !== input.preparedRequest.contentCommitments.source ||
    rowText(row, "suggestion_commitment") !== input.preparedRequest.contentCommitments.suggestion ||
    rowText(row, "request_profile_id") !== input.preparedRequest.requestProfile.id ||
    Number(row.request_profile_version) !== input.preparedRequest.requestProfile.version ||
    rowText(row, "request_profile_hash") !== input.preparedRequest.requestProfile.hash ||
    frozenReviewPolicy.policyHash !== seed.audiencePolicyHash ||
    frozenReviewPolicy.policyJson !== seed.admissionPolicyJson
  ) {
    throw new TokenlessServiceError(
      "The exact paid assignment is outside the current delegated publishing grant.",
      403,
      "approval_required",
    );
  }
  const responseDeadline = new Date(input.preparedRequest.timing.expiresAt);
  if (!Number.isFinite(responseDeadline.getTime()) || responseDeadline <= now) {
    throw new TokenlessServiceError(
      "The paid assignment's frozen response deadline is no longer live.",
      409,
      "paid_assignment_authorization_required",
    );
  }
  const membership = await dbPool.query(
    `SELECT p.project_id,p.retention_days,c.cohort_id,c.capacity,c.active_reservations,
            gp.default_compensation,gp.allowed_project_ids_json AS group_allowed_project_ids_json,
            gp.retention_days AS group_retention_days,cr.reviewer_account_address,
            cr.qualification_expires_at,cr.maximum_active_assignments,cr.active_reservations AS reviewer_reservations,
            m.allowed_project_ids_json AS member_allowed_project_ids_json,
            wb.principal_id AS reviewer_principal_id,wb.wallet_address AS reviewer_payout_account,
            rp.rater_id
     FROM tokenless_assurance_projects p
     JOIN tokenless_assurance_cohorts c
       ON c.project_id=p.project_id AND c.cohort_id=$3 AND c.private_group_id=$4
      AND c.source='customer_invited' AND c.selection='customer_named' AND c.status='active'
     JOIN tokenless_private_groups g
       ON g.group_id=$4 AND g.workspace_id=p.workspace_id AND g.status='active'
      AND g.current_policy_version=$5
     JOIN tokenless_private_group_policy_versions gp
       ON gp.group_id=g.group_id AND gp.version=$5 AND gp.policy_hash=$6
     JOIN tokenless_assurance_cohort_reviewers cr
       ON cr.project_id=p.project_id AND cr.cohort_id=c.cohort_id AND cr.status='active'
      AND cr.active_reservations<cr.maximum_active_assignments
      AND (cr.qualification_expires_at IS NULL OR cr.qualification_expires_at>=$7)
     JOIN tokenless_private_group_memberships m
       ON m.group_id=g.group_id AND m.principal_address=cr.reviewer_account_address
      AND m.status='active' AND m.joined_at<=$8
      AND (m.membership_expires_at IS NULL OR m.membership_expires_at>=$7)
     JOIN tokenless_wallet_bindings wb
       ON lower(wb.wallet_address)=lower(cr.reviewer_account_address)
      AND wb.purpose='payout' AND wb.revoked_at IS NULL
     JOIN tokenless_rater_profiles rp
       ON rp.principal_id=wb.principal_id
     WHERE p.workspace_id=$1 AND p.project_id=$2 AND p.status='active' AND p.visibility='private'
       AND p.data_classification=$9 AND p.private_sensitivity=$9
       AND lower(cr.reviewer_account_address)=ANY($10::text[])
     ORDER BY lower(cr.reviewer_account_address)`,
    [
      seed.workspaceId,
      input.projectId,
      input.cohortId,
      input.privateGroup.id,
      input.privateGroup.policyVersion,
      input.privateGroup.policyHash,
      responseDeadline,
      now,
      classification,
      seed.seats.map(seat => seat.payoutAccount),
    ],
  );
  const membershipRows = membership.rows as Row[];
  const exactMemberships = membershipRows.map(value => ({
    principalId: rowText(value, "reviewer_principal_id"),
    raterId: rowText(value, "rater_id"),
    payoutAccount: rowText(value, "reviewer_payout_account")?.toLowerCase() ?? null,
  }));
  const groupAllowedProjects = membershipRows[0]
    ? jsonStrings(membershipRows[0].group_allowed_project_ids_json, "private-group project policy")
    : [];
  const exact =
    membershipRows.length === seed.seats.length &&
    stableJson(exactMemberships) ===
      stableJson(
        seed.seats.map(({ principalId, raterId, payoutAccount }) => ({ principalId, raterId, payoutAccount })),
      ) &&
    rowText(membershipRows[0], "project_id") === input.projectId &&
    rowText(membershipRows[0], "cohort_id") === input.cohortId &&
    rowText(membershipRows[0], "default_compensation") === "paid" &&
    Number(membershipRows[0]?.capacity) - Number(membershipRows[0]?.active_reservations) >= seed.seats.length &&
    Number(membershipRows[0]?.retention_days) <= Number(membershipRows[0]?.group_retention_days) &&
    (groupAllowedProjects.length === 0 || groupAllowedProjects.includes(input.projectId)) &&
    membershipRows.every(value => {
      const allowed = jsonStrings(value.member_allowed_project_ids_json, "reviewer membership project policy");
      return allowed.length === 0 || allowed.includes(input.projectId);
    });
  if (!exact) {
    throw new TokenlessServiceError(
      "The invited paid roster no longer matches its exact private group, project, cohort, or membership policy.",
      409,
      "paid_assignment_membership_conflict",
    );
  }
}

function quoteRequest(
  input: PrivatePaidAssignmentOperationRequest,
  admissionPolicyHash: Bytes32,
): TokenlessQuoteRequest {
  const reviewers = normalizeReviewers(input.reviewers);
  const reviewerSetHash = sha256({ schemaVersion: "rateloop.paid-assignment-reviewers.v1", reviewers });
  return normalizeTokenlessQuoteRequest({
    visibility: "private",
    dataClassification: input.preparedRequest.audience.privateSensitivity ?? "internal",
    audience: { admissionPolicyHash, source: "customer_invited" },
    audiencePolicy: input.admissionPolicy,
    privateReview: {
      schemaVersion: "rateloop.tokenless-private-review.v1",
      artifactCommitments: {
        privateReviewId: input.privateReviewId,
        source: input.preparedRequest.contentCommitments.source as Hash,
        suggestion: input.preparedRequest.contentCommitments.suggestion as Hash,
        preparedRequestHash: input.preparedRequestHash,
        economicsHash: input.economicsHash,
        reviewerSetHash,
      },
    },
    budget: {
      bountyAtomic: input.economics.baseBountyAtomic,
      attemptReserveAtomic: input.economics.attemptReserveAtomic,
      feeBps: input.economics.feeBps,
    },
    question: buildTokenlessPrivateReviewCommitmentQuestion(),
    requestedPanelSize: input.economics.panelSize,
    responseWindowSeconds: input.preparedRequest.timing.responseWindowSeconds,
    requestProfile: {
      ...input.preparedRequest.requestProfile,
      hash: input.preparedRequest.requestProfile.hash as Hash,
    },
    reviewEconomics: {
      compensationMode: "usdc",
      bountyPerSeatAtomic: input.economics.bountyPerSeatAtomic,
      panelSize: input.economics.panelSize,
    },
  });
}

function operationSeed(input: PrivatePaidAssignmentOperationRequest): OperationSeed {
  const now = input.now ?? new Date();
  const frozenAdmissionPolicy = freezeAdmissionPolicy(input.admissionPolicy);
  if (
    !Number.isFinite(now.getTime()) ||
    !HASH_PATTERN.test(input.preparedRequestHash) ||
    !HASH_PATTERN.test(input.economicsHash) ||
    !HASH_PATTERN.test(input.audiencePolicyHash) ||
    !HASH_PATTERN.test(input.privateGroup.policyHash) ||
    !HASH_PATTERN.test(input.preparedRequest.requestProfile.hash) ||
    sha256(input.preparedRequest) !== input.preparedRequestHash ||
    sha256(input.economics) !== input.economicsHash ||
    input.preparedRequest.opportunityId !== input.opportunityId ||
    input.preparedRequest.audience.kind !== "private_invited" ||
    input.preparedRequest.audience.privateGroupId !== input.privateGroup.id ||
    input.economics.compensationMode !== "usdc" ||
    !ATOMIC_PATTERN.test(input.economics.maximumChargeAtomic) ||
    input.economics.maximumChargeAtomic === "0" ||
    input.principal.policyId !== input.publishingPolicy.id ||
    input.publishingPolicy.version < 1 ||
    frozenAdmissionPolicy.policyHash !== input.audiencePolicyHash ||
    frozenAdmissionPolicy.policy.reviewerSource !== "customer_invited" ||
    frozenAdmissionPolicy.policy.compensation !== "paid" ||
    frozenAdmissionPolicy.policy.selection !== "customer_named" ||
    frozenAdmissionPolicy.policy.fallbacks.allowed ||
    !frozenAdmissionPolicy.policy.legalEligibilityRequired
  ) {
    throw new TokenlessServiceError(
      "Paid assignment activation requires exact frozen private terms.",
      409,
      "paid_assignment_invalid",
    );
  }
  try {
    const origin = new URL(input.appOrigin);
    if (origin.origin !== input.appOrigin.replace(/\/$/u, "")) throw new Error();
  } catch {
    throw new TokenlessServiceError("Paid assignment app origin is invalid.", 500, "paid_assignment_invalid");
  }
  const reviewers = normalizeReviewers(input.reviewers);
  if (reviewers.length !== input.economics.panelSize || reviewers.length !== input.preparedRequest.panel.size) {
    throw new TokenlessServiceError(
      "Paid assignment seats do not match the frozen panel.",
      409,
      "paid_assignment_invalid",
    );
  }
  const reviewerSetHash = sha256({ schemaVersion: "rateloop.paid-assignment-reviewers.v1", reviewers });
  const cohort = frozenAdmissionPolicy.policy.cohorts.find(value => value.cohortId === input.cohortId);
  if (!cohort || reviewers.length < cohort.minimumReviewers || reviewers.length > cohort.maximumReviewers) {
    throw new TokenlessServiceError(
      "Paid assignment reviewers do not satisfy the exact named cohort policy.",
      409,
      "paid_assignment_invalid",
    );
  }
  const artifactCommitments = {
    schemaVersion: "rateloop.private-paid-artifact-commitments.v1",
    privateReviewId: input.privateReviewId,
    source: input.preparedRequest.contentCommitments.source,
    suggestion: input.preparedRequest.contentCommitments.suggestion,
    preparedRequestHash: input.preparedRequestHash,
    economicsHash: input.economicsHash,
    reviewerSetHash,
    membership: {
      projectId: input.projectId,
      cohortId: input.cohortId,
      privateGroup: input.privateGroup,
      reviewerSetHash,
    },
  };
  const artifactCommitmentsJson = stableJson(artifactCommitments);
  const artifactBindingHash = sha256(artifactCommitments);
  const requestHash = sha256({
    schemaVersion: "rateloop.private-paid-assignment-operation.v1",
    workspaceId: input.principal.workspaceId,
    apiKeyId: input.principal.apiKeyId,
    integrationId: input.integrationId,
    opportunityId: input.opportunityId,
    privateReviewId: input.privateReviewId,
    projectId: input.projectId,
    cohortId: input.cohortId,
    privateGroup: input.privateGroup,
    reviewerSetHash,
    audiencePolicyHash: input.audiencePolicyHash,
    artifactBindingHash,
    publishingPolicy: input.publishingPolicy,
    preparedRequestHash: input.preparedRequestHash,
    economicsHash: input.economicsHash,
  });
  const requestIdempotencyKey = `paid-assignment:${requestHash.slice("sha256:".length)}`;
  const operationId = identifier("paop", { workspaceId: input.principal.workspaceId, requestIdempotencyKey });
  const chainAdmissionPolicyHash = `0x${input.audiencePolicyHash.slice("sha256:".length)}` as Bytes32;
  if (!BYTES32_PATTERN.test(chainAdmissionPolicyHash)) throw new Error("Admission policy conversion failed.");
  return {
    operationId,
    workspaceId: input.principal.workspaceId,
    opportunityId: input.opportunityId,
    requestIdempotencyKey,
    requestHash,
    preparedRequestHash: input.preparedRequestHash,
    economicsHash: input.economicsHash,
    reviewerSetHash,
    audiencePolicyHash: input.audiencePolicyHash,
    chainAdmissionPolicyHash,
    admissionPolicyJson: frozenAdmissionPolicy.policyJson,
    artifactCommitmentsJson,
    artifactBindingHash,
    expectedAmountAtomic: input.economics.maximumChargeAtomic,
    apiKeyId: input.principal.apiKeyId,
    publishingPolicyId: input.publishingPolicy.id,
    publishingPolicyVersion: input.publishingPolicy.version,
    seats: reviewers.map((reviewer, position) => ({
      ...reviewer,
      position,
      seatId: identifier("paseat", { operationId, position, ...reviewer }),
      identityCommitment: paidAssignmentSeatIdentityCommitment(reviewer),
    })),
  };
}

function exactRoundBinding(
  operation: PaidAssignmentOperation,
  candidate: RoundCandidate,
  input: PrivatePaidAssignmentOperationRequest,
  identity: PaidAssignmentChainIdentity,
  now: Date,
): PaidAssignmentRoundBinding | null {
  if (candidate.executionState !== "confirmed") return null;
  let terms: Record<string, unknown>;
  try {
    terms = JSON.parse(candidate.roundTermsJson ?? "null") as Record<string, unknown>;
  } catch {
    throw new TokenlessServiceError("The confirmed round terms are invalid.", 409, "paid_assignment_round_conflict");
  }
  let quoteRequestValue: TokenlessQuoteRequest;
  let contentValue: unknown;
  let productTerms: Record<string, unknown>;
  try {
    quoteRequestValue = normalizeTokenlessQuoteRequest(JSON.parse(candidate.quoteRequestJson ?? "null"));
    contentValue = JSON.parse(candidate.questionContentJson ?? "null");
    productTerms = JSON.parse(candidate.questionTermsJson ?? "null") as Record<string, unknown>;
  } catch {
    throw new TokenlessServiceError(
      "The persisted quote or product commitments are invalid.",
      409,
      "paid_assignment_round_conflict",
    );
  }
  const quoteArtifacts = quoteRequestValue.privateReview?.artifactCommitments;
  const storedArtifacts = JSON.parse(operation.artifactCommitmentsJson) as Record<string, unknown>;
  const expectedArtifacts = {
    privateReviewId: storedArtifacts.privateReviewId,
    source: storedArtifacts.source,
    suggestion: storedArtifacts.suggestion,
    preparedRequestHash: storedArtifacts.preparedRequestHash,
    economicsHash: storedArtifacts.economicsHash,
    reviewerSetHash: storedArtifacts.reviewerSetHash,
  };
  const exactDeadlineSeconds = candidate.voucherDeadline
    ? String(Math.floor(candidate.voucherDeadline.getTime() / 1_000))
    : null;
  const exact =
    candidate.askOperationKey === operation.askOperationKey &&
    candidate.askQuoteId === operation.quoteId &&
    candidate.askRoundId !== null &&
    candidate.askRoundId === candidate.executionRoundId &&
    candidate.totalFundedAtomic === operation.expectedAmountAtomic &&
    candidate.paymentMode === "prepaid" &&
    candidate.paymentReference === operation.prepaidReservationId &&
    candidate.deploymentKey === identity.deploymentKey &&
    candidate.chainId === identity.chainId &&
    candidate.panelAddress?.toLowerCase() === identity.panelAddress.toLowerCase() &&
    candidate.contentId !== null &&
    candidate.termsHash !== null &&
    candidate.confirmedAt !== null &&
    candidate.confirmedAt <= now &&
    candidate.prepaidStatus === "consumed" &&
    candidate.prepaidOperationKey === operation.askOperationKey &&
    candidate.prepaidAmountAtomic === operation.expectedAmountAtomic &&
    candidate.policyStatus === "spent" &&
    candidate.policyOperationKey === operation.askOperationKey &&
    candidate.policyAmountAtomic === operation.expectedAmountAtomic &&
    String(terms.bountyAmount) === input.economics.baseBountyAtomic &&
    String(terms.feeAmount) === input.economics.feeAtomic &&
    String(terms.attemptReserve) === input.economics.attemptReserveAtomic &&
    Number(terms.maximumCommits) === input.economics.panelSize &&
    String(terms.admissionPolicyHash).toLowerCase() === operation.chainAdmissionPolicyHash &&
    String(terms.contentId).toLowerCase() === candidate.contentId.toLowerCase() &&
    String(terms.termsHash).toLowerCase() === candidate.termsHash.toLowerCase() &&
    String(terms.commitDeadline) === exactDeadlineSeconds &&
    candidate.askCommitDeadline?.getTime() === candidate.voucherDeadline?.getTime() &&
    candidate.voucherContentId?.toLowerCase() === candidate.contentId.toLowerCase() &&
    candidate.voucherAdmissionPolicyHash?.toLowerCase() === operation.chainAdmissionPolicyHash &&
    candidate.voucherMaximumCommits === input.economics.panelSize &&
    candidate.voucherStatus === "open" &&
    candidate.voucherNotBefore !== null &&
    candidate.voucherDeadline !== null &&
    candidate.voucherNotBefore <= now &&
    candidate.voucherDeadline > now &&
    candidate.questionContentId?.toLowerCase() === candidate.contentId.toLowerCase() &&
    candidate.questionTermsHash?.toLowerCase() === candidate.termsHash.toLowerCase() &&
    stableJson(quoteArtifacts) === stableJson(expectedArtifacts) &&
    stableJson(contentValue) ===
      stableJson({ question: buildTokenlessPrivateReviewCommitmentQuestion(), privateReview: expectedArtifacts }) &&
    stableJson(quoteRequestValue.audiencePolicy) === operation.admissionPolicyJson &&
    stableJson(productTerms.audiencePolicy) === operation.admissionPolicyJson &&
    String(productTerms.privateReviewBindingHash) === `0x${sha256(expectedArtifacts).slice("sha256:".length)}`;
  if (!exact) {
    throw new TokenlessServiceError(
      "The confirmed chain round does not match the exact paid assignment.",
      409,
      "paid_assignment_round_conflict",
    );
  }
  return {
    deploymentKey: candidate.deploymentKey!,
    chainId: candidate.chainId!,
    panelAddress: candidate.panelAddress!.toLowerCase(),
    roundId: candidate.executionRoundId!,
    contentId: candidate.contentId!.toLowerCase(),
    termsHash: candidate.termsHash!.toLowerCase(),
    roundTermsHash: sha256(terms),
    paymentMode: "prepaid",
    paymentReference: candidate.paymentReference!,
    commitDeadline: candidate.voucherDeadline!,
    confirmedAt: candidate.confirmedAt!,
    boundAt: now,
  };
}

async function loadLockedRoundCandidate(
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rowCount: number | null; rows: Row[] }> },
  operation: PaidAssignmentOperation,
): Promise<RoundCandidate | null> {
  if (!operation.askOperationKey || !operation.prepaidReservationId || !operation.policyReservationId) return null;
  const result = await client.query(
    `SELECT a.operation_key AS ask_operation_key,a.quote_id AS ask_quote_id,a.round_id AS ask_round_id,
            a.commit_deadline AS ask_commit_deadline,e.state AS execution_state,e.payment_mode,e.payment_reference,
            e.deployment_key,e.chain_id,e.panel_address,e.round_id AS execution_round_id,e.content_id,e.terms_hash,
            e.round_terms_json,e.total_funded_atomic,e.confirmed_at,
            vr.content_id AS voucher_content_id,vr.admission_policy_hash AS voucher_admission_policy_hash,
            vr.maximum_commits AS voucher_maximum_commits,vr.voucher_not_before,vr.voucher_deadline,
            vr.status AS voucher_status,pr.status AS prepaid_status,pr.operation_key AS prepaid_operation_key,
            pr.amount_atomic AS prepaid_amount_atomic,abr.status AS policy_status,
            abr.operation_key AS policy_operation_key,abr.amount_atomic AS policy_amount_atomic,
            q.request_json AS quote_request_json,qr.content_id AS question_content_id,
            qr.terms_hash AS question_terms_hash,cr.content_json AS question_content_json,
            qr.terms_json AS question_terms_json
     FROM tokenless_agent_asks a
     JOIN tokenless_chain_executions e ON e.operation_key=a.operation_key
     JOIN tokenless_voucher_rounds vr
       ON vr.chain_id=e.chain_id AND vr.panel_address=e.panel_address AND vr.round_id=e.round_id
     JOIN tokenless_prepaid_reservations pr ON pr.reservation_id=$2
     JOIN tokenless_agent_policy_budget_reservations abr ON abr.reservation_id=$3
     JOIN tokenless_agent_quotes q ON q.quote_id=a.quote_id
     JOIN tokenless_ask_ownership ao ON ao.operation_key=a.operation_key
     JOIN tokenless_question_records qr ON qr.question_id=ao.question_id
     JOIN tokenless_content_records cr ON cr.content_id=qr.content_id
     WHERE a.operation_key=$1
     FOR UPDATE OF a,e,vr,pr,abr,q,ao,qr,cr`,
    [operation.askOperationKey, operation.prepaidReservationId, operation.policyReservationId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    askOperationKey: rowText(row, "ask_operation_key")!,
    askQuoteId: rowText(row, "ask_quote_id")!,
    askRoundId: rowText(row, "ask_round_id"),
    askCommitDeadline: rowDate(row, "ask_commit_deadline"),
    executionState: rowText(row, "execution_state"),
    paymentMode: rowText(row, "payment_mode"),
    paymentReference: rowText(row, "payment_reference"),
    deploymentKey: rowText(row, "deployment_key"),
    chainId: row.chain_id === null || row.chain_id === undefined ? null : Number(row.chain_id),
    panelAddress: rowText(row, "panel_address"),
    executionRoundId: rowText(row, "execution_round_id"),
    contentId: rowText(row, "content_id"),
    termsHash: rowText(row, "terms_hash"),
    roundTermsJson: rowText(row, "round_terms_json"),
    totalFundedAtomic: rowText(row, "total_funded_atomic"),
    confirmedAt: rowDate(row, "confirmed_at"),
    voucherContentId: rowText(row, "voucher_content_id"),
    voucherAdmissionPolicyHash: rowText(row, "voucher_admission_policy_hash"),
    voucherMaximumCommits:
      row.voucher_maximum_commits === null || row.voucher_maximum_commits === undefined
        ? null
        : Number(row.voucher_maximum_commits),
    voucherNotBefore: rowDate(row, "voucher_not_before"),
    voucherDeadline: rowDate(row, "voucher_deadline"),
    voucherStatus: rowText(row, "voucher_status"),
    prepaidStatus: rowText(row, "prepaid_status"),
    prepaidOperationKey: rowText(row, "prepaid_operation_key"),
    prepaidAmountAtomic: rowText(row, "prepaid_amount_atomic"),
    policyStatus: rowText(row, "policy_status"),
    policyOperationKey: rowText(row, "policy_operation_key"),
    policyAmountAtomic: rowText(row, "policy_amount_atomic"),
    quoteRequestJson: rowText(row, "quote_request_json"),
    questionContentId: rowText(row, "question_content_id"),
    questionTermsHash: rowText(row, "question_terms_hash"),
    questionContentJson: rowText(row, "question_content_json"),
    questionTermsJson: rowText(row, "question_terms_json"),
  };
}

async function validateDatabaseRound(
  operationId: string,
  request: PrivatePaidAssignmentOperationRequest,
  identity: PaidAssignmentChainIdentity,
  now: Date,
  bind: boolean,
) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT * FROM tokenless_paid_assignment_operations WHERE operation_id=$1 FOR UPDATE",
      [operationId],
    );
    let operation = operationFromRow(current.rows[0]!);
    if (operation.state !== "ask_attached" && operation.state !== "round_bound") {
      throw new TokenlessServiceError(
        "The paid assignment has no attached ask to validate.",
        409,
        "paid_assignment_round_pending",
        true,
      );
    }
    const candidate = await loadLockedRoundCandidate(client, operation);
    if (!candidate) {
      if (operation.state === "round_bound" || !bind) {
        throw new TokenlessServiceError(
          "The exact paid-assignment round is no longer live.",
          409,
          "paid_assignment_round_not_live",
          true,
        );
      }
      await client.query("COMMIT");
      return operation;
    }
    const binding = exactRoundBinding(operation, candidate, request, identity, now);
    if (!binding) {
      if (operation.state === "round_bound" || !bind) {
        throw new TokenlessServiceError(
          "The exact paid-assignment round is no longer live.",
          409,
          "paid_assignment_round_not_live",
          true,
        );
      }
      await client.query("COMMIT");
      return operation;
    }
    if (operation.state === "round_bound") {
      const stored = operation.round!;
      if (
        stored.deploymentKey !== binding.deploymentKey ||
        stored.chainId !== binding.chainId ||
        stored.panelAddress !== binding.panelAddress ||
        stored.roundId !== binding.roundId ||
        stored.contentId !== binding.contentId ||
        stored.termsHash !== binding.termsHash ||
        stored.roundTermsHash !== binding.roundTermsHash ||
        stored.paymentMode !== binding.paymentMode ||
        stored.paymentReference !== binding.paymentReference ||
        stored.commitDeadline.getTime() !== binding.commitDeadline.getTime() ||
        stored.confirmedAt.getTime() !== binding.confirmedAt.getTime()
      ) {
        throw new TokenlessServiceError(
          "The live chain round no longer matches the immutable operation binding.",
          409,
          "paid_assignment_round_conflict",
        );
      }
      await client.query("COMMIT");
      return operation;
    }
    if (!bind) {
      throw new TokenlessServiceError(
        "The exact paid-assignment round has not been bound.",
        409,
        "paid_assignment_round_pending",
        true,
      );
    }
    const revision = operation.transitionRevision + 1;
    const updated = await client.query(
      `UPDATE tokenless_paid_assignment_operations
       SET deployment_key=$1,chain_id=$2,panel_address=$3,round_id=$4,content_id=$5,terms_hash=$6,
           round_terms_hash=$7,payment_mode=$8,payment_reference=$9,commit_deadline=$10,
           confirmed_at=$11,bound_at=$12,state='round_bound',transition_revision=$13,updated_at=$12
       WHERE operation_id=$14 RETURNING *`,
      [
        binding.deploymentKey,
        binding.chainId,
        binding.panelAddress,
        binding.roundId,
        binding.contentId,
        binding.termsHash,
        binding.roundTermsHash,
        binding.paymentMode,
        binding.paymentReference,
        binding.commitDeadline,
        binding.confirmedAt,
        now,
        revision,
        operationId,
      ],
    );
    operation = operationFromRow(updated.rows[0]!);
    await insertOperationReceipt(
      client,
      operationId,
      revision,
      "round_bound",
      {
        ...binding,
        commitDeadline: binding.commitDeadline.toISOString(),
        confirmedAt: binding.confirmedAt.toISOString(),
        boundAt: binding.boundAt.toISOString(),
      },
      now,
    );
    await client.query("COMMIT");
    return operation;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function createPaidAssignmentOperationService(
  input: {
    repository?: PaidAssignmentOperationRepository;
    product?: PaidAssignmentProductGateway;
    authorize?: (request: PrivatePaidAssignmentOperationRequest, seed: OperationSeed, now: Date) => Promise<void>;
    chainIdentity?: () => PaidAssignmentChainIdentity;
  } = {},
) {
  const repository = input.repository ?? databaseRepository;
  const product = input.product ?? productGateway;
  const authorize = input.authorize ?? authorizePaidAssignment;
  const chainIdentity =
    input.chainIdentity ??
    (() => {
      const config = loadTokenlessChainConfig();
      return { deploymentKey: config.deploymentKey, chainId: config.chainId, panelAddress: config.panelAddress };
    });
  return async function ensurePrivatePaidAssignmentOperation(
    request: PrivatePaidAssignmentOperationRequest,
  ): Promise<PaidAssignmentOperationResult> {
    const now = request.now ?? new Date();
    const seed = operationSeed(request);
    // Authorization precedes the unique durable operation insert so a revoked
    // or under-scoped caller cannot occupy an opportunity lane.
    await authorize(request, seed, now);
    const ensured = await repository.ensure(seed, now);
    let operation = ensured.operation;
    const owner = `paid-activation:${randomUUID()}`;
    if (["prepared", "quote_created", "ask_prepared"].includes(operation.state)) {
      const claimed = await repository.claimActivation(operation.operationId, owner, now);
      operation = claimed.operation;
      if (!claimed.acquired) {
        return { ...operation, readyForAssignment: false, replayed: true };
      }
      let prepared: PreparedProductAsk | null = null;
      let preparedPersisted = operation.state === "ask_prepared";
      try {
        if (
          (operation.state === "quote_created" || operation.state === "ask_prepared") &&
          operation.quoteExpiresAt &&
          operation.quoteExpiresAt <= now
        ) {
          operation = await repository.recoverExpired(operation.operationId, owner, now);
          preparedPersisted = false;
        }
        if (operation.state === "prepared") {
          const quote = await product.createQuote(
            quoteRequest(request, seed.chainAdmissionPolicyHash),
            request.principal,
          );
          const quoteExpiresAt = new Date(quote.expiresAt);
          if (!Number.isFinite(quoteExpiresAt.getTime()) || quoteExpiresAt <= now) {
            throw new TokenlessServiceError("The private paid quote is already expired.", 409, "quote_expired");
          }
          operation = await repository.attachQuote(operation.operationId, owner, quote.quoteId, quoteExpiresAt, now);
        }
        const askRequest = (): TokenlessAskRequest => ({
          idempotencyKey: operation.requestIdempotencyKey,
          payment: { mode: "prepaid", workspaceId: operation.workspaceId },
          quoteId: operation.quoteId!,
        });
        if (operation.state === "quote_created") {
          prepared = await product.prepareAsk({ principal: request.principal, request: askRequest() });
          if (
            prepared.amountAtomic !== operation.expectedAmountAtomic ||
            prepared.paymentMode !== "prepaid" ||
            !prepared.policyReservationId ||
            prepared.quoteId !== operation.quoteId
          ) {
            throw new TokenlessServiceError(
              "The prepared ask funding does not match the exact paid assignment.",
              409,
              "paid_assignment_ask_conflict",
            );
          }
          operation = await repository.attachPreparedAsk(
            operation.operationId,
            owner,
            {
              quoteId: operation.quoteId!,
              prepaidReservationId: prepared.paymentReference,
              policyReservationId: prepared.policyReservationId,
              amountAtomic: prepared.amountAtomic,
            },
            now,
          );
          preparedPersisted = true;
        }
        if (operation.state === "ask_prepared") {
          prepared ??= await product.prepareAsk({ principal: request.principal, request: askRequest() });
          if (
            prepared.amountAtomic !== operation.expectedAmountAtomic ||
            prepared.paymentMode !== "prepaid" ||
            prepared.paymentReference !== operation.prepaidReservationId ||
            prepared.policyReservationId !== operation.policyReservationId ||
            prepared.quoteId !== operation.quoteId
          ) {
            throw new TokenlessServiceError(
              "The replayed ask funding does not match the durable operation.",
              409,
              "paid_assignment_ask_conflict",
            );
          }
          const ask = await product.createAsk(
            askRequest(),
            operation.requestIdempotencyKey,
            request.appOrigin.replace(/\/$/u, ""),
            prepared.idempotencyScope,
          );
          await product.attachAsk(prepared, ask);
          operation = await repository.attachAsk(
            operation.operationId,
            owner,
            {
              quoteId: operation.quoteId!,
              askOperationKey: ask.operationKey,
              prepaidReservationId: prepared.paymentReference,
              policyReservationId: prepared.policyReservationId!,
              amountAtomic: prepared.amountAtomic,
            },
            now,
          );
        }
      } catch (error) {
        if (prepared && !preparedPersisted) await product.releaseAsk(prepared);
        await repository.failActivation(
          operation.operationId,
          owner,
          error instanceof TokenlessServiceError ? error.code : "activation_failed",
          now,
        );
        throw error;
      }
    }
    if (operation.state === "ask_attached") {
      operation = await repository.bindExactRound(operation.operationId, request, chainIdentity(), now);
    }
    if (operation.state === "round_bound") {
      operation = await repository.revalidateExactRound(operation.operationId, request, chainIdentity(), now);
    }
    return {
      ...operation,
      readyForAssignment: operation.state === "round_bound",
      replayed: ensured.replayed,
    };
  };
}

export const ensurePrivatePaidAssignmentOperation = createPaidAssignmentOperationService();

export async function revalidatePrivatePaidAssignmentOperation(
  request: PrivatePaidAssignmentOperationRequest & { operationId: string },
) {
  const config = loadTokenlessChainConfig();
  return databaseRepository.revalidateExactRound(
    request.operationId,
    request,
    { deploymentKey: config.deploymentKey, chainId: config.chainId, panelAddress: config.panelAddress },
    request.now ?? new Date(),
  );
}

export async function bindPrivatePaidAssignmentSeatPreparations(input: {
  operationId: string;
  deliveryId: string;
  seats: readonly PaidAssignmentSeatPreparation[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const seats = input.seats
    .map(value => ({ ...value, payoutAccount: getAddress(value.payoutAccount).toLowerCase() }))
    .sort((left, right) => left.payoutAccount.localeCompare(right.payoutAccount));
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const operationResult = await client.query(
      `SELECT operation_id,workspace_id,opportunity_id,state
       FROM tokenless_paid_assignment_operations WHERE operation_id=$1 FOR UPDATE`,
      [input.operationId],
    );
    const operation = operationResult.rows[0] as Row | undefined;
    if (!operation || rowText(operation, "state") !== "round_bound") {
      throw new TokenlessServiceError(
        "Paid assignment seats require an exact bound chain round.",
        409,
        "paid_assignment_round_pending",
        true,
      );
    }
    const stored = await client.query(
      `SELECT seat_id,position,reviewer_principal_id,rater_id,payout_account,assignment_id,voucher_issuance_id,state
       FROM tokenless_paid_assignment_seats WHERE operation_id=$1 ORDER BY position ASC FOR UPDATE`,
      [input.operationId],
    );
    if (stored.rows.length !== seats.length) {
      throw new TokenlessServiceError(
        "Paid assignment seats do not match the operation.",
        409,
        "paid_assignment_seat_conflict",
      );
    }
    for (const [position, seat] of seats.entries()) {
      const row = stored.rows[position] as Row | undefined;
      if (
        !row ||
        Number(row.position) !== position ||
        rowText(row, "reviewer_principal_id") !== seat.principalId ||
        rowText(row, "rater_id") !== seat.raterId ||
        rowText(row, "payout_account") !== seat.payoutAccount ||
        (rowText(row, "assignment_id") !== null && rowText(row, "assignment_id") !== seat.assignmentId) ||
        (rowText(row, "voucher_issuance_id") !== null && rowText(row, "voucher_issuance_id") !== seat.voucherIssuanceId)
      ) {
        throw new TokenlessServiceError(
          "Paid assignment seats do not match the exact reviewer operation.",
          409,
          "paid_assignment_seat_conflict",
        );
      }
      const evidence = await client.query(
        `SELECT a.reviewer_account_address,a.delivery_id,i.workspace_id,i.opportunity_id,i.rater_id,i.status
         FROM tokenless_private_unpaid_review_assignments a
         JOIN tokenless_paid_review_voucher_issuances i ON i.issuance_id=$1
         WHERE a.assignment_id=$2 LIMIT 1`,
        [seat.voucherIssuanceId, seat.assignmentId],
      );
      const evidenceRow = evidence.rows[0] as Row | undefined;
      if (
        rowText(evidenceRow, "reviewer_account_address")?.toLowerCase() !== seat.payoutAccount ||
        rowText(evidenceRow, "delivery_id") !== input.deliveryId ||
        rowText(evidenceRow, "workspace_id") !== rowText(operation, "workspace_id") ||
        rowText(evidenceRow, "opportunity_id") !== rowText(operation, "opportunity_id") ||
        rowText(evidenceRow, "rater_id") !== seat.raterId ||
        rowText(evidenceRow, "status") !== "prepared"
      ) {
        throw new TokenlessServiceError(
          "Paid assignment seat evidence does not match its assignment and voucher preparation.",
          409,
          "paid_assignment_seat_conflict",
        );
      }
      if (rowText(row, "state") === "planned") {
        await client.query(
          `UPDATE tokenless_paid_assignment_seats
           SET assignment_id=$1,voucher_issuance_id=$2,state='voucher_prepared',transition_revision=1,updated_at=$3
           WHERE seat_id=$4`,
          [seat.assignmentId, seat.voucherIssuanceId, now, rowText(row, "seat_id")],
        );
        const value = receipt(
          input.operationId,
          1_000 + position,
          "seat_voucher_prepared",
          {
            seatId: rowText(row, "seat_id"),
            assignmentId: seat.assignmentId,
            voucherIssuanceId: seat.voucherIssuanceId,
            raterId: seat.raterId,
          },
          now,
        );
        const inserted = await client.query(
          `INSERT INTO tokenless_paid_assignment_receipts
             (receipt_id,operation_id,seat_id,sequence,operation_revision,seat_revision,
              receipt_type,receipt_version,receipt_json,receipt_hash,created_at)
           VALUES ($1,$2,$3,$4,NULL,1,'seat_voucher_prepared',1,$5,$6,$7)
           ON CONFLICT (seat_id,seat_revision) DO NOTHING RETURNING receipt_id`,
          [
            value.receiptId,
            input.operationId,
            rowText(row, "seat_id"),
            1_000 + position,
            value.receiptJson,
            value.receiptHash,
            now,
          ],
        );
        if (inserted.rowCount !== 1) {
          const existing = await client.query(
            `SELECT receipt_json,receipt_hash,receipt_type FROM tokenless_paid_assignment_receipts
             WHERE seat_id=$1 AND seat_revision=1 LIMIT 1`,
            [rowText(row, "seat_id")],
          );
          const existingRow = existing.rows[0];
          if (
            rowText(existingRow, "receipt_json") !== value.receiptJson ||
            rowText(existingRow, "receipt_hash") !== value.receiptHash ||
            rowText(existingRow, "receipt_type") !== "seat_voucher_prepared"
          ) {
            throw new TokenlessServiceError(
              "The immutable paid-assignment seat receipt conflicts with this transition.",
              409,
              "paid_assignment_receipt_conflict",
            );
          }
        }
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const __paidAssignmentOperationsTestUtils = {
  exactRoundBinding,
  operationSeed,
  quoteRequest,
  sha256,
};
