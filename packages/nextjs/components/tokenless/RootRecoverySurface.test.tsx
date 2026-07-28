import React from "react";
import { RootRecoverySurface } from "./RootRecoverySurface";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("root recovery offers search and useful task destinations without another main landmark", () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const html = renderToStaticMarkup(
    <RootRecoverySurface
      eyebrow="404"
      title="Page not found"
      description="This address may be wrong."
      actions={<button type="button">Home</button>}
    />,
  );

  assert.match(html, /aria-label="Useful destinations"/);
  assert.match(html, /href="\/search"[^>]*>Search</);
  assert.match(html, /href="\/human\/review"[^>]*>Review work</);
  assert.match(html, /href="\/agents\/overview"[^>]*>Manage agents</);
  assert.match(html, /href="\/docs"[^>]*>Read docs</);
  assert.doesNotMatch(html, /<main\b/);
});
