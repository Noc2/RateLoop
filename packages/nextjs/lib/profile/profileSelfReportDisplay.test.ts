import { RATER_TYPE, normalizeProfileSelfReport } from "@rateloop/node-utils/profileSelfReport";
import assert from "node:assert/strict";
import test from "node:test";
import {
  PROFILE_COUNTRY_OPTIONS,
  formatProfileCountryCode,
  getProfileSelfReportDisplayGroups,
} from "~~/lib/profile/profileSelfReportDisplay";

test("profile country options include a complete fallback country set", () => {
  assert.ok(PROFILE_COUNTRY_OPTIONS.length > 200);
  assert.ok(PROFILE_COUNTRY_OPTIONS.some(option => option.value === "DE" && option.label === "Germany"));
  assert.ok(PROFILE_COUNTRY_OPTIONS.some(option => option.value === "US" && option.label === "United States"));
  assert.equal(
    PROFILE_COUNTRY_OPTIONS.some(option => option.value === "EU"),
    false,
  );
});

test("profile country labels stay in English regardless of viewer locale", () => {
  assert.equal(formatProfileCountryCode("DE"), "Germany");
  assert.equal(formatProfileCountryCode("US"), "United States");
});

test("profile display groups omit language context", () => {
  const groups = getProfileSelfReportDisplayGroups(
    normalizeProfileSelfReport({
      ai: { languages: ["de"] },
      hybrid: { languages: ["fr"] },
      languages: ["en"],
      raterType: RATER_TYPE.Human,
      roles: ["engineer"],
      team: { languages: ["es"] },
    }),
  );

  assert.equal(
    groups.some(group => group.label.toLowerCase().includes("language")),
    false,
  );
  assert.ok(groups.some(group => group.label === "Roles"));
});
