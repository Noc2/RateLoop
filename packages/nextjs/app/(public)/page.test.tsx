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
  const { TokenlessLandingPage } = await import("./page");
  const html = renderToStaticMarkup(
    <TokenlessLandingPage
      subscriptionsEnabled
      socialProofItems={[
        { value: "10", label: "Verified Humans" },
        { value: "21", label: "Ratings" },
        { value: "$12", label: "USDC Paid" },
      ]}
    />,
  ).replace(/\s+/g, " ");

  assert.match(html, /The Human/);
  assert.match(html, /<span class="block">Assurance <span class="rateloop-text-gradient">Loop<\/span><\/span>/);
  assert.doesNotMatch(html, /class="rateloop-text-gradient[^\"]*">Assurance/);
  assert.match(html, /Scale AI autonomy without scaling blind trust\./);
  assert.doesNotMatch(html, /Human checks decrease only when scoped evidence stays strong/);
  assert.match(html, /<span>Start Reviewing<\/span>/);
  assert.match(html, /<span>Connect Agent<\/span>/);
  assert.doesNotMatch(html, /For Humans|For Agents/);
  assert.equal(html.match(/aria-hidden="true" class="text-lg leading-none/g)?.length, 2);
  assert.ok(
    html.indexOf('href="/human?tab=discover"') < html.indexOf('href="/agents?tab=overview"'),
    "the Humans CTA should appear before the Agents CTA",
  );
  assert.ok(
    html.indexOf("The Human") < html.indexOf('class="orb-animation-shell'),
    "the value proposition should precede the orb on small screens",
  );
  assert.match(html, /<span class="font-semibold text-base-content">10<\/span> Verified Humans/);
  assert.match(html, /<span class="font-semibold text-base-content">21<\/span> Ratings/);
  assert.match(html, /<span class="font-semibold text-base-content">\$12<\/span> USDC Paid/);
  assert.match(html, /How It/);
  assert.match(html, /Owner sets policy/);
  assert.match(html, /Agent submits work/);
  assert.match(html, /Humans judge/);
  assert.match(html, /Evaluation/);
  assert.match(html, /risk thresholds, audience, data boundaries, and spending limits/i);
  assert.match(html, /within the owner-approved policy/i);
  assert.match(html, /feedback and actionable human performance metrics for AI workflows/i);
  assert.doesNotMatch(html, /Agent prepares|RateLoop decides|Evidence adapts/);
  assert.match(
    html,
    /<h3 id="human-assurance-loop-title"[^>]*><span>Human<\/span><span>Assurance<\/span><span class="inline-block text-white">Loop<\/span><\/h3>/i,
  );
  assert.equal(html.match(/id="human-assurance-loop-title"/g)?.length, 1);
  assert.doesNotMatch(html, /Review coverage|100 → 50 → 25 → 10%|Evidence earns autonomy/);
  assert.doesNotMatch(html, /The Human Assurance <span class="rateloop-text-gradient">Loop/);
  assert.equal(html.match(/stroke-dasharray="25 75"/g)?.length, 4);
  assert.doesNotMatch(html, /rateloop-promo/);
  assert.match(html, /Why It/);
  assert.match(html, /Agent-native/);
  assert.match(html, /Verified and blind/);
  assert.match(html, /Useful signal, auditable pay/);
  assert.match(html, /Human oversight, operationalized/);
  assert.doesNotMatch(html, /Evidence your auditors can check|Trace review policy/i);
  assert.match(html, /Your people provide the oversight\. RateLoop provides the instrument — and the proof\./);
  assert.match(html, /href="\/docs\/human-oversight"[^>]*>Human Oversight<\/a>/i);
  assert.match(html, /href="\/docs\/evidence"[^>]*>Evidence guide<\/a>/i);
  for (const term of [
    "Agent handoffs",
    "Scoped funding",
    "Human eligibility",
    "Reviewer rules",
    "Sealed answers",
    "Quality bonus",
    "Insight bonus",
    "USDC settlement",
    "Fund safeguards",
  ]) {
    assert.match(html, new RegExp(term.replace(/[+]/g, "\\+")));
  }
  assert.doesNotMatch(html, /Independent opening/);
  const visibleText = html.replace(/<[^>]+>/g, " ");
  assert.doesNotMatch(visibleText, /\bx402\b|Commit-Reveal|drand\/tlock|\bRBTS\b|Fund Core/);
  for (const href of [
    "/docs/tech-stack#mcp-adapter",
    "/docs/tech-stack#x402-usdc",
    "/docs/tech-stack#proof-of-human",
    "/docs/tech-stack#audience-policies",
    "/docs/tech-stack#commit-reveal",
    "/docs/tech-stack#robust-bayesian-truth-serum",
    "/docs/tech-stack#surprisingly-popular",
    "/docs/tech-stack#base-usdc",
    "/docs/smart-contracts#tokenless-panel",
    "/docs/human-oversight",
    "/docs/evidence",
  ]) {
    assert.match(html, new RegExp(`href="${href}"`));
  }
  assert.doesNotMatch(html, /See evidence/);
  assert.doesNotMatch(html, /Privacy and Security with Clear Limits/i);
  assert.match(html, /Pricing, Kept/);
  assert.match(html, /Plans cover RateLoop decisions/);
  assert.match(html, /\$29/);
  assert.match(html, /25 completed review decisions/);
  assert.match(html, /250 completed review decisions/);
  assert.match(html, /href="\/agents\?tab=overview"/);
  assert.match(html, /href="\/agents\?tab=overview&amp;billing=upgrade"/);
  assert.match(html, /Book demo/);
  assert.doesNotMatch(html, /See pricing|href="\/pricing"/);
  assert.match(html, /Works with the agents your team already uses/);
  assert.match(html, /Claude Code/);
  assert.match(html, /OpenAI Codex/);
  assert.match(html, /Cursor/);
  assert.match(html, /GitHub Copilot/);
  assert.match(html, /Gemini CLI/);
  assert.match(html, /OpenClaw/);
  assert.match(html, /text-base leading-7 text-base-content\/70 sm:mb-5 sm:text-lg/);
  assert.match(html, /px-3 py-2\.5 text-base-content\/70 sm:px-3\.5 lg:px-4/);
  assert.match(html, /whitespace-nowrap text-sm font-semibold sm:text-base/);
  assert.doesNotMatch(html, /See supported agents|href="\/docs\/ai"/);
  assert.doesNotMatch(html, /Agent setup|Copy setup|role="dialog"/);
  assert.match(html, /id="use-cases"/);
  assert.match(html, /Where Humans/);
  assert.doesNotMatch(html, /Automated checks catch many failures.*contextual decision.*actual output/i);
  for (const [title, body, href] of [
    [
      "Customer replies",
      "A grounded reply can still frustrate. Would you send it?",
      "/docs/use-cases#customer-replies",
    ],
    [
      "Research and client work",
      "Citations can still support weak conclusions. Are the claims supported?",
      "/docs/use-cases#research-deliverables",
    ],
    [
      "Product experiences",
      "Tests can pass while users stay confused. Is the next action clear?",
      "/docs/use-cases#product-experiences",
    ],
  ]) {
    assert.match(html, new RegExp(title, "i"));
    assert.match(html, new RegExp(body.replace(/[?.]/g, "\\$&"), "i"));
    assert.match(html, new RegExp(`href="${href}"`));
  }
  assert.match(html, /href="\/docs\/use-cases"[^>]*>Explore example workflows<\/a>/i);
  assert.match(html, /id="faq"/);
  assert.match(html, /Common/);
  assert.doesNotMatch(html, /What Does RateLoop Do\?|What Can I Evaluate\?/);
  assert.match(html, /Can an Agent Run Reviews Automatically\?/);
  assert.match(html, /approve its connection and limits/i);
  assert.match(html, /What Does the Blockchain Record\?/);
  assert.match(html, /Does RateLoop help with EU AI Act human oversight\?/);
  assert.match(html, /monitor, override, and stop AI outputs through RateLoop/i);
  assert.match(html, /Configuring RateLoop and using it correctly for your purpose remain yours\./);
  assert.equal(html.match(/<details/g)?.length, 5);
  assert.match(html, /href="\/docs"/);
  assert.ok(html.indexOf('id="use-cases"') < html.indexOf('id="how-it-works"'));
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
  assert.ok(visibleWords <= 480, `landing page should stay under 480 visible words; found ${visibleWords}`);
});
