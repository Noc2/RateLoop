import { TOKENLESS_VERCEL_PROJECT, validateThirdwebDeployment } from "./check-thirdweb-deployment.mjs";
import assert from "node:assert/strict";
import test from "node:test";

function validEnv() {
  return {
    APP_URL: "https://rateloop-tokenless.vercel.app",
    NEXT_PUBLIC_APP_URL: "https://rateloop-tokenless.vercel.app",
    NEXT_PUBLIC_THIRDWEB_AUTH_DOMAIN: "rateloop-tokenless.vercel.app",
    NEXT_PUBLIC_THIRDWEB_CLIENT_ID: "public-client-id",
    THIRDWEB_SECRET_KEY: "server-secret",
  };
}

test("hosted thirdweb auth accepts only the isolated tokenless project and matching domain", () => {
  assert.deepEqual(
    validateThirdwebDeployment({ env: validEnv(), projectLinks: [TOKENLESS_VERCEL_PROJECT], production: true }),
    [],
  );
  assert.deepEqual(
    validateThirdwebDeployment({
      env: { ...validEnv(), VERCEL_PROJECT_ID: TOKENLESS_VERCEL_PROJECT.projectId },
      production: true,
    }),
    [],
  );
});

test("hosted thirdweb auth rejects legacy production, secret exposure, and missing configuration", () => {
  const errors = validateThirdwebDeployment({
    env: {
      APP_URL: "https://rateloop.ai",
      NEXT_PUBLIC_THIRDWEB_AUTH_DOMAIN: "rate-loop-nextjs.vercel.app",
      NEXT_PUBLIC_THIRDWEB_SECRET_KEY: "leaked",
    },
    projectLinks: [{ projectId: "legacy", projectName: "rate-loop-nextjs" }],
    production: true,
  });
  assert.match(errors.join("\n"), /client_id is required/i);
  assert.match(errors.join("\n"), /secret_key is required/i);
  assert.match(errors.join("\n"), /does not match tokenless origin/i);
  assert.match(errors.join("\n"), /must never target rateloop\.ai/i);
  assert.match(errors.join("\n"), /must never have a NEXT_PUBLIC variant/i);
  assert.match(errors.join("\n"), /unexpected vercel project/i);
});

test("local builds remain build-safe without hosted auth variables", () => {
  assert.deepEqual(validateThirdwebDeployment({ env: {}, production: false }), []);
});

test("hosted thirdweb auth still requires the exact immutable project ID", () => {
  const missingProjectId = validateThirdwebDeployment({
    env: { ...validEnv(), VERCEL_PROJECT_NAME: TOKENLESS_VERCEL_PROJECT.projectName },
    production: true,
  });
  assert.match(missingProjectId.join("\n"), /unexpected vercel project/i);

  const legacyProjectId = validateThirdwebDeployment({
    env: { ...validEnv(), VERCEL_PROJECT_ID: "prj_legacy" },
    production: true,
  });
  assert.match(legacyProjectId.join("\n"), /unexpected vercel project/i);
});
