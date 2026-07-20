import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { TOKENLESS_HOST_CAPABILITIES } from "~~/lib/tokenless/hostCapabilities";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("the connect index lists every registry host with the plugin hosts first", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: ConnectHostIndexPage } = await import("./page");
  const html = renderToStaticMarkup(<ConnectHostIndexPage />).replace(/\s+/g, " ");

  assert.match(html, /Connect a.*rateloop-text-gradient.*Host/);
  assert.match(html, /generated from the same host-capability registry/);
  assert.match(html, /href="\/agents"/);
  assert.match(html, /Primary path/);
  assert.match(html, /Other hosts/);
  assert.match(html, /href="\/docs\/ai"/);
  assert.match(html, /href="\/docs\/agent-connection\.md"/);

  const primaryEnd = html.indexOf("Other hosts");
  for (const host of TOKENLESS_HOST_CAPABILITIES) {
    const linkAt = html.indexOf(`href="/docs/connect/${host.id}"`);
    assert.ok(linkAt >= 0, `${host.id} is missing from the index`);
    assert.ok(html.includes(host.displayName), `${host.displayName} is missing from the index`);
    if (host.category === "plugin-host") {
      assert.ok(linkAt < primaryEnd, `${host.id} must be in the primary path section`);
    } else {
      assert.ok(linkAt > primaryEnd, `${host.id} must stay below the primary path`);
    }
  }
});
