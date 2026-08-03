import React from "react";
import type { PublicAnswerTask } from "./PublicQuestionCard";
import assert from "node:assert/strict";
import test from "node:test";
import { withEnglishAppTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "~~/components/tokenless/testing/dom";

const PRINCIPAL = `rlp_${"a".repeat(48)}`;

const publicTask: PublicAnswerTask = {
  operationKey: "public-task-queue-1",
  chainId: 84532,
  panelAddress: `0x${"1".repeat(40)}`,
  roundId: "41",
  contentId: `0x${"2".repeat(64)}`,
  reviewerSource: "customer_invited",
  assignmentId: "assignment_public_task_queue_1",
  issuanceId: "issuance_public_task_queue_1",
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

const unpaidPrivateAssignment = {
  ...privateAssignment,
  assignmentId: "hasn_unpaid_private_queue_1",
  paidAssignment: false,
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

test("the assigned inbox renders principal-bound paid work", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor, within } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { AnswerPageClient } = await import("./AnswerPageClient");
  // The one private assignment has been submitted, so only public review work is left in the queue.
  const restoreFetch = installQueueFetch({ assignments: [], tasks: [publicTask] });

  try {
    render(
      <AppRouterContext.Provider value={router as never}>
        <AnswerPageClient />
      </AppRouterContext.Provider>,
    );
    const screen = within(document.body);
    await waitFor(() => assert.ok(screen.getByText(publicTask.question.prompt)));

    assert.equal(screen.queryByRole("group", { name: "Review sources" }), null);
    assert.equal(screen.queryByText(/No review work is assigned to you right now/iu), null);
  } finally {
    cleanup();
    await settle();
    restoreFetch();
    restoreDom();
  }
});

test("public tasks with the same round on different panels keep distinct card and control identities", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor, within } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { AnswerPageClient } = await import("./AnswerPageClient");
  const firstTask: PublicAnswerTask = {
    ...publicTask,
    reviewerSource: "rateloop_network",
    assignmentId: "hasn_same-round-panel-one",
    assignmentStatus: "reserved",
    assignmentExpiresAt: "2099-07-17T09:00:00.000Z",
    confidentialityTermsHash: `sha256:${"4".repeat(64)}`,
    selectionBindingHash: `sha256:${"5".repeat(64)}`,
    question: { ...publicTask.question, prompt: "Panel one review" },
  };
  const secondTask: PublicAnswerTask = {
    ...firstTask,
    operationKey: "public-task-queue-2",
    panelAddress: `0x${"6".repeat(40)}`,
    assignmentId: "hasn_same-round-panel-two",
    question: { ...firstTask.question, prompt: "Panel two review" },
  };
  const restoreFetch = installQueueFetch({ assignments: [], tasks: [firstTask, secondTask] });
  const previousConsoleError = console.error;
  const reactErrors: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    reactErrors.push(args);
  };

  try {
    render(
      <AppRouterContext.Provider value={router as never}>
        <AnswerPageClient />
      </AppRouterContext.Provider>,
    );
    const screen = within(document.body);
    await waitFor(() => assert.equal(screen.getAllByRole("checkbox").length, 2));

    const [firstTerms, secondTerms] = screen.getAllByRole<HTMLInputElement>("checkbox");
    assert.notEqual(firstTerms.id, secondTerms.id);
    assert.equal(document.querySelectorAll(`#${firstTerms.id}`).length, 1);
    assert.equal(document.querySelectorAll(`#${secondTerms.id}`).length, 1);
    assert.equal(
      reactErrors.some(args => args.map(String).join(" ").includes("same key")),
      false,
    );
  } finally {
    console.error = previousConsoleError;
    cleanup();
    await settle();
    restoreFetch();
    restoreDom();
  }
});

test("assigned public work surfaces required-media failures and blocks submission until retry succeeds", async () => {
  const restoreDom = installTestDom();
  const { cleanup, fireEvent, render: baseRender, waitFor, within } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { AnswerPageClient } = await import("./AnswerPageClient");
  const mediaTask: PublicAnswerTask = {
    ...publicTask,
    operationKey: "public-task-required-media",
    panelAddress: `0x${"7".repeat(40)}`,
    question: {
      ...publicTask.question,
      prompt: "Review the attached checkout image",
      media: {
        kind: "images",
        items: [
          {
            alt: "Checkout confirmation",
            assetId: `pqm_${"A".repeat(24)}`,
            digest: `sha256:${"a".repeat(64)}`,
          },
        ],
      },
    },
  };
  const restoreFetch = installQueueFetch({ assignments: [], tasks: [mediaTask] });

  try {
    render(
      <AppRouterContext.Provider value={router as never}>
        <AnswerPageClient />
      </AppRouterContext.Provider>,
    );
    const screen = within(document.body);
    const image = await screen.findByRole<HTMLImageElement>("img", { name: "Checkout confirmation" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Matches" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /what percentage/iu }), { target: { value: "73" } });

    const advance = () => screen.getByRole<HTMLButtonElement>("button", { name: "Create recovery backup" });
    assert.equal(advance().disabled, true);
    fireEvent.error(image);
    assert.match(screen.getByRole("alert").textContent ?? "", /image 1 could not be loaded/iu);
    assert.equal(advance().disabled, true);

    await user.click(screen.getByRole("button", { name: "Retry media" }));
    assert.equal(screen.getByText("Loading required images…").getAttribute("role"), "status");
    fireEvent.load(screen.getByRole("img", { name: "Checkout confirmation" }));
    await waitFor(() => assert.equal(advance().disabled, false));
    assert.equal(screen.queryByRole("alert"), null);
  } finally {
    cleanup();
    await settle();
    restoreFetch();
    restoreDom();
  }
});

test("history renders assigned private work", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor, within } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { AnswerPageClient } = await import("./AnswerPageClient");
  const restoreFetch = installQueueFetch({ assignments: [privateAssignment], tasks: [] });

  try {
    render(
      <AppRouterContext.Provider value={router as never}>
        <AnswerPageClient initialView="history" />
      </AppRouterContext.Provider>,
    );
    const screen = within(document.body);
    await waitFor(() => assert.ok(screen.getByRole("heading", { name: privateAssignment.projectName })));

    assert.ok(screen.getByText("Accepted"));
    assert.ok(screen.getByText(/3 cases/iu));
    assert.equal(screen.queryByText("Private assignment"), null);
    assert.equal(screen.queryByText("Data handling"), null);
    assert.equal(screen.queryByRole("group", { name: "Review sources" }), null);
    assert.equal(screen.queryByText(/No review work is assigned to you right now/iu), null);
  } finally {
    cleanup();
    await settle();
    restoreFetch();
    restoreDom();
  }
});

test("assigned work renders every principal-bound source without browsing controls", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor, within } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { AnswerPageClient } = await import("./AnswerPageClient");
  const restoreFetch = installQueueFetch({ assignments: [unpaidPrivateAssignment], tasks: [publicTask] });

  try {
    render(
      <AppRouterContext.Provider value={router as never}>
        <AnswerPageClient />
      </AppRouterContext.Provider>,
    );
    const screen = within(document.body);
    await waitFor(() => assert.ok(screen.getByText(publicTask.question.prompt)));

    assert.ok(screen.getByText(unpaidPrivateAssignment.projectName));
    assert.equal(screen.queryByRole("group", { name: "Review sources" }), null);
  } finally {
    cleanup();
    await settle();
    restoreFetch();
    restoreDom();
  }
});

test("an active invited paid assignment renders only through the paid task card", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor, within } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { AnswerPageClient } = await import("./AnswerPageClient");
  const duplicatedPaidAssignment = {
    ...privateAssignment,
    assignmentId: publicTask.assignmentId,
  };
  const restoreFetch = installQueueFetch({ assignments: [duplicatedPaidAssignment], tasks: [publicTask] });

  try {
    render(
      <AppRouterContext.Provider value={router as never}>
        <AnswerPageClient />
      </AppRouterContext.Provider>,
    );
    const screen = within(document.body);
    await waitFor(() => assert.ok(screen.getByText(publicTask.question.prompt)));

    assert.equal(screen.getAllByText(publicTask.question.prompt).length, 1);
    assert.equal(screen.queryByRole("heading", { name: duplicatedPaidAssignment.projectName }), null);
  } finally {
    cleanup();
    await settle();
    restoreFetch();
    restoreDom();
  }
});

test("an empty assigned-work inbox offers invitation entry without browsing controls", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor, within } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { AnswerPageClient } = await import("./AnswerPageClient");
  const restoreFetch = installQueueFetch({ assignments: [], tasks: [] });

  try {
    render(
      <AppRouterContext.Provider value={router as never}>
        <AnswerPageClient />
      </AppRouterContext.Provider>,
    );
    const screen = within(document.body);
    await waitFor(() => assert.ok(screen.getByText(/No review work is assigned to you right now/iu)));
    assert.equal(screen.queryByRole("group", { name: "Review sources" }), null);
    assert.ok(screen.getByRole("button", { name: "Use an invitation" }));
    assert.equal(screen.queryByRole("button", { name: "Check again" }), null);
  } finally {
    cleanup();
    await settle();
    restoreFetch();
    restoreDom();
  }
});

test("an empty history uses history-specific copy without an invitation action", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor, within } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { AnswerPageClient } = await import("./AnswerPageClient");
  const restoreFetch = installQueueFetch({ assignments: [], tasks: [] });

  try {
    render(
      <AppRouterContext.Provider value={router as never}>
        <AnswerPageClient initialView="history" />
      </AppRouterContext.Provider>,
    );
    const screen = within(document.body);
    await waitFor(() => assert.ok(screen.getByText("No review history yet.")));
    assert.ok(screen.getByRole("heading", { name: "Review history", level: 1 }));
    assert.equal(screen.queryByRole("button", { name: "Use an invitation" }), null);
  } finally {
    cleanup();
    await settle();
    restoreFetch();
    restoreDom();
  }
});
