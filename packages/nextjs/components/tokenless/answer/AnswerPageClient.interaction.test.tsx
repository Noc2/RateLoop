import React from "react";
import type { PublicAnswerTask } from "./PublicQuestionCard";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

const PRINCIPAL = `rlp_${"a".repeat(48)}`;

const publicTask: PublicAnswerTask = {
  operationKey: "public-task-queue-1",
  chainId: 84532,
  panelAddress: `0x${"1".repeat(40)}`,
  roundId: "41",
  contentId: `0x${"2".repeat(64)}`,
  reviewerSource: "customer_invited",
  question: {
    kind: "binary",
    prompt: "Does the summary match the transcript?",
    positiveLabel: "Matches",
    negativeLabel: "Does not match",
    rationale: { mode: "optional", maxLength: 500 },
  },
  voucherDeadline: "2099-07-17T09:00:00.000Z",
  alreadyVouchered: false,
  earnings: {
    guaranteedBaseAtomic: "1000000",
    possibleBonusAtomic: "500000",
    possibleSurpriseBonusAtomic: "250000",
    attemptCompensationAtomic: "100000",
  },
  disclosureBeacon: { network: "quicknet-t", round: 1 },
  scoringBeacon: { network: "quicknet-t", round: 2 },
};

const privateAssignment = {
  assignmentId: "hasn_private_queue_1",
  projectName: "Private safety review",
  dataClassification: "Confidential",
  source: "workspace",
  status: "accepted",
  paidAssignment: true,
  confidentialityTermsHash: `sha256:${"5".repeat(64)}`,
  assignmentExpiresAt: "2099-07-17T09:00:00.000Z",
  caseCount: 3,
};

const router = {
  push: () => undefined,
  replace: () => undefined,
  refresh: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => undefined,
};

function installQueueFetch(queues: { assignments: unknown[]; tasks: unknown[] }) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url === "/api/auth/session") {
      return Response.json({
        authenticated: true,
        principalId: PRINCIPAL,
        authProvider: "email",
        displayName: null,
        expiresAt: "2099-07-18T12:00:00.000Z",
        wallets: { funding: null, payout: `0x${"3".repeat(40)}`, recovery: null },
      });
    }
    if (url.startsWith("/api/rater/tasks")) {
      return Response.json({ tasks: queues.tasks, paidAccess: { state: "ready" } });
    }
    if (url.startsWith("/api/account/assurance/assignments")) {
      return Response.json({ principalId: PRINCIPAL, assignments: queues.assignments });
    }
    throw new Error(`Unexpected review-queue request: ${url}`);
  };
  return () => {
    globalThis.fetch = previousFetch;
  };
}

// The review queue keeps loading in the background, so unmounting has to settle before the JSDOM
// globals are torn down.
function settle() {
  return new Promise(resolve => setTimeout(resolve, 50));
}

test("a selected private scope with no assignments left still renders the public review work", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, waitFor, within } = await import("@testing-library/react");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { AnswerPageClient } = await import("./AnswerPageClient");
  // The one private assignment has been submitted, so only public review work is left in the queue.
  const restoreFetch = installQueueFetch({ assignments: [], tasks: [publicTask] });

  try {
    render(
      <AppRouterContext.Provider value={router as never}>
        <AnswerPageClient initialScope="private" />
      </AppRouterContext.Provider>,
    );
    const screen = within(document.body);
    await waitFor(() => assert.ok(screen.getByText(publicTask.question.prompt)));

    const pills = screen.getAllByRole<HTMLButtonElement>("tab");
    assert.deepEqual(
      pills.map(pill => pill.textContent),
      ["all", "public", "private"],
    );
    assert.deepEqual(
      pills.map(pill => pill.getAttribute("aria-selected")),
      ["true", "false", "false"],
    );
    assert.equal(screen.queryByText(/No review work is available right now/iu), null);
  } finally {
    cleanup();
    await settle();
    restoreFetch();
    restoreDom();
  }
});

test("a selected public scope with no tasks left still renders the private review work", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, waitFor, within } = await import("@testing-library/react");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { AnswerPageClient } = await import("./AnswerPageClient");
  const restoreFetch = installQueueFetch({ assignments: [privateAssignment], tasks: [] });

  try {
    render(
      <AppRouterContext.Provider value={router as never}>
        <AnswerPageClient initialScope="public" initialView="history" />
      </AppRouterContext.Provider>,
    );
    const screen = within(document.body);
    await waitFor(() => assert.ok(screen.getByRole("heading", { name: privateAssignment.projectName })));

    assert.deepEqual(
      screen.getAllByRole("tab").map(pill => pill.getAttribute("aria-selected")),
      ["true", "false", "false"],
    );
    assert.equal(screen.queryByText(/No review work is available right now/iu), null);
  } finally {
    cleanup();
    await settle();
    restoreFetch();
    restoreDom();
  }
});

test("a selected scope still filters out the other kind of review work while both exist", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, waitFor, within } = await import("@testing-library/react");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { AnswerPageClient } = await import("./AnswerPageClient");
  const restoreFetch = installQueueFetch({ assignments: [privateAssignment], tasks: [publicTask] });

  try {
    render(
      <AppRouterContext.Provider value={router as never}>
        <AnswerPageClient initialScope="public" />
      </AppRouterContext.Provider>,
    );
    const screen = within(document.body);
    await waitFor(() => assert.ok(screen.getByText(publicTask.question.prompt)));

    assert.equal(screen.queryByText(privateAssignment.projectName), null);
    assert.deepEqual(
      screen.getAllByRole("tab").map(pill => pill.getAttribute("aria-selected")),
      ["false", "true", "false"],
    );
  } finally {
    cleanup();
    await settle();
    restoreFetch();
    restoreDom();
  }
});

test("an empty review queue keeps its empty state and hides the scope pills", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, waitFor, within } = await import("@testing-library/react");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { AnswerPageClient } = await import("./AnswerPageClient");
  const restoreFetch = installQueueFetch({ assignments: [], tasks: [] });

  try {
    render(
      <AppRouterContext.Provider value={router as never}>
        <AnswerPageClient initialScope="private" />
      </AppRouterContext.Provider>,
    );
    const screen = within(document.body);
    await waitFor(() => assert.ok(screen.getByText(/No review work is available right now/iu)));
    assert.deepEqual(screen.queryAllByRole("tab"), []);
  } finally {
    cleanup();
    await settle();
    restoreFetch();
    restoreDom();
  }
});
