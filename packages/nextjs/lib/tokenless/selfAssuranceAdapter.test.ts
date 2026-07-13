import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSelfDocumentConfiguration,
  selfDocumentAdapterStatus,
  selfDocumentConfigurationHash,
  verifySelfDocumentPredicates,
} from "~~/lib/tokenless/selfAssuranceAdapter";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const ENABLED_ENV = {
  TOKENLESS_SELF_ASSURANCE_ENABLED: "true",
  TOKENLESS_SELF_PROVIDER_ACCESS_APPROVED: "true",
  TOKENLESS_SELF_DPA_APPROVED: "true",
  TOKENLESS_SELF_CONVERSION_GATE_APPROVED: "true",
  TOKENLESS_SELF_ERROR_HANDLING_GATE_APPROVED: "true",
};

const CONFIGURATION = {
  minimumAge: 18,
  allowedDocumentIssuingCountries: ["DE", "FR"],
  allowedNationalities: ["DE"],
};

test("Self document adapter remains disabled until every release gate passes", async () => {
  assert.deepEqual(selfDocumentAdapterStatus({}), {
    version: "rateloop-self-document-v0-disabled",
    enabled: false,
    missingGates: ["conversionApproved", "dataProcessingApproved", "errorHandlingApproved", "providerAccessApproved"],
    capabilityBoundary: ["document_holder", "minimum_age", "issuing_country", "nationality"],
    limitationCodes: ["does_not_replace_world_unique_human", "cross_provider_deduplication_unsolved"],
  });
  await assert.rejects(
    () =>
      verifySelfDocumentPredicates({
        requestedConfiguration: CONFIGURATION,
        proof: {},
        verifier: { verify: async () => assert.fail("disabled adapter must not call the verifier") },
        env: { TOKENLESS_SELF_ASSURANCE_ENABLED: "true" },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "self_provider_disabled",
  );
});

test("Self configuration comparison is normalized and exact", async () => {
  assert.deepEqual(
    normalizeSelfDocumentConfiguration({ ...CONFIGURATION, allowedDocumentIssuingCountries: ["fr", "DE", "FR"] }),
    CONFIGURATION,
  );
  assert.equal(
    selfDocumentConfigurationHash(CONFIGURATION),
    selfDocumentConfigurationHash({ ...CONFIGURATION, allowedDocumentIssuingCountries: ["FR", "DE"] }),
  );
  await assert.rejects(
    () =>
      verifySelfDocumentPredicates({
        requestedConfiguration: CONFIGURATION,
        proof: {},
        verifier: {
          verify: async () => ({
            valid: true,
            providerSubjectReference: "self-subject",
            configuration: { ...CONFIGURATION, minimumAge: 21 },
            disclosed: { minimumAgeVerified: 21, documentIssuingCountry: "DE", nationality: "DE" },
          }),
        },
        env: ENABLED_ENV,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "self_configuration_mismatch",
  );
});

test("future Self verification maps only requested document predicates and never unique-human assurance", async () => {
  const result = await verifySelfDocumentPredicates({
    requestedConfiguration: CONFIGURATION,
    proof: { opaque: true },
    verifier: {
      verify: async () => ({
        valid: true,
        providerSubjectReference: "self-subject",
        configuration: CONFIGURATION,
        disclosed: { minimumAgeVerified: 18, documentIssuingCountry: "DE", nationality: "DE" },
      }),
    },
    env: ENABLED_ENV,
  });
  assert.deepEqual(result.capabilities, ["document_holder", "issuing_country", "minimum_age", "nationality"]);
  assert.equal(result.capabilities.includes("unique_human" as never), false);
  assert.equal(result.providerId, "self:document");
});
