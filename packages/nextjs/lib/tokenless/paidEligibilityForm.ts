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

export type Dac7FormPolicy = { mode: "all" | "countries"; countries: string[] };

/**
 * The server owns the DAC7 policy (TOKENLESS_DAC7_POLICY). The form must follow it: rendering
 * against a hardcoded EU list omits `dac7` for residents the server then rejects as
 * `dac7_required`, with no field on screen for them to fix it. The EU set below is only a
 * fallback for a response that predates the policy field.
 */
export function collectsDac7Details(value: string, policy?: Dac7FormPolicy | null) {
  const country = normalizedResidenceCountry(value);
  if (country === null) return false;
  if (!policy) return EU_DAC7_COUNTRIES.has(country);
  if (policy.mode === "all") return true;
  return policy.countries.includes(country);
}

export function buildPaidEligibilityFormPayload(input: {
  dac7Policy?: Dac7FormPolicy | null;
  form: PaidEligibilityFormValues;
  payoutAccount: string;
  providerState: string | null;
  reviewerSource: "customer_invited" | "rateloop_network";
  workspaceId: string;
}) {
  const declaredResidenceCountry = normalizedResidenceCountry(input.form.declaredResidenceCountry);
  if (!declaredResidenceCountry) throw new Error("Residence country is incomplete.");
  const collectDac7 = collectsDac7Details(declaredResidenceCountry, input.dac7Policy);
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
