import {
  assertPaidEligibilityGeoblock,
  evaluatePaidEligibilityRisk,
  localeCountryFromAcceptLanguage,
} from "./paidEligibilityRisk";
import { TokenlessServiceError } from "./server";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const originalFetch = globalThis.fetch;
const originalEnvironment = {
  id: process.env.TOKENLESS_WALLET_SCREENING_PROVIDER_ID,
  secret: process.env.TOKENLESS_WALLET_SCREENING_PROVIDER_SECRET,
  url: process.env.TOKENLESS_WALLET_SCREENING_PROVIDER_URL,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries({
    TOKENLESS_WALLET_SCREENING_PROVIDER_ID: originalEnvironment.id,
    TOKENLESS_WALLET_SCREENING_PROVIDER_SECRET: originalEnvironment.secret,
    TOKENLESS_WALLET_SCREENING_PROVIDER_URL: originalEnvironment.url,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("server-derived geoblocks fail before paid eligibility in blocked or unknown locations", () => {
  for (const context of [
    { edgeCountry: null, edgeRegion: null, localeCountry: "DE" },
    { edgeCountry: "RU", edgeRegion: null, localeCountry: "RU" },
    { edgeCountry: "UA", edgeRegion: "43", localeCountry: "UA" },
  ]) {
    assert.throws(
      () => assertPaidEligibilityGeoblock(context),
      (error: unknown) =>
        error instanceof TokenlessServiceError &&
        (error.code === "paid_geolocation_unavailable" || error.code === "paid_location_blocked"),
    );
  }
  assert.deepEqual(assertPaidEligibilityGeoblock({ edgeCountry: "de", edgeRegion: "BE", localeCountry: "de" }), {
    edgeCountry: "DE",
    edgeRegion: "BE",
    localeCountry: "DE",
  });
});

test("wallet screening and held locale data produce a persisted-review result without raw wallet evidence", async () => {
  process.env.TOKENLESS_WALLET_SCREENING_PROVIDER_ID = "screening-test:v1";
  process.env.TOKENLESS_WALLET_SCREENING_PROVIDER_URL = "https://screening.example.test/check";
  process.env.TOKENLESS_WALLET_SCREENING_PROVIDER_SECRET = "s".repeat(32);
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.method, "POST");
    assert.match(String(init?.headers && JSON.stringify(init.headers)), /Bearer/);
    return new Response(
      JSON.stringify({
        status: "review",
        reference: "provider-private-reference",
        listSnapshotHash: `sha256:${"a".repeat(64)}`,
        expiresAt: "2026-08-01T00:00:00.000Z",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const result = await evaluatePaidEligibilityRisk({
    payoutAccount: "0x1111111111111111111111111111111111111111",
    declaredResidenceCountry: "DE",
    taxResidenceCountry: "DE",
    requestContext: { edgeCountry: "FR", edgeRegion: "IDF", localeCountry: "NL" },
    now: new Date("2026-07-26T00:00:00.000Z"),
  });
  assert.equal(result.plausibilityStatus, "review");
  assert.deepEqual(result.plausibilityReasonCodes, ["edge_residence_mismatch", "locale_residence_mismatch"]);
  assert.equal(result.walletScreeningStatus, "review");
  assert.match(result.walletReferenceHash, /^sha256:[0-9a-f]{64}$/u);
  assert.match(result.walletScreeningReferenceHash, /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(result.walletScreeningReferenceHash, "provider-private-reference");
  assert.equal(localeCountryFromAcceptLanguage("de-DE,de;q=0.9"), "DE");
});
