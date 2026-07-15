import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("smart-contract docs name the complete production contract set", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: SmartContractsPage } = await import("./page");
  const html = renderToStaticMarkup(<SmartContractsPage />).replace(/\s+/g, " ");

  assert.match(html, /Smart.*rateloop-text-gradient.*Contracts/i);
  assert.match(html, /id="tokenless-panel".*TokenlessPanel/i);
  assert.match(html, /id="credential-issuer".*CredentialIssuer/i);
  assert.match(html, /id="x402-panel-submitter".*X402PanelSubmitter/i);
  assert.match(html, /no operator or administrator path to customer funds/i);
  assert.match(html, /one complete key/i);
  assert.doesNotMatch(html, /sandbox|simulation|\/trust|LREP|governance|oracle/i);
});
