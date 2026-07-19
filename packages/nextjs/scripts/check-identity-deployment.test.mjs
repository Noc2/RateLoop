import { TOKENLESS_VERCEL_PROJECT, validateIdentityDeployment } from "./check-identity-deployment.mjs";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

function validEnv() {
  return {
    APP_URL: "https://rateloop-tokenless.vercel.app",
    NEXT_PUBLIC_APP_URL: "https://rateloop-tokenless.vercel.app",
    BETTER_AUTH_SECRET: "b".repeat(48),
    BETTER_AUTH_PASSKEY_RP_ID: "rateloop-tokenless.vercel.app",
    TOKENLESS_THIRDWEB_WALLET_ENABLED: "false",
  };
}

test("hosted Better Auth accepts only the isolated tokenless project and matching passkey domain", () => {
  assert.deepEqual(
    validateIdentityDeployment({ env: validEnv(), projectLinks: [TOKENLESS_VERCEL_PROJECT], hosted: true }),
    [],
  );
  assert.deepEqual(
    validateIdentityDeployment({
      env: { ...validEnv(), VERCEL_PROJECT_ID: TOKENLESS_VERCEL_PROJECT.projectId },
      hosted: true,
    }),
    [],
  );
});

test("hosted Better Auth rejects legacy production, public secrets, and missing configuration", () => {
  const errors = validateIdentityDeployment({
    env: {
      APP_URL: "https://rateloop.ai",
      BETTER_AUTH_PASSKEY_RP_ID: "rate-loop-nextjs.vercel.app",
      NEXT_PUBLIC_BETTER_AUTH_SECRET: "leaked",
      TOKENLESS_THIRDWEB_WALLET_ENABLED: "not-explicit",
    },
    projectLinks: [{ projectId: "legacy", projectName: "rate-loop-nextjs" }],
    hosted: true,
  });
  assert.match(errors.join("\n"), /BETTER_AUTH_SECRET must contain at least 32 characters/i);
  assert.match(errors.join("\n"), /does not match tokenless origin/i);
  assert.match(errors.join("\n"), /must never target rateloop\.ai/i);
  assert.match(errors.join("\n"), /NEXT_PUBLIC_BETTER_AUTH_SECRET is forbidden/i);
  assert.match(errors.join("\n"), /must be explicitly true or false/i);
  assert.match(errors.join("\n"), /unexpected vercel project/i);
});

test("local builds remain build-safe without hosted auth variables", () => {
  assert.deepEqual(validateIdentityDeployment({ env: {}, hosted: false }), []);
});

test("hosted builds cannot bypass required identity configuration", () => {
  const errors = validateIdentityDeployment({
    env: {
      APP_URL: "https://rateloop-tokenless.vercel.app",
      BETTER_AUTH_GOOGLE_CLIENT_ID: "partial-google-config",
      NEXT_PUBLIC_BETTER_AUTH_SECRET: "leaked",
    },
    projectLinks: [TOKENLESS_VERCEL_PROJECT],
    hosted: true,
  });
  assert.match(errors.join("\n"), /BETTER_AUTH_SECRET must contain at least 32 characters/i);
  assert.match(errors.join("\n"), /BETTER_AUTH_PASSKEY_RP_ID is required/i);
  assert.match(errors.join("\n"), /TOKENLESS_THIRDWEB_WALLET_ENABLED must be explicitly true or false/i);
  assert.match(errors.join("\n"), /Google sign-in requires both/i);
  assert.match(errors.join("\n"), /NEXT_PUBLIC_BETTER_AUTH_SECRET is forbidden/i);
});

test("hosted identity still requires the exact immutable project ID", () => {
  const missingProjectId = validateIdentityDeployment({
    env: { ...validEnv(), VERCEL_PROJECT_NAME: TOKENLESS_VERCEL_PROJECT.projectName },
    hosted: true,
  });
  assert.match(missingProjectId.join("\n"), /unexpected vercel project/i);

  const legacyProjectId = validateIdentityDeployment({
    env: { ...validEnv(), VERCEL_PROJECT_ID: "prj_legacy" },
    hosted: true,
  });
  assert.match(legacyProjectId.join("\n"), /unexpected vercel project/i);
});

test("optional thirdweb wallet creation is disabled by default and requires an isolated signer when enabled", () => {
  const disabled = validateIdentityDeployment({
    env: validEnv(),
    projectLinks: [TOKENLESS_VERCEL_PROJECT],
    hosted: true,
  });
  assert.deepEqual(disabled, []);

  const missing = validateIdentityDeployment({
    env: { ...validEnv(), TOKENLESS_THIRDWEB_WALLET_ENABLED: "true" },
    projectLinks: [TOKENLESS_VERCEL_PROJECT],
    hosted: true,
  });
  assert.match(missing.join("\n"), /NEXT_PUBLIC_THIRDWEB_CLIENT_ID is required/i);
  assert.match(missing.join("\n"), /wallet signing key source is required/i);

  const { privateKey } = generateKeyPairSync("ed25519");
  const enabled = validateIdentityDeployment({
    env: {
      ...validEnv(),
      TOKENLESS_THIRDWEB_WALLET_ENABLED: "true",
      NEXT_PUBLIC_THIRDWEB_CLIENT_ID: "public-client-id",
      TOKENLESS_THIRDWEB_WALLET_AUDIENCE: "thirdweb-project-audience",
      TOKENLESS_THIRDWEB_WALLET_KEY_ID: "rateloop-wallet-v1",
      TOKENLESS_THIRDWEB_WALLET_PRIVATE_JWK: JSON.stringify(privateKey.export({ format: "jwk" })),
    },
    projectLinks: [TOKENLESS_VERCEL_PROJECT],
    hosted: true,
  });
  assert.deepEqual(enabled, []);

  const main = validateIdentityDeployment({
    env: {
      ...validEnv(),
      VERCEL_GIT_COMMIT_REF: "main",
      TOKENLESS_THIRDWEB_WALLET_ENABLED: "true",
      NEXT_PUBLIC_THIRDWEB_CLIENT_ID: "public-client-id",
      TOKENLESS_THIRDWEB_WALLET_AUDIENCE: "thirdweb-project-audience",
      TOKENLESS_THIRDWEB_WALLET_KEY_ID: `ed25519:${"ab".repeat(12)}`,
      TOKENLESS_THIRDWEB_WALLET_KMS_KEY_RESOURCE:
        "arn:aws:kms:eu-central-1:123456789012:key/66666666-6666-6666-6666-666666666666",
      TOKENLESS_THIRDWEB_WALLET_KMS_REGION: "eu-central-1",
      TOKENLESS_THIRDWEB_WALLET_KMS_ROLE_ARN: "arn:aws:iam::123456789012:role/rateloop-wallet-jwt",
    },
    projectLinks: [TOKENLESS_VERCEL_PROJECT],
    hosted: true,
  });
  assert.deepEqual(main, []);
});
