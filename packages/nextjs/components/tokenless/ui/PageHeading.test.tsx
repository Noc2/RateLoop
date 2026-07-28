import React from "react";
import { PageHeading } from "./PageHeading";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("page headings preserve route identity, accent, and supporting copy without an eyebrow", () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const html = renderToStaticMarkup(
    <PageHeading
      accent="blue"
      heading="Reviewer notifications"
      headingId="reviewer-notifications"
      subtitle="Assignments, outcomes, and payment deadlines."
    />,
  );

  assert.match(html, /<header class="[^"]*border-\[var\(--rateloop-blue\)\][^"]*">/);
  assert.match(html, /<h1 id="reviewer-notifications"/);
  assert.match(html, />Reviewer notifications<\/h1>/);
  assert.match(html, />Assignments, outcomes, and payment deadlines\.<\/p>/);
  assert.doesNotMatch(html, /uppercase/);
});
