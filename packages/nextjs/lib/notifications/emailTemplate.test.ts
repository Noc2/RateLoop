import { buildRateLoopEmailHtml } from "./emailTemplate";
import assert from "node:assert/strict";
import test from "node:test";

test("buildRateLoopEmailHtml includes the branded header, button, and fallback link", () => {
  const html = buildRateLoopEmailHtml({
    title: "Verify your email",
    body: "Confirm this email address to receive RateLoop notification emails.",
    ctaLabel: "Verify email",
    ctaHref: "https://info.rateloop.ai/api/notifications/email/verify?token=test-token",
    eyebrow: "Email verification",
    footerLinkLabel: "Unsubscribe from these emails",
    footerLinkHref: "https://info.rateloop.ai/api/notifications/email/unsubscribe?token=unsubscribe-token",
  });

  assert.match(html, />\s*RateLoop\s*<div/);
  assert.doesNotMatch(html, /<img\b/i);
  assert.doesNotMatch(html, /aria-label="RateLoop logo"/);
  assert.doesNotMatch(html, /Rate<\/span><span style="color:#359EEE;">L/);
  assert.match(html, /Email verification/);
  assert.match(html, /Verify your <!--\[if mso\]><span style="color:#f5f5f5;">email<\/span><!\[endif\]-->/);
  assert.match(html, /background:linear-gradient\(90deg, #359EEE, #03CEA4, #FFC43D, #EF476F\)/);
  assert.match(html, /-webkit-background-clip:text/);
  assert.match(html, /background-clip:text/);
  assert.match(html, /-webkit-text-fill-color:transparent/);
  assert.doesNotMatch(html, /<span style="color:#359EEE;">e<\/span>/);
  assert.match(html, /#359EEE/);
  assert.match(html, /#03CEA4/);
  assert.match(html, /#FFC43D/);
  assert.match(html, /#EF476F/);
  assert.match(html, /linear-gradient\(90deg, #359EEE, #03CEA4, #FFC43D, #EF476F\)/);
  assert.match(html, /Level Up Your Agent/);
  assert.match(html, />\s*Verify email\s*</);
  assert.match(html, /If the button does not work, open this link manually:/);
  assert.match(html, /Unsubscribe from these emails/);
  assert.match(html, /unsubscribe\?token=unsubscribe-token/);
});
