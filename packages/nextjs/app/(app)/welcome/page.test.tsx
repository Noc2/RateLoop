import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const actions = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");

test("the welcome route is server-authenticated and renders two non-binding starting paths", () => {
  assert.match(page, /findAuthSession/);
  assert.match(page, /redirect\("\/sign-in\?returnTo=%2Fwelcome"\)/);
  assert.match(page, /getPrincipalWelcomeState/);
  assert.match(page, /if \(!welcome\.required\) redirect\("\/"\)/);
  assert.match(page, /Review AI work/);
  assert.match(page, /Connect an agent/);
  assert.match(page, /You can do both at any time/);
  assert.match(page, /choice="review"/);
  assert.match(page, /choice="invitation"/);
  assert.match(page, /choice="agent"/);
});

test("the welcome action records completion before redirecting to an allowlisted destination", () => {
  assert.match(actions, /parseWelcomeChoice\(formData\.get\("choice"\)\)/);
  assert.match(actions, /findAuthSession/);
  assert.match(actions, /await completePrincipalWelcome\(session\.principalId\)/);
  assert.ok(actions.indexOf("completePrincipalWelcome") < actions.lastIndexOf("redirect(welcomeDestination(choice))"));
});
