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

test("evidence docs explain exact artifacts, checks, mappings, and boundaries", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: EvidencePage } = await import("./page");
  const html = renderToStaticMarkup(<EvidencePage />).replace(/\s+/g, " ");

  assert.match(html, /Evidence &amp; Compliance.*rateloop-text-gradient.*Mapping/i);
  assert.doesNotMatch(html, /What this is not|RateLoop never claims/i);
  assert.match(html, /Shared responsibility/i);
  assert.match(html, /Your people provide the oversight\. RateLoop provides the instrument — and the proof\./);
  assert.match(
    html,
    /Whether a specific deployment meets a legal requirement depends on your system, context, and organization — you configure and operate RateLoop for your purpose; RateLoop provides the capabilities and the evidence\./,
  );
  assert.match(html, /Requirement.*RateLoop provides.*You remain responsible for/i);
  for (const requirement of [
    "Art 14(4)(a) · Monitor",
    "Art 14(4)(b) · Automation bias",
    "Art 14(4)(c) · Interpret",
    "Art 14(4)(d) · Override",
    "Art 14(4)(e) · Stop",
    "Art 26(2) · Assignment",
    "Art 26(5) · Monitoring",
    "Art 26(6) · Log retention",
    "Art 4 · AI literacy",
  ]) {
    assert.match(html, new RegExp(requirement.replace(/[()·]/g, "\\$&")));
  }
  assert.match(html, /on host-enforced integrations output is held undelivered until a person decides/i);
  assert.match(html, /workspace stop control/i);
  assert.match(html, /per-output override records with required reasons/i);
  assert.match(html, /Independent blinded review panels/i);
  assert.match(html, /surfaced disagreement before the decision/i);
  assert.match(html, /attestation records — competence basis, training completed, authority granted/i);
  assert.match(html, /six-month retention floor/i);
  assert.match(html, /Exportable training and calibration records/i);
  assert.match(html, /Choosing those natural persons and ensuring they are competent, trained, and authorized/i);
  assert.match(
    html,
    /RateLoop operates around your AI system, gating its outputs; it does not modify the system itself\./,
  );
  assert.match(html, /execution provenance is host-reported and labelled so/i);
  assert.match(html, /SOC 2 \/ ISO \/ HIPAA \/ residency attestations it does not hold/i);
  assert.match(html, /no evidence export by itself makes anyone compliant/i);
  assert.match(html, /rateloop\.human-assurance\.evidence\.v3/i);
  assert.match(html, /Frozen scope.*Review context.*Judgment evidence.*Settlement and limits/i);
  assert.match(html, /reviewer identities and raw or decryptable rationales are excluded/i);
  assert.match(html, /evidence:verify.*--public-key.*--key-id/i);
  assert.match(html, /audit:verify.*--expected-head/i);
  assert.match(html, /attestation:verify.*--signer-public-key.*--signer-key-id.*--rekor-public-key.*--tsa-ca/is);
  assert.match(html, /independently selected Base RPC or indexer/i);
  assert.match(html, /does not embed a complete transaction receipt/i);
  assert.match(html, /absent bundle means there is no Rekor receipt/i);
  assert.match(html, /absent token means there is no TSA receipt/i);
  assert.match(html, /assurance\/coverage\/export/i);
  assert.match(html, /assurance\/trusted-keys/i);
  assert.match(
    html,
    /Scheduled enforcement removes due private artifact content and access logs unless a legal hold applies/i,
  );
  assert.match(html, /canonical audit chain remain as integrity records/i);
  assert.match(html, /ISO\/IEC 42001:2023.*A\.6, including A\.6\.2\.8, and A\.9\.2/i);
  assert.match(html, /Articles 12, 14\(3\)\(b\), 14\(4\), 26\(2\), 26\(5\)-\(6\), 72, and 73/i);
  assert.match(html, /supports your implementation and evidence of these duties; the duties remain yours/i);
  assert.doesNotMatch(html, /26\(1\)/);
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
  assert.match(evidence, /attestation:verify.*--signer-public-key.*--rekor-public-key.*--tsa-ca/is);
  assert.match(evidence, /ISO\/IEC 42001:2023.*A\.6 including A\.6\.2\.8, and A\.9\.2/is);
  assert.match(evidence, /Articles 12, 14\(3\)\(b\), 14\(4\), 26\(2\), 26\(5\)-\(6\), 72, and 73/);
  assert.match(evidence, /Your people provide the oversight\. RateLoop provides the instrument — and the proof\./);
  assert.match(evidence, /You remain responsible for/);
  assert.match(
    evidence,
    /RateLoop operates around your AI system, gating its outputs; it does not modify the system itself\./,
  );
  assert.doesNotMatch(evidence, /What this is not|RateLoop never claims|26\(1\)/);
  assert.match(
    evidence,
    /Scheduled enforcement removes due private artifact[\s\S]*content and access logs unless a legal hold applies/i,
  );
  assert.match(evidence, /canonical audit chain remain as integrity records/i);
  assert.match(evidence, /rateloop-human-assurance-component-definition\.oscal\.json/);
  assert.match(connection, /\[`evidence\.md`\]\(\.\/evidence\.md\)/);
  assert.match(connection, /\[`\/docs\/evidence`\]\(\/docs\/evidence\)/);
});
