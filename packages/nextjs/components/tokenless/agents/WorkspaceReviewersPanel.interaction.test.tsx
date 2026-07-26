import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("an owner can confirm exact specialist areas for an active invited reviewer", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render, waitFor } = await import("@testing-library/react");
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
