import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { FOUNDING_PILOT, SANDBOX_PRICE_CENTS, formatEurPrice } from "~~/lib/marketing/foundingPilot";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("pricing page shows the sandbox and the founding pilot without a dollar anchor", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  process.env.TOKENLESS_SUBSCRIPTIONS_ENABLED = "true";
  delete process.env.TOKENLESS_DEMO_BOOKING_URL;
  const { default: PricingPage } = await import("./page");
  const html = renderToStaticMarkup(
    await PricingPage({ searchParams: Promise.resolve({ workspace: "ws second" }) }),
  ).replace(/\s+/g, " ");

  assert.match(html, /Start free/);
  assert.doesNotMatch(html, /Workspace plans cover completed review decisions/);
  assert.match(html, /Sandbox/);
  assert.match(html, /Founding Pilot/);
  assert.ok(html.includes(formatEurPrice(SANDBOX_PRICE_CENTS).replace(/\s+/gu, " ")));
  assert.ok(html.includes(formatEurPrice(FOUNDING_PILOT.priceCents).replace(/\s+/gu, " ")));
  assert.match(html, /1 active agent/);
  assert.match(html, /1 invited reviewer group/);
  assert.match(html, /6-week structured pilot/);
  assert.match(html, /50% creditable against a later subscription/);
  assert.match(html, /Invoiced in euro by bank transfer/);
  assert.match(html, /Workspace limits agreed in the pilot order/);
  assert.match(html, /All prices net of 19% VAT\./);
  assert.doesNotMatch(html, /completed review decisions|decision allowance/iu);
  assert.match(html, /href="\/agents\/billing\?workspace=ws\+second"/);
  assert.doesNotMatch(html, /subject=RateLoop%20Demo/);
  assert.doesNotMatch(html, /Available reviews|These reviews are unpaid/i);
  // Attribute order is not meaningful: Button emits its className before
  // spreading the call site's props, so class now precedes href.
  const pilot = html.match(/<a\b([^>]*)>Request pilot<\/a>/u);
  assert.ok(pilot, "the founding-pilot action should render as an anchor");
  assert.match(pilot[1]!, /href="mailto:hawigxyz@proton\.me\?subject=RateLoop%20Founding%20Pilot"/u);
  pilot[1] = pilot[1]!.match(/class="([^"]*)"/u)?.[1] ?? "";
  // min-h-12 is gone on purpose and nothing moved: .rateloop-gradient-action is
  // unlayered and already pins min-height: 3rem, which is the same 48px, so the
  // utility could never have applied. What must remain is the variant that
  // produces the height and the classes that genuinely do something.
  for (const expected of ["rateloop-gradient-action", "px-5", "w-full", "justify-center"]) {
    assert.ok(pilot[1]!.split(" ").includes(expected), `pilot action keeps ${expected}`);
  }
  assert.ok(!pilot[1]!.split(" ").includes("min-h-12"), "an inert height utility should not be restated");
  assert.doesNotMatch(html, /target="_blank"/);
  // The retired dollar anchor, the struck list price and the discount promise must not return.
  assert.doesNotMatch(html, /\$0|\$29|\$99|<s[ >]|20% off|First 12 months|Choose Early Access/);
  assert.doesNotMatch(html, /Enterprise|Custom integrations|Evidence export support|Book demo/);
  assert.doesNotMatch(html, /reviewer costs|bounty|execution fee|USDC|stablecoin/i);
  assert.doesNotMatch(html, /7\.5%/);
  assert.doesNotMatch(html, /\$149/);
  assert.doesNotMatch(html, /What counts as a decision|there are no overages/i);
  assert.doesNotMatch(html, /Early Access terms:/);
  assert.doesNotMatch(html, /<details/);
  assert.doesNotMatch(html, /Pricing questions|design-partner arrangement/);
});

test("a configured scheduler replaces the pilot mailto with an external booking link", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  process.env.TOKENLESS_SUBSCRIPTIONS_ENABLED = "true";
  process.env.TOKENLESS_DEMO_BOOKING_URL = "https://calendar.app.google/rateloopDemo";
  const { default: PricingPage } = await import("./page");
  const html = renderToStaticMarkup(await PricingPage({ searchParams: Promise.resolve({}) })).replace(/\s+/g, " ");

  assert.match(
    html,
    /href="https:\/\/calendar\.app\.google\/rateloopDemo" target="_blank" rel="noopener noreferrer"[^>]*>Request pilot<\/a>/,
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
  assert.match(html, /1 aktiver Agent/);
  assert.match(html, /1 eingeladene Prüfgruppe/);
  assert.match(html, /Gründungsangebot/);
  assert.match(html, /einmalig, netto/);
  assert.match(html, /Strukturiertes Pilotprojekt über 6 Wochen/);
  assert.match(html, /Alle Preise netto zzgl\. 19 % USt\./);
  assert.match(html, /Pilotprojekt anfragen/);
  assert.ok(html.includes(formatEurPrice(FOUNDING_PILOT.priceCents, "de").replace(/\s+/gu, " ")));
  assert.doesNotMatch(html, /No card required|completed review decisions|Request a demo|Early Access wählen/);
});
