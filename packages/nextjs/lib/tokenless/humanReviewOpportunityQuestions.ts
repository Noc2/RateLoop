import type { PoolClient } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";
import {
  type AgentPerRequestBinaryQuestionInput,
  BINARY_REVIEW_QUESTION_SCHEMA_VERSION,
  type FrozenBinaryReviewQuestion,
  hashFrozenBinaryReviewQuestion,
  resolveHumanReviewQuestion,
  serializeFrozenBinaryReviewQuestion,
} from "~~/lib/tokenless/humanReviewQuestions";
import { applyHumanReviewRequestTransactionTimeouts } from "~~/lib/tokenless/humanReviewRequestDatabase";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type QueryClient = Pick<PoolClient, "query" | "release">;
type QuestionPool = { connect(): Promise<QueryClient> };

export type SealedPrivateReviewQuestion = {
  ciphertext: string;
  keyRef: string;
};

export type FreezeHumanReviewOpportunityQuestionInput = {
  workspaceId: string;
  opportunityId: string;
  integrationId: string;
  callerQuestion?: AgentPerRequestBinaryQuestionInput | unknown;
  sealedPrivateQuestion?: SealedPrivateReviewQuestion;
  now?: Date;
};

export type FrozenHumanReviewOpportunityQuestion = Readonly<{
  question: FrozenBinaryReviewQuestion;
  questionHash: `sha256:${string}`;
  contentBoundary: "private_workspace" | "public_or_test";
  persisted: boolean;
  replayed: boolean;
}>;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function identifier(value: unknown, field: string) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_review_question_binding");
  }
  return value;
}

function configurationError(message: string): never {
  throw new TokenlessServiceError(message, 500, "review_configuration_invalid");
}

function conflict(): never {
  throw new TokenlessServiceError(
    "This review opportunity is already bound to a different immutable question.",
    409,
    "review_question_conflict",
  );
}

function profileFromRow(row: Row) {
  const questionAuthority = text(row, "question_authority");
  const resultSemantics = text(row, "result_semantics");
  const rationaleMode = text(row, "rationale_mode");
  const contentBoundary = text(row, "content_boundary");
  if (
    (questionAuthority !== "owner_fixed" && questionAuthority !== "agent_per_request") ||
    (resultSemantics !== "assurance" && resultSemantics !== "feedback") ||
    (rationaleMode !== "off" && rationaleMode !== "optional" && rationaleMode !== "required") ||
    (contentBoundary !== "private_workspace" && contentBoundary !== "public_or_test")
  ) {
    configurationError("Stored review question policy is invalid.");
  }
  return {
    policy: {
      questionAuthority,
      resultSemantics,
      criterion: text(row, "criterion"),
      positiveLabel: text(row, "positive_label"),
      negativeLabel: text(row, "negative_label"),
      rationaleMode,
    },
    contentBoundary,
  } as const;
}

function exactPrivateSeal(value: SealedPrivateReviewQuestion | undefined) {
  if (
    !value ||
    typeof value.ciphertext !== "string" ||
    !value.ciphertext ||
    typeof value.keyRef !== "string" ||
    !value.keyRef
  ) {
    throw new TokenlessServiceError(
      "A new private agent-written question must be sealed before it can be frozen.",
      400,
      "private_review_question_seal_required",
    );
  }
  return value;
}

function existingMatches(input: {
  row: Row;
  workspaceId: string;
  opportunityId: string;
  integrationId: string;
  contentBoundary: "private_workspace" | "public_or_test";
  questionHash: string;
  questionJson: string;
}) {
  const row = input.row;
  const common =
    text(row, "workspace_id") === input.workspaceId &&
    text(row, "opportunity_id") === input.opportunityId &&
    text(row, "schema_version") === BINARY_REVIEW_QUESTION_SCHEMA_VERSION &&
    text(row, "question_authority") === "agent_per_request" &&
    text(row, "result_semantics") === "feedback" &&
    text(row, "question_hash") === input.questionHash &&
    text(row, "content_boundary") === input.contentBoundary &&
    text(row, "submitted_by_integration_id") === input.integrationId;
  if (!common) return false;
  if (input.contentBoundary === "public_or_test") {
    return (
      text(row, "question_json") === input.questionJson &&
      row.question_ciphertext === null &&
      row.question_key_ref === null
    );
  }
  return (
    row.question_json === null &&
    typeof row.question_ciphertext === "string" &&
    row.question_ciphertext.length > 0 &&
    typeof row.question_key_ref === "string" &&
    row.question_key_ref.length > 0
  );
}

export function createHumanReviewOpportunityQuestionFreezer(
  pool: QuestionPool = dbPool,
  capabilities: { privateAgentPerRequest?: boolean } = {},
) {
  return async function freezeHumanReviewOpportunityQuestion(
    input: FreezeHumanReviewOpportunityQuestionInput,
  ): Promise<FrozenHumanReviewOpportunityQuestion> {
    const workspaceId = identifier(input.workspaceId, "workspaceId");
    const opportunityId = identifier(input.opportunityId, "opportunityId");
    const integrationId = identifier(input.integrationId, "integrationId");
    const now = input.now ?? new Date();
    if (!Number.isFinite(now.getTime())) {
      throw new TokenlessServiceError("Question submission time is invalid.", 400, "invalid_review_question_binding");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await applyHumanReviewRequestTransactionTimeouts(client as PoolClient);
      const opportunityResult = await client.query(
        `SELECT rp.question_authority,rp.result_semantics,rp.criterion,rp.positive_label,
                rp.negative_label,rp.rationale_mode,rp.content_boundary
         FROM tokenless_agent_review_opportunities o
         JOIN tokenless_agent_review_opportunity_lifecycles l
           ON l.workspace_id=o.workspace_id AND l.opportunity_id=o.opportunity_id
         JOIN tokenless_agent_integrations i
           ON i.workspace_id=o.workspace_id AND i.integration_id=$3
          AND i.agent_id=o.agent_id AND i.agent_version_id=o.agent_version_id
          AND i.review_policy_id=o.policy_id AND i.review_policy_version=o.policy_version
          AND i.human_review_binding_id=o.human_review_binding_id
          AND i.human_review_binding_version=o.human_review_binding_version
          AND i.status='active' AND i.revoked_at IS NULL
         JOIN tokenless_agent_review_request_profiles rp
           ON rp.workspace_id=o.workspace_id AND rp.profile_id=o.request_profile_id
          AND rp.version=o.request_profile_version AND rp.profile_hash=o.request_profile_hash
         WHERE o.workspace_id=$1 AND o.opportunity_id=$2
           AND l.terminal_at IS NULL
           AND l.state IN ('approval_required','request_ready','pending','blocked')
         FOR UPDATE`,
        [workspaceId, opportunityId, integrationId],
      );
      const opportunityRow = opportunityResult.rows[0] as Row | undefined;
      if (opportunityResult.rowCount !== 1 || !opportunityRow) {
        throw new TokenlessServiceError(
          "The active review opportunity is not available for this integration.",
          409,
          "review_question_binding_unavailable",
        );
      }
      const profile = profileFromRow(opportunityRow);
      const question = resolveHumanReviewQuestion({
        policy: profile.policy,
        ...(input.callerQuestion === undefined ? {} : { callerQuestion: input.callerQuestion }),
      });
      const questionHash = hashFrozenBinaryReviewQuestion(question);
      const questionJson = serializeFrozenBinaryReviewQuestion(question);

      if (question.questionAuthority === "owner_fixed") {
        await client.query("COMMIT");
        return Object.freeze({
          question,
          questionHash,
          contentBoundary: profile.contentBoundary,
          persisted: false,
          replayed: false,
        });
      }

      if (profile.contentBoundary === "private_workspace" && capabilities.privateAgentPerRequest !== true) {
        throw new TokenlessServiceError(
          "Agent-written private review questions are not available on this deployment.",
          409,
          "private_agent_review_questions_unavailable",
        );
      }

      const existingResult = await client.query(
        `SELECT workspace_id,opportunity_id,schema_version,question_authority,result_semantics,
                question_hash,content_boundary,question_json,question_ciphertext,question_key_ref,
                submitted_by_integration_id,submitted_at
         FROM tokenless_agent_review_opportunity_questions
         WHERE workspace_id=$1 AND opportunity_id=$2`,
        [workspaceId, opportunityId],
      );
      const existing = existingResult.rows[0] as Row | undefined;
      if (existing) {
        if (
          !existingMatches({
            row: existing,
            workspaceId,
            opportunityId,
            integrationId,
            contentBoundary: profile.contentBoundary,
            questionHash,
            questionJson,
          })
        ) {
          conflict();
        }
        await client.query("COMMIT");
        return Object.freeze({
          question,
          questionHash,
          contentBoundary: profile.contentBoundary,
          persisted: true,
          replayed: true,
        });
      }

      const privateSeal =
        profile.contentBoundary === "private_workspace" ? exactPrivateSeal(input.sealedPrivateQuestion) : null;
      if (profile.contentBoundary === "public_or_test" && input.sealedPrivateQuestion !== undefined) {
        throw new TokenlessServiceError(
          "Public or test review questions cannot be stored as private ciphertext.",
          400,
          "invalid_review_question_storage",
        );
      }
      await client.query(
        `INSERT INTO tokenless_agent_review_opportunity_questions
         (workspace_id,opportunity_id,schema_version,question_authority,result_semantics,
          question_hash,content_boundary,question_json,question_ciphertext,question_key_ref,
          submitted_by_integration_id,submitted_at)
         VALUES ($1,$2,$3,'agent_per_request','feedback',$4,$5,$6,$7,$8,$9,$10)`,
        [
          workspaceId,
          opportunityId,
          BINARY_REVIEW_QUESTION_SCHEMA_VERSION,
          questionHash,
          profile.contentBoundary,
          profile.contentBoundary === "public_or_test" ? questionJson : null,
          privateSeal?.ciphertext ?? null,
          privateSeal?.keyRef ?? null,
          integrationId,
          now,
        ],
      );
      await client.query("COMMIT");
      return Object.freeze({
        question,
        questionHash,
        contentBoundary: profile.contentBoundary,
        persisted: true,
        replayed: false,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
}

export const freezeHumanReviewOpportunityQuestion = createHumanReviewOpportunityQuestionFreezer();
