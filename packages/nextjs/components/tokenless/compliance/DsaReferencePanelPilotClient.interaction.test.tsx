import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { withEnglishAppTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "~~/components/tokenless/testing/dom";
import { DSA_REFERENCE_PANEL_RULES } from "~~/lib/tokenless/dsaReferencePanelPilotTypes";

const HASH = `sha256:${"a".repeat(64)}`;
const EPOCH_ID = `rse_${"1".repeat(40)}`;
const UNIT_A = "rsu_abcdefghijklmnopqrstuv";
const UNIT_B = "rsu_vutsrqponmlkjihgfedcba";

function baseEpoch() {
  return {
    workspaceId: "workspace_reference_panel",
    workspaceName: "Policy operations",
    projectId: "project_reference_panel",
    projectName: "July policy sample",
    epochId: EPOCH_ID,
    reportingWindowStart: "2026-07-01T00:00:00.000Z",
    reportingWindowEnd: "2026-07-31T00:00:00.000Z",
    rules: DSA_REFERENCE_PANEL_RULES,
  };
}

test("auditor sees fixed rules and freezes the exact immutable definition payload", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { DsaReferencePanelPilotClient } = await import("./DsaReferencePanelPilotClient");
  const previousFetch = globalThis.fetch;
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
  let frozen = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === "POST") {
      posts.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      frozen = true;
      return Response.json({ definitionHash: HASH }, { status: 201 });
    }
    return Response.json({
      epochs: [
        {
          ...baseEpoch(),
          role: "auditor",
          auditorReadiness: { registeredUnitCount: 0, terminalUnitCount: 0, units: [] },
          definition: frozen
            ? {
                version: 2,
                question: "Does the decision match the standard?",
                standardId: "dsa.policy",
                standardVersion: "2026-07",
                standardHash: HASH,
                definitionHash: HASH,
                createdAt: "2026-08-01T00:00:00.000Z",
              }
            : null,
        },
      ],
      adjudications: [],
    });
  };

  try {
    const view = render(<DsaReferencePanelPilotClient locale="en" />);
    assert.ok(await view.findByRole("heading", { name: "Fixed decision rules" }));
    assert.ok(view.getByText("Matches the policy → Fail"));
    assert.ok(view.getByText("Does not match the policy → Pass"));
    assert.equal(view.queryByRole("heading", { name: "Register a selected unit" }), null);

    const user = userEvent.setup({ document });
    await user.clear(view.getByLabelText("Definition version"));
    await user.type(view.getByLabelText("Definition version"), "2");
    await user.type(view.getByLabelText("Standard ID"), "dsa.policy");
    await user.type(view.getByLabelText("Standard version"), "2026-07");
    await user.type(view.getByLabelText("Standard file hash"), HASH);
    await user.type(view.getByLabelText("Review question"), "Does the decision match the standard?");
    await user.click(view.getByRole("button", { name: "Freeze reference definition" }));

    await waitFor(() => assert.equal(posts.length, 1));
    assert.equal(posts[0]?.url, "/api/account/workspaces/workspace_reference_panel/compliance/dsa/reference-panel");
    assert.deepEqual(posts[0]?.body, {
      action: "register_definition",
      projectId: "project_reference_panel",
      epochId: EPOCH_ID,
      version: 2,
      question: "Does the decision match the standard?",
      standardId: "dsa.policy",
      standardVersion: "2026-07",
      standardHash: HASH,
    });
    await waitFor(() => assert.ok(view.getByText("Does the decision match the standard?")));
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("manager can select only artifact-compatible run and registers the exact pair", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { DsaReferencePanelPilotClient } = await import("./DsaReferencePanelPilotClient");
  const previousFetch = globalThis.fetch;
  const posts: Record<string, unknown>[] = [];
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return Response.json({ unitHash: HASH }, { status: 201 });
    }
    return Response.json({
      epochs: [
        {
          ...baseEpoch(),
          role: "manager",
          definition: {
            version: 1,
            question: "Does the decision match the standard?",
            standardId: "dsa.policy",
            standardVersion: "2026-07",
            standardHash: HASH,
            definitionHash: HASH,
            createdAt: "2026-08-01T00:00:00.000Z",
          },
          managerReadiness: {
            selectedUnitCount: 2,
            sourceReadyUnitCount: 2,
            registeredUnitCount: 0,
            candidates: [
              {
                unitId: UNIT_A,
                publicDesignation: "Text policy classifier",
                decisionAt: "2026-07-08T00:00:00.000Z",
                sourceRecordsReady: true,
                registered: false,
              },
              {
                unitId: UNIT_B,
                publicDesignation: "Image policy classifier",
                decisionAt: "2026-07-09T00:00:00.000Z",
                sourceRecordsReady: true,
                registered: false,
              },
            ],
            preparedRuns: [
              {
                runId: "run_text",
                caseId: "case_text",
                suiteName: "Text named review",
                caseTitle: "Text decision",
                reviewerCount: 3,
                compatibleUnitIds: [UNIT_A],
              },
              {
                runId: "run_image",
                caseId: "case_image",
                suiteName: "Image named review",
                caseTitle: "Image decision",
                reviewerCount: 4,
                compatibleUnitIds: [UNIT_B],
              },
            ],
            registeredUnits: [],
            terminalUnitCount: 0,
            labelSetFrozen: false,
            canFreezeLabelSet: false,
          },
        },
      ],
      adjudications: [],
    });
  };

  try {
    const view = render(<DsaReferencePanelPilotClient locale="en" />);
    assert.ok(await view.findByRole("heading", { name: "Register a selected unit" }));
    assert.equal(view.queryByRole("button", { name: "Freeze reference definition" }), null);
    const user = userEvent.setup({ document });
    await user.selectOptions(view.getByLabelText("Selected case"), UNIT_A);
    assert.ok(view.getByRole("option", { name: /Text named review/ }));
    assert.equal(view.queryByRole("option", { name: /Image named review/ }), null);
    await user.selectOptions(view.getByLabelText("Frozen named-review run"), "run_text");
    await user.selectOptions(view.getByLabelText("Required language level"), "C2");
    await user.click(view.getByRole("button", { name: "Register unit" }));

    await waitFor(() => assert.equal(posts.length, 1));
    assert.deepEqual(posts[0], {
      action: "register_unit",
      projectId: "project_reference_panel",
      epochId: EPOCH_ID,
      unitId: UNIT_A,
      runId: "run_text",
      caseId: "case_text",
      requiredCefrLevel: "C2",
      requiredReviewerCount: 3,
    });
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("manager freezes only ready outcomes and then the complete label set", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { DsaReferencePanelPilotClient } = await import("./DsaReferencePanelPilotClient");
  const previousFetch = globalThis.fetch;
  const posts: Record<string, unknown>[] = [];
  let terminal = false;
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posts.push(body);
      if (body.action === "freeze_outcome") terminal = true;
      return Response.json({}, { status: 201 });
    }
    return Response.json({
      epochs: [
        {
          ...baseEpoch(),
          role: "manager",
          definition: {
            version: 1,
            question: "Does the decision match the standard?",
            standardId: "dsa.policy",
            standardVersion: "2026-07",
            standardHash: HASH,
            definitionHash: HASH,
            createdAt: "2026-08-01T00:00:00.000Z",
          },
          managerReadiness: {
            selectedUnitCount: 1,
            sourceReadyUnitCount: 1,
            registeredUnitCount: 1,
            candidates: [
              {
                unitId: UNIT_A,
                publicDesignation: "Text policy classifier",
                decisionAt: "2026-07-08T00:00:00.000Z",
                sourceRecordsReady: true,
                registered: true,
              },
            ],
            preparedRuns: [],
            registeredUnits: [
              {
                unitId: UNIT_A,
                publicDesignation: "Text policy classifier",
                requiredReviewerCount: 3,
                assignedReviewerCount: 3,
                responseCount: 3,
                assignmentDeadline: "2026-07-20T00:00:00.000Z",
                terminal,
                needsAdjudication: false,
                canFreezeOutcome: !terminal,
              },
            ],
            terminalUnitCount: terminal ? 1 : 0,
            labelSetFrozen: false,
            canFreezeLabelSet: terminal,
          },
        },
      ],
      adjudications: [],
    });
  };

  try {
    const view = render(<DsaReferencePanelPilotClient locale="en" />);
    const user = userEvent.setup({ document });
    await user.click(await view.findByRole("button", { name: "Freeze outcome" }));
    await waitFor(() => assert.equal(posts.length, 1));
    assert.deepEqual(posts[0], { action: "freeze_outcome", epochId: EPOCH_ID, unitId: UNIT_A });
    const labelButton = await view.findByRole("button", { name: "Freeze label set" });
    await user.click(labelButton);
    await waitFor(() => assert.equal(posts.length, 2));
    assert.deepEqual(posts[1], { action: "freeze_label_set", epochId: EPOCH_ID });
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("manager sees generic materialization failure state and retries it through the exact mutation route", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { DsaReferencePanelPilotClient } = await import("./DsaReferencePanelPilotClient");
  const previousFetch = globalThis.fetch;
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
  let recovered = false;
  globalThis.fetch = async (input, init) => {
    if (init?.method === "POST") {
      posts.push({ url: String(input), body: JSON.parse(String(init.body)) as Record<string, unknown> });
      recovered = true;
      return Response.json({ attemptedUnitCount: 1, completedUnitCount: 1 });
    }
    return Response.json({
      epochs: [
        {
          ...baseEpoch(),
          role: "manager",
          definition: {
            version: 1,
            question: "Does the decision match the standard?",
            standardId: "dsa.policy",
            standardVersion: "2026-07",
            standardHash: HASH,
            definitionHash: HASH,
            createdAt: "2026-08-01T00:00:00.000Z",
          },
          managerReadiness: {
            selectedUnitCount: 2,
            sourceReadyUnitCount: 2,
            registeredUnitCount: 2,
            candidates: [],
            preparedRuns: [],
            registeredUnits: [
              {
                unitId: UNIT_A,
                publicDesignation: "Text policy classifier",
                requiredReviewerCount: 3,
                assignedReviewerCount: 3,
                responseCount: recovered ? 3 : 2,
                responseMaterializationState: recovered ? "ready" : "retrying",
                responseMaterializationFailureCount: 3,
                responseMaterializationNextRetryAt: recovered ? null : "2026-07-20T00:00:00.000Z",
                assignmentDeadline: "2026-07-20T00:00:00.000Z",
                terminal: false,
                needsAdjudication: false,
                adjudicatorPrincipalId: null,
                adjudicationDeadline: null,
                canFreezeOutcome: false,
              },
              {
                unitId: UNIT_B,
                publicDesignation: "Image policy classifier",
                requiredReviewerCount: 2,
                assignedReviewerCount: 2,
                responseCount: 1,
                responseMaterializationState: "cooldown",
                responseMaterializationFailureCount: 8,
                responseMaterializationNextRetryAt: "2099-07-20T00:15:00.000Z",
                assignmentDeadline: "2099-07-21T00:00:00.000Z",
                terminal: false,
                needsAdjudication: false,
                adjudicatorPrincipalId: null,
                adjudicationDeadline: null,
                canFreezeOutcome: false,
              },
            ],
            terminalUnitCount: 0,
            labelSetFrozen: false,
            canFreezeLabelSet: false,
          },
        },
      ],
      adjudications: [],
    });
  };

  try {
    const view = render(<DsaReferencePanelPilotClient locale="en" />);
    assert.ok(await view.findByText("Response processing needs another attempt."));
    assert.ok(view.getByText("Failed attempts: 3"));
    assert.ok(view.getByText(/Response processing can be retried after/u));
    assert.equal(view.getAllByRole("button", { name: "Retry response processing" }).length, 1);
    await userEvent.setup({ document }).click(view.getByRole("button", { name: "Retry response processing" }));
    await waitFor(() => assert.equal(posts.length, 1));
    assert.deepEqual(posts[0], {
      url: "/api/account/compliance/dsa/reference-panel",
      body: { action: "reconcile_response_evidence" },
    });
    await waitFor(() => assert.equal(view.queryByRole("button", { name: "Retry response processing" }), null));
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("auditor sees aggregate coverage and can declare only an elapsed nonresponse gap", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { DsaReferencePanelPilotClient } = await import("./DsaReferencePanelPilotClient");
  const previousFetch = globalThis.fetch;
  const posts: Record<string, unknown>[] = [];
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return Response.json({}, { status: 201 });
    }
    return Response.json({
      epochs: [
        {
          ...baseEpoch(),
          role: "auditor",
          definition: {
            version: 1,
            question: "Does the decision match the standard?",
            standardId: "dsa.policy",
            standardVersion: "2026-07",
            standardHash: HASH,
            definitionHash: HASH,
            createdAt: "2026-08-01T00:00:00.000Z",
          },
          auditorReadiness: {
            registeredUnitCount: 1,
            terminalUnitCount: 0,
            units: [
              {
                unitId: UNIT_A,
                publicDesignation: "Text policy classifier",
                requiredReviewerCount: 3,
                assignedReviewerCount: 3,
                responseCount: 2,
                assignmentDeadline: "2026-07-20T00:00:00.000Z",
                terminal: false,
                canDeclareGap: true,
              },
            ],
          },
        },
      ],
      adjudications: [],
    });
  };

  try {
    const view = render(<DsaReferencePanelPilotClient locale="en" />);
    assert.equal(view.queryByRole("button", { name: "Freeze outcome" }), null);
    assert.equal(view.queryByRole("button", { name: "Freeze label set" }), null);
    await userEvent.setup({ document }).click(await view.findByRole("button", { name: "Declare nonresponse gap" }));
    await waitFor(() => assert.equal(posts.length, 1));
    assert.deepEqual(posts[0], {
      action: "declare_gap",
      epochId: EPOCH_ID,
      unitId: UNIT_A,
      reason: "reviewer_nonresponse",
    });
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("qualified adjudicator must load the purpose-bound artifact and clear conflict before deciding", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { DsaReferencePanelPilotClient } = await import("./DsaReferencePanelPilotClient");
  const previousFetch = globalThis.fetch;
  const posts: Record<string, unknown>[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posts.push(body);
      if (body.action === "open_adjudication_artifact") {
        return Response.json({
          artifactId: "artifact_exact",
          leaseId: "lease_exact",
          expiresAt: "2030-01-01T00:00:00Z",
        });
      }
      return Response.json({}, { status: 201 });
    }
    if (url.includes(`/adjudications/${UNIT_A}/artifact?epochId=${EPOCH_ID}&leaseId=lease_exact`)) {
      return new Response("Exact blinded case", { headers: { "Content-Type": "text/plain" } });
    }
    return Response.json({
      epochs: [],
      adjudications: [
        {
          workspaceId: "workspace_hidden",
          epochId: EPOCH_ID,
          unitId: UNIT_A,
          question: "Does this decision match the frozen policy?",
        },
      ],
    });
  };

  try {
    const view = render(<DsaReferencePanelPilotClient locale="en" />);
    const user = userEvent.setup({ document });
    await user.click(await view.findByRole("button", { name: "Open exact artifact" }));
    assert.deepEqual(posts[0], { action: "open_adjudication_artifact", epochId: EPOCH_ID, unitId: UNIT_A });
    assert.ok(await view.findByText("Exact blinded case"));
    const decide = view.getByRole("button", { name: "Record adjudication" });
    assert.equal(decide.hasAttribute("disabled"), true);
    await user.selectOptions(view.getByRole("combobox", { name: "Adjudicated outcome" }), "fail");
    await user.type(
      view.getByRole("textbox", { name: /^Adjudication rationale/ }),
      "The exact artifact conflicts with the frozen policy.",
    );
    await user.click(view.getByRole("checkbox", { name: /I confirm that I have no conflict/ }));
    await waitFor(() => assert.equal(decide.hasAttribute("disabled"), false));
    await user.click(decide);
    await waitFor(() => assert.equal(posts.length, 2));
    assert.deepEqual(posts[1], {
      action: "adjudicate",
      epochId: EPOCH_ID,
      unitId: UNIT_A,
      referenceLabel: "fail",
      rationale: "The exact artifact conflicts with the frozen policy.",
      conflictDeclaration: { hasConflict: false, relationships: [] },
    });
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
