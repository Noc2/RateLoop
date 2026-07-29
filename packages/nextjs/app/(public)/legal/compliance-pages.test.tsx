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
  assert.match(html, /Technical and organizational measures/i);
  assert.match(html, /authenticated envelope encryption at rest/i);
  assert.match(html, /funds are not silently forfeited/i);
});

test("subprocessor notice distinguishes core, conditional, and independent services", async () => {
  const html = await render("./subprocessors/page");
  assert.match(html, /Vercel, Inc/i);
  assert.match(html, /Railway Corp/i);
  assert.match(html, /Resend, Inc/i);
  assert.match(html, /Stripe Payments Europe/i);
  assert.doesNotMatch(html, /Amazon Web Services EMEA/i);
  assert.match(html, /Services that may be independent recipients/i);
  assert.match(html, /object within 14 days/i);
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
