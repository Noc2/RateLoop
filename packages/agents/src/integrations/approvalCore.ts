export const RATELOOP_FRAMEWORK_PENDING_SCHEMA_VERSION =
  "rateloop.framework-approval-pending.v1" as const;

export const RATELOOP_REVIEW_NONTERMINAL_STATES = [
  "approval_required",
  "request_ready",
  "pending",
  "blocked",
] as const;

export const RATELOOP_REVIEW_TERMINAL_STATES = [
  "completed",
  "inconclusive",
  "failed_terminal",
  "cancelled_before_commit",
] as const;

export type RateLoopReviewNonterminalState =
  (typeof RATELOOP_REVIEW_NONTERMINAL_STATES)[number];
export type RateLoopReviewTerminalState =
  (typeof RATELOOP_REVIEW_TERMINAL_STATES)[number];
export type RateLoopReviewState =
  | "skipped"
  | RateLoopReviewNonterminalState
  | RateLoopReviewTerminalState;

export type RateLoopReviewCheckpoint = {
  opportunityId: string;
  scopeCommitment: `sha256:${string}`;
  state: RateLoopReviewState;
  revision: number;
  evaluationCommitment: `sha256:${string}`;
  policyBindingHash: `sha256:${string}`;
  continuation?: {
    cursor: string;
    expiresAt: string;
    retryAfterMs: number;
  };
  /**
   * Set only by a host that verified RateLoop's signed output-release evidence
   * against the exact candidate and policy binding. A boolean "terminal was
   * signed" is deliberately insufficient: failed and cancelled terminals do
   * not authorize release.
   */
  verifiedReleaseEvidence?: {
    decision: "skipped" | "satisfied";
    outputCommitment: `sha256:${string}`;
    policyBindingHash: `sha256:${string}`;
    scopeCommitment: `sha256:${string}`;
  };
};

export type RateLoopFrameworkPending = {
  schemaVersion: typeof RATELOOP_FRAMEWORK_PENDING_SCHEMA_VERSION;
  opportunityId: string;
  scopeCommitment: `sha256:${string}`;
  lifecycle: RateLoopReviewNonterminalState;
  lifecycleRevision: number;
  evaluationCommitment: `sha256:${string}`;
  policyBindingHash: `sha256:${string}`;
  continuation?: RateLoopReviewCheckpoint["continuation"];
};

export type RateLoopFrameworkGateResult =
  | {
      action: "release";
      reason: "selection_skipped" | "signed_terminal_evidence";
      checkpoint: RateLoopReviewCheckpoint;
    }
  | {
      action: "interrupt";
      pending: RateLoopFrameworkPending;
    }
  | {
      action: "block";
      reason: "failed_terminal" | "cancelled_before_commit";
      checkpoint: RateLoopReviewCheckpoint;
    };

export type RateLoopFrameworkApprovalDriver<EvaluationInput, PreparationInput> =
  {
    /** Must be idempotent for the same logical framework operation. */
    evaluate(input: EvaluationInput): Promise<RateLoopReviewCheckpoint>;
    /**
     * Prepares or routes the frozen opportunity. It must preserve RateLoop's
     * owner-bound authority and must be idempotent when a framework restarts a node.
     */
    prepare(input: {
      checkpoint: RateLoopReviewCheckpoint;
      request: PreparationInput;
    }): Promise<RateLoopReviewCheckpoint>;
    /** Performs one bounded read. It must not wait for the human response window. */
    refresh(
      pending: RateLoopFrameworkPending,
    ): Promise<RateLoopReviewCheckpoint>;
  };

const IDENTIFIER = /^[A-Za-z0-9._:-]{8,200}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;

function assertCheckpoint(value: RateLoopReviewCheckpoint) {
  if (!IDENTIFIER.test(value.opportunityId)) {
    throw new Error("RateLoop checkpoint identity is invalid.");
  }
  if (
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !HASH.test(value.evaluationCommitment) ||
    !HASH.test(value.policyBindingHash) ||
    !HASH.test(value.scopeCommitment)
  ) {
    throw new Error("RateLoop checkpoint binding is invalid.");
  }
  if (
    value.state !== "skipped" &&
    !RATELOOP_REVIEW_NONTERMINAL_STATES.includes(
      value.state as RateLoopReviewNonterminalState,
    ) &&
    !RATELOOP_REVIEW_TERMINAL_STATES.includes(
      value.state as RateLoopReviewTerminalState,
    )
  ) {
    throw new Error("RateLoop checkpoint lifecycle is invalid.");
  }
  if (value.continuation) {
    const expiresAt = Date.parse(value.continuation.expiresAt);
    if (
      !value.continuation.cursor ||
      value.continuation.cursor.length > 512 ||
      !Number.isSafeInteger(value.continuation.retryAfterMs) ||
      value.continuation.retryAfterMs < 0 ||
      value.continuation.retryAfterMs > 300_000 ||
      !Number.isFinite(expiresAt)
    ) {
      throw new Error("RateLoop checkpoint continuation is invalid.");
    }
  }
}

function sameBinding(
  checkpoint: RateLoopReviewCheckpoint,
  pending: RateLoopFrameworkPending,
) {
  return (
    checkpoint.opportunityId === pending.opportunityId &&
    checkpoint.scopeCommitment === pending.scopeCommitment &&
    checkpoint.evaluationCommitment === pending.evaluationCommitment &&
    checkpoint.policyBindingHash === pending.policyBindingHash &&
    checkpoint.revision >= pending.lifecycleRevision
  );
}

function result(
  checkpoint: RateLoopReviewCheckpoint,
): RateLoopFrameworkGateResult {
  assertCheckpoint(checkpoint);
  if (checkpoint.state === "skipped") {
    if (
      checkpoint.verifiedReleaseEvidence?.decision !== "skipped" ||
      checkpoint.verifiedReleaseEvidence.outputCommitment !==
        checkpoint.evaluationCommitment ||
      checkpoint.verifiedReleaseEvidence.policyBindingHash !==
        checkpoint.policyBindingHash ||
      checkpoint.verifiedReleaseEvidence.scopeCommitment !==
        checkpoint.scopeCommitment
    ) {
      throw new Error(
        "RateLoop selection skip cannot release output without matching verified release evidence.",
      );
    }
    return { action: "release", reason: "selection_skipped", checkpoint };
  }
  if (
    checkpoint.state === "failed_terminal" ||
    checkpoint.state === "cancelled_before_commit"
  ) {
    return { action: "block", reason: checkpoint.state, checkpoint };
  }
  if (checkpoint.state === "completed" || checkpoint.state === "inconclusive") {
    if (
      checkpoint.verifiedReleaseEvidence?.decision !== "satisfied" ||
      checkpoint.verifiedReleaseEvidence.outputCommitment !==
        checkpoint.evaluationCommitment ||
      checkpoint.verifiedReleaseEvidence.policyBindingHash !==
        checkpoint.policyBindingHash ||
      checkpoint.verifiedReleaseEvidence.scopeCommitment !==
        checkpoint.scopeCommitment
    ) {
      throw new Error(
        "RateLoop terminal lifecycle cannot release output without matching verified satisfied evidence.",
      );
    }
    return {
      action: "release",
      reason: "signed_terminal_evidence",
      checkpoint,
    };
  }
  return {
    action: "interrupt",
    pending: {
      schemaVersion: RATELOOP_FRAMEWORK_PENDING_SCHEMA_VERSION,
      opportunityId: checkpoint.opportunityId,
      scopeCommitment: checkpoint.scopeCommitment,
      lifecycle: checkpoint.state as RateLoopReviewNonterminalState,
      lifecycleRevision: checkpoint.revision,
      evaluationCommitment: checkpoint.evaluationCommitment,
      policyBindingHash: checkpoint.policyBindingHash,
      ...(checkpoint.continuation
        ? { continuation: checkpoint.continuation }
        : {}),
    },
  };
}

/**
 * Starts one review gate without keeping the framework call open. Source and
 * suggestion payloads are passed only to the driver and never enter the
 * serializable pending checkpoint.
 */
export async function beginRateLoopFrameworkApproval<
  EvaluationInput,
  PreparationInput,
>(input: {
  driver: RateLoopFrameworkApprovalDriver<EvaluationInput, PreparationInput>;
  evaluation: EvaluationInput;
  preparation: PreparationInput;
}): Promise<RateLoopFrameworkGateResult> {
  const evaluated = await input.driver.evaluate(input.evaluation);
  const initial = result(evaluated);
  if (initial.action !== "interrupt") return initial;
  if (
    evaluated.state !== "approval_required" &&
    evaluated.state !== "request_ready"
  ) {
    return initial;
  }
  const prepared = await input.driver.prepare({
    checkpoint: evaluated,
    request: input.preparation,
  });
  if (
    prepared.opportunityId !== evaluated.opportunityId ||
    prepared.scopeCommitment !== evaluated.scopeCommitment ||
    prepared.evaluationCommitment !== evaluated.evaluationCommitment ||
    prepared.policyBindingHash !== evaluated.policyBindingHash ||
    prepared.revision < evaluated.revision
  ) {
    throw new Error("RateLoop preparation changed the frozen review binding.");
  }
  if (prepared.state === "skipped") {
    throw new Error(
      "A required RateLoop review cannot become a selection skip during preparation.",
    );
  }
  return result(prepared);
}

/** Performs one bounded refresh and fails closed on binding or revision drift. */
export async function refreshRateLoopFrameworkApproval<
  EvaluationInput,
  PreparationInput,
>(input: {
  driver: RateLoopFrameworkApprovalDriver<EvaluationInput, PreparationInput>;
  pending: RateLoopFrameworkPending;
}): Promise<RateLoopFrameworkGateResult> {
  if (
    input.pending.schemaVersion !== RATELOOP_FRAMEWORK_PENDING_SCHEMA_VERSION
  ) {
    throw new Error("RateLoop pending checkpoint schema is unsupported.");
  }
  const checkpoint = await input.driver.refresh(input.pending);
  assertCheckpoint(checkpoint);
  if (!sameBinding(checkpoint, input.pending)) {
    throw new Error(
      "RateLoop refresh does not match the frozen pending checkpoint.",
    );
  }
  if (checkpoint.state === "skipped") {
    throw new Error(
      "A required RateLoop review cannot become a selection skip.",
    );
  }
  return result(checkpoint);
}
