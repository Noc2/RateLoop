import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { withEnglishAppTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("an owner can confirm exact specialist areas for an active invited reviewer", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { WorkspaceReviewersPanel } = await import("./WorkspaceReviewersPanel");
  const previousFetch = globalThis.fetch;
  const writes: Array<{ body: Record<string, unknown>; url: string }> = [];
  const definition = {
    definitionId: "expd_code_review_typescript",
    definitionVersion: 3,
    definitionHash: `sha256:${"a".repeat(64)}`,
  };

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === "PUT") {
      writes.push({ body: JSON.parse(String(init.body)) as Record<string, unknown>, url });
      return Response.json({ expertise: { grants: [definition] } });
    }
    if (url.endsWith("/reviewers")) {
      return Response.json({
        reviewers: [
          {
            principalAddress: "rlp_invited_reviewer",
            displayName: "Invited reviewer",
            email: "reviewer@example.test",
            status: "active",
            activatedAt: "2026-07-25T00:00:00.000Z",
            grants: [
              {
                grantId: "wrg_active",
                maxPrivateSensitivity: "confidential",
                validUntil: "2027-01-01T00:00:00.000Z",
                status: "active",
              },
            ],
          },
        ],
      });
    }
    if (url.endsWith("/reviewer-invitations")) return Response.json({ invitations: [] });
    if (url.endsWith("/agents/agent-1/human-review")) {
      return Response.json({
        configuration: {
          requestProfile: {
            value: {
              audience: "private_invited",
              privateGroupId: "pgrp_exact_reviewers",
              expertiseRequirements: [{ ...definition, minimumSeats: 1, sourceScope: "customer_invited" }],
            },
          },
        },
      });
    }
    if (url.endsWith("/reviewer-expertise/definitions")) {
      return Response.json({
        definitions: [{ definitionId: definition.definitionId, label: "TypeScript code review" }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const view = render(<WorkspaceReviewersPanel agentId="agent-1" canManage workspaceId="workspace-1" />);
    const button = await view.findByRole("button", { name: "Confirm specialist areas" });
    assert.equal(button.getAttribute("title"), "Attest: TypeScript code review");
    await userEvent.setup({ document }).click(button);

    await waitFor(() => assert.equal(writes.length, 1));
    assert.equal(
      writes[0]?.url,
      "/api/account/workspaces/workspace-1/private-groups/pgrp_exact_reviewers/members/rlp_invited_reviewer/expertise",
    );
    assert.deepEqual(writes[0]?.body, {
      definitions: [definition],
      expiresAt: "2027-01-01T00:00:00.000Z",
    });
    assert.ok(await view.findByRole("status"));
    assert.match(view.getByRole("status").textContent ?? "", /Specialist areas confirmed for Invited reviewer/u);
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("reviewer removal and invitation revocation require their explicit dialogs", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render: baseRender, waitFor, within } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { WorkspaceReviewersPanel } = await import("./WorkspaceReviewersPanel");
  const previousFetch = globalThis.fetch;
  const deletes: string[] = [];
  let reviewerRemoved = false;
  let invitationRevoked = false;

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === "DELETE") {
      deletes.push(url);
      if (url.includes("/reviewer-invitations/")) invitationRevoked = true;
      else reviewerRemoved = true;
      return Response.json({ ok: true });
    }
    if (url.endsWith("/reviewers")) {
      return Response.json({
        reviewers: reviewerRemoved
          ? []
          : [
              {
                principalAddress: "rlp_reviewer_ada",
                displayName: "Ada",
                email: "ada@example.test",
                status: "active",
                activatedAt: "2026-07-25T00:00:00.000Z",
                grants: [],
              },
            ],
      });
    }
    if (url.endsWith("/reviewer-invitations")) {
      return Response.json({
        invitations: invitationRevoked
          ? []
          : [
              {
                invitationId: "reviewer-invite-1",
                tokenPrefix: "rlri_123",
                hasAccountBinding: false,
                hasEmailBinding: true,
                intendedEmailDomain: "example.test",
                accessExpiresAt: null,
                expiresAt: "2027-08-01T00:00:00.000Z",
                maximumRedemptions: 1,
                redemptionCount: 0,
                revokedAt: null,
              },
            ],
      });
    }
    if (url.endsWith("/agents/agent-1/human-review")) return Response.json({ configuration: null });
    if (url.endsWith("/reviewer-expertise/definitions")) return Response.json({ definitions: [] });
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const view = render(<WorkspaceReviewersPanel agentId="agent-1" canManage workspaceId="workspace-1" />);
    const user = userEvent.setup({ document });
    const remove = await view.findByRole("button", { name: "Remove" });
    await user.click(remove);
    let dialog = view.getByRole("alertdialog");
    assert.ok(within(dialog).getByRole("heading", { name: "Remove Ada from this workspace's reviewers?" }));
    assert.equal(deletes.length, 0);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    assert.equal(deletes.length, 0);

    await user.click(remove);
    dialog = view.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove reviewer" }));
    await waitFor(() => assert.deepEqual(deletes, ["/api/account/workspaces/workspace-1/reviewers/rlp_reviewer_ada"]));

    const revoke = await view.findByRole("button", { name: "Revoke" });
    await user.click(revoke);
    dialog = view.getByRole("alertdialog");
    assert.ok(within(dialog).getByText("The reviewer invitation will stop working."));
    await user.click(within(dialog).getByRole("button", { name: "Revoke invitation" }));
    await waitFor(() =>
      assert.deepEqual(deletes, [
        "/api/account/workspaces/workspace-1/reviewers/rlp_reviewer_ada",
        "/api/account/workspaces/workspace-1/reviewer-invitations/reviewer-invite-1",
      ]),
    );
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
