import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

async function render(page: string) {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: Page } = (await import(page)) as { default: React.ComponentType };
  return renderToStaticMarkup(<Page />).replace(/\s+/g, " ");
}

async function renderGermanSubprocessors() {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { SubprocessorsContent } = await import("./subprocessors/page");
  return renderToStaticMarkup(<SubprocessorsContent locale="de" />).replace(/\s+/g, " ");
}

test("legal index cards explain their destinations without repeated navigation copy", async () => {
  const html = await render("./page");
  assert.match(html, /Rules, responsibilities, payment terms, and service limitations\./i);
  assert.match(html, /What RateLoop stores, why it is processed/i);
  assert.doesNotMatch(html, /These documents explain|Read document/i);
});

test("DPA includes the Article 28 processing contract essentials", async () => {
  const html = await render("./dpa/page");
  assert.match(html, /intended to satisfy Article 28 GDPR/i);
  assert.match(html, /only on Customer.*documented instructions/i);
  assert.match(html, /bound by confidentiality/i);
  assert.match(html, /at least 30 days.*advance notice/i);
  assert.match(html, /assist.*access, correction, deletion, restriction, portability, and objection/i);
  assert.match(html, /notify Customer without undue delay and no later than 48 hours/i);
  assert.match(html, /does not use Customer Personal Data or customer output text to train or improve/i);
  assert.match(html, /marketing tool may generate voiceover from RateLoop-authored promotional copy/i);
  assert.match(html, /return an available export and delete or anonymize/i);
  assert.match(html, /allow an audit by Customer or an independent auditor/i);
  assert.match(html, /does not currently hold a SOC 2 or ISO certification report/i);
  assert.match(html, /standard security-questionnaire response, last reviewed in July 2026/i);
  assert.match(html, /reproducible evidence-verification instructions/i);
  assert.match(html, /against the deployed configuration rather than substituting a broad trust claim/i);
  assert.match(html, /Technical and organizational measures/i);
  assert.match(html, /authenticated envelope encryption at rest/i);
  assert.match(html, /funds are not silently forfeited/i);
});

test("subprocessor notice distinguishes core, conditional, and independent services", async () => {
  const html = await render("./subprocessors/page");
  assert.match(html, /Vercel, Inc/i);
  assert.match(html, /Vercel, Inc.*Core hosted application\./i);
  assert.match(html, /Railway Corp/i);
  assert.match(html, /Resend, Inc/i);
  assert.match(html, /Stripe Payments Europe/i);
  assert.match(html, /Sigstore public Rekor service/i);
  assert.match(html, /Sigstore public Rekor service.*Every completed decision-packet attestation\./i);
  assert.doesNotMatch(html, /Only when Rekor witnessing is configured|Optional public transparency-log receipt/i);
  assert.match(html, /Customer-approved RFC 3161 timestamp authority/i);
  assert.match(html, /Drata, Inc\. or Vanta Inc\./i);
  assert.match(html, /Customer-designated S3-compatible storage provider/i);
  assert.match(html, /customer record contents are not submitted/i);
  assert.doesNotMatch(html, /Amazon Web Services EMEA/i);
  assert.match(html, /Services that may be independent recipients/i);
  assert.match(html, /object within 14 days/i);
});

test("subprocessor conditions render in German without leaking English fallback copy", async () => {
  const html = await renderGermanSubprocessors();
  assert.match(html, /Vercel, Inc.*Zentrale gehostete Anwendung\./i);
  assert.match(html, /Öffentlicher Sigstore-Rekor-Dienst/i);
  assert.match(html, /Bei jeder abgeschlossenen Bestätigung eines Entscheidungspakets\./i);
  assert.doesNotMatch(html, /Core hosted application\.|Every completed decision-packet attestation\./i);
});

test("cookie policy discloses every first-party storage category and no analytics", async () => {
  const html = await render("./cookies/page");
  assert.match(html, /does not use advertising cookies.*audience analytics/i);
  assert.match(html, /__Host-rateloop-session/i);
  assert.match(html, /Review drafts/i);
  assert.match(html, /Paid-eligibility handoff state/i);
  assert.match(html, /Optional device recovery/i);
  assert.match(html, /Integration choice/i);
  assert.match(html, /youtube-nocookie.com/i);
  assert.match(html, /does not show a consent banner/i);
});

test("terms restrict paid services and require commissioned-panel disclosure", async () => {
  const html = await render("./terms/page");
  assert.match(
    html,
    /available only to approved business customers whose legal identity RateLoop has independently verified/i,
  );
  assert.match(html, /funded panel result is commissioned business-to-business research/i);
  assert.match(html, /not an organic consumer review, testimonial, endorsement, or measure of general public opinion/i);
  assert.match(html, /must not present paid reviewer feedback as unsolicited customer or consumer feedback/i);
  assert.match(html, /href="\/docs\/evidence#commissioned-paid-panels"/i);
});
