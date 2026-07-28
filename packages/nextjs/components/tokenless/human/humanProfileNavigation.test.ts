import { humanAccountReturnTo, resolveHumanProfileSection } from "./humanProfileNavigation";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const focusSource = readFileSync(new URL("./ProfileSectionFocus.tsx", import.meta.url), "utf8");

test("profile deep links resolve only visible account sections", () => {
  assert.equal(resolveHumanProfileSection("paid-work"), "paid-work");
  assert.equal(resolveHumanProfileSection("forecast-integrity"), "forecast-integrity");
  assert.equal(resolveHumanProfileSection("unknown"), undefined);
  assert.equal(resolveHumanProfileSection(), undefined);
});

test("account sign-in preserves an allowed profile destination", () => {
  assert.equal(humanAccountReturnTo({ tab: "inbox" }), "/human?tab=inbox");
  assert.equal(humanAccountReturnTo({ tab: "settings" }), "/human?tab=settings");
  assert.equal(
    humanAccountReturnTo({
      eligibility: "provider-return",
      section: "paid-work",
      tab: "profile",
    }),
    "/human?tab=profile&section=paid-work&eligibility=provider-return",
  );
  assert.equal(
    humanAccountReturnTo({ eligibility: "unexpected", section: "earnings", tab: "profile" }),
    "/human?tab=profile&section=earnings",
  );
});

test("profile deep links scroll the requested section into view", () => {
  assert.match(focusSource, /document\.getElementById\(section\)/);
  assert.match(focusSource, /target\.scrollIntoView\(\{ block: "start" \}\)/);
});
