import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("landing page uses concise buyer-facing copy and a secondary reviewer journey", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  process.env.TOKENLESS_SANDBOX_MODE = "true";
  const { default: HomePage } = await import("./page");
  const html = renderToStaticMarkup(<HomePage />).replace(/\s+/g, " ");

  assert.match(html, /Humans In The/);
  assert.match(html, />Loop<\/span>/);
  assert.match(html, /Human raters guide decisions and earn USDC/);
  assert.match(html, /Try the Sandbox/);
  assert.match(html, /View Reviewer Flow/);
  assert.ok(
    html.indexOf("Try the Sandbox") < html.indexOf("View Reviewer Flow"),
    "the buyer CTA should appear before the rater CTA",
  );
  assert.match(html, /Reviews and payments are simulated/i);
  assert.match(html, /Use test or redacted content/i);
  assert.match(html, /Set the Standard/);
  assert.match(html, /Review Blind/);
  assert.match(html, /Make the Call/);
  assert.match(html, /Consulting/);
  assert.match(html, /What Does RateLoop Do\?/);
  assert.match(html, /Your team makes the final decision/i);
  assert.match(html, /Keep secrets out/i);
  assert.match(html, /How It/);
  assert.match(html, /Why RateLoop/);
  assert.match(html, /Agent/);
  assert.match(html, /Claude Code/);
  assert.match(html, /OpenAI Codex/);
  assert.match(html, /Cursor/);
  assert.match(html, /GitHub Copilot/);
  assert.match(html, /Gemini CLI/);
  assert.match(html, /OpenClaw/);
  assert.match(html, /rateloop_capabilities/);
  assert.match(html, /rateloop_create_handoff/);
  assert.match(html, /rateloop_get_handoff_status/);
  assert.match(html, /rateloop_get_result/);
  assert.match(html, /You see exactly what will be shared/i);
  assert.match(html, /Review the quote and send it from the browser/i);
  assert.match(html, /This sandbox is simulated/i);
  assert.match(html, /href="\/docs\/ai"/);
  assert.match(html, /Common/);
  assert.equal(html.match(/<details/g)?.length, 6);
  assert.doesNotMatch(
    html,
    /Test AI-enabled work with blinded human panels|decision-evidence workflow|Set Up a Sandbox Suite|Agent-Ready/i,
  );
  assert.doesNotMatch(
    html,
    /Level Up Your Agent|Human and AI raters|AI raters|agent raters|Reputation|signed access terms|gated context|favorite AI agent|rateloop-promo\.mp4/i,
  );
  assert.doesNotMatch(html, /LREP|tokenless|protocol token|governance|leaderboard|manual claim/i);
  assert.doesNotMatch(html, /(?:www\.)?rateloop\.ai/i);
});
