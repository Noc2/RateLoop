import React from "react";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("evidence docs explain exact artifacts, checks, mappings, and non-claims", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: EvidencePage } = await import("./page");
  const html = renderToStaticMarkup(<EvidencePage />).replace(/\s+/g, " ");

  assert.match(html, /Evidence &amp; Compliance.*rateloop-text-gradient.*Mapping/i);
  assert.match(html, /What this is not/i);
  assert.match(html, /EU AI Act Article 14\/26 human oversight/i);
  assert.match(html, /competence, training and authority/i);
  assert.match(html, /execution provenance is host-reported and labelled so/i);
  assert.match(html, /to make anyone &quot;compliant&quot; by itself/i);
  assert.match(html, /SOC 2 \/ ISO \/ HIPAA \/ residency attestations RateLoop does not hold/i);
  assert.match(html, /rateloop\.human-assurance\.evidence\.v3/i);
  assert.match(html, /Frozen scope.*Review context.*Judgment evidence.*Settlement and limits/i);
  assert.match(html, /reviewer identities and raw or decryptable rationales are excluded/i);
  assert.match(html, /evidence:verify.*--public-key.*--key-id/i);
  assert.match(html, /audit:verify.*--expected-head/i);
  assert.match(html, /independently selected Base RPC or indexer/i);
  assert.match(html, /absent bundle means there is no Rekor receipt/i);
  assert.match(html, /absent token means there is no TSA receipt/i);
  assert.match(html, /assurance\/coverage\/export/i);
  assert.match(html, /assurance\/trusted-keys/i);
  assert.match(html, /ISO\/IEC 42001:2023.*A\.6, including A\.6\.2\.8, and A\.9\.2/i);
  assert.match(html, /Articles 12, 26\(5\)-\(6\), 72, and 73/i);
  assert.match(html, /NIST AI RMF.*MEASURE and MANAGE/i);
  assert.match(html, /Regulatory Notice 24-09 and Rule 3110/i);
  assert.match(html, /href="https:\/\/www\.finra\.org\/rules-guidance\/rulebooks\/finra-rules\/3110"/i);
  assert.match(html, /17 CFR 240\.17a-4\(f\)/i);
  assert.match(html, /supports evidence for/i);
  assert.match(html, /rateloop-human-assurance-component-definition\.oscal\.json/i);
  assert.doesNotMatch(html, /trust status|compliance-ready|certified RateLoop/i);
});

test("machine docs mirror evidence boundaries and are linked from agent setup", () => {
  const evidence = readFileSync(fileURLToPath(new URL("../../../../public/docs/evidence.md", import.meta.url)), "utf8");
  const connection = readFileSync(
    fileURLToPath(new URL("../../../../public/docs/agent-connection.md", import.meta.url)),
    "utf8",
  );

  assert.match(evidence, /rateloop\.human-assurance\.evidence\.v3/);
  assert.match(evidence, /execution provenance is host-reported and labelled so/i);
  assert.match(evidence, /evidence:verify.*--public-key.*--key-id/is);
  assert.match(evidence, /audit:verify.*--expected-head/is);
  assert.match(evidence, /ISO\/IEC 42001:2023.*A\.6 including A\.6\.2\.8, and A\.9\.2/is);
  assert.match(evidence, /Articles 12, 26\(5\)-\(6\), 72, and 73/);
  assert.match(evidence, /rateloop-human-assurance-component-definition\.oscal\.json/);
  assert.match(connection, /\[`evidence\.md`\]\(\.\/evidence\.md\)/);
  assert.match(connection, /\[`\/docs\/evidence`\]\(\/docs\/evidence\)/);
});
