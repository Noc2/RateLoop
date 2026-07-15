import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("SDK docs expose only the versioned tokenless agent flow", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: SdkPage } = await import("./page");
  const html = renderToStaticMarkup(<SdkPage />).replace(/\s+/g, " ");

  assert.match(html, /quote.*ask.*wait.*result/i);
  assert.match(html, /rateloop\.tokenless\.v2/i);
  assert.match(html, /TOKENLESS_SANDBOX_MODE=true/i);
  assert.match(html, /Better Auth.*opaque RateLoop principal/i);
  assert.match(html, /authorized client\/project assignment/i);
  assert.match(html, /EU-first repository checks do not establish verified EU hosting or certification/i);
  assert.doesNotMatch(html, /LREP|stake|governance|frontend reward/i);
});
