import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("mobile protocol diagram uses network-neutral on-chain state label", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { ProtocolPiecesDiagram } = await import("./ProtocolPiecesDiagram");
  const html = renderToStaticMarkup(<ProtocolPiecesDiagram />).replace(/\s+/g, " ");

  assert.match(html, /On-chain protocol state/);
});
