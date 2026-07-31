import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { withEnglishAppTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("a private history card opens concise review details", async () => {
  const restoreDom = installTestDom();
  const { cleanup, fireEvent, render: baseRender, within } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { PrivateAssignmentCard } = await import("./PrivateAssignmentCard");

  try {
    render(
      <ul>
        <PrivateAssignmentCard
          assignment={{
            assignmentId: "hpua_history_detail",
            projectName: "Agent private reviews",
            dataClassification: "confidential",
            source: "customer_invited",
            status: "expired",
            paidAssignment: false,
            confidentialityTermsHash: null,
            assignmentExpiresAt: "2026-07-25T19:42:59.000Z",
            createdAt: "2026-07-25T18:42:59.000Z",
            updatedAt: "2026-07-25T19:42:59.000Z",
            caseCount: 1,
            reviewQuestion: "Is this suggestion correct and safe?",
          }}
        />
      </ul>,
    );

    const screen = within(document.body);
    const details = document.querySelector("details");
    const summary = screen.getByText("View details").closest("summary");
    assert.ok(details);
    assert.ok(summary);
    assert.equal(details.open, false);

    fireEvent.click(summary);

    assert.equal(details.open, true);
    assert.ok(screen.getByText("Is this suggestion correct and safe?"));
    assert.ok(screen.getByText("Unpaid"));
    assert.ok(screen.getByText(/No response was submitted before the deadline/iu));
  } finally {
    cleanup();
    restoreDom();
  }
});
