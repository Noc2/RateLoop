import React from "react";
import type { AssignmentTask } from "./HumanAssuranceRaterClient";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { withEnglishAppTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "~~/components/tokenless/testing/dom";

const PRINCIPAL_A = "rlp_private_reviewer_a";
const PRINCIPAL_B = "rlp_private_reviewer_b";
const directTerms = {
  groupName: "Deployment reviewers",
  purpose: "Review the assigned agent output without sharing it.",
  policy: {
    schemaVersion: "rateloop.private-group-policy.v2",
    dataClassifications: ["confidential"],
    exportAllowed: false,
  },
};

const privateTask: AssignmentTask = {
  assignmentId: "haas_private_session_guard",
  runId: "har_private_session_guard",
  source: "customer_invited",
  runManifestHash: `sha256:${"1".repeat(64)}`,
  policyHash: `sha256:${"2".repeat(64)}`,
  qualificationProvenance: [],
  rubric: {
    prompt: "Which answer is safer?",
    failureTags: [{ key: "unsafe", label: "Unsafe" }],
    rationale: { mode: "required", minLength: 10, maxLength: 2_000 },
  },
  cases: [
    {
      caseId: "hacase_private_session_guard",
      position: 0,
      title: "Private session guard content",
      instructions: "Compare the private artifacts.",
      options: [
        { key: "A", artifactId: "haa_private_a", leaseId: "lease_private_a", expiresAt: "2030-01-01T00:00:00.000Z" },
        { key: "B", artifactId: "haa_private_b", leaseId: "lease_private_b", expiresAt: "2030-01-01T00:00:00.000Z" },
      ],
      context: [],
      objectiveReference: null,
    },
  ],
};

const binaryTask: AssignmentTask = {
  ...privateTask,
  assignmentId: "hpua_1111111111111111111111111111111111111111",
  runId: "hpud_2222222222222222222222222222222222222222",
  taskKind: "binary_review",
  compensationMode: "unpaid",
  forecastRequired: false,
  settlement: null,
  rubric: {
    prompt: "Is the agent output correct?",
    failureTags: [],
    rationale: { mode: "off", minLength: 0, maxLength: 2_000 },
  },
  cases: [
    {
      caseId: "hpr_binary_session_guard",
      position: 0,
      title: "Review the agent output",
      instructions: "Is the agent output correct?",
      options: [],
      context: [],
      objectiveReference: null,
      binaryReview: {
        positiveLabel: "Approve",
        negativeLabel: "Reject",
        source: {
          artifactId: "artifact_binary_source",
          leaseId: "lease_binary_source",
          expiresAt: "2030-01-01T00:00:00.000Z",
          contentType: "text/plain",
        },
        suggestion: {
          artifactId: "artifact_binary_suggestion",
          leaseId: "lease_binary_suggestion",
          expiresAt: "2030-01-01T00:00:00.000Z",
          contentType: "text/plain",
        },
      },
    },
  ],
};

const dsaTask = {
  assignmentId: "haas_dsa_named_panel_browser",
  case: {
    schemaVersion: "rateloop.dsa-blinded-case.v1",
    blindedCaseId: `dsa_case_${"a".repeat(40)}`,
    content: {
      artifactId: "artifact_dsa_candidate",
      artifactVersion: 1,
      contentHash: `sha256:${"3".repeat(64)}`,
      contentType: "text/plain",
      language: "en",
    },
    policy: {
      categoryCode: "platform-integrity",
      policyHash: `sha256:${"4".repeat(64)}`,
      policyVersion: 1,
      question: "Does this content violate the frozen platform-integrity policy?",
    },
    reference: {
      populationId: "population_browser",
      populationVersion: 1,
      frameId: "frame_browser",
      frameVersion: 1,
      sampleId: "rse_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sampleVersion: 1,
      position: 0,
    },
    mappingCommitment: `sha256:${"5".repeat(64)}`,
  },
  responseContract: {
    schemaVersion: "rateloop.dsa-named-panel-response.v1",
    caseId: "hacase_dsa_browser",
    choices: ["policy_matches", "policy_does_not_match"],
    rationale: { required: true, maximumLength: 2_000 },
  },
};

test("direct private tasks fail closed unless unpaid capabilities are explicit and unambiguous", async () => {
  const { validateLoadedAssignmentTask } = await import("./HumanAssuranceRaterClient");
  assert.equal(validateLoadedAssignmentTask(binaryTask).forecastRequired, false);

  const missingCapability = { ...binaryTask } as Record<string, unknown>;
  delete missingCapability.compensationMode;
  assert.throws(
    () => validateLoadedAssignmentTask(missingCapability),
    /unsupported compensation or settlement capabilities/u,
  );
  assert.throws(
    () => validateLoadedAssignmentTask({ ...binaryTask, forecastRequired: true }),
    /unsupported compensation or settlement capabilities/u,
  );
  assert.throws(
    () => validateLoadedAssignmentTask({ ...binaryTask, compensationMode: "usdc", settlement: {} }),
    /unsupported compensation or settlement capabilities/u,
  );
});

test("DSA reference-panel tasks are normalized only from the exact blinded response contract", async () => {
  const { validateLoadedAssignmentTask } = await import("./HumanAssuranceRaterClient");
  const normalized = validateLoadedAssignmentTask(dsaTask);
  assert.equal(normalized.taskKind, "dsa_reference_panel");
  assert.equal(normalized.rubric.prompt, dsaTask.case.policy.question);
  assert.equal(normalized.cases[0]?.dsaReferencePanel?.artifactId, dsaTask.case.content.artifactId);
  assert.deepEqual(normalized.cases[0]?.dsaReferencePanel?.choices, ["policy_matches", "policy_does_not_match"]);

  assert.throws(
    () =>
      validateLoadedAssignmentTask({
        ...dsaTask,
        responseContract: { ...dsaTask.responseContract, choices: ["policy_does_not_match", "policy_matches"] },
      }),
    /DSA reference-panel task is incomplete/u,
  );
  assert.throws(
    () =>
      validateLoadedAssignmentTask({
        ...dsaTask,
        case: { ...dsaTask.case, mappingCommitment: "not-a-digest" },
      }),
    /DSA reference-panel task is incomplete/u,
  );
  assert.throws(
    () =>
      validateLoadedAssignmentTask({
        ...dsaTask,
        case: { ...dsaTask.case, content: { ...dsaTask.case.content, contentType: "invalid" } },
      }),
    /DSA reference-panel task is incomplete/u,
  );
});

function authenticatedSession(principalId: string) {
  return {
    authenticated: true,
    principalId,
    authProvider: "email_otp",
    displayName: null,
    expiresAt: "2030-01-01T00:00:00.000Z",
    wallets: { funding: null, payout: null, recovery: null },
  };
}

function privateArtifactResponse(url: string) {
  const artifactText = new Map([
    ["artifact_binary_source", "User asked whether the deployment is ready."],
    ["artifact_binary_suggestion", "The agent answered that every required check passed."],
    ["artifact_dsa_candidate", "Blinded candidate content for the policy decision."],
    ["haa_private_a", "Candidate A private content."],
    ["haa_private_b", "Candidate B private content."],
    ["haa_private_a_2", "Candidate A second private content."],
    ["haa_private_b_2", "Candidate B second private content."],
  ]).entries();
  for (const [artifactId, body] of artifactText) {
    if (url.includes(`/artifacts/${artifactId}?`) || url.endsWith(`/artifacts/${artifactId}`)) {
      return new Response(body, { headers: { "Content-Type": "text/plain" } });
    }
  }
  return null;
}

test("private-review credentials stay behind a manual fallback", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, screen } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { HumanAssuranceRaterClient } = await import("./HumanAssuranceRaterClient");

  try {
    render(<HumanAssuranceRaterClient />);
    assert.equal(screen.queryByLabelText("Assignment ID"), null);
    assert.equal(screen.queryByLabelText("Confidentiality terms hash"), null);
    await userEvent.setup().click(screen.getByRole("button", { name: "Enter details manually" }));
    assert.ok(screen.getByLabelText("Assignment ID"));
    assert.ok(screen.getByLabelText("Confidentiality terms hash"));
  } finally {
    cleanup();
    restoreDom();
  }
});

test("direct invitation links retain credentials while Discover history does not expose them", () => {
  const page = readFileSync(new URL("../../app/[locale]/(app)/human/HumanSectionPage.tsx", import.meta.url), "utf8");
  const card = readFileSync(new URL("./answer/PrivateAssignmentCard.tsx", import.meta.url), "utf8");
  assert.match(page, /initialAssignmentId=\{searchParams\.assignment\}/);
  assert.match(page, /initialTermsHash=\{searchParams\.terms\}/);
  assert.doesNotMatch(card, /assignment\.assignmentId/u);
  assert.doesNotMatch(card, /href=/u);
  assert.doesNotMatch(card, /encodeURIComponent/u);
});

test("closed assignments are distinguished from expired assignments", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { PrivateAssignmentCard } = await import("./answer/PrivateAssignmentCard");
  const assignment = {
    assignmentId: "assignment-status",
    projectName: "Status review",
    dataClassification: null,
    source: null,
    status: "released",
    paidAssignment: false,
    confidentialityTermsHash: null,
    assignmentExpiresAt: "2999-01-01T00:00:00.000Z",
    caseCount: 1,
  };

  try {
    const view = render(<PrivateAssignmentCard assignment={assignment} />);
    assert.ok(view.getByText("Closed"));
    assert.equal(view.queryByText("Expired"), null);

    view.rerender(<PrivateAssignmentCard assignment={{ ...assignment, status: "expired" }} />);
    assert.ok(view.getAllByText("Expired").length > 0);

    view.rerender(
      <PrivateAssignmentCard
        assignment={{ ...assignment, status: "accepted", assignmentExpiresAt: "2000-01-01T00:00:00.000Z" }}
      />,
    );
    assert.ok(view.getAllByText("Expired").length > 0);
  } finally {
    cleanup();
    restoreDom();
  }
});

test("an unchanged private-group policy opens without asking for terms again", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { HumanAssuranceRaterClient } = await import("./HumanAssuranceRaterClient");
  const previousFetch = globalThis.fetch;
  const termsHash = `sha256:${"a".repeat(64)}`;
  const acceptanceBody: { current: Record<string, unknown> | null } = { current: null };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "/api/auth/session") return Response.json(authenticatedSession(PRINCIPAL_A));
    if (url.includes("/accept?terms=")) {
      return Response.json({
        assignmentId: binaryTask.assignmentId,
        state: "ready",
        termsAccepted: true,
        terms: directTerms,
        responseDeadline: "2030-01-01T00:00:00.000Z",
      });
    }
    if (url.endsWith("/accept?includeTask=1")) {
      acceptanceBody.current = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ acceptance: { accepted: true }, task: binaryTask });
    }
    const artifact = privateArtifactResponse(url);
    if (artifact) return artifact;
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    window.history.replaceState(null, "", "/human/review?scope=private&source=inbox#review-queue");
    const view = render(
      <HumanAssuranceRaterClient
        principalId={PRINCIPAL_A}
        initialAssignmentId={binaryTask.assignmentId}
        initialTermsHash={termsHash}
      />,
    );
    await waitFor(() => assert.ok(view.getByText("Confidentiality terms already accepted for this reviewer group.")));
    assert.ok(view.getByText("Review the assigned agent output without sharing it."));
    assert.ok(view.getByText("View exact policy"));
    assert.ok(view.getByText("Not allowed"));
    assert.equal(view.queryByRole("checkbox"), null);
    await userEvent.setup({ document }).click(view.getByRole("button", { name: "Open assignment" }));
    await waitFor(() => assert.ok(view.getByRole("heading", { name: "Complete your assigned review" })));
    assert.equal(acceptanceBody.current?.confidentialityTermsAccepted, false);
    assert.equal(acceptanceBody.current?.confidentialityTermsHash, termsHash);
    assert.equal(
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
      `/human/review?scope=private&source=inbox&assignment=${binaryTask.assignmentId}&terms=${encodeURIComponent(
        termsHash,
      )}#review-queue`,
    );
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("a DSA named-panel reviewer confirms conflicts, renews exact access, and submits the policy response", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { HumanAssuranceRaterClient } = await import("./HumanAssuranceRaterClient");
  const previousFetch = globalThis.fetch;
  const termsHash = `sha256:${"6".repeat(64)}`;
  const genericAcceptBodies: Record<string, unknown>[] = [];
  const panelAcceptBodies: Record<string, unknown>[] = [];
  const submission: { current: Record<string, unknown> | null } = { current: null };
  let artifactReads = 0;

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "/api/auth/session") return Response.json(authenticatedSession(PRINCIPAL_A));
    if (url.endsWith("/accept?includeTask=1") && init?.method === "POST") {
      genericAcceptBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return Response.json({
        acceptance: {
          assignmentId: dsaTask.assignmentId,
          assignmentExpiresAt: "2030-01-02T00:00:00.000Z",
          accepted: true,
          replay: genericAcceptBodies.length > 1,
          leases: [],
          requiresDsaReferencePanelAcceptance: true,
        },
        task: null,
        nextAction: "accept_dsa_reference_panel",
      });
    }
    if (url.endsWith("/dsa-reference-panel") && init?.method === "POST") {
      panelAcceptBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return Response.json({
        assignmentId: dsaTask.assignmentId,
        unitId: "rsu_browser_named_panel_1",
        assignmentSnapshotHash: `sha256:${"7".repeat(64)}`,
        idempotent: panelAcceptBodies.length > 1,
        leaseExpiresAt: "2030-01-01T00:05:00.000Z",
      });
    }
    if (url.endsWith("/task") && (!init?.method || init.method === "GET")) return Response.json(dsaTask);
    if (url.endsWith(`/artifacts/${dsaTask.case.content.artifactId}`)) {
      artifactReads += 1;
      if (artifactReads === 1) return Response.json({ error: "expired" }, { status: 410 });
      return new Response("Blinded candidate content for the policy decision.", {
        headers: { "Content-Type": "text/plain" },
      });
    }
    if (url.endsWith("/responses") && init?.method === "POST") {
      submission.current = JSON.parse(String(init.body)) as Record<string, unknown>;
      return Response.json({
        accepted: true,
        replay: false,
        responseCount: 1,
        compensation: "paid",
        settlementStatus: "pending",
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const view = render(
      <HumanAssuranceRaterClient
        principalId={PRINCIPAL_A}
        initialAssignmentId={dsaTask.assignmentId}
        initialTermsHash={termsHash}
      />,
    );
    const user = userEvent.setup({ document });
    await user.click(
      view.getByRole("checkbox", {
        name: "I accept these confidentiality terms for this assigned private work.",
      }),
    );
    await user.click(view.getByRole("button", { name: "Accept terms and open assignment" }));

    await waitFor(() => assert.ok(view.getByRole("heading", { name: "Confirm no disqualifying conflict" })));
    assert.equal(panelAcceptBodies.length, 0);
    const confirmButton = view.getByRole("button", { name: "Confirm and open blinded case" });
    assert.equal((confirmButton as HTMLButtonElement).disabled, true);
    await user.click(
      view.getByRole("checkbox", {
        name: "I did not define the reference question, hold no workspace or project role, and have no relationship that could affect my judgment.",
      }),
    );
    await user.click(confirmButton);

    await waitFor(() => assert.ok(view.getByRole("heading", { name: "Blinded policy case" })));
    assert.deepEqual(panelAcceptBodies[0], {
      conflictDeclaration: { hasConflict: false, relationships: [] },
    });
    assert.ok(view.getByText(dsaTask.case.policy.question));
    assert.ok(view.getByText(/Source and automated-outcome metadata are withheld/u));
    await waitFor(() => assert.ok(view.getByRole("button", { name: "Refresh access" })));

    await user.click(view.getByRole("radio", { name: "Content matches the policy condition" }));
    const rationale = view.getByRole("textbox", { name: "Decision rationale" });
    await user.type(rationale, "The content directly matches the frozen criterion.");
    const submitButton = view.getByRole("button", { name: "Submit review" }) as HTMLButtonElement;
    assert.equal(submitButton.disabled, true);
    assert.equal(submission.current, null);
    assert.ok(view.getByText("Wait for the content under review to load before submitting."));
    await user.click(view.getByRole("button", { name: "Refresh access" }));

    await waitFor(() => assert.equal(panelAcceptBodies.length, 2));
    await waitFor(() => assert.ok(view.getByText("Blinded candidate content for the policy decision.")));
    await waitFor(() => assert.equal(submitButton.disabled, false));
    assert.equal(
      (view.getByRole("radio", { name: "Content matches the policy condition" }) as HTMLInputElement).checked,
      true,
    );
    assert.equal(
      (view.getByRole("textbox", { name: "Decision rationale" }) as HTMLTextAreaElement).value,
      "The content directly matches the frozen criterion.",
    );

    await user.click(view.getByRole("button", { name: "Submit review" }));
    await waitFor(() => assert.ok(submission.current));
    const submittedBody = submission.current as unknown as Record<string, unknown>;
    assert.equal("responses" in submittedBody, false);
    assert.deepEqual(submittedBody.dsaResponse, {
      choice: "policy_matches",
      rationale: "The content directly matches the frozen criterion.",
    });
    assert.equal(genericAcceptBodies[0]?.confidentialityTermsHash, termsHash);
    assert.ok(view.getByRole("status").textContent?.includes("Settlement is pending"));
    assert.ok(view.getByText("Paid · settlement pending"));
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("a DSA reviewer can explicitly report content self-identification without creating a policy response", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { HumanAssuranceRaterClient } = await import("./HumanAssuranceRaterClient");
  const previousFetch = globalThis.fetch;
  const reportRequest: { current: Record<string, unknown> | null } = { current: null };

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "/api/auth/session") return Response.json(authenticatedSession(PRINCIPAL_A));
    if (url.endsWith(`/artifacts/${dsaTask.case.content.artifactId}`)) {
      return new Response("Content that identifies the signed-in reviewer.", {
        headers: { "Content-Type": "text/plain" },
      });
    }
    if (url.endsWith("/responses") && init?.method === "POST") {
      reportRequest.current = JSON.parse(String(init.body)) as Record<string, unknown>;
      return Response.json({
        accepted: true,
        replay: false,
        responseCount: 0,
        compensation: "unpaid",
        settlementStatus: "not_applicable",
        terminalKind: "content_self_identification_gap",
        reportId: `dsapa_selfid_${"8".repeat(40)}`,
        reportHash: `sha256:${"9".repeat(64)}`,
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const view = render(
      <HumanAssuranceRaterClient
        principalId={PRINCIPAL_A}
        initialTask={dsaTask as unknown as AssignmentTask}
        initialAssignmentId={dsaTask.assignmentId}
      />,
    );
    const user = userEvent.setup({ document });
    await waitFor(() => assert.ok(view.getByText("Content that identifies the signed-in reviewer.")));

    const reportButton = view.getByRole("button", { name: "This content identifies me" });
    assert.equal(reportRequest.current, null);
    assert.ok(view.getByText(/does not classify, redact, replace, or count the content/u));
    await user.click(reportButton);

    assert.equal(reportRequest.current, null);
    assert.ok(view.getByText(/ends this unpaid assignment without a policy response or label/u));
    assert.ok(view.getByText(/A separate auditor must decide/u));
    assert.equal((view.getByRole("button", { name: "Submit review" }) as HTMLButtonElement).disabled, true);
    await user.click(view.getByRole("button", { name: "Report and close assignment" }));

    await waitFor(() => assert.ok(reportRequest.current));
    assert.deepEqual(reportRequest.current, {
      dsaGapReport: { reason: "content_self_identification" },
    });
    assert.equal("dsaResponse" in reportRequest.current!, false);
    assert.equal("responses" in reportRequest.current!, false);
    assert.ok(view.getByRole("status").textContent?.includes("No policy label was created"));
    assert.ok(view.getByText("1 report recorded"));
    assert.ok(view.getByText("Unpaid · no settlement or claim required"));
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("a closed private review has one terminal recovery path", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { HumanAssuranceRaterClient } = await import("./HumanAssuranceRaterClient");
  const previousFetch = globalThis.fetch;
  const termsHash = `sha256:${"b".repeat(64)}`;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url === "/api/auth/session") return Response.json(authenticatedSession(PRINCIPAL_A));
    if (url.includes("/accept?terms=")) {
      return Response.json({
        assignmentId: binaryTask.assignmentId,
        state: "closed",
        termsAccepted: false,
        terms: directTerms,
        responseDeadline: "2026-01-01T00:00:00.000Z",
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const view = render(
      <HumanAssuranceRaterClient
        principalId={PRINCIPAL_A}
        initialAssignmentId={binaryTask.assignmentId}
        initialTermsHash={termsHash}
      />,
    );
    await waitFor(() => assert.ok(view.getByText("Review window closed")));
    assert.equal(view.queryByRole("button", { name: "Accept terms and open assignment" }), null);
    assert.equal(view.queryByRole("button", { name: "Restore assignment access" }), null);
    assert.equal(view.getByRole("link", { name: "Return to review queue" }).getAttribute("href"), "/human/review");
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("a recoverable reservation shows restore instead of a second acceptance action", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { HumanAssuranceRaterClient } = await import("./HumanAssuranceRaterClient");
  const previousFetch = globalThis.fetch;
  const termsHash = `sha256:${"c".repeat(64)}`;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "/api/auth/session") return Response.json(authenticatedSession(PRINCIPAL_A));
    if (url.includes("/accept?terms=")) {
      return Response.json({
        assignmentId: binaryTask.assignmentId,
        state: "recoverable",
        termsAccepted: false,
        terms: directTerms,
        responseDeadline: "2030-01-01T00:00:00.000Z",
      });
    }
    if (url.endsWith("/recover") && init?.method === "POST") {
      return Response.json(
        { error: "Assignment cannot be recovered.", code: "assignment_recovery_unavailable" },
        { status: 409 },
      );
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const view = render(
      <HumanAssuranceRaterClient
        principalId={PRINCIPAL_A}
        initialAssignmentId={binaryTask.assignmentId}
        initialTermsHash={termsHash}
      />,
    );
    await waitFor(() => assert.ok(view.getByRole("button", { name: "Restore assignment access" })));
    assert.equal(view.queryByRole("button", { name: "Accept terms and open assignment" }), null);
    await userEvent.setup({ document }).click(view.getByRole("button", { name: "Restore assignment access" }));
    await waitFor(() => assert.ok(view.getByText("Assignment unavailable")));
    assert.equal(view.queryByRole("button", { name: "Accept terms and open assignment" }), null);
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("an owner-fixed private task shows source and output separately and submits the binary rating", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { HumanAssuranceRaterClient } = await import("./HumanAssuranceRaterClient");
  const previousFetch = globalThis.fetch;
  const submission: { current: Record<string, unknown> | null } = { current: null };
  let continued = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "/api/auth/session") return Response.json(authenticatedSession(PRINCIPAL_A));
    const artifact = privateArtifactResponse(url);
    if (artifact) return artifact;
    if (url.endsWith("/responses")) {
      submission.current = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        accepted: true,
        replay: false,
        responseCount: 1,
        compensation: "unpaid",
        settlementStatus: "not_applicable",
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const view = render(
      <HumanAssuranceRaterClient
        principalId={PRINCIPAL_A}
        initialTask={binaryTask}
        onContinue={() => {
          continued += 1;
        }}
      />,
    );
    const user = userEvent.setup({ document });
    assert.ok(view.getByText("Review the source and decide whether the agent output meets the criterion."));
    await waitFor(() => assert.ok(view.getByText("User asked whether the deployment is ready.")));
    assert.ok(view.getByText("The agent answered that every required check passed."));
    assert.equal(view.queryByRole("link", { name: "Open private artifact" }), null);
    assert.ok(view.getByText("This private, unpaid rating stays off-chain and is recorded when you submit."));
    await user.click(view.getByRole("radio", { name: "Approve" }));
    assert.equal(view.queryByRole("spinbutton", { name: "Crowd forecast" }), null);
    await user.click(view.getByRole("button", { name: "Submit review" }));
    await waitFor(() => assert.ok(submission.current));
    const responses = submission.current?.responses as Array<Record<string, unknown>>;
    assert.equal(responses[0]?.displayedOption, "A");
    assert.equal("predictedPositiveBps" in (responses[0] ?? {}), false);
    assert.equal(responses[0]?.selectedArtifactId, "artifact_binary_suggestion");
    await user.click(view.getByRole("button", { name: "Review next assignment" }));
    assert.equal(continued, 1);
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("an incomplete private review explains what is missing instead of trapping the submit action", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { HumanAssuranceRaterClient } = await import("./HumanAssuranceRaterClient");
  const previousFetch = globalThis.fetch;
  let responsePosts = 0;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url === "/api/auth/session") return Response.json(authenticatedSession(PRINCIPAL_A));
    const artifact = privateArtifactResponse(url);
    if (artifact) return artifact;
    if (url.endsWith("/responses")) {
      responsePosts += 1;
      return Response.json({
        accepted: true,
        replay: false,
        responseCount: 1,
        compensation: "unpaid",
        settlementStatus: "not_applicable",
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const task: AssignmentTask = {
      ...binaryTask,
      rubric: {
        ...binaryTask.rubric,
        rationale: { mode: "required", minLength: 10, maxLength: 2_000 },
      },
    };
    const view = render(<HumanAssuranceRaterClient principalId={PRINCIPAL_A} initialTask={task} />);
    const user = userEvent.setup({ document });
    const submit = view.getByRole("button", { name: "Submit review" });

    assert.equal((submit as HTMLButtonElement).disabled, false);
    assert.ok(view.getByText("Choose Approve or Reject."));
    await user.click(submit);
    assert.ok(view.getByRole("alert").textContent?.includes("Choose Approve or Reject"));
    assert.equal(responsePosts, 0);

    await user.click(view.getByText("Approve"));
    assert.ok(view.getByText("Add at least 10 characters of decision rationale."));
    await user.click(submit);
    assert.ok(view.getByRole("alert").textContent?.includes("at least 10 characters"));
    assert.equal(responsePosts, 0);

    await user.type(view.getByRole("textbox", { name: "Decision rationale" }), "Evidence is sufficient.");
    await user.click(submit);
    await waitFor(() => assert.equal(responsePosts, 1));
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("an initially signed-out visitor without loaded private content is not treated as a session loss", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { HumanAssuranceRaterClient } = await import("./HumanAssuranceRaterClient");
  const previousFetch = globalThis.fetch;
  let sessionReads = 0;
  globalThis.fetch = async input => {
    assert.equal(String(input), "/api/auth/session");
    sessionReads += 1;
    return Response.json({ authenticated: false });
  };

  try {
    const view = render(<HumanAssuranceRaterClient />);
    await waitFor(() => assert.equal(sessionReads, 1));
    assert.ok(view.getByRole("heading", { name: "Open your assigned review" }));
    assert.equal(view.queryByRole("alert"), null);
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("a principal switch clears rendered private review content and requires reopening", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { HumanAssuranceRaterClient } = await import("./HumanAssuranceRaterClient");
  const previousFetch = globalThis.fetch;
  let sessionPrincipal = PRINCIPAL_A;
  let sessionReads = 0;
  globalThis.fetch = async input => {
    const url = String(input);
    const artifact = privateArtifactResponse(url);
    if (artifact) return artifact;
    assert.equal(url, "/api/auth/session");
    sessionReads += 1;
    return Response.json(authenticatedSession(sessionPrincipal));
  };

  try {
    const view = render(<HumanAssuranceRaterClient principalId={PRINCIPAL_A} initialTask={privateTask} />);
    assert.ok(view.getByText("Private session guard content"));
    await waitFor(() => assert.equal(sessionReads, 1));

    sessionPrincipal = PRINCIPAL_B;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => assert.equal(view.queryByText("Private session guard content"), null));
    assert.ok(view.getByRole("heading", { name: "Open your assigned review" }));
    assert.ok(view.getByRole("alert").textContent?.includes("session changed"));
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("sign-out clears rendered private review content and acceptance state", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { HumanAssuranceRaterClient } = await import("./HumanAssuranceRaterClient");
  const previousFetch = globalThis.fetch;
  let signedIn = true;
  let sessionReads = 0;
  globalThis.fetch = async input => {
    const url = String(input);
    const artifact = privateArtifactResponse(url);
    if (artifact) return artifact;
    assert.equal(url, "/api/auth/session");
    sessionReads += 1;
    return Response.json(signedIn ? authenticatedSession(PRINCIPAL_A) : { authenticated: false });
  };

  try {
    const view = render(
      <HumanAssuranceRaterClient
        principalId={PRINCIPAL_A}
        initialTask={privateTask}
        initialServerAcceptance={{
          accepted: true,
          replay: false,
          responseCount: 1,
          compensation: "unpaid",
          settlementStatus: "not_applicable",
        }}
      />,
    );
    await waitFor(() => assert.equal(sessionReads, 1));
    assert.equal(view.queryByText("Private session guard content"), null);
    assert.ok(view.getByRole("status").textContent?.includes("Review submitted"));

    signedIn = false;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => assert.ok(view.getByRole("alert").textContent?.includes("signed out")));
    const acceptance = view.queryByRole("checkbox") as HTMLInputElement | null;
    assert.equal(acceptance?.checked ?? false, false);
    assert.equal(view.queryByText("Private session guard content"), null);
    assert.equal(view.queryByRole("status"), null);
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("a transient session read failure retains private content and in-memory drafts", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { HumanAssuranceRaterClient } = await import("./HumanAssuranceRaterClient");
  const previousFetch = globalThis.fetch;
  let sessionReadFails = false;
  let sessionReads = 0;
  globalThis.fetch = async input => {
    const url = String(input);
    const artifact = privateArtifactResponse(url);
    if (artifact) return artifact;
    assert.equal(url, "/api/auth/session");
    sessionReads += 1;
    if (sessionReadFails) throw new Error("temporary network failure");
    return Response.json(authenticatedSession(PRINCIPAL_A));
  };

  try {
    const view = render(<HumanAssuranceRaterClient principalId={PRINCIPAL_A} initialTask={privateTask} />);
    await waitFor(() => assert.equal(sessionReads, 1));
    const user = userEvent.setup({ document });
    await user.click(view.getByRole("radio", { name: /Candidate A/u }));
    const rationale = view.getByRole("textbox", { name: "Decision rationale" });
    await user.type(rationale, "Retain this private draft.");

    sessionReadFails = true;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => assert.ok(view.getByRole("alert").textContent?.includes("Refocus this tab to retry")));
    assert.ok(view.getByText("Private session guard content"));
    assert.equal((view.getByRole("radio", { name: /Candidate A/u }) as HTMLInputElement).checked, true);
    assert.equal((rationale as HTMLTextAreaElement).value, "Retain this private draft.");
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("refreshing short-lived artifact access preserves a draft until the assignment deadline", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { HumanAssuranceRaterClient } = await import("./HumanAssuranceRaterClient");
  const previousFetch = globalThis.fetch;
  const expiredTask: AssignmentTask = {
    ...privateTask,
    cases: privateTask.cases.map(reviewCase => ({
      ...reviewCase,
      options: reviewCase.options.map(option => ({ ...option, expiresAt: "2026-01-01T00:00:00.000Z" })),
    })),
  };
  const refreshedTask: AssignmentTask = {
    ...privateTask,
    cases: privateTask.cases.map(reviewCase => ({
      ...reviewCase,
      options: reviewCase.options.map(option => ({
        ...option,
        leaseId: `${option.leaseId}_refreshed`,
        expiresAt: "2030-01-01T00:05:00.000Z",
      })),
    })),
  };
  let refreshPosts = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "/api/auth/session") return Response.json(authenticatedSession(PRINCIPAL_A));
    if (url.includes("/accept?includeTask=1") && init?.method === "POST") {
      refreshPosts += 1;
      return Response.json({
        acceptance: { assignmentExpiresAt: "2030-01-02T00:00:00.000Z" },
        task: refreshedTask,
      });
    }
    if (url.includes("/artifacts/")) {
      if (refreshPosts === 0) return Response.json({ error: "expired" }, { status: 410 });
      return privateArtifactResponse(url) ?? Response.json({ error: "missing" }, { status: 404 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const view = render(
      <HumanAssuranceRaterClient
        principalId={PRINCIPAL_A}
        initialAssignmentId={privateTask.assignmentId}
        initialTermsHash={`sha256:${"d".repeat(64)}`}
        initialTask={expiredTask}
        assignmentExpiresAt="2030-01-02T00:00:00.000Z"
      />,
    );
    const user = userEvent.setup({ document });
    await waitFor(() => assert.equal(view.getAllByRole("button", { name: "Refresh access" }).length, 2));
    await user.click(view.getByRole("radio", { name: /Candidate A/u }));
    const rationale = view.getByRole("textbox", { name: "Decision rationale" });
    await user.type(rationale, "Keep this draft through lease refresh.");
    await user.click(view.getAllByRole("button", { name: "Refresh access" })[0]!);

    await waitFor(() => assert.equal(refreshPosts, 1));
    assert.equal((view.getByRole("radio", { name: /Candidate A/u }) as HTMLInputElement).checked, true);
    assert.equal(
      (view.getByRole("textbox", { name: "Decision rationale" }) as HTMLTextAreaElement).value,
      "Keep this draft through lease refresh.",
    );
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("the last case opens an editable summary and submits only after explicit confirmation", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { HumanAssuranceRaterClient } = await import("./HumanAssuranceRaterClient");
  const previousFetch = globalThis.fetch;
  const secondCase = {
    ...privateTask.cases[0]!,
    caseId: "hacase_private_session_guard_2",
    title: "Second private comparison",
    options: privateTask.cases[0]!.options.map(option => ({
      ...option,
      artifactId: `${option.artifactId}_2`,
      leaseId: `${option.leaseId}_2`,
    })),
  };
  let responsePosts = 0;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url === "/api/auth/session") return Response.json(authenticatedSession(PRINCIPAL_A));
    const artifact = privateArtifactResponse(url);
    if (artifact) return artifact;
    if (url.endsWith("/responses")) {
      responsePosts += 1;
      return Response.json({
        accepted: true,
        replay: false,
        responseCount: 2,
        compensation: "unpaid",
        settlementStatus: "not_applicable",
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const view = render(
      <HumanAssuranceRaterClient
        principalId={PRINCIPAL_A}
        initialTask={{ ...privateTask, cases: [privateTask.cases[0]!, secondCase] }}
      />,
    );
    const user = userEvent.setup({ document });
    await user.click(view.getByRole("radio", { name: /Candidate A/u }));
    await user.type(view.getByRole("textbox", { name: "Decision rationale" }), "First rationale is complete.");
    await user.click(view.getByRole("button", { name: "Next case" }));
    await user.click(view.getByRole("radio", { name: /Candidate A/u }));
    await user.type(view.getByRole("textbox", { name: "Decision rationale" }), "Second rationale is complete.");
    await user.click(view.getByRole("button", { name: "Review answers" }));

    assert.equal(responsePosts, 0);
    assert.ok(view.getByRole("heading", { name: "Review every answer before submitting" }));
    await user.click(view.getByRole("button", { name: "Edit case 1" }));
    await user.click(view.getByRole("radio", { name: /Candidate B/u }));
    await user.click(view.getByRole("button", { name: "Next case" }));
    await user.click(view.getByRole("button", { name: "Review answers" }));
    assert.equal(responsePosts, 0);
    await user.click(view.getByRole("button", { name: "Submit review" }));

    await waitFor(() => assert.equal(responsePosts, 1));
    assert.ok(view.getByRole("status").textContent?.includes("Review submitted"));
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
