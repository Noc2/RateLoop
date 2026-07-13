import React from "react";
import { DOCS_NAV } from "../../../constants/docsNav";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("documentation uses the shared application sidebar instead of a second rail", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: DocsLayout } = await import("./layout");
  const html = renderToStaticMarkup(
    <DocsLayout>
      <article>Documentation content</article>
    </DocsLayout>,
  );

  assert.doesNotMatch(html, /<aside|aria-label="Documentation"/);
  assert.match(html, /max-w-5xl/);
  assert.deepEqual(
    DOCS_NAV.map(group => [group.section, group.links.map(link => link.label)]),
    [
      ["Start Here", ["Introduction", "How It Works", "For Integrations"]],
      ["Settlement", ["Tech Stack", "Smart Contracts"]],
      ["Build", ["SDK", "API Errors"]],
    ],
  );
});
