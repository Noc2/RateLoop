import { buildRateLoopEmailHtml } from "./emailTemplate";
import assert from "node:assert/strict";
import test from "node:test";

test("buildRateLoopEmailHtml reuses the branded RateLoop action design", () => {
  const html = buildRateLoopEmailHtml({
    kind: "action",
    title: "Verify your email",
    body: "Confirm this email address to receive RateLoop notifications.",
    ctaLabel: "Verify email",
    ctaHref: "https://rateloop-tokenless.vercel.app/api/notifications/email/verify?token=test-token",
    eyebrow: "Email verification",
    footerLinkLabel: "Unsubscribe from these emails",
    footerLinkHref: "https://rateloop-tokenless.vercel.app/api/notifications/email/unsubscribe?token=unsubscribe-token",
    preheader: "Confirm your RateLoop notification email.",
  });

  assert.match(html, /^<!doctype html>/u);
  assert.match(html, />\s*RateLoop\s*<div/u);
  assert.match(html, /The Human Assurance Loop/u);
  assert.doesNotMatch(html, /Level Up Your Agent/u);
  assert.doesNotMatch(html, /<img\b/iu);
  assert.match(html, /Email verification/u);
  assert.match(html, /Verify your <!--\[if mso\]><span style="color:#f5f5f5;">email<\/span><!\[endif\]-->/u);
  assert.match(html, /linear-gradient\(90deg, #359EEE, #03CEA4, #FFC43D, #EF476F\)/u);
  assert.match(html, /Confirm your RateLoop notification email\./u);
  assert.match(html, />\s*Verify email\s*</u);
  assert.match(html, /If the button does not work, open this link manually:/u);
  assert.match(html, /Unsubscribe from these emails/u);
});

test("buildRateLoopEmailHtml renders a safe code panel without inventing a link", () => {
  const html = buildRateLoopEmailHtml({
    kind: "code",
    title: "Sign in to RateLoop",
    body: "Enter this code in the RateLoop sign-in screen.",
    code: '12<34&"',
    codeLabel: "One-time code",
    codeNote: "This code expires in five minutes.",
    eyebrow: "Secure sign-in",
    footerNote: "If you did not request this code, you can ignore this email.",
  });

  assert.match(html, /One-time code/u);
  assert.match(html, /12&lt;34&amp;&quot;/u);
  assert.match(html, /This code expires in five minutes\./u);
  assert.doesNotMatch(html, /<a\b/iu);
  assert.doesNotMatch(html, /12<34/u);
});
