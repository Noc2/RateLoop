import { reviewerAssignmentHref } from "../HumanAssuranceRaterClient";
import {
  canonicalReviewSearchParams,
  humanSectionHref,
  legacyHumanRouteHref,
  rateDestinationHref,
  rateRedirectHref,
} from "./humanNavigation";
import { humanAccountReturnTo, resolveHumanProfileSection } from "./humanProfileNavigation";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const focusSource = readFileSync(new URL("./ProfileSectionFocus.tsx", import.meta.url), "utf8");
const tabsSource = readFileSync(new URL("./HumanTabs.tsx", import.meta.url), "utf8");
const legacyPageSource = readFileSync(new URL("../../../app/[locale]/(app)/human/page.tsx", import.meta.url), "utf8");
const sectionPageSource = readFileSync(
  new URL("../../../app/[locale]/(app)/human/[section]/page.tsx", import.meta.url),
  "utf8",
);

test("profile deep links resolve only visible account sections", () => {
  assert.equal(resolveHumanProfileSection("paid-work"), "paid-work");
  assert.equal(resolveHumanProfileSection("forecast-integrity"), "forecast-integrity");
  assert.equal(resolveHumanProfileSection("unknown"), undefined);
  assert.equal(resolveHumanProfileSection(), undefined);
});

test("account sign-in preserves an allowed profile destination", () => {
  assert.equal(humanAccountReturnTo({ tab: "inbox" }), "/human/inbox");
  assert.equal(humanAccountReturnTo({ tab: "settings" }), "/human/settings");
  assert.equal(
    humanAccountReturnTo({
      eligibility: "provider-return",
      section: "paid-work",
      tab: "profile",
    }),
    "/human/profile?section=paid-work&eligibility=provider-return",
  );
  assert.equal(
    humanAccountReturnTo({ eligibility: "unexpected", section: "earnings", tab: "profile" }),
    "/human/profile?section=earnings",
  );
});

test("human route compatibility preserves history, profile, and invitation state without browsing filters", () => {
  assert.equal(
    legacyHumanRouteHref({ q: "safety", scope: "private", tab: "discover", view: "history" }),
    "/human/history",
  );
  assert.equal(
    legacyHumanRouteHref({ eligibility: "provider-return", section: "paid-work", tab: "profile" }),
    "/human/profile?eligibility=provider-return&section=paid-work",
  );
  assert.equal(legacyHumanRouteHref({ invite: "1", tab: "discover" }), "/human/review?invite=1");
  assert.equal(legacyHumanRouteHref({ tab: "earnings" }), "/human/profile?section=earnings");
  assert.equal(
    humanSectionHref("profile", new URLSearchParams("section=forecast-integrity")),
    "/human/profile?section=forecast-integrity",
  );
});

test("all review entry points share one canonical query contract", () => {
  const termsHash = `sha256:${"a".repeat(64)}`;
  const noisy = new URLSearchParams(
    `q=safety&scope=private&source=inbox&invite=1&invite=ignored&assignment=haas_assignment_old&terms=${encodeURIComponent(
      termsHash,
    )}`,
  );
  assert.equal(
    canonicalReviewSearchParams(noisy).toString(),
    `assignment=haas_assignment_old&terms=${encodeURIComponent(termsHash)}&invite=1`,
  );
  assert.equal(
    humanSectionHref("discover", noisy),
    `/human/review?assignment=haas_assignment_old&terms=${encodeURIComponent(termsHash)}&invite=1`,
  );
  assert.equal(
    rateRedirectHref({
      q: "safety",
      scope: "private",
      source: "inbox",
      invite: ["1", "ignored"],
      assignment: "haas_assignment_old",
      terms: termsHash,
    }),
    `/human/review?assignment=haas_assignment_old&terms=${encodeURIComponent(termsHash)}&invite=1`,
  );
  assert.equal(
    reviewerAssignmentHref(
      `https://rateloop-tokenless.vercel.app/human/review?${noisy.toString()}#active`,
      "haas_assignment_new",
      termsHash,
    ),
    `/human/review?assignment=haas_assignment_new&terms=${encodeURIComponent(termsHash)}&invite=1#active`,
  );
});

test("human sections use normal route links and canonicalize legacy tab URLs", () => {
  assert.match(tabsSource, /href=\{humanSectionHref\(/);
  assert.match(tabsSource, /aria-current=\{active === tab \? "page" : undefined\}/);
  assert.doesNotMatch(tabsSource, /role="tablist"|role="tab"|aria-selected=|tabIndex=/);
  assert.match(legacyPageSource, /redirect\(\{ href: legacyHumanRouteHref\(requestedSearchParams\), locale \}\)/);
  assert.match(sectionPageSource, /section !== humanSectionForNavigation\(navigation\)/);
  assert.match(sectionPageSource, /requestedSearchParams\.assignment/);
  assert.match(sectionPageSource, /requestedSearchParams\.view === "history"/);
});

test("profile deep links scroll the requested section into view", () => {
  assert.match(focusSource, /document\.getElementById\(section\)/);
  assert.match(focusSource, /target\.scrollIntoView\(\{ block: "start" \}\)/);
});

test("the legacy /rate alias sends visitors without reviewer context to the marketing root", () => {
  const ratePageSource = readFileSync(new URL("../../../app/[locale]/(app)/rate/page.tsx", import.meta.url), "utf8");
  assert.match(ratePageSource, /rateDestinationHref\(requestedParams\)/);
  assert.doesNotMatch(ratePageSource, /rateRedirectHref/);

  assert.equal(rateDestinationHref({}), "/");
  assert.equal(rateDestinationHref({ q: "safety", scope: "private", source: "inbox" }), "/");
});

test("the legacy /rate alias still forwards an invited reviewer to their assignment", () => {
  const termsHash = `sha256:${"a".repeat(64)}`;
  assert.equal(
    rateDestinationHref({ assignment: "haas_assignment_old", terms: termsHash, invite: "1" }),
    `/human/review?assignment=haas_assignment_old&terms=${encodeURIComponent(termsHash)}&invite=1`,
  );
  assert.equal(rateDestinationHref({ invite: "1" }), "/human/review?invite=1");
});
