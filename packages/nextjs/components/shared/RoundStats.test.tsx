import React from "react";
import { RoundRevealedBreakdown, formatRaterProgress, shouldHidePendingRoundStats } from "./RoundStats";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("RoundRevealedBreakdown renders Up before Down to match the rating button order", () => {
  const html = renderToStaticMarkup(
    <RoundRevealedBreakdown
      snapshot={
        {
          isLoading: false,
          round: {
            revealedCount: 1,
            upPool: 0n,
            downPool: 5_000_000n,
            upCount: 0n,
            downCount: 1n,
          },
        } as any
      }
    />,
  ).replace(/\s+/g, " ");

  assert.match(html, /Up<\/span>\s*<span[^>]*>0 LREP<\/span>\s*<span[^>]*>0 signals<\/span>/);
  assert.match(html, /Down<\/span>\s*<span[^>]*>5 LREP<\/span>\s*<span[^>]*>1 signal<\/span>/);
  assert.ok(html.indexOf(">Up<") < html.indexOf(">Down<"));
});

test("RoundRevealedBreakdown renders A/B labels for head-to-head content", () => {
  const html = renderToStaticMarkup(
    <RoundRevealedBreakdown
      voteUiConfig={{
        mode: "head_to_head",
        optionAKey: "A",
        optionALabel: "Awesome",
        optionBKey: "B",
        optionBLabel: "Bad",
      }}
      snapshot={
        {
          isLoading: false,
          round: {
            revealedCount: 2,
            upPool: 2_000_000n,
            downPool: 1_000_000n,
            upCount: 1n,
            downCount: 1n,
          },
        } as any
      }
    />,
  ).replace(/\s+/g, " ");

  assert.match(html, />A</);
  assert.match(html, />B</);
  assert.ok(html.indexOf(">A<") < html.indexOf(">B<"));
});

test("formatRaterProgress shows committed raters against the settlement minimum", () => {
  assert.equal(formatRaterProgress(1, 3), "1/3");
});

test("shouldHidePendingRoundStats covers empty and rollover rounds", () => {
  assert.equal(
    shouldHidePendingRoundStats({
      hasRound: false,
      phase: "none",
      voteCount: 0,
      willStartNewRound: true,
    }),
    true,
  );
  assert.equal(
    shouldHidePendingRoundStats({
      hasRound: true,
      phase: "voting",
      voteCount: 0,
      willStartNewRound: false,
    }),
    true,
  );
  assert.equal(
    shouldHidePendingRoundStats({
      hasRound: true,
      phase: "voting",
      voteCount: 1,
      willStartNewRound: false,
    }),
    false,
  );
});
