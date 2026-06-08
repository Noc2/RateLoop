import React from "react";
import { FreeTransactionAllowanceDisplay } from "./AddressInfoDropdown";
import { getFreeTransactionAllowanceDisplayState } from "./freeTransactionAllowanceDisplay";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("free transaction display shows verification prompt for unverified eligible wallets", () => {
  assert.deepEqual(
    getFreeTransactionAllowanceDisplayState({
      canShowFreeTransactionAllowance: true,
      isResolved: true,
      limit: 25,
      remaining: 0,
      verified: false,
    }),
    {
      kind: "verify",
      limit: 25,
    },
  );
});

test("free transaction verification prompt omits the free tx suffix", () => {
  const html = renderToStaticMarkup(
    React.createElement(FreeTransactionAllowanceDisplay, { displayState: { kind: "verify", limit: 25 } }),
  ).replace(/\s+/g, " ");

  assert.match(html, />Verify for 25</);
  assert.match(html, /whitespace-nowrap/);
  assert.doesNotMatch(html, /free tx/);
});

test("free transaction quota keeps the free tx suffix", () => {
  const html = renderToStaticMarkup(
    React.createElement(FreeTransactionAllowanceDisplay, {
      displayState: { kind: "quota", limit: 25, remaining: 12 },
    }),
  ).replace(/\s+/g, " ");

  assert.match(html, />12\/25</);
  assert.match(html, />free tx</);
});

test("free transaction display shows quota for verified eligible wallets", () => {
  assert.deepEqual(
    getFreeTransactionAllowanceDisplayState({
      canShowFreeTransactionAllowance: true,
      isResolved: true,
      limit: 25,
      remaining: 12,
      verified: true,
    }),
    {
      kind: "quota",
      limit: 25,
      remaining: 12,
    },
  );
});

test("free transaction display hides unavailable allowance states", () => {
  assert.deepEqual(
    getFreeTransactionAllowanceDisplayState({
      canShowFreeTransactionAllowance: false,
      isResolved: true,
      limit: 25,
      remaining: 0,
      verified: false,
    }),
    { kind: "hidden" },
  );
  assert.deepEqual(
    getFreeTransactionAllowanceDisplayState({
      canShowFreeTransactionAllowance: true,
      isResolved: false,
      limit: 25,
      remaining: 0,
      verified: false,
    }),
    { kind: "hidden" },
  );
});
