import {
  type PaidEligibilityFormValues,
  buildPaidEligibilityFormPayload,
  collectsDac7Details,
  normalizedResidenceCountry,
} from "./paidEligibilityForm";
import assert from "node:assert/strict";
import test from "node:test";

const base: PaidEligibilityFormValues = {
  declaredResidenceCountry: "DE",
  taxResidenceCountry: "FR",
  fullName: "Ada Rater",
  birthDate: "1990-01-01",
  streetAddress: "Example Street 1",
  city: "Berlin",
  postalCode: "10115",
  taxIdentificationKind: "place_of_birth",
  tin: "",
  placeOfBirthCity: "London",
  placeOfBirthCountry: "gb",
  sanctionsConsent: true,
};

test("residence is answered first and only EU residence includes the full DAC7 payload", () => {
  assert.equal(normalizedResidenceCountry("d"), null);
  assert.equal(collectsDac7Details("DE"), true);
  assert.equal(collectsDac7Details("US"), false);

  const eu = buildPaidEligibilityFormPayload({
    form: base,
    payoutAccount: "0x1111111111111111111111111111111111111111",
    providerState: "state",
    reviewerSource: "rateloop_network",
    workspaceId: "",
  });
  assert.deepEqual(eu.dac7?.taxIdentification, {
    kind: "place_of_birth",
    city: "London",
    country: "GB",
  });
  assert.equal(eu.taxResidenceCountry, "FR");

  const nonEu = buildPaidEligibilityFormPayload({
    form: { ...base, declaredResidenceCountry: "US" },
    payoutAccount: "0x1111111111111111111111111111111111111111",
    providerState: null,
    reviewerSource: "customer_invited",
    workspaceId: " workspace_1 ",
  });
  assert.equal("dac7" in nonEu, false);
  assert.equal(nonEu.taxResidenceCountry, "US");
  assert.deepEqual(nonEu.screeningSubject, { fullName: "Ada Rater", birthDate: "1990-01-01" });
  assert.equal(nonEu.workspaceId, "workspace_1");
});

test("the server DAC7 policy decides collection, so a non-EU resident is not left unable to comply", () => {
  // TOKENLESS_DAC7_POLICY=all. Under a hardcoded EU list the form omits `dac7` and never renders
  // the fields, so the server's `dac7_required` rejection is unfixable by the person submitting.
  const allPolicy = { mode: "all" as const, countries: [] };
  assert.equal(collectsDac7Details("US", allPolicy), true);
  const collected = buildPaidEligibilityFormPayload({
    dac7Policy: allPolicy,
    form: { ...base, declaredResidenceCountry: "US", taxResidenceCountry: "US" },
    payoutAccount: "0x1111111111111111111111111111111111111111",
    providerState: "state",
    reviewerSource: "rateloop_network",
    workspaceId: "",
  });
  assert.equal("dac7" in collected, true);
  assert.equal(collected.dac7?.streetAddress, base.streetAddress);

  // TOKENLESS_DAC7_POLICY=configured with a non-EU entry.
  const configured = { mode: "countries" as const, countries: ["GB", "NO"] };
  assert.equal(collectsDac7Details("NO", configured), true);
  assert.equal(collectsDac7Details("DE", configured), false);

  // An EU policy still behaves as before, and an absent policy falls back to the EU set.
  const euPolicy = { mode: "countries" as const, countries: ["DE", "FR"] };
  assert.equal(collectsDac7Details("FR", euPolicy), true);
  assert.equal(collectsDac7Details("US", euPolicy), false);
  assert.equal(collectsDac7Details("FR", null), true);
  assert.equal(collectsDac7Details("US", null), false);
});
