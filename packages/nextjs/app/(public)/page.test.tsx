import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("landing page presents the tokenless human-assurance story", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  process.env.TOKENLESS_SANDBOX_MODE = "true";
  const { default: HomePage } = await import("./page");
  const html = renderToStaticMarkup(<HomePage />).replace(/\s+/g, " ");

  assert.match(html, /Humans In The/);
  assert.match(html, />Loop<\/span>/);
  assert.match(html, /Human raters evaluate AI outputs, guide better decisions, and earn USDC\./);
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
  assert.match(html, /Decide with Evidence/);
  assert.match(html, /What Does RateLoop Do\?/);
  assert.match(html, /Your team makes the final decision/i);
  assert.match(html, /Remove secrets/i);
  assert.match(html, /Use RateLoop with your favorite AI agent/);
  assert.match(html, /Problem/);
  assert.match(html, /Solution/);
  assert.match(html, /Safety/);
  assert.match(html, /Privacy/);
  assert.match(html, /Read the privacy notice/);
  assert.match(html, /Review the agent safety boundary/);
  assert.match(html, /Claude Code/);
  assert.match(html, /OpenAI Codex/);
  assert.match(html, /Cursor/);
  assert.match(html, /GitHub Copilot/);
  assert.match(html, /Gemini CLI/);
  assert.match(html, /OpenClaw/);
  assert.match(html, /href="\/docs\/ai"/);
  assert.match(html, /Common/);
  assert.equal(html.match(/<details/g)?.length, 6);
  assert.ok(html.indexOf("Problem") < html.indexOf("Solution"));
  assert.ok(html.indexOf("Solution") < html.indexOf("Privacy"));
  assert.ok(html.indexOf("Privacy") < html.indexOf("Common"));
  assert.doesNotMatch(
    html,
    /Test AI-enabled work with blinded human panels|decision-evidence workflow|Set Up a Sandbox Suite|Agent-Ready/i,
  );
  assert.doesNotMatch(
    html,
    /Level Up Your Agent|Human and AI raters|AI raters|agent raters|Reputation|signed access terms|gated context|rateloop-promo\.mp4/i,
  );
  assert.doesNotMatch(html, /Add a human check before AI reaches your customers\./i);
  assert.doesNotMatch(html, /How It Works|Why RateLoop Works|Agent Workflow/i);
  assert.doesNotMatch(html, /\/api\/mcp\/public|www\.rateloop\.ai/i);
  assert.doesNotMatch(html, /LREP|protocol token|governance|leaderboard|manual claim/i);
});
