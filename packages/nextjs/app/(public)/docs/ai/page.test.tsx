import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("agent docs describe the approval-bound four-tool MCP surface without overstating sandbox evidence", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: AgentDocsPage } = await import("./page");
  const html = renderToStaticMarkup(<AgentDocsPage />).replace(/\s+/g, " ");

  assert.match(html, /Agents and MCP/);
  assert.match(html, /https:\/\/rateloop-tokenless\.vercel\.app\/api\/mcp/);
  assert.match(html, /codex plugin marketplace add \./);
  assert.match(html, /codex plugin add rateloop@rateloop/);
  assert.match(html, /Start a new Codex task/);
  assert.match(html, /rateloop_capabilities/);
  assert.match(html, /rateloop_create_handoff/);
  assert.match(html, /rateloop_get_handoff_status/);
  assert.match(html, /rateloop_get_result/);
  assert.match(html, /tools\/list/);
  assert.match(html, /confirmedNoSensitiveData/);
  assert.match(html, /0x0{64}/);
  assert.match(html, /requestedPanelSize/);
  assert.match(html, /explicit approval before calling the handoff tool/i);
  assert.match(html, /Creating a handoff is not submission/i);
  assert.match(html, /public.*synthetic.*redacted/i);
  assert.match(html, /does not provide live human reviews/i);
  assert.match(html, /wallet-transaction, LREP, governance, protocol-token/i);
  assert.doesNotMatch(html, /(?:www\.)?rateloop\.ai/i);
});
