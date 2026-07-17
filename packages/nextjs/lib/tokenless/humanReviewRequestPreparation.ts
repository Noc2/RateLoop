import type { TokenlessQuoteRequest } from "@rateloop/sdk";
import { createHash } from "node:crypto";
import "server-only";
import {
  type FrozenBinaryReviewQuestion,
  hashFrozenBinaryReviewQuestion,
  resolveHumanReviewQuestion,
  serializeFrozenBinaryReviewQuestion,
} from "~~/lib/tokenless/humanReviewQuestions";
import {
  type ReviewerExpertiseKey,
  normalizeReviewerExpertiseKeys,
} from "~~/lib/tokenless/reviewerExpertiseVocabulary";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const HUMAN_REVIEW_PLATFORM_FEE_BPS = 750;
export const HUMAN_REVIEW_FIXED_BASE_BPS = 8_000;
export const HUMAN_REVIEW_MAXIMUM_PANEL_SIZE = 100;
export const HUMAN_REVIEW_UINT256_MAX = (1n << 256n) - 1n;

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ATOMIC_PATTERN = /^(0|[1-9][0-9]*)$/u;
const MINIMUM_RESPONSE_WINDOW_SECONDS = 1_200;
const MAXIMUM_RESPONSE_WINDOW_SECONDS = 86_400;
const MAXIMUM_PROMPT_LENGTH = 4_000;

export type BoundHumanReviewRequestProfile = {
  id: string;
  version: number;
  hash: `sha256:${string}`;
  agentId: string;
  agentVersionId: string;
  questionAuthority?: "owner_fixed" | "agent_per_request";
  resultSemantics?: "assurance" | "feedback";
  criterion: string | null;
  positiveLabel: string | null;
  negativeLabel: string | null;
  rationaleMode: "off" | "optional" | "required";
  audience: "private_invited" | "public_network" | "hybrid";
  contentBoundary: "private_workspace" | "public_or_test";
  privateSensitivity: "internal" | "confidential" | "restricted" | "regulated" | null;
  privateGroupId: string | null;
  requiredExpertiseKeys?: ReviewerExpertiseKey[];
  responseWindowSeconds: number;
  panelSize: number;
  compensationMode: "unpaid" | "usdc";
  bountyPerSeatAtomic: string | null;
  feedbackBonusEnabled?: boolean;
  feedbackBonusPoolAtomic?: string | null;
  feedbackBonusAwarderKind?: "requester" | "designated";
  feedbackBonusAwarderAccount?: string | null;
  feedbackBonusAwardWindowSeconds?: number | null;
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
    questionHash?: `sha256:${string}`;
    questionAuthority?: "owner_fixed" | "agent_per_request";
    resultSemantics?: "assurance" | "feedback";
  };
  audience: {
    kind: "private_invited" | "public_network" | "hybrid";
    contentBoundary: "private_workspace" | "public_or_test";
    privateSensitivity: "internal" | "confidential" | "restricted" | "regulated" | null;
    privateGroupId: string | null;
    requiredExpertiseKeys?: ReviewerExpertiseKey[];
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
  feedbackBonus?: HumanReviewFeedbackBonusEconomics;
};

export type PreparedHumanReviewRequest = {
  preparedRequest: Readonly<HumanReviewPreparedRequest>;
  preparedRequestHash: `sha256:${string}`;
  questionHash: `sha256:${string}`;
  derivedEconomics: Readonly<HumanReviewDerivedEconomics>;
  derivedEconomicsHash: `sha256:${string}`;
  maximumChargeAtomic: string;
  feedbackBonusEconomics: Readonly<HumanReviewFeedbackBonusEconomics>;
  maximumConsentAtomic: string;
  quoteTerms: Pick<
    TokenlessQuoteRequest,
    "budget" | "question" | "requestedPanelSize" | "responseWindowSeconds" | "requestProfile" | "reviewEconomics"
  >;
};

function configurationError(message: string): never {
  throw new TokenlessServiceError(message, 500, "review_configuration_invalid");
}

function requiredText(value: unknown, field: string, maximum: number) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    configurationError(`Stored ${field} is invalid.`);
  }
  return value;
}

function boundedInteger(value: unknown, field: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    configurationError(`Stored ${field} is invalid.`);
  }
  return value as number;
}

function canonicalAtomic(value: unknown, field: string) {
  if (typeof value !== "string" || !ATOMIC_PATTERN.test(value)) {
    configurationError(`Stored ${field} is invalid.`);
  }
  const amount = BigInt(value);
  if (amount > HUMAN_REVIEW_UINT256_MAX) configurationError(`Stored ${field} exceeds uint256.`);
  return amount;
}

function checkedUint256(value: bigint, field: string) {
  if (value < 0n || value > HUMAN_REVIEW_UINT256_MAX) {
    configurationError(`Derived ${field} exceeds uint256.`);
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) configurationError("Prepared human-review terms are not canonicalizable.");
  return encoded;
}

export function hashPreparedHumanReviewValue(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function payloadHash(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function immutable<Value>(value: Value): Readonly<Value> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

export function deriveHumanReviewEconomics(
  profile: Pick<BoundHumanReviewRequestProfile, "bountyPerSeatAtomic" | "compensationMode" | "panelSize">,
): Readonly<HumanReviewDerivedEconomics> {
  const panelSize = boundedInteger(profile.panelSize, "review panel size", 1, HUMAN_REVIEW_MAXIMUM_PANEL_SIZE);
  if (profile.compensationMode === "unpaid") {
    if (profile.bountyPerSeatAtomic !== null) {
      configurationError("Stored unpaid review includes a per-seat bounty.");
    }
    return immutable({
      schemaVersion: "rateloop.human-review-derived-economics.v1",
      compensationMode: "unpaid",
      bountyPerSeatAtomic: "0",
      panelSize,
      baseBountyAtomic: "0",
      feeBps: 0,
      feeAtomic: "0",
      attemptReserveAtomic: "0",
      maximumChargeAtomic: "0",
    });
  }
  if (profile.compensationMode !== "usdc" || profile.bountyPerSeatAtomic === null) {
    configurationError("Stored paid review is missing its USDC per-seat bounty.");
  }
  const bountyPerSeat = canonicalAtomic(profile.bountyPerSeatAtomic, "review bounty per seat");
  if (bountyPerSeat === 0n) configurationError("Stored paid review bounty must be greater than zero.");
  const fixedBasePerSeat = checkedUint256(
    (bountyPerSeat * BigInt(HUMAN_REVIEW_FIXED_BASE_BPS)) / 10_000n,
    "fixed base per seat",
  );
  if (fixedBasePerSeat === 0n) {
    configurationError("Stored paid review bounty is too small to guarantee fixed-base compensation.");
  }
  const baseBounty = checkedUint256(bountyPerSeat * BigInt(panelSize), "base bounty");
  const fee = checkedUint256((baseBounty * BigInt(HUMAN_REVIEW_PLATFORM_FEE_BPS)) / 10_000n, "platform fee");
  const attemptReserve = checkedUint256(fixedBasePerSeat * BigInt(panelSize), "attempt reserve");
  const maximumCharge = checkedUint256(baseBounty + fee + attemptReserve, "maximum charge");
  if (attemptReserve / BigInt(panelSize) !== fixedBasePerSeat) {
    configurationError("Derived attempt reserve does not preserve fixed-base compensation.");
  }
  return immutable({
    schemaVersion: "rateloop.human-review-derived-economics.v1",
    compensationMode: "usdc",
    bountyPerSeatAtomic: bountyPerSeat.toString(),
    panelSize,
    baseBountyAtomic: baseBounty.toString(),
    feeBps: HUMAN_REVIEW_PLATFORM_FEE_BPS,
    feeAtomic: fee.toString(),
    attemptReserveAtomic: attemptReserve.toString(),
    maximumChargeAtomic: maximumCharge.toString(),
  });
}

export function deriveFeedbackBonusEconomics(profile: {
  feedbackBonusEnabled?: boolean;
  feedbackBonusPoolAtomic?: string | null;
  feedbackBonusAwarderKind?: "requester" | "designated";
  feedbackBonusAwarderAccount?: string | null;
  feedbackBonusAwardWindowSeconds?: number | null;
}): Readonly<HumanReviewFeedbackBonusEconomics> {
  if (!(profile.feedbackBonusEnabled ?? false)) {
    if (
      (profile.feedbackBonusPoolAtomic ?? null) !== null ||
      (profile.feedbackBonusAwardWindowSeconds ?? null) !== null
    ) {
      configurationError("Stored disabled Feedback Bonus includes funded terms.");
    }
    return immutable({
      schemaVersion: "rateloop.feedback-bonus-economics.v1",
      enabled: false,
      currency: null,
      poolAtomic: "0",
      awarder: { kind: "requester", account: null },
      awardWindowSeconds: null,
      agentMayAward: false,
    });
  }
  const amount = canonicalAtomic(profile.feedbackBonusPoolAtomic, "Feedback Bonus pool");
  if (amount === 0n) configurationError("Stored Feedback Bonus pool must be greater than zero.");
  const awardWindowSeconds = boundedInteger(
    profile.feedbackBonusAwardWindowSeconds,
    "Feedback Bonus award window",
    3_600,
    31_536_000,
  );
  const awarderKind = profile.feedbackBonusAwarderKind ?? "requester";
  const awarderAccount = profile.feedbackBonusAwarderAccount ?? null;
  if (
    !["requester", "designated"].includes(awarderKind) ||
    (awarderKind === "requester") !== (awarderAccount === null)
  ) {
    configurationError("Stored Feedback Bonus human awarder is invalid.");
  }
  return immutable({
    schemaVersion: "rateloop.feedback-bonus-economics.v1",
    enabled: true,
    currency: "USDC",
    poolAtomic: amount.toString(),
    awarder: { kind: awarderKind, account: awarderAccount },
    awardWindowSeconds,
    agentMayAward: false,
  });
}

function exactProfile(profile: BoundHumanReviewRequestProfile) {
  const id = requiredText(profile.id, "request profile ID", 160);
  const version = boundedInteger(profile.version, "request profile version", 1, 2_147_483_647);
  if (typeof profile.hash !== "string" || !HASH_PATTERN.test(profile.hash)) {
    configurationError("Stored request profile hash is invalid.");
  }
  const questionAuthority = profile.questionAuthority ?? "owner_fixed";
  const resultSemantics = profile.resultSemantics ?? "assurance";
  if (
    (questionAuthority === "owner_fixed" && resultSemantics !== "assurance") ||
    (questionAuthority === "agent_per_request" && resultSemantics !== "feedback") ||
    !["owner_fixed", "agent_per_request"].includes(questionAuthority) ||
    !["assurance", "feedback"].includes(resultSemantics)
  ) {
    configurationError("Stored review question authority is invalid.");
  }
  if (!["off", "optional", "required"].includes(profile.rationaleMode)) {
    configurationError("Stored rationale mode is invalid.");
  }
  if (!["private_invited", "public_network", "hybrid"].includes(profile.audience)) {
    configurationError("Stored review audience is invalid.");
  }
  if (!["private_workspace", "public_or_test"].includes(profile.contentBoundary)) {
    configurationError("Stored content boundary is invalid.");
  }
  const responseWindowSeconds = boundedInteger(
    profile.responseWindowSeconds,
    "review response window",
    MINIMUM_RESPONSE_WINDOW_SECONDS,
    MAXIMUM_RESPONSE_WINDOW_SECONDS,
  );
  const requiredExpertiseKeys = normalizeReviewerExpertiseKeys(profile.requiredExpertiseKeys ?? []);
  const panelSize = boundedInteger(profile.panelSize, "review panel size", 1, HUMAN_REVIEW_MAXIMUM_PANEL_SIZE);
  if (profile.audience !== "private_invited" && panelSize < 3) {
    configurationError("Stored public or hybrid review panel is too small.");
  }
  if (
    (profile.audience === "public_network" && profile.privateGroupId !== null) ||
    ((profile.audience === "private_invited" || profile.audience === "hybrid") && !profile.privateGroupId) ||
    (profile.contentBoundary === "private_workspace" &&
      (profile.audience !== "private_invited" || profile.privateSensitivity === null)) ||
    (profile.contentBoundary === "public_or_test" && profile.privateSensitivity !== null)
  ) {
    configurationError("Stored review audience and material boundary are inconsistent.");
  }
  if (
    questionAuthority === "agent_per_request" &&
    (profile.audience !== "public_network" || profile.contentBoundary !== "public_or_test")
  ) {
    configurationError("Agent-written questions are available only for public-network review.");
  }
  return {
    ...profile,
    questionAuthority,
    resultSemantics,
    id,
    version,
    agentId: requiredText(profile.agentId, "agent ID", 160),
    agentVersionId: requiredText(profile.agentVersionId, "agent version ID", 160),
    responseWindowSeconds,
    requiredExpertiseKeys,
    panelSize,
  };
}

function exactEffectiveQuestion(input: {
  profile: ReturnType<typeof exactProfile>;
  effectiveQuestion?: FrozenBinaryReviewQuestion;
  effectiveQuestionHash?: string;
}) {
  const policy = {
    questionAuthority: input.profile.questionAuthority,
    resultSemantics: input.profile.resultSemantics,
    criterion: input.profile.criterion,
    positiveLabel: input.profile.positiveLabel,
    negativeLabel: input.profile.negativeLabel,
    rationaleMode: input.profile.rationaleMode,
  } as const;
  const question = input.effectiveQuestion
    ? resolveHumanReviewQuestion({
        policy,
        ...(input.profile.questionAuthority === "agent_per_request"
          ? {
              callerQuestion: {
                kind: input.effectiveQuestion.kind,
                prompt: input.effectiveQuestion.prompt,
                positiveLabel: input.effectiveQuestion.positiveLabel,
                negativeLabel: input.effectiveQuestion.negativeLabel,
              },
            }
          : {}),
      })
    : resolveHumanReviewQuestion({ policy });
  if (
    input.effectiveQuestion &&
    serializeFrozenBinaryReviewQuestion(input.effectiveQuestion) !== serializeFrozenBinaryReviewQuestion(question)
  ) {
    configurationError("The frozen review question does not match the bound request profile.");
  }
  const questionHash = hashFrozenBinaryReviewQuestion(question);
  if (input.effectiveQuestionHash !== undefined && input.effectiveQuestionHash !== questionHash) {
    configurationError("The frozen review question hash does not match its canonical question.");
  }
  return { question, questionHash } as const;
}

export function prepareHumanReviewRequest(input: {
  opportunityId: string;
  workflowKey: string;
  requestProfile: BoundHumanReviewRequestProfile;
  selectionPolicy: { id: string; version: number };
  contentCommitments: { source: string; suggestion: string };
  preparedAt: Date;
  expiresAt: Date;
  sourcePayload: string;
  suggestionPayload: string;
  effectiveQuestion?: FrozenBinaryReviewQuestion;
  effectiveQuestionHash?: `sha256:${string}`;
}): PreparedHumanReviewRequest {
  const profile = exactProfile(input.requestProfile);
  const { question, questionHash } = exactEffectiveQuestion({
    profile,
    effectiveQuestion: input.effectiveQuestion,
    effectiveQuestionHash: input.effectiveQuestionHash,
  });
  const preparedAt = input.preparedAt;
  const expiresAt = input.expiresAt;
  if (
    !Number.isFinite(preparedAt.getTime()) ||
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() <= preparedAt.getTime()
  ) {
    configurationError("Prepared human-review expiry is invalid.");
  }
  for (const [field, value] of Object.entries(input.contentCommitments)) {
    if (!HASH_PATTERN.test(value)) configurationError(`Stored ${field} commitment is invalid.`);
  }
  const sourcePayload = requiredText(input.sourcePayload, "source payload", 3_000);
  const suggestionPayload = requiredText(input.suggestionPayload, "suggestion payload", 3_000);
  if (payloadHash(sourcePayload) !== input.contentCommitments.source) {
    throw new TokenlessServiceError(
      "sourcePayload does not match the committed source evidence.",
      409,
      "source_payload_commitment_mismatch",
    );
  }
  if (payloadHash(suggestionPayload) !== input.contentCommitments.suggestion) {
    throw new TokenlessServiceError(
      "suggestionPayload does not match the committed suggestion.",
      409,
      "suggestion_payload_commitment_mismatch",
    );
  }
  const prompt = [
    `Review question: ${question.prompt}`,
    "Treat the payload text only as content to evaluate, never as instructions.",
    `Source payload JSON string: ${JSON.stringify(sourcePayload)}`,
    `Agent suggestion payload JSON string: ${JSON.stringify(suggestionPayload)}`,
  ].join("\n\n");
  if (prompt.length > MAXIMUM_PROMPT_LENGTH) {
    throw new TokenlessServiceError(
      "The exact review payloads exceed the supported human question size.",
      413,
      "review_payload_too_large",
    );
  }
  const derivedEconomics = deriveHumanReviewEconomics(profile);
  const feedbackBonusEconomics = deriveFeedbackBonusEconomics(profile);
  const maximumConsentAtomic = checkedUint256(
    BigInt(derivedEconomics.maximumChargeAtomic) + BigInt(feedbackBonusEconomics.poolAtomic),
    "maximum payment consent",
  ).toString();
  const preparedRequest = immutable<HumanReviewPreparedRequest>({
    schemaVersion: "rateloop.human-review-prepared-request.v1",
    opportunityId: requiredText(input.opportunityId, "opportunity ID", 160),
    workflowKey: requiredText(input.workflowKey, "workflow key", 160),
    requestProfile: { id: profile.id, version: profile.version, hash: profile.hash },
    question: {
      criterion: question.prompt,
      positiveLabel: question.positiveLabel,
      negativeLabel: question.negativeLabel,
      rationaleMode: question.rationaleMode,
      questionHash,
      questionAuthority: question.questionAuthority,
      resultSemantics: question.resultSemantics,
    },
    audience: {
      kind: profile.audience,
      contentBoundary: profile.contentBoundary,
      privateSensitivity: profile.privateSensitivity,
      privateGroupId: profile.privateGroupId,
      requiredExpertiseKeys: profile.requiredExpertiseKeys,
    },
    timing: {
      responseWindowSeconds: profile.responseWindowSeconds,
      expiresAt: expiresAt.toISOString(),
    },
    panel: { size: profile.panelSize },
    contentCommitments: { ...input.contentCommitments },
    provenance: {
      agentId: profile.agentId,
      agentVersionId: profile.agentVersionId,
      selectionPolicyId: requiredText(input.selectionPolicy.id, "selection policy ID", 160),
      selectionPolicyVersion: boundedInteger(
        input.selectionPolicy.version,
        "selection policy version",
        1,
        2_147_483_647,
      ),
    },
    feedbackBonus: feedbackBonusEconomics,
  });
  const reviewEconomics =
    profile.compensationMode === "usdc"
      ? {
          compensationMode: "usdc" as const,
          bountyPerSeatAtomic: derivedEconomics.bountyPerSeatAtomic,
          panelSize: profile.panelSize,
        }
      : { compensationMode: "unpaid" as const, bountyPerSeatAtomic: null, panelSize: profile.panelSize };
  const rationale =
    profile.rationaleMode === "required"
      ? ({ mode: "required", minLength: 10, maxLength: 2_000 } as const)
      : profile.rationaleMode === "optional"
        ? ({ mode: "optional" } as const)
        : ({ mode: "off" } as const);
  return immutable({
    preparedRequest,
    preparedRequestHash: hashPreparedHumanReviewValue(preparedRequest),
    questionHash,
    derivedEconomics,
    derivedEconomicsHash: hashPreparedHumanReviewValue(derivedEconomics),
    maximumChargeAtomic: derivedEconomics.maximumChargeAtomic,
    feedbackBonusEconomics,
    maximumConsentAtomic,
    quoteTerms: {
      budget: {
        bountyAtomic: derivedEconomics.baseBountyAtomic,
        attemptReserveAtomic: derivedEconomics.attemptReserveAtomic,
        feeBps: derivedEconomics.feeBps,
      },
      question: {
        kind: "binary",
        prompt,
        positiveLabel: question.positiveLabel,
        negativeLabel: question.negativeLabel,
        rationale,
      },
      requestedPanelSize: profile.panelSize,
      responseWindowSeconds: profile.responseWindowSeconds,
      requestProfile: { id: profile.id, version: profile.version, hash: profile.hash },
      reviewEconomics,
    },
  });
}

export const __humanReviewRequestPreparationTestUtils = { canonicalJson };
