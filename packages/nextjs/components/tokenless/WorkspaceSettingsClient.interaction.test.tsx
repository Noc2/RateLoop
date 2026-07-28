import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

function workspacesResponse() {
  return {
    workspaces: [
      {
        workspaceId: "workspace-1",
        name: "Release team",
        role: "owner",
        prepaid: { settledAtomic: "0", reservedAtomic: "0", availableAtomic: "0" },
      },
    ],
  };
}

function billingResponse(overrides: Record<string, unknown> = {}) {
  return {
    plan: "free",
    priceVersion: "2026-07",
    status: "active",
    cancelAtPeriodEnd: false,
    periodStart: null,
    periodEnd: null,
    usage: { completed: 0, reserved: 0, limit: 25 },
    limits: { activeAgents: 1, activePrivateGroups: 0, paidPanels: false },
    canManageBilling: true,
    checkoutAvailable: true,
    checkoutBlockedReason: null,
    portalAvailable: true,
    ...overrides,
  };
}

function billingProfileResponse() {
  return {
    complete: false,
    legalName: "",
    registrationNumber: null,
    registeredAddress: "",
    vatCountryCode: null,
    vatId: null,
    billingAddress: { country: null, line1: null, line2: null, city: null, postalCode: null, state: null },
  };
}

test("arriving from pricing with billing=upgrade acknowledges the intent and lands on the upgrade action", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render } = await import("@testing-library/react");
  const { WorkspaceSettingsClient } = await import("./WorkspaceSettingsClient");
  const previousFetch = globalThis.fetch;
  const scrollCalls: ScrollIntoViewOptions[] = [];
  const previousScrollIntoView = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = function scrollIntoView(options?: boolean | ScrollIntoViewOptions) {
    if (options && typeof options === "object") scrollCalls.push(options);
  };
  window.history.replaceState(null, "", "/agents?tab=overview&billing=upgrade");

  globalThis.fetch = async input => {
    const url = String(input);
    if (url === "/api/account/workspaces") return Response.json(workspacesResponse());
    if (url.endsWith("/billing")) return Response.json(billingResponse());
    if (url.endsWith("/billing/topups"))
      return Response.json({ enabled: false, topups: [], ledger: [], reservations: [] });
    throw new Error(`Unexpected workspace settings request: ${url}`);
  };

  try {
    const view = render(<WorkspaceSettingsClient />);
    const upgrade = await view.findByRole("button", { name: "Upgrade to Early Access" });
    assert.ok(view.getByText("Continue your Early Access upgrade for this workspace below."));
    assert.ok(document.activeElement === upgrade, "the upgrade action should hold focus");
    assert.deepEqual(scrollCalls, [{ behavior: "smooth", block: "center" }]);
    assert.equal(window.location.search, "?tab=overview");
  } finally {
    await act(async () => cleanup());
    HTMLElement.prototype.scrollIntoView = previousScrollIntoView;
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("plan comparison stays in the active workspace and exposes the material Early Access terms", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, within } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { WorkspaceSettingsClient } = await import("./WorkspaceSettingsClient");
  const previousFetch = globalThis.fetch;
  window.history.replaceState(null, "", "/agents?tab=billing&workspace=workspace-1");

  globalThis.fetch = async input => {
    const url = String(input);
    if (url === "/api/account/workspaces") return Response.json(workspacesResponse());
    if (url.endsWith("/billing")) return Response.json(billingResponse());
    if (url.endsWith("/billing/topups"))
      return Response.json({ enabled: false, topups: [], ledger: [], reservations: [] });
    throw new Error(`Unexpected workspace settings request: ${url}`);
  };

  try {
    const view = render(<WorkspaceSettingsClient initialWorkspaceId="workspace-1" />);
    const user = userEvent.setup({ document });
    const compare = await view.findByRole("button", { name: "Compare plans" });
    await user.click(compare);
    const comparison = document.getElementById("workspace-plan-comparison");
    assert.ok(comparison);
    assert.ok(within(comparison).getByRole("heading", { name: "Free" }));
    assert.ok(within(comparison).getByRole("heading", { name: "Early Access" }));
    assert.ok(within(comparison).getByText(/60 days.*20% off/s));
    assert.equal(window.location.pathname, "/agents");
    assert.equal(window.location.search, "?tab=billing&workspace=workspace-1");
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("a subscription needing attention offers payment recovery instead of a false disabled upgrade", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render } = await import("@testing-library/react");
  const { WorkspaceSettingsClient } = await import("./WorkspaceSettingsClient");
  const previousFetch = globalThis.fetch;
  window.history.replaceState(null, "", "/agents?tab=overview");

  globalThis.fetch = async input => {
    const url = String(input);
    if (url === "/api/account/workspaces") return Response.json(workspacesResponse());
    if (url.endsWith("/billing")) {
      return Response.json(
        billingResponse({
          checkoutAvailable: false,
          checkoutBlockedReason: "subscription_requires_attention",
          status: "incomplete",
        }),
      );
    }
    if (url.endsWith("/billing/topups")) {
      return Response.json({ enabled: false, topups: [], ledger: [], reservations: [] });
    }
    throw new Error(`Unexpected workspace settings request: ${url}`);
  };

  try {
    const view = render(<WorkspaceSettingsClient />);
    assert.ok(await view.findByText(/Payment needs attention/));
    assert.ok(view.getByRole("button", { name: "Update payment method" }));
    assert.equal(view.queryByRole("button", { name: "Upgrade to Early Access" }), null);
    assert.equal(view.queryByText("Billing is not enabled yet"), null);
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("an existing non-attention subscription offers management without payment-warning copy", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render } = await import("@testing-library/react");
  const { WorkspaceSettingsClient } = await import("./WorkspaceSettingsClient");
  const previousFetch = globalThis.fetch;
  window.history.replaceState(null, "", "/agents?tab=overview");

  globalThis.fetch = async input => {
    const url = String(input);
    if (url === "/api/account/workspaces") return Response.json(workspacesResponse());
    if (url.endsWith("/billing")) {
      return Response.json(
        billingResponse({
          checkoutAvailable: false,
          checkoutBlockedReason: "manage_existing_subscription",
          status: "paused",
        }),
      );
    }
    if (url.endsWith("/billing/topups")) {
      return Response.json({ enabled: false, topups: [], ledger: [], reservations: [] });
    }
    throw new Error(`Unexpected workspace settings request: ${url}`);
  };

  try {
    const view = render(<WorkspaceSettingsClient />);
    assert.ok(await view.findByRole("button", { name: "Manage billing" }));
    assert.equal(view.queryByText(/Payment needs attention/), null);
    assert.equal(view.queryByRole("button", { name: "Upgrade to Early Access" }), null);
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("a delayed panel-funding hash target scrolls and receives focus without changing the URL", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render } = await import("@testing-library/react");
  const { WorkspaceSettingsClient } = await import("./WorkspaceSettingsClient");
  const previousFetch = globalThis.fetch;
  const previousScrollIntoView = HTMLElement.prototype.scrollIntoView;
  const scrollCalls: Array<{ target: HTMLElement; options?: boolean | ScrollIntoViewOptions }> = [];
  let resolveBilling!: (response: Response) => void;
  const delayedBilling = new Promise<Response>(resolve => {
    resolveBilling = resolve;
  });
  HTMLElement.prototype.scrollIntoView = function scrollIntoView(options?: boolean | ScrollIntoViewOptions) {
    scrollCalls.push({ target: this, options });
  };
  const expectedLocation = "/agents?tab=overview&workspace=workspace-1&view=usage#panel-funding";
  window.history.replaceState(null, "", expectedLocation);

  globalThis.fetch = async input => {
    const url = String(input);
    if (url === "/api/account/workspaces") return Response.json(workspacesResponse());
    if (url.endsWith("/billing")) return delayedBilling;
    if (url.endsWith("/billing/topups"))
      return Response.json({ enabled: false, topups: [], ledger: [], reservations: [] });
    throw new Error(`Unexpected workspace settings request: ${url}`);
  };

  try {
    const view = render(<WorkspaceSettingsClient initialWorkspaceId="workspace-1" />);
    await view.findByRole("heading", { name: "Plan and usage" });
    assert.equal(document.getElementById("panel-funding"), null, "the async funding panel should not exist yet");

    await act(async () => {
      resolveBilling(
        Response.json(
          billingResponse({
            limits: { activeAgents: 1, activePrivateGroups: 0, paidPanels: true },
          }),
        ),
      );
    });

    const panel = await view.findByRole("region", { name: "Panel funding" });
    assert.equal(document.activeElement, panel, "the delayed hash target should hold focus");
    assert.equal(scrollCalls.length, 1);
    assert.equal(scrollCalls[0]?.target, panel);
    assert.deepEqual(scrollCalls[0]?.options, { block: "start" });
    assert.equal(`${window.location.pathname}${window.location.search}${window.location.hash}`, expectedLocation);
  } finally {
    await act(async () => cleanup());
    HTMLElement.prototype.scrollIntoView = previousScrollIntoView;
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("a failed billing status refresh is surfaced instead of rejecting silently", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { WorkspaceSettingsClient } = await import("./WorkspaceSettingsClient");
  const previousFetch = globalThis.fetch;
  let billingFails = false;
  window.history.replaceState(null, "", "/agents?tab=overview&billing=success");

  globalThis.fetch = async input => {
    const url = String(input);
    if (url === "/api/account/workspaces") return Response.json(workspacesResponse());
    if (url.endsWith("/billing")) {
      // Early Access keeps the post-checkout poll idle so only the explicit refresh runs.
      return billingFails
        ? Response.json({ message: "Billing status is temporarily unavailable." }, { status: 503 })
        : Response.json(billingResponse({ plan: "early_access", checkoutAvailable: false }));
    }
    if (url.endsWith("/billing/topups"))
      return Response.json({ enabled: false, topups: [], ledger: [], reservations: [] });
    throw new Error(`Unexpected workspace settings request: ${url}`);
  };

  try {
    const view = render(<WorkspaceSettingsClient />);
    const refresh = await view.findByRole("button", { name: "Refresh status" });
    billingFails = true;
    await userEvent.setup({ document }).click(refresh);
    assert.ok(await view.findByText("Billing status is temporarily unavailable."));
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("a rejected billing detail lands focus on the exact field the server named", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { WorkspaceSettingsClient } = await import("./WorkspaceSettingsClient");
  const previousFetch = globalThis.fetch;
  window.history.replaceState(null, "", "/agents?tab=overview");

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "/api/account/workspaces") return Response.json(workspacesResponse());
    if (url.endsWith("/billing")) return Response.json(billingResponse());
    if (url.endsWith("/billing/topups"))
      return Response.json({ enabled: false, topups: [], ledger: [], reservations: [] });
    if (url.endsWith("/billing/profile")) {
      return init?.method === "PATCH"
        ? Response.json(
            { code: "invalid_billing_profile", field: "legalName", message: "Enter the legal business name." },
            { status: 400 },
          )
        : Response.json(billingProfileResponse());
    }
    throw new Error(`Unexpected workspace settings request: ${url}`);
  };

  try {
    const view = render(<WorkspaceSettingsClient />);
    const user = userEvent.setup({ document });
    await user.click(await view.findByRole("button", { name: "Business billing details" }));
    const legalName = await view.findByRole("textbox", { name: /Legal business name/ });
    await user.type(legalName, "Release Team GmbH");
    await user.type(view.getByRole("textbox", { name: /Registered address/ }), "1 Example Street, Berlin");
    await user.click(view.getByRole("button", { name: "Save billing details" }));

    await view.findByText("Enter the legal business name.");
    // The hook defers focus by one macrotask so the error text is committed first.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    assert.ok(document.activeElement === legalName, "the rejected field should hold focus");
    assert.equal(legalName.getAttribute("aria-invalid"), "true");
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("identity provider deletion and SCIM revocation wait for explicit dialog confirmation", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, waitFor, within } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { WorkspaceSettingsClient } = await import("./WorkspaceSettingsClient");
  const previousFetch = globalThis.fetch;
  const deletes: string[] = [];
  let providerDeleted = false;
  let scimRevoked = false;
  window.history.replaceState(null, "", "/agents?tab=overview");

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === "DELETE") {
      deletes.push(url);
      if (url.includes("/identity/providers/")) providerDeleted = true;
      if (url.includes("/identity/scim/")) scimRevoked = true;
      return Response.json({ ok: true });
    }
    if (url === "/api/account/workspaces") return Response.json(workspacesResponse());
    if (url.endsWith("/billing")) return Response.json(billingResponse());
    if (url.endsWith("/billing/topups")) {
      return Response.json({ enabled: false, topups: [], ledger: [], reservations: [] });
    }
    if (url.endsWith("/members")) {
      return Response.json({ viewerPrincipalId: "principal-owner", members: [], invitations: [] });
    }
    if (url.endsWith("/identity")) {
      return Response.json({
        enabled: true,
        providers: providerDeleted
          ? []
          : [
              {
                providerId: "provider-1",
                protocol: "oidc",
                domain: "company.example",
                domainVerified: true,
                enforceSso: false,
                lastSsoAt: null,
              },
            ],
        scim: scimRevoked ? [] : [{ providerId: "scim-provider-1", lastSyncAt: null, lastSyncResult: null }],
        limitations: { scimGroups: false },
      });
    }
    throw new Error(`Unexpected workspace settings request: ${url}`);
  };

  try {
    const view = render(<WorkspaceSettingsClient />);
    const user = userEvent.setup({ document });
    await user.click(await view.findByRole("button", { name: "Configure SSO and SCIM" }));

    const deleteProvider = await view.findByRole("button", { name: "Delete" });
    await user.click(deleteProvider);
    let dialog = view.getByRole("alertdialog");
    assert.ok(
      within(dialog).getByRole("heading", {
        name: "Delete this identity provider and its linked SSO accounts?",
      }),
    );
    assert.ok(
      within(dialog).getByText("The provider for company.example and its linked SSO accounts will be deleted."),
    );
    assert.equal(deletes.length, 0);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    assert.equal(view.queryByRole("alertdialog"), null);
    assert.equal(deletes.length, 0);

    await user.click(deleteProvider);
    dialog = view.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete provider" }));
    await waitFor(() =>
      assert.deepEqual(deletes, ["/api/account/workspaces/workspace-1/identity/providers/provider-1"]),
    );

    const revokeScim = await view.findByRole("button", { name: "Revoke token" });
    await user.click(revokeScim);
    dialog = view.getByRole("alertdialog");
    assert.ok(within(dialog).getByText("User provisioning will stop immediately."));
    assert.equal(deletes.length, 1);
    await user.click(within(dialog).getByRole("button", { name: "Revoke SCIM token" }));
    await waitFor(() =>
      assert.deepEqual(deletes, [
        "/api/account/workspaces/workspace-1/identity/providers/provider-1",
        "/api/account/workspaces/workspace-1/identity/scim/scim-provider-1",
      ]),
    );
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
