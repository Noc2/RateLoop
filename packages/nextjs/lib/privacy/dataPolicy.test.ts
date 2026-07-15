import { assertCredentialDataPolicy, assertDataIngressPolicy } from "./dataPolicy";
import assert from "node:assert/strict";
import test from "node:test";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

test("EU ingress policy separates public, private, and regulated data", () => {
  assert.deepEqual(
    assertDataIngressPolicy({ classification: "synthetic", confirmedNoSensitiveData: true, visibility: "public" }),
    { classification: "synthetic", homeRegion: "eu", use: "service_delivery" },
  );
  assert.equal(assertDataIngressPolicy({ classification: "confidential", visibility: "private" }).homeRegion, "eu");
  assert.throws(
    () => assertDataIngressPolicy({ classification: "confidential", visibility: "public" }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_public_privacy",
  );
  assert.throws(
    () => assertDataIngressPolicy({ classification: "regulated", visibility: "private" }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "regulated_data_not_enabled",
  );
  assert.throws(
    () => assertDataIngressPolicy({ classification: "internal", homeRegion: "us", visibility: "private" }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "home_region_mismatch",
  );
});

test("credentials are bound to region, maximum classification, and permitted use", () => {
  assert.equal(
    assertCredentialDataPolicy({
      classification: "internal",
      credentialHomeRegion: "eu",
      homeRegion: "eu",
      maxClassification: "confidential",
      permittedDataUses: '["service_delivery"]',
    }).classification,
    "internal",
  );
  assert.throws(
    () =>
      assertCredentialDataPolicy({
        classification: "restricted",
        credentialHomeRegion: "eu",
        homeRegion: "eu",
        maxClassification: "confidential",
        permittedDataUses: ["service_delivery"],
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "credential_classification_forbidden",
  );
  assert.throws(
    () =>
      assertCredentialDataPolicy({
        classification: "internal",
        credentialHomeRegion: "eu",
        homeRegion: "eu",
        maxClassification: "confidential",
        permittedDataUses: ["support"],
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "credential_use_forbidden",
  );
});
