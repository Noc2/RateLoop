import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("SDK docs separate the settlement reference from the hosted review path", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: SdkPage } = await import("./page");
  const html = renderToStaticMarkup(<SdkPage />).replace(/\s+/g, " ");

  assert.match(html, /separately gated fund-backed settlement API/i);
  assert.match(html, /current hosted review path uses invited, unpaid reviewers/i);
  assert.match(html, /does not activate this flow/i);
  assert.match(html, /Settlement API sequence/i);
  assert.match(html, /rateloop\.tokenless\.v2/i);
  assert.match(html, /EIP-3009 authorization/i);
  assert.match(html, /scoped, revocable workspace API keys/i);
  assert.match(html, /authorized client\/project assignment/i);
  assert.match(html, /wallets remain optional/i);
  assert.match(html, /id="evidence-exports"/i);
  assert.match(html, /assurance\/runs\/\{runId\}\/evidence/i);
  assert.match(html, /assurance\/coverage\/export/i);
  assert.match(html, /evidence:verify.*audit:verify/i);
  assert.match(html, /attestation:verify.*--signer-public-key.*--rekor-public-key.*--tsa-ca/i);
  assert.match(html, /href="\/docs\/evidence"/i);
  assert.match(html, /href="\/docs\/ai"/i);
  assert.doesNotMatch(html, /LREP|stake|governance|frontend reward/i);
});
