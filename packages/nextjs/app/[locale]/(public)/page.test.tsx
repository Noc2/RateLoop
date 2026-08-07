import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("landing social proof is rendered from the current response ledger", async () => {
  const { dynamic } = await import("./page");
  assert.equal(dynamic, "force-dynamic");
});

test("landing page presents the tokenless human-assurance story", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { TokenlessLandingPage } = await import("./page");
  const html = renderToStaticMarkup(
    <TokenlessLandingPage
      socialProofItems={[
        { value: 10, labelKey: "verifiedHumans" },
        { value: 21, labelKey: "reviewResponses" },
        { value: "$12", labelKey: "usdcPaid" },
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
    html.indexOf('href="/agents/connections"') < html.indexOf('href="/human/review"'),
    "the buyer connection CTA should appear before the reviewer CTA",
  );
  // Class order is no longer meaningful: Button composes "btn variant size
  // className", so a call site's own classes land last. Assert the classes are
  // present on the right link rather than the order they happen to compose in.
  const linkClasses = (href: string) =>
    html.match(new RegExp(`class="([^"]*)" href="${href.replace(/\//gu, "\\/")}"`, "u"))?.[1] ?? "";
  const connectClasses = linkClasses("/agents/connections");
  assert.match(connectClasses, /\bgroup\b/u);
  assert.match(connectClasses, /\brateloop-gradient-action\b/u);
  assert.match(linkClasses("/human/review"), /\bbtn\b/u);
  assert.ok(
    html.indexOf("The Human") < html.indexOf('class="orb-animation-shell'),
    "the value proposition should precede the orb on small screens",
  );
  assert.match(html, /<span class="font-semibold text-base-content">10<\/span> Verified humans/);
  assert.match(html, /<span class="font-semibold text-base-content">21<\/span> Review responses/);
  assert.match(html, /<span class="font-semibold text-base-content">\$12<\/span> USDC paid/);
  assert.match(html, /How It/);
  assert.match(html, /Owner sets policy/);
  assert.match(html, /Agent submits work/);
  assert.match(html, /Humans judge/);
  assert.match(html, /Evaluation/);
  assert.match(html, /risk thresholds, reviewer audience, data boundaries, and response windows/i);
  assert.match(html, /within the owner-approved policy/i);
  assert.match(html, /feedback and actionable human performance metrics for AI workflows/i);
  assert.doesNotMatch(html, /Agent prepares|RateLoop decides|Evidence adapts/);
  assert.match(
    html,
    /<h3 id="human-assurance-loop-title"[^>]*><span>Human<\/span><span>Assurance<\/span><span class="inline-block text-base-content">Loop<\/span><\/h3>/i,
  );
  assert.equal(html.match(/id="human-assurance-loop-title"/g)?.length, 1);
  assert.doesNotMatch(html, /Review coverage|100 → 50 → 25 → 10%|Evidence earns autonomy/);
  assert.doesNotMatch(html, /The Human Assurance <span class="rateloop-text-gradient">Loop/);
  assert.equal(html.match(/stroke-dasharray="25 75"/g)?.length, 4);
  assert.doesNotMatch(html, /rateloop-promo/);
  assert.match(html, /Why It/);
  assert.match(html, /Agent-native/);
  assert.match(html, /Private by default/);
  assert.match(html, /Evidence you can inspect/);
  assert.doesNotMatch(html, /Human oversight, supported/);
  assert.doesNotMatch(html, /Evidence your auditors can check|Trace review policy/i);
  assert.match(html, /Who Reviews the Work\?/);
  assert.match(html, /Your invited workspace reviewers\./);
  assert.doesNotMatch(html, /World ID-backed network|hybrid panels/);
  assert.doesNotMatch(html, /RateLoop provides the instrument — and the proof/i);
  for (const term of ["Agent guide", "Review flow", "Evidence reference"]) {
    assert.match(html, new RegExp(term.replace(/[+]/g, "\\+")));
  }
  assert.doesNotMatch(html, /Independent opening/);
  const visibleText = html.replace(/<[^>]+>/g, " ");
  assert.doesNotMatch(visibleText, /\bx402\b|Commit-Reveal|drand\/tlock|\bRBTS\b|Fund Core/);
  for (const href of ["/docs/ai", "/docs/how-it-works#reviewer-flow", "/docs/evidence"]) {
    assert.match(html, new RegExp(`href="${href}"`));
  }
  assert.doesNotMatch(html, /See evidence/);
  assert.doesNotMatch(html, /Privacy and Security with Clear Limits/i);
  assert.match(html, /Pricing, Kept/);
  assert.match(html, /1 active agent/);
  assert.match(html, /1 invited reviewer group/);
  assert.match(html, /Sandbox/);
  assert.match(html, /Founding Pilot/);
  assert.match(html, /6-week structured pilot/);
  assert.doesNotMatch(html, /completed review decisions|decision allowance/iu);
  assert.match(html, /All prices net of 19% VAT\./);
  assert.match(html, /invited, unpaid review workflows/);
  assert.equal(html.match(/href="\/pricing"/g)?.length, 1);
  assert.match(html, /Compare plans/);
  assert.ok(html.indexOf("Sandbox") < html.indexOf("Founding Pilot"));
  assert.doesNotMatch(html, /\$0|\$29|\$99|20% off|Choose Early Access|Book demo|Custom integrations|Enterprise/);
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
  assert.doesNotMatch(html, /See supported agents/);
  assert.doesNotMatch(html, /Agent setup|Copy setup|role="dialog"/);
  assert.match(html, /id="use-cases"/);
  assert.match(html, /Where Humans/);
  assert.doesNotMatch(html, /Automated checks catch many failures.*contextual decision.*actual output/i);
  for (const [title, href] of [
    ["Customer replies", "/docs/use-cases#customer-replies"],
    ["Research and client work", "/docs/use-cases#research-deliverables"],
    ["AI-assisted hiring", "/docs/use-cases#hiring-decisions"],
  ]) {
    assert.match(html, new RegExp(title, "i"));
    assert.match(html, new RegExp(`href="${href}"`));
  }
  assert.doesNotMatch(
    html,
    /A grounded reply can still frustrate|Citations can still support|Hiring AI can be high-risk/i,
  );
  assert.match(html, /href="\/docs\/use-cases"[^>]*>Explore example workflows<\/a>/i);
  assert.match(html, /id="faq"/);
  assert.match(html, /Common/);
  assert.doesNotMatch(html, /What Does RateLoop Do\?|What Can I Evaluate\?/);
  assert.match(html, /Can an Agent Run Reviews Automatically\?/);
  assert.match(html, /Connection alone does not intercept outputs/i);
  assert.match(html, /only a verified host adapter that controls delivery can enforce waiting before release/i);
  assert.match(html, /No host currently holds that tier/i);
  assert.match(html, /Ordinary Codex integrations are advisory/i);
  assert.doesNotMatch(html, /primary verified path/i);
  assert.match(html, /What Does RateLoop Record\?/);
  assert.match(html, /How can RateLoop support EU AI Act human oversight\?/);
  assert.match(html, /support configured human-review controls and export evidence relevant to Article 14/i);
  assert.match(html, /does not determine whether the Act applies or establish compliance/i);
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
  assert.ok(visibleWords <= 430, `landing page should stay under 430 visible words; found ${visibleWords}`);
});

test("landing social proof uses precise localized labels", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { TokenlessLandingPage } = await import("./page");
  const socialProofItems = [
    { value: 10, labelKey: "verifiedHumans" as const },
    { value: 21, labelKey: "reviewResponses" as const },
    { value: "$12", labelKey: "usdcPaid" as const },
  ];

  const english = renderToStaticMarkup(<TokenlessLandingPage locale="en" socialProofItems={socialProofItems} />);
  const german = renderToStaticMarkup(<TokenlessLandingPage locale="de" socialProofItems={socialProofItems} />);

  assert.match(english, />21<\/span> Review responses/);
  assert.match(german, />21<\/span> Prüfantworten/);
  assert.doesNotMatch(german, />21<\/span> Ratings/);
  assert.match(
    english,
    /<span class="block">The Human<\/span><span class="block">Assurance <span class="rateloop-text-gradient">Loop<\/span><\/span>/,
  );
  assert.match(
    german,
    /<span class="block">Geprüft von<\/span><span class="block"><span class="rateloop-text-gradient">Menschen\.<\/span><\/span>/,
  );
});
