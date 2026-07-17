import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";
import type { HumanReviewApproval } from "~~/lib/tokenless/humanReviewApprovals";

const approval: HumanReviewApproval = {
  approvalId: "approval-1",
  revision: 3,
  status: "pending",
  lifecycleRevision: 1,
  preparedRequestHash: `sha256:${"1".repeat(64)}`,
  derivedEconomicsHash: `sha256:${"2".repeat(64)}`,
  createdAt: "2026-07-17T08:00:00.000Z",
  expiresAt: "2026-07-17T09:00:00.000Z",
  preparedRequest: {
    schemaVersion: "rateloop.human-review-prepared-request.v1",
    opportunityId: "opportunity-1",
    workflowKey: "release-check",
    requestProfile: { id: "profile-1", version: 1, hash: `sha256:${"3".repeat(64)}` },
    question: {
      criterion: "Is this release ready?",
      positiveLabel: "Yes",
      negativeLabel: "No",
      rationaleMode: "required",
    },
    audience: {
      kind: "public_network",
      contentBoundary: "public_or_test",
      privateSensitivity: null,
      privateGroupId: null,
    },
    timing: { responseWindowSeconds: 900, expiresAt: "2026-07-17T09:00:00.000Z" },
    panel: { size: 3 },
    contentCommitments: { source: `sha256:${"4".repeat(64)}`, suggestion: `sha256:${"5".repeat(64)}` },
    provenance: {
      agentId: "agent-1",
      agentVersionId: "version-1",
      selectionPolicyId: "policy-1",
      selectionPolicyVersion: 1,
    },
  },
  economics: {
    schemaVersion: "rateloop.human-review-derived-economics.v1",
    compensationMode: "usdc",
    bountyPerSeatAtomic: "1000000",
    panelSize: 3,
    baseBountyAtomic: "3000000",
    feeBps: 500,
    feeAtomic: "150000",
    attemptReserveAtomic: "300000",
    maximumChargeAtomic: "3450000",
  },
  feedbackBonusEconomics: {
    schemaVersion: "rateloop.feedback-bonus-economics.v1",
    enabled: false,
    currency: null,
    poolAtomic: "0",
    awarder: { kind: "requester", account: null },
    awardWindowSeconds: null,
    agentMayAward: false,
  },
  maximumConsentAtomic: "3450000",
};

test("owners can load and approve a prepared request", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, screen, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { HumanReviewApprovalInbox } = await import("./HumanReviewApprovalInbox");
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  let listCount = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    if (init?.method === "PUT") return Response.json({ approval: { ...approval, status: "approved" } });
    listCount += 1;
    return Response.json({ approvals: listCount === 1 ? [approval] : [] });
  };

  try {
    render(<HumanReviewApprovalInbox workspaceId="workspace one" />);
    const approve = await screen.findByRole("button", { name: "Approve request" });
    assert.equal(screen.getByText("Is this release ready?").textContent, "Is this release ready?");
    await userEvent.setup().click(approve);
    await waitFor(() => assert.ok(screen.getByText("No requests need approval")));

    const mutation = requests.find(request => request.init?.method === "PUT");
    assert.ok(mutation);
    assert.match(mutation.input, /workspace%20one\/human-review\/approvals\/approval-1$/);
    assert.deepEqual(JSON.parse(String(mutation.init?.body)), {
      revision: 3,
      preparedRequestHash: approval.preparedRequestHash,
      derivedEconomicsHash: approval.derivedEconomicsHash,
      decision: "approve",
      note: null,
    });
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
