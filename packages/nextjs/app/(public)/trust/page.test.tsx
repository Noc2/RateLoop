import React from "react";
import { TRUST_CLAIM_REGISTRY } from "../../../content/trustClaims";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("trust page renders every current public claim with evidence and review dates", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: TrustPage } = await import("./page");
  const html = renderToStaticMarkup(<TrustPage />).replace(/\s+/g, " ");

  assert.match(html, /Trust, with/);
  assert.match(html, /Implemented/);
  assert.match(html, /Hard/);
  assert.match(html, /Not/);
  assert.match(html, new RegExp(`Trust registry ${TRUST_CLAIM_REGISTRY.version.replaceAll(".", "\\.")}`));

  for (const claim of TRUST_CLAIM_REGISTRY.claims) {
    assert.match(html, new RegExp(claim.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, new RegExp(claim.statement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, new RegExp(`Review ${claim.reviewDate}`));
    for (const evidence of claim.evidence) {
      assert.match(html, new RegExp(`href="${evidence.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    }
  }
});

test("trust page does not imply unavailable certifications or external assurances", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: TrustPage } = await import("./page");
  const html = renderToStaticMarkup(<TrustPage />).replace(/\s+/g, " ");

  assert.doesNotMatch(
    html,
    /SOC 2 certified|SOC-2 certified|GDPR compliant|HIPAA compliant|EU hosted|VPC deployment available/i,
  );
  assert.match(html, /not currently SOC 2 Type II attested/i);
  assert.match(html, /does not make a blanket GDPR compliance claim/i);
  assert.match(html, /does not currently offer HIPAA compliance through a BAA/i);
  assert.match(html, /does not currently claim an EU-hosted data plane/i);
});
