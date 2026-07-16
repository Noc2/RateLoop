import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const providerSource = readFileSync(new URL("./RateLoopNotificationProvider.tsx", import.meta.url), "utf8");
const appProvidersSource = readFileSync(new URL("../../providers/AppProviders.tsx", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../../styles/globals.css", import.meta.url), "utf8");

test("the app mounts one shared legacy-style notification surface", () => {
  assert.match(appProvidersSource, /<RateLoopNotificationProvider>/);
  assert.match(providerSource, /fixed inset-x-0 top-4/);
  assert.match(providerSource, /rateloop-gradient-notification/);
  assert.match(providerSource, /aria-live="polite"/);
  assert.match(providerSource, /aria-label="Dismiss notification"/);
  assert.match(globalStyles, /\.rateloop-gradient-notification/);
  assert.match(globalStyles, /var\(--rateloop-orbit-gradient\) border-box/);
});

test("success, information, warning, and error notices share the same renderer", () => {
  for (const kind of ["success", "info", "warning", "error"]) {
    assert.match(providerSource, new RegExp(`${kind}: message => show\\("${kind}"`));
  }
  assert.match(providerSource, /role=\{notification\.kind === "error" \? "alert" : "status"\}/);
});
