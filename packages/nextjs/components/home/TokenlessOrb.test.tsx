import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("orb renders a spectrum fallback before client animation loads", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { TokenlessOrb } = await import("./TokenlessOrb");
  const html = renderToStaticMarkup(<TokenlessOrb />);

  assert.match(html, /class="orb-static-fallback"/);
  assert.match(html, /id="rateloop-orb-fallback-gradient"/);
  assert.match(html, /stroke="url\(#rateloop-orb-fallback-gradient\)"/);
  assert.ok(new Set([...html.matchAll(/<ellipse[^>]+rx="([^"]+)"[^>]+ry="([^"]+)"/g)].map(match => match[0])).size > 3);
});
