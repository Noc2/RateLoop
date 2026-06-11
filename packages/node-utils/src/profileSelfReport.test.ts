import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PROFILE_SELF_REPORT_LENGTH,
  PROFILE_SELF_REPORT_NOTICE,
  RATER_TYPE,
  TargetAudienceValidationError,
  aggregateProfileSelfReports,
  buildTargetAudienceMatchReport,
  emptyProfileSelfReportAudienceContext,
  formatRaterTypeName,
  getProfileSelfReportTaxonomy,
  normalizeTargetAudience,
  normalizeProfileSelfReport,
  normalizeRaterType,
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
    v: 2,
    ageGroup: "25-34",
    residenceCountry: "DE",
    nationalities: ["US", "DE", "FR"],
    languages: ["en", "de", "other", "fr", "pt"],
    roles: ["engineer", "founder", "operator", "creator"],
    expertise: ["ai", "crypto", "finance", "health", "gaming"],
  });
});

test("normalizeProfileSelfReport keeps rater type and type-specific context", () => {
  assert.deepEqual(
    normalizeProfileSelfReport({
      raterType: "ai",
      ai: {
        modelProvider: "openai",
        modelFamily: " GPT-5 ",
        modelVersion: " preview ",
        agentFramework: "openai-agents",
        autonomy: "tool-using",
        languages: ["en", "de", "bad"],
        expertise: ["ai", "science", "unknown"],
      },
      team: {
        teamType: "company",
        teamSize: "11-50",
        country: "de",
        website: "https://example.com",
      },
      hybrid: {
        oversight: "human-in-the-loop",
        modelProvider: "anthropic",
        modelFamily: "Claude",
      },
    }),
    {
      v: 2,
      raterType: RATER_TYPE.AI,
      ai: {
        modelProvider: "openai",
        modelFamily: "GPT-5",
        modelVersion: "preview",
        agentFramework: "openai-agents",
        autonomy: "tool-using",
        languages: ["en", "de"],
        expertise: ["ai", "science"],
      },
      team: {
        teamType: "company",
        teamSize: "11-50",
        country: "DE",
        website: "https://example.com",
      },
      hybrid: {
        oversight: "human-in-the-loop",
        modelProvider: "anthropic",
        modelFamily: "Claude",
      },
    },
  );
});

test("rater type helpers normalize names, numbers, and invalid values", () => {
  assert.equal(normalizeRaterType("Human"), RATER_TYPE.Human);
  assert.equal(normalizeRaterType("2"), RATER_TYPE.AI);
  assert.equal(normalizeRaterType(3), RATER_TYPE.Team);
  assert.equal(normalizeRaterType("bogus"), RATER_TYPE.Unknown);
  assert.equal(formatRaterTypeName(RATER_TYPE.Hybrid), "Hybrid");
  assert.equal(formatRaterTypeName(42), "Unknown");
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

  assert.equal(serialized, JSON.stringify({ ageGroup: "35-44", residenceCountry: "US", v: 2 }));
  assert.equal(serialized.length < MAX_PROFILE_SELF_REPORT_LENGTH, true);
  assert.deepEqual(parseProfileSelfReport(serialized), {
    v: 2,
    ageGroup: "35-44",
    residenceCountry: "US",
  });
});

test("serializeProfileSelfReport uses stable key order", () => {
  assert.equal(
    serializeProfileSelfReport({
      roles: ["engineer"],
      languages: ["de", "en"],
      ageGroup: "25-34",
    }),
    serializeProfileSelfReport({
      ageGroup: "25-34",
      languages: ["de", "en"],
      roles: ["engineer"],
    }),
  );
});

test("normalizeTargetAudience canonicalizes valid structured audience hints", () => {
  assert.deepEqual(
    normalizeTargetAudience({
      ageGroups: ["25-34"],
      countries: ["de", "US"],
      languages: ["de", "en", "de"],
      nationalities: ["fr"],
      roles: ["engineer"],
      expertise: ["ai"],
      ai: {
        modelProviders: ["openai"],
        agentFrameworks: ["openai-agents"],
        autonomy: ["tool-using"],
        languages: ["en"],
      },
      team: {
        countries: ["nl"],
        types: ["research-lab"],
        sizes: ["11-50"],
      },
      hybrid: {
        oversight: ["human-in-the-loop"],
        modelProviders: ["anthropic"],
      },
    }),
    {
      ageGroups: ["25-34"],
      countries: ["DE", "US"],
      languages: ["de", "en"],
      nationalities: ["FR"],
      roles: ["engineer"],
      expertise: ["ai"],
      ai: {
        modelProviders: ["openai"],
        agentFrameworks: ["openai-agents"],
        autonomy: ["tool-using"],
        languages: ["en"],
      },
      team: {
        countries: ["NL"],
        types: ["research-lab"],
        sizes: ["11-50"],
      },
      hybrid: {
        oversight: ["human-in-the-loop"],
        modelProviders: ["anthropic"],
      },
    },
  );
});

test("normalizeTargetAudience rejects invalid values with canonical suggestions", () => {
  assert.throws(
    () => normalizeTargetAudience({ roles: ["developer"] }),
    (error: unknown) =>
      error instanceof TargetAudienceValidationError &&
      error.issues[0]?.field === "targetAudience.roles" &&
      error.issues[0]?.suggestion === "engineer" &&
      /developer/.test(error.message),
  );
});

test("getProfileSelfReportTaxonomy exposes target-audience vocabularies", () => {
  const taxonomy = getProfileSelfReportTaxonomy();
  assert.equal(taxonomy.caveat, "unverified_self_report");
  assert.ok(taxonomy.targetAudience.roles.includes("engineer"));
  assert.ok(taxonomy.targetAudience.languages.includes("de"));
  assert.ok(taxonomy.targetAudience.ai.modelProviders.includes("openai"));
});

test("buildTargetAudienceMatchReport compares requested audience to revealed cohort buckets", () => {
  const audienceContext = aggregateProfileSelfReports([
    {
      isUp: true,
      selfReport: serializeProfileSelfReport({
        languages: ["de", "en"],
        residenceCountry: "DE",
        roles: ["engineer"],
      }),
    },
    {
      isUp: false,
      selfReport: serializeProfileSelfReport({
        languages: ["fr"],
        residenceCountry: "FR",
        roles: ["operator"],
      }),
    },
    { isUp: true, selfReport: null },
  ]);

  const report = buildTargetAudienceMatchReport(
    {
      countries: ["DE"],
      languages: ["de"],
      roles: ["engineer"],
    },
    audienceContext,
  );

  assert.equal(report?.caveat, "unverified_self_report");
  assert.equal(report?.verified, false);
  assert.deepEqual(
    report?.perDimension.map(match => ({
      dimension: match.dimension,
      matchShare: match.matchShare,
      matchedCount: match.matchedCount,
      requested: match.requested,
    })),
    [
      { dimension: "countries", matchShare: 0.5, matchedCount: 1, requested: ["DE"] },
      { dimension: "languages", matchShare: 0.5, matchedCount: 1, requested: ["de"] },
      { dimension: "roles", matchShare: 0.5, matchedCount: 1, requested: ["engineer"] },
    ],
  );
});

test("emptyProfileSelfReportAudienceContext marks every revealed vote as missing", () => {
  assert.deepEqual(emptyProfileSelfReportAudienceContext(3), {
    fields: {
      ageGroup: [],
      aiAgentFramework: [],
      aiAutonomy: [],
      aiExpertise: [],
      aiLanguages: [],
      aiModelProvider: [],
      expertise: [],
      hybridExpertise: [],
      hybridLanguages: [],
      hybridModelProvider: [],
      hybridOversight: [],
      languages: [],
      nationalities: [],
      residenceCountry: [],
      roles: [],
      teamCountry: [],
      teamExpertise: [],
      teamLanguages: [],
      teamSize: [],
      teamType: [],
    },
    missingSelfReportCount: 3,
    note: PROFILE_SELF_REPORT_NOTICE,
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
        ai: {
          modelProvider: "openai",
          agentFramework: "openai-agents",
          autonomy: "tool-using",
          languages: ["de"],
          expertise: ["ai"],
        },
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
        team: {
          teamType: "research-lab",
          teamSize: "11-50",
          country: "DE",
          languages: ["en"],
          expertise: ["science"],
        },
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
        hybrid: {
          oversight: "human-in-the-loop",
          modelProvider: "anthropic",
          languages: ["fr"],
          expertise: ["health"],
        },
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
  assert.deepEqual(context.fields.nationalities, [{ value: "DE", total: 1, up: 0, down: 1 }]);
  assert.deepEqual(context.fields.aiModelProvider, [{ value: "openai", total: 1, up: 1, down: 0 }]);
  assert.deepEqual(context.fields.aiLanguages, [{ value: "de", total: 1, up: 1, down: 0 }]);
  assert.deepEqual(context.fields.teamType, [{ value: "research-lab", total: 1, up: 0, down: 1 }]);
  assert.deepEqual(context.fields.teamCountry, [{ value: "DE", total: 1, up: 0, down: 1 }]);
  assert.deepEqual(context.fields.hybridOversight, [
    { value: "human-in-the-loop", total: 1, up: 0, down: 0 },
  ]);
  assert.deepEqual(context.fields.hybridModelProvider, [{ value: "anthropic", total: 1, up: 0, down: 0 }]);
});
