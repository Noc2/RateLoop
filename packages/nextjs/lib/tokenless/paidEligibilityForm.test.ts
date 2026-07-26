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
