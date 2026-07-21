import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("the editor uses workspace reviewer readiness without exposing legacy group controls", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, screen, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { AgentHumanReviewEditor } = await import("./AgentHumanReviewEditor");
  const previousFetch = globalThis.fetch;
  const requests: Array<{ method: string; url: string }> = [];
  globalThis.fetch = async input => {
    const url = String(input);
    requests.push({ method: "GET", url });
    if (url.endsWith("/human-review")) {
      return Response.json({
        bindingRevision: null,
        configuration: null,
        connection: {
          allowedWorkflowKeys: ["general-assistance"],
          connectionStatus: "connected",
          integrationId: "integration-1",
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    render(<AgentHumanReviewEditor workspaceId="workspace-1" agentId="agent-1" />);

    assert.ok(await screen.findByRole("heading", { name: "Finish human-review setup" }));
    assert.equal(
      (screen.getByRole("textbox", { name: "Review question" }) as HTMLTextAreaElement).value,
      "Is this response safe and correct?",
    );
    assert.equal(screen.queryByRole("combobox", { name: "Invited reviewer group" }), null);
    assert.equal(
      (screen.getByRole("combobox", { name: "When should RateLoop require human review?" }) as HTMLSelectElement).value,
      "adaptive",
    );
    assert.equal((screen.getByRole("radio", { name: "Send automatically" }) as HTMLInputElement).disabled, false);
    await userEvent.setup().click(screen.getByRole("button", { name: "Finish setup" }));
    assert.ok(
      await screen.findByText("Workspace reviewer routing is not ready. Invite reviewers in Reviews, then try again."),
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url.endsWith("/human-review"), true);
    await act(async () => cleanup());

    let savedBody: Record<string, unknown> | null = null;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (!url.endsWith("/human-review")) throw new Error(`Unexpected request: ${url}`);
      if (init?.method === "PUT") {
        savedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json({});
      }
      return Response.json({
        bindingRevision: 4,
        configuration: {
          authority: "check_only",
          delegation: null,
          selection: {
            value: {
              agreementThresholdBps: 7_000,
              criticalRiskTiers: ["critical"],
              enforcementMode: "advisory",
              fixedRateBps: 10_000,
              maximumLatencyMs: 120_000,
              maximumUnreviewedGap: 20,
              minimumConfidenceBps: 7_000,
              mode: "fixed",
              requiredRiskTiers: ["high"],
            },
          },
          requestProfile: {
            value: {
              audience: "private_invited",
              compensationMode: "unpaid",
              criterion: "Is this response safe and correct?",
              feedbackBonusEnabled: false,
              negativeLabel: "Reject",
              panelSize: 2,
              positiveLabel: "Approve",
              privateGroupId: "compatibility-routing-id",
              questionAuthority: "owner_fixed",
              rationaleMode: "required",
              responseWindowSeconds: 3_600,
            },
          },
        },
        connection: null,
      });
    };

    render(<AgentHumanReviewEditor workspaceId="workspace-1" agentId="agent-1" />);
    await screen.findByRole("heading", { name: "Human review" });
    assert.equal(screen.queryByRole("combobox", { name: "Invited reviewer group" }), null);

    await userEvent.setup().click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => assert.ok(savedBody));

    const requestProfile = (savedBody as unknown as Record<string, unknown>).requestProfile as
      | { privateGroupId?: unknown }
      | undefined;
    assert.equal(requestProfile?.privateGroupId, "compatibility-routing-id");
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
