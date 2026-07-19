import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

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
    ["product-experiences", "Product experiences", "Is the intended next action clear from this screen?"],
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(html, new RegExp(title, "i"));
    assert.match(html, new RegExp(criterion.replace(/[?]/g, "\\?"), "i"));
  }

  // Removed use cases stay removed; their concerns are covered elsewhere.
  assert.doesNotMatch(html, /version-calibration|extraction-triage/);
  assert.match(html, /review starts again at full coverage/i);
  assert.match(html, /classification and extraction exceptions/i);

  // Each worked example pairs an artifact with a panel result and an owner outcome.
  assert.match(html, /When to check.*Who reviews.*What you get back/i);
  assert.match(html, /There is nothing further we can do/i);
  assert.match(html, /No — 4 of 5 reviewers/i);
  assert.match(html, /Churn fell 18%/i);
  assert.match(html, /Not supported — 3 of 5 reviewers/i);
  assert.match(html, /Version B — 4 of 5 reviewers/i);

  assert.match(html, /Proof of Human.*uniqueness signal.*does not prove professional expertise/i);
  assert.match(html, /unit tests, schema validation, deterministic policy checks, tracing, and automated evaluators/i);
  assert.match(html, /sole medical, legal, financial, security, or safety approval/i);
  assert.match(html, /href="\/docs\/how-it-works"/);
  assert.match(html, /href="\/docs\/ai"/);
  assert.doesNotMatch(html, /network_panels_disabled|private_assignment_lane_unavailable|test deployment/i);
  assert.doesNotMatch(html, /\d+x improvement|millions saved|trusted by|customer logo/i);
});
