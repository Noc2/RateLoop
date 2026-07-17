import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient, dbPool } from "~~/lib/db";
import {
  HUMAN_REVIEW_AUDIENCES,
  HUMAN_REVIEW_COMPENSATION_MODES,
  HUMAN_REVIEW_CONTENT_BOUNDARIES,
  type HumanReviewAudience,
  type HumanReviewCompensationMode,
  type HumanReviewContentBoundary,
} from "~~/lib/tokenless/reviewCapabilities";
import { validateReviewerExpertiseRequirementsWithClient } from "~~/lib/tokenless/reviewerExpertiseDefinitions";
import {
  type ReviewerExpertiseRequirement,
  normalizeReviewerExpertiseRequirementsSelection,
} from "~~/lib/tokenless/reviewerExpertiseOptions";
import {
  type ReviewerExpertiseKey,
  normalizeReviewerExpertiseKeys,
} from "~~/lib/tokenless/reviewerExpertiseVocabulary";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const REVIEW_REQUEST_RATIONALE_MODES = ["off", "optional", "required"] as const;
export type ReviewRequestRationaleMode = (typeof REVIEW_REQUEST_RATIONALE_MODES)[number];

export const REVIEW_REQUEST_QUESTION_AUTHORITIES = ["owner_fixed", "agent_per_request"] as const;
export type ReviewRequestQuestionAuthority = (typeof REVIEW_REQUEST_QUESTION_AUTHORITIES)[number];

export const REVIEW_REQUEST_RESULT_SEMANTICS = ["assurance", "feedback"] as const;
export type ReviewRequestResultSemantics = (typeof REVIEW_REQUEST_RESULT_SEMANTICS)[number];

export const REVIEW_REQUEST_PRIVATE_SENSITIVITIES = ["internal", "confidential", "restricted", "regulated"] as const;
export type ReviewRequestPrivateSensitivity = (typeof REVIEW_REQUEST_PRIVATE_SENSITIVITIES)[number];

export const MINIMUM_REVIEW_RESPONSE_WINDOW_SECONDS = 1_200;
export const MAXIMUM_REVIEW_RESPONSE_WINDOW_SECONDS = 86_400;
export const MINIMUM_REVIEW_PANEL_SIZE = 1;
export const MAXIMUM_REVIEW_PANEL_SIZE = 100;
export const MAXIMUM_REVIEW_USDC_ATOMIC = (1n << 256n) - 1n;
export const MINIMUM_FEEDBACK_BONUS_AWARD_WINDOW_SECONDS = 3_600;
export const MAXIMUM_FEEDBACK_BONUS_AWARD_WINDOW_SECONDS = 31_536_000;
export const DEFAULT_FEEDBACK_BONUS_AWARD_WINDOW_SECONDS = 604_800;

export type FeedbackBonusAwarderKind = "requester" | "designated";
export type ReviewRequestProfileSemanticSchemaVersion = 1 | 2 | 3;

type QueryRow = Record<string, unknown>;

export type ReviewRequestProfileInput = {
  agentId: string;
  agentVersionId: string;
  questionAuthority: ReviewRequestQuestionAuthority;
  criterion?: string | null;
  positiveLabel?: string | null;
  negativeLabel?: string | null;
  rationaleMode: ReviewRequestRationaleMode;
  audience: HumanReviewAudience;
  contentBoundary: HumanReviewContentBoundary;
  privateSensitivity?: ReviewRequestPrivateSensitivity | null;
  privateGroupId?: string | null;
  privateGroupPolicyVersion?: number | null;
  privateGroupPolicyHash?: string | null;
  requiredExpertiseKeys?: ReviewerExpertiseKey[];
  expertiseRequirements?: ReviewerExpertiseRequirement[];
  responseWindowSeconds: number;
  panelSize: number;
  compensationMode: HumanReviewCompensationMode;
  bountyPerSeatAtomic?: string | null;
  feedbackBonusEnabled?: boolean;
  feedbackBonusPoolAtomic?: string | null;
  feedbackBonusAwarderKind?: FeedbackBonusAwarderKind;
  feedbackBonusAwarderAccount?: string | null;
  feedbackBonusAwardWindowSeconds?: number | null;
};

type NormalizedReviewRequestProfile = {
  agentId: string;
  agentVersionId: string;
  questionAuthority: ReviewRequestQuestionAuthority;
  resultSemantics: ReviewRequestResultSemantics;
  criterion: string | null;
  positiveLabel: string | null;
  negativeLabel: string | null;
  rationaleMode: ReviewRequestRationaleMode;
  audience: HumanReviewAudience;
  contentBoundary: HumanReviewContentBoundary;
  privateSensitivity: ReviewRequestPrivateSensitivity | null;
  privateGroupId: string | null;
  privateGroupPolicyVersion: number | null;
  privateGroupPolicyHash: string | null;
  requiredExpertiseKeys: ReviewerExpertiseKey[];
  expertiseRequirements: ReviewerExpertiseRequirement[];
  semanticSchemaVersion: ReviewRequestProfileSemanticSchemaVersion;
  responseWindowSeconds: number;
  panelSize: number;
  compensationMode: HumanReviewCompensationMode;
  bountyPerSeatAtomic: string | null;
  feedbackBonusEnabled: boolean;
  feedbackBonusPoolAtomic: string | null;
  feedbackBonusAwarderKind: FeedbackBonusAwarderKind;
  feedbackBonusAwarderAccount: string | null;
  feedbackBonusAwardWindowSeconds: number | null;
};

export type ReviewRequestProfile = Omit<NormalizedReviewRequestProfile, "responseWindowSeconds" | "panelSize"> & {
  responseWindowSeconds: number | null;
  panelSize: number | null;
  profileId: string;
  version: number;
  workspaceId: string;
  configurationStatus: "ready" | "action_required";
  profileHash: string;
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  supersededAt: string | null;
};

const INPUT_KEYS = new Set<keyof ReviewRequestProfileInput>([
  "agentId",
  "agentVersionId",
  "questionAuthority",
  "criterion",
  "positiveLabel",
  "negativeLabel",
  "rationaleMode",
  "audience",
  "contentBoundary",
  "privateSensitivity",
  "privateGroupId",
  "privateGroupPolicyVersion",
  "privateGroupPolicyHash",
  "requiredExpertiseKeys",
  "expertiseRequirements",
  "responseWindowSeconds",
  "panelSize",
  "compensationMode",
  "bountyPerSeatAtomic",
  "feedbackBonusEnabled",
  "feedbackBonusPoolAtomic",
  "feedbackBonusAwarderKind",
  "feedbackBonusAwarderAccount",
  "feedbackBonusAwardWindowSeconds",
]);
const NON_SEMANTIC_PROFILE_KEYS = new Set([
  "profileId",
  "version",
  "workspaceId",
  "configurationStatus",
  "profileHash",
  "createdBy",
  "createdAt",
  "approvedBy",
  "approvedAt",
  "supersededAt",
  "resultSemantics",
  "semanticSchemaVersion",
]);
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ATOMIC_PATTERN = /^[1-9][0-9]*$/u;
const PRIVATE_SENSITIVITY_RANK = new Map<ReviewRequestPrivateSensitivity, number>(
  REVIEW_REQUEST_PRIVATE_SENSITIVITIES.map((sensitivity, index) => [sensitivity, index]),
);

function invalid(message: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_review_request_profile");
}

function requiredText(value: unknown, field: string, maximum: number) {
  if (typeof value !== "string") invalid(`${field} is required.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    invalid(`${field} must contain between 1 and ${maximum} characters.`);
  }
  return normalized;
}

function optionalText(value: unknown, field: string, maximum: number) {
  if (value === null || value === undefined) return null;
  return requiredText(value, field, maximum);
}

function boundedInteger(value: unknown, field: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    invalid(`${field} must be an integer from ${minimum} to ${maximum}.`);
  }
  return Number(value);
}

function normalizeAtomic(value: unknown, panelSize: number) {
  if (typeof value !== "string" || !ATOMIC_PATTERN.test(value)) {
    invalid("bountyPerSeatAtomic must be a positive integer string in USDC atomic units.");
  }
  let atomic: bigint;
  try {
    atomic = BigInt(value);
  } catch {
    invalid("bountyPerSeatAtomic is outside the supported USDC range.");
  }
  if (atomic > MAXIMUM_REVIEW_USDC_ATOMIC || atomic * BigInt(panelSize) > MAXIMUM_REVIEW_USDC_ATOMIC) {
    invalid("The per-seat bounty and maximum panel liability must fit in an unsigned 256-bit USDC amount.");
  }
  return atomic.toString();
}

export function normalizeReviewRequestProfileInput(value: unknown): NormalizedReviewRequestProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("Review request profile body must be an object.");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !INPUT_KEYS.has(key as keyof ReviewRequestProfileInput))) {
    invalid("Review request profile body contains unknown fields.");
  }

  const agentId = requiredText(input.agentId, "agentId", 160);
  const agentVersionId = requiredText(input.agentVersionId, "agentVersionId", 160);
  const questionAuthority = input.questionAuthority as ReviewRequestQuestionAuthority;
  if (!REVIEW_REQUEST_QUESTION_AUTHORITIES.includes(questionAuthority)) invalid("questionAuthority is invalid.");
  let criterion: string | null;
  let positiveLabel: string | null;
  let negativeLabel: string | null;
  let resultSemantics: ReviewRequestResultSemantics;
  if (questionAuthority === "owner_fixed") {
    criterion = requiredText(input.criterion, "criterion", 500);
    positiveLabel = requiredText(input.positiveLabel, "positiveLabel", 40);
    negativeLabel = requiredText(input.negativeLabel, "negativeLabel", 40);
    if (positiveLabel.toLocaleLowerCase("en-US") === negativeLabel.toLocaleLowerCase("en-US")) {
      invalid("positiveLabel and negativeLabel must be distinct.");
    }
    resultSemantics = "assurance";
  } else {
    if (
      (input.criterion !== null && input.criterion !== undefined) ||
      (input.positiveLabel !== null && input.positiveLabel !== undefined) ||
      (input.negativeLabel !== null && input.negativeLabel !== undefined)
    ) {
      invalid("Agent-per-request profiles cannot include a fixed criterion or answer labels.");
    }
    criterion = null;
    positiveLabel = null;
    negativeLabel = null;
    resultSemantics = "feedback";
  }
  const rationaleMode = input.rationaleMode as ReviewRequestRationaleMode;
  const audience = input.audience as HumanReviewAudience;
  const contentBoundary = input.contentBoundary as HumanReviewContentBoundary;
  const compensationMode = input.compensationMode as HumanReviewCompensationMode;
  if (!REVIEW_REQUEST_RATIONALE_MODES.includes(rationaleMode)) invalid("rationaleMode is invalid.");
  if (!HUMAN_REVIEW_AUDIENCES.includes(audience)) invalid("audience is invalid.");
  if (!HUMAN_REVIEW_CONTENT_BOUNDARIES.includes(contentBoundary)) invalid("contentBoundary is invalid.");
  if (!HUMAN_REVIEW_COMPENSATION_MODES.includes(compensationMode)) invalid("compensationMode is invalid.");

  const responseWindowSeconds = boundedInteger(
    input.responseWindowSeconds,
    "responseWindowSeconds",
    MINIMUM_REVIEW_RESPONSE_WINDOW_SECONDS,
    MAXIMUM_REVIEW_RESPONSE_WINDOW_SECONDS,
  );
  const panelSize = boundedInteger(input.panelSize, "panelSize", MINIMUM_REVIEW_PANEL_SIZE, MAXIMUM_REVIEW_PANEL_SIZE);

  const privateSensitivity = optionalText(input.privateSensitivity, "privateSensitivity", 32);
  if (
    privateSensitivity !== null &&
    !REVIEW_REQUEST_PRIVATE_SENSITIVITIES.includes(privateSensitivity as ReviewRequestPrivateSensitivity)
  ) {
    invalid("privateSensitivity is invalid.");
  }
  if (contentBoundary === "private_workspace") {
    if (audience !== "private_invited") {
      invalid("Private workspace material can be sent only to invited reviewers.");
    }
    if (privateSensitivity === null) invalid("privateSensitivity is required for private workspace material.");
  } else if (privateSensitivity !== null) {
    invalid("privateSensitivity must be omitted for public or test material.");
  }
  if (
    questionAuthority === "agent_per_request" &&
    (audience !== "public_network" || contentBoundary !== "public_or_test")
  ) {
    invalid("Agent-written questions currently require public-safe RateLoop-network review.");
  }

  const privateGroupId = optionalText(input.privateGroupId, "privateGroupId", 160);
  const privateGroupPolicyVersion =
    input.privateGroupPolicyVersion === null || input.privateGroupPolicyVersion === undefined
      ? null
      : boundedInteger(input.privateGroupPolicyVersion, "privateGroupPolicyVersion", 1, 2_147_483_647);
  const privateGroupPolicyHash = optionalText(input.privateGroupPolicyHash, "privateGroupPolicyHash", 71);
  const groupValues = [privateGroupId, privateGroupPolicyVersion, privateGroupPolicyHash];
  if (groupValues.some(entry => entry === null) && groupValues.some(entry => entry !== null)) {
    invalid("The private-group ID, policy version, and policy hash must be supplied together.");
  }
  if (privateGroupPolicyHash !== null && !HASH_PATTERN.test(privateGroupPolicyHash)) {
    invalid("privateGroupPolicyHash is invalid.");
  }
  if (audience === "public_network" && privateGroupId !== null) {
    invalid("Public-network review cannot bind a private reviewer group.");
  }
  if ((audience === "private_invited" || audience === "hybrid") && privateGroupId === null) {
    invalid("This review audience requires an exact private-group policy binding.");
  }

  const requiredExpertiseKeys = normalizeReviewerExpertiseKeys(input.requiredExpertiseKeys ?? []);
  let expertiseRequirements: ReviewerExpertiseRequirement[];
  try {
    expertiseRequirements = normalizeReviewerExpertiseRequirementsSelection(
      input.expertiseRequirements ?? [],
      panelSize,
    );
  } catch (error) {
    invalid(error instanceof Error ? error.message : "Specialist requirements are invalid.");
  }
  if (requiredExpertiseKeys.length > 0 && expertiseRequirements.length > 0) {
    invalid("Legacy all-seat expertise and exact specialist requirements cannot be used together.");
  }
  if (expertiseRequirements.length > 0) {
    if (audience === "hybrid") {
      invalid("Hybrid specialist requirements need separately frozen invited and network seat classes.");
    }
    if (
      audience === "private_invited" &&
      expertiseRequirements.some(requirement => requirement.sourceScope !== "customer_invited")
    ) {
      invalid("Private specialist requirements must use invited reviewers.");
    }
    if (
      audience === "public_network" &&
      expertiseRequirements.some(
        requirement => requirement.sourceScope !== "rateloop_network" || requirement.minimumSeats !== panelSize,
      )
    ) {
      invalid("Public-network specialist requirements must apply to every network reviewer.");
    }
  }
  const semanticSchemaVersion: ReviewRequestProfileSemanticSchemaVersion =
    expertiseRequirements.length > 0 ? 3 : questionAuthority === "owner_fixed" ? 1 : 2;

  if ((audience === "public_network" || audience === "hybrid") && panelSize < 3) {
    invalid("Public-network and hybrid review require a panel size of at least 3.");
  }
  if (audience !== "private_invited" && compensationMode !== "usdc") {
    invalid("Public-network and hybrid review must be paid with a guaranteed USDC bounty.");
  }
  let bountyPerSeatAtomic: string | null = null;
  if (compensationMode === "unpaid") {
    if (input.bountyPerSeatAtomic !== null && input.bountyPerSeatAtomic !== undefined) {
      invalid("Unpaid review cannot include a per-seat bounty.");
    }
  } else {
    bountyPerSeatAtomic = normalizeAtomic(input.bountyPerSeatAtomic, panelSize);
  }

  const feedbackBonusEnabled = input.feedbackBonusEnabled ?? false;
  if (typeof feedbackBonusEnabled !== "boolean") invalid("feedbackBonusEnabled must be a boolean.");
  const feedbackBonusAwarderKind = (input.feedbackBonusAwarderKind ?? "requester") as FeedbackBonusAwarderKind;
  if (!(feedbackBonusAwarderKind === "requester" || feedbackBonusAwarderKind === "designated")) {
    invalid("feedbackBonusAwarderKind is invalid.");
  }
  const feedbackBonusAwarderAccount = optionalText(
    input.feedbackBonusAwarderAccount,
    "feedbackBonusAwarderAccount",
    320,
  );
  if (
    (feedbackBonusAwarderKind === "requester" && feedbackBonusAwarderAccount !== null) ||
    (feedbackBonusAwarderKind === "designated" && feedbackBonusAwarderAccount === null)
  ) {
    invalid("Choose the requester or one designated authenticated human as the Feedback Bonus awarder.");
  }
  let feedbackBonusPoolAtomic: string | null = null;
  let feedbackBonusAwardWindowSeconds: number | null = null;
  if (feedbackBonusEnabled) {
    if (rationaleMode === "off") invalid("Feedback Bonus requires optional or required written feedback.");
    feedbackBonusPoolAtomic = normalizeAtomic(input.feedbackBonusPoolAtomic, 1);
    feedbackBonusAwardWindowSeconds = boundedInteger(
      input.feedbackBonusAwardWindowSeconds,
      "feedbackBonusAwardWindowSeconds",
      MINIMUM_FEEDBACK_BONUS_AWARD_WINDOW_SECONDS,
      MAXIMUM_FEEDBACK_BONUS_AWARD_WINDOW_SECONDS,
    );
  } else if (input.feedbackBonusPoolAtomic !== null && input.feedbackBonusPoolAtomic !== undefined) {
    invalid("A disabled Feedback Bonus cannot include a pool amount.");
  } else if (input.feedbackBonusAwardWindowSeconds !== null && input.feedbackBonusAwardWindowSeconds !== undefined) {
    invalid("A disabled Feedback Bonus cannot include an award window.");
  }

  return {
    agentId,
    agentVersionId,
    questionAuthority,
    resultSemantics,
    criterion,
    positiveLabel,
    negativeLabel,
    rationaleMode,
    audience,
    contentBoundary,
    privateSensitivity: privateSensitivity as ReviewRequestPrivateSensitivity | null,
    privateGroupId,
    privateGroupPolicyVersion,
    privateGroupPolicyHash,
    requiredExpertiseKeys,
    expertiseRequirements,
    semanticSchemaVersion,
    responseWindowSeconds,
    panelSize,
    compensationMode,
    bountyPerSeatAtomic,
    feedbackBonusEnabled,
    feedbackBonusPoolAtomic,
    feedbackBonusAwarderKind,
    feedbackBonusAwarderAccount,
    feedbackBonusAwardWindowSeconds,
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) invalid("Review request profile values must be JSON serializable.");
  return encoded;
}

export function reviewRequestProfileSemanticDocument(profile: NormalizedReviewRequestProfile) {
  const common = {
    agent: { agentId: profile.agentId, agentVersionId: profile.agentVersionId },
    audience: {
      audience: profile.audience,
      contentBoundary: profile.contentBoundary,
      privateSensitivity: profile.privateSensitivity,
      privateGroupPolicy:
        profile.privateGroupId === null
          ? null
          : {
              groupId: profile.privateGroupId,
              policyVersion: profile.privateGroupPolicyVersion,
              policyHash: profile.privateGroupPolicyHash,
            },
      requiredExpertiseKeys: profile.requiredExpertiseKeys.length ? profile.requiredExpertiseKeys : undefined,
    },
    responseWindowSeconds: profile.responseWindowSeconds,
    panelSize: profile.panelSize,
    economics: {
      compensationMode: profile.compensationMode,
      currency: profile.compensationMode === "usdc" ? ("USDC" as const) : null,
      bountyPerSeatAtomic: profile.bountyPerSeatAtomic,
      feedbackBonus: {
        enabled: profile.feedbackBonusEnabled,
        currency: profile.feedbackBonusEnabled ? ("USDC" as const) : null,
        poolAtomic: profile.feedbackBonusPoolAtomic,
        awarder: {
          kind: profile.feedbackBonusAwarderKind,
          account: profile.feedbackBonusAwarderAccount,
        },
        awardWindowSeconds: profile.feedbackBonusAwardWindowSeconds,
      },
    },
  };
  if (profile.semanticSchemaVersion === 3) {
    return {
      schemaVersion: "rateloop.review-request-profile.v3" as const,
      agent: common.agent,
      question:
        profile.questionAuthority === "owner_fixed"
          ? {
              authority: "owner_fixed" as const,
              kind: "binary" as const,
              criterion: profile.criterion,
              positiveLabel: profile.positiveLabel,
              negativeLabel: profile.negativeLabel,
              rationaleMode: profile.rationaleMode,
              resultSemantics: "assurance" as const,
            }
          : {
              authority: "agent_per_request" as const,
              kind: "binary" as const,
              maximumPromptLength: 500,
              maximumLabelLength: 40,
              rationaleMode: profile.rationaleMode,
              resultSemantics: "feedback" as const,
            },
      audience: {
        audience: profile.audience,
        contentBoundary: profile.contentBoundary,
        privateSensitivity: profile.privateSensitivity,
        privateGroupPolicy:
          profile.privateGroupId === null
            ? null
            : {
                groupId: profile.privateGroupId,
                policyVersion: profile.privateGroupPolicyVersion,
                policyHash: profile.privateGroupPolicyHash,
              },
        expertiseRequirements: profile.expertiseRequirements.map(requirement => ({
          definitionId: requirement.definitionId,
          definitionVersion: requirement.definitionVersion,
          definitionHash: requirement.definitionHash,
          minimumSeats: requirement.minimumSeats,
          sourceScope: requirement.sourceScope,
        })),
      },
      responseWindowSeconds: common.responseWindowSeconds,
      panelSize: common.panelSize,
      economics: common.economics,
    };
  }
  if (profile.questionAuthority === "owner_fixed") {
    return {
      schemaVersion: "rateloop.review-request-profile.v1" as const,
      agent: common.agent,
      question: {
        criterion: profile.criterion,
        positiveLabel: profile.positiveLabel,
        negativeLabel: profile.negativeLabel,
        rationaleMode: profile.rationaleMode,
      },
      audience: common.audience,
      responseWindowSeconds: common.responseWindowSeconds,
      panelSize: common.panelSize,
      economics: common.economics,
    };
  }
  return {
    schemaVersion: "rateloop.review-request-profile.v2" as const,
    agent: common.agent,
    questionPolicy: {
      authority: "agent_per_request" as const,
      kind: "binary" as const,
      maximumPromptLength: 500,
      maximumLabelLength: 40,
      rationaleMode: profile.rationaleMode,
      resultSemantics: "feedback" as const,
    },
    audience: common.audience,
    responseWindowSeconds: common.responseWindowSeconds,
    panelSize: common.panelSize,
    economics: common.economics,
  };
}

export function hashReviewRequestProfile(input: ReviewRequestProfileInput | NormalizedReviewRequestProfile) {
  const keys = Object.keys(input);
  const hasOnlyProfileKeys = keys.every(
    key => INPUT_KEYS.has(key as keyof ReviewRequestProfileInput) || NON_SEMANTIC_PROFILE_KEYS.has(key),
  );
  const profile = normalizeReviewRequestProfileInput(
    hasOnlyProfileKeys
      ? Object.fromEntries(
          Object.entries(input).filter(([key]) => INPUT_KEYS.has(key as keyof ReviewRequestProfileInput)),
        )
      : input,
  );
  return `sha256:${createHash("sha256")
    .update(canonicalJson(reviewRequestProfileSemanticDocument(profile)))
    .digest("hex")}`;
}

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowInteger(row: QueryRow | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Database returned an invalid ${key}.`);
  return value;
}

function iso(value: unknown, field: string) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error(`Database returned an invalid ${field}.`);
  return date.toISOString();
}

function profileFromRow(row: QueryRow): ReviewRequestProfile {
  const profileId = rowString(row, "profile_id");
  const workspaceId = rowString(row, "workspace_id");
  const agentId = rowString(row, "agent_id");
  const agentVersionId = rowString(row, "agent_version_id");
  const questionAuthority = rowString(row, "question_authority") as ReviewRequestQuestionAuthority | null;
  const resultSemantics = rowString(row, "result_semantics") as ReviewRequestResultSemantics | null;
  const criterion = rowString(row, "criterion");
  const positiveLabel = rowString(row, "positive_label");
  const negativeLabel = rowString(row, "negative_label");
  const rationaleMode = rowString(row, "rationale_mode") as ReviewRequestRationaleMode | null;
  const audience = rowString(row, "audience") as HumanReviewAudience | null;
  const contentBoundary = rowString(row, "content_boundary") as HumanReviewContentBoundary | null;
  const compensationMode = rowString(row, "compensation_mode") as HumanReviewCompensationMode | null;
  const feedbackBonusEnabled = row.feedback_bonus_enabled === true || row.feedback_bonus_enabled === "t";
  const feedbackBonusAwarderKind = rowString(row, "feedback_bonus_awarder_kind") as FeedbackBonusAwarderKind | null;
  const feedbackBonusPoolAtomic = rowString(row, "feedback_bonus_pool_atomic");
  const feedbackBonusAwarderAccount = rowString(row, "feedback_bonus_awarder_account");
  const feedbackBonusAwardWindowSeconds =
    row.feedback_bonus_award_window_seconds === null || row.feedback_bonus_award_window_seconds === undefined
      ? null
      : rowInteger(row, "feedback_bonus_award_window_seconds");
  const configurationStatus = rowString(row, "configuration_status") as ReviewRequestProfile["configurationStatus"];
  const profileHash = rowString(row, "profile_hash");
  const createdBy = rowString(row, "created_by");
  const responseWindowSeconds =
    row.response_window_seconds === null || row.response_window_seconds === undefined
      ? null
      : rowInteger(row, "response_window_seconds");
  const panelSize = row.panel_size === null || row.panel_size === undefined ? null : rowInteger(row, "panel_size");
  const semanticSchemaVersion = rowInteger(row, "semantic_schema_version") as ReviewRequestProfileSemanticSchemaVersion;
  let requiredExpertiseKeys: ReviewerExpertiseKey[];
  let expertiseRequirements: ReviewerExpertiseRequirement[];
  try {
    requiredExpertiseKeys = normalizeReviewerExpertiseKeys(
      JSON.parse(rowString(row, "required_expertise_keys_json") ?? "[]"),
    );
    expertiseRequirements = normalizeReviewerExpertiseRequirementsSelection(
      JSON.parse(rowString(row, "expertise_requirements_json") ?? "[]"),
      panelSize ?? MAXIMUM_REVIEW_PANEL_SIZE,
    );
  } catch (error) {
    if (error instanceof TokenlessServiceError) throw new Error("Database returned invalid reviewer expertise.");
    throw error;
  }
  if (
    !profileId ||
    !workspaceId ||
    !agentId ||
    !agentVersionId ||
    !questionAuthority ||
    !resultSemantics ||
    !rationaleMode ||
    !audience ||
    !contentBoundary ||
    !compensationMode ||
    !configurationStatus ||
    !profileHash ||
    !createdBy ||
    ![1, 2, 3].includes(semanticSchemaVersion) ||
    !REVIEW_REQUEST_QUESTION_AUTHORITIES.includes(questionAuthority) ||
    !REVIEW_REQUEST_RESULT_SEMANTICS.includes(resultSemantics) ||
    (questionAuthority === "owner_fixed" &&
      (resultSemantics !== "assurance" || !criterion || !positiveLabel || !negativeLabel)) ||
    (questionAuthority === "agent_per_request" &&
      (resultSemantics !== "feedback" || criterion !== null || positiveLabel !== null || negativeLabel !== null)) ||
    !REVIEW_REQUEST_RATIONALE_MODES.includes(rationaleMode) ||
    !HUMAN_REVIEW_AUDIENCES.includes(audience) ||
    !HUMAN_REVIEW_CONTENT_BOUNDARIES.includes(contentBoundary) ||
    !HUMAN_REVIEW_COMPENSATION_MODES.includes(compensationMode) ||
    !feedbackBonusAwarderKind ||
    !(feedbackBonusAwarderKind === "requester" || feedbackBonusAwarderKind === "designated") ||
    (feedbackBonusAwarderKind === "requester") !== (feedbackBonusAwarderAccount === null) ||
    (feedbackBonusEnabled && (feedbackBonusPoolAtomic === null || feedbackBonusAwardWindowSeconds === null)) ||
    (!feedbackBonusEnabled && (feedbackBonusPoolAtomic !== null || feedbackBonusAwardWindowSeconds !== null)) ||
    !["ready", "action_required"].includes(configurationStatus) ||
    !HASH_PATTERN.test(profileHash) ||
    (semanticSchemaVersion === 1 && questionAuthority !== "owner_fixed") ||
    (semanticSchemaVersion === 2 && questionAuthority !== "agent_per_request") ||
    (semanticSchemaVersion === 3 && expertiseRequirements.length === 0) ||
    (semanticSchemaVersion !== 3 && expertiseRequirements.length > 0) ||
    (semanticSchemaVersion === 3 && requiredExpertiseKeys.length > 0) ||
    (configurationStatus === "ready" && (responseWindowSeconds === null || panelSize === null))
  ) {
    throw new Error("Database returned an invalid review request profile.");
  }
  return {
    profileId,
    version: rowInteger(row, "version"),
    workspaceId,
    agentId,
    agentVersionId,
    questionAuthority,
    resultSemantics,
    criterion,
    positiveLabel,
    negativeLabel,
    rationaleMode,
    audience,
    contentBoundary,
    privateSensitivity: rowString(row, "private_sensitivity") as ReviewRequestPrivateSensitivity | null,
    privateGroupId: rowString(row, "private_group_id"),
    privateGroupPolicyVersion:
      row.private_group_policy_version === null || row.private_group_policy_version === undefined
        ? null
        : rowInteger(row, "private_group_policy_version"),
    privateGroupPolicyHash: rowString(row, "private_group_policy_hash"),
    requiredExpertiseKeys,
    expertiseRequirements,
    semanticSchemaVersion,
    responseWindowSeconds,
    panelSize,
    compensationMode,
    bountyPerSeatAtomic: rowString(row, "bounty_per_seat_atomic"),
    feedbackBonusEnabled,
    feedbackBonusPoolAtomic,
    feedbackBonusAwarderKind,
    feedbackBonusAwarderAccount,
    feedbackBonusAwardWindowSeconds,
    configurationStatus,
    profileHash,
    createdBy,
    createdAt: iso(row.created_at, "profile creation timestamp"),
    approvedBy: rowString(row, "approved_by"),
    approvedAt: row.approved_at ? iso(row.approved_at, "profile approval timestamp") : null,
    supersededAt: row.superseded_at ? iso(row.superseded_at, "profile supersession timestamp") : null,
  };
}

async function requireManagement(accountAddress: string, workspaceId: string) {
  let actor: string;
  try {
    actor = normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("Account address is invalid.", 400, "invalid_account");
  }
  const result = await dbClient.execute({
    sql: `SELECT m.role FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
          WHERE m.workspace_id = ? AND m.account_address = ? AND w.status = 'active'
            AND m.role IN ('owner', 'admin') LIMIT 1`,
    args: [workspaceId, actor],
  });
  if (result.rowCount !== 1) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return actor;
}

async function validateBindings(client: PoolClient, workspaceId: string, profile: NormalizedReviewRequestProfile) {
  const agent = await client.query(
    `SELECT 1 FROM tokenless_agents a
     JOIN tokenless_agent_versions v
       ON v.workspace_id = a.workspace_id AND v.agent_id = a.agent_id
     WHERE a.workspace_id = $1 AND a.agent_id = $2 AND a.status = 'active' AND v.version_id = $3
     FOR UPDATE`,
    [workspaceId, profile.agentId, profile.agentVersionId],
  );
  if (agent.rowCount !== 1) {
    throw new TokenlessServiceError("Active agent version not found.", 404, "agent_version_not_found");
  }
  if (profile.privateGroupId === null) return;
  const group = await client.query(
    `SELECT p.max_private_sensitivity FROM tokenless_private_groups g
     JOIN tokenless_private_group_policy_versions p
       ON p.group_id = g.group_id AND p.version = g.current_policy_version
     WHERE g.workspace_id = $1 AND g.group_id = $2 AND g.status = 'active'
       AND p.version = $3 AND p.policy_hash = $4
     FOR SHARE`,
    [workspaceId, profile.privateGroupId, profile.privateGroupPolicyVersion, profile.privateGroupPolicyHash],
  );
  if (group.rowCount !== 1) {
    throw new TokenlessServiceError(
      "The active private-group policy binding was not found in this workspace.",
      404,
      "private_group_policy_not_found",
    );
  }
  if (profile.privateSensitivity !== null) {
    const maximumSensitivity = rowString(group.rows[0] as QueryRow, "max_private_sensitivity");
    const maximumRank = PRIVATE_SENSITIVITY_RANK.get(maximumSensitivity as ReviewRequestPrivateSensitivity);
    const requestedRank = PRIVATE_SENSITIVITY_RANK.get(profile.privateSensitivity);
    if (maximumRank === undefined || requestedRank === undefined) {
      throw new TokenlessServiceError(
        "The private-group sensitivity policy is invalid.",
        500,
        "private_group_policy_invalid",
      );
    }
    if (requestedRank > maximumRank) {
      throw new TokenlessServiceError(
        "The private reviewer group does not permit material at the requested sensitivity.",
        400,
        "private_group_sensitivity_exceeded",
      );
    }
  }
}

const PROFILE_COLUMNS = `profile_id, version, workspace_id, agent_id, agent_version_id,
  question_authority, result_semantics, criterion, positive_label, negative_label,
  rationale_mode, audience, content_boundary, private_sensitivity, private_group_id,
  private_group_policy_version, private_group_policy_hash, response_window_seconds, panel_size,
  semantic_schema_version, required_expertise_keys_json, expertise_requirements_json,
  compensation_mode, bounty_per_seat_atomic, feedback_bonus_enabled, feedback_bonus_pool_atomic,
  feedback_bonus_awarder_kind, feedback_bonus_awarder_account, feedback_bonus_award_window_seconds,
  configuration_status, profile_hash, created_by,
  created_at, approved_by, approved_at, superseded_at`;

async function loadProfile(workspaceId: string, profileId: string, version?: number) {
  const result = await dbClient.execute({
    sql: `SELECT ${PROFILE_COLUMNS} FROM tokenless_agent_review_request_profiles
          WHERE workspace_id = ? AND profile_id = ? ${version === undefined ? "AND superseded_at IS NULL" : "AND version = ?"}
          LIMIT 1`,
    args: version === undefined ? [workspaceId, profileId] : [workspaceId, profileId, version],
  });
  return result.rows[0] ? profileFromRow(result.rows[0] as QueryRow) : null;
}

function insertValues(
  profileId: string,
  version: number,
  workspaceId: string,
  profile: NormalizedReviewRequestProfile,
  profileHash: string,
  actor: string,
  now: Date,
) {
  return [
    profileId,
    version,
    workspaceId,
    profile.agentId,
    profile.agentVersionId,
    profile.questionAuthority,
    profile.resultSemantics,
    profile.criterion,
    profile.positiveLabel,
    profile.negativeLabel,
    profile.rationaleMode,
    profile.audience,
    profile.contentBoundary,
    profile.privateSensitivity,
    profile.privateGroupId,
    profile.privateGroupPolicyVersion,
    profile.privateGroupPolicyHash,
    profile.semanticSchemaVersion,
    JSON.stringify(profile.requiredExpertiseKeys),
    JSON.stringify(profile.expertiseRequirements),
    profile.responseWindowSeconds,
    profile.panelSize,
    profile.compensationMode,
    profile.bountyPerSeatAtomic,
    profile.feedbackBonusEnabled,
    profile.feedbackBonusPoolAtomic,
    profile.feedbackBonusAwarderKind,
    profile.feedbackBonusAwarderAccount,
    profile.feedbackBonusAwardWindowSeconds,
    profileHash,
    actor,
    now,
  ];
}

const INSERT_PROFILE = `INSERT INTO tokenless_agent_review_request_profiles
  (profile_id, version, workspace_id, agent_id, agent_version_id, question_authority, result_semantics,
   criterion, positive_label, negative_label,
   rationale_mode, audience, content_boundary, private_sensitivity, private_group_id,
   private_group_policy_version, private_group_policy_hash, semantic_schema_version,
   required_expertise_keys_json, expertise_requirements_json,
   response_window_seconds, panel_size,
   compensation_mode, bounty_per_seat_atomic, feedback_bonus_enabled, feedback_bonus_pool_atomic,
   feedback_bonus_awarder_kind, feedback_bonus_awarder_account, feedback_bonus_award_window_seconds,
   configuration_status, profile_hash, created_by,
   created_at, approved_by, approved_at, superseded_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,'ready',$30,$31,$32,$31,$32,NULL)`;

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

export async function createReviewRequestProfile(input: {
  accountAddress: string;
  workspaceId: string;
  profile: unknown;
}) {
  const actor = await requireManagement(input.accountAddress, input.workspaceId);
  const profile = normalizeReviewRequestProfileInput(input.profile);
  const profileId = `rrp_${randomUUID().replaceAll("-", "")}`;
  const profileHash = hashReviewRequestProfile(profile);
  const now = new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await validateBindings(client, input.workspaceId, profile);
    await validateReviewerExpertiseRequirementsWithClient(client, {
      workspaceId: input.workspaceId,
      audience: profile.audience,
      panelSize: profile.panelSize,
      requirements: profile.expertiseRequirements,
    });
    const duplicate = await client.query(
      `SELECT 1 FROM tokenless_agent_review_request_profiles
       WHERE workspace_id = $1 AND agent_id = $2 AND agent_version_id = $3 AND superseded_at IS NULL`,
      [input.workspaceId, profile.agentId, profile.agentVersionId],
    );
    if (duplicate.rowCount) {
      throw new TokenlessServiceError(
        "This agent version already has an active review request profile. Edit that profile instead.",
        409,
        "review_request_profile_exists",
      );
    }
    await client.query(INSERT_PROFILE, insertValues(profileId, 1, input.workspaceId, profile, profileHash, actor, now));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (isUniqueViolation(error)) {
      throw new TokenlessServiceError(
        "This exact review request profile already exists in the workspace.",
        409,
        "review_request_profile_exists",
      );
    }
    throw error;
  } finally {
    client.release();
  }
  const created = await loadProfile(input.workspaceId, profileId, 1);
  if (!created) throw new Error("Created review request profile could not be loaded.");
  return created;
}

export async function updateReviewRequestProfile(input: {
  accountAddress: string;
  workspaceId: string;
  profileId: string;
  profile: unknown;
}) {
  const actor = await requireManagement(input.accountAddress, input.workspaceId);
  const profile = normalizeReviewRequestProfileInput(input.profile);
  const profileHash = hashReviewRequestProfile(profile);
  const now = new Date();
  const client = await dbPool.connect();
  let nextVersion = 0;
  try {
    await client.query("BEGIN");
    await validateBindings(client, input.workspaceId, profile);
    await validateReviewerExpertiseRequirementsWithClient(client, {
      workspaceId: input.workspaceId,
      audience: profile.audience,
      panelSize: profile.panelSize,
      requirements: profile.expertiseRequirements,
    });
    const current = await client.query(
      `SELECT version, agent_id, profile_hash FROM tokenless_agent_review_request_profiles
       WHERE workspace_id = $1 AND profile_id = $2 AND superseded_at IS NULL FOR UPDATE`,
      [input.workspaceId, input.profileId],
    );
    if (current.rowCount !== 1) {
      throw new TokenlessServiceError("Review request profile not found.", 404, "review_request_profile_not_found");
    }
    const currentRow = current.rows[0] as QueryRow;
    if (rowString(currentRow, "agent_id") !== profile.agentId) {
      throw new TokenlessServiceError(
        "A review request profile cannot be moved to a different agent.",
        409,
        "review_request_profile_agent_mismatch",
      );
    }
    const activeBinding = await client.query(
      `SELECT 1 FROM tokenless_agent_human_review_bindings
       WHERE workspace_id = $1 AND request_profile_id = $2 AND request_profile_version = $3
         AND enabled = true AND superseded_at IS NULL FOR SHARE`,
      [input.workspaceId, input.profileId, rowInteger(currentRow, "version")],
    );
    if (activeBinding.rowCount) {
      throw new TokenlessServiceError(
        "Update this profile through the human-review configuration so its exact bindings stay atomic.",
        409,
        "human_review_configuration_required",
      );
    }
    if (rowString(currentRow, "profile_hash") === profileHash) {
      throw new TokenlessServiceError(
        "The review request profile has no semantic changes.",
        409,
        "review_request_profile_unchanged",
      );
    }
    const duplicate = await client.query(
      `SELECT 1 FROM tokenless_agent_review_request_profiles
       WHERE workspace_id = $1 AND agent_id = $2 AND agent_version_id = $3
         AND profile_id <> $4 AND superseded_at IS NULL`,
      [input.workspaceId, profile.agentId, profile.agentVersionId, input.profileId],
    );
    if (duplicate.rowCount) {
      throw new TokenlessServiceError(
        "This agent version already has an active review request profile.",
        409,
        "review_request_profile_exists",
      );
    }
    nextVersion = rowInteger(currentRow, "version") + 1;
    const superseded = await client.query(
      `UPDATE tokenless_agent_review_request_profiles SET superseded_at = $1
       WHERE workspace_id = $2 AND profile_id = $3 AND version = $4 AND superseded_at IS NULL`,
      [now, input.workspaceId, input.profileId, nextVersion - 1],
    );
    if (superseded.rowCount !== 1) {
      throw new TokenlessServiceError("Review request profile not found.", 404, "review_request_profile_not_found");
    }
    await client.query(
      INSERT_PROFILE,
      insertValues(input.profileId, nextVersion, input.workspaceId, profile, profileHash, actor, now),
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (isUniqueViolation(error)) {
      throw new TokenlessServiceError(
        "This exact review request profile already exists in the workspace.",
        409,
        "review_request_profile_exists",
      );
    }
    throw error;
  } finally {
    client.release();
  }
  const updated = await loadProfile(input.workspaceId, input.profileId, nextVersion);
  if (!updated) throw new Error("Updated review request profile could not be loaded.");
  return updated;
}

export async function listReviewRequestProfiles(input: {
  accountAddress: string;
  workspaceId: string;
  includeHistory?: boolean;
}) {
  await requireManagement(input.accountAddress, input.workspaceId);
  const result = await dbClient.execute({
    sql: `SELECT ${PROFILE_COLUMNS} FROM tokenless_agent_review_request_profiles
          WHERE workspace_id = ? ${input.includeHistory ? "" : "AND superseded_at IS NULL"}
          ORDER BY created_at DESC, profile_id ASC, version DESC`,
    args: [input.workspaceId],
  });
  return result.rows.map(row => profileFromRow(row as QueryRow));
}

export const __reviewRequestProfileTestUtils = {
  canonicalJson,
  normalizeReviewRequestProfileInput,
  reviewRequestProfileSemanticDocument,
};
