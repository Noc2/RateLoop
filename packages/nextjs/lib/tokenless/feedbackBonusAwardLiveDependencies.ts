import "server-only";
import { dbPool } from "~~/lib/db";
import { readFeedbackBonusAssuranceResponse } from "~~/lib/tokenless/assuranceResponses";
import type { FeedbackBonusAwardDependencies } from "~~/lib/tokenless/feedbackBonusAwards";
import { createLiveFeedbackBonusHumanWalletExecution } from "~~/lib/tokenless/feedbackBonusHumanWalletExecution";
import { readFeedbackBonusPublicRaterResponse } from "~~/lib/tokenless/publicRaterResponses";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type QueryResult = { rowCount: number | null; rows: Row[] };
type Queryable = { query(text: string, values?: unknown[]): Promise<QueryResult> };

const REFERENCE_PATTERN =
  /^rateloop\.feedback-body\.v1:(public_rater_response|assurance_response):([A-Za-z0-9][A-Za-z0-9_-]{0,159})$/u;

type FeedbackBodySource = "public_rater_response" | "assurance_response";

export type FeedbackBonusBodyReaders = {
  publicRaterResponse(input: {
    responseId: string;
    workspaceId: string;
    opportunityId: string;
    expectedResponseHash: string;
  }): Promise<string>;
  assuranceResponse(input: { responseId: string; workspaceId: string; opportunityId: string }): Promise<string>;
};

type FeedbackBonusHumanWalletExecution = ReturnType<typeof createLiveFeedbackBonusHumanWalletExecution>;

function unavailable(): never {
  throw new TokenlessServiceError(
    "The selected Feedback Bonus body is unavailable.",
    409,
    "feedback_bonus_body_unavailable",
  );
}

function typedReference(value: string): { source: FeedbackBodySource; responseId: string } {
  const match = REFERENCE_PATTERN.exec(value);
  if (!match) unavailable();
  return { source: match[1] as FeedbackBodySource, responseId: match[2]! };
}

function text(row: Row, key: string) {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

/**
 * Resolve only a body that the 0068 projection has bound to the exact
 * workspace and configured human awarder. The projection check intentionally
 * happens before either response vault is touched.
 */
export function createFeedbackBonusBodyReader(input?: { queryable?: Queryable; readers?: FeedbackBonusBodyReaders }) {
  const queryable = input?.queryable ?? (dbPool as unknown as Queryable);
  const readers: FeedbackBonusBodyReaders = input?.readers ?? {
    publicRaterResponse: readFeedbackBonusPublicRaterResponse,
    assuranceResponse: readFeedbackBonusAssuranceResponse,
  };

  return async function readFeedbackBody(request: {
    bodyReference: string;
    workspaceId: string;
    awarderAccount: string;
  }) {
    const reference = typedReference(request.bodyReference);
    const result = await queryable.query(
      `SELECT feedback.opportunity_id, feedback.response_hash
       FROM tokenless_feedback_bonus_feedback feedback
       JOIN tokenless_feedback_bonus_pools pool
         ON pool.workspace_id = feedback.workspace_id
        AND pool.opportunity_id = feedback.opportunity_id
       WHERE feedback.workspace_id = $1
         AND feedback.body_reference = $2
         AND feedback.eligibility_status = 'eligible'
         AND feedback.awarded_at IS NULL
         AND pool.awarder_account = $3
         AND pool.awarder_wallet IS NOT NULL
         AND pool.status IN ('funded','award_open')
       LIMIT 2`,
      [request.workspaceId, request.bodyReference, request.awarderAccount],
    );
    if (result.rowCount !== 1) unavailable();
    const row = result.rows[0]!;
    const opportunityId = text(row, "opportunity_id");
    const responseHash = text(row, "response_hash");
    if (!opportunityId || !responseHash || !/^0x[0-9a-f]{64}$/u.test(responseHash)) unavailable();

    const body = await (reference.source === "public_rater_response"
      ? readers.publicRaterResponse({
          responseId: reference.responseId,
          workspaceId: request.workspaceId,
          opportunityId,
          expectedResponseHash: responseHash,
        })
      : readers.assuranceResponse({
          responseId: reference.responseId,
          workspaceId: request.workspaceId,
          opportunityId,
        }));
    const normalized = body.trim();
    if (!normalized) unavailable();
    return normalized;
  };
}

/** Lazy, build-safe production dependencies for the award service. */
export function getLiveFeedbackBonusAwardDependencies(input?: {
  createHumanWalletExecution?: () => FeedbackBonusHumanWalletExecution;
}): Omit<FeedbackBonusAwardDependencies, "repository"> {
  let humanWalletExecution: FeedbackBonusHumanWalletExecution | null = null;
  const getHumanWalletExecution = () => {
    humanWalletExecution ??= input?.createHumanWalletExecution?.() ?? createLiveFeedbackBonusHumanWalletExecution();
    return humanWalletExecution;
  };
  return {
    prepareHumanAward: prepared => getHumanWalletExecution().prepareHumanAward(prepared),
    confirmHumanAward: prepared => getHumanWalletExecution().confirmHumanAward(prepared),
    readFeedbackBody: createFeedbackBonusBodyReader(),
  };
}
