const EU_DAC7_COUNTRIES = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
]);

export type PaidEligibilityFormValues = {
  declaredResidenceCountry: string;
  taxResidenceCountry: string;
  fullName: string;
  birthDate: string;
  streetAddress: string;
  city: string;
  postalCode: string;
  taxIdentificationKind: "tin" | "place_of_birth";
  tin: string;
  placeOfBirthCity: string;
  placeOfBirthCountry: string;
  sanctionsConsent: boolean;
};

export function normalizedResidenceCountry(value: string) {
  const country = value.trim().toUpperCase();
  return /^[A-Z]{2}$/u.test(country) ? country : null;
}

export function collectsDac7Details(value: string) {
  const country = normalizedResidenceCountry(value);
  return country !== null && EU_DAC7_COUNTRIES.has(country);
}

export function buildPaidEligibilityFormPayload(input: {
  form: PaidEligibilityFormValues;
  payoutAccount: string;
  providerState: string | null;
  reviewerSource: "customer_invited" | "rateloop_network";
  workspaceId: string;
}) {
  const declaredResidenceCountry = normalizedResidenceCountry(input.form.declaredResidenceCountry);
  if (!declaredResidenceCountry) throw new Error("Residence country is incomplete.");
  const collectDac7 = collectsDac7Details(declaredResidenceCountry);
  const taxResidenceCountry = collectDac7
    ? normalizedResidenceCountry(input.form.taxResidenceCountry)
    : declaredResidenceCountry;
  if (!taxResidenceCountry) throw new Error("Tax residence country is incomplete.");
  const screeningSubject = {
    fullName: input.form.fullName,
    birthDate: input.form.birthDate,
  };
  return {
    providerState: input.providerState,
    reviewerSource: input.reviewerSource,
    ...(input.reviewerSource === "customer_invited" ? { workspaceId: input.workspaceId.trim() } : {}),
    sanctionsConsent: input.form.sanctionsConsent,
    declaredResidenceCountry,
    taxResidenceCountry,
    payoutAccount: input.payoutAccount,
    ...(collectDac7
      ? {
          dac7: {
            ...screeningSubject,
            streetAddress: input.form.streetAddress,
            city: input.form.city,
            postalCode: input.form.postalCode,
            taxIdentification:
              input.form.taxIdentificationKind === "tin"
                ? { kind: "tin" as const, value: input.form.tin }
                : {
                    kind: "place_of_birth" as const,
                    city: input.form.placeOfBirthCity,
                    country: input.form.placeOfBirthCountry.toUpperCase(),
                  },
          },
        }
      : {}),
    screeningSubject,
  };
}
