import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("a connected agent without a binding receives a usable first-time review form", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, screen } = await import("@testing-library/react");
  const { AgentHumanReviewEditor } = await import("./AgentHumanReviewEditor");
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
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
    if (url.endsWith("/private-groups")) {
      return Response.json({ groups: [{ groupId: "group-1", name: "Reviewers", status: "active" }] });
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
    assert.equal(
      (screen.getByRole("combobox", { name: "Invited reviewer group" }) as HTMLSelectElement).value,
      "group-1",
    );
    assert.equal(
      (screen.getByRole("combobox", { name: "When should RateLoop require human review?" }) as HTMLSelectElement).value,
      "adaptive",
    );
    assert.equal((screen.getByRole("radio", { name: "Send automatically" }) as HTMLInputElement).disabled, false);
    assert.ok(screen.getByRole("button", { name: "Finish setup" }));
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
