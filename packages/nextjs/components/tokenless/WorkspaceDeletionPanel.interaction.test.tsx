import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { withEnglishAppTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("a funded workspace owner can queue verified fund resolution without forfeiting the balance", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render: baseRender } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { WorkspaceDeletionPanel } = await import("./WorkspaceDeletionPanel");
  const previousFetch = globalThis.fetch;
  const requests: Array<Record<string, unknown>> = [];

  globalThis.fetch = async (_input, init) => {
    if (init?.method === "POST") {
      requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return Response.json(
        {
          deleted: false,
          requestId: "dsr_funded_workspace",
          resolutionId: "wfr_funded_workspace",
          status: "blocked_by_funds",
        },
        { status: 202 },
      );
    }
    return Response.json({
      workspace: { workspaceId: "workspace-funded", name: "Funded workspace" },
      immediate: false,
      blockers: [
        {
          code: "workspace_funds_active",
          message:
            "Workspace funds require a verified refund before deletion. Confirming deletion queues a manual fund-resolution request without forfeiting the balance.",
        },
      ],
      impact: {
        otherMembers: 0,
        agents: 0,
        activeWork: 0,
        privateObjects: 0,
        retainedPrivateQuotes: 0,
        publicRecords: 0,
        legalHolds: 0,
        settledAtomic: "0",
        reservedAtomic: "0",
        availableAtomic: "11000000",
      },
      warnings: [],
    });
  };

  try {
    const view = render(<WorkspaceDeletionPanel workspaceId="workspace-funded" workspaceName="Funded workspace" />);
    const user = userEvent.setup({ document });
    await user.click(view.getByRole("button", { name: "Delete workspace" }));

    const confirmation = await view.findByRole("textbox", { name: /Type DELETE to confirm/u });
    const submit = view.getByRole("button", { name: "Request verified refund" });
    assert.equal(submit.hasAttribute("disabled"), true);
    await user.type(confirmation, "DELETE");
    assert.equal(submit.hasAttribute("disabled"), false);
    await user.click(submit);

    assert.deepEqual(requests, [{ confirmation: "DELETE" }]);
    const status = await view.findByRole("status");
    assert.match(status.textContent ?? "", /balance has not been forfeited/u);
    assert.match(status.textContent ?? "", /wfr_funded_workspace/u);
    assert.equal(submit.hasAttribute("disabled"), true);
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
