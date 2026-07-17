import {
  type RateLoopFrameworkGateResult,
  type RateLoopFrameworkPending,
} from "./approvalCore";

export const RATELOOP_OPENAI_AGENTS_STATE_SCHEMA_VERSION =
  "rateloop.openai-agents-approval.v1" as const;

export type RateLoopOpenAiAgentsApprovalState = {
  schemaVersion: typeof RATELOOP_OPENAI_AGENTS_STATE_SCHEMA_VERSION;
  pending: RateLoopFrameworkPending;
};

export type RateLoopOpenAiAgentsStateStore = {
  load(toolCallId: string): Promise<RateLoopOpenAiAgentsApprovalState | null>;
  save(
    toolCallId: string,
    state: RateLoopOpenAiAgentsApprovalState,
  ): Promise<void>;
  remove(toolCallId: string): Promise<void>;
};

/**
 * Maps RateLoop's durable checkpoint to the OpenAI Agents SDK approval slot.
 * Persist this object beside the SDK's resumable RunState. Approval of the SDK
 * interruption alone never releases the output; refresh RateLoop and require a
 * release result backed by signed terminal evidence before tool execution.
 */
export function toOpenAiAgentsApproval(
  gate: RateLoopFrameworkGateResult,
):
  | { needsApproval: false; state: null }
  | { needsApproval: true; state: RateLoopOpenAiAgentsApprovalState } {
  if (gate.action === "block") {
    throw new Error(`RateLoop blocked output release: ${gate.reason}.`);
  }
  return gate.action === "release"
    ? { needsApproval: false, state: null }
    : {
        needsApproval: true,
        state: {
          schemaVersion: RATELOOP_OPENAI_AGENTS_STATE_SCHEMA_VERSION,
          pending: gate.pending,
        },
      };
}

export function pendingFromOpenAiAgentsState(
  state: RateLoopOpenAiAgentsApprovalState,
) {
  if (state.schemaVersion !== RATELOOP_OPENAI_AGENTS_STATE_SCHEMA_VERSION) {
    throw new Error("OpenAI Agents RateLoop approval state is unsupported.");
  }
  return state.pending;
}

/**
 * Host glue for an OpenAI Agents SDK tool's `needsApproval` callback. Persist
 * the SDK RunState and this adapter state together. Do not approve the SDK
 * interruption merely because the user clicked approve in the agent UI:
 * `readyToApproveSdkInterruption` must first observe RateLoop release evidence.
 */
export function createOpenAiAgentsApprovalAdapter<Input>(input: {
  begin(value: Input): Promise<RateLoopFrameworkGateResult>;
  refresh(
    pending: RateLoopFrameworkPending,
  ): Promise<RateLoopFrameworkGateResult>;
  store: RateLoopOpenAiAgentsStateStore;
}) {
  async function needsApprovalForToolCall(toolCallId: string, value: Input) {
    if (!toolCallId.trim())
      throw new Error("OpenAI Agents toolCallId is required.");
    const mapped = toOpenAiAgentsApproval(await input.begin(value));
    if (mapped.needsApproval) await input.store.save(toolCallId, mapped.state);
    else await input.store.remove(toolCallId);
    return mapped.needsApproval;
  }

  return {
    /**
     * Directly assignable to an OpenAI Agents SDK tool's `needsApproval`
     * callback. The SDK supplies the call ID only during an agent run; a
     * missing ID cannot be bound to durable RateLoop state and fails closed.
     */
    async needsApproval(
      _runContext: unknown,
      value: Input,
      toolCallId?: string,
    ) {
      if (!toolCallId) {
        throw new Error(
          "OpenAI Agents needsApproval requires the SDK toolCallId supplied during a run.",
        );
      }
      return needsApprovalForToolCall(toolCallId, value);
    },
    needsApprovalForToolCall,
    async readyToApproveSdkInterruption(toolCallId: string) {
      const state = await input.store.load(toolCallId);
      if (!state)
        throw new Error("OpenAI Agents RateLoop approval state is missing.");
      const gate = await input.refresh(pendingFromOpenAiAgentsState(state));
      if (gate.action === "block") {
        await input.store.remove(toolCallId);
        throw new Error(`RateLoop blocked output release: ${gate.reason}.`);
      }
      if (gate.action === "release") {
        await input.store.remove(toolCallId);
        return true;
      }
      await input.store.save(toolCallId, {
        schemaVersion: RATELOOP_OPENAI_AGENTS_STATE_SCHEMA_VERSION,
        pending: gate.pending,
      });
      return false;
    },
    async rejectSdkInterruption(toolCallId: string) {
      await input.store.remove(toolCallId);
    },
  };
}
