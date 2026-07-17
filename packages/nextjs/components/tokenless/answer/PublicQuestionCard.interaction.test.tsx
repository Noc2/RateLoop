import React from "react";
import type { PublicAnswerTask } from "./PublicQuestionCard";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

const task: PublicAnswerTask = {
  operationKey: "public-task-1",
  chainId: 84532,
  panelAddress: `0x${"1".repeat(40)}`,
  roundId: "17",
  contentId: `0x${"2".repeat(64)}`,
  reviewerSource: "rateloop_network",
  question: {
    kind: "binary",
    prompt: "Is the response supported by the evidence?",
    positiveLabel: "Supported",
    negativeLabel: "Not supported",
    rationale: { mode: "optional", maxLength: 500 },
  },
  voucherDeadline: "2026-07-17T09:00:00.000Z",
  alreadyVouchered: false,
  earnings: {
    guaranteedBaseAtomic: "1000000",
    possibleBonusAtomic: "500000",
    possibleSurpriseBonusAtomic: "250000",
    attemptCompensationAtomic: "100000",
  },
  beacon: { network: "quicknet-t", round: 1 },
};

test("a public reviewer can choose a rating, prediction, and optional feedback", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, screen } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { PublicQuestionCard } = await import("./PublicQuestionCard");

  try {
    render(<PublicQuestionCard task={task} paidAccess={{ state: "ready" }} onSubmitted={() => undefined} />);
    const submit = screen.getByRole("button", { name: "Submit rating" }) as HTMLButtonElement;
    assert.equal(submit.disabled, true);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Supported" }));
    await user.click(screen.getByRole("button", { name: "70%" }));
    assert.equal(submit.disabled, false);
    await user.click(screen.getByRole("button", { name: "Add feedback" }));
    await user.type(screen.getByRole("textbox", { name: "Feedback" }), "The cited source supports the answer.");
    assert.equal((screen.getByRole("textbox", { name: "Feedback" }) as HTMLInputElement).value.length, 37);
  } finally {
    cleanup();
    restoreDom();
  }
});
