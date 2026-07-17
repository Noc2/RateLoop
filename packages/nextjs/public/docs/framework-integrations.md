# Framework approval integrations

`@rateloop/agents` maps RateLoop's durable review checkpoint into framework-native interruption primitives. The
framework call must not stay open for the human response window. Persist the framework state, the RateLoop pending
checkpoint, and the framework operation ID together; then resume with one bounded RateLoop refresh.

The adapter core is fail closed. A selection skip releases output only after the driver verifies matching signed
`skipped` release evidence. A completed or inconclusive review releases output only after matching signed `satisfied`
evidence. Both decisions must bind the exact output commitment, policy binding, and evidence scope. Failed and cancelled
terminal states never release output. Source material, the agent suggestion, reviewer
identity, credentials, and payment details never enter the serializable framework checkpoint.

```ts
import {
  beginRateLoopFrameworkApproval,
  refreshRateLoopFrameworkApproval,
} from "@rateloop/agents";

const gate = await beginRateLoopFrameworkApproval({
  driver, // wraps evaluate_review_requirement, request_review, and one bounded refresh
  evaluation,
  preparation,
});

if (gate.action === "interrupt") {
  await durableState.save(gate.pending);
  return frameworkInterrupt(gate.pending);
}
if (gate.action === "block") throw new Error(gate.reason);
return candidateOutput;
```

The driver owns MCP/API transport and signed evidence verification. Its `evaluate` and `prepare` operations must be
idempotent for the same logical framework operation. `refresh` performs one bounded read; it never polls for the whole
response window. Generic callbacks and plugin hooks remain advisory unless the host owns the downstream output boundary
and verifies the signed output-release evidence.

## LangGraph JS

Use `interruptForRateLoopApproval` inside a node configured with a durable checkpointer. Invoke the graph with the same
`thread_id` when resuming:

```ts
import { interrupt } from "@langchain/langgraph";
import { interruptForRateLoopApproval } from "@rateloop/agents";

const outcome = interruptForRateLoopApproval(gate, interrupt);
```

LangGraph restarts the interrupted node from the beginning. Any evaluation, preparation, or other side effect before
`interrupt()` must therefore be idempotent. A `{ action: "resume" }` value means only “check RateLoop again”; it is not
approval, terminal evidence, or permission to release the output.

## OpenAI Agents SDK

`createOpenAiAgentsApprovalAdapter` supplies the decision behind a tool's `needsApproval` callback and stores a
RateLoop checkpoint by tool-call ID. Serialize this store beside the SDK's resumable RunState:

```ts
const approval = createOpenAiAgentsApprovalAdapter({ begin, refresh, store });

const guardedTool = tool({
  // OpenAI supplies runContext, parsed input, and the durable tool-call ID.
  needsApproval: approval.needsApproval,
  // ...the rest of the tool definition
});
// Run the agent and persist both result.state and `store` when interruptions exist.

const interruption = result.interruptions[0];
const toolCallId = interruption.rawItem.callId;
if (await approval.readyToApproveSdkInterruption(toolCallId)) {
  result.state.approve(interruption);
  // Resume the same run from result.state only now.
}
```

SDK approval alone never satisfies RateLoop. Rejecting an SDK interruption should call `rejectSdkInterruption`; this
removes local adapter state but does not cancel, publish, pay, or mutate the RateLoop opportunity.

## Claude Code

In Claude Code 2.1.89 or newer, the `rateloop-workspace` plugin returns `PreToolUse`
`permissionDecision: "defer"` when an exact RateLoop gate is armed. Claude honors this durable defer only in
non-interactive `claude -p` and Agent SDK runs with a single tool call. Interactive sessions and responses containing
multiple tool calls ignore `defer`; do not treat the plugin as an enforcement boundary in those modes. In a supported
run, complete the owner approval or review outside the paused tool call, then resume the same Claude session. Claude
replays the tool request and RateLoop checks the gate again. RateLoop MCP progress tools remain callable. The separate
`Stop` hook is retained as an advisory output guard.

`PermissionRequest` is only a synchronous allow/deny dialog, and `Stop` is not the durable async approval primitive.
Plugin hooks can be disabled or bypassed and are not verified host enforcement.

## MCP form elicitation

`createRateLoopMcpElicitation` builds the stable MCP 2025-06-18 `elicitation/create` form only when the client declares
the `elicitation` capability. The form contains a single boolean and no source, suggestion, private artifact, reviewer,
credential, or payment field. Accepting `false` explicitly rejects the prepared approval. Decline and cancel leave it
pending and fall back to the normal RateLoop approval path.

The RateLoop workspace endpoint enables this queued form flow only for a session negotiated at MCP 2025-06-18 with
the form-elicitation capability. MCP 2025-03-26 has no elicitation; MCP 2025-11-25 clients use the normal browser
approval path until RateLoop implements that version's originating-request association. The endpoint issues an
authenticated `MCP-Session-Id` only after successful initialize, persists the negotiated protocol and capability,
delivers each request to one authenticated GET/SSE stream under a retry lease, and correlates the client's JSON-RPC
response on POST. Sessions, protocol version, OAuth family, workspace, integration, owner principal, approval revision,
and prepared hashes are bound together. Expired or conflicting responses fail closed. Clients without the supported
capability continue to use browser approval.

Review lifecycle webhooks are already shared with the assurance evidence pipeline. RateLoop emits the canonical
CloudEvents 1.0/OCSF projections for review completion, packet anchoring, and blocked gates; framework adapters must not
create a parallel event stream.
