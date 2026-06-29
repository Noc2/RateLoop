import React from "react";
import {
  FeedbackBonusAmountDisplay,
  RewardPoolAmountDisplay,
  formatCompactRewardTimeLeft,
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

test("formatCompactRewardTimeLeft keeps countdown labels short", () => {
  assert.equal(formatCompactRewardTimeLeft(null, 10_000), null);
  assert.equal(formatCompactRewardTimeLeft(9_999n, 10_000), null);
  assert.equal(formatCompactRewardTimeLeft(10_000n, 10_000), "<1m");
  assert.equal(formatCompactRewardTimeLeft(10_059n, 10_000), "<1m");
  assert.equal(formatCompactRewardTimeLeft(10_060n, 10_000), "1m");
  assert.equal(formatCompactRewardTimeLeft(12_700n, 10_000), "45m");
  assert.equal(formatCompactRewardTimeLeft(37_000n, 10_000), "7h");
  assert.equal(formatCompactRewardTimeLeft(182_800n, 10_000), "2d");
  assert.equal(formatCompactRewardTimeLeft(3_898_000n, 10_000), "30d+");
});

test("reward chips render title-cased bounty and feedback bonus labels", () => {
  const bountyHtml = renderToStaticMarkup(
    React.createElement(RewardPoolAmountDisplay, {
      amount: 1_000_000n,
      currency: "USDC",
      deadlineSeconds: 37_000n,
      nowSeconds: 10_000,
    }),
  );
  const feedbackBonusHtml = renderToStaticMarkup(
    React.createElement(FeedbackBonusAmountDisplay, {
      amount: 1_000_000n,
      currency: "USDC",
      deadlineSeconds: 182_800n,
      nowSeconds: 10_000,
    }),
  );
  const lrepBountyHtml = renderToStaticMarkup(
    React.createElement(RewardPoolAmountDisplay, {
      amount: 1_000_000n,
      currency: "LREP",
      deadlineSeconds: 12_700n,
      nowSeconds: 10_000,
    }),
  );
  const lrepFeedbackBonusHtml = renderToStaticMarkup(
    React.createElement(FeedbackBonusAmountDisplay, {
      amount: 1_000_000n,
      currency: "LREP",
      deadlineSeconds: 10_059n,
      nowSeconds: 10_000,
    }),
  );

  assert.match(bountyHtml, /aria-label="\$1 Bounty, closes in 7h"/);
  assert.match(bountyHtml, /\$1<\/span> Bounty<span[^>]*> · 7h<\/span>/);
  assert.match(feedbackBonusHtml, /aria-label="\$1 Feedback Bonus, closes in 2d"/);
  assert.match(feedbackBonusHtml, /\$1<\/span> Feedback Bonus<span[^>]*> · 2d<\/span>/);
  assert.match(lrepBountyHtml, /aria-label="1 LREP Bounty, closes in 45m"/);
  assert.match(lrepBountyHtml, /1 LREP<\/span> Bounty<span[^>]*> · 45m<\/span>/);
  assert.match(lrepFeedbackBonusHtml, /aria-label="1 LREP Feedback Bonus, closes in &lt;1m"/);
  assert.match(lrepFeedbackBonusHtml, /1 LREP<\/span> Feedback Bonus<span[^>]*> · &lt;1m<\/span>/);
});
