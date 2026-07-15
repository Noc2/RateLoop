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
  assert.ok(
    html.indexOf('href="/human?tab=discover"') < html.indexOf('href="/agents?tab=overview"'),
    "the Humans CTA should appear before the Agents CTA",
  );
  assert.doesNotMatch(html, /Verified Humans|Ratings|USDC Paid/);
  assert.match(html, /How It/);
  assert.match(html, /Agent asks/);
  assert.match(html, /Humans answer/);
  assert.match(html, /Review adapts/);
  assert.match(html, /without seeing early responses/i);
  assert.match(html, /verdict and reasons return to the workflow/i);
  assert.match(html, /poster="\/videos\/rateloop-promo-poster\.jpg"/);
  assert.match(html, /src="\/videos\/rateloop-promo\.mp4"/);
  assert.match(html, /src="\/videos\/rateloop-promo\.vtt"/);
  assert.match(html, /Why It/);
  assert.match(html, /Independent humans/);
  assert.match(html, /Blind by design/);
  assert.match(html, /Auditable settlement/);
  for (const href of [
    "/docs/tech-stack#proof-of-human",
    "/docs/tech-stack#commit-reveal",
    "/docs/smart-contracts#tokenless-panel",
  ]) {
    assert.match(html, new RegExp(`href="${href}"`));
  }
  assert.equal(html.match(/See evidence/g)?.length, 3);
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
  assert.doesNotMatch(html, /Common|What Does RateLoop Do\?|<details/);
  assert.ok(html.indexOf('id="how-it-works"') < html.indexOf('id="why-it-works"'));
  assert.ok(html.indexOf('id="why-it-works"') < html.indexOf("Pricing, Kept"));
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
  assert.ok(visibleWords <= 250, `landing page should stay under 250 visible words; found ${visibleWords}`);
});
