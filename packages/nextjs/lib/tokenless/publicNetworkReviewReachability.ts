import {
  HUMAN_ASSURANCE_SCHEMA_VERSION,
  type HumanAssuranceAudiencePolicy,
  type TokenlessQuoteRequest,
  buildTokenlessQuoteIntent,
} from "@rateloop/sdk";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { dbClient, dbPool } from "~~/lib/db";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import { lockAssuranceProjectForRunMutation } from "~~/lib/tokenless/assuranceProjectMutation";
import { bindAssuranceCaseRound, freezeAssuranceRunOrchestration } from "~~/lib/tokenless/assuranceRunOrchestration";
import { expireAudienceAssignments } from "~~/lib/tokenless/audienceAssignments";
import {
  type AssurancePrincipal,
  canonicalizeHumanAssuranceDocument,
  freezeAssuranceSuite,
  hashHumanAssuranceDocument,
} from "~~/lib/tokenless/humanAssurance";
import type { FrozenBinaryReviewQuestion } from "~~/lib/tokenless/humanReviewQuestions";
import type { PreparedHumanReviewRequest } from "~~/lib/tokenless/humanReviewRequestPreparation";
import { throwIfMaintenanceCancelled } from "~~/lib/tokenless/maintenanceCancellation";
import { reconcileNetworkAssignmentSettlements } from "~~/lib/tokenless/networkAssignmentSettlement";
import { prepareAndReserveNetworkRunAudience } from "~~/lib/tokenless/networkAudienceOrchestration";
import type { PreparedProductAsk } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type Hash = `sha256:${string}`;
type Bytes32 = `0x${string}`;
type WorkspaceManager = Extract<AssurancePrincipal, { kind: "workspace_session" }>;

const HASH = /^sha256:[0-9a-f]{64}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
export const PUBLIC_NETWORK_FOUNDATION_ORPHAN_TTL_MS = 24 * 60 * 60_000;
const MAX_WORKER_ATTEMPTS = 20;

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function integer(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value)) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function stableHash(value: unknown): Hash {
  return hashHumanAssuranceDocument(value);
}

function deterministicId(prefix: string, identity: string) {
  return `${prefix}_${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

function reviewerTarget(policy: HumanAssuranceAudiencePolicy, expectedPanelSize: number) {
  if (
    policy.reviewerSource !== "rateloop_network" ||
    policy.compensation !== "paid" ||
    policy.selection !== "randomized" ||
    policy.cohorts.length !== 1 ||
    policy.cohorts[0]?.minimumReviewers !== expectedPanelSize ||
    policy.cohorts[0]?.maximumReviewers !== expectedPanelSize
  ) {
    throw new TokenlessServiceError(
      "Public paid review requires one exact randomized network cohort matching the funded panel size.",
      409,
      "public_network_audience_policy_unreachable",
    );
  }
  return policy.cohorts[0]!;
}

async function loadWorkspaceManager(
  client: PoolClient,
  workspaceId: string,
  projectId: string,
): Promise<WorkspaceManager> {
  const result = await client.query(
    `SELECT member.account_address,member.role
     FROM tokenless_workspace_members member
     JOIN tokenless_project_access_assignments access
       ON access.workspace_id=member.workspace_id AND access.project_id=$2
      AND access.subject_reference=lower(member.account_address)
      AND access.subject_kind=CASE
        WHEN member.account_address LIKE 'rlp_%' THEN 'principal' ELSE 'account' END
      AND access.role='admin' AND access.status='active'
      AND (access.expires_at IS NULL OR access.expires_at > now())
     WHERE member.workspace_id=$1 AND member.role IN ('owner','admin')
     ORDER BY CASE member.role WHEN 'owner' THEN 0 ELSE 1 END,member.created_at ASC LIMIT 1`,
    [workspaceId, projectId],
  );
  const row = result.rows[0] as Row | undefined;
  const accountAddress = text(row, "account_address");
  const role = text(row, "role");
  if (!accountAddress || (role !== "owner" && role !== "admin")) {
    throw new TokenlessServiceError(
      "The workspace needs an active owner or admin to orchestrate public review.",
      409,
      "public_network_workspace_manager_unavailable",
    );
  }
  return { kind: "workspace_session", accountAddress, workspaceId, role };
}

export type PublicNetworkFoundationInput = {
  workspaceId: string;
  integrationId: string;
  opportunityId: string;
  idempotencyKey: string;
  sourcePayload: string;
  suggestionPayload: string;
  sourceEvidenceHash: Hash;
  suggestionCommitment: Hash;
  requestProfile: { id: string; version: number; hash: Hash; panelSize: number };
  effectiveQuestion: FrozenBinaryReviewQuestion;
  preparation: PreparedHumanReviewRequest;
  preparedProductAsk: PreparedProductAsk;
  publication: {
    visibility: "public";
    dataClassification: "public" | "synthetic" | "redacted";
    confirmedNoSensitiveData: true;
    redactionSummary?: string;
  };
};

export type PublicNetworkFoundation = {
  bindingId: string;
  projectId: string;
  suiteId: string;
  suiteVersion: number;
  caseId: string;
  runId: string;
  productContentId: Bytes32;
  orchestrationContentId: Bytes32;
  confidentialityTermsHash: Hash;
};

export type ReadyPublicNetworkReviewChild = {
  operationKey: string;
  runId: string;
  childReference: string;
  round: {
    deploymentKey: string;
    chainId: number;
    panelAddress: string;
    roundId: string;
    admissionPolicyHash: Bytes32;
  };
  assignments: {
    assignmentId: string;
    principalId: string;
    payoutAccount: string;
    selectionBindingHash: Hash;
    voucherMarker: string;
  }[];
  assignmentReferences: string[];
  assignmentEvidenceHash: Hash;
  voucherPreparationHash: Hash;
  settlementBindingHash: Hash;
  replayed: true;
};

function foundationIdentity(input: PublicNetworkFoundationInput, productContentId: Bytes32, policyHash: Hash) {
  return {
    schemaVersion: "rateloop.public-network-review-binding.v1",
    workspaceId: input.workspaceId,
    integrationId: input.integrationId,
    opportunityId: input.opportunityId,
    idempotencyKey: input.idempotencyKey,
    requestProfile: input.requestProfile,
    preparedRequestHash: input.preparation.preparedRequestHash,
    derivedEconomicsHash: input.preparation.derivedEconomicsHash,
    questionHash: input.preparation.questionHash,
    contentCommitments: {
      source: input.sourceEvidenceHash,
      suggestion: input.suggestionCommitment,
      product: productContentId,
    },
    audiencePolicyHash: policyHash,
    publication: input.publication,
  };
}

function exactStoredFoundation(
  row: Row,
  expected: {
    bindingId: string;
    workspaceId: string;
    opportunityId: string;
    integrationId: string;
    idempotencyKey: string;
    requestProfile: PublicNetworkFoundationInput["requestProfile"];
    preparation: PreparedHumanReviewRequest;
    sourceEvidenceHash: Hash;
    suggestionCommitment: Hash;
    exactBindingHash: Hash;
    projectId: string;
    audiencePolicyId: string;
    audiencePolicyVersion: number;
    audiencePolicyHash: Hash;
    suiteId: string;
    caseId: string;
    runId: string;
    productQuestionId: string;
    productContentId: Bytes32;
    admissionPolicyHash: Bytes32;
    confidentialityTermsHash: Hash;
  },
) {
  return (
    text(row, "binding_id") === expected.bindingId &&
    text(row, "workspace_id") === expected.workspaceId &&
    text(row, "opportunity_id") === expected.opportunityId &&
    text(row, "integration_id") === expected.integrationId &&
    text(row, "idempotency_key") === expected.idempotencyKey &&
    text(row, "request_profile_id") === expected.requestProfile.id &&
    integer(row, "request_profile_version") === expected.requestProfile.version &&
    text(row, "request_profile_hash") === expected.requestProfile.hash &&
    text(row, "prepared_request_hash") === expected.preparation.preparedRequestHash &&
    text(row, "derived_economics_hash") === expected.preparation.derivedEconomicsHash &&
    text(row, "question_hash") === expected.preparation.questionHash &&
    text(row, "source_evidence_hash") === expected.sourceEvidenceHash &&
    text(row, "suggestion_commitment") === expected.suggestionCommitment &&
    text(row, "exact_binding_hash") === expected.exactBindingHash &&
    text(row, "project_id") === expected.projectId &&
    text(row, "audience_policy_id") === expected.audiencePolicyId &&
    integer(row, "audience_policy_version") === expected.audiencePolicyVersion &&
    text(row, "audience_policy_hash") === expected.audiencePolicyHash &&
    text(row, "suite_id") === expected.suiteId &&
    integer(row, "suite_version") === 1 &&
    text(row, "case_id") === expected.caseId &&
    text(row, "run_id") === expected.runId &&
    text(row, "product_question_id") === expected.productQuestionId &&
    text(row, "product_content_id") === expected.productContentId &&
    text(row, "admission_policy_hash") === expected.admissionPolicyHash &&
    text(row, "confidentiality_terms_hash") === expected.confidentialityTermsHash
  );
}

async function seedFoundationResources(input: {
  source: PublicNetworkFoundationInput;
  bindingId: string;
  projectId: string;
  policyId: string;
  policyVersion: number;
  policyHash: Hash;
  policy: HumanAssuranceAudiencePolicy;
  suiteId: string;
  rubricId: string;
  caseId: string;
  runId: string;
  sourceArtifactId: string;
  candidateArtifactId: string;
  productContentId: Bytes32;
  exactBindingHash: Hash;
  confidentialityTermsHash: Hash;
  manager: WorkspaceManager;
}) {
  const now = new Date();
  const rationale =
    input.source.effectiveQuestion.rationaleMode === "off"
      ? ({ mode: "off" } as const)
      : ({
          mode: input.source.effectiveQuestion.rationaleMode,
          minLength: input.source.effectiveQuestion.rationaleMode === "required" ? 10 : 0,
          maxLength: 2_000,
        } as const);
  const rubric = {
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    rubricId: input.rubricId,
    projectId: input.projectId,
    version: 1,
    prompt: input.source.effectiveQuestion.prompt,
    choices: ["baseline", "candidate", "tie"] as const,
    failureTags: [],
    rationale,
    passRule: {
      metric: "candidate_preference_share_bps" as const,
      operator: "gte" as const,
      thresholdBps: 5_000,
      minimumValidResponses: input.source.requestProfile.panelSize,
    },
  };
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const project = await lockAssuranceProjectForRunMutation(client, input.projectId);
    if (!project || project.status !== "active" || project.workspace_id !== input.source.workspaceId) {
      throw new TokenlessServiceError(
        "The frozen admission policy is not attached to an exact workspace-owned public project.",
        409,
        "public_network_project_binding_mismatch",
      );
    }
    const policyResult = await client.query(
      `SELECT ap.project_id,ap.policy_id,ap.version,ap.policy_hash,ap.policy_json,
              p.workspace_id,p.status,p.visibility,p.material_kind,p.data_classification
       FROM tokenless_assurance_audience_policies ap
       JOIN tokenless_assurance_projects p ON p.project_id=ap.project_id
       WHERE ap.project_id=$1 AND ap.policy_id=$2 AND ap.version=$3
       LIMIT 1 FOR SHARE`,
      [input.projectId, input.policyId, input.policyVersion],
    );
    const policyRow = policyResult.rows[0] as Row | undefined;
    if (
      !policyRow ||
      text(policyRow, "workspace_id") !== input.source.workspaceId ||
      text(policyRow, "status") !== "active" ||
      text(policyRow, "visibility") !== "public" ||
      text(policyRow, "material_kind") !== input.source.publication.dataClassification ||
      text(policyRow, "data_classification") !== "public" ||
      text(policyRow, "policy_hash") !== input.policyHash ||
      text(policyRow, "policy_json") !== canonicalizeHumanAssuranceDocument(input.policy)
    ) {
      throw new TokenlessServiceError(
        "The frozen admission policy is not attached to an exact workspace-owned public project.",
        409,
        "public_network_project_binding_mismatch",
      );
    }
    await client.query(
      `INSERT INTO tokenless_assurance_artifacts
       (artifact_id,project_id,role,label,digest,content_type,size_bytes,storage_ref,
        redaction_status,renderer_policy,created_at,updated_at)
       VALUES
       ($1,$2,'baseline','Public review source',$3,'text/plain',$4,$5,'approved','plain_text',$6,$6),
       ($7,$2,'candidate','Agent suggestion',$8,'text/plain',$9,$10,'approved','plain_text',$6,$6)
       ON CONFLICT (artifact_id) DO NOTHING`,
      [
        input.sourceArtifactId,
        input.projectId,
        input.source.sourceEvidenceHash,
        Buffer.byteLength(input.source.sourcePayload),
        `public-review:${input.bindingId}:source`,
        now,
        input.candidateArtifactId,
        input.source.suggestionCommitment,
        Buffer.byteLength(input.source.suggestionPayload),
        `public-review:${input.bindingId}:suggestion`,
      ],
    );
    await client.query(
      `INSERT INTO tokenless_assurance_rubrics
       (rubric_id,project_id,version,prompt,failure_tags_json,rationale_json,
        pass_rule_json,rubric_json,created_at)
       VALUES ($1,$2,1,$3,'[]',$4,$5,$6,$7)
       ON CONFLICT (rubric_id,version) DO NOTHING`,
      [
        input.rubricId,
        input.projectId,
        rubric.prompt,
        JSON.stringify(rubric.rationale),
        JSON.stringify(rubric.passRule),
        canonicalizeHumanAssuranceDocument(rubric),
        now,
      ],
    );
    await client.query(
      `INSERT INTO tokenless_assurance_suites
       (suite_id,project_id,name,version,status,rubric_id,rubric_version,created_at,updated_at)
       VALUES ($1,$2,'Public paid network review',1,'draft',$3,1,$4,$4)
       ON CONFLICT (suite_id,version) DO NOTHING`,
      [input.suiteId, input.projectId, input.rubricId, now],
    );
    await client.query(
      `INSERT INTO tokenless_assurance_cases
       (case_id,project_id,suite_id,suite_version,position,title,instructions,
        baseline_artifact_id,candidate_artifact_id,context_artifact_ids_json,
        objective_reference,deterministic_checks_json,status,created_at,updated_at)
       VALUES ($1,$2,$3,1,0,'Public paid network review',$4,$5,$6,'[]',$7,'[]','ready',$8,$8)
       ON CONFLICT (case_id) DO NOTHING`,
      [
        input.caseId,
        input.projectId,
        input.suiteId,
        input.source.effectiveQuestion.prompt,
        input.sourceArtifactId,
        input.candidateArtifactId,
        input.source.opportunityId,
        now,
      ],
    );
    const exactResources = await client.query(
      `SELECT s.project_id,s.status,s.rubric_id,c.case_id,c.status AS case_status,
              c.baseline_artifact_id,c.candidate_artifact_id,r.rubric_json,
              baseline.digest AS baseline_digest,candidate.digest AS candidate_digest
       FROM tokenless_assurance_suites s
       JOIN tokenless_assurance_cases c ON c.suite_id=s.suite_id AND c.suite_version=s.version
       JOIN tokenless_assurance_rubrics r ON r.rubric_id=s.rubric_id AND r.version=s.rubric_version
       JOIN tokenless_assurance_artifacts baseline ON baseline.artifact_id=c.baseline_artifact_id
       JOIN tokenless_assurance_artifacts candidate ON candidate.artifact_id=c.candidate_artifact_id
       WHERE s.suite_id=$1 AND s.version=1 AND c.case_id=$2 LIMIT 1 FOR SHARE`,
      [input.suiteId, input.caseId],
    );
    const resource = exactResources.rows[0] as Row | undefined;
    if (
      !resource ||
      text(resource, "project_id") !== input.projectId ||
      !["draft", "frozen"].includes(text(resource, "status") ?? "") ||
      text(resource, "rubric_id") !== input.rubricId ||
      text(resource, "case_status") !== "ready" ||
      text(resource, "baseline_artifact_id") !== input.sourceArtifactId ||
      text(resource, "candidate_artifact_id") !== input.candidateArtifactId ||
      text(resource, "rubric_json") !== canonicalizeHumanAssuranceDocument(rubric) ||
      text(resource, "baseline_digest") !== input.source.sourceEvidenceHash ||
      text(resource, "candidate_digest") !== input.source.suggestionCommitment
    ) {
      throw new TokenlessServiceError(
        "The idempotent public-review foundation conflicts with stored resources.",
        409,
        "public_network_foundation_conflict",
      );
    }
    await client.query(
      `INSERT INTO tokenless_assurance_runs
       (run_id,project_id,suite_id,suite_version,audience_policy_id,audience_policy_version,
        status,policy_hash,created_by,created_at,updated_at)
       VALUES ($1,$2,$3,1,$4,$5,'draft',$6,$7,$8,$8)
       ON CONFLICT (run_id) DO NOTHING`,
      [
        input.runId,
        input.projectId,
        input.suiteId,
        input.policyId,
        input.policyVersion,
        input.policyHash,
        `system:public-network:${input.source.integrationId}`,
        now,
      ],
    );
    await client.query(
      `INSERT INTO tokenless_public_network_review_bindings
       (binding_id,workspace_id,opportunity_id,integration_id,idempotency_key,
        request_profile_id,request_profile_version,request_profile_hash,
        prepared_request_hash,derived_economics_hash,question_hash,
        source_evidence_hash,suggestion_commitment,exact_binding_hash,
        project_id,audience_policy_id,audience_policy_version,audience_policy_hash,
        suite_id,suite_version,case_id,run_id,product_question_id,product_content_id,
        orchestration_content_id,admission_policy_hash,confidentiality_terms_hash,
        state,worker_next_attempt_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
               $19,1,$20,$21,$22,$23,NULL,$24,$25,'foundation_preparing',NULL,$26,$26)
       ON CONFLICT (binding_id) DO NOTHING`,
      [
        input.bindingId,
        input.source.workspaceId,
        input.source.opportunityId,
        input.source.integrationId,
        input.source.idempotencyKey,
        input.source.requestProfile.id,
        input.source.requestProfile.version,
        input.source.requestProfile.hash,
        input.source.preparation.preparedRequestHash,
        input.source.preparation.derivedEconomicsHash,
        input.source.preparation.questionHash,
        input.source.sourceEvidenceHash,
        input.source.suggestionCommitment,
        input.exactBindingHash,
        input.projectId,
        input.policyId,
        input.policyVersion,
        input.policyHash,
        input.suiteId,
        input.caseId,
        input.runId,
        input.source.preparedProductAsk.questionId,
        input.productContentId,
        `0x${input.policyHash.slice("sha256:".length)}`,
        input.confidentialityTermsHash,
        now,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await freezeAssuranceSuite({ principal: input.manager, suiteId: input.suiteId, suiteVersion: 1 });

  const frozen = await freezeAssuranceRunOrchestration({
    principal: input.manager,
    runId: input.runId,
    productContentBridge: { caseId: input.caseId, productContentId: input.productContentId },
  });
  const bridge = frozen.contentBridge;
  if (
    !bridge ||
    bridge.caseId !== input.caseId ||
    bridge.productContentId !== input.productContentId ||
    !BYTES32.test(bridge.orchestrationContentId)
  ) {
    throw new Error("Public network run did not freeze its exact product content bridge.");
  }
  const ready = await dbClient.execute({
    sql: `UPDATE tokenless_public_network_review_bindings
          SET orchestration_content_id=?,state='foundation_ready',updated_at=?
          WHERE binding_id=? AND state='foundation_preparing'
          RETURNING binding_id`,
    args: [bridge.orchestrationContentId, new Date(), input.bindingId],
  });
  if (!ready.rowCount) {
    const current = await dbClient.execute({
      sql: "SELECT state,orchestration_content_id FROM tokenless_public_network_review_bindings WHERE binding_id=?",
      args: [input.bindingId],
    });
    const row = current.rows[0] as Row | undefined;
    if (
      !row ||
      text(row, "orchestration_content_id") !== bridge.orchestrationContentId ||
      !["foundation_ready", "ask_bound", "round_bound", "audience_ready"].includes(text(row, "state") ?? "")
    ) {
      throw new TokenlessServiceError(
        "The public network foundation changed while it was freezing.",
        409,
        "public_network_foundation_conflict",
      );
    }
  }
  return bridge.orchestrationContentId;
}

export async function ensurePublicNetworkReviewFoundation(
  input: PublicNetworkFoundationInput,
): Promise<PublicNetworkFoundation> {
  const intent = buildTokenlessQuoteIntent(
    input.preparedProductAsk.quoteRequest as unknown as TokenlessQuoteRequest,
    input.preparedProductAsk.quote,
  );
  const productContentId = intent.contentId.toLowerCase() as Bytes32;
  const admissionPolicy = intent.normalizedRequest.audiencePolicy;
  if (
    !admissionPolicy ||
    intent.normalizedRequest.audience.source !== "rateloop_network" ||
    admissionPolicy.reviewerSource !== "rateloop_network" ||
    admissionPolicy.compensation !== "paid"
  ) {
    throw new TokenlessServiceError(
      "Public network assurance requires an exact paid RateLoop-network policy.",
      409,
      "public_network_audience_policy_unreachable",
    );
  }
  reviewerTarget(admissionPolicy, input.requestProfile.panelSize);
  const policyHash = stableHash(admissionPolicy);
  const admissionPolicyHash = `0x${policyHash.slice("sha256:".length)}` as Bytes32;
  if (
    intent.normalizedRequest.audience.admissionPolicyHash.toLowerCase() !== admissionPolicyHash ||
    input.preparedProductAsk.questionId !== deterministicId("qst", `${input.workspaceId}:${input.idempotencyKey}`)
  ) {
    throw new Error("Prepared public product identity drifted.");
  }
  const policyResult = await dbClient.execute({
    sql: `SELECT ap.project_id,ap.policy_id,ap.version,ap.policy_hash,ap.policy_json
          FROM tokenless_assurance_audience_policies ap
          JOIN tokenless_assurance_projects p ON p.project_id=ap.project_id
          WHERE p.workspace_id=? AND p.status='active'
            AND p.visibility='public' AND p.material_kind=? AND p.data_classification='public'
            AND ap.policy_id=? AND ap.version=? AND ap.policy_hash=?
          ORDER BY ap.created_at ASC LIMIT 2`,
    args: [
      input.workspaceId,
      input.publication.dataClassification,
      admissionPolicy.policyId,
      admissionPolicy.version,
      policyHash,
    ],
  });
  if (policyResult.rows.length !== 1) {
    throw new TokenlessServiceError(
      "The frozen admission policy must resolve to one workspace-owned public assurance project.",
      409,
      "public_network_project_binding_mismatch",
    );
  }
  const policyRow = policyResult.rows[0] as Row;
  if (text(policyRow, "policy_json") !== canonicalizeHumanAssuranceDocument(admissionPolicy)) {
    throw new TokenlessServiceError(
      "The frozen admission policy content changed.",
      409,
      "public_network_project_binding_mismatch",
    );
  }
  const projectId = text(policyRow, "project_id")!;
  const exactBindingHash = stableHash(foundationIdentity(input, productContentId, policyHash));
  const identity = `${input.workspaceId}:${input.opportunityId}:${exactBindingHash}`;
  const bindingId = deterministicId("pnrb", identity);
  const suiteId = deterministicId("has", `${identity}:suite`);
  const rubricId = deterministicId("har", `${identity}:rubric`);
  const caseId = deterministicId("hac", `${identity}:case`);
  const runId = deterministicId("hau", `${identity}:run`);
  const sourceArtifactId = deterministicId("art", `${identity}:source`);
  const candidateArtifactId = deterministicId("art", `${identity}:candidate`);
  const confidentialityTermsHash = stableHash({
    schemaVersion: "rateloop.public-network-confidentiality-terms.v1",
    bindingId,
    publication: input.publication,
    productContentId,
    audiencePolicyHash: policyHash,
  });
  const expected = {
    bindingId,
    workspaceId: input.workspaceId,
    opportunityId: input.opportunityId,
    integrationId: input.integrationId,
    idempotencyKey: input.idempotencyKey,
    requestProfile: input.requestProfile,
    preparation: input.preparation,
    sourceEvidenceHash: input.sourceEvidenceHash,
    suggestionCommitment: input.suggestionCommitment,
    exactBindingHash,
    projectId,
    audiencePolicyId: admissionPolicy.policyId,
    audiencePolicyVersion: admissionPolicy.version,
    audiencePolicyHash: policyHash,
    suiteId,
    caseId,
    runId,
    productQuestionId: input.preparedProductAsk.questionId,
    productContentId,
    admissionPolicyHash,
    confidentialityTermsHash,
  };
  const existing = await dbClient.execute({
    sql: `SELECT * FROM tokenless_public_network_review_bindings
          WHERE binding_id=? OR (workspace_id=? AND opportunity_id=?)
             OR (workspace_id=? AND idempotency_key=?)
          LIMIT 4`,
    args: [bindingId, input.workspaceId, input.opportunityId, input.workspaceId, input.idempotencyKey],
  });
  if (existing.rows.length > 1 || (existing.rows[0] && !exactStoredFoundation(existing.rows[0] as Row, expected))) {
    throw new TokenlessServiceError(
      "The public-review idempotency identity conflicts with stored assurance resources.",
      409,
      "public_network_foundation_conflict",
    );
  }
  if (text(existing.rows[0] as Row | undefined, "state") === "abandoned") {
    throw new TokenlessServiceError(
      "The unbound public-review foundation expired. Create a fresh opportunity.",
      410,
      "public_network_foundation_expired",
    );
  }
  const managerClient = await dbPool.connect();
  let manager: WorkspaceManager;
  try {
    manager = await loadWorkspaceManager(managerClient, input.workspaceId, projectId);
  } finally {
    managerClient.release();
  }
  let orchestrationContentId = text(existing.rows[0] as Row | undefined, "orchestration_content_id") as Bytes32 | null;
  if (!orchestrationContentId) {
    orchestrationContentId = await seedFoundationResources({
      source: input,
      bindingId,
      projectId,
      policyId: admissionPolicy.policyId,
      policyVersion: admissionPolicy.version,
      policyHash,
      policy: admissionPolicy,
      suiteId,
      rubricId,
      caseId,
      runId,
      sourceArtifactId,
      candidateArtifactId,
      productContentId,
      exactBindingHash,
      confidentialityTermsHash,
      manager,
    });
  }
  return {
    bindingId,
    projectId,
    suiteId,
    suiteVersion: 1,
    caseId,
    runId,
    productContentId,
    orchestrationContentId,
    confidentialityTermsHash,
  };
}

export async function bindPublicNetworkReviewOperation(
  client: Pick<PoolClient, "query">,
  input: {
    bindingId: string;
    workspaceId: string;
    opportunityId: string;
    operationKey: string;
    now: Date;
  },
) {
  const exact = await client.query(
    `SELECT binding.state,binding.operation_key,binding.product_question_id,binding.product_content_id,
            ownership.workspace_id AS operation_workspace_id,
            ownership.question_id AS operation_question_id,
            content.content_hash AS operation_content_hash,
            question.visibility AS question_visibility,
            question.data_classification AS question_data_classification,
            question.moderation_status AS question_moderation_status,
            question.confirmed_no_sensitive_data,
            content.moderation_status AS content_moderation_status
     FROM tokenless_public_network_review_bindings binding
     JOIN tokenless_agent_asks ask ON ask.operation_key=$1
     JOIN tokenless_ask_ownership ownership ON ownership.operation_key=ask.operation_key
     JOIN tokenless_question_records question ON question.question_id=ownership.question_id
     JOIN tokenless_content_records content ON content.content_id=question.content_id
     WHERE binding.binding_id=$2 AND binding.workspace_id=$3 AND binding.opportunity_id=$4
     LIMIT 1 FOR UPDATE`,
    [input.operationKey, input.bindingId, input.workspaceId, input.opportunityId],
  );
  const exactRow = exact.rows[0] as Row | undefined;
  const operationContentHash = text(exactRow, "operation_content_hash");
  if (
    !exactRow ||
    text(exactRow, "operation_workspace_id") !== input.workspaceId ||
    text(exactRow, "operation_question_id") !== text(exactRow, "product_question_id") ||
    !operationContentHash ||
    `0x${operationContentHash.toLowerCase()}` !== text(exactRow, "product_content_id") ||
    text(exactRow, "question_visibility") !== "public" ||
    !["public", "synthetic", "redacted"].includes(text(exactRow, "question_data_classification") ?? "") ||
    !["pending", "approved"].includes(text(exactRow, "question_moderation_status") ?? "") ||
    exactRow.confirmed_no_sensitive_data !== true ||
    !["pending", "approved"].includes(text(exactRow, "content_moderation_status") ?? "") ||
    !["foundation_ready", "ask_bound", "round_bound", "audience_ready"].includes(text(exactRow, "state") ?? "") ||
    (text(exactRow, "operation_key") !== null && text(exactRow, "operation_key") !== input.operationKey)
  ) {
    throw new TokenlessServiceError(
      "The ask operation does not match the exact workspace-owned public-review content.",
      409,
      "public_network_operation_binding_conflict",
    );
  }
  const result = await client.query(
    `UPDATE tokenless_public_network_review_bindings
     SET operation_key=$1,state='ask_bound',ask_bound_at=$2,worker_next_attempt_at=$2,updated_at=$2
     WHERE binding_id=$3 AND workspace_id=$4 AND opportunity_id=$5
       AND state='foundation_ready' AND operation_key IS NULL
     RETURNING project_id,run_id,case_id`,
    [input.operationKey, input.now, input.bindingId, input.workspaceId, input.opportunityId],
  );
  if (result.rowCount === 1) return result.rows[0] as Row;
  const replay = await client.query(
    `SELECT project_id,run_id,case_id,state,operation_key
     FROM tokenless_public_network_review_bindings
     WHERE binding_id=$1 AND workspace_id=$2 AND opportunity_id=$3 LIMIT 1`,
    [input.bindingId, input.workspaceId, input.opportunityId],
  );
  const row = replay.rows[0] as Row | undefined;
  if (
    !row ||
    text(row, "operation_key") !== input.operationKey ||
    !["ask_bound", "round_bound", "audience_ready"].includes(text(row, "state") ?? "")
  ) {
    throw new TokenlessServiceError(
      "The ask operation conflicts with its assurance foundation.",
      409,
      "public_network_operation_binding_conflict",
    );
  }
  return row;
}

export async function abandonStalePublicNetworkFoundation(bindingId: string, now = new Date(), signal?: AbortSignal) {
  throwIfMaintenanceCancelled(signal);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    throwIfMaintenanceCancelled(signal);
    const result = await client.query(
      `SELECT b.state,b.operation_key,b.run_id,o.operation_key AS opportunity_operation
       FROM tokenless_public_network_review_bindings b
       JOIN tokenless_agent_review_opportunities o
         ON o.workspace_id=b.workspace_id AND o.opportunity_id=b.opportunity_id
       WHERE b.binding_id=$1 AND b.created_at <= $2 LIMIT 1 FOR UPDATE`,
      [bindingId, new Date(now.getTime() - PUBLIC_NETWORK_FOUNDATION_ORPHAN_TTL_MS)],
    );
    throwIfMaintenanceCancelled(signal);
    const row = result.rows[0] as Row | undefined;
    if (
      !row ||
      !["foundation_preparing", "foundation_ready"].includes(text(row, "state") ?? "") ||
      text(row, "operation_key") ||
      text(row, "opportunity_operation")
    ) {
      await client.query("COMMIT");
      return false;
    }
    await client.query(
      `UPDATE tokenless_assurance_runs
       SET status='cancelled',updated_at=$1
       WHERE run_id=$2 AND status IN ('draft','frozen')
         AND NOT EXISTS (
           SELECT 1 FROM tokenless_assurance_assignments a WHERE a.run_id=$2
         )`,
      [now, text(row, "run_id")],
    );
    throwIfMaintenanceCancelled(signal);
    const abandoned = await client.query(
      `UPDATE tokenless_public_network_review_bindings
       SET state='abandoned',abandoned_at=$1,updated_at=$1
       WHERE binding_id=$2 AND state IN ('foundation_preparing','foundation_ready')
         AND operation_key IS NULL RETURNING binding_id`,
      [now, bindingId],
    );
    await client.query("COMMIT");
    return abandoned.rowCount === 1;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function releasePublicNetworkReviewBinding(input: {
  bindingId: string;
  operationKey: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  let onchain = false;
  try {
    await client.query("BEGIN");
    const bindingResult = await client.query(
      `SELECT binding.state,binding.run_id,binding.chain_id,binding.panel_address,binding.round_id,
              execution.state AS execution_state,execution.submission_transaction_hash,
              execution.payment_mode,execution.payment_reference
       FROM tokenless_public_network_review_bindings binding
       LEFT JOIN tokenless_chain_executions execution
         ON execution.operation_key=binding.operation_key
       WHERE binding.binding_id=$1 AND binding.operation_key=$2
       LIMIT 1 FOR UPDATE OF binding,execution`,
      [input.bindingId, input.operationKey],
    );
    const binding = bindingResult.rows[0] as Row | undefined;
    if (!binding) {
      throw new TokenlessServiceError("Public network child was not found.", 404, "public_network_child_not_found");
    }
    const assignments = await client.query(
      `SELECT assignment_id,status FROM tokenless_assurance_assignments
       WHERE run_id=$1 AND source='rateloop_network'
       ORDER BY assignment_id ASC FOR UPDATE`,
      [text(binding, "run_id")],
    );
    const settlements = await client.query(
      `SELECT binding_id,state FROM tokenless_network_assignment_settlements
       WHERE run_id=$1 ORDER BY binding_id ASC FOR UPDATE`,
      [text(binding, "run_id")],
    );
    if (
      assignments.rows.some(row => ["accepted", "completed"].includes(text(row as Row, "status") ?? "")) ||
      settlements.rows.some(row => ["voucher_issued", "committed"].includes(text(row as Row, "state") ?? ""))
    ) {
      throw new TokenlessServiceError(
        "A public network child with accepted or committed liability cannot be released.",
        409,
        "public_network_child_liability_active",
      );
    }
    const executionState = text(binding, "execution_state");
    if (binding.submission_transaction_hash && executionState !== "confirmed") {
      throw new TokenlessServiceError(
        "The public network child has an unconfirmed funding transaction.",
        409,
        "public_network_child_release_pending",
        true,
      );
    }
    onchain = executionState === "confirmed";
    if (onchain) {
      await client.query(
        `UPDATE tokenless_voucher_rounds SET status='takedown',updated_at=$1
         WHERE chain_id=$2 AND lower(panel_address)=lower($3) AND round_id=$4
           AND status IN ('open','takedown')`,
        [now, binding.chain_id, text(binding, "panel_address"), text(binding, "round_id")],
      );
      await client.query(
        `UPDATE tokenless_assurance_assignments
         SET reservation_expires_at=LEAST(reservation_expires_at,$1),updated_at=$1
         WHERE run_id=$2 AND source='rateloop_network' AND status='reserved'`,
        [now, text(binding, "run_id")],
      );
    } else {
      await client.query(
        `UPDATE tokenless_chain_executions
         SET state='failed',failure_code='hybrid_parent_cancelled',updated_at=$1
         WHERE operation_key=$2 AND submission_transaction_hash IS NULL AND state<>'confirmed'`,
        [now, input.operationKey],
      );
      if (text(binding, "payment_mode") === "prepaid") {
        await client.query(
          `UPDATE tokenless_prepaid_reservations SET status='released',updated_at=$1
           WHERE reservation_id=$2 AND status='reserved'`,
          [now, text(binding, "payment_reference")],
        );
      } else if (text(binding, "payment_mode")) {
        await client.query(
          `UPDATE tokenless_payment_intents SET state='failed',updated_at=$1
           WHERE payment_intent_id=$2 AND state NOT IN ('confirmed','settled')`,
          [now, text(binding, "payment_reference")],
        );
      }
      await client.query(
        `UPDATE tokenless_ask_ownership SET payment_state='released',updated_at=$1
         WHERE operation_key=$2`,
        [now, input.operationKey],
      );
      await client.query(
        `UPDATE tokenless_agent_asks SET status='rejected',updated_at=$1
         WHERE operation_key=$2 AND status NOT IN ('settled','rejected')`,
        [now, input.operationKey],
      );
      await client.query(
        `UPDATE tokenless_public_network_review_bindings
         SET state='abandoned',abandoned_at=$1,updated_at=$1
         WHERE binding_id=$2 AND state IN ('foundation_preparing','foundation_ready','ask_bound','round_bound')`,
        [now, input.bindingId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (onchain) {
    await expireAudienceAssignments(new Date(now.getTime() + 1));
    await reconcileNetworkAssignmentSettlements({ now: new Date(now.getTime() + 1), limit: 100 });
  }
  const remaining = await dbClient.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM tokenless_assurance_assignments
             WHERE run_id=binding.run_id AND status IN ('reserved','accepted')) AS live_assignments,
            (SELECT COUNT(*) FROM tokenless_network_assignment_settlements
             WHERE run_id=binding.run_id AND state IN ('selected','voucher_issued','committed')) AS live_settlements
          FROM tokenless_public_network_review_bindings binding WHERE binding.binding_id=?`,
    args: [input.bindingId],
  });
  const row = remaining.rows[0] as Row | undefined;
  if (row && (integer(row, "live_assignments") !== 0 || integer(row, "live_settlements") !== 0)) {
    throw new TokenlessServiceError(
      "Public network child release is waiting for settlement reconciliation.",
      409,
      "public_network_child_release_pending",
      true,
    );
  }
  return {
    bindingId: input.bindingId,
    released: true as const,
    disposition: onchain ? ("protocol_refund_pending" as const) : ("funding_released" as const),
  };
}

function retryAt(now: Date, attempt: number) {
  return new Date(now.getTime() + Math.min(30_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 7), 3_600_000));
}

function workerErrorCode(error: unknown) {
  if (error instanceof TokenlessServiceError && /^[a-z][a-z0-9_]{0,79}$/u.test(error.code)) return error.code;
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,79}$/u.test(error.name)) return error.name;
  return "public_network_audience_worker_failed";
}

async function recordPublicNetworkWorkerFailure(bindingId: string, error: unknown, now: Date) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT state,worker_attempt_count FROM tokenless_public_network_review_bindings
       WHERE binding_id=$1 LIMIT 1 FOR UPDATE`,
      [bindingId],
    );
    const row = current.rows[0] as Row | undefined;
    if (!row || !["ask_bound", "round_bound"].includes(text(row, "state") ?? "")) {
      await client.query("COMMIT");
      return;
    }
    const attempt = Math.min(integer(row, "worker_attempt_count") + 1, MAX_WORKER_ATTEMPTS);
    const dead = attempt >= MAX_WORKER_ATTEMPTS;
    await client.query(
      `UPDATE tokenless_public_network_review_bindings
       SET state=CASE WHEN $1 THEN 'dead' ELSE state END,
           worker_attempt_count=$2,worker_next_attempt_at=$3,worker_last_error_code=$4,
           worker_dead_at=$5,updated_at=$6
       WHERE binding_id=$7 AND state IN ('ask_bound','round_bound')`,
      [dead, attempt, dead ? null : retryAt(now, attempt), workerErrorCode(error), dead ? now : null, now, bindingId],
    );
    await client.query("COMMIT");
  } catch (failureError) {
    await client.query("ROLLBACK");
    throw failureError;
  } finally {
    client.release();
  }
}

type ConfirmedNetworkRound = {
  bindingId: string;
  workspaceId: string;
  opportunityId: string;
  projectId: string;
  runId: string;
  caseId: string;
  confidentialityTermsHash: Hash;
  operationKey: string;
  deploymentKey: string;
  chainId: number;
  panelAddress: string;
  roundId: string;
  productContentId: Bytes32;
  admissionPolicyHash: Bytes32;
  roundTermsHash: Hash;
  totalFundedAtomic: string;
  maximumCommits: number;
};

async function loadConfirmedNetworkRound(bindingId: string, now: Date): Promise<ConfirmedNetworkRound> {
  const result = await dbClient.execute({
    sql: `SELECT b.*,o.status AS opportunity_status,o.run_id AS opportunity_run_id,
                 lifecycle.state AS opportunity_lifecycle_state,
                 run.status AS run_status,run.policy_hash AS run_policy_hash,
                 rc.content_id AS case_content_id,rc.admission_policy_hash AS case_admission_policy_hash,
                 execution.operation_key AS execution_operation_key,
                 execution.deployment_key AS execution_deployment_key,
                 execution.chain_id AS execution_chain_id,
                 execution.panel_address AS execution_panel_address,
                 execution.round_id AS execution_round_id,
                 execution.content_id AS execution_content_id,
                 execution.round_terms_json,execution.total_funded_atomic,
                 execution.state AS execution_state,execution.confirmed_at,
                 ownership.workspace_id AS operation_workspace_id,
                 ownership.question_id AS operation_question_id,
                 question.terms_json AS product_terms_json,
                 voucher.content_id AS voucher_content_id,
                 voucher.admission_policy_hash AS voucher_admission_policy_hash,
                 voucher.maximum_commits,voucher.voucher_deadline,
                 voucher.status AS voucher_status,
                 profile.panel_size
          FROM tokenless_public_network_review_bindings b
          JOIN tokenless_agent_review_opportunities o
            ON o.workspace_id=b.workspace_id AND o.opportunity_id=b.opportunity_id
          JOIN tokenless_agent_review_opportunity_lifecycles lifecycle
            ON lifecycle.workspace_id=b.workspace_id AND lifecycle.opportunity_id=b.opportunity_id
          JOIN tokenless_agent_review_request_profiles profile
            ON profile.workspace_id=b.workspace_id
           AND profile.profile_id=b.request_profile_id
           AND profile.version=b.request_profile_version
           AND profile.profile_hash=b.request_profile_hash
          JOIN tokenless_assurance_runs run
            ON run.project_id=b.project_id AND run.run_id=b.run_id
          JOIN tokenless_assurance_run_cases rc
            ON rc.run_id=b.run_id AND rc.case_id=b.case_id
          JOIN tokenless_chain_executions execution ON execution.operation_key=b.operation_key
          JOIN tokenless_ask_ownership ownership ON ownership.operation_key=b.operation_key
          JOIN tokenless_question_records question ON question.question_id=ownership.question_id
          JOIN tokenless_voucher_rounds voucher
            ON voucher.chain_id=execution.chain_id
           AND lower(voucher.panel_address)=lower(execution.panel_address)
           AND voucher.round_id=execution.round_id
          WHERE b.binding_id=? AND b.state IN ('ask_bound','round_bound')
          LIMIT 1`,
    args: [bindingId],
  });
  const row = result.rows[0] as Row | undefined;
  if (!row) {
    throw new TokenlessServiceError(
      "The public network review binding is not ready for projection.",
      409,
      "public_network_round_projection_pending",
      true,
    );
  }
  const roundTerms = JSON.parse(text(row, "round_terms_json") ?? "null") as Record<string, unknown> | null;
  const productTerms = JSON.parse(text(row, "product_terms_json") ?? "null") as Record<string, unknown> | null;
  if (!roundTerms || !productTerms) throw new Error("Stored public network round terms are invalid.");
  const policy = freezeAdmissionPolicy(productTerms.audiencePolicy);
  const bounty = BigInt(String(roundTerms.bountyAmount ?? "-1"));
  const fee = BigInt(String(roundTerms.feeAmount ?? "-1"));
  const reserve = BigInt(String(roundTerms.attemptReserve ?? "-1"));
  const totalFundedAtomic = text(row, "total_funded_atomic") ?? "-1";
  const maximumCommits = integer(row, "maximum_commits");
  const panelSize = integer(row, "panel_size");
  const productEconomics = productTerms.economics as
    | {
        bounty?: { fundedAtomic?: unknown };
        fee?: { fundedAtomic?: unknown };
        attemptReserve?: { fundedAtomic?: unknown };
        totalFundedAtomic?: unknown;
      }
    | undefined;
  const productPanel = productTerms.panel as { requestedSize?: unknown } | undefined;
  const roundId = text(row, "execution_round_id");
  const chainId = integer(row, "execution_chain_id");
  const panelAddress = text(row, "execution_panel_address")?.toLowerCase() ?? "";
  if (
    text(row, "opportunity_status") !== "review_requested" ||
    text(row, "opportunity_lifecycle_state") !== "pending" ||
    text(row, "opportunity_run_id") !== text(row, "run_id") ||
    text(row, "run_status") !== "frozen" ||
    text(row, "run_policy_hash") !== text(row, "audience_policy_hash") ||
    text(row, "execution_state") !== "confirmed" ||
    !row.confirmed_at ||
    text(row, "execution_operation_key") !== text(row, "operation_key") ||
    text(row, "operation_workspace_id") !== text(row, "workspace_id") ||
    text(row, "operation_question_id") !== text(row, "product_question_id") ||
    text(row, "case_content_id")?.toLowerCase() !== text(row, "product_content_id") ||
    text(row, "execution_content_id")?.toLowerCase() !== text(row, "product_content_id") ||
    text(row, "voucher_content_id")?.toLowerCase() !== text(row, "product_content_id") ||
    text(row, "case_admission_policy_hash")?.toLowerCase() !== text(row, "admission_policy_hash") ||
    text(row, "voucher_admission_policy_hash")?.toLowerCase() !== text(row, "admission_policy_hash") ||
    policy.policyHash !== text(row, "audience_policy_hash") ||
    policy.admissionPolicyHash.toLowerCase() !== text(row, "admission_policy_hash") ||
    policy.policy.reviewerSource !== "rateloop_network" ||
    policy.policy.compensation !== "paid" ||
    !roundId ||
    chainId <= 0 ||
    !/^0x[0-9a-f]{40}$/u.test(panelAddress) ||
    text(row, "voucher_status") !== "open" ||
    new Date(String(row.voucher_deadline)) <= now ||
    maximumCommits !== panelSize ||
    Number(roundTerms.maximumCommits) !== panelSize ||
    String(productEconomics?.bounty?.fundedAtomic ?? "") !== bounty.toString() ||
    String(productEconomics?.fee?.fundedAtomic ?? "") !== fee.toString() ||
    String(productEconomics?.attemptReserve?.fundedAtomic ?? "") !== reserve.toString() ||
    String(productEconomics?.totalFundedAtomic ?? "") !== totalFundedAtomic ||
    Number(productPanel?.requestedSize) !== panelSize ||
    BigInt(totalFundedAtomic) !== bounty + fee + reserve
  ) {
    throw new TokenlessServiceError(
      "The confirmed round no longer matches the live opportunity, run, policy, or funded economics.",
      409,
      "public_network_round_binding_mismatch",
    );
  }
  return {
    bindingId,
    workspaceId: text(row, "workspace_id")!,
    opportunityId: text(row, "opportunity_id")!,
    projectId: text(row, "project_id")!,
    runId: text(row, "run_id")!,
    caseId: text(row, "case_id")!,
    confidentialityTermsHash: text(row, "confidentiality_terms_hash") as Hash,
    operationKey: text(row, "operation_key")!,
    deploymentKey: text(row, "execution_deployment_key")!,
    chainId,
    panelAddress,
    roundId,
    productContentId: text(row, "product_content_id") as Bytes32,
    admissionPolicyHash: text(row, "admission_policy_hash") as Bytes32,
    roundTermsHash: stableHash(roundTerms),
    totalFundedAtomic,
    maximumCommits,
  };
}

async function persistExactConfirmedRound(round: ConfirmedNetworkRound, now: Date) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE tokenless_public_network_review_bindings
       SET deployment_key=$1,chain_id=$2,panel_address=$3,round_id=$4,
           round_terms_hash=$5,total_funded_atomic=$6,maximum_commits=$7,
           state='round_bound',round_bound_at=$8,worker_next_attempt_at=$8,updated_at=$8
       WHERE binding_id=$9 AND state='ask_bound' AND operation_key=$10
       RETURNING binding_id`,
      [
        round.deploymentKey,
        round.chainId,
        round.panelAddress,
        round.roundId,
        round.roundTermsHash,
        round.totalFundedAtomic,
        round.maximumCommits,
        now,
        round.bindingId,
        round.operationKey,
      ],
    );
    if (result.rowCount !== 1) {
      const replay = await client.query(
        `SELECT state,deployment_key,chain_id,panel_address,round_id,round_terms_hash,
                total_funded_atomic,maximum_commits
         FROM tokenless_public_network_review_bindings
         WHERE binding_id=$1 LIMIT 1 FOR UPDATE`,
        [round.bindingId],
      );
      const row = replay.rows[0] as Row | undefined;
      if (
        !row ||
        !["round_bound", "audience_ready"].includes(text(row, "state") ?? "") ||
        text(row, "deployment_key") !== round.deploymentKey ||
        integer(row, "chain_id") !== round.chainId ||
        text(row, "panel_address")?.toLowerCase() !== round.panelAddress ||
        text(row, "round_id") !== round.roundId ||
        text(row, "round_terms_hash") !== round.roundTermsHash ||
        text(row, "total_funded_atomic") !== round.totalFundedAtomic ||
        integer(row, "maximum_commits") !== round.maximumCommits
      ) {
        throw new TokenlessServiceError(
          "The confirmed public network round conflicts with its durable binding.",
          409,
          "public_network_round_binding_conflict",
        );
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

async function verifyReservedAudience(round: ConfirmedNetworkRound, now: Date) {
  const result = await dbClient.execute({
    sql: `SELECT sp.selection_status,sp.target_count,sp.selected_count,
                 COUNT(DISTINCT assignment.assignment_id) AS assignment_count,
                 COUNT(settlement.binding_id) AS settlement_count
          FROM tokenless_assurance_run_subpanels sp
          LEFT JOIN tokenless_assurance_assignments assignment
            ON assignment.run_id=sp.run_id AND assignment.subpanel_id=sp.subpanel_id
           AND assignment.source='rateloop_network'
           AND (
             (assignment.status='reserved' AND assignment.reservation_expires_at > ?)
             OR (assignment.status='accepted' AND assignment.assignment_expires_at > ?)
           )
          LEFT JOIN tokenless_network_assignment_settlements settlement
            ON settlement.assignment_id=assignment.assignment_id
           AND settlement.run_id=assignment.run_id
           AND settlement.subpanel_id=assignment.subpanel_id
           AND settlement.case_id=?
           AND settlement.operation_key=?
           AND settlement.deployment_key=?
           AND settlement.chain_id=?
           AND lower(settlement.panel_address)=lower(?)
           AND settlement.round_id=?
          WHERE sp.run_id=? AND sp.project_id=? AND sp.source='rateloop_network'
          GROUP BY sp.selection_status,sp.target_count,sp.selected_count`,
    args: [
      now,
      now,
      round.caseId,
      round.operationKey,
      round.deploymentKey,
      round.chainId,
      round.panelAddress,
      round.roundId,
      round.runId,
      round.projectId,
    ],
  });
  const row = result.rows[0] as Row | undefined;
  if (
    result.rows.length !== 1 ||
    text(row, "selection_status") !== "reserved" ||
    integer(row, "target_count") !== round.maximumCommits ||
    integer(row, "selected_count") !== round.maximumCommits ||
    integer(row, "assignment_count") !== round.maximumCommits ||
    integer(row, "settlement_count") !== round.maximumCommits
  ) {
    throw new TokenlessServiceError(
      "The selected network audience is incomplete.",
      409,
      "public_network_audience_projection_incomplete",
      true,
    );
  }
}

async function loadCompletedAudienceRound(bindingId: string): Promise<ConfirmedNetworkRound | null> {
  const result = await dbClient.execute({
    sql: `SELECT binding_id,workspace_id,opportunity_id,project_id,run_id,case_id,
                 confidentiality_terms_hash,operation_key,deployment_key,chain_id,panel_address,
                 round_id,product_content_id,admission_policy_hash,round_terms_hash,
                 total_funded_atomic,maximum_commits
          FROM tokenless_public_network_review_bindings
          WHERE binding_id=? AND state='audience_ready' LIMIT 1`,
    args: [bindingId],
  });
  const row = result.rows[0] as Row | undefined;
  if (!row) return null;
  return {
    bindingId,
    workspaceId: text(row, "workspace_id")!,
    opportunityId: text(row, "opportunity_id")!,
    projectId: text(row, "project_id")!,
    runId: text(row, "run_id")!,
    caseId: text(row, "case_id")!,
    confidentialityTermsHash: text(row, "confidentiality_terms_hash") as Hash,
    operationKey: text(row, "operation_key")!,
    deploymentKey: text(row, "deployment_key")!,
    chainId: integer(row, "chain_id"),
    panelAddress: text(row, "panel_address")!,
    roundId: text(row, "round_id")!,
    productContentId: text(row, "product_content_id") as Bytes32,
    admissionPolicyHash: text(row, "admission_policy_hash") as Bytes32,
    roundTermsHash: text(row, "round_terms_hash") as Hash,
    totalFundedAtomic: text(row, "total_funded_atomic")!,
    maximumCommits: integer(row, "maximum_commits"),
  };
}

async function verifyCompletedAudience(round: ConfirmedNetworkRound) {
  const result = await dbClient.execute({
    sql: `SELECT COUNT(DISTINCT assignment.assignment_id) AS assignment_count,
                 COUNT(settlement.binding_id) AS settlement_count
          FROM tokenless_assurance_assignments assignment
          JOIN tokenless_network_assignment_settlements settlement
            ON settlement.assignment_id=assignment.assignment_id
           AND settlement.run_id=assignment.run_id
           AND settlement.subpanel_id=assignment.subpanel_id
          WHERE assignment.run_id=? AND assignment.project_id=? AND assignment.source='rateloop_network'
            AND settlement.case_id=? AND settlement.operation_key=? AND settlement.deployment_key=?
            AND settlement.chain_id=? AND lower(settlement.panel_address)=lower(?)
            AND settlement.round_id=? AND lower(settlement.content_id)=lower(?)
            AND lower(settlement.admission_policy_hash)=lower(?)
            AND settlement.round_terms_hash=? AND settlement.total_funded_atomic=?
            AND settlement.maximum_commits=?`,
    args: [
      round.runId,
      round.projectId,
      round.caseId,
      round.operationKey,
      round.deploymentKey,
      round.chainId,
      round.panelAddress,
      round.roundId,
      round.productContentId,
      round.admissionPolicyHash,
      round.roundTermsHash,
      round.totalFundedAtomic,
      round.maximumCommits,
    ],
  });
  const row = result.rows[0] as Row | undefined;
  if (
    integer(row, "assignment_count") !== round.maximumCommits ||
    integer(row, "settlement_count") !== round.maximumCommits
  ) {
    throw new TokenlessServiceError(
      "The completed network audience no longer matches its durable settlement bindings.",
      409,
      "public_network_audience_projection_conflict",
    );
  }
}

export async function readReadyPublicNetworkReviewChild(bindingId: string): Promise<ReadyPublicNetworkReviewChild> {
  const round = await loadCompletedAudienceRound(bindingId);
  if (!round) {
    throw new TokenlessServiceError(
      "The public network child has not reached audience readiness.",
      409,
      "public_network_audience_projection_pending",
      true,
    );
  }
  await verifyCompletedAudience(round);
  const result = await dbClient.execute({
    sql: `SELECT assignment.assignment_id,profile.principal_id,profile.payout_account,
                 assignment.voucher_marker,assignment.selection_batch_id,
                 settlement.binding_id,settlement.selection_binding_hash,
                 settlement.integrity_provenance_hash,settlement.state
          FROM tokenless_assurance_assignments assignment
          JOIN tokenless_rater_profiles profile ON profile.rater_id=assignment.rater_id
          JOIN tokenless_network_assignment_settlements settlement
            ON settlement.assignment_id=assignment.assignment_id
           AND settlement.run_id=assignment.run_id
           AND settlement.subpanel_id=assignment.subpanel_id
          WHERE assignment.run_id=? AND assignment.project_id=? AND assignment.source='rateloop_network'
            AND settlement.case_id=? AND settlement.operation_key=? AND settlement.deployment_key=?
            AND settlement.chain_id=? AND lower(settlement.panel_address)=lower(?)
            AND settlement.round_id=? AND lower(settlement.content_id)=lower(?)
            AND lower(settlement.admission_policy_hash)=lower(?)
            AND settlement.round_terms_hash=? AND settlement.total_funded_atomic=?
            AND settlement.maximum_commits=?
          ORDER BY assignment.assignment_id ASC`,
    args: [
      round.runId,
      round.projectId,
      round.caseId,
      round.operationKey,
      round.deploymentKey,
      round.chainId,
      round.panelAddress,
      round.roundId,
      round.productContentId,
      round.admissionPolicyHash,
      round.roundTermsHash,
      round.totalFundedAtomic,
      round.maximumCommits,
    ],
  });
  const assignments = result.rows.map(value => {
    const row = value as Row;
    const assignmentId = text(row, "assignment_id");
    const principalId = text(row, "principal_id");
    const payoutAccount = text(row, "payout_account")?.toLowerCase();
    const selectionBindingHash = text(row, "selection_binding_hash");
    const voucherMarker = text(row, "voucher_marker");
    if (
      !assignmentId ||
      !principalId ||
      !payoutAccount ||
      !/^0x[0-9a-f]{40}$/u.test(payoutAccount) ||
      !selectionBindingHash ||
      !HASH.test(selectionBindingHash) ||
      !voucherMarker ||
      !/^selection:hasb_[A-Za-z0-9_-]+:[0-9a-f]{64}$/u.test(voucherMarker) ||
      !voucherMarker.startsWith(`selection:${text(row, "selection_batch_id")}:`)
    ) {
      throw new Error("Stored public network assignment evidence is invalid.");
    }
    return {
      assignmentId,
      principalId,
      payoutAccount,
      selectionBindingHash: selectionBindingHash as Hash,
      voucherMarker: voucherMarker as Hash,
    };
  });
  if (assignments.length !== round.maximumCommits) {
    throw new TokenlessServiceError(
      "The public network child assignment snapshot is incomplete.",
      409,
      "public_network_audience_projection_conflict",
    );
  }
  for (const assignment of assignments) {
    const bindingHashes = result.rows
      .filter(value => text(value as Row, "assignment_id") === assignment.assignmentId)
      .map(value => text(value as Row, "selection_binding_hash")!)
      .sort();
    const expectedMarker = `selection:${text(
      result.rows.find(value => text(value as Row, "assignment_id") === assignment.assignmentId) as Row,
      "selection_batch_id",
    )}:${stableHash({ assignmentId: assignment.assignmentId, bindings: bindingHashes }).slice("sha256:".length)}`;
    if (assignment.voucherMarker !== expectedMarker) {
      throw new Error("Stored public network selection marker is inconsistent.");
    }
  }
  const evidenceRows = result.rows.map(value => {
    const row = value as Row;
    return {
      assignmentId: text(row, "assignment_id"),
      bindingId: text(row, "binding_id"),
      selectionBindingHash: text(row, "selection_binding_hash"),
      integrityProvenanceHash: text(row, "integrity_provenance_hash"),
      state: text(row, "state"),
    };
  });
  return {
    operationKey: round.operationKey,
    runId: round.runId,
    childReference: bindingId,
    round: {
      deploymentKey: round.deploymentKey,
      chainId: round.chainId,
      panelAddress: round.panelAddress,
      roundId: round.roundId,
      admissionPolicyHash: round.admissionPolicyHash,
    },
    assignments,
    assignmentReferences: assignments.map(value => value.assignmentId),
    assignmentEvidenceHash: stableHash(
      assignments.map(value => ({
        assignmentId: value.assignmentId,
        selectionBindingHash: value.selectionBindingHash,
      })),
    ),
    voucherPreparationHash: stableHash(
      assignments.map(value => ({
        assignmentId: value.assignmentId,
        voucherMarker: value.voucherMarker,
      })),
    ),
    settlementBindingHash: stableHash({
      bindingId,
      round: {
        operationKey: round.operationKey,
        deploymentKey: round.deploymentKey,
        chainId: round.chainId,
        panelAddress: round.panelAddress,
        roundId: round.roundId,
        contentId: round.productContentId,
        admissionPolicyHash: round.admissionPolicyHash,
        roundTermsHash: round.roundTermsHash,
        totalFundedAtomic: round.totalFundedAtomic,
        maximumCommits: round.maximumCommits,
      },
      settlements: evidenceRows,
    }),
    replayed: true,
  };
}

export async function preparePublicNetworkAudienceForBinding(
  bindingId: string,
  now = new Date(),
  signal?: AbortSignal,
) {
  try {
    throwIfMaintenanceCancelled(signal);
    const completed = await loadCompletedAudienceRound(bindingId);
    throwIfMaintenanceCancelled(signal);
    if (completed) {
      await verifyCompletedAudience(completed);
      throwIfMaintenanceCancelled(signal);
      return {
        bindingId,
        state: "audience_ready" as const,
        runId: completed.runId,
        operationKey: completed.operationKey,
        replayed: true,
      };
    }
    const round = await loadConfirmedNetworkRound(bindingId, now);
    throwIfMaintenanceCancelled(signal);
    const managerClient = await dbPool.connect();
    let manager: WorkspaceManager;
    try {
      manager = await loadWorkspaceManager(managerClient, round.workspaceId, round.projectId);
      throwIfMaintenanceCancelled(signal);
    } finally {
      managerClient.release();
    }
    const bound = await bindAssuranceCaseRound({
      principal: manager,
      runId: round.runId,
      caseId: round.caseId,
      roundId: round.roundId,
      status: "open",
      exactNetworkRound: {
        bindingId: round.bindingId,
        operationKey: round.operationKey,
        deploymentKey: round.deploymentKey,
        chainId: round.chainId,
        panelAddress: round.panelAddress,
        roundTermsHash: round.roundTermsHash,
        totalFundedAtomic: round.totalFundedAtomic,
        maximumCommits: round.maximumCommits,
        now,
      },
    });
    throwIfMaintenanceCancelled(signal);
    if (
      bound.contentId?.toLowerCase() !== round.productContentId ||
      bound.admissionPolicyHash?.toLowerCase() !== round.admissionPolicyHash
    ) {
      throw new TokenlessServiceError(
        "The assurance case did not bind the exact confirmed public round.",
        409,
        "public_network_round_binding_conflict",
      );
    }
    await persistExactConfirmedRound(round, now);
    throwIfMaintenanceCancelled(signal);
    await prepareAndReserveNetworkRunAudience({
      accountAddress: manager.accountAddress,
      workspaceId: round.workspaceId,
      projectId: round.projectId,
      runId: round.runId,
      confidentialityTermsHash: round.confidentialityTermsHash,
      now,
    });
    throwIfMaintenanceCancelled(signal);
    const live = await loadConfirmedNetworkRound(bindingId, now);
    throwIfMaintenanceCancelled(signal);
    if (
      live.deploymentKey !== round.deploymentKey ||
      live.roundId !== round.roundId ||
      live.roundTermsHash !== round.roundTermsHash ||
      live.totalFundedAtomic !== round.totalFundedAtomic ||
      live.maximumCommits !== round.maximumCommits
    ) {
      throw new TokenlessServiceError(
        "The live funded round changed during audience reservation.",
        409,
        "public_network_round_binding_conflict",
      );
    }
    await verifyReservedAudience(round, now);
    throwIfMaintenanceCancelled(signal);
    const ready = await dbClient.execute({
      sql: `UPDATE tokenless_public_network_review_bindings
            SET state='audience_ready',audience_ready_at=?,worker_next_attempt_at=NULL,
                worker_last_error_code=NULL,worker_dead_at=NULL,updated_at=?
            WHERE binding_id=? AND state='round_bound'
            RETURNING binding_id`,
      args: [now, now, bindingId],
    });
    if (!ready.rowCount) {
      const replay = await dbClient.execute({
        sql: "SELECT state FROM tokenless_public_network_review_bindings WHERE binding_id=?",
        args: [bindingId],
      });
      if (text(replay.rows[0] as Row | undefined, "state") !== "audience_ready") {
        throw new TokenlessServiceError(
          "The public network audience readiness transition conflicted.",
          409,
          "public_network_audience_projection_conflict",
        );
      }
    }
    return {
      bindingId,
      state: "audience_ready" as const,
      runId: round.runId,
      operationKey: round.operationKey,
      replayed: false,
    };
  } catch (error) {
    await recordPublicNetworkWorkerFailure(bindingId, error, now);
    throw error;
  }
}

export const __publicNetworkReviewReachabilityTestUtils = {
  FOUNDATION_ORPHAN_TTL_MS: PUBLIC_NETWORK_FOUNDATION_ORPHAN_TTL_MS,
  deterministicId,
  foundationIdentity,
  loadConfirmedNetworkRound,
  recordPublicNetworkWorkerFailure,
  reviewerTarget,
};
