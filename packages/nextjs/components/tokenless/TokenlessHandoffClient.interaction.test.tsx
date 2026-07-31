import React from "react";
import { TokenlessHandoffClient } from "./TokenlessHandoffClient";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { withEnglishAppTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "~~/components/tokenless/testing/dom";

const REDACTION_SUMMARY = "Names and account identifiers were replaced with synthetic values.";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function audiencePolicy() {
  return {
    schemaVersion: "rateloop.human-assurance.v2" as const,
    policyId: "policy_handoff_invited",
    version: 1,
    reviewerSource: "customer_invited" as const,
    compensation: "paid" as const,
    cohorts: [{ cohortId: "handoff-invited", minimumReviewers: 3, maximumReviewers: 500 }],
    selection: "customer_named" as const,
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: [],
    assurance: {
      requirements: [
        {
          capability: "customer_invitation" as const,
          reviewerSources: ["customer_invited" as const],
          allowedProviders: ["workspace-invitation"],
        },
      ],
    },
    buyerPrivacy: { visibleFields: ["reviewer_source" as const], minimumAggregationSize: 3, suppressSmallCells: true },
    legalEligibilityRequired: true,
  };
}

function handoffFragment() {
  const handoffId = `rhl_${"A".repeat(32)}`;
  const handoffToken = `rht_${"B".repeat(43)}_abcdef12`;
  const payload = {
    version: "rateloop.handoff.v1",
    handoffId,
    handoffToken,
    idempotencyKey: `mcp:${createHash("sha256").update(`${handoffId}\0${handoffToken}`).digest("base64url")}`,
    expiresAt: new Date(Number.parseInt("abcdef12", 36) * 1_000).toISOString(),
    dataClassification: "synthetic",
    redactionSummary: REDACTION_SUMMARY,
    request: {
      audience: {
        admissionPolicyHash: `0x${createHash("sha256").update(stableJson(audiencePolicy())).digest("hex")}`,
        source: "customer_invited",
      },
      audiencePolicy: audiencePolicy(),
      budget: { attemptReserveAtomic: "5000000", bountyAtomic: "25000000", feeBps: 750 },
      confirmedNoSensitiveData: true,
      dataClassification: "synthetic",
      redactionSummary: REDACTION_SUMMARY,
      visibility: "public",
      question: {
        kind: "binary",
        prompt: "Should we ship the synthetic support reply?",
        negativeLabel: "Revise",
        positiveLabel: "Ship",
        rationale: { mode: "required", minLength: 20, maxLength: 500 },
      },
      requestedPanelSize: 15,
      responseWindowSeconds: 3_600,
    },
  };
  return `#payload=${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

function quoteResponse() {
  return {
    schemaVersion: "rateloop.tokenless.v2",
    quoteId: "quote_handoff_signin",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    economics: {
      asset: "USDC",
      decimals: 6,
      bounty: { fundedAtomic: "25000000", paidAtomic: "0", refundedAtomic: "0" },
      fee: { bps: 750, fundedAtomic: "1875000", paidAtomic: "0", refundedAtomic: "0" },
      attemptReserve: { compensatedAtomic: "0", fundedAtomic: "5000000", refundedAtomic: "0" },
      refund: { attemptReserveAtomic: "0", bountyAtomic: "0", feeAtomic: "0", totalAtomic: "0" },
      compensation: { perAcceptedRevealCapAtomic: "500000", recipientCount: 0, totalAtomic: "0" },
      totalFundedAtomic: "31875000",
    },
    audience: {
      admissionPolicyHash: `0x${"ab".repeat(32)}`,
      label: "Invited reviewers",
      source: "customer_invited",
    },
    panel: { minimumReveals: 12, requestedSize: 15 },
    responseWindowSeconds: 3_600,
    requestProfile: { id: "rrp_release_v1", version: 1, hash: `sha256:${"a".repeat(64)}` },
    reviewEconomics: { compensationMode: "usdc", bountyPerSeatAtomic: "1000000", panelSize: 15 },
    slo: { estimatedSeconds: 900 },
  };
}

test("a first sign-in keeps the quote and confirmation the handoff page told the user to prepare", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const previousFetch = globalThis.fetch;
  let authenticated = false;
  window.history.replaceState(null, "", `/rate${handoffFragment()}`);

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "/api/auth/session") {
      return authenticated
        ? Response.json({
            authenticated: true,
            expiresAt: "2030-01-01T00:00:00.000Z",
            principalId: "rlp_handoff_first_sign_in",
          })
        : Response.json({ authenticated: false });
    }
    if (url === "/api/account/workspaces") {
      return Response.json({
        workspaces: [
          {
            workspaceId: "workspace-1",
            name: "Release team",
            role: "owner",
            prepaid: { settledAtomic: "90000000", reservedAtomic: "0", availableAtomic: "90000000" },
          },
        ],
      });
    }
    if (url === "/api/agent/v1/quote" && init?.method === "POST") return Response.json(quoteResponse());
    throw new Error(`Unexpected handoff request: ${url}`);
  };

  try {
    const view = render(<TokenlessHandoffClient />);
    await waitFor(() => assert.ok(view.getByRole("heading", { name: "Review this ask." })));

    const user = userEvent.setup({ document });
    const confirmation = view.getByRole("checkbox");
    await user.click(confirmation);
    await user.click(view.getByRole("button", { name: "Get price" }));

    await waitFor(() => assert.ok(view.getByRole("heading", { name: "Send this ask" })));
    assert.ok(view.getByText("Sign in required.", { exact: false }));

    // The page instructs the user to sign in in another tab and return; returning fires window focus.
    authenticated = true;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    await waitFor(() => assert.ok(view.getByRole("option", { name: /Release team/ })));
    assert.ok(view.getByRole("heading", { name: "Send this ask" }));
    assert.equal((confirmation as HTMLInputElement).checked, true);
    assert.equal(view.getByRole("button", { name: /^Submit and reserve/ }).hasAttribute("disabled"), false);
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("switching to a different principal still discards the previous principal's quote", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const previousFetch = globalThis.fetch;
  let principalId = "rlp_first_principal";
  window.history.replaceState(null, "", `/rate${handoffFragment()}`);

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "/api/auth/session") {
      return Response.json({ authenticated: true, expiresAt: "2030-01-01T00:00:00.000Z", principalId });
    }
    if (url === "/api/account/workspaces") return Response.json({ workspaces: [] });
    if (url === "/api/agent/v1/quote" && init?.method === "POST") return Response.json(quoteResponse());
    throw new Error(`Unexpected handoff request: ${url}`);
  };

  try {
    const view = render(<TokenlessHandoffClient />);
    await waitFor(() => assert.ok(view.getByRole("heading", { name: "Review this ask." })));

    const user = userEvent.setup({ document });
    await user.click(view.getByRole("checkbox"));
    await user.click(view.getByRole("button", { name: "Get price" }));
    await waitFor(() => assert.ok(view.getByRole("heading", { name: "Send this ask" })));

    principalId = "rlp_second_principal";
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    await waitFor(() => assert.equal(view.queryByRole("heading", { name: "Send this ask" }), null));
    assert.equal((view.getByRole("checkbox") as HTMLInputElement).checked, false);
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
