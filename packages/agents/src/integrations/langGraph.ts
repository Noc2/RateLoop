import {
  type RateLoopFrameworkGateResult,
  type RateLoopFrameworkPending,
} from "./approvalCore";

export const RATELOOP_LANGGRAPH_INTERRUPT_SCHEMA_VERSION =
  "rateloop.langgraph-interrupt.v1" as const;

export type RateLoopLangGraphInterrupt = {
  schemaVersion: typeof RATELOOP_LANGGRAPH_INTERRUPT_SCHEMA_VERSION;
  kind: "rateloop_owner_approval";
  message: string;
  pending: RateLoopFrameworkPending;
};

export type RateLoopLangGraphResume = {
  action: "resume" | "cancel";
};

/**
 * Converts a RateLoop pending checkpoint into a JSON-serializable LangGraph
 * interrupt. The caller must configure a durable checkpointer and reuse the
 * same thread_id. LangGraph restarts the node on resume, so the driver used to
 * obtain this gate must be idempotent.
 */
export function interruptForRateLoopApproval(
  gate: RateLoopFrameworkGateResult,
  interrupt: (value: RateLoopLangGraphInterrupt) => unknown,
):
  | RateLoopFrameworkGateResult
  | {
      action: "resume_requested" | "cancelled";
      pending: RateLoopFrameworkPending;
    } {
  if (gate.action !== "interrupt") return gate;
  const resumed = interrupt({
    schemaVersion: RATELOOP_LANGGRAPH_INTERRUPT_SCHEMA_VERSION,
    kind: "rateloop_owner_approval",
    message:
      "RateLoop review is required. Complete the bound approval or review, then resume this thread.",
    pending: gate.pending,
  });
  if (
    !resumed ||
    typeof resumed !== "object" ||
    !("action" in resumed) ||
    !["resume", "cancel"].includes(String(resumed.action))
  ) {
    throw new Error("LangGraph resume value must select resume or cancel.");
  }
  return {
    action: resumed.action === "resume" ? "resume_requested" : "cancelled",
    pending: gate.pending,
  };
}
