import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { BountyFundingWarning } from "~~/components/shared/BountyFundingWarning";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("bounty warning renders optional funding action", () => {
  const html = renderToStaticMarkup(
    React.createElement(BountyFundingWarning, {
      actionLabel: "Add USDC",
      message: "Add USDC to this wallet, then continue.",
      onAction: () => undefined,
    }),
  ).replace(/\s+/g, " ");

  assert.match(html, />Need bounty funds</);
  assert.match(html, />Add USDC</);
});
