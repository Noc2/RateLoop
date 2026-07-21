import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";
import type { EvaluationModelProfile } from "~~/lib/tokenless/evaluationDashboard";

function profile(input: {
  hashCharacter: string;
  provider: string;
  model: string;
  agentName: string;
  agreementBps: number | null;
}): EvaluationModelProfile {
  return {
    profileHash: `sha256:${input.hashCharacter.repeat(64)}`,
    primary: {
      provider: input.provider,
      requestedModel: input.model,
      resolvedModel: null,
      modelVersion: null,
    },
    contributors: [],
    orchestrationMode: "single_model",
    agentNames: [input.agentName],
    executionCount: 1,
    failedExecutionCount: 0,
    opportunityCount: 1,
    reviewRequestedCount: input.agreementBps === null ? 0 : 1,
    skippedCount: input.agreementBps === null ? 1 : 0,
    comparableCount: input.agreementBps === null ? 0 : 1,
    agreementCount: input.agreementBps === 10_000 ? 1 : 0,
    humanAgreementBps: input.agreementBps,
    averageDurationMs: 1_000,
    inputTokenTotal: 100,
    outputTokenTotal: 25,
    lastExecutedAt: "2026-07-20T10:00:00.000Z",
    scopes: [],
    daily: [],
    recentExecutions: [],
  };
}

test("selecting a model profile switches every evidence summary", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, within } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { ModelEvidencePanel } = await import("./ModelEvidencePanel");
  const profiles = [
    profile({ hashCharacter: "a", provider: "OpenAI", model: "gpt-sol", agentName: "Agent A", agreementBps: 10_000 }),
    profile({
      hashCharacter: "b",
      provider: "Anthropic",
      model: "claude-sonnet",
      agentName: "Agent B",
      agreementBps: null,
    }),
  ];

  try {
    render(<ModelEvidencePanel profiles={profiles} />);
    const screen = within(document.body);
    const selector = screen.getByRole("combobox", { name: "Model profile" }) as HTMLSelectElement;
    assert.equal(selector.value, profiles[0]!.profileHash);
    assert.ok(screen.getByText(/Agent A · Single model/));
    assert.ok(screen.getByText("100.0%"));

    await userEvent.setup().selectOptions(selector, profiles[1]!.profileHash);

    assert.equal(selector.value, profiles[1]!.profileHash);
    assert.ok(screen.getByText(/Agent B · Single model/));
    assert.ok(screen.getByText("Pending"));
    assert.ok(screen.getByText("No comparable human results yet."));
  } finally {
    cleanup();
    restoreDom();
  }
});
