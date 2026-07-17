import { createHash } from "node:crypto";
import "server-only";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const BINARY_REVIEW_QUESTION_SCHEMA_VERSION = "rateloop.binary-review-question.v1" as const;
export const HUMAN_REVIEW_QUESTION_AUTHORITIES = ["owner_fixed", "agent_per_request"] as const;
export const HUMAN_REVIEW_RESULT_SEMANTICS = ["assurance", "feedback"] as const;
export const HUMAN_REVIEW_RATIONALE_MODES = ["off", "optional", "required"] as const;

export type HumanReviewQuestionAuthority = (typeof HUMAN_REVIEW_QUESTION_AUTHORITIES)[number];
export type HumanReviewResultSemantics = (typeof HUMAN_REVIEW_RESULT_SEMANTICS)[number];
export type HumanReviewRationaleMode = (typeof HUMAN_REVIEW_RATIONALE_MODES)[number];

export type AgentPerRequestBinaryQuestionInput = {
  kind: "binary";
  prompt: string;
  positiveLabel: string;
  negativeLabel: string;
};

export type HumanReviewQuestionPolicySnapshot = {
  questionAuthority: HumanReviewQuestionAuthority;
  resultSemantics: HumanReviewResultSemantics;
  criterion: string | null;
  positiveLabel: string | null;
  negativeLabel: string | null;
  rationaleMode: HumanReviewRationaleMode;
};

export type FrozenBinaryReviewQuestion = Readonly<{
  schemaVersion: typeof BINARY_REVIEW_QUESTION_SCHEMA_VERSION;
  kind: "binary";
  prompt: string;
  positiveLabel: string;
  negativeLabel: string;
  rationaleMode: HumanReviewRationaleMode;
  questionAuthority: HumanReviewQuestionAuthority;
  resultSemantics: HumanReviewResultSemantics;
}>;

const CALLER_QUESTION_KEYS = ["kind", "prompt", "positiveLabel", "negativeLabel"] as const;

function invalidQuestion(message: string, code = "invalid_review_question"): never {
  throw new TokenlessServiceError(message, 400, code);
}

function invalidConfiguration(message: string): never {
  throw new TokenlessServiceError(message, 500, "review_configuration_invalid");
}

function record(value: unknown) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactCallerText(value: unknown, field: string, maximum: number) {
  if (typeof value !== "string") invalidQuestion(`${field} must be a string.`);
  if (/\p{Cc}/u.test(value)) invalidQuestion(`${field} cannot contain control characters.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    invalidQuestion(`${field} must contain 1-${maximum} characters.`);
  }
  return normalized;
}

function exactStoredText(value: unknown, field: string, maximum: number) {
  if (typeof value !== "string") invalidConfiguration(`Stored ${field} is invalid.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) invalidConfiguration(`Stored ${field} is invalid.`);
  return normalized;
}

function assertDistinctLabels(positiveLabel: string, negativeLabel: string, caller: boolean) {
  if (positiveLabel.toLocaleLowerCase("en-US") !== negativeLabel.toLocaleLowerCase("en-US")) return;
  if (caller) invalidQuestion("positiveLabel and negativeLabel must be distinct.");
  invalidConfiguration("Stored review labels are not distinct.");
}

function immutable<Value>(value: Value): Readonly<Value> {
  if (value !== null && typeof value === "object") Object.freeze(value);
  return value;
}

function questionDocument(input: {
  authority: HumanReviewQuestionAuthority;
  semantics: HumanReviewResultSemantics;
  prompt: string;
  positiveLabel: string;
  negativeLabel: string;
  rationaleMode: HumanReviewRationaleMode;
}): FrozenBinaryReviewQuestion {
  return immutable({
    schemaVersion: BINARY_REVIEW_QUESTION_SCHEMA_VERSION,
    kind: "binary",
    prompt: input.prompt,
    positiveLabel: input.positiveLabel,
    negativeLabel: input.negativeLabel,
    rationaleMode: input.rationaleMode,
    questionAuthority: input.authority,
    resultSemantics: input.semantics,
  });
}

export function normalizeAgentPerRequestBinaryQuestion(value: unknown): AgentPerRequestBinaryQuestionInput {
  const input = record(value);
  if (!input) invalidQuestion("An agent-written binary review question is required.", "review_question_required");
  if (
    Object.keys(input).length !== CALLER_QUESTION_KEYS.length ||
    Object.keys(input).some(key => !(CALLER_QUESTION_KEYS as readonly string[]).includes(key))
  ) {
    invalidQuestion("The agent-written review question contains unsupported fields.");
  }
  if (input.kind !== "binary") invalidQuestion("Only binary agent-written review questions are supported.");
  const prompt = exactCallerText(input.prompt, "question.prompt", 500);
  const positiveLabel = exactCallerText(input.positiveLabel, "question.positiveLabel", 40);
  const negativeLabel = exactCallerText(input.negativeLabel, "question.negativeLabel", 40);
  assertDistinctLabels(positiveLabel, negativeLabel, true);
  return { kind: "binary", prompt, positiveLabel, negativeLabel };
}

export function resolveHumanReviewQuestion(input: {
  policy: HumanReviewQuestionPolicySnapshot;
  callerQuestion?: unknown;
}): FrozenBinaryReviewQuestion {
  const policy = input.policy;
  if (!HUMAN_REVIEW_RATIONALE_MODES.includes(policy.rationaleMode)) {
    invalidConfiguration("Stored review rationale mode is invalid.");
  }
  if (policy.questionAuthority === "owner_fixed") {
    if (policy.resultSemantics !== "assurance") {
      invalidConfiguration("A fixed owner question must use assurance semantics.");
    }
    if (input.callerQuestion !== undefined) {
      invalidQuestion(
        "This review profile uses a fixed owner question; callers cannot override it.",
        "review_question_override_not_allowed",
      );
    }
    const prompt = exactStoredText(policy.criterion, "review criterion", 500);
    const positiveLabel = exactStoredText(policy.positiveLabel, "positive label", 40);
    const negativeLabel = exactStoredText(policy.negativeLabel, "negative label", 40);
    assertDistinctLabels(positiveLabel, negativeLabel, false);
    return questionDocument({
      authority: policy.questionAuthority,
      semantics: policy.resultSemantics,
      prompt,
      positiveLabel,
      negativeLabel,
      rationaleMode: policy.rationaleMode,
    });
  }
  if (policy.questionAuthority !== "agent_per_request" || policy.resultSemantics !== "feedback") {
    invalidConfiguration("Stored per-request question authority is invalid.");
  }
  if (policy.criterion !== null || policy.positiveLabel !== null || policy.negativeLabel !== null) {
    invalidConfiguration("An agent-written question profile cannot retain fixed question text.");
  }
  if (input.callerQuestion === undefined || input.callerQuestion === null) {
    invalidQuestion(
      "This review profile requires an agent-written binary question for each request.",
      "review_question_required",
    );
  }
  const question = normalizeAgentPerRequestBinaryQuestion(input.callerQuestion);
  return questionDocument({
    authority: policy.questionAuthority,
    semantics: policy.resultSemantics,
    prompt: question.prompt,
    positiveLabel: question.positiveLabel,
    negativeLabel: question.negativeLabel,
    rationaleMode: policy.rationaleMode,
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) invalidConfiguration("The review question is not canonicalizable.");
  return encoded;
}

export function serializeFrozenBinaryReviewQuestion(question: FrozenBinaryReviewQuestion) {
  return canonicalJson(question);
}

export function hashFrozenBinaryReviewQuestion(question: FrozenBinaryReviewQuestion): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(serializeFrozenBinaryReviewQuestion(question)).digest("hex")}`;
}
