import { describe, expect, it, vi } from "vitest";
import type {
  AutomatedEvalClient,
  AutomatedEvalIngestResult,
  AutomatedEvalLabeledDataItem,
  AutomatedEvalReceipt,
} from "../automatedEval";
import { createAutomatedEvalClient } from "../automatedEval";
import { adaptInspectEvalLog } from "../inspectAutomatedEval";
import { exportHumanLabelsToLangfuse } from "../langfuseHumanLabels";
import {
  RateLoopPromptfooProvider,
  rateLoopPromptfooAssertion,
} from "../promptfooAutomatedEval";

const HASH = `sha256:${"11".repeat(32)}`;

function receipt(
  outcome: "pass" | "fail" | "uncertain" = "pass",
): AutomatedEvalReceipt {
  return {
    schemaVersion: "rateloop.automated-eval-receipt.v1",
    provider: "promptfoo",
    externalReceiptId: `promptfoo-${outcome}-0001`,
    agentId: "agt_adapter",
    agentVersionId: "agv_adapter",
    evaluator: { name: "safety", version: "1.0.0" },
    evaluation: {
      checkName: "safety",
      outcome,
      scoreBps: 5_000,
      thresholdBps: 8_000,
    },
    contentCommitment: HASH,
    observedAt: "2026-07-16T12:00:00.000Z",
    ...(outcome === "uncertain"
      ? {
          reviewContext: {
            policyId: "arp_adapter",
            policyVersion: 1,
            workflowKey: "support_reply",
            riskTier: "guardrail_uncertain",
            audiencePolicyHash: HASH,
            metadataComplete: true,
            execution: { externalExecutionId: "execution-adapter" },
          },
        }
      : {}),
  };
}

function ingestResult(
  outcome: "pass" | "fail" | "uncertain",
): AutomatedEvalIngestResult {
  return {
    schemaVersion: "rateloop.automated-eval-ingest-result.v1",
    receiptId: "aer_123",
    receiptHash: HASH,
    provider: "promptfoo",
    automatedSignal: {
      sourceKind: "automated_evaluation",
      outcome,
      scoreBps: 5_000,
      thresholdBps: 8_000,
      humanVerdict: null,
    },
    humanReview:
      outcome === "uncertain"
        ? {
            required: true,
            trigger: "guardrail_uncertain",
            opportunityId: "aop_123",
            decision: "required",
          }
        : null,
    replayed: false,
  };
}

describe("automated-eval API client", () => {
  it("uses tenant API-key auth and idempotency without accepting insecure remote endpoints", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(ingestResult("pass")), { status: 201 }),
    );
    const client = createAutomatedEvalClient({
      baseUrl: "https://rateloop-tokenless.vercel.app",
      apiKey: "workspace-secret",
      fetchImpl,
    });
    await client.ingest(receipt(), { idempotencyKey: "promptfoo:pass:0001" });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://rateloop-tokenless.vercel.app/api/assurance/v1/evaluations/receipts",
    );
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer workspace-secret");
    expect(headers.get("idempotency-key")).toBe("promptfoo:pass:0001");
    expect(() =>
      createAutomatedEvalClient({
        baseUrl: "http://example.com",
        apiKey: "secret",
      }),
    ).toThrow(/HTTPS/u);
  });

  it("retrieves one eventual result by its opaque receipt ID", async () => {
    const receiptId = `aer_${"12".repeat(20)}`;
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            schemaVersion: "rateloop.automated-eval-result.v1",
            receiptId,
            receiptHash: HASH,
            provider: "promptfoo",
            evaluator: { name: "safety", version: "1.0.0" },
            checkName: "safety",
            contentCommitment: HASH,
            observedAt: "2026-07-16T12:00:00.000Z",
            automatedSignal: ingestResult("uncertain").automatedSignal,
            humanReview: {
              required: true,
              trigger: "guardrail_uncertain",
              opportunityId: "aop_123",
              state: "pending",
              verdict: null,
            },
          }),
          { status: 200 },
        ),
    );
    const client = createAutomatedEvalClient({
      baseUrl: "https://rateloop-tokenless.vercel.app",
      apiKey: "workspace-secret",
      fetchImpl,
    });
    const result = await client.getResult(receiptId);
    expect(result.humanReview?.state).toBe("pending");
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      `https://rateloop-tokenless.vercel.app/api/assurance/v1/evaluations/receipts/${receiptId}`,
    );
  });
});

describe("Promptfoo provider and assertion", () => {
  it("posts a commitment-only receipt and treats uncertainty as escalation, never a human verdict", async () => {
    const client = {
      ingest: vi.fn(async () => ingestResult("uncertain")),
    } as unknown as AutomatedEvalClient;
    const provider = new RateLoopPromptfooProvider({ config: { client } });
    const response = await provider.callApi(
      JSON.stringify(receipt("uncertain")),
    );
    expect(provider.id()).toBe("rateloop:automated-eval-escalation");
    expect(client.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ contentCommitment: HASH }),
      expect.objectContaining({
        idempotencyKey: expect.stringContaining("promptfoo:"),
      }),
    );
    expect(response.metadata.rateloop.humanVerdict).toBeNull();
    expect(
      rateLoopPromptfooAssertion(response.output, {
        metadata: response.metadata,
      }),
    ).toEqual(
      expect.objectContaining({
        pass: false,
        reason: expect.stringMatching(/human review is required/u),
      }),
    );
  });
});

describe("Inspect eval-log adapter", () => {
  it("reads score summaries and RateLoop metadata without touching raw sample content", () => {
    const sample: Record<string, unknown> = {
      id: "sample-1",
      scores: { safety: { value: 0.5, explanation: "must not be exported" } },
      metadata: {
        rateloop: {
          agentId: "agt_inspect",
          agentVersionId: "agv_inspect",
          contentCommitment: HASH,
          observedAt: "2026-07-16T12:00:00.000Z",
          evaluatorVersion: "0.3.142",
          automatedOutcome: "uncertain",
          reviewContext: {
            policyId: "arp_inspect",
            policyVersion: 1,
            workflowKey: "eval_task",
            riskTier: "guardrail_uncertain",
            audiencePolicyHash: HASH,
            metadataComplete: true,
            execution: { externalExecutionId: "inspect-eval" },
          },
        },
      },
    };
    Object.defineProperty(sample, "input", {
      get: () => {
        throw new Error("raw input read");
      },
    });
    Object.defineProperty(sample, "output", {
      get: () => {
        throw new Error("raw output read");
      },
    });
    const [adapted] = adaptInspectEvalLog(
      { eval: { eval_id: "eval-1" }, samples: [sample] },
      { scorer: "safety", thresholdBps: 8_000 },
    );
    expect(adapted?.provider).toBe("inspect");
    expect(adapted?.evaluation.outcome).toBe("uncertain");
    expect(adapted?.evaluation.scoreBps).toBe(5_000);
    expect(JSON.stringify(adapted)).not.toContain("must not be exported");
    expect(() =>
      adaptInspectEvalLog(
        {
          eval: { eval_id: "eval-large" },
          samples: Array.from({ length: 501 }, () => ({})),
        },
        { scorer: "safety" },
      ),
    ).toThrow(/exceeds 500 samples/u);
  });
});

describe("Langfuse labeled-data exporter", () => {
  it("exports only the completed human label as an idempotent categorical score", async () => {
    const item: AutomatedEvalLabeledDataItem = {
      receiptId: "aer_label",
      receiptHash: HASH,
      externalReferenceHash: HASH,
      provider: "inspect",
      evaluator: { name: "safety", version: "1.0.0" },
      checkName: "safety",
      automatedOutcome: "uncertain",
      automatedScoreBps: 5_000,
      automatedThresholdBps: 8_000,
      contentCommitment: HASH,
      opportunityId: "aop_label",
      humanLabel: "negative",
      humanResultCommitment: `sha256:${"22".repeat(32)}`,
      responseCount: 3,
      observedAt: "2026-07-16T12:00:00.000Z",
      labeledAt: "2026-07-16T12:10:00.000Z",
    };
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "score" }), { status: 200 }),
    );
    const first = await exportHumanLabelsToLangfuse({
      baseUrl: "https://cloud.langfuse.com",
      publicKey: "pk-lf-test",
      secretKey: "sk-lf-test",
      items: [item],
      resolveSubject: () => ({
        traceId: "trace-123",
        observationId: "generation-456",
      }),
      fetchImpl,
    });
    expect(first).toEqual({ exported: 1, skipped: 0 });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://cloud.langfuse.com/api/public/scores",
    );
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toMatch(/^Basic /u);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body).toEqual(
      expect.objectContaining({
        traceId: "trace-123",
        observationId: "generation-456",
        name: "rateloop.human_verdict",
        value: "negative",
        dataType: "CATEGORICAL",
      }),
    );
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(JSON.stringify(body)).not.toContain("uncertain");
  });
});
