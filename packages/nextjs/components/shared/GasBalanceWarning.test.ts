import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { GasBalanceWarning, shouldShowGasWarningTransactionCostsLink } from "~~/components/shared/GasBalanceWarning";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("shows transaction cost link after verified free transactions are exhausted", () => {
  assert.equal(
    shouldShowGasWarningTransactionCostsLink({
      freeTransactionRemaining: 0,
      freeTransactionVerified: true,
    }),
    true,
  );
});

test("hides transaction cost link while verified free transactions remain", () => {
  assert.equal(
    shouldShowGasWarningTransactionCostsLink({
      freeTransactionRemaining: 1,
      freeTransactionVerified: true,
    }),
    false,
  );
});

test("hides transaction cost link for wallets without verified free transaction allowance", () => {
  assert.equal(
    shouldShowGasWarningTransactionCostsLink({
      freeTransactionRemaining: 0,
      freeTransactionVerified: false,
    }),
    false,
  );
});

test("gas warning renders optional funding action", () => {
  const html = renderToStaticMarkup(
    React.createElement(GasBalanceWarning, {
      actionLabel: "Add ETH",
      nativeTokenSymbol: "ETH",
      onAction: () => undefined,
    }),
  ).replace(/\s+/g, " ");

  assert.match(html, />Need ETH for gas</);
  assert.match(html, />Add ETH</);
});
