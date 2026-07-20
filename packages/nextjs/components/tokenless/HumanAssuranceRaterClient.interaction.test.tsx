import React from "react";
import type { AssignmentTask } from "./HumanAssuranceRaterClient";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

const PRINCIPAL_A = "rlp_private_reviewer_a";
const PRINCIPAL_B = "rlp_private_reviewer_b";

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

test("private-review credentials stay behind a manual fallback", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, screen } = await import("@testing-library/react");
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

test("private-review links carry both invitation credentials", () => {
  const page = readFileSync(new URL("../../app/(app)/human/page.tsx", import.meta.url), "utf8");
  const card = readFileSync(new URL("./answer/PrivateAssignmentCard.tsx", import.meta.url), "utf8");
  assert.match(page, /initialAssignmentId=\{params\.assignment\}/);
  assert.match(page, /initialTermsHash=\{params\.terms\}/);
  assert.match(card, /assignment=\$\{encodeURIComponent\(assignment\.assignmentId\)\}/);
  assert.match(card, /terms=\$\{encodeURIComponent\(assignment\.confidentialityTermsHash \?\? ""\)\}/);
});

test("an owner-fixed private task shows source and output separately and submits the binary rating", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { HumanAssuranceRaterClient } = await import("./HumanAssuranceRaterClient");
  const previousFetch = globalThis.fetch;
  const submission: { current: Record<string, unknown> | null } = { current: null };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "/api/auth/session") return Response.json(authenticatedSession(PRINCIPAL_A));
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
    const view = render(<HumanAssuranceRaterClient principalId={PRINCIPAL_A} initialTask={binaryTask} />);
    const user = userEvent.setup({ document });
    assert.ok(view.getByText("Review the source and decide whether the agent output meets the criterion."));
    assert.equal(view.getAllByRole("link", { name: "Open private artifact" }).length, 2);
    await user.click(view.getByRole("radio", { name: "Approve" }));
    await user.click(view.getByRole("button", { name: "Review answers" }));
    await user.click(view.getByRole("button", { name: "Submit review" }));
    await waitFor(() => assert.ok(submission.current));
    const responses = submission.current?.responses as Array<Record<string, unknown>>;
    assert.equal(responses[0]?.displayedOption, "A");
    assert.equal(responses[0]?.selectedArtifactId, "artifact_binary_suggestion");
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("an initially signed-out visitor without loaded private content is not treated as a session loss", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, waitFor } = await import("@testing-library/react");
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
  const { act, cleanup, render, waitFor } = await import("@testing-library/react");
  const { HumanAssuranceRaterClient } = await import("./HumanAssuranceRaterClient");
  const previousFetch = globalThis.fetch;
  let sessionPrincipal = PRINCIPAL_A;
  let sessionReads = 0;
  globalThis.fetch = async input => {
    assert.equal(String(input), "/api/auth/session");
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
  const { act, cleanup, render, waitFor } = await import("@testing-library/react");
  const { HumanAssuranceRaterClient } = await import("./HumanAssuranceRaterClient");
  const previousFetch = globalThis.fetch;
  let signedIn = true;
  let sessionReads = 0;
  globalThis.fetch = async input => {
    assert.equal(String(input), "/api/auth/session");
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
    assert.ok(view.getByText("Private session guard content"));
    assert.ok(view.getByRole("status").textContent?.includes("server accepted"));

    signedIn = false;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => assert.ok(view.getByRole("alert").textContent?.includes("signed out")));
    assert.equal((view.getByRole("checkbox") as HTMLInputElement).checked, false);
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
  const { act, cleanup, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { HumanAssuranceRaterClient } = await import("./HumanAssuranceRaterClient");
  const previousFetch = globalThis.fetch;
  let sessionReadFails = false;
  let sessionReads = 0;
  globalThis.fetch = async input => {
    assert.equal(String(input), "/api/auth/session");
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

test("the last case opens an editable summary and submits only after explicit confirmation", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, waitFor } = await import("@testing-library/react");
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
    assert.ok(view.getByRole("status").textContent?.includes("2 assigned responses"));
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
