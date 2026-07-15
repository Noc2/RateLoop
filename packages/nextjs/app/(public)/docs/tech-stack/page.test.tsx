import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("tech-stack docs explain the tokenless integrity layers and their limits", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: TechStackPage } = await import("./page");
  const html = renderToStaticMarkup(<TechStackPage />).replace(/\s+/g, " ");

  assert.match(html, /no.*LREP/i);
  assert.match(html, /fixed base payment.*Robust Bayesian Truth Serum bonus/i);
  assert.match(html, /World ID 4 Proof of Human/i);
  assert.match(html, /correlation epochs/i);
  assert.match(html, /Surprisingly Popular bounty.*pre-reserved platform-funded maximum/i);
  assert.match(html, /cannot alter the majority verdict, contract settlement, fixed pay, or RBTS pay/i);
  assert.match(html, /dedicated signer nonce allocation/i);
  assert.match(html, /truth oracle/i);
  assert.match(html, /never accepted work payment/i);
  assert.match(html, /TOKENLESS_SANDBOX_MODE=true/i);
  assert.match(html, /Better Auth account-first sign-in.*opaque RateLoop principal/i);
  assert.match(html, /EU-first classification.*subject-request controls/i);
  assert.match(html, /not represented as an immutable or WORM external audit log/i);
  assert.doesNotMatch(html, /future incentive use|diagnostic/i);
  assert.doesNotMatch(html, /token reward|stake-weighted|guarantees honest/i);
});
