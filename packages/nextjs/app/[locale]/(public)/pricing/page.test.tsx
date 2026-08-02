import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("pricing page shows three tiers and discloses costs progressively", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  process.env.TOKENLESS_SUBSCRIPTIONS_ENABLED = "true";
  delete process.env.TOKENLESS_DEMO_BOOKING_URL;
  const { default: PricingPage } = await import("./page");
  const html = renderToStaticMarkup(
    await PricingPage({ searchParams: Promise.resolve({ workspace: "ws second" }) }),
  ).replace(/\s+/g, " ");

  assert.match(html, /Start free/);
  assert.doesNotMatch(html, /Workspace plans cover completed review decisions/);
  assert.match(html, /Free/);
  assert.match(html, /\$29/);
  assert.match(html, /25 completed review decisions/);
  assert.match(html, /250 completed review decisions/);
  assert.match(html, /href="\/agents\/billing\?workspace=ws\+second"/);
  assert.match(html, /href="\/agents\/billing\?workspace=ws\+second&amp;billing=upgrade"/);
  assert.doesNotMatch(html, /subject=RateLoop%20Demo/);
  assert.doesNotMatch(html, /Available reviews|These reviews are unpaid/i);
  assert.match(html, /Unlimited invited, unpaid reviewers/i);
  assert.match(html, /Enterprise/);
  assert.match(html, /Custom/);
  assert.match(html, /Custom integrations/);
  assert.match(html, /Evidence export support/);
  assert.match(
    html,
    /class="rateloop-gradient-action min-h-12 w-full justify-center px-5" href="mailto:hawigxyz@proton\.me\?subject=RateLoop%20Enterprise">Request a demo<\/a>/,
  );
  assert.doesNotMatch(html, /target="_blank"/);
  assert.match(html, /<s[^>]*>\$99/);
  assert.doesNotMatch(html, /Then \$99\/month after 12 months/);
  assert.match(html, /First 12 months\. Then 20% off the comparable plan/);
  assert.match(html, /60 days’ notice before changes\. Cancel before they apply/);
  assert.doesNotMatch(html, /reviewer costs|bounty|execution fee|USDC|stablecoin/i);
  assert.doesNotMatch(html, /7\.5%/);
  assert.doesNotMatch(html, /\$149/);
  assert.match(html, /there are no overages/i);
  assert.match(html, /First 12 months/i);
  assert.match(html, /60 days/);
  assert.match(html, /20% off/);
  assert.match(html, /Cancel before they apply/);
  assert.doesNotMatch(html, /Early Access terms:/);
  assert.doesNotMatch(html, /<details/);
  assert.doesNotMatch(html, /Pricing questions|design-partner arrangement/);
});

test("a configured scheduler replaces the enterprise mailto with an external booking link", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  process.env.TOKENLESS_SUBSCRIPTIONS_ENABLED = "true";
  process.env.TOKENLESS_DEMO_BOOKING_URL = "https://calendar.app.google/rateloopDemo";
  const { default: PricingPage } = await import("./page");
  const html = renderToStaticMarkup(await PricingPage({ searchParams: Promise.resolve({}) })).replace(/\s+/g, " ");

  assert.match(
    html,
    /href="https:\/\/calendar\.app\.google\/rateloopDemo" target="_blank" rel="noopener noreferrer"[^>]*>Book demo<\/a>/,
  );
  assert.doesNotMatch(html, /mailto:/);

  delete process.env.TOKENLESS_DEMO_BOOKING_URL;
});

test("German pricing localizes plan details rendered through plan cards", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  process.env.TOKENLESS_SUBSCRIPTIONS_ENABLED = "true";
  delete process.env.TOKENLESS_DEMO_BOOKING_URL;
  const { default: PricingPage } = await import("./page");
  const html = renderToStaticMarkup(
    await PricingPage({ params: Promise.resolve({ locale: "de" }), searchParams: Promise.resolve({}) }),
  ).replace(/\s+/g, " ");

  assert.match(html, /Keine Karte erforderlich/);
  assert.match(html, /25 abgeschlossene Prüfentscheidungen pro Kalendermonat/);
  assert.match(html, /250 abgeschlossene Prüfentscheidungen pro Abrechnungszeitraum/);
  assert.match(html, /Early Access wählen/);
  assert.match(html, /Individuelle Integrationen/);
  assert.match(html, /Demo anfragen/);
  assert.doesNotMatch(html, /No card required|completed review decisions|Request a demo/);
});
