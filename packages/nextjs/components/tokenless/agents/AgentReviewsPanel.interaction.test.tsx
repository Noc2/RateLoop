import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

type TestAgent = {
  agentId: string;
  status: "active" | "inactive";
  currentVersion: { displayName: string };
};

function agent(agentId: string, displayName: string, status: TestAgent["status"] = "active"): TestAgent {
  return { agentId, status, currentVersion: { displayName } };
}

function ownerReviewView() {
  return {
    bindingRevision: null,
    configuration: null,
    connection: {
      allowedWorkflowKeys: ["general-assistance"],
      connectionStatus: "connected",
      integrationId: "integration-1",
    },
  };
}

function jsonForSupportingRequest(url: string) {
  if (url.endsWith("/human-review")) return Response.json(ownerReviewView());
  if (url.endsWith("/reviewers")) return Response.json({ reviewers: [] });
  if (url.endsWith("/reviewer-invitations")) return Response.json({ invitations: [] });
  return null;
}

test("one active agent opens the editor directly with reviewer access below it", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, waitFor, within } = await import("@testing-library/react");
  const { AgentReviewsPanel } = await import("./AgentReviewsPanel");
  const previousFetch = globalThis.fetch;
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/agents")) {
      return Response.json({
        canManage: true,
        agents: [agent("agent-1", "Codex"), agent("agent-old", "Archived agent", "inactive")],
      });
    }
    const response = jsonForSupportingRequest(url);
    if (response) return response;
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    render(<AgentReviewsPanel canManage workspaceId="workspace-1" />);
    const screen = within(document.body);
    const editorHeading = await screen.findByRole("heading", { name: "Finish human-review setup" });
    const reviewersHeading = await screen.findByRole("heading", { name: "Reviewers" });

    assert.equal(screen.queryByRole("combobox", { name: "Agent" }), null);
    assert.equal(screen.queryByRole("button", { name: "Edit reviews" }), null);
    assert.equal(screen.queryByText("Review configuration"), null);
    assert.equal(screen.queryByText("Archived agent"), null);
    assert.ok(editorHeading.compareDocumentPosition(reviewersHeading) & Node.DOCUMENT_POSITION_FOLLOWING);

    const registryRequest = requests.find(request => request.url.endsWith("/agents"));
    assert.ok(registryRequest);
    assert.equal(registryRequest.init?.cache, "no-store");
    assert.equal(registryRequest.init?.credentials, "same-origin");
    await waitFor(() => assert.ok(requests.some(request => request.url.endsWith("/reviewer-invitations"))));
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("multiple active agents use one compact selector and switch the direct editor", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, waitFor, within } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { AgentReviewsPanel } = await import("./AgentReviewsPanel");
  const previousFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith("/agents")) {
      return Response.json({
        canManage: true,
        agents: [agent("agent-a", "Codex"), agent("agent-b", "Support assistant")],
      });
    }
    const response = jsonForSupportingRequest(url);
    if (response) return response;
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    render(<AgentReviewsPanel canManage workspaceId="workspace-1" />);
    const screen = within(document.body);
    const selector = (await screen.findByRole("combobox", { name: "Agent" })) as HTMLSelectElement;
    assert.equal(selector.value, "agent-a");
    assert.deepEqual(
      within(selector)
        .getAllByRole("option")
        .map(option => option.textContent),
      ["Codex", "Support assistant"],
    );
    await waitFor(() => assert.ok(requests.some(url => url.endsWith("/agents/agent-a/human-review"))));

    await userEvent.setup().selectOptions(selector, "agent-b");
    assert.equal(selector.value, "agent-b");
    await waitFor(() => assert.ok(requests.some(url => url.endsWith("/agents/agent-b/human-review"))));
    assert.equal(screen.queryByRole("button", { name: "Edit reviews" }), null);
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("no active agent gives a direct route back to Connection", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, within } = await import("@testing-library/react");
  const { AgentReviewsPanel } = await import("./AgentReviewsPanel");
  const previousFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith("/agents")) {
      return Response.json({ canManage: true, agents: [agent("agent-old", "Archived agent", "inactive")] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    render(<AgentReviewsPanel canManage workspaceId="workspace-1" />);
    const screen = within(document.body);
    assert.ok(await screen.findByRole("heading", { name: "Connect an agent first" }));
    assert.equal(
      screen.getByRole("link", { name: "Go to Connection" }).getAttribute("href"),
      "/agents?tab=connect&workspace=workspace-1",
    );
    assert.equal(screen.queryByRole("heading", { name: "Reviewers" }), null);
    assert.deepEqual(requests, ["/api/account/workspaces/workspace-1/agents"]);
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("non-managers do not load or render review management", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render } = await import("@testing-library/react");
  const { AgentReviewsPanel } = await import("./AgentReviewsPanel");
  const previousFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    throw new Error("A non-manager must not fetch review management data.");
  };

  try {
    const rendered = render(<AgentReviewsPanel canManage={false} workspaceId="workspace-1" />);
    await act(async () => undefined);
    assert.equal(rendered.container.innerHTML, "");
    assert.equal(requestCount, 0);
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("changing workspaces aborts the old request and never shows the old editor", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, waitFor, within } = await import("@testing-library/react");
  const { AgentReviewsPanel } = await import("./AgentReviewsPanel");
  const previousFetch = globalThis.fetch;
  let oldRegistrySignal: AbortSignal | null = null;
  let resolveNewRegistry: ((response: Response) => void) | null = null;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "/api/account/workspaces/workspace-old/agents") {
      oldRegistrySignal = init?.signal ?? null;
      return Response.json({ canManage: true, agents: [agent("agent-old", "Old agent")] });
    }
    if (url === "/api/account/workspaces/workspace-new/agents") {
      return await new Promise<Response>(resolve => {
        resolveNewRegistry = resolve;
      });
    }
    const response = jsonForSupportingRequest(url);
    if (response) return response;
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const rendered = render(<AgentReviewsPanel canManage workspaceId="workspace-old" />);
    const screen = within(document.body);
    assert.ok(await screen.findByRole("heading", { name: "Finish human-review setup" }));

    rendered.rerender(<AgentReviewsPanel canManage workspaceId="workspace-new" />);
    assert.equal(screen.queryByRole("heading", { name: "Finish human-review setup" }), null);
    assert.ok(screen.getByRole("status"));
    await waitFor(() => assert.equal(oldRegistrySignal?.aborted, true));
    await waitFor(() => assert.ok(resolveNewRegistry));

    await act(async () => {
      resolveNewRegistry?.(Response.json({ canManage: true, agents: [] }));
    });
    assert.ok(await screen.findByRole("heading", { name: "Connect an agent first" }));
    assert.equal(screen.queryByText("Old agent"), null);
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
