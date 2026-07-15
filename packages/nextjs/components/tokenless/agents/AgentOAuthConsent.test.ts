import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authorizePage = readFileSync(
  new URL("../../../app/(public)/agent/oauth/authorize/page.tsx", import.meta.url),
  "utf8",
);
const devicePage = readFileSync(new URL("../../../app/(public)/agent/oauth/device/page.tsx", import.meta.url), "utf8");
const consentForm = readFileSync(new URL("./AgentOAuthConsentForm.tsx", import.meta.url), "utf8");

test("OAuth consent leads with the decision while retaining exact scopes as optional detail", () => {
  assert.match(authorizePage, /Allow \$\{authorization\.clientName\}/);
  assert.match(authorizePage, /Connection details/);
  assert.match(authorizePage, /authorization\.scopes\.map/);
  assert.doesNotMatch(authorizePage, /Allowed actions|Access and refresh tokens/);
  assert.match(consentForm, /name="decision" value="approve"/);
  assert.match(consentForm, /name="decision" value="deny"/);
});

test("device consent uses the same concise grant and keeps code and scopes available", () => {
  assert.match(devicePage, /Allow \$\{approval\.clientName\}/);
  assert.match(devicePage, /Connection details/);
  assert.match(devicePage, /Code \{approval\.userCode\}/);
  assert.match(devicePage, /approval\.scopes\.map/);
  assert.doesNotMatch(devicePage, /Allowed actions|Access and refresh tokens/);
});
