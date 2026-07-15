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
  assert.match(html, /Human checks decrease only when scoped evidence stays strong/);
  assert.match(html, /<span>For Humans<\/span>/);
  assert.match(html, /<span>For Agents<\/span>/);
  assert.equal(html.match(/aria-hidden="true" class="text-lg leading-none/g)?.length, 2);
  assert.ok(
    html.indexOf('href="/human?tab=discover"') < html.indexOf('href="/agents?tab=overview"'),
    "the Humans CTA should appear before the Agents CTA",
  );
  assert.doesNotMatch(html, /Verified Humans|Ratings|USDC Paid/);
  assert.match(html, /How It/);
  assert.match(html, /The Human Assurance/);
  assert.match(html, /Agent prepares/);
  assert.match(html, /RateLoop decides/);
  assert.match(html, /Humans judge/);
  assert.match(html, /Evidence adapts/);
  assert.match(html, /100 → 50 → 25 → 10%/);
  assert.match(html, /Risk, missing context, and review gaps can force checks/i);
  assert.match(html, /Measured drop restores calibration/i);
  assert.match(html, /poster="\/videos\/rateloop-promo-poster\.jpg"/);
  assert.match(html, /src="\/videos\/rateloop-promo\.mp4"/);
  assert.match(html, /src="\/videos\/rateloop-promo\.vtt"/);
  assert.match(html, /Why It/);
  assert.match(html, /Agent-native/);
  assert.match(html, /Verified and blind/);
  assert.match(html, /Useful signal, auditable pay/);
  for (const term of [
    "MCP Adapter",
    "x402",
    "Proof of Human",
    "Audience Policies",
    "Commit-Reveal",
    "drand/tlock",
    "RBTS",
    "Surprisingly Popular",
    "Base + USDC",
    "Fund Core",
  ]) {
    assert.match(html, new RegExp(term.replace(/[+]/g, "\\+")));
  }
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
  assert.doesNotMatch(html, /See evidence/);
  assert.doesNotMatch(html, /Privacy and Security with Clear Limits/i);
  assert.match(html, /Pricing, Kept/);
  assert.match(html, /Start free with 25 decisions each month/);
  assert.match(html, /Early Access is \$99 for 250 decisions/);
  assert.match(html, /href="\/pricing"/);
  assert.match(html, /Works with the agents your team already uses/);
  assert.match(html, /Claude Code/);
  assert.match(html, /OpenAI Codex/);
  assert.match(html, /Cursor/);
  assert.match(html, /GitHub Copilot/);
  assert.match(html, /Gemini CLI/);
  assert.match(html, /OpenClaw/);
  assert.match(html, /href="\/docs\/ai"/);
  assert.doesNotMatch(html, /Agent setup|Copy setup|role="dialog"/);
  assert.match(html, /id="faq"/);
  assert.match(html, /Common/);
  assert.match(html, /What Does RateLoop Do\?/);
  assert.match(html, /Can an Agent Run Reviews Automatically\?/);
  assert.match(html, /approve its connection and limits/i);
  assert.match(html, /What Does the Blockchain Record\?/);
  assert.equal(html.match(/<details/g)?.length, 6);
  assert.match(html, /href="\/docs"/);
  assert.ok(html.indexOf('id="how-it-works"') < html.indexOf('id="why-it-works"'));
  assert.ok(html.indexOf('id="why-it-works"') < html.indexOf("Pricing, Kept"));
  assert.ok(html.indexOf("Pricing, Kept") < html.indexOf('id="faq"'));
  assert.doesNotMatch(
    html,
    /Test AI-enabled work with blinded human panels|decision-evidence workflow|Agent-Ready|test deployment/i,
  );
  assert.doesNotMatch(html, /Human and AI raters|AI raters|agent raters|Reputation|signed access terms|gated context/i);
  assert.doesNotMatch(html, /Add a human check before AI reaches your customers\./i);
  assert.doesNotMatch(html, /id="problem"|id="solution"|id="safety-privacy"|Safety &amp; Privacy/i);
  assert.doesNotMatch(html, /\/api\/mcp\/public|www\.rateloop\.ai/i);
  assert.doesNotMatch(html, /LREP|staking|protocol token|governance|leaderboard|manual claim/i);

  const visibleWords = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-zA-Z0-9#]+;/g, " ")
    .trim()
    .split(/\s+/).length;
  assert.ok(visibleWords <= 390, `landing page should stay under 390 visible words; found ${visibleWords}`);
});
