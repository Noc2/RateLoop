import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { withEnglishAppTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "~~/components/tokenless/testing/dom";

const REFRESH_FAILURE = "Connection status could not refresh. RateLoop will retry while this page is visible.";

/**
 * A bare jsdom document reports "prerender", and the panel only polls a visible page. Making it
 * visible also makes each poll drivable: the panel re-polls immediately on `visibilitychange`, so
 * dispatching that event exercises the real poll path without waiting five seconds per refresh.
 */
function showDocument() {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  return () => Reflect.deleteProperty(document, "visibilityState");
}

/**
 * Drives one real poll and flushes until `settled` holds, so the assertion that follows never
 * depends on how long four mocked requests take under load. A poll that never settles simply runs
 * out of budget and leaves the caller's own assertion to report the failure.
 */
async function pollUntil(act: (callback: () => Promise<void>) => Promise<unknown>, settled: () => boolean) {
  for (let attempt = 0; attempt < 100 && !settled(); attempt += 1) {
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await new Promise(resolve => globalThis.setTimeout(resolve, 10));
    });
  }
}

function activeIntent() {
  return {
    intentId: "intent-1",
    status: "issued",
    createdAt: new Date().toISOString(),
    hardExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
}

function connectedIntegration() {
  return {
    integrationId: "integration-1",
    status: "active",
    connectionStatus: "connected",
    displayName: "Codex",
    credentialExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  };
}

test("a recovered poll clears its own refresh-failure banner", async () => {
  const restoreDom = installTestDom();
  const restoreVisibility = showDocument();
  const { act, cleanup, render: baseRender, within } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { RateLoopNotificationProvider } = await import("~~/components/tokenless/RateLoopNotificationProvider");
  const { AgentConnectionPanel } = await import("./AgentConnectionPanel");
  const previousFetch = globalThis.fetch;
  let failLoads = false;

  globalThis.fetch = async input => {
    const url = String(input);
    if (url.endsWith("/agent-connections")) {
      if (failLoads) return Response.json({ message: "Upstream is unavailable." }, { status: 503 });
      return Response.json({ intents: [activeIntent()] });
    }
    if (url.endsWith("/agent-pairings")) return Response.json({ pairings: [] });
    if (url.endsWith("/agent-integrations")) return Response.json({ integrations: [] });
    if (url.endsWith("/agent-publishing-policies")) return Response.json({ policies: [] });
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    render(
      <RateLoopNotificationProvider>
        <AgentConnectionPanel workspaceId="workspace-1" />
      </RateLoopNotificationProvider>,
    );
    const screen = within(document.body);
    await screen.findByRole("heading", { name: "Waiting for the agent to open your connection" });

    failLoads = true;
    await pollUntil(act, () => screen.queryByText(REFRESH_FAILURE) !== null);
    const banner = screen.getByText(REFRESH_FAILURE);
    assert.equal(banner.getAttribute("role"), "alert");

    // The next poll succeeds: the banner it owns must go away by itself.
    failLoads = false;
    await pollUntil(act, () => screen.queryByText(REFRESH_FAILURE) === null);
    // assert.ok keeps a failure message short; assert.equal would try to inspect a whole DOM node.
    assert.ok(
      screen.queryByText(REFRESH_FAILURE) === null,
      "a recovered poll must clear the refresh-failure banner it raised",
    );
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreVisibility();
    restoreDom();
  }
});

test("polling reports the connection state once instead of on every refresh", async () => {
  const restoreDom = installTestDom();
  const restoreVisibility = showDocument();
  const { act, cleanup, render: baseRender, within } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { RateLoopNotificationProvider } = await import("~~/components/tokenless/RateLoopNotificationProvider");
  const { AgentConnectionPanel } = await import("./AgentConnectionPanel");
  const previousFetch = globalThis.fetch;
  const reported: boolean[] = [];
  let intentRequests = 0;

  globalThis.fetch = async input => {
    const url = String(input);
    if (url.endsWith("/agent-connections")) {
      intentRequests += 1;
      return Response.json({ intents: [activeIntent()] });
    }
    if (url.endsWith("/agent-pairings")) return Response.json({ pairings: [] });
    if (url.endsWith("/agent-integrations")) return Response.json({ integrations: [connectedIntegration()] });
    if (url.endsWith("/agent-publishing-policies")) return Response.json({ policies: [] });
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    render(
      <RateLoopNotificationProvider>
        <AgentConnectionPanel
          workspaceId="workspace-1"
          onConnectionStateChange={connected => reported.push(connected)}
        />
      </RateLoopNotificationProvider>,
    );
    const screen = within(document.body);
    await screen.findByRole("heading", { name: "Waiting for the agent to open your connection" });
    assert.deepEqual(reported, [true]);

    // Three more polls land while the connection state is unchanged. Each one used to be reported
    // as a change, which collapsed the expanded "Audit history" panel every five seconds.
    for (let poll = 0; poll < 3; poll += 1) {
      const target = intentRequests + 1;
      await pollUntil(act, () => intentRequests >= target);
    }
    assert.ok(intentRequests >= 4, `expected at least four loads, saw ${intentRequests}`);
    assert.deepEqual(reported, [true]);
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreVisibility();
    restoreDom();
  }
});

test("copying the visible message clears the clipboard-failure banner it replaced", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, fireEvent, render: baseRender, within } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { RateLoopNotificationProvider } = await import("~~/components/tokenless/RateLoopNotificationProvider");
  const { AgentConnectionPanel } = await import("./AgentConnectionPanel");
  const previousFetch = globalThis.fetch;
  let clipboardWorks = false;

  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () => {
        if (!clipboardWorks) throw new Error("Write permission denied.");
      },
    },
  });
  // jsdom is not visual, so the panel's focus-on-next-frame call needs a stand-in.
  Object.defineProperty(globalThis.window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: () => void) => globalThis.setTimeout(callback, 0),
  });

  globalThis.fetch = async input => {
    const url = String(input);
    if (url.endsWith("/agent-connections")) {
      return Response.json({ intents: [], connectionUrl: "https://rateloop.test/connect/abc" });
    }
    if (url.endsWith("/agent-pairings")) return Response.json({ pairings: [] });
    if (url.endsWith("/agent-integrations")) return Response.json({ integrations: [] });
    if (url.endsWith("/agent-publishing-policies")) return Response.json({ policies: [] });
    if (url.endsWith("/onboarding-events")) return Response.json({ ok: true });
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    render(
      <RateLoopNotificationProvider>
        <AgentConnectionPanel workspaceId="workspace-1" />
      </RateLoopNotificationProvider>,
    );
    const screen = within(document.body);
    const start = await screen.findByRole("button", { name: "Copy connection message" });

    await act(async () => {
      fireEvent.click(start);
      await new Promise(resolve => globalThis.setTimeout(resolve, 10));
    });
    assert.ok(screen.getByText(/Clipboard access was denied/));

    clipboardWorks = true;
    const copyVisible = screen.getByRole("button", { name: "Copy message" });
    await act(async () => {
      fireEvent.click(copyVisible);
      await new Promise(resolve => globalThis.setTimeout(resolve, 10));
    });
    assert.ok(
      screen.queryByText(/Clipboard access was denied/) === null,
      "a successful manual copy must clear the clipboard-failure banner",
    );
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    Reflect.deleteProperty(globalThis.navigator, "clipboard");
    restoreDom();
  }
});

test("all five consequential connection actions require confirmation before sending their original mutations", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, fireEvent, render: baseRender, waitFor, within } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { RateLoopNotificationProvider } = await import("~~/components/tokenless/RateLoopNotificationProvider");
  const { AgentConnectionPanel } = await import("./AgentConnectionPanel");
  const previousFetch = globalThis.fetch;
  const mutations: Array<{ method: string; url: string; body: string | null }> = [];
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const intent = {
    intentId: "intent-1",
    status: "issued",
    createdAt: new Date().toISOString(),
    hardExpiresAt: future,
    workspaceMove: {
      transferId: "move-1",
      status: "owner_approval_required",
      sourceConfirmedAt: new Date().toISOString(),
      targetApprovedAt: null,
      expiresAt: future,
    },
  };
  const pairing = {
    pairingId: "pairing-1",
    status: "open",
    createdAt: new Date().toISOString(),
    expiresAt: future,
  };
  const integration = {
    integrationId: "integration-1",
    apiKeyId: "api-key-1",
    agentId: "agent-1",
    agentDisplayName: "Legacy Agent",
    status: "active",
    connectionStatus: "connected",
    credentialExpiresAt: future,
  };

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "GET") {
      if (url.endsWith("/agent-connections")) return Response.json({ intents: [intent] });
      if (url.endsWith("/agent-pairings")) return Response.json({ pairings: [pairing] });
      if (url.endsWith("/agent-integrations")) return Response.json({ integrations: [integration] });
      if (url.endsWith("/agent-publishing-policies")) return Response.json({ policies: [] });
    }

    mutations.push({ method, url, body: typeof init?.body === "string" ? init.body : null });
    if (url.endsWith("/agent-integrations/integration-1/rotate")) {
      return Response.json({ secret: "replacement-secret", mcpUrl: "https://rateloop.test/mcp" });
    }
    return Response.json({ ok: true });
  };

  try {
    render(
      <RateLoopNotificationProvider>
        <AgentConnectionPanel workspaceId="workspace-1" />
      </RateLoopNotificationProvider>,
    );
    const screen = within(document.body);
    await screen.findByRole("heading", { name: "Approve reconnecting this agent" });
    fireEvent.click(screen.getByRole("button", { name: "Manage connected agents" }));

    const confirmations = [
      {
        opener: "Approve reconnect",
        title: "Reconnect this agent here?",
        description:
          "Its current RateLoop workspace connection will stop, and this agent's previous credential will be replaced.",
      },
      {
        opener: "Cancel attempt",
        title: "Cancel this connection attempt?",
        description: "Its original message will stop working.",
      },
      {
        opener: "Cancel legacy request",
        title: "Reject this agent registration request?",
        description: "The pairing secret cannot be reused.",
      },
      {
        opener: "Rotate legacy credential",
        title: "Rotate the credential for Legacy Agent?",
        description: "The previous credential will no longer be valid. The replacement is shown once.",
      },
      {
        opener: "Disconnect",
        title: "Disconnect Legacy Agent from RateLoop?",
        description: "Its current RateLoop access will stop.",
      },
    ] as const;

    for (const confirmation of confirmations) {
      const opener = screen.getByRole("button", { name: confirmation.opener });
      const mutationCount = mutations.length;
      opener.focus();
      fireEvent.click(opener);
      const dialog = screen.getByRole("alertdialog");
      assert.ok(within(dialog).getByRole("heading", { name: confirmation.title }));
      assert.ok(within(dialog).getByText(confirmation.description));
      assert.equal(mutations.length, mutationCount, `${confirmation.opener} must not mutate when its dialog opens`);
      assert.equal(document.activeElement, within(dialog).getByRole("button", { name: "Cancel" }));

      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() => assert.equal(screen.queryByRole("alertdialog"), null));
      assert.equal(mutations.length, mutationCount, `${confirmation.opener} must not mutate when cancelled`);
      assert.equal(document.activeElement, opener);
    }

    const confirmedActions = [
      {
        opener: "Approve reconnect",
        confirm: "Approve reconnect",
        status: "Reconnect approved. Return to the same agent task; it can now finish automatically.",
      },
      {
        opener: "Cancel attempt",
        confirm: "Cancel attempt",
        status: "Connection attempt cancelled. You can create a new message when ready.",
      },
      {
        opener: "Cancel legacy request",
        confirm: "Reject request",
        status: "Agent registration rejected.",
      },
      {
        opener: "Rotate legacy credential",
        confirm: "Rotate credential",
        status: "Credential rotated. The previous credential is no longer valid.",
      },
      {
        opener: "Disconnect",
        confirm: "Disconnect",
        status: "Agent disconnected.",
      },
    ] as const;

    for (const action of confirmedActions) {
      const mutationCount = mutations.length;
      const opener = screen.getByRole("button", { name: action.opener });
      opener.focus();
      fireEvent.click(opener);
      const dialog = screen.getByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: action.confirm }));
      await waitFor(() => assert.equal(mutations.length, mutationCount + 1));
      await waitFor(() => assert.equal(screen.queryByRole("alertdialog"), null));
      const feedback = await screen.findByText(action.status);
      await waitFor(() => assert.equal(document.activeElement, feedback));
    }

    assert.deepEqual(
      mutations.map(request => ({
        method: request.method,
        path: new URL(request.url, "https://rateloop.test").pathname,
        body: request.body,
      })),
      [
        {
          method: "POST",
          path: "/api/account/workspaces/workspace-1/agent-connection-moves/move-1/approve",
          body: JSON.stringify({ decision: "approve" }),
        },
        {
          method: "DELETE",
          path: "/api/account/workspaces/workspace-1/agent-connections/intent-1",
          body: null,
        },
        {
          method: "POST",
          path: "/api/account/workspaces/workspace-1/agent-pairings/pairing-1/reject",
          body: null,
        },
        {
          method: "POST",
          path: "/api/account/workspaces/workspace-1/agent-integrations/integration-1/rotate",
          body: null,
        },
        {
          method: "DELETE",
          path: "/api/account/workspaces/workspace-1/agent-integrations/integration-1",
          body: null,
        },
      ],
    );
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
