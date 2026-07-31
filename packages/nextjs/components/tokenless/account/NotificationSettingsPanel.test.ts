import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = [
  readFileSync(new URL("./NotificationSettingsPanel.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../../../messages/en/account.json", import.meta.url), "utf8"),
].join("\n");

test("account and security notifications cannot be disabled", () => {
  assert.match(source, /if \(key === "accountSecurity"\) return/);
  assert.match(source, /disabled=\{savingPreferences \|\| option\.key === "accountSecurity"\}/);
  assert.match(source, /Always on for important sign-in and account changes/);
});

test("workspace and payment choices appear only when they apply", () => {
  assert.match(source, /key: "oversightAlerts"/);
  assert.match(source, /oversightAlerts: false/);
  assert.match(source, /option\.group !== "payments" \|\| capabilities\.hasPaidActivity/);
  assert.match(source, /option\.group !== "workspace" \|\| capabilities\.hasWorkspace/);
});

test("email availability is described without exposing the delivery vendor", () => {
  assert.match(source, /Email notifications unavailable/);
  assert.match(source, /Email notifications are unavailable right now/);
  assert.doesNotMatch(source, /Resend/);
  assert.doesNotMatch(source, /not configured on this deployment/);
});
