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
