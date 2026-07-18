import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("agent docs describe the approval-bound four-tool MCP surface and decision boundary", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: AgentDocsPage } = await import("./page");
  const html = renderToStaticMarkup(<AgentDocsPage />).replace(/\s+/g, " ");

  assert.match(html, /Agents.*rateloop-text-gradient.*MCP/);
  assert.match(html, /https:\/\/rateloop-tokenless\.vercel\.app\/api\/mcp/);
  assert.match(html, /https:\/\/rateloop-tokenless\.vercel\.app\/api\/agent\/v1\/mcp/);
  assert.match(
    html,
    /codex plugin marketplace add Noc2\/RateLoop@tokenless --sparse \.agents\/plugins --sparse plugins\/rateloop --sparse plugins\/rateloop-workspace/,
  );
  assert.match(html, /codex plugin add rateloop@rateloop/);
  assert.match(html, /rateloop-workspace@rateloop/);
  assert.match(html, /uninstall all existing RateLoop plugins/);
  assert.match(html, /do not remove unrelated plugins/i);
  assert.match(html, /Continue/);
  assert.match(html, /Authentication finished, but still waiting\?/);
  assert.match(html, /Authentication complete/);
  assert.match(html, /confirms only the OAuth callback, not RateLoop verification/);
  assert.match(html, /first missing-tool check as activation pending/);
  assert.match(html, /still missing on a later active turn/);
  assert.doesNotMatch(html, /codex plugin marketplace add Noc2\/RateLoop(?:\s|<)/);
  assert.match(html, /Other MCP clients and support levels/);
  assert.match(html, /MCP compatibility belongs to the host and agent loop, not the model brand/);
  assert.match(html, /Protocol-compatible/);
  assert.match(html, /Application-managed/);
  assert.match(html, /local GitHub Copilot Chat in VS Code/);
  assert.match(html, /GitHub Copilot cloud agent and code review.*cannot use the protected workspace endpoint/i);
  assert.match(html, /href="\/docs\/agent-connection\.md"/);
  assert.match(html, /does not guess client IDs, redirect URIs, or install links/);
  assert.doesNotMatch(html, /A common configuration shape|"mcpServers"/);
  assert.match(html, /rateloop_capabilities/);
  assert.match(html, /rateloop_create_handoff/);
  assert.match(html, /rateloop_get_handoff_status/);
  assert.match(html, /rateloop_get_result/);
  assert.match(html, /tools\/list/);
  assert.match(html, /confirmedNoSensitiveData/);
  assert.match(html, /0x(?:12){32}/);
  assert.match(html, /requestedPanelSize/);
  assert.match(html, /explicit approval before calling the handoff tool/i);
  assert.match(html, /Creating a handoff is not submission/i);
  assert.match(html, /public.*synthetic.*redacted/i);
  assert.match(html, /does not issue an automatic production/i);
  assert.match(html, /media-upload/);
  assert.match(html, /Image bytes never belong in MCP arguments or a handoff URL/i);
  assert.match(html, /mediaPreviews/);
  assert.match(html, /workspace and authorized client\/project boundary/i);
  assert.match(html, /rateloop_get_agent_context/);
  assert.match(html, /rateloop_evaluate_review_requirement/);
  assert.match(html, /rateloop_request_review/);
  assert.match(html, /rateloop_wait_for_review/);
  assert.match(html, /rateloop_get_review_result/);
  assert.match(html, /rateloop_get_assurance_state/);
  assert.match(html, /safe connection.*cannot spend, publish, read private artifacts, or administer/i);
  assert.match(html, /separate owner-approved publishing step-up/i);
  assert.match(html, /Generic MCP is advisory/i);
  assert.doesNotMatch(html, /LREP|governance|protocol-token/i);
  assert.doesNotMatch(html, /(?:www\.)?rateloop\.ai/i);
});
