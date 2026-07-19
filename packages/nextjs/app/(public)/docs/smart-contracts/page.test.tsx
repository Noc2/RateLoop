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
  assert.match(
    html,
    /compromised signer.*fill remaining seats in open rounds.*influence their verdicts.*direct the bounties/i,
  );
  assert.match(html, /id="usdc-token-authority".*USDC token authority/i);
  assert.match(html, /Circle retains token-layer authority over USDC.*pause or blacklist transfers.*escrow contract/i);
  assert.match(html, /one complete key/i);
  assert.match(html, /id="settlement-evidence"/i);
  assert.match(html, /It proves only those recorded chain facts/i);
  assert.match(html, /href="\/docs\/evidence"/i);
  assert.doesNotMatch(html, /LREP|governance|oracle/i);
});
