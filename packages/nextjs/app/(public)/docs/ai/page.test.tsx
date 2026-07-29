import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("agent docs lead with the hosted connected-workspace path", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: AgentDocsPage } = await import("./page");
  const html = renderToStaticMarkup(<AgentDocsPage />).replace(/\s+/g, " ");

  assert.match(html, /Run the Agent.*rateloop-text-gradient.*Review Loop/);
  assert.match(html, /https:\/\/rateloop-tokenless\.vercel\.app\/api\/mcp/);
  assert.match(html, /https:\/\/rateloop-tokenless\.vercel\.app\/api\/agent\/v1\/mcp/);
  assert.match(html, /current hosted path requests private, unpaid review from invited workspace reviewers/i);
  assert.match(html, /Available now/i);
  assert.match(html, /href="\/agents\/connections"/);
  assert.match(html, /href="\/agents\/connections">Connections<\/a>/);
  assert.match(
    html,
    /codex plugin marketplace add Noc2\/RateLoop@tokenless --sparse \.agents\/plugins --sparse plugins\/rateloop --sparse plugins\/rateloop-workspace/,
  );
  assert.match(html, /codex plugin add rateloop@rateloop/);
  assert.match(html, /rateloop-workspace@rateloop/);
  assert.match(html, /complete OAuth before the connection task begins/);
  assert.match(html, /uninstall all existing RateLoop plugins/);
  assert.match(html, /do not remove unrelated plugins/i);
  assert.match(html, /Continue/);
  assert.match(html, /Authentication finished, but the task is still waiting\?/);
  assert.match(html, /Authentication complete/);
  assert.match(html, /confirms the OAuth callback, not RateLoop verification/);
  assert.match(html, /first missing-tool check as activation pending/);
  assert.match(html, /still missing on a later active turn/);
  assert.doesNotMatch(html, /codex plugin marketplace add Noc2\/RateLoop(?:\s|<)/);
  assert.match(html, /Other MCP clients and support levels/);
  assert.match(html, /MCP compatibility belongs to the host and agent loop, not the model brand/);
  assert.match(html, /href="\/docs\/agent-connection\.md"/);
  assert.match(html, /rateloop_capabilities/);
  assert.match(html, /rateloop_create_handoff/);
  assert.match(html, /rateloop_get_handoff_status/);
  assert.match(html, /rateloop_get_result/);
  assert.match(html, /exact prompt, context, URLs, artifact descriptions, data classification, and redaction summary/i);
  assert.match(html, /Creating a handoff is not submission/i);
  assert.match(html, /public.*synthetic.*redacted/i);
  assert.match(html, /does not activate an unavailable reviewer network or paid lane/i);
  assert.match(html, /Image bytes do not belong in MCP arguments or a handoff URL/i);
  assert.match(html, /rateloop_get_agent_context/);
  assert.match(html, /rateloop_verify_connection/);
  assert.match(html, /rateloop_evaluate_review_requirement/);
  assert.match(html, /rateloop_request_review/);
  assert.match(html, /rateloop_wait_for_review/);
  assert.match(html, /rateloop_get_review_result/);
  assert.match(html, /rateloop_get_assurance_state/);
  assert.match(html, /safe connection.*cannot spend, publish, read private artifacts, or administer/i);
  assert.match(html, /Generic MCP is advisory/i);
  assert.match(html, /does not issue an automatic production, safety, legal, medical, or compliance approval/i);
  assert.doesNotMatch(
    html,
    /delegated prepaid|self-funded|EIP-3009|bounty|hybrid panel|LREP|governance|protocol-token/i,
  );
  assert.doesNotMatch(html, /(?:www\.)?rateloop\.ai/i);
});
