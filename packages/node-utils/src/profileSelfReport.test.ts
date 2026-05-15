import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PROFILE_SELF_REPORT_LENGTH,
  aggregateProfileSelfReports,
  emptyProfileSelfReportAudienceContext,
  normalizeProfileSelfReport,
  parseProfileSelfReport,
  profileSelfReportHasValues,
  serializeProfileSelfReport,
} from "./profileSelfReport";

test("normalizeProfileSelfReport trims, dedupes, drops invalid values, and enforces item caps", () => {
  const normalized = normalizeProfileSelfReport({
    ageGroup: " 25-34 ",
    residenceCountry: " de ",
    nationalities: ["us", "DE", "US", "not-a-country", "FR", "BR"],
    languages: ["en", "EN", "de", "other", "fr", "pt", "ja"],
    roles: ["engineer", "founder", "engineer", "operator", "creator", "unknown"],
    expertise: ["ai", "crypto", "finance", "health", "gaming", "science"],
    ignored: "value",
  });

  assert.deepEqual(normalized, {
    v: 1,
    ageGroup: "25-34",
    residenceCountry: "DE",
    nationalities: ["US", "DE", "FR"],
    languages: ["en", "de", "other", "fr", "pt"],
    roles: ["engineer", "founder", "operator", "creator"],
    expertise: ["ai", "crypto", "finance", "health", "gaming"],
  });
});

test("parseProfileSelfReport returns null for empty, malformed, or value-less payloads", () => {
  assert.equal(parseProfileSelfReport(""), null);
  assert.equal(parseProfileSelfReport("{"), null);
  assert.equal(parseProfileSelfReport(JSON.stringify({ v: 1, ageGroup: "minor" })), null);
  assert.equal(profileSelfReportHasValues(normalizeProfileSelfReport({})), false);
});

test("serializeProfileSelfReport prunes input and respects the shared maximum length", () => {
  const serialized = serializeProfileSelfReport({
    ageGroup: "35-44",
    residenceCountry: "us",
    arbitraryHugeField: "x".repeat(MAX_PROFILE_SELF_REPORT_LENGTH * 2),
  });

  assert.equal(serialized, JSON.stringify({ v: 1, ageGroup: "35-44", residenceCountry: "US" }));
  assert.equal(serialized.length < MAX_PROFILE_SELF_REPORT_LENGTH, true);
  assert.deepEqual(parseProfileSelfReport(serialized), {
    v: 1,
    ageGroup: "35-44",
    residenceCountry: "US",
  });
});

test("emptyProfileSelfReportAudienceContext marks every revealed vote as missing", () => {
  assert.deepEqual(emptyProfileSelfReportAudienceContext(3), {
    fields: {
      ageGroup: [],
      expertise: [],
      languages: [],
      nationalities: [],
      residenceCountry: [],
      roles: [],
    },
    missingSelfReportCount: 3,
    note: "Audience context is public, self-reported, unverified, and not used for vote eligibility.",
    restrictedEligibility: false,
    selfReportedProfileCount: 0,
    source: "self_reported_public_profiles",
    totalRevealedVotes: 3,
    verified: false,
  });
});

test("aggregateProfileSelfReports counts up/down buckets and sorts deterministically", () => {
  const rows = [
    {
      isUp: true,
      selfReport: serializeProfileSelfReport({
        ageGroup: "25-34",
        residenceCountry: "US",
        languages: ["en", "de"],
        roles: ["engineer"],
        expertise: ["ai"],
      }),
    },
    {
      isUp: false,
      selfReport: serializeProfileSelfReport({
        ageGroup: "25-34",
        residenceCountry: "DE",
        nationalities: ["DE"],
        languages: ["en"],
        roles: ["founder"],
        expertise: ["crypto"],
      }),
    },
    {
      isUp: null,
      selfReport: serializeProfileSelfReport({
        ageGroup: "45-54",
        residenceCountry: "US",
        languages: ["fr"],
        roles: ["engineer"],
        expertise: ["ai"],
      }),
    },
    { isUp: true, selfReport: null },
  ];

  const context = aggregateProfileSelfReports(rows);

  assert.equal(context.totalRevealedVotes, 4);
  assert.equal(context.selfReportedProfileCount, 3);
  assert.equal(context.missingSelfReportCount, 1);
  assert.deepEqual(context.fields.ageGroup, [
    { value: "25-34", total: 2, up: 1, down: 1 },
    { value: "45-54", total: 1, up: 0, down: 0 },
  ]);
  assert.deepEqual(context.fields.languages, [
    { value: "en", total: 2, up: 1, down: 1 },
    { value: "de", total: 1, up: 1, down: 0 },
    { value: "fr", total: 1, up: 0, down: 0 },
  ]);
  assert.deepEqual(context.fields.residenceCountry, [
    { value: "US", total: 2, up: 1, down: 0 },
    { value: "DE", total: 1, up: 0, down: 1 },
  ]);
});
