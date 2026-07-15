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
  const { default: HomePage } = await import("./page");
  const html = renderToStaticMarkup(<HomePage />).replace(/\s+/g, " ");

  assert.match(html, /The Human/);
  assert.match(html, /<span class="block">Assurance <span class="rateloop-text-gradient">Loop<\/span><\/span>/);
  assert.doesNotMatch(html, /class="rateloop-text-gradient[^\"]*">Assurance/);
  assert.match(html, /Scale AI autonomy without scaling blind trust\./);
  assert.doesNotMatch(html, /Give your agent frequent human feedback at first/);
  assert.match(html, /<span>For Humans<\/span>/);
  assert.match(html, /<span>For Agents<\/span>/);
  assert.equal(html.match(/aria-hidden="true" class="text-lg leading-none/g)?.length, 2);
  assert.doesNotMatch(html, /Sandbox only|Reviews and payments are simulated|Use test or redacted content/i);
  assert.ok(
    html.indexOf('href="/human?tab=discover"') < html.indexOf('href="/agents?tab=overview"'),
    "the Humans CTA should appear before the Agents CTA",
  );
  assert.doesNotMatch(html, /Verified Humans|Ratings|USDC Paid/);
  assert.match(html, /How It/);
  assert.match(html, /Agent asks/);
  assert.match(html, /Humans answer/);
  assert.match(html, /Evidence returns/);
  assert.match(html, /without seeing early responses/i);
  assert.match(html, /verdict, reasons, and settlement evidence/i);
  assert.match(html, /poster="\/videos\/rateloop-promo-poster\.jpg"/);
  assert.match(html, /src="\/videos\/rateloop-promo\.mp4"/);
  assert.match(html, /src="\/videos\/rateloop-promo\.vtt"/);
  assert.match(html, /Why It/);
  assert.match(html, /Agent-Native/);
  assert.match(html, /Proof of Human/);
  assert.match(html, /World ID-backed network panels add a uniqueness signal/);
  assert.match(html, /Blind by Design/);
  assert.match(html, /Commit-reveal keeps answers sealed/);
  assert.match(html, /Paid for Useful Signal/);
  assert.match(html, /Accepted work earns fixed USDC/);
  assert.match(html, /Auditable Settlement/);
  assert.match(html, /Base records commitments, scoring, refunds, compensation, and claims/);
  for (const href of [
    "/docs/tech-stack#mcp-adapter",
    "/docs/tech-stack#x402-usdc",
    "/docs/tech-stack#proof-of-human",
    "/docs/tech-stack#audience-policies",
    "/docs/tech-stack#commit-reveal",
    "/docs/tech-stack#drand-tlock",
    "/docs/tech-stack#robust-bayesian-truth-serum",
    "/docs/tech-stack#surprisingly-popular",
    "/docs/tech-stack#base-usdc",
    "/docs/smart-contracts#tokenless-panel",
  ]) {
    assert.match(html, new RegExp(`href="${href}"`));
  }
  assert.doesNotMatch(html, /Privacy and Security with Clear Limits|Non-sandbox startup|\/trust|trust registry/i);
  assert.match(html, /Pricing, Kept/);
  assert.match(html, /25 decisions \/ month/);
  assert.match(html, /250 decisions \/ month/);
  assert.match(html, /7\.5% execution fee/);
  assert.match(html, /href="\/pricing"/);
  assert.match(html, /What Does RateLoop Do\?/);
  assert.match(html, /Your team makes the final decision/i);
  assert.match(html, /Use RateLoop with your favorite AI agent/);
  assert.match(html, /Claude Code RateLoop setup/);
  assert.match(html, /OpenAI Codex RateLoop setup/);
  assert.match(html, /Cursor RateLoop setup/);
  assert.match(html, /GitHub Copilot RateLoop setup/);
  assert.match(html, /Gemini CLI RateLoop setup/);
  assert.match(html, /OpenClaw RateLoop setup/);
  assert.doesNotMatch(html, /Connect through the tokenless remote MCP server|View setup/);
  assert.match(html, /Claude Code/);
  assert.match(html, /OpenAI Codex/);
  assert.match(html, /Cursor/);
  assert.match(html, /GitHub Copilot/);
  assert.match(html, /Gemini CLI/);
  assert.match(html, /OpenClaw/);
  assert.match(html, /Common/);
  assert.equal(html.match(/<details/g)?.length, 6);
  assert.ok(html.indexOf('id="how-it-works"') < html.indexOf('id="why-it-works"'));
  assert.ok(html.indexOf('id="why-it-works"') < html.indexOf("Common"));
  assert.doesNotMatch(
    html,
    /Test AI-enabled work with blinded human panels|decision-evidence workflow|Set Up a Sandbox Suite|Agent-Ready|test deployment|public sandbox|simulated reviewers/i,
  );
  assert.doesNotMatch(html, /Human and AI raters|AI raters|agent raters|Reputation|signed access terms|gated context/i);
  assert.doesNotMatch(html, /Add a human check before AI reaches your customers\./i);
  assert.doesNotMatch(html, /id="problem"|id="solution"|id="safety-privacy"|Safety &amp; Privacy/i);
  assert.doesNotMatch(html, /\/api\/mcp\/public|www\.rateloop\.ai/i);
  assert.doesNotMatch(html, /LREP|staking|protocol token|governance|leaderboard|manual claim/i);
});
