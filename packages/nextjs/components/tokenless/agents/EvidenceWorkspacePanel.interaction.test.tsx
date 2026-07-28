import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
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
    aggregation: { suite: { outcome: "pass" } },
  },
  signing: {
    algorithm: "Ed25519",
    keyId: "ed25519:evidence-key-1",
    publicKey: "embedded-key-is-not-a-trust-anchor",
  },
};

function installFetch(runs: Record<string, unknown>[]) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.endsWith("/evaluations")) return Response.json(dashboard(runs));
    if (url.endsWith("/assurance/runs/run-evidence-1/evidence")) return Response.json(evidencePacket);
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
    throw new Error(`Unexpected evidence request: ${url}`);
  };
  return () => {
    globalThis.fetch = previousFetch;
  };
}

async function mount(canManage: boolean) {
  const { render } = await import("@testing-library/react");
  const { EvidenceWorkspacePanel } = await import("./EvidenceWorkspacePanel");
  return render(<EvidenceWorkspacePanel workspaceId="workspace-evidence" canManage={canManage} />);
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
      projectName: "Release controls",
      suiteName: "Production readiness",
      evidencePacketAvailable: true,
    },
  ]);

  try {
    const view = await mount(false);
    await view.findByRole("heading", { name: "Decision packets" });
    assert.ok(view.getByText("Verify an export"));
    assert.equal(view.queryByRole("heading", { name: "Compliance exports" }), null);
    assert.equal(view.queryByRole("button", { name: "Retention, keys, and delivery" }), null);
  } finally {
    await act(async () => cleanup());
    restoreFetch();
    restoreDom();
  }
});
