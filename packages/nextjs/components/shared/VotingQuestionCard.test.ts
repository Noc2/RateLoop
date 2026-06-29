import React from "react";
import {
  FeedbackBonusAmountDisplay,
  RewardPoolAmountDisplay,
  getFeedbackBonusDisplay,
  getRewardPoolDisplay,
} from "./VotingQuestionCard";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("reward pool tooltip copy is network-neutral across bounty currencies", () => {
  for (const currency of [undefined, "USDC", "LREP", "MIXED"] as const) {
    const display = getRewardPoolDisplay(1_000_000n, currency);
    assert.doesNotMatch(display.tooltip, /World Chain/i);
    assert.match(display.tooltip, /active network/i);
  }
});

test("reward chip amount labels are consistent across bounty and feedback bonus currencies", () => {
  assert.equal(getRewardPoolDisplay(1_000_000n, "USDC").amountLabel, "$1");
  assert.equal(getFeedbackBonusDisplay(1_000_000n, "USDC").amountLabel, "$1");
  assert.equal(getFeedbackBonusDisplay(1_000_000n, undefined).amountLabel, "$1");

  assert.equal(getRewardPoolDisplay(1_000_000n, "LREP").amountLabel, "1 LREP");
  assert.equal(getFeedbackBonusDisplay(1_000_000n, "LREP").amountLabel, "1 LREP");
});

test("reward chips render title-cased bounty and feedback bonus labels", () => {
  const bountyHtml = renderToStaticMarkup(
    React.createElement(RewardPoolAmountDisplay, { amount: 1_000_000n, currency: "USDC" }),
  );
  const feedbackBonusHtml = renderToStaticMarkup(
    React.createElement(FeedbackBonusAmountDisplay, { amount: 1_000_000n, currency: "USDC" }),
  );

  assert.match(bountyHtml, /aria-label="\$1 Bounty"/);
  assert.match(feedbackBonusHtml, /aria-label="\$1 Feedback Bonus"/);
});
