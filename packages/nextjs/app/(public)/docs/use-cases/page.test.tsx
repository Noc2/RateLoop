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

test("use cases show three worked examples with bounded human-assurance decisions", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: UseCasesPage } = await import("./page");
  const html = renderToStaticMarkup(<UseCasesPage />).replace(/\s+/g, " ");

  assert.match(html, /Use.*rateloop-text-gradient.*Cases/i);
  assert.equal(html.match(/data-use-case=/g)?.length, 3);
  assert.equal(html.match(/Illustrative example/g)?.length, 3);

  for (const [id, title, criterion] of [
    ["customer-replies", "Customer replies", "Would you send this response to the customer as written?"],
    ["research-deliverables", "Research and client work", "Is this conclusion supported by the supplied sources?"],
    [
      "hiring-decisions",
      "AI-assisted hiring",
      "Does the supplied application evidence support this recommendation under the approved job criteria?",
    ],
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(html, new RegExp(title, "i"));
    assert.match(html, new RegExp(criterion.replace(/[?]/g, "\\?"), "i"));
  }

  // Removed use cases stay removed; their concerns are covered elsewhere.
  assert.doesNotMatch(html, /version-calibration|extraction-triage|product-experiences|Product experiences/);
  assert.match(html, /review starts again at full coverage/i);
  assert.match(html, /classification and extraction exceptions/i);

  // Each worked example pairs an artifact with a panel result and an owner outcome.
  assert.match(html, /When to check.*Who reviews.*What you get back/i);
  assert.match(html, /There is nothing further we can do/i);
  assert.match(html, /No — 4 of 5 reviewers/i);
  assert.match(html, /Churn fell 18%/i);
  assert.match(html, /Not supported — 3 of 5 reviewers/i);
  assert.match(html, /Do not advance — no team-lead experience/i);
  assert.match(html, /Override — 4 of 5 authorized reviewers/i);
  assert.match(html, /CV shows two years leading six engineers/i);

  assert.match(html, /EU AI Act · high-risk context/i);
  assert.match(html, /For systems that qualify as high-risk under Article 6/i);
  assert.match(html, /requires effective human oversight/i);
  assert.match(html, /necessary competence, training, and authority/i);
  assert.match(html, /employment rules apply from 2 December 2027/i);
  assert.match(
    html,
    /does not determine legal classification, perform the provider&#x27;s conformity assessment, or make a system compliant/i,
  );
  for (const href of [
    "https://ai-act-service-desk.ec.europa.eu/en/ai-act/annex-3",
    "https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-6",
    "https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-14",
    "https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-26",
    "https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-43",
    "https://digital-strategy.ec.europa.eu/en/policies/guidelines-ai-high-risk-systems",
  ]) {
    assert.match(html, new RegExp(`href="${href.replace(/[./-]/g, "\\$&")}"`));
  }

  assert.match(html, /Proof of Human.*uniqueness signal.*does not prove professional expertise/i);
  assert.match(html, /unit tests, schema validation, deterministic policy checks, tracing, and automated evaluators/i);
  assert.match(html, /sole medical, legal, financial, security, or safety approval/i);
  assert.match(html, /href="\/docs\/how-it-works"/);
  assert.match(html, /href="\/docs\/ai"/);
  assert.doesNotMatch(html, /network_panels_disabled|private_assignment_lane_unavailable|test deployment/i);
  assert.doesNotMatch(html, /\d+x improvement|millions saved|trusted by|customer logo/i);

  const machineDocs = readFileSync(
    fileURLToPath(new URL("../../../../public/docs/use-cases.md", import.meta.url)),
    "utf8",
  );
  assert.match(machineDocs, /## AI-assisted hiring/i);
  assert.match(machineDocs, /Does the supplied application evidence support this recommendation/i);
  assert.match(machineDocs, /For systems that qualify as high-risk under/i);
  assert.match(machineDocs, /2 December 2027/i);
  assert.match(machineDocs, /does not determine legal classification/i);
  assert.match(machineDocs, /private invited-review lane/i);
  assert.doesNotMatch(machineDocs, /Product experiences|product-experiences|checkout screens/i);
});
