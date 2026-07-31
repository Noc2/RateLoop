import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authorizePage = readFileSync(
  new URL("../../../app/[locale]/(public)/agent/oauth/authorize/page.tsx", import.meta.url),
  "utf8",
);
const devicePage = readFileSync(
  new URL("../../../app/[locale]/(public)/agent/oauth/device/page.tsx", import.meta.url),
  "utf8",
);
const consentForm = readFileSync(new URL("./AgentOAuthConsentForm.tsx", import.meta.url), "utf8");
const authorizeRoute = readFileSync(
  new URL("../../../app/api/agent/oauth/authorize/route.ts", import.meta.url),
  "utf8",
);

test("OAuth consent shows exact scopes before the decision", () => {
  assert.match(authorizePage, /getTranslations\(\{ locale, namespace: "agents\.oauth" \}\)/);
  assert.match(authorizePage, /t\("allowClient", \{ client: authorization\.clientName \}\)/);
  assert.match(authorizePage, /t\("thisAgentCan"\)/);
  assert.match(authorizePage, /authorization\.scopes\.map/);
  assert.ok(authorizePage.indexOf("authorization.scopes.map") < authorizePage.indexOf("<AgentOAuthConsentForm"));
  assert.doesNotMatch(authorizePage, /<details/);
  assert.doesNotMatch(authorizePage, /Allowed actions|Access and refresh tokens/);
  assert.match(consentForm, /name="decision" value="approve"/);
  assert.match(consentForm, /name="decision" value="deny"/);
});

test("invalid OAuth and device requests provide plain-language recovery without raw protocol errors", () => {
  assert.match(authorizePage, /t\("invalidRequestDescription"\)/);
  assert.match(authorizePage, /t\("restartConnection"\)/);
  assert.doesNotMatch(authorizePage, /oauth\.message|client_id is required/);
  assert.match(devicePage, /t\("invalidCode"\)/);
  assert.match(devicePage, /t\("checkCodeFailed"\)/);
  assert.doesNotMatch(devicePage, /error\.message/);
});

test("loopback OAuth completion stays branded while preserving a no-JavaScript redirect", () => {
  assert.match(consentForm, /x-rateloop-oauth-callback-relay/);
  assert.match(consentForm, /useAgentTranslations\("oauth"\)/);
  assert.match(consentForm, /t\("approved"\)/);
  assert.match(consentForm, /t\("complete"\)/);
  assert.match(consentForm, /t\("returnTask"\)/);
  assert.match(consentForm, /t\("authorizationCanceled"\)/);
  assert.doesNotMatch(consentForm, /Agent connected/);
  assert.match(consentForm, /sandbox=""/);
  assert.match(consentForm, /referrerPolicy="no-referrer"/);
  assert.match(consentForm, /window\.close\(\)/);
  assert.match(consentForm, /OAUTH_WORKSPACE_RETURN = "\/agents\/connections\?returning=oauth"/);
  assert.match(consentForm, /router\.replace\(OAUTH_WORKSPACE_RETURN\)/);
  assert.match(consentForm, /action="\/api\/agent\/oauth\/authorize"[\s\S]*method="post"/);
  assert.match(authorizeRoute, /BROWSER_RELAY_HEADER/);
  assert.match(authorizeRoute, /outcome \? \{ outcome \} : \{\}/);
  assert.match(authorizeRoute, /NextResponse\.redirect\(destination, 303\)/);
});

test("device consent shows its code and scopes before the decision", () => {
  assert.match(devicePage, /t\("allowClient", \{ client: approval\.clientName \}\)/);
  assert.match(devicePage, /t\("verificationCode"\)/);
  assert.match(devicePage, /\{approval\.userCode\}/);
  assert.match(devicePage, /t\("thisAgentCan"\)/);
  assert.match(devicePage, /approval\.scopes\.map/);
  assert.ok(
    devicePage.indexOf("approval.scopes.map") < devicePage.indexOf('action="/api/agent/oauth/device/authorize"'),
  );
  assert.doesNotMatch(devicePage, /<details/);
  assert.doesNotMatch(devicePage, /Allowed actions|Access and refresh tokens/);
  assert.match(devicePage, /title: t\("approved"\)/);
  assert.match(devicePage, /title: t\("complete"\)/);
  assert.match(devicePage, /message: t\("approvedMessage"\)/);
  assert.doesNotMatch(devicePage, /Agent connected/);
});
