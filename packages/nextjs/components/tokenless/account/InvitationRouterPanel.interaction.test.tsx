import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { withEnglishAppTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("workspace invitation codes require preview and explicit acceptance before redemption", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { InvitationRouterPanel } = await import("./InvitationRouterPanel");
  const previousFetch = globalThis.fetch;
  const calls: Array<{ body: string; url: string }> = [];
  const accepted: string[] = [];
  const code = "rlwi_example_secret";
  globalThis.fetch = async (input, init) => {
    calls.push({ body: String(init?.body), url: String(input) });
    if (String(input).endsWith("/preview")) {
      return Response.json({
        invitation: {
          workspaceName: "Example workspace",
          clientName: "Client Alpha",
          invitedAccessRole: "admin",
          governanceRole: "decision_owner",
          expiresAt: "2030-01-01T00:00:00.000Z",
          currentAccessRole: "member",
          effectiveAccessRole: "admin",
          upgradesExistingMembership: true,
        },
      });
    }
    return Response.json({ workspaceId: "workspace_1" });
  };

  try {
    const view = render(<InvitationRouterPanel onAccepted={kind => accepted.push(kind)} />);
    const user = userEvent.setup({ document });
    await user.type(view.getByLabelText("Invitation code"), code);
    await user.click(view.getByRole("button", { name: "Continue" }));

    assert.ok(await view.findByText("Workspace invitation"));
    assert.ok(view.getByText("Example workspace"));
    assert.ok(view.getByText("Client Alpha"));
    assert.ok(view.getByText("Decision owner"));
    assert.ok(view.getByText("This changes your access from Member to Admin."));
    assert.deepEqual(accepted, []);
    await user.click(view.getByRole("button", { name: "Accept invitation" }));
    await waitFor(() => assert.deepEqual(accepted, ["workspace"]));
    assert.deepEqual(calls, [
      {
        body: JSON.stringify({ token: code }),
        url: "/api/account/workspace-invitations/preview",
      },
      {
        body: JSON.stringify({ token: code }),
        url: "/api/account/workspace-invitations/redeem",
      },
    ]);
    assert.ok(calls.every(call => !call.url.includes(code)));
    assert.ok(view.getByRole("status").textContent?.includes("Workspace invitation accepted"));
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("workspace reviewer invitations are previewed, redeemed from the body, and notify the caller", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { InvitationRouterPanel } = await import("./InvitationRouterPanel");
  const previousFetch = globalThis.fetch;
  const calls: Array<{ body: string; url: string }> = [];
  const accepted: string[] = [];
  const code = "rlri_example_secret";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ body: String(init?.body), url });
    if (url.endsWith("/preview")) {
      return Response.json({
        invitation: {
          accessExpiresAt: null,
          expiresAt: "2030-01-01T00:00:00.000Z",
          maxPrivateSensitivity: "confidential",
          workspaceName: "Example workspace",
        },
      });
    }
    return Response.json({ reviewer: { principalAddress: "rlp_reviewer" } });
  };

  try {
    const view = render(<InvitationRouterPanel onAccepted={kind => accepted.push(kind)} />);
    const user = userEvent.setup({ document });
    await user.type(view.getByLabelText("Invitation code"), code);
    await user.click(view.getByRole("button", { name: "Continue" }));
    assert.ok((await view.findByText("Reviewer invitation")).textContent);
    assert.ok(view.getByText("Review assigned private work without joining the workspace."));
    assert.ok(view.getByText("confidential"));
    assert.equal(accepted.length, 0);
    await user.click(view.getByRole("button", { name: "Accept invitation" }));

    await waitFor(() => assert.deepEqual(accepted, ["reviewer"]));
    assert.deepEqual(calls, [
      {
        body: JSON.stringify({ token: code }),
        url: "/api/account/reviewer-invitations/preview",
      },
      {
        body: JSON.stringify({ token: code }),
        url: "/api/account/reviewer-invitations/redeem",
      },
    ]);
    assert.ok(calls.every(call => !call.url.includes(code)));
    assert.ok(view.getByRole("status").textContent?.includes("Reviewer invitation accepted"));
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("reviewer invitation acceptance stays bound to the latest completed preview", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { InvitationRouterPanel } = await import("./InvitationRouterPanel");
  const previousFetch = globalThis.fetch;
  const codeA = "rlri_preview_a";
  const codeB = "rlri_preview_b";
  const previewRequests: Array<{
    body: string;
    resolve: (response: Response) => void;
    signal: AbortSignal | null;
  }> = [];
  const redeemed: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/preview")) {
      return new Promise<Response>(resolve =>
        previewRequests.push({ body: String(init?.body), resolve, signal: init?.signal as AbortSignal | null }),
      );
    }
    redeemed.push(String(init?.body));
    return Response.json({ reviewer: { principalAddress: "rlp_reviewer" } });
  };

  try {
    const view = render(<InvitationRouterPanel />);
    const user = userEvent.setup({ document });
    const input = view.getByLabelText("Invitation code");
    await user.type(input, codeA);
    await user.click(view.getByRole("button", { name: "Continue" }));
    await waitFor(() => assert.equal(previewRequests.length, 1));

    await user.clear(input);
    await user.type(input, codeB);
    assert.equal(previewRequests[0]?.signal?.aborted, true);
    await act(async () => {
      previewRequests[0]?.resolve(
        Response.json({
          invitation: {
            accessExpiresAt: null,
            expiresAt: "2030-01-01T00:00:00.000Z",
            maxPrivateSensitivity: "internal",
            workspaceName: "Stale workspace A",
          },
        }),
      );
      await Promise.resolve();
    });
    assert.equal(view.queryByText("Stale workspace A"), null);

    await user.click(view.getByRole("button", { name: "Continue" }));
    await waitFor(() => assert.equal(previewRequests.length, 2));
    await act(async () => {
      previewRequests[1]?.resolve(
        Response.json({
          invitation: {
            accessExpiresAt: null,
            expiresAt: "2030-01-01T00:00:00.000Z",
            maxPrivateSensitivity: "confidential",
            workspaceName: "Current workspace B",
          },
        }),
      );
      await Promise.resolve();
    });
    assert.ok(await view.findByText("Current workspace B"));
    await user.click(view.getByRole("button", { name: "Accept invitation" }));

    await waitFor(() => assert.deepEqual(redeemed, [JSON.stringify({ token: codeB })]));
    assert.deepEqual(
      previewRequests.map(request => request.body),
      [JSON.stringify({ token: codeA }), JSON.stringify({ token: codeB })],
    );
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("workspace reviewer invitation links hydrate from the fragment without leaking the token in a request URL", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { InvitationRouterPanel } = await import("./InvitationRouterPanel");
  const previousFetch = globalThis.fetch;
  const calls: Array<{ body: string; url: string }> = [];
  const code = "rlri_0123456789abcdef_0123456789012345678901234567890123456789012";
  window.history.replaceState(null, "", `/human?tab=discover&invite=1#invite=${code}`);
  globalThis.fetch = async (input, init) => {
    calls.push({ body: String(init?.body), url: String(input) });
    return Response.json({
      invitation: {
        accessExpiresAt: null,
        expiresAt: "2030-01-01T00:00:00.000Z",
        maxPrivateSensitivity: "confidential",
        workspaceName: "Example workspace",
      },
    });
  };
  try {
    const view = render(<InvitationRouterPanel />);
    await view.findByText("Reviewer invitation");
    assert.equal((view.getByLabelText("Invitation code") as HTMLInputElement).value, code);
    assert.equal(window.location.hash, "");
    assert.equal(window.location.search, "?tab=discover&invite=1");
    assert.deepEqual(calls, [
      {
        body: JSON.stringify({ token: code }),
        url: "/api/account/reviewer-invitations/preview",
      },
    ]);
    assert.equal(calls[0]?.url.includes(code), false);
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("legacy private-group invitation codes are no longer accepted", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { InvitationRouterPanel } = await import("./InvitationRouterPanel");
  const previousFetch = globalThis.fetch;
  const calls: Array<{ body: string; url: string }> = [];
  const code = "rlgi_example_secret";
  globalThis.fetch = async (input, init) => {
    calls.push({ body: String(init?.body), url: String(input) });
    return Response.json({});
  };

  try {
    const view = render(<InvitationRouterPanel />);
    const user = userEvent.setup({ document });
    await user.type(view.getByLabelText("Invitation code"), code);
    await user.click(view.getByRole("button", { name: "Continue" }));
    await waitFor(() => assert.ok(view.getByRole("alert").textContent?.includes("valid RateLoop invitation code")));
    assert.deepEqual(calls, []);
    assert.equal(view.queryByRole("button", { name: "Accept invitation" }), null);
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
