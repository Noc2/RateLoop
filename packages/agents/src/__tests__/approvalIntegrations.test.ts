import { describe, expect, it, vi } from "vitest";
import {
  beginRateLoopFrameworkApproval,
  refreshRateLoopFrameworkApproval,
  type RateLoopFrameworkApprovalDriver,
  type RateLoopReviewCheckpoint,
} from "../integrations/approvalCore";
import { interruptForRateLoopApproval } from "../integrations/langGraph";
import {
  createRateLoopMcpElicitation,
  parseRateLoopMcpElicitation,
} from "../integrations/mcpElicitation";
import {
  createOpenAiAgentsApprovalAdapter,
  pendingFromOpenAiAgentsState,
  toOpenAiAgentsApproval,
  type RateLoopOpenAiAgentsApprovalState,
} from "../integrations/openAiAgents";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const HASH_SCOPE = `sha256:${"d".repeat(64)}` as const;

function checkpoint(
  state: RateLoopReviewCheckpoint["state"],
  revision = 1,
): RateLoopReviewCheckpoint {
  return {
    opportunityId: "opportunity_fixture_01",
    scopeCommitment: HASH_SCOPE,
    state,
    revision,
    evaluationCommitment: HASH_A,
    policyBindingHash: HASH_B,
  };
}

function releaseEvidence(decision: "skipped" | "satisfied") {
  return {
    decision,
    outputCommitment: HASH_A,
    policyBindingHash: HASH_B,
    scopeCommitment: HASH_SCOPE,
  } as const;
}

function driver(
  evaluated: RateLoopReviewCheckpoint,
  prepared = evaluated,
  refreshed = prepared,
): RateLoopFrameworkApprovalDriver<{ externalId: string }, { source: string }> {
  return {
    evaluate: vi.fn(async () => evaluated),
    prepare: vi.fn(async () => prepared),
    refresh: vi.fn(async () => refreshed),
  };
}

describe("framework approval core", () => {
  it("releases a selection skip without preparing a review", async () => {
    const adapter = driver({
      ...checkpoint("skipped"),
      verifiedReleaseEvidence: releaseEvidence("skipped"),
    });
    const result = await beginRateLoopFrameworkApproval({
      driver: adapter,
      evaluation: { externalId: "execution_01" },
      preparation: { source: "private source is not persisted" },
    });

    expect(result).toMatchObject({
      action: "release",
      reason: "selection_skipped",
    });
    expect(adapter.prepare).not.toHaveBeenCalled();
  });

  it("prepares once and returns a payload-free durable interruption", async () => {
    const adapter = driver(
      checkpoint("approval_required"),
      checkpoint("approval_required", 2),
    );
    const result = await beginRateLoopFrameworkApproval({
      driver: adapter,
      evaluation: { externalId: "execution_01" },
      preparation: { source: "private source must not enter the checkpoint" },
    });

    expect(result).toMatchObject({
      action: "interrupt",
      pending: {
        lifecycle: "approval_required",
        lifecycleRevision: 2,
        opportunityId: "opportunity_fixture_01",
        scopeCommitment: HASH_SCOPE,
      },
    });
    expect(JSON.stringify(result)).not.toContain("private source");
    expect(adapter.prepare).toHaveBeenCalledOnce();
  });

  it("fails closed when a required review becomes skipped during preparation", async () => {
    const adapter = driver(checkpoint("approval_required"), {
      ...checkpoint("skipped", 2),
      verifiedReleaseEvidence: releaseEvidence("skipped"),
    });

    await expect(
      beginRateLoopFrameworkApproval({
        driver: adapter,
        evaluation: { externalId: "execution_01" },
        preparation: { source: "private source" },
      }),
    ).rejects.toThrow(/cannot become a selection skip during preparation/u);
  });

  it("performs one refresh and releases only verified terminal evidence", async () => {
    const adapter = driver(
      checkpoint("approval_required"),
      checkpoint("pending", 2),
      {
        ...checkpoint("completed", 3),
        verifiedReleaseEvidence: releaseEvidence("satisfied"),
      },
    );
    const started = await beginRateLoopFrameworkApproval({
      driver: adapter,
      evaluation: { externalId: "execution_01" },
      preparation: { source: "source" },
    });
    if (started.action !== "interrupt") throw new Error("expected interrupt");

    await expect(
      refreshRateLoopFrameworkApproval({
        driver: adapter,
        pending: started.pending,
      }),
    ).resolves.toMatchObject({
      action: "release",
      reason: "signed_terminal_evidence",
    });
    expect(adapter.refresh).toHaveBeenCalledOnce();
  });

  it("fails closed on unsigned terminal state and frozen-binding drift", async () => {
    const unsigned = driver(
      checkpoint("approval_required"),
      checkpoint("pending", 2),
      checkpoint("completed", 3),
    );
    const started = await beginRateLoopFrameworkApproval({
      driver: unsigned,
      evaluation: { externalId: "execution_01" },
      preparation: { source: "source" },
    });
    if (started.action !== "interrupt") throw new Error("expected interrupt");
    await expect(
      refreshRateLoopFrameworkApproval({
        driver: unsigned,
        pending: started.pending,
      }),
    ).rejects.toThrow("verified satisfied evidence");

    const drift = driver(
      checkpoint("approval_required"),
      checkpoint("pending", 2),
      {
        ...checkpoint("pending", 3),
        policyBindingHash: `sha256:${"c".repeat(64)}`,
      },
    );
    const driftStarted = await beginRateLoopFrameworkApproval({
      driver: drift,
      evaluation: { externalId: "execution_02" },
      preparation: { source: "source" },
    });
    if (driftStarted.action !== "interrupt")
      throw new Error("expected interrupt");
    await expect(
      refreshRateLoopFrameworkApproval({
        driver: drift,
        pending: driftStarted.pending,
      }),
    ).rejects.toThrow("frozen pending checkpoint");
  });

  it("requires verified skip evidence and never releases failed or cancelled terminals", async () => {
    const unsignedSkip = driver(checkpoint("skipped"));
    await expect(
      beginRateLoopFrameworkApproval({
        driver: unsignedSkip,
        evaluation: { externalId: "execution_skip" },
        preparation: { source: "source" },
      }),
    ).rejects.toThrow("verified release evidence");

    for (const state of [
      "failed_terminal",
      "cancelled_before_commit",
    ] as const) {
      const blocked = driver({
        ...checkpoint(state),
        verifiedReleaseEvidence: releaseEvidence("satisfied"),
      });
      await expect(
        beginRateLoopFrameworkApproval({
          driver: blocked,
          evaluation: { externalId: `execution_${state}` },
          preparation: { source: "source" },
        }),
      ).resolves.toMatchObject({ action: "block", reason: state });
    }
  });
});

describe("framework-specific mappings", () => {
  it("uses a JSON-safe LangGraph interrupt and validates resume values", async () => {
    const adapter = driver(checkpoint("approval_required"));
    const gate = await beginRateLoopFrameworkApproval({
      driver: adapter,
      evaluation: { externalId: "execution_01" },
      preparation: { source: "source" },
    });
    const interrupt = vi.fn(() => ({ action: "resume" }));
    const result = interruptForRateLoopApproval(gate, interrupt);

    expect(result).toMatchObject({ action: "resume_requested" });
    expect(
      JSON.parse(JSON.stringify(interrupt.mock.calls[0]?.[0])),
    ).toMatchObject({
      kind: "rateloop_owner_approval",
      pending: { opportunityId: "opportunity_fixture_01" },
    });
  });

  it("maps a pending gate to serializable OpenAI Agents run state", async () => {
    const adapter = driver(checkpoint("approval_required"));
    const gate = await beginRateLoopFrameworkApproval({
      driver: adapter,
      evaluation: { externalId: "execution_01" },
      preparation: { source: "source" },
    });
    const mapped = toOpenAiAgentsApproval(gate);

    expect(mapped.needsApproval).toBe(true);
    if (!mapped.needsApproval) throw new Error("expected approval");
    expect(pendingFromOpenAiAgentsState(mapped.state)).toEqual(
      mapped.state.pending,
    );
  });

  it("keeps the OpenAI SDK interruption pending until RateLoop release evidence verifies", async () => {
    const states = new Map<string, RateLoopOpenAiAgentsApprovalState>();
    const pendingGate = {
      action: "interrupt" as const,
      pending: {
        schemaVersion: "rateloop.framework-approval-pending.v1" as const,
        opportunityId: "opportunity_fixture_01",
        scopeCommitment: HASH_SCOPE,
        lifecycle: "pending" as const,
        lifecycleRevision: 2,
        evaluationCommitment: HASH_A,
        policyBindingHash: HASH_B,
      },
    };
    const refreshed = vi
      .fn()
      .mockResolvedValueOnce(pendingGate)
      .mockResolvedValueOnce({
        action: "release",
        reason: "signed_terminal_evidence",
        checkpoint: {
          ...checkpoint("completed", 3),
          verifiedReleaseEvidence: releaseEvidence("satisfied"),
        },
      });
    const openAi = createOpenAiAgentsApprovalAdapter({
      begin: vi.fn(async () => pendingGate),
      refresh: refreshed,
      store: {
        load: async (id) => states.get(id) ?? null,
        save: async (id, state) => {
          states.set(id, state);
        },
        remove: async (id) => {
          states.delete(id);
        },
      },
    });

    await expect(openAi.needsApproval({}, { prompt: "safe" })).rejects.toThrow(
      /toolCallId supplied during a run/u,
    );
    expect(
      await openAi.needsApproval({}, { prompt: "safe" }, "tool_call_01"),
    ).toBe(true);
    expect(await openAi.readyToApproveSdkInterruption("tool_call_01")).toBe(
      false,
    );
    expect(states.has("tool_call_01")).toBe(true);
    expect(await openAi.readyToApproveSdkInterruption("tool_call_01")).toBe(
      true,
    );
    expect(states.has("tool_call_01")).toBe(false);
  });

  it("gates stable MCP form elicitation on the client capability", async () => {
    const adapter = driver(checkpoint("approval_required"));
    const gate = await beginRateLoopFrameworkApproval({
      driver: adapter,
      evaluation: { externalId: "execution_01" },
      preparation: { source: "source" },
    });
    if (gate.action !== "interrupt") throw new Error("expected interrupt");

    expect(
      createRateLoopMcpElicitation({
        capabilities: {},
        pending: gate.pending,
        protocolVersion: "2025-06-18",
      }),
    ).toBeNull();
    const request = createRateLoopMcpElicitation({
      capabilities: { elicitation: {} },
      pending: gate.pending,
      protocolVersion: "2025-06-18",
    });
    expect(request).toMatchObject({
      method: "elicitation/create",
      params: { requestedSchema: { required: ["approve"] } },
    });
    expect(JSON.stringify(request)).not.toContain("source");
    expect(
      createRateLoopMcpElicitation({
        capabilities: { elicitation: { form: {} } },
        pending: gate.pending,
        protocolVersion: "2025-11-25",
      }),
    ).toBeNull();
    expect(
      parseRateLoopMcpElicitation({
        action: "accept",
        content: { approve: true },
      }),
    ).toBe("approved");
    expect(parseRateLoopMcpElicitation({ action: "decline" })).toBe("declined");
    expect(parseRateLoopMcpElicitation({ action: "cancel" })).toBe("cancelled");
  });
});
