import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./NotificationSettingsPanel.tsx", import.meta.url), "utf8");

test("account and security notifications cannot be disabled", () => {
  assert.match(source, /if \(key === "accountSecurity"\) return/);
  assert.match(source, /disabled=\{savingPreferences \|\| option\.key === "accountSecurity"\}/);
  assert.match(source, /Required for important sign-in and account changes/);
});
