import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authorizePage = readFileSync(
  new URL("../../../app/(public)/agent/oauth/authorize/page.tsx", import.meta.url),
  "utf8",
);
const devicePage = readFileSync(new URL("../../../app/(public)/agent/oauth/device/page.tsx", import.meta.url), "utf8");
const consentForm = readFileSync(new URL("./AgentOAuthConsentForm.tsx", import.meta.url), "utf8");
const authorizeRoute = readFileSync(
  new URL("../../../app/api/agent/oauth/authorize/route.ts", import.meta.url),
  "utf8",
);

test("OAuth consent shows exact scopes before the decision", () => {
  assert.match(authorizePage, /Allow \$\{authorization\.clientName\}/);
  assert.match(authorizePage, /This agent can/);
  assert.match(authorizePage, /authorization\.scopes\.map/);
  assert.ok(authorizePage.indexOf("authorization.scopes.map") < authorizePage.indexOf("<AgentOAuthConsentForm"));
  assert.doesNotMatch(authorizePage, /<details/);
  assert.doesNotMatch(authorizePage, /Allowed actions|Access and refresh tokens/);
  assert.match(consentForm, /name="decision" value="approve"/);
  assert.match(consentForm, /name="decision" value="deny"/);
});

test("loopback OAuth completion stays branded while preserving a no-JavaScript redirect", () => {
  assert.match(consentForm, /x-rateloop-oauth-callback-relay/);
  assert.match(consentForm, /Authorization approved/);
  assert.match(consentForm, /Authentication complete/);
  assert.match(consentForm, /Return to the same agent task\. RateLoop will show the connection after verification\./);
  assert.match(consentForm, /Authorization canceled/);
  assert.doesNotMatch(consentForm, /Agent connected/);
  assert.match(consentForm, /sandbox=""/);
  assert.match(consentForm, /referrerPolicy="no-referrer"/);
  assert.match(consentForm, /window\.close\(\)/);
  assert.match(consentForm, /window\.location\.replace\("\/agents\?tab=overview"\)/);
  assert.match(consentForm, /action="\/api\/agent\/oauth\/authorize"[\s\S]*method="post"/);
  assert.match(authorizeRoute, /BROWSER_RELAY_HEADER/);
  assert.match(authorizeRoute, /outcome \? \{ outcome \} : \{\}/);
  assert.match(authorizeRoute, /NextResponse\.redirect\(destination, 303\)/);
});

test("device consent shows its code and scopes before the decision", () => {
  assert.match(devicePage, /Allow \$\{approval\.clientName\}/);
  assert.match(devicePage, /Verification code/);
  assert.match(devicePage, /\{approval\.userCode\}/);
  assert.match(devicePage, /This agent can/);
  assert.match(devicePage, /approval\.scopes\.map/);
  assert.ok(
    devicePage.indexOf("approval.scopes.map") < devicePage.indexOf('action="/api/agent/oauth/device/authorize"'),
  );
  assert.doesNotMatch(devicePage, /<details/);
  assert.doesNotMatch(devicePage, /Allowed actions|Access and refresh tokens/);
  assert.match(devicePage, /Authorization approved/);
  assert.match(devicePage, /Authentication complete/);
  assert.match(devicePage, /Return to the same agent task\. RateLoop will show the connection after verification\./);
  assert.doesNotMatch(devicePage, /Agent connected/);
});
