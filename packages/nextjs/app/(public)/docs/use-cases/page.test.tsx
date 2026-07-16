import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("use cases turn concrete problems into bounded human-assurance decisions", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: UseCasesPage } = await import("./page");
  const html = renderToStaticMarkup(<UseCasesPage />).replace(/\s+/g, " ");

  assert.match(html, /Use.*rateloop-text-gradient.*Cases/i);
  assert.match(html, /examples describe workflows, not customer results or outcome claims/i);
  assert.equal(html.match(/data-use-case=/g)?.length, 5);

  for (const [id, title, criterion] of [
    ["customer-replies", "Customer replies", "Would you send this response to the customer as written?"],
    ["research-deliverables", "Research and client work", "Is this conclusion supported by the supplied sources?"],
    ["product-experiences", "Product experiences", "Is the intended next action clear from this screen?"],
    ["version-calibration", "Agent-version calibration", "should this agent suggestion be accepted?"],
    [
      "extraction-triage",
      "Extraction and triage exceptions",
      "Does the suggested classification or extracted record match the supplied source?",
    ],
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(html, new RegExp(title, "i"));
    assert.match(html, new RegExp(criterion.replace(/[?]/g, "\\?"), "i"));
  }

  assert.match(html, /Trigger.*Human check.*Reviewer qualifications.*Permitted material.*Decision and evidence/i);
  assert.match(html, /Invite support experts.*network or hybrid panel.*public, synthetic, or safely redacted/i);
  assert.match(html, /Invite domain experts.*General readers can judge clarity or source credibility/i);
  assert.match(html, /Proof of Human.*uniqueness signal.*does not prove professional expertise/i);
  assert.match(html, /unit tests, schema validation, deterministic policy checks, tracing, and automated evaluators/i);
  assert.match(html, /sole medical, legal, financial, security, or safety approval/i);
  assert.match(html, /href="\/docs\/how-it-works"/);
  assert.match(html, /href="\/docs\/ai"/);
  assert.doesNotMatch(html, /network_panels_disabled|private_assignment_lane_unavailable|test deployment/i);
  assert.doesNotMatch(html, /\d+x improvement|millions saved|trusted by|customer logo/i);
});
