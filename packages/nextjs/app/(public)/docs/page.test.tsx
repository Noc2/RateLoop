import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("documentation introduction states the account-first and EU trust boundaries", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: DocsPage } = await import("./page");
  const html = renderToStaticMarkup(<DocsPage />).replace(/\s+/g, " ");

  assert.match(html, /explicit simulated sandbox/i);
  assert.match(html, /Better Auth.*opaque RateLoop principal/i);
  assert.match(html, /wallet.*funding, payout, or recovery/i);
  assert.match(html, /explicit project assignment.*short reviewer leases/i);
  assert.match(html, /not an immutable or WORM log/i);
  assert.match(html, /do not prove that the current sandbox is EU-hosted/i);
  assert.match(html, /href="\/trust"/i);
});
