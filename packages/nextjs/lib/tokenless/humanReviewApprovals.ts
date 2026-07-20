import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { isRateLoopPrincipalId, normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { MINIMUM_REVIEW_PANEL_SIZE } from "~~/lib/tokenless/reviewRequestProfiles";
import {
  type ReviewerExpertiseRequirement,
  normalizeReviewerExpertiseRequirementsSelection,
} from "~~/lib/tokenless/reviewerExpertiseOptions";
import {
  type ReviewerExpertiseKey,
  normalizeReviewerExpertiseKeys,
} from "~~/lib/tokenless/reviewerExpertiseVocabulary";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ATOMIC_PATTERN = /^(0|[1-9]\d*)$/u;

export type HumanReviewPreparedRequest = {
  schemaVersion: "rateloop.human-review-prepared-request.v1";
  opportunityId: string;
  workflowKey: string;
  requestProfile: { id: string; version: number; hash: string };
  question: {
    criterion: string;
    positiveLabel: string;
    negativeLabel: string;
    rationaleMode: "off" | "optional" | "required";
    questionHash?: string;
    questionAuthority?: "owner_fixed" | "agent_per_request";
    resultSemantics?: "assurance" | "feedback";
  };
  audience: {
    kind: "private_invited" | "public_network" | "hybrid";
    contentBoundary: "private_workspace" | "public_or_test";
    privateSensitivity: "internal" | "confidential" | "restricted" | "regulated" | null;
    privateGroupId: string | null;
    requiredExpertiseKeys?: ReviewerExpertiseKey[];
    expertiseRequirements?: ReviewerExpertiseRequirement[];
  };
  timing: { responseWindowSeconds: number; expiresAt: string };
  panel: { size: number };
  contentCommitments: { source: string; suggestion: string };
  provenance: {
    agentId: string;
    agentVersionId: string;
    selectionPolicyId: string;
    selectionPolicyVersion: number;
  };
  publicationApproval?: {
    schemaVersion: "rateloop.redacted-publication-approval.v1";
    visibility: "public";
    dataClassification: "redacted";
    confirmedNoSensitiveData: true;
    redactionSummary: string;
    humanReviewBinding: {
      id: string;
      version: number;
      hash: string;
      authority: "ask_automatically" | "prepare_for_approval";
    };
    selectionPolicy: { id: string; version: number };
    publishingPolicy: { id: string; version: number };
  };
  feedbackBonus?: HumanReviewFeedbackBonusEconomics;
};

export type HumanReviewFeedbackBonusEconomics = {
  schemaVersion: "rateloop.feedback-bonus-economics.v1";
  enabled: boolean;
  currency: "USDC" | null;
  poolAtomic: string;
  awarder: { kind: "requester" | "designated"; account: string | null };
  awardWindowSeconds: number | null;
  agentMayAward: false;
};

export type HumanReviewDerivedEconomics = {
  schemaVersion: "rateloop.human-review-derived-economics.v1";
  compensationMode: "unpaid" | "usdc";
  bountyPerSeatAtomic: string;
  panelSize: number;
  baseBountyAtomic: string;
  feeBps: number;
  feeAtomic: string;
  attemptReserveAtomic: string;
  maximumChargeAtomic: string;
};

export type HumanReviewApproval = {
  approvalId: string;
  revision: number;
  status: "pending" | "approved" | "denied";
  lifecycleRevision: number;
  preparedRequestHash: string;
  derivedEconomicsHash: string;
  createdAt: string;
  expiresAt: string;
  preparedRequest: HumanReviewPreparedRequest;
  economics: HumanReviewDerivedEconomics;
  feedbackBonusEconomics: HumanReviewFeedbackBonusEconomics;
  maximumConsentAtomic: string;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Prepared approval JSON is not canonicalizable.");
  return encoded;
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function text(row: Row, key: string) {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

function integer(value: unknown, field: string, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Stored ${field} is invalid.`);
  }
  return parsed;
}

function oneOf<Value extends string>(value: unknown, field: string, allowed: readonly Value[]): Value {
  const candidate = requiredString(value, field);
  if (!allowed.includes(candidate as Value)) throw new Error(`Stored ${field} is invalid.`);
  return candidate as Value;
}

function dateIso(value: unknown, field: string) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error(`Stored ${field} is invalid.`);
  return date.toISOString();
}

function object(value: unknown, field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Stored ${field} is invalid.`);
  return value as Record<string, unknown>;
}

function parsedObject(value: unknown, field: string) {
  try {
    return object(JSON.parse(String(value)), field);
  } catch {
    throw new Error(`Stored ${field} is invalid.`);
  }
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Stored ${field} is invalid.`);
  return value;
}

function optionalString(value: unknown, field: string) {
  return value === null ? null : requiredString(value, field);
}

function exactKeys(value: Record<string, unknown>, field: string, keys: string[]) {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new Error(`Stored ${field} has unsupported fields.`);
  }
}

function hash(value: unknown, field: string) {
  const candidate = requiredString(value, field);
  if (!HASH_PATTERN.test(candidate)) throw new Error(`Stored ${field} is invalid.`);
  return candidate;
}

function atomic(value: unknown, field: string) {
  const candidate = requiredString(value, field);
  if (!ATOMIC_PATTERN.test(candidate)) throw new Error(`Stored ${field} is invalid.`);
  return candidate;
}

function preparedRequest(value: unknown): HumanReviewPreparedRequest {
  const root = object(value, "prepared request");
  const preparedKeys = [
    "schemaVersion",
    "opportunityId",
    "workflowKey",
    "requestProfile",
    "question",
    "audience",
    "timing",
    "panel",
    "contentCommitments",
    "provenance",
  ];
  if (root.publicationApproval !== undefined) preparedKeys.push("publicationApproval");
  if (root.feedbackBonus !== undefined) preparedKeys.push("feedbackBonus");
  exactKeys(root, "prepared request", preparedKeys);
  if (root.schemaVersion !== "rateloop.human-review-prepared-request.v1") {
    throw new Error("Stored prepared request schema is unsupported.");
  }
  const requestProfile = object(root.requestProfile, "request profile");
  const question = object(root.question, "question");
  const audience = object(root.audience, "audience");
  const timing = object(root.timing, "timing");
  const panel = object(root.panel, "panel");
  const contentCommitments = object(root.contentCommitments, "content commitments");
  const provenance = object(root.provenance, "provenance");
  const publication =
    root.publicationApproval === undefined ? null : object(root.publicationApproval, "redacted-publication approval");
  const bonus =
    root.feedbackBonus === undefined
      ? ({
          schemaVersion: "rateloop.feedback-bonus-economics.v1",
          enabled: false,
          currency: null,
          poolAtomic: "0",
          awarder: { kind: "requester", account: null },
          awardWindowSeconds: null,
          agentMayAward: false,
        } as const)
      : feedbackBonusEconomics(root.feedbackBonus);
  exactKeys(requestProfile, "request profile", ["id", "version", "hash"]);
  const questionKeys = ["criterion", "positiveLabel", "negativeLabel", "rationaleMode"];
  const hasQuestionBinding =
    question.questionHash !== undefined ||
    question.questionAuthority !== undefined ||
    question.resultSemantics !== undefined;
  if (hasQuestionBinding) questionKeys.push("questionHash", "questionAuthority", "resultSemantics");
  exactKeys(question, "question", questionKeys);
  const audienceKeys = ["kind", "contentBoundary", "privateSensitivity", "privateGroupId"];
  if (audience.requiredExpertiseKeys !== undefined) audienceKeys.push("requiredExpertiseKeys");
  if (audience.expertiseRequirements !== undefined) audienceKeys.push("expertiseRequirements");
  exactKeys(audience, "audience", audienceKeys);
  exactKeys(timing, "timing", ["responseWindowSeconds", "expiresAt"]);
  exactKeys(panel, "panel", ["size"]);
  exactKeys(contentCommitments, "content commitments", ["source", "suggestion"]);
  exactKeys(provenance, "provenance", ["agentId", "agentVersionId", "selectionPolicyId", "selectionPolicyVersion"]);
  let exactPublication: HumanReviewPreparedRequest["publicationApproval"];
  if (publication) {
    exactKeys(publication, "redacted-publication approval", [
      "schemaVersion",
      "visibility",
      "dataClassification",
      "confirmedNoSensitiveData",
      "redactionSummary",
      "humanReviewBinding",
      "selectionPolicy",
      "publishingPolicy",
    ]);
    const binding = object(publication.humanReviewBinding, "redacted-publication human-review binding");
    const selection = object(publication.selectionPolicy, "redacted-publication selection policy");
    const publishing = object(publication.publishingPolicy, "redacted-publication publishing policy");
    exactKeys(binding, "redacted-publication human-review binding", ["id", "version", "hash", "authority"]);
    exactKeys(selection, "redacted-publication selection policy", ["id", "version"]);
    exactKeys(publishing, "redacted-publication publishing policy", ["id", "version"]);
    const redactionSummary = requiredString(publication.redactionSummary, "redaction summary");
    const selectionPolicyId = requiredString(selection.id, "redacted-publication selection policy ID");
    const selectionPolicyVersion = integer(selection.version, "redacted-publication selection policy version");
    if (
      publication.schemaVersion !== "rateloop.redacted-publication-approval.v1" ||
      publication.visibility !== "public" ||
      publication.dataClassification !== "redacted" ||
      publication.confirmedNoSensitiveData !== true ||
      redactionSummary !== redactionSummary.trim() ||
      redactionSummary.length < 10 ||
      redactionSummary.length > 1_000 ||
      selectionPolicyId !== requiredString(provenance.selectionPolicyId, "selection policy ID") ||
      selectionPolicyVersion !== integer(provenance.selectionPolicyVersion, "selection policy version")
    ) {
      throw new Error("Stored redacted-publication approval is internally inconsistent.");
    }
    exactPublication = {
      schemaVersion: "rateloop.redacted-publication-approval.v1",
      visibility: "public",
      dataClassification: "redacted",
      confirmedNoSensitiveData: true,
      redactionSummary,
      humanReviewBinding: {
        id: requiredString(binding.id, "human-review binding ID"),
        version: integer(binding.version, "human-review binding version"),
        hash: hash(binding.hash, "human-review binding hash"),
        authority: oneOf(binding.authority, "human-review binding authority", [
          "ask_automatically",
          "prepare_for_approval",
        ] as const),
      },
      selectionPolicy: { id: selectionPolicyId, version: selectionPolicyVersion },
      publishingPolicy: {
        id: requiredString(publishing.id, "publishing policy ID"),
        version: integer(publishing.version, "publishing policy version"),
      },
    };
  }
  const rationaleMode = oneOf(question.rationaleMode, "rationale mode", ["off", "optional", "required"] as const);
  const questionBinding = hasQuestionBinding
    ? {
        questionHash: hash(question.questionHash, "question hash"),
        questionAuthority: oneOf(question.questionAuthority, "question authority", [
          "owner_fixed",
          "agent_per_request",
        ] as const),
        resultSemantics: oneOf(question.resultSemantics, "result semantics", ["assurance", "feedback"] as const),
      }
    : null;
  if (
    questionBinding &&
    ((questionBinding.questionAuthority === "owner_fixed" && questionBinding.resultSemantics !== "assurance") ||
      (questionBinding.questionAuthority === "agent_per_request" && questionBinding.resultSemantics !== "feedback"))
  ) {
    throw new Error("Stored question authority and result semantics are inconsistent.");
  }
  const audienceKind = oneOf(audience.kind, "audience kind", ["private_invited", "public_network", "hybrid"] as const);
  const contentBoundary = oneOf(audience.contentBoundary, "content boundary", [
    "private_workspace",
    "public_or_test",
  ] as const);
  const privateSensitivity =
    audience.privateSensitivity === null
      ? null
      : oneOf(audience.privateSensitivity, "private sensitivity", [
          "internal",
          "confidential",
          "restricted",
          "regulated",
        ] as const);
  const privateGroupId = optionalString(audience.privateGroupId, "private group ID");
  if (
    (audienceKind === "private_invited" &&
      (contentBoundary !== "private_workspace" || privateSensitivity === null || privateGroupId === null)) ||
    (audienceKind === "public_network" &&
      (contentBoundary !== "public_or_test" || privateSensitivity !== null || privateGroupId !== null)) ||
    (audienceKind === "hybrid" &&
      (contentBoundary !== "public_or_test" || privateSensitivity !== null || privateGroupId === null))
  ) {
    throw new Error("Stored audience and content-boundary terms are inconsistent.");
  }
  const responseWindowSeconds = integer(timing.responseWindowSeconds, "response window", 1_200, 86_400);
  const panelSize = integer(
    panel.size,
    "panel size",
    audienceKind === "private_invited" ? MINIMUM_REVIEW_PANEL_SIZE : 3,
    100,
  );
  let requiredExpertiseKeys: ReviewerExpertiseKey[];
  let expertiseRequirements: ReviewerExpertiseRequirement[];
  try {
    requiredExpertiseKeys = normalizeReviewerExpertiseKeys(audience.requiredExpertiseKeys ?? []);
    expertiseRequirements = normalizeReviewerExpertiseRequirementsSelection(
      audience.expertiseRequirements ?? [],
      panelSize,
    );
  } catch {
    throw new Error("Stored specialist requirements are invalid.");
  }
  if (
    (requiredExpertiseKeys.length > 0 && expertiseRequirements.length > 0) ||
    (audienceKind === "private_invited" &&
      expertiseRequirements.some(requirement => requirement.sourceScope !== "customer_invited")) ||
    (audienceKind === "public_network" &&
      expertiseRequirements.some(
        requirement => requirement.sourceScope !== "rateloop_network" || requirement.minimumSeats !== panelSize,
      )) ||
    (audienceKind === "hybrid" && expertiseRequirements.length > 0)
  ) {
    throw new Error("Stored specialist requirements do not match the audience.");
  }
  const positiveLabel = requiredString(question.positiveLabel, "positive label");
  const negativeLabel = requiredString(question.negativeLabel, "negative label");
  if (positiveLabel.toLocaleLowerCase("en-US") === negativeLabel.toLocaleLowerCase("en-US")) {
    throw new Error("Stored answer labels are not distinct.");
  }
  return {
    schemaVersion: root.schemaVersion,
    opportunityId: requiredString(root.opportunityId, "opportunity ID"),
    workflowKey: requiredString(root.workflowKey, "workflow key"),
    requestProfile: {
      id: requiredString(requestProfile.id, "request profile ID"),
      version: integer(requestProfile.version, "request profile version"),
      hash: hash(requestProfile.hash, "request profile hash"),
    },
    question: {
      criterion: requiredString(question.criterion, "question criterion"),
      positiveLabel,
      negativeLabel,
      rationaleMode,
      ...(questionBinding ?? {}),
    },
    audience: {
      kind: audienceKind,
      contentBoundary,
      privateSensitivity,
      privateGroupId,
      requiredExpertiseKeys,
      ...(expertiseRequirements.length ? { expertiseRequirements } : {}),
    },
    timing: {
      responseWindowSeconds,
      expiresAt: dateIso(timing.expiresAt, "prepared request expiry"),
    },
    panel: { size: panelSize },
    contentCommitments: {
      source: hash(contentCommitments.source, "source commitment"),
      suggestion: hash(contentCommitments.suggestion, "suggestion commitment"),
    },
    provenance: {
      agentId: requiredString(provenance.agentId, "agent ID"),
      agentVersionId: requiredString(provenance.agentVersionId, "agent version ID"),
      selectionPolicyId: requiredString(provenance.selectionPolicyId, "selection policy ID"),
      selectionPolicyVersion: integer(provenance.selectionPolicyVersion, "selection policy version"),
    },
    ...(exactPublication ? { publicationApproval: exactPublication } : {}),
    feedbackBonus: bonus,
  };
}

function feedbackBonusEconomics(value: unknown): HumanReviewFeedbackBonusEconomics {
  const root = object(value, "Feedback Bonus economics");
  exactKeys(root, "Feedback Bonus economics", [
    "schemaVersion",
    "enabled",
    "currency",
    "poolAtomic",
    "awarder",
    "awardWindowSeconds",
    "agentMayAward",
  ]);
  const awarder = object(root.awarder, "Feedback Bonus awarder");
  exactKeys(awarder, "Feedback Bonus awarder", ["kind", "account"]);
  if (root.schemaVersion !== "rateloop.feedback-bonus-economics.v1" || typeof root.enabled !== "boolean") {
    throw new Error("Stored Feedback Bonus economics are unsupported.");
  }
  const kind = oneOf(awarder.kind, "Feedback Bonus awarder", ["requester", "designated"] as const);
  const account = optionalString(awarder.account, "Feedback Bonus awarder account");
  const poolAtomic = atomic(root.poolAtomic, "Feedback Bonus pool");
  const awardWindowSeconds =
    root.awardWindowSeconds === null
      ? null
      : integer(root.awardWindowSeconds, "Feedback Bonus award window", 3_600, 31_536_000);
  if (
    root.agentMayAward !== false ||
    (root.enabled && (root.currency !== "USDC" || BigInt(poolAtomic) === 0n || awardWindowSeconds === null)) ||
    (!root.enabled && (root.currency !== null || BigInt(poolAtomic) !== 0n || awardWindowSeconds !== null)) ||
    (kind === "requester") !== (account === null)
  ) {
    throw new Error("Stored Feedback Bonus economics are internally inconsistent.");
  }
  return {
    schemaVersion: root.schemaVersion,
    enabled: root.enabled,
    currency: root.currency as "USDC" | null,
    poolAtomic,
    awarder: { kind, account },
    awardWindowSeconds,
    agentMayAward: false,
  };
}

function economics(value: unknown): HumanReviewDerivedEconomics {
  const root = object(value, "derived economics");
  exactKeys(root, "derived economics", [
    "schemaVersion",
    "compensationMode",
    "bountyPerSeatAtomic",
    "panelSize",
    "baseBountyAtomic",
    "feeBps",
    "feeAtomic",
    "attemptReserveAtomic",
    "maximumChargeAtomic",
  ]);
  if (root.schemaVersion !== "rateloop.human-review-derived-economics.v1") {
    throw new Error("Stored derived economics schema is unsupported.");
  }
  const compensationMode = oneOf(root.compensationMode, "compensation mode", ["unpaid", "usdc"] as const);
  const bountyPerSeatAtomic = atomic(root.bountyPerSeatAtomic, "bounty per seat");
  const panelSize = integer(root.panelSize, "economics panel size", 1, 100);
  const baseBountyAtomic = atomic(root.baseBountyAtomic, "base bounty");
  const feeBps = integer(root.feeBps, "fee", 0, 2_000);
  const feeAtomic = atomic(root.feeAtomic, "fee");
  const attemptReserveAtomic = atomic(root.attemptReserveAtomic, "attempt reserve");
  const maximumChargeAtomic = atomic(root.maximumChargeAtomic, "maximum charge");
  const expectedBase = BigInt(bountyPerSeatAtomic) * BigInt(panelSize);
  const expectedFee = (expectedBase * BigInt(feeBps)) / 10_000n;
  const expectedMaximum = expectedBase + expectedFee + BigInt(attemptReserveAtomic);
  if (
    BigInt(baseBountyAtomic) !== expectedBase ||
    BigInt(feeAtomic) !== expectedFee ||
    BigInt(maximumChargeAtomic) !== expectedMaximum ||
    (compensationMode === "unpaid" && expectedMaximum !== 0n) ||
    (compensationMode === "usdc" && BigInt(bountyPerSeatAtomic) === 0n)
  ) {
    throw new Error("Stored derived economics are internally inconsistent.");
  }
  return {
    schemaVersion: root.schemaVersion,
    compensationMode,
    bountyPerSeatAtomic,
    panelSize,
    baseBountyAtomic,
    feeBps,
    feeAtomic,
    attemptReserveAtomic,
    maximumChargeAtomic,
  };
}

function approvalFromRow(row: Row): HumanReviewApproval {
  const preparedRaw = parsedObject(row.prepared_request_json, "prepared request");
  const economicsRaw = parsedObject(row.derived_economics_json, "derived economics");
  const prepared = preparedRequest(preparedRaw);
  const derived = economics(economicsRaw);
  const bonus =
    prepared.feedbackBonus ??
    ({
      schemaVersion: "rateloop.feedback-bonus-economics.v1",
      enabled: false,
      currency: null,
      poolAtomic: "0",
      awarder: { kind: "requester", account: null },
      awardWindowSeconds: null,
      agentMayAward: false,
    } as const);
  const preparedHash = hash(row.prepared_request_hash, "prepared request hash");
  const economicsHash = hash(row.derived_economics_hash, "derived economics hash");
  const expiresAt = dateIso(row.expires_at, "approval expiry");
  if (sha256(preparedRaw) !== preparedHash || sha256(economicsRaw) !== economicsHash) {
    throw new Error("Stored human-review approval hashes do not match their canonical payloads.");
  }
  if (
    prepared.opportunityId !== text(row, "opportunity_id") ||
    prepared.requestProfile.id !== text(row, "request_profile_id") ||
    prepared.requestProfile.version !== integer(row.request_profile_version, "stored request profile version") ||
    prepared.requestProfile.hash !== text(row, "request_profile_hash") ||
    prepared.contentCommitments.source !== text(row, "source_evidence_hash") ||
    prepared.contentCommitments.suggestion !== text(row, "suggestion_commitment") ||
    prepared.timing.expiresAt !== expiresAt ||
    prepared.panel.size !== derived.panelSize ||
    derived.maximumChargeAtomic !== text(row, "maximum_charge_atomic") ||
    bonus.poolAtomic !== text(row, "feedback_bonus_maximum_atomic") ||
    (BigInt(derived.maximumChargeAtomic) + BigInt(bonus.poolAtomic)).toString() !== text(row, "maximum_consent_atomic")
  ) {
    throw new Error("Stored human-review approval does not match its frozen bindings.");
  }
  const status = text(row, "status");
  const lifecycleState = text(row, "lifecycle_state");
  if (
    (status !== "pending" && status !== "approved") ||
    (status === "pending" && lifecycleState !== "approval_required") ||
    (status === "approved" && lifecycleState !== "request_ready")
  ) {
    throw new Error("Stored human-review approval is not in an actionable lifecycle state.");
  }
  return {
    approvalId: requiredString(row.approval_id, "approval ID"),
    revision: integer(row.revision, "approval revision"),
    status,
    lifecycleRevision: integer(row.lifecycle_revision, "lifecycle revision"),
    preparedRequestHash: preparedHash,
    derivedEconomicsHash: economicsHash,
    createdAt: dateIso(row.created_at, "approval creation time"),
    expiresAt,
    preparedRequest: prepared,
    economics: derived,
    feedbackBonusEconomics: bonus,
    maximumConsentAtomic: text(row, "maximum_consent_atomic")!,
  };
}

async function requireOwner(client: PoolClient, accountAddress: string, workspaceId: string) {
  let actor: string;
  try {
    actor = normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("Account identity is invalid.", 400, "invalid_account");
  }
  const membership = await client.query(
    `SELECT 1 FROM tokenless_workspace_members m
     JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
     WHERE m.workspace_id = $1 AND m.account_address = $2 AND w.status = 'active'
       AND m.role IN ('owner','admin') LIMIT 1`,
    [workspaceId, actor],
  );
  if (membership.rowCount !== 1) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return actor;
}

const APPROVAL_SELECT = `SELECT a.*, l.state AS lifecycle_state, l.state_revision AS lifecycle_revision,
                                l.reason_codes_json AS lifecycle_reason_codes_json
                         FROM tokenless_agent_review_approval_requests a
                         JOIN tokenless_agent_review_opportunity_lifecycles l
                           ON l.workspace_id = a.workspace_id AND l.opportunity_id = a.opportunity_id`;

export async function listHumanReviewApprovalsForOwner(input: { accountAddress: string; workspaceId: string }) {
  const client = await dbPool.connect();
  try {
    await requireOwner(client, input.accountAddress, input.workspaceId);
    const result = await client.query(
      `${APPROVAL_SELECT}
       WHERE a.workspace_id = $1 AND a.status IN ('pending','approved') AND a.expires_at > $2
       ORDER BY a.expires_at ASC, a.created_at ASC`,
      [input.workspaceId, new Date()],
    );
    return { approvals: result.rows.map(row => approvalFromRow(row as Row)) };
  } finally {
    client.release();
  }
}

function decisionInput(value: unknown) {
  try {
    const body = object(value, "approval decision");
    exactKeys(body, "approval decision", [
      "revision",
      "preparedRequestHash",
      "derivedEconomicsHash",
      "decision",
      "note",
    ]);
    const decision = body.decision;
    if (decision !== "approve" && decision !== "reject") throw new Error("Approval decision is invalid.");
    const note = body.note === null ? null : requiredString(body.note, "decision note").trim();
    if (note && note.length > 1_000) throw new Error("Approval decision note is too long.");
    return {
      revision: integer(body.revision, "approval revision"),
      preparedRequestHash: hash(body.preparedRequestHash, "prepared request hash"),
      derivedEconomicsHash: hash(body.derivedEconomicsHash, "derived economics hash"),
      decision,
      note,
    } as const;
  } catch (error) {
    throw new TokenlessServiceError(
      error instanceof Error ? error.message : "Approval decision is invalid.",
      400,
      "invalid_human_review_approval",
    );
  }
}

export async function decideHumanReviewApprovalForOwner(input: {
  accountAddress: string;
  workspaceId: string;
  approvalId: string;
  body: unknown;
}) {
  const decision = decisionInput(input.body);
  const client = await dbPool.connect();
  const now = new Date();
  let actor = "";
  let decided: HumanReviewApproval | undefined;
  try {
    await client.query("BEGIN");
    actor = await requireOwner(client, input.accountAddress, input.workspaceId);
    const result = await client.query(
      `${APPROVAL_SELECT}
       WHERE a.workspace_id = $1 AND a.approval_id = $2 FOR UPDATE`,
      [input.workspaceId, input.approvalId],
    );
    const row = result.rows[0] as Row | undefined;
    if (!row) throw new TokenlessServiceError("Approval not found.", 404, "human_review_approval_not_found");
    const current = approvalFromRow(row);
    if (
      current.revision !== decision.revision ||
      current.preparedRequestHash !== decision.preparedRequestHash ||
      current.derivedEconomicsHash !== decision.derivedEconomicsHash
    ) {
      throw new TokenlessServiceError(
        "This prepared request changed. Reload it before deciding.",
        409,
        "human_review_approval_conflict",
      );
    }
    if (current.status !== "pending") {
      throw new TokenlessServiceError(
        "This prepared request is no longer pending.",
        409,
        "human_review_approval_not_actionable",
      );
    }
    if (new Date(current.expiresAt) <= now) {
      throw new TokenlessServiceError("This prepared request has expired.", 409, "human_review_approval_expired");
    }
    const approved = decision.decision === "approve";
    const status = approved ? "approved" : "denied";
    const ownerDecision = approved ? "approved" : "denied";
    const nextLifecycleState = approved ? "request_ready" : "cancelled_before_commit";
    const reasonCodes = JSON.parse(String(row.lifecycle_reason_codes_json)) as unknown;
    if (!Array.isArray(reasonCodes) || reasonCodes.some(reason => typeof reason !== "string")) {
      throw new Error("Stored lifecycle reason codes are invalid.");
    }
    const nextReasons = [...new Set([...reasonCodes, approved ? "owner_approved" : "owner_denied"] as string[])];
    const approvalUpdate = await client.query(
      `UPDATE tokenless_agent_review_approval_requests
       SET status = $1, owner_decision = $2, decided_by = $3, decision_note = $4, decided_at = $5
       WHERE workspace_id = $6 AND approval_id = $7 AND revision = $8 AND status = 'pending'
         AND prepared_request_hash = $9 AND derived_economics_hash = $10 AND expires_at > $5`,
      [
        status,
        ownerDecision,
        actor,
        decision.note,
        now,
        input.workspaceId,
        input.approvalId,
        decision.revision,
        decision.preparedRequestHash,
        decision.derivedEconomicsHash,
      ],
    );
    if (approvalUpdate.rowCount !== 1) {
      throw new TokenlessServiceError(
        "This prepared request is no longer current.",
        409,
        "human_review_approval_conflict",
      );
    }
    const lifecycleUpdate = await client.query(
      `UPDATE tokenless_agent_review_opportunity_lifecycles
       SET state = $1, state_revision = state_revision + 1, reason_codes_json = $2,
           state_entered_at = $3, terminal_at = $4, updated_at = $3
       WHERE workspace_id = $5 AND opportunity_id = $6 AND state = 'approval_required'
         AND state_revision = $7 AND terminal_at IS NULL`,
      [
        nextLifecycleState,
        JSON.stringify(nextReasons),
        now,
        approved ? null : now,
        input.workspaceId,
        current.preparedRequest.opportunityId,
        current.lifecycleRevision,
      ],
    );
    if (lifecycleUpdate.rowCount !== 1) {
      throw new TokenlessServiceError(
        "This review lifecycle changed. Reload it.",
        409,
        "human_review_approval_conflict",
      );
    }
    decided = {
      ...current,
      status: approved ? "approved" : "denied",
      lifecycleRevision: current.lifecycleRevision + 1,
    };
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (!decided) throw new Error("Approval decision did not complete.");
  await appendAuditEvent({
    workspaceId: input.workspaceId,
    actorKind: isRateLoopPrincipalId(actor) ? "principal" : "account",
    actorReference: actor,
    assuranceMethod: "rateloop_session",
    action: "human_review.approval_decided",
    targetKind: "human_review_approval",
    targetId: input.approvalId,
    purpose: "human_review_request_approval",
    reason: decision.decision === "approve" ? "workspace_administrator_approved" : "workspace_administrator_rejected",
    result: "success",
    metadata: {
      revision: decision.revision,
      preparedRequestHash: decision.preparedRequestHash,
      derivedEconomicsHash: decision.derivedEconomicsHash,
      decision: decision.decision,
    },
  });
  return { approval: decided };
}

export const __humanReviewApprovalTestUtils = { approvalFromRow, sha256, stableJson };
