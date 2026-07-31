import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { EnglishAgentTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "~~/components/tokenless/testing/dom";

function dashboard(runs: Record<string, unknown>[] = []) {
  return {
    workspaceId: "workspace-evidence",
    callerRole: "owner",
    canViewPublishingPolicies: false,
    attributionReady: true,
    summary: {
      totalRuns: runs.length,
      completedRuns: runs.length,
      evidenceBackedRuns: runs.length,
      validResponses: 0,
      attributedRuns: 0,
    },
    agents: [],
    modelProfiles: [],
    deciderTrend: {
      clientDecisions: { total: 0, goCount: 0 },
      overrides: { total: 0, acceptedCount: 0 },
    },
    runs,
    publishingPolicies: null,
  };
}

const evidencePacket = {
  packetDigest: `sha256:${"a".repeat(64)}`,
  payload: {
    packetId: "packet-evidence-1",
    runId: "run-evidence-1",
    generatedAt: "2026-07-20T10:00:00.000Z",
    aggregation: {
      suite: { outcome: "pass" },
      judgmentCoverage: {
        caseCount: 2,
        targetExpectedJudgmentCount: 6,
        assignedExpectedJudgmentCount: 6,
        submittedJudgmentCount: 5,
        validJudgmentCount: 4,
        invalidJudgmentCount: 1,
        pendingJudgmentCount: 0,
        missingTargetJudgmentCount: 1,
        missingAssignedJudgmentCount: 1,
      },
    },
    reviewContext: {
      period: {
        responseSubmissionLatencyFromPeriodStartMs: {
          count: 5,
          minimum: 1_000,
          median: 90_000,
          p95: 240_000,
          maximum: 240_000,
        },
      },
    },
  },
  signing: {
    algorithm: "Ed25519",
    keyId: "ed25519:evidence-key-1",
    publicKey: "embedded-key-is-not-a-trust-anchor",
  },
};

const secondEvidencePacket = {
  ...evidencePacket,
  packetDigest: `sha256:${"b".repeat(64)}`,
  payload: {
    ...evidencePacket.payload,
    packetId: "packet-evidence-2",
    runId: "run-evidence-2",
    generatedAt: "2026-07-27T10:00:00.000Z",
  },
};

function installFetch(runs: Record<string, unknown>[]) {
  const previousFetch = globalThis.fetch;
  let auditors: Array<Record<string, unknown>> = [];
  let shares: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/evaluations")) return Response.json(dashboard(runs));
    if (url.endsWith("/assurance/runs/run-evidence-1/evidence")) return Response.json(evidencePacket);
    if (url.endsWith("/assurance/runs/run-evidence-2/evidence")) return Response.json(secondEvidencePacket);
    if (url.endsWith("/assurance/runs/run-evidence-1/evidence/shares") && method === "GET") {
      return Response.json({ shares });
    }
    if (url.endsWith("/assurance/runs/run-evidence-2/evidence/shares") && method === "GET") {
      return Response.json({ shares: [] });
    }
    if (url.endsWith("/assurance/runs/run-evidence-1/evidence/shares") && method === "POST") {
      const share = {
        grantId: "esh_1234567890123456789012",
        packetId: "packet-evidence-1",
        runId: "run-evidence-1",
        createdAt: "2026-07-29T10:00:00.000Z",
        expiresAt: "2026-08-05T10:00:00.000Z",
        revokedAt: null,
        accessCount: 0,
        lastAccessedAt: null,
        status: "active",
      };
      shares = [share];
      return Response.json({
        share,
        shareUrl:
          "https://rateloop-tokenless.vercel.app/evidence/share/esh_1234567890123456789012#abcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
      });
    }
    if (url.endsWith("/evidence/shares/esh_1234567890123456789012") && method === "DELETE") {
      shares = [];
      return new Response(null, { status: 204 });
    }
    if (url.includes("/assurance/attestations?")) return Response.json({ attestations: [] });
    if (url.endsWith("/assurance/retention")) {
      return Response.json({
        version: 1,
        evidenceRetentionMonths: 12,
        auditRetentionMonths: 12,
        minimumRetentionMonths: 6,
        effectiveAt: "2026-07-20T10:00:00.000Z",
        basis: { reasons: [] },
      });
    }
    if (url.endsWith("/assurance/trusted-keys")) {
      return Response.json({ keys: [], untrustedPacketKeyCount: 0 });
    }
    if (url.endsWith("/assurance/projects")) {
      return Response.json({ projects: [{ projectId: "project-release-controls", name: "Release controls" }] });
    }
    if (url.endsWith("/assurance/projects/project-release-controls/auditors") && method === "GET") {
      return Response.json({ auditors });
    }
    if (url.endsWith("/assurance/projects/project-release-controls/auditors") && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { expiresAt: string | null; subjectReference: string };
      auditors = [
        {
          assignmentId: "paccess-auditor-1",
          subjectReference: body.subjectReference,
          expiresAt: body.expiresAt,
          createdAt: "2026-07-20T10:00:00.000Z",
        },
      ];
      return Response.json({ assignmentId: "paccess-auditor-1", subjectReference: body.subjectReference });
    }
    if (url.endsWith("/assurance/projects/project-release-controls/auditors/paccess-auditor-1")) {
      auditors = [];
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected evidence request: ${url}`);
  };
  return () => {
    globalThis.fetch = previousFetch;
  };
}

async function mount(canManage: boolean) {
  const { render } = await import("@testing-library/react");
  const { EvidenceWorkspacePanel } = await import("./EvidenceWorkspacePanel");
  return render(<EvidenceWorkspacePanel workspaceId="workspace-evidence" canManage={canManage} />, {
    wrapper: EnglishAgentTestProviders,
  });
}

test("managers see compliance exports before opening advanced evidence controls", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const restoreFetch = installFetch([]);

  try {
    const view = await mount(true);
    await view.findByRole("heading", { name: "No evidence records yet" });
    assert.ok(view.getByRole("heading", { name: "Compliance exports" }));
    assert.ok(view.getByRole("link", { name: "Audit log" }));
    assert.ok(view.getByRole("link", { name: "Coverage history" }));
    assert.ok(await view.findByRole("heading", { name: "Project auditors" }));
    assert.ok(view.getByRole("button", { name: "Grant read and export" }));
    assert.equal(view.queryByText("Verify an export"), null);

    await userEvent.setup({ document }).click(view.getByRole("button", { name: "Retention, keys, and delivery" }));
    assert.ok(view.getByRole("heading", { name: "Retention policy" }));
    assert.ok(view.getByRole("heading", { name: "Trusted verification keys" }));
    assert.ok(view.getByRole("heading", { name: "Evidence integrations" }));
  } finally {
    await act(async () => cleanup());
    restoreFetch();
    restoreDom();
  }
});

test("a packet reveals verification while manager-only exports and controls stay restricted", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup } = await import("@testing-library/react");
  const restoreFetch = installFetch([
    {
      runId: "run-evidence-1",
      projectId: "project-release-controls",
      projectName: "Release controls",
      suiteId: "suite-production-readiness",
      suiteName: "Production readiness",
      suiteVersion: 1,
      evidencePacketAvailable: true,
    },
  ]);

  try {
    const view = await mount(false);
    await view.findByRole("heading", { name: "Decision packets" });
    assert.ok(view.getByText("Verify an export"));
    const resultHref = new URL(
      view.getByRole("link", { name: "Open result" }).getAttribute("href") ?? "",
      "https://rateloop.local",
    );
    assert.equal(resultHref.pathname, "/agents/results");
    assert.equal(resultHref.searchParams.get("workspace"), "workspace-evidence");
    assert.equal(resultHref.searchParams.get("resultRun"), "run-evidence-1");
    assert.ok(view.getByText("Point-in-time record"));
    assert.ok(view.getByText("Review coverage and timing"));
    assert.ok(view.getByText("Target expected"));
    assert.ok(view.getByText("Median response time"));
    assert.ok(view.getByText("1 min 30 sec"));
    assert.ok(view.getByText("4 min"));
    assert.equal(view.queryByRole("heading", { name: "Compliance exports" }), null);
    assert.equal(view.queryByRole("button", { name: "Retention, keys, and delivery" }), null);
  } finally {
    await act(async () => cleanup());
    restoreFetch();
    restoreDom();
  }
});

test("packet viewers can create a fragment-only seven-day link and revoke it directly", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const restoreFetch = installFetch([
    {
      runId: "run-evidence-1",
      projectId: "project-release-controls",
      projectName: "Release controls",
      suiteId: "suite-production-readiness",
      suiteName: "Production readiness",
      suiteVersion: 1,
      evidencePacketAvailable: true,
    },
  ]);

  try {
    const view = await mount(false);
    await view.findByRole("heading", { name: "Decision packets" });
    const user = userEvent.setup({ document });
    assert.ok(view.getByText("Anyone with the link can open this packet for 7 days. The secret is shown once."));
    await user.click(view.getByRole("button", { name: "Share for 7 days" }));
    const input = (await view.findByRole("textbox", { name: "Share link" })) as HTMLInputElement;
    const shareUrl = new URL(input.value);
    assert.equal(shareUrl.pathname, "/evidence/share/esh_1234567890123456789012");
    assert.equal(shareUrl.search, "");
    assert.ok(shareUrl.hash.length > 1);
    assert.ok(view.getByRole("button", { name: "Revoke link" }));

    await user.click(view.getByRole("button", { name: "Revoke link" }));
    await waitFor(() => assert.equal(view.queryByRole("button", { name: "Revoke link" }), null));
  } finally {
    await act(async () => cleanup());
    restoreFetch();
    restoreDom();
  }
});

test("an invalid evidence deep link fails closed until the selection is cleared", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const restoreFetch = installFetch([
    {
      runId: "run-evidence-1",
      projectId: "project-release-controls",
      projectName: "Release controls",
      suiteId: "suite-production-readiness",
      suiteName: "Production readiness",
      suiteVersion: 1,
      evidencePacketAvailable: true,
    },
  ]);
  window.history.replaceState(
    null,
    "",
    "/agents/results?workspace=workspace-evidence&run=missing-run&packet=missing-packet",
  );

  try {
    const view = await mount(false);
    await view.findByRole("heading", { name: "Evidence record unavailable" });
    assert.ok(view.getByText("The linked run or packet is not available in this workspace."));
    assert.equal(view.queryByText("Verify an export"), null);
    assert.equal(view.queryByRole("link", { name: "Link to packet" }), null);

    await userEvent.setup({ document }).click(view.getByRole("button", { name: "Show available records" }));
    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      assert.equal(params.has("run"), false);
      assert.equal(params.has("packet"), false);
      assert.ok(view.getByText("Verify an export"));
      assert.equal(view.queryByRole("heading", { name: "Evidence record unavailable" }), null);
    });
  } finally {
    await act(async () => cleanup());
    restoreFetch();
    restoreDom();
  }
});

test("evidence selection and filters restore from the URL and preserve workspace context on changes", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const restoreFetch = installFetch([
    {
      runId: "run-evidence-1",
      projectId: "project-release-controls",
      projectName: "Release controls",
      suiteId: "suite-release-lineage",
      suiteName: "Production readiness",
      suiteVersion: 1,
      evidencePacketAvailable: true,
    },
    {
      runId: "run-evidence-2",
      projectId: "project-release-controls",
      projectName: "Release controls",
      suiteId: "suite-release-lineage",
      suiteName: "Deployment safety",
      suiteVersion: 2,
      evidencePacketAvailable: true,
    },
  ]);
  const initialLocation =
    "/agents?tab=evidence&workspace=workspace-evidence&source=audit&q=release&outcome=pass&date=30&run=run-evidence-2&packet=packet-evidence-2";
  window.history.replaceState(null, "", initialLocation);

  try {
    const view = await mount(false);
    await view.findByRole("heading", { name: "Decision packets" });

    await waitFor(() => {
      const selectedLink = view.getByRole("link", { name: "Link to packet" });
      assert.match(selectedLink.closest("article")?.textContent ?? "", /Deployment safety/);
      assert.equal((view.getByRole("searchbox", { name: "Workflow or project" }) as HTMLInputElement).value, "release");
      assert.equal((view.getByRole("combobox", { name: "Outcome" }) as HTMLSelectElement).value, "pass");
      assert.equal((view.getByRole("combobox", { name: "Date" }) as HTMLSelectElement).value, "30");
    });

    const selectedLink = view.getByRole("link", { name: "Link to packet" });
    assert.equal(
      selectedLink.getAttribute("href"),
      "/agents?tab=evidence&workspace=workspace-evidence&source=audit&q=release&outcome=pass&date=30&run=run-evidence-2&packet=packet-evidence-2",
    );
    const newerPacketLink = view.getByRole("link", { name: "Open newer packet" });
    assert.match(newerPacketLink.closest("article")?.textContent ?? "", /Production readiness/);
    assert.match(
      newerPacketLink.closest("article")?.textContent ?? "",
      /newer packet exists.*signed packet remains an immutable point-in-time record/is,
    );
    assert.equal(
      newerPacketLink.getAttribute("href"),
      "/agents?tab=evidence&workspace=workspace-evidence&source=audit&q=release&outcome=pass&date=30&run=run-evidence-2&packet=packet-evidence-2",
    );
    assert.doesNotMatch(selectedLink.closest("article")?.textContent ?? "", /newer packet exists/i);

    const user = userEvent.setup({ document });
    await user.click(view.getByRole("link", { name: "Open packet" }));
    let params = new URLSearchParams(window.location.search);
    assert.equal(params.get("run"), "run-evidence-1");
    assert.equal(params.get("packet"), "packet-evidence-1");

    const query = view.getByRole("searchbox", { name: "Workflow or project" }) as HTMLInputElement;
    await user.clear(query);
    await user.type(query, "safety");
    await user.selectOptions(view.getByRole("combobox", { name: "Outcome" }), "fail");
    await user.selectOptions(view.getByRole("combobox", { name: "Date" }), "7");

    params = new URLSearchParams(window.location.search);
    assert.equal(params.get("tab"), "evidence");
    assert.equal(params.get("workspace"), "workspace-evidence");
    assert.equal(params.get("source"), "audit");
    assert.equal(params.get("q"), "safety");
    assert.equal(params.get("outcome"), "fail");
    assert.equal(params.get("date"), "7");
    assert.equal(params.get("run"), "run-evidence-1");
    assert.equal(params.get("packet"), "packet-evidence-1");

    await act(async () => window.history.back());
    await waitFor(() => {
      assert.equal((view.getByRole("searchbox", { name: "Workflow or project" }) as HTMLInputElement).value, "release");
      assert.equal((view.getByRole("combobox", { name: "Outcome" }) as HTMLSelectElement).value, "pass");
      assert.equal((view.getByRole("combobox", { name: "Date" }) as HTMLSelectElement).value, "30");
      assert.match(
        view.getByRole("link", { name: "Link to packet" }).closest("article")?.textContent ?? "",
        /Deployment safety/,
      );
    });
  } finally {
    await act(async () => cleanup());
    restoreFetch();
    restoreDom();
  }
});
