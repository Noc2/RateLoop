import { manifestDigest, tokenlessEuDeploymentManifest } from "../../../scripts/validate-tokenless-eu-deployment.mjs";
import * as paidLaneActivationModule from "../lib/tokenless/paidLaneActivation.ts";
import {
  DEFAULT_HOSTED_RELEASE_CAPABILITIES,
  REQUIRED_TOKENLESS_PRODUCTION_VARIABLES,
  validateTokenlessProductionReadiness,
} from "./check-tokenless-production-readiness.mjs";
import { deriveHostedDatabaseIdentity } from "./migrate-hosted-database.mjs";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";

const address = index => `0x${index.toString(16).padStart(40, "0")}`;
const encodedKey = index => Buffer.alloc(32, index).toString("base64url");
const tokenlessGoldKeyring = (index = 16) => ({
  TOKENLESS_GOLD_INJECTION_KEY_VERSION: "v1",
  TOKENLESS_GOLD_INJECTION_KEYS: JSON.stringify({ v1: encodedKey(index) }),
});
const tokenlessTestOperationalSecrets = () => ({
  TOKENLESS_MCP_RATE_LIMIT_SECRET: "m".repeat(32),
  CRON_SECRET: "c".repeat(32),
  TOKENLESS_COMPLIANCE_OPERATOR_SECRET: "o".repeat(32),
  TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY: encodedKey(10),
  TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY_VERSION: "forecast-v1",
  TOKENLESS_WALLET_SCREENING_PROVIDER_ID: "wallet-screening:v1",
  TOKENLESS_WALLET_SCREENING_PROVIDER_URL: "https://screening.example.test/check",
  TOKENLESS_WALLET_SCREENING_PROVIDER_SECRET: "w".repeat(32),
});
const tokenlessTestDatabase = () => {
  const DATABASE_URL = "postgresql://rateloop:secret@tokenless-db.example/tokenless?sslmode=require";
  return { DATABASE_URL, TOKENLESS_DATABASE_IDENTITY: deriveHostedDatabaseIdentity(DATABASE_URL) };
};
const tokenlessTestRpc = () => {
  const panel = address(1);
  const issuer = address(2);
  const adapter = address(3);
  const usdc = address(4);
  const feeRecipient = address(5);
  const feedbackBonus = address(6);
  return {
    BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org",
    BASE_SEPOLIA_RPC_FALLBACK_URLS: "https://base-sepolia-fallback.example",
    TOKENLESS_DEPLOYMENT_SCHEMA: "rateloop-tokenless-deployment-v4",
    TOKENLESS_CHAIN_ID: "84532",
    TOKENLESS_DEPLOYMENT_KEY: `tokenless-v4:84532:${panel}:${issuer}:${adapter}:${feedbackBonus}`,
    TOKENLESS_DEPLOYMENT_BLOCK: "123",
    TOKENLESS_PANEL_ADDRESS: panel,
    TOKENLESS_CREDENTIAL_ISSUER_ADDRESS: issuer,
    TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS: adapter,
    TOKENLESS_FEEDBACK_BONUS_ADDRESS: feedbackBonus,
    TOKENLESS_BEACON_VERIFIER_ADDRESS: address(7),
    TOKENLESS_USDC_ADDRESS: usdc,
    TOKENLESS_FEE_RECIPIENT: feeRecipient,
    TOKENLESS_REVEAL_WINDOW_SECONDS: "300",
    TOKENLESS_BEACON_FAILURE_GRACE_SECONDS: "21600",
    TOKENLESS_CLAIM_GRACE_PERIOD_SECONDS: "604800",
    TOKENLESS_USDC_EIP712_NAME: "RateLoop Tokenless Test USDC",
    TOKENLESS_USDC_EIP712_VERSION: "2",
  };
};
const tokenlessTestPlatformSecrets = () => {
  const platformSecrets = tokenlessEuDeploymentManifest.resources.platformSecrets;
  return {
    [platformSecrets.providerEnv]: platformSecrets.allowedProviders[0],
    [platformSecrets.resourceIdEnv]: "platform-secret-inventory-v1",
    TOKENLESS_ARTIFACT_WRAPPING_KEY_VERSION: "artifact-v1",
    TOKENLESS_ARTIFACT_WRAPPING_KEYS: JSON.stringify({ "artifact-v1": encodedKey(19) }),
  };
};

function validFixture() {
  const panel = address(1);
  const issuer = address(2);
  const adapter = address(3);
  const usdc = address(4);
  const feedbackBonus = address(6);
  const beaconVerifier = address(7);
  const deploymentKey = `tokenless-v4:84532:${panel}:${issuer}:${adapter}:${feedbackBonus}`;
  const provider = generateKeyPairSync("ed25519");
  const evidence = generateKeyPairSync("ed25519");
  const evidencePublicKey = evidence.publicKey.export({ format: "der", type: "spki" });
  const evidenceKeyId = `ed25519:${createHash("sha256").update(evidencePublicKey).digest("hex").slice(0, 24)}`;
  const deploymentManifestSigner = generateKeyPairSync("ed25519");
  const euManifestDigest = manifestDigest();
  const env = Object.fromEntries(REQUIRED_TOKENLESS_PRODUCTION_VARIABLES.map(name => [name, `configured-${name}`]));
  Object.assign(env, {
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_REF: "main",
    TOKENLESS_DATA_PLANE_MODE: "eu-processing-region",
    TOKENLESS_HOME_REGION: "eu",
    TOKENLESS_EU_MANIFEST_SHA256: euManifestDigest,
    TOKENLESS_EU_MANIFEST_SIGNING_PUBLIC_KEY: deploymentManifestSigner.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64url"),
    TOKENLESS_EU_MANIFEST_SIGNATURE: sign(
      null,
      Buffer.from(euManifestDigest, "hex"),
      deploymentManifestSigner.privateKey,
    ).toString("base64url"),
    APP_URL: "https://rateloop-tokenless.vercel.app",
    NEXT_PUBLIC_APP_URL: "https://rateloop-tokenless.vercel.app",
    BETTER_AUTH_SECRET: "b".repeat(48),
    BETTER_AUTH_PASSKEY_RP_ID: "rateloop-tokenless.vercel.app",
    DATABASE_URL: "postgresql://rateloop:secret@eu-postgres.example/tokenless?sslmode=require",
    TOKENLESS_DATABASE_IDENTITY: deriveHostedDatabaseIdentity(
      "postgresql://rateloop:secret@eu-postgres.example/tokenless?sslmode=require",
    ),
    TOKENLESS_THIRDWEB_WALLET_ENABLED: "false",
    BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org",
    BASE_SEPOLIA_RPC_FALLBACK_URLS: "https://base-sepolia-fallback.example",
    NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org",
    TOKENLESS_ELIGIBILITY_PROVIDER_START_URL: "https://eligibility.example/start",
    TOKENLESS_PONDER_URL: "https://tokenless-ponder.example",
    TOKENLESS_DEPLOYMENT_SCHEMA: "rateloop-tokenless-deployment-v4",
    TOKENLESS_CHAIN_ID: "84532",
    TOKENLESS_DEPLOYMENT_KEY: deploymentKey,
    TOKENLESS_DEPLOYMENT_BLOCK: "123",
    TOKENLESS_PANEL_ADDRESS: panel,
    TOKENLESS_CREDENTIAL_ISSUER_ADDRESS: issuer,
    TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS: adapter,
    TOKENLESS_FEEDBACK_BONUS_ADDRESS: feedbackBonus,
    TOKENLESS_BEACON_VERIFIER_ADDRESS: beaconVerifier,
    TOKENLESS_USDC_ADDRESS: usdc,
    TOKENLESS_USDC_EIP712_NAME: "RateLoop Tokenless Test USDC",
    TOKENLESS_USDC_EIP712_VERSION: "2",
    TOKENLESS_FEE_RECIPIENT: address(5),
    TOKENLESS_REVEAL_WINDOW_SECONDS: "300",
    TOKENLESS_BEACON_FAILURE_GRACE_SECONDS: "21600",
    TOKENLESS_CLAIM_GRACE_PERIOD_SECONDS: "604800",
    TOKENLESS_VOUCHER_ISSUER_EPOCH: "1",
    TOKENLESS_WORLD_ID_CREDENTIAL_MIN_TTL_SECONDS: "2592000",
    WORLD_ID_RP_SIGNING_KEY: `0x${"44".repeat(32)}`,
    WORLD_ID_APP_ID: "app_production123",
    WORLD_ID_RP_ID: "rp_production123",
    WORLD_ID_ENVIRONMENT: "production",
    TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED: "true",
    NEXT_PUBLIC_TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED: "true",
    TOKENLESS_NETWORK_PANELS_ENABLED: "true",
    NEXT_PUBLIC_TOKENLESS_NETWORK_PANELS_ENABLED: "true",
    TOKENLESS_HYBRID_REVIEWS_ENABLED: "false",
    NEXT_PUBLIC_TOKENLESS_HYBRID_REVIEWS_ENABLED: "false",
    TOKENLESS_PAID_LANES_DPIA_APPROVAL_REFERENCE: `sha256:${"a".repeat(64)}`,
    TOKENLESS_PAID_LANES_TRANSFER_INVENTORY_APPROVAL_REFERENCE: `sha256:${"b".repeat(64)}`,
    TOKENLESS_PAID_LANES_FUNDING_VALIDATION_REFERENCE: `sha256:${"c".repeat(64)}`,
    TOKENLESS_INVITED_PAID_ADULTHOOD_APPROVAL_REFERENCE: `sha256:${"d".repeat(64)}`,
    TOKENLESS_PAID_LANES_COMPLIANCE_APPROVED_AT: "2026-07-20T12:00:00.000Z",
    TOKENLESS_SUBSCRIPTIONS_ENABLED: "false",
    TOKENLESS_PREPAID_TOPUP_ENABLED: "false",
    TOKENLESS_ENTERPRISE_IDENTITY_ENABLED: "true",
    TOKENLESS_SSO_TRUSTED_ISSUERS: "https://identity.example.test",
    TOKENLESS_EVIDENCE_FINALITY_BLOCK_TAG: "safe",
    TOKENLESS_DAC7_POLICY: "eu",
    TOKENLESS_SANCTIONS_MATCH_RETENTION_DAYS: "1825",
    TOKENLESS_WALLET_SCREENING_PROVIDER_ID: "wallet-screening:v1",
    TOKENLESS_WALLET_SCREENING_PROVIDER_URL: "https://screening.example.test/check",
    TOKENLESS_WALLET_SCREENING_PROVIDER_SECRET: "w".repeat(32),
    TOKENLESS_EVIDENCE_TENANT_COMMITMENT_KEY: encodedKey(9),
    TOKENLESS_PSEUDONYM_KEY: encodedKey(14),
    TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY: encodedKey(10),
    TOKENLESS_WEBHOOK_ENCRYPTION_KEY: encodedKey(11),
    TOKENLESS_ELIGIBILITY_HANDOFF_SECRET: Buffer.alloc(32, 12).toString("base64"),
    TOKENLESS_EVIDENCE_SIGNING_KEY_ID: evidenceKeyId,
    TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY: evidence.privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64url"),
    TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS: JSON.stringify([
      {
        algorithm: "Ed25519",
        keyId: evidenceKeyId,
        publicKey: evidencePublicKey.toString("base64url"),
        status: "current",
      },
    ]),
    TOKENLESS_PLATFORM_SECRET_ROTATION_RUNBOOK_REFERENCE: `sha256:${"e".repeat(64)}`,
    TOKENLESS_PLATFORM_SECRET_RECOVERY_RUNBOOK_REFERENCE: `sha256:${"f".repeat(64)}`,
    TOKENLESS_SIGNER_SPEND_LIMITS_REFERENCE: `sha256:${"1".repeat(64)}`,
    TOKENLESS_ELIGIBILITY_PROVIDER_PUBLIC_KEY: provider.publicKey.export({ format: "pem", type: "spki" }),
    TOKENLESS_MCP_RATE_LIMIT_SECRET: "m".repeat(32),
    TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET: encodedKey(18),
    TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY: encodedKey(13),
    TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION: "sampler-v1",
    TOKENLESS_PIPELINE_TOKEN: "p".repeat(32),
    CRON_SECRET: "c".repeat(32),
    TOKENLESS_NOTIFICATION_UNSUBSCRIBE_SECRET: "n".repeat(32),
  });
  for (const [name, resource] of Object.entries(tokenlessEuDeploymentManifest.resources)) {
    env[resource.resourceIdEnv] = resource.expectedResourceId ?? `eu-${name}-resource`;
    if (resource.regionEnv) env[resource.regionEnv] = resource.region;
    if (resource.accessEnv) env[resource.accessEnv] = resource.expectedAccess;
    if (resource.providerEnv) env[resource.providerEnv] = resource.allowedProviders[0];
  }
  for (const [name, processor] of Object.entries(tokenlessEuDeploymentManifest.externalProcessors)) {
    env[processor.evidenceEnv] = `approved-${name}-evidence`;
    if (processor.deliveryRegionEnv) env[processor.deliveryRegionEnv] = processor.deliveryRegion;
  }
  for (const [index, names] of [
    [
      "TOKENLESS_CREDENTIAL_ISSUER_SIGNER_PRIVATE_KEY",
      "TOKENLESS_CREDENTIAL_ISSUER_SIGNER_EXPECTED_ADDRESS",
      "TOKENLESS_CREDENTIAL_ISSUER_SIGNER_KEY_VERSION",
    ],
    [
      "TOKENLESS_X402_RELAYER_PRIVATE_KEY",
      "TOKENLESS_X402_RELAYER_EXPECTED_ADDRESS",
      "TOKENLESS_X402_RELAYER_KEY_VERSION",
    ],
    [
      "TOKENLESS_PREPAID_FUNDER_PRIVATE_KEY",
      "TOKENLESS_PREPAID_FUNDER_EXPECTED_ADDRESS",
      "TOKENLESS_PREPAID_FUNDER_KEY_VERSION",
    ],
    [
      "TOKENLESS_SURPRISE_BONUS_FUNDER_PRIVATE_KEY",
      "TOKENLESS_SURPRISE_BONUS_FUNDER_EXPECTED_ADDRESS",
      "TOKENLESS_SURPRISE_BONUS_FUNDER_KEY_VERSION",
    ],
    ["TOKENLESS_KEEPER_PRIVATE_KEY", "TOKENLESS_KEEPER_EXPECTED_ADDRESS", "TOKENLESS_KEEPER_KEY_VERSION"],
  ].entries()) {
    const [privateKeyName, addressName, versionName] = names;
    const privateKey = `0x${(index + 21).toString(16).padStart(64, "0")}`;
    env[privateKeyName] = privateKey;
    env[addressName] = privateKeyToAccount(privateKey).address;
    env[versionName] = `platform-v${index + 1}`;
  }
  env.TOKENLESS_ARTIFACT_WRAPPING_KEY_VERSION = "artifact-v1";
  env.TOKENLESS_ARTIFACT_WRAPPING_KEYS = JSON.stringify({ "artifact-v1": encodedKey(19) });
  const keyrings = [
    ["TOKENLESS_ASSURANCE_RATIONALE_VAULT", 2, "base64url"],
    ["TOKENLESS_ASSURANCE_REVIEWER_MAPPING", 3, "base64url"],
    ["TOKENLESS_PUBLIC_RATER_RESPONSE_VAULT", 15, "base64url"],
    ["TOKENLESS_PROVIDER_EVIDENCE_VAULT", 4, "base64"],
    ["TOKENLESS_TAX_VAULT", 5, "base64"],
    ["TOKENLESS_VOTE_MAPPING_VAULT", 6, "base64"],
    ["TOKENLESS_PROVIDER_SUBJECT_HMAC", 7, "base64url"],
    ["TOKENLESS_WORLD_ID_EVIDENCE", 8, "base64url"],
    ["TOKENLESS_GOLD_INJECTION", 16, "base64url"],
  ];
  for (const [prefix, fill, encoding] of keyrings) {
    env[`${prefix}_KEY_VERSION`] = "v1";
    env[`${prefix}_KEYS`] = JSON.stringify({ v1: Buffer.alloc(32, fill).toString(encoding) });
  }
  env.NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE = derivePaidLaneActivationReference(env);
  return {
    env,
    releaseCapabilities: Object.fromEntries(
      Object.keys(DEFAULT_HOSTED_RELEASE_CAPABILITIES).map(capability => [capability, true]),
    ),
    activeRegistry: {
      84532: {
        schemaVersion: "rateloop-tokenless-deployment-v4",
        deploymentComplete: true,
        deploymentBlockNumber: 123,
        deploymentKey,
        beaconVerifier,
        contracts: {
          TokenlessPanel: { address: panel },
          CredentialIssuer: { address: issuer },
          X402PanelSubmitter: { address: adapter },
          TokenlessFeedbackBonus: { address: feedbackBonus },
          TestUSDC: { address: usdc },
        },
      },
    },
  };
}

test("production chain execution requires distinct HTTPS RPC fallbacks", () => {
  const missing = validFixture();
  delete missing.env.BASE_SEPOLIA_RPC_FALLBACK_URLS;
  assert.match(validateTokenlessProductionReadiness(missing).join("\n"), /is required for a hosted release/i);

  const duplicate = validFixture();
  duplicate.env.BASE_SEPOLIA_RPC_FALLBACK_URLS = duplicate.env.BASE_SEPOLIA_RPC_URL;
  assert.match(validateTokenlessProductionReadiness(duplicate).join("\n"), /must be distinct/i);

  const plaintext = validFixture();
  plaintext.env.BASE_SEPOLIA_RPC_FALLBACK_URLS = "http://fallback.example";
  assert.match(validateTokenlessProductionReadiness(plaintext).join("\n"), /must contain HTTPS URLs/i);
});

test("production chain execution enforces the contract beacon-failure grace floor", () => {
  const fixture = validFixture();
  fixture.env.TOKENLESS_BEACON_FAILURE_GRACE_SECONDS = "21599";
  assert.match(validateTokenlessProductionReadiness(fixture).join("\n"), /must be at least 21600 seconds/i);
});

test("production chain execution enforces the immutable five-minute reveal window", () => {
  const minimum = validFixture();
  minimum.env.TOKENLESS_REVEAL_WINDOW_SECONDS = "300";
  assert.deepEqual(validateTokenlessProductionReadiness(minimum), []);

  const belowMinimum = validFixture();
  belowMinimum.env.TOKENLESS_REVEAL_WINDOW_SECONDS = "299";
  assert.match(validateTokenlessProductionReadiness(belowMinimum).join("\n"), /must be at least 300 seconds/i);
});

test("platform-secret signer keys, addresses, and versions are pinned and distinct", () => {
  const mismatched = validFixture();
  mismatched.env.TOKENLESS_X402_RELAYER_EXPECTED_ADDRESS = mismatched.env.TOKENLESS_PREPAID_FUNDER_EXPECTED_ADDRESS;
  const mismatchOutput = validateTokenlessProductionReadiness(mismatched).join("\n");
  assert.match(mismatchOutput, /Platform signer EVM addresses must be distinct/iu);
  assert.match(mismatchOutput, /must match the address derived/iu);

  const reusedKey = validFixture();
  reusedKey.env.TOKENLESS_KEEPER_PRIVATE_KEY = reusedKey.env.TOKENLESS_PREPAID_FUNDER_PRIVATE_KEY;
  reusedKey.env.TOKENLESS_KEEPER_EXPECTED_ADDRESS = reusedKey.env.TOKENLESS_PREPAID_FUNDER_EXPECTED_ADDRESS;
  const reusedOutput = validateTokenlessProductionReadiness(reusedKey).join("\n");
  assert.match(reusedOutput, /Platform signer EVM addresses must be distinct/iu);
  assert.match(reusedOutput, /Production key roles must be distinct/iu);

  const invalidVersion = validFixture();
  invalidVersion.env.TOKENLESS_CREDENTIAL_ISSUER_SIGNER_KEY_VERSION = "contains spaces";
  assert.match(validateTokenlessProductionReadiness(invalidVersion).join("\n"), /stable version label/iu);
});

test("production evidence publication requires exactly one conservative finality policy", () => {
  const missing = validFixture();
  delete missing.env.TOKENLESS_EVIDENCE_FINALITY_BLOCK_TAG;
  assert.match(validateTokenlessProductionReadiness(missing).join("\n"), /configure exactly one/i);

  const shallow = validFixture();
  delete shallow.env.TOKENLESS_EVIDENCE_FINALITY_BLOCK_TAG;
  shallow.env.TOKENLESS_EVIDENCE_CONFIRMATION_DEPTH = "63";
  assert.match(validateTokenlessProductionReadiness(shallow).join("\n"), /at least 64/i);

  const conflicting = validFixture();
  conflicting.env.TOKENLESS_EVIDENCE_CONFIRMATION_DEPTH = "64";
  assert.match(validateTokenlessProductionReadiness(conflicting).join("\n"), /configure exactly one/i);
});

test("main hosted builds fail closed while local builds skip the release gate", () => {
  for (const env of [
    { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" },
    { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "main" },
    { VERCEL: "1", VERCEL_GIT_COMMIT_REF: "main" },
  ]) {
    const errors = validateTokenlessProductionReadiness({ env, activeRegistry: {} });
    assert.match(errors.join("\n"), /APP_URL is required for a hosted release/);
    assert.match(errors.join("\n"), /paid assignment reservation/i);
  }
  assert.deepEqual(validateTokenlessProductionReadiness({ env: {}, activeRegistry: {} }), []);
});

test("the tokenless branch automatically uses the isolated test deployment gate", () => {
  const env = {
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_PROJECT_ID: "prj_H6C2pfWKEAupFroHbLfzhquaNCLm",
    VERCEL_PROJECT_NAME: "rateloop-tokenless",
    VERCEL_GIT_COMMIT_REF: "tokenless",
    APP_URL: "https://rateloop-tokenless.vercel.app",
    NEXT_PUBLIC_APP_URL: "https://rateloop-tokenless.vercel.app",
    TOKENLESS_NETWORK_PANELS_ENABLED: "false",
    ...tokenlessTestRpc(),
    ...tokenlessTestPlatformSecrets(),
    ...tokenlessTestDatabase(),
    TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET: encodedKey(18),
    ...tokenlessGoldKeyring(),
    ...tokenlessTestOperationalSecrets(),
  };
  assert.deepEqual(validateTokenlessProductionReadiness({ env, activeRegistry: {} }), []);
  const disabledWithoutWalletScreening = { ...env };
  delete disabledWithoutWalletScreening.TOKENLESS_WALLET_SCREENING_PROVIDER_ID;
  delete disabledWithoutWalletScreening.TOKENLESS_WALLET_SCREENING_PROVIDER_URL;
  delete disabledWithoutWalletScreening.TOKENLESS_WALLET_SCREENING_PROVIDER_SECRET;
  assert.deepEqual(
    validateTokenlessProductionReadiness({ env: disabledWithoutWalletScreening, activeRegistry: {} }),
    [],
  );
  const activated = {
    ...env,
    TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED: "true",
    NEXT_PUBLIC_TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED: "true",
    TOKENLESS_NETWORK_PANELS_ENABLED: "true",
    NEXT_PUBLIC_TOKENLESS_NETWORK_PANELS_ENABLED: "true",
    TOKENLESS_HYBRID_REVIEWS_ENABLED: "false",
    NEXT_PUBLIC_TOKENLESS_HYBRID_REVIEWS_ENABLED: "false",
    TOKENLESS_PAID_LANES_DPIA_APPROVAL_REFERENCE: `sha256:${"a".repeat(64)}`,
    TOKENLESS_PAID_LANES_TRANSFER_INVENTORY_APPROVAL_REFERENCE: `sha256:${"b".repeat(64)}`,
    TOKENLESS_PAID_LANES_FUNDING_VALIDATION_REFERENCE: `sha256:${"c".repeat(64)}`,
    TOKENLESS_INVITED_PAID_ADULTHOOD_APPROVAL_REFERENCE: `sha256:${"d".repeat(64)}`,
    TOKENLESS_PAID_LANES_COMPLIANCE_APPROVED_AT: "2026-07-20T12:00:00.000Z",
    WORLD_ID_APP_ID: "app_production123",
    WORLD_ID_RP_ID: "rp_production123",
    WORLD_ID_ENVIRONMENT: "production",
  };
  activated.NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE = derivePaidLaneActivationReference(activated);
  assert.deepEqual(validateTokenlessProductionReadiness({ env: activated, activeRegistry: {} }), []);
  const activatedWithoutWalletScreening = { ...activated };
  delete activatedWithoutWalletScreening.TOKENLESS_WALLET_SCREENING_PROVIDER_ID;
  delete activatedWithoutWalletScreening.TOKENLESS_WALLET_SCREENING_PROVIDER_URL;
  delete activatedWithoutWalletScreening.TOKENLESS_WALLET_SCREENING_PROVIDER_SECRET;
  assert.match(
    validateTokenlessProductionReadiness({ env: activatedWithoutWalletScreening, activeRegistry: {} }).join("\n"),
    /TOKENLESS_WALLET_SCREENING_PROVIDER_ID is required for paid eligibility/u,
  );
  const publicOnlyActivation = {
    ...activated,
    TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED: "false",
  };
  publicOnlyActivation.NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE =
    derivePaidLaneActivationReference(publicOnlyActivation);
  assert.match(
    validateTokenlessProductionReadiness({ env: publicOnlyActivation, activeRegistry: {} }).join("\n"),
    /TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED and NEXT_PUBLIC_TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED must match/u,
  );
  const hybridActivated = {
    ...activated,
    TOKENLESS_HYBRID_REVIEWS_ENABLED: "true",
    NEXT_PUBLIC_TOKENLESS_HYBRID_REVIEWS_ENABLED: "true",
  };
  hybridActivated.NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE =
    derivePaidLaneActivationReference(hybridActivated);
  assert.match(
    validateTokenlessProductionReadiness({ env: hybridActivated, activeRegistry: {} }).join("\n"),
    /hybrid_public_safe is unavailable/u,
  );
  assert.match(
    validateTokenlessProductionReadiness({
      env: { ...env, STRIPE_SECRET_KEY: `sk_live_${"a".repeat(32)}` },
      activeRegistry: {},
    }).join("\n"),
    /must not use Stripe live mode on the Base Sepolia tokenless test deployment/i,
  );
  assert.match(
    validateTokenlessProductionReadiness({
      env: { ...env, STRIPE_SECRET_KEY: `rk_live_${"a".repeat(32)}` },
      activeRegistry: {},
    }).join("\n"),
    /must not use Stripe live mode on the Base Sepolia tokenless test deployment/i,
  );
  const cliDeploymentEnv = { ...env };
  delete cliDeploymentEnv.VERCEL_GIT_COMMIT_REF;
  assert.deepEqual(validateTokenlessProductionReadiness({ env: cliDeploymentEnv, activeRegistry: {} }), []);

  for (const [name, invalidValue, expected] of [
    ["VERCEL_ENV", "preview", /production target/i],
    ["VERCEL_PROJECT_ID", "prj_legacy", /requires Vercel project prj_H6C2/i],
    ["VERCEL_PROJECT_NAME", "rate-loop-nextjs", /requires Vercel project rateloop-tokenless/i],
    ["APP_URL", "https://rateloop.ai", /must remain https:\/\/rateloop-tokenless\.vercel\.app/i],
    ["NEXT_PUBLIC_APP_URL", "https://www.rateloop.ai", /must remain https:\/\/rateloop-tokenless\.vercel\.app/i],
    ["TOKENLESS_NETWORK_PANELS_ENABLED", "true", /Paid-lane activation/i],
    ["TOKENLESS_REVEAL_WINDOW_SECONDS", "299", /must be at least 300 seconds/i],
    ["TOKENLESS_BEACON_FAILURE_GRACE_SECONDS", "21599", /must be at least 21600 seconds/i],
  ]) {
    const invalid = { ...env, [name]: invalidValue };
    assert.match(validateTokenlessProductionReadiness({ env: invalid, activeRegistry: {} }).join("\n"), expected);
  }

  const missingFeeRecipient = { ...env };
  delete missingFeeRecipient.TOKENLESS_FEE_RECIPIENT;
  assert.match(
    validateTokenlessProductionReadiness({ env: missingFeeRecipient, activeRegistry: {} }).join("\n"),
    /TOKENLESS_FEE_RECIPIENT must be a non-zero EVM address/,
  );
  assert.match(
    validateTokenlessProductionReadiness({
      env: { ...env, TOKENLESS_SANCTIONS_MATCH_RETENTION_DAYS: "30" },
      activeRegistry: {},
    }).join("\n"),
    /TOKENLESS_SANCTIONS_MATCH_RETENTION_DAYS must be an integer from 365 to 3650/,
  );
  assert.match(
    validateTokenlessProductionReadiness({
      env: {
        ...env,
        TOKENLESS_FEEDBACK_BONUS_ADDRESS: "0xa0c1f730aad6b7cb78eAEacA39743F6430Dc57b0",
      },
      activeRegistry: {},
    }).join("\n"),
    /TOKENLESS_FEEDBACK_BONUS_ADDRESS must be a non-zero EVM address/,
  );
  for (const name of ["TOKENLESS_MCP_RATE_LIMIT_SECRET", "CRON_SECRET", "TOKENLESS_COMPLIANCE_OPERATOR_SECRET"]) {
    const missingSecret = { ...env };
    delete missingSecret[name];
    assert.match(
      validateTokenlessProductionReadiness({ env: missingSecret, activeRegistry: {} }).join("\n"),
      new RegExp(`${name} is required`),
    );
    assert.match(
      validateTokenlessProductionReadiness({ env: { ...env, [name]: "too-short" }, activeRegistry: {} }).join("\n"),
      new RegExp(`${name} must contain at least 32 characters`),
    );
  }
  for (const name of ["TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY", "TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY_VERSION"]) {
    const missingSecret = { ...env };
    delete missingSecret[name];
    assert.match(
      validateTokenlessProductionReadiness({ env: missingSecret, activeRegistry: {} }).join("\n"),
      new RegExp(`${name} must`),
    );
  }
  assert.match(
    validateTokenlessProductionReadiness({
      env: { ...env, TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY: "too-short" },
      activeRegistry: {},
    }).join("\n"),
    /TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY must encode exactly 32 bytes/u,
  );
  assert.match(
    validateTokenlessProductionReadiness({
      env: { ...env, TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY_VERSION: "contains spaces" },
      activeRegistry: {},
    }).join("\n"),
    /TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY_VERSION must be a stable version label/u,
  );

  const mainErrors = validateTokenlessProductionReadiness({
    env: { ...env, VERCEL_GIT_COMMIT_REF: "main" },
    activeRegistry: {},
  }).join("\n");
  assert.match(mainErrors, /paid assignment reservation/i);
  assert.match(mainErrors, /APP_URL is required for a hosted release|TOKENLESS_DATA_PLANE_MODE/u);
});

test("the tokenless hosted gate inventories platform-secret custody without a residency claim", () => {
  const platformSecrets = tokenlessEuDeploymentManifest.resources.platformSecrets;
  const env = {
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_PROJECT_ID: "prj_H6C2pfWKEAupFroHbLfzhquaNCLm",
    VERCEL_PROJECT_NAME: "rateloop-tokenless",
    VERCEL_GIT_COMMIT_REF: "tokenless",
    APP_URL: "https://rateloop-tokenless.vercel.app",
    NEXT_PUBLIC_APP_URL: "https://rateloop-tokenless.vercel.app",
    TOKENLESS_NETWORK_PANELS_ENABLED: "false",
    ...tokenlessTestRpc(),
    ...tokenlessTestPlatformSecrets(),
    ...tokenlessTestDatabase(),
    TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET: encodedKey(18),
    ...tokenlessGoldKeyring(),
    ...tokenlessTestOperationalSecrets(),
  };
  const missingResource = { ...env };
  delete missingResource[platformSecrets.resourceIdEnv];
  assert.match(
    validateTokenlessProductionReadiness({ env: missingResource, activeRegistry: {} }).join("\n"),
    new RegExp(`${platformSecrets.resourceIdEnv} is required`),
  );
  assert.match(
    validateTokenlessProductionReadiness({
      env: { ...env, [platformSecrets.providerEnv]: "local" },
      activeRegistry: {},
    }).join("\n"),
    new RegExp(`${platformSecrets.providerEnv} must select Vercel and Railway platform-secret custody`),
  );
  assert.equal(platformSecrets.regionEnv, undefined);
  assert.equal(platformSecrets.region, undefined);
  assert.match(platformSecrets.locationScope, /outside-processing-region-claim/);
});

test("the isolated review deployment may retain its existing local vault without weakening the main release gate", () => {
  const env = {
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_PROJECT_ID: "prj_H6C2pfWKEAupFroHbLfzhquaNCLm",
    VERCEL_PROJECT_NAME: "rateloop-tokenless",
    VERCEL_GIT_COMMIT_REF: "tokenless",
    APP_URL: "https://rateloop-tokenless.vercel.app",
    NEXT_PUBLIC_APP_URL: "https://rateloop-tokenless.vercel.app",
    TOKENLESS_NETWORK_PANELS_ENABLED: "false",
    TOKENLESS_ARTIFACT_MASTER_KEY: encodedKey(19),
    ...tokenlessTestRpc(),
    ...tokenlessTestDatabase(),
    TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET: encodedKey(18),
    ...tokenlessGoldKeyring(),
    ...tokenlessTestOperationalSecrets(),
  };
  assert.deepEqual(validateTokenlessProductionReadiness({ env, activeRegistry: {} }), []);
  assert.match(
    validateTokenlessProductionReadiness({
      env: { ...env, ...tokenlessTestPlatformSecrets() },
      activeRegistry: {},
    }).join("\n"),
    /Configure exactly one tokenless test vault key source/,
  );
  assert.match(
    validateTokenlessProductionReadiness({
      env: { ...env, VERCEL_GIT_COMMIT_REF: "main" },
      activeRegistry: {},
    }).join("\n"),
    /TOKENLESS_ARTIFACT_MASTER_KEY is migration-only/,
  );
});

test("the tokenless test deployment still rejects browser-exposed secrets", () => {
  const env = {
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_PROJECT_ID: "prj_H6C2pfWKEAupFroHbLfzhquaNCLm",
    VERCEL_PROJECT_NAME: "rateloop-tokenless",
    VERCEL_GIT_COMMIT_REF: "tokenless",
    APP_URL: "https://rateloop-tokenless.vercel.app",
    NEXT_PUBLIC_APP_URL: "https://rateloop-tokenless.vercel.app",
    TOKENLESS_NETWORK_PANELS_ENABLED: "false",
    ...tokenlessTestRpc(),
    ...tokenlessTestPlatformSecrets(),
    ...tokenlessTestDatabase(),
    TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET: encodedKey(18),
    ...tokenlessGoldKeyring(),
    ...tokenlessTestOperationalSecrets(),
    NEXT_PUBLIC_TOKENLESS_COMPLIANCE_OPERATOR_SECRET: "must-not-ship-operator",
    NEXT_PUBLIC_TOKENLESS_PIPELINE_TOKEN: "must-not-ship",
    NEXT_PUBLIC_TOKENLESS_GOLD_INJECTION_KEY_VERSION: "must-not-ship-version",
    NEXT_PUBLIC_TOKENLESS_GOLD_INJECTION_KEYS: "must-not-ship-keys",
    NEXT_PUBLIC_TOKENLESS_KMS_KEY_RESOURCE: "must-not-ship-kms-resource",
    NEXT_PUBLIC_TOKENLESS_EXPERTISE_OPERATOR_ACCOUNTS: "must-not-ship-expertise-accounts",
  };
  const output = validateTokenlessProductionReadiness({ env, activeRegistry: {} }).join("\n");
  assert.match(output, /NEXT_PUBLIC_TOKENLESS_COMPLIANCE_OPERATOR_SECRET is forbidden/);
  assert.match(output, /NEXT_PUBLIC_TOKENLESS_PIPELINE_TOKEN is forbidden/);
  assert.match(output, /NEXT_PUBLIC_TOKENLESS_GOLD_INJECTION_KEY_VERSION is forbidden/);
  assert.match(output, /NEXT_PUBLIC_TOKENLESS_GOLD_INJECTION_KEYS is forbidden/);
  assert.match(output, /NEXT_PUBLIC_TOKENLESS_KMS_KEY_RESOURCE is forbidden/);
  assert.match(output, /NEXT_PUBLIC_TOKENLESS_EXPERTISE_OPERATOR_ACCOUNTS is forbidden/);
  assert.doesNotMatch(output, /must-not-ship(?:-operator|-version|-keys|-kms-resource|-expertise-accounts)?/);
});

test("the tokenless test deployment rejects a keeper key shared with another signing role", () => {
  const base = {
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_PROJECT_ID: "prj_H6C2pfWKEAupFroHbLfzhquaNCLm",
    VERCEL_PROJECT_NAME: "rateloop-tokenless",
    VERCEL_GIT_COMMIT_REF: "tokenless",
    APP_URL: "https://rateloop-tokenless.vercel.app",
    NEXT_PUBLIC_APP_URL: "https://rateloop-tokenless.vercel.app",
    TOKENLESS_NETWORK_PANELS_ENABLED: "false",
    ...tokenlessTestRpc(),
    ...tokenlessTestPlatformSecrets(),
    ...tokenlessTestDatabase(),
    ...tokenlessGoldKeyring(),
    ...tokenlessTestOperationalSecrets(),
  };
  // The keeper signs settlement and the prepaid funder holds the prepaid pool. Sharing one key
  // between them hands the keeper that pool, and this path is the one every tokenless deployment
  // takes - the production-only reuse check never runs here.
  const shared = `0x${"c".repeat(64)}`;
  const reusedKeeper = validateTokenlessProductionReadiness({
    env: { ...base, TOKENLESS_PREPAID_FUNDER_PRIVATE_KEY: shared, TOKENLESS_KEEPER_PRIVATE_KEY: shared },
    activeRegistry: {},
  }).join("\n");
  assert.match(reusedKeeper, /Tokenless test key roles must be distinct/u);
  assert.match(reusedKeeper, /TOKENLESS_KEEPER_PRIVATE_KEY/u);

  const reusedEvidence = validateTokenlessProductionReadiness({
    env: {
      ...base,
      TOKENLESS_X402_RELAYER_PRIVATE_KEY: shared,
      TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY: shared,
    },
    activeRegistry: {},
  }).join("\n");
  assert.match(reusedEvidence, /Tokenless test key roles must be distinct/u);
  assert.match(reusedEvidence, /TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY/u);
});

test("the tokenless test deployment requires a dedicated server-only media preview key", () => {
  const base = {
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_PROJECT_ID: "prj_H6C2pfWKEAupFroHbLfzhquaNCLm",
    VERCEL_PROJECT_NAME: "rateloop-tokenless",
    VERCEL_GIT_COMMIT_REF: "tokenless",
    APP_URL: "https://rateloop-tokenless.vercel.app",
    NEXT_PUBLIC_APP_URL: "https://rateloop-tokenless.vercel.app",
    TOKENLESS_NETWORK_PANELS_ENABLED: "false",
    ...tokenlessTestRpc(),
    ...tokenlessTestPlatformSecrets(),
    ...tokenlessTestDatabase(),
    ...tokenlessGoldKeyring(),
    ...tokenlessTestOperationalSecrets(),
  };
  assert.match(
    validateTokenlessProductionReadiness({ env: base, activeRegistry: {} }).join("\n"),
    /TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET is required/u,
  );
  assert.match(
    validateTokenlessProductionReadiness({
      env: { ...base, TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET: "too-short" },
      activeRegistry: {},
    }).join("\n"),
    /must encode exactly 32 bytes/u,
  );
  assert.match(
    validateTokenlessProductionReadiness({
      env: { ...base, TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET: `${encodedKey(18)}=` },
      activeRegistry: {},
    }).join("\n"),
    /must encode exactly 32 bytes/u,
  );
  for (const secret of [encodedKey(18), "12".repeat(32)]) {
    assert.deepEqual(
      validateTokenlessProductionReadiness({
        env: { ...base, TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET: secret },
        activeRegistry: {},
      }),
      [],
    );
  }
  const reused = Buffer.from("r".repeat(32), "utf8");
  assert.match(
    validateTokenlessProductionReadiness({
      env: {
        ...base,
        TOKENLESS_MCP_RATE_LIMIT_SECRET: reused.toString("utf8"),
        TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET: reused.toString("base64url"),
      },
      activeRegistry: {},
    }).join("\n"),
    /Tokenless test key roles must be distinct/u,
  );
  const exposed = validateTokenlessProductionReadiness({
    env: {
      ...base,
      NEXT_PUBLIC_TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET: "do-not-print-preview-secret",
      TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET: encodedKey(18),
    },
    activeRegistry: {},
  }).join("\n");
  assert.match(exposed, /NEXT_PUBLIC_TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET is forbidden/u);
  assert.doesNotMatch(exposed, /do-not-print-preview-secret/u);
});

test("the tokenless test deployment validates the active gold-injection keyring and role separation", () => {
  const base = {
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_PROJECT_ID: "prj_H6C2pfWKEAupFroHbLfzhquaNCLm",
    VERCEL_PROJECT_NAME: "rateloop-tokenless",
    VERCEL_GIT_COMMIT_REF: "tokenless",
    APP_URL: "https://rateloop-tokenless.vercel.app",
    NEXT_PUBLIC_APP_URL: "https://rateloop-tokenless.vercel.app",
    TOKENLESS_NETWORK_PANELS_ENABLED: "false",
    ...tokenlessTestRpc(),
    ...tokenlessTestPlatformSecrets(),
    ...tokenlessTestDatabase(),
    TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET: encodedKey(18),
    ...tokenlessTestOperationalSecrets(),
  };
  const missing = validateTokenlessProductionReadiness({ env: base, activeRegistry: {} }).join("\n");
  assert.match(missing, /TOKENLESS_GOLD_INJECTION_KEY_VERSION is required/u);
  assert.match(missing, /TOKENLESS_GOLD_INJECTION_KEYS is required/u);

  assert.deepEqual(
    validateTokenlessProductionReadiness({ env: { ...base, ...tokenlessGoldKeyring() }, activeRegistry: {} }),
    [],
  );
  assert.match(
    validateTokenlessProductionReadiness({
      env: {
        ...base,
        TOKENLESS_GOLD_INJECTION_KEY_VERSION: "v2",
        TOKENLESS_GOLD_INJECTION_KEYS: JSON.stringify({ v1: encodedKey(16) }),
      },
      activeRegistry: {},
    }).join("\n"),
    /must contain the configured 32-byte current key/u,
  );
  assert.match(
    validateTokenlessProductionReadiness({
      env: {
        ...base,
        ...tokenlessGoldKeyring(18),
      },
      activeRegistry: {},
    }).join("\n"),
    /Tokenless test key roles must be distinct: TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET, TOKENLESS_GOLD_INJECTION/u,
  );
});

test("test and production deployments refuse server-held Feedback Bonus award authority", () => {
  const testEnv = {
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_PROJECT_ID: "prj_H6C2pfWKEAupFroHbLfzhquaNCLm",
    VERCEL_PROJECT_NAME: "rateloop-tokenless",
    VERCEL_GIT_COMMIT_REF: "tokenless",
    APP_URL: "https://rateloop-tokenless.vercel.app",
    NEXT_PUBLIC_APP_URL: "https://rateloop-tokenless.vercel.app",
    TOKENLESS_NETWORK_PANELS_ENABLED: "false",
    ...tokenlessTestRpc(),
    ...tokenlessTestPlatformSecrets(),
    ...tokenlessTestDatabase(),
    ...tokenlessGoldKeyring(),
    ...tokenlessTestOperationalSecrets(),
    TOKENLESS_FEEDBACK_BONUS_AWARDER_PRIVATE_KEY: "server-must-not-custody-human-awarder",
    NEXT_PUBLIC_TOKENLESS_FEEDBACK_BONUS_AWARD_WORKER_PRIVATE_KEY: "browser-must-not-see-worker-secret",
  };
  const testOutput = validateTokenlessProductionReadiness({ env: testEnv, activeRegistry: {} }).join("\n");
  assert.match(testOutput, /TOKENLESS_FEEDBACK_BONUS_AWARDER_PRIVATE_KEY is forbidden/);
  assert.match(testOutput, /NEXT_PUBLIC_TOKENLESS_FEEDBACK_BONUS_AWARD_WORKER_PRIVATE_KEY is forbidden/);
  assert.doesNotMatch(testOutput, /server-must-not-custody-human-awarder/);
  assert.doesNotMatch(testOutput, /browser-must-not-see-worker-secret/);

  const production = validFixture();
  production.env.TOKENLESS_FEEDBACK_BONUS_AWARD_WORKER_PRIVATE_KEY = "still-forbidden";
  production.env.NEXT_PUBLIC_TOKENLESS_FEEDBACK_BONUS_AWARDER_PRIVATE_KEY = "still-private";
  const productionOutput = validateTokenlessProductionReadiness(production).join("\n");
  assert.match(productionOutput, /TOKENLESS_FEEDBACK_BONUS_AWARD_WORKER_PRIVATE_KEY is forbidden/);
  assert.match(productionOutput, /NEXT_PUBLIC_TOKENLESS_FEEDBACK_BONUS_AWARDER_PRIVATE_KEY is forbidden/);
  assert.doesNotMatch(productionOutput, /still-forbidden|still-private/);
});

test("the production preflight runs before hosted migrations", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const build = packageJson.scripts.build;
  assert.ok(build.indexOf("check-tokenless-production-readiness.mjs") >= 0);
  assert.ok(build.indexOf("check-tokenless-production-readiness.mjs") < build.indexOf("migrate-hosted-database.mjs"));
});

test("hosted release accepts only a complete matching v4 bundle", () => {
  const fixture = validFixture();
  assert.deepEqual(validateTokenlessProductionReadiness(fixture), []);
  fixture.env.TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET = "12".repeat(32);
  assert.deepEqual(validateTokenlessProductionReadiness(fixture), []);
});

test("hosted release rejects invalid mixed-case EVM checksums", () => {
  const fixture = validFixture();
  fixture.env.TOKENLESS_FEEDBACK_BONUS_ADDRESS = "0xa0c1f730aad6b7cb78eAEacA39743F6430Dc57b0";
  assert.match(
    validateTokenlessProductionReadiness(fixture).join("\n"),
    /TOKENLESS_FEEDBACK_BONUS_ADDRESS must be a non-zero EVM address/,
  );
});

test("hosted release validates a dedicated server-only gold-injection keyring", () => {
  assert.ok(REQUIRED_TOKENLESS_PRODUCTION_VARIABLES.includes("TOKENLESS_GOLD_INJECTION_KEY_VERSION"));
  assert.ok(REQUIRED_TOKENLESS_PRODUCTION_VARIABLES.includes("TOKENLESS_GOLD_INJECTION_KEYS"));

  const missing = validFixture();
  delete missing.env.TOKENLESS_GOLD_INJECTION_KEY_VERSION;
  delete missing.env.TOKENLESS_GOLD_INJECTION_KEYS;
  const missingOutput = validateTokenlessProductionReadiness(missing).join("\n");
  assert.match(missingOutput, /TOKENLESS_GOLD_INJECTION_KEY_VERSION is required/);
  assert.match(missingOutput, /TOKENLESS_GOLD_INJECTION_KEYS is required/);

  const malformed = validFixture();
  malformed.env.TOKENLESS_GOLD_INJECTION_KEYS = JSON.stringify({ v1: encodedKey(16).slice(1) });
  assert.match(
    validateTokenlessProductionReadiness(malformed).join("\n"),
    /TOKENLESS_GOLD_INJECTION_KEYS must contain the configured 32-byte current key/,
  );

  const exposed = validFixture();
  exposed.env.NEXT_PUBLIC_TOKENLESS_GOLD_INJECTION_KEY_VERSION = "private-version";
  exposed.env.NEXT_PUBLIC_TOKENLESS_GOLD_INJECTION_KEYS = "private-keyring";
  const exposedOutput = validateTokenlessProductionReadiness(exposed).join("\n");
  assert.match(exposedOutput, /NEXT_PUBLIC_TOKENLESS_GOLD_INJECTION_KEY_VERSION is forbidden/);
  assert.match(exposedOutput, /NEXT_PUBLIC_TOKENLESS_GOLD_INJECTION_KEYS is forbidden/);
  assert.doesNotMatch(exposedOutput, /private-version|private-keyring/);

  const reused = validFixture();
  reused.env.TOKENLESS_GOLD_INJECTION_KEYS = JSON.stringify({
    v1: reused.env.TOKENLESS_PSEUDONYM_KEY,
  });
  assert.match(validateTokenlessProductionReadiness(reused).join("\n"), /Production key roles must be distinct/);
});

test("hosted release remains blocked while required product capabilities are incomplete", () => {
  const fixture = validFixture();
  delete fixture.releaseCapabilities;
  const errors = validateTokenlessProductionReadiness(fixture);
  assert.equal(DEFAULT_HOSTED_RELEASE_CAPABILITIES.platformSecretSigning, false);
  assert.match(errors.join("\n"), /platform-secret signing for credential issuance/i);
  assert.match(errors.join("\n"), /paid assignment reservation/i);
  assert.match(errors.join("\n"), /Feedback Bonus USDC and credential-issuer immutable wiring/i);
  assert.match(errors.join("\n"), /human-signed Feedback Bonus award execution/i);
  assert.match(errors.join("\n"), /Feedback Bonus transaction reconciliation and append-only receipt projection/i);
});

test("hosted release requires a dedicated Feedback Bonus escrow address", () => {
  for (const role of [
    "TOKENLESS_PANEL_ADDRESS",
    "TOKENLESS_CREDENTIAL_ISSUER_ADDRESS",
    "TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS",
    "TOKENLESS_USDC_ADDRESS",
    "TOKENLESS_FEE_RECIPIENT",
  ]) {
    const fixture = validFixture();
    fixture.env.TOKENLESS_FEEDBACK_BONUS_ADDRESS = fixture.env[role];
    assert.match(
      validateTokenlessProductionReadiness(fixture).join("\n"),
      new RegExp(`dedicated escrow address distinct from ${role}`, "i"),
    );
  }
});

test("hosted release rejects an empty active v4 registry", () => {
  const fixture = validFixture();
  fixture.activeRegistry = {};
  assert.match(
    validateTokenlessProductionReadiness(fixture).join("\n"),
    /active tokenless v4 registry must contain exactly the Base Sepolia deployment/i,
  );
});

test("hosted release fails closed before migrations without required config or active deployment", () => {
  const errors = validateTokenlessProductionReadiness({
    env: { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" },
    activeRegistry: {},
  });
  assert.match(errors.join("\n"), /TOKENLESS_DEPLOYMENT_KEY is required/);
  assert.match(errors.join("\n"), /WORLD_ID_RP_SIGNING_KEY is required/);
  assert.equal(
    errors.some(error => error.includes("configured-")),
    false,
  );
});

test("hosted release rejects in-memory and local database URLs", () => {
  for (const databaseUrl of ["memory:", "postgresql://localhost/rateloop", "configured-DATABASE_URL"]) {
    const fixture = validFixture();
    fixture.env.DATABASE_URL = databaseUrl;
    assert.match(
      validateTokenlessProductionReadiness(fixture).join("\n"),
      /DATABASE_URL must identify a non-local hosted Postgres database/,
    );
  }
});

test("hosted release rejects public secrets, reused roles, and mixed deployment identity without leaking values", () => {
  const fixture = validFixture();
  fixture.env.NEXT_PUBLIC_TOKENLESS_PIPELINE_TOKEN = "do-not-print-this";
  fixture.env.NEXT_PUBLIC_CRON_SECRET = "also-do-not-print-this";
  fixture.env.NEXT_PUBLIC_TOKENLESS_NOTIFICATION_UNSUBSCRIBE_SECRET = "unsubscribe-do-not-print-this";
  fixture.env.NEXT_PUBLIC_TOKENLESS_PSEUDONYM_KEY = "pseudonym-do-not-print-this";
  fixture.env.NEXT_PUBLIC_TOKENLESS_KMS_KEY_RESOURCE = "kms-resource-do-not-print-this";
  fixture.env.NEXT_PUBLIC_TOKENLESS_EXPERTISE_OPERATOR_ACCOUNTS = "expertise-accounts-do-not-print-this";
  fixture.env.NEXT_PUBLIC_TOKENLESS_WORM_S3_CREDENTIALS_JSON = "worm-do-not-print-this";
  fixture.env.NEXT_PUBLIC_TOKENLESS_GRC_CREDENTIALS_JSON = "grc-do-not-print-this";
  fixture.env.NEXT_PUBLIC_TOKENLESS_ATTESTATION_AWS_CREDENTIALS_JSON = "attestation-do-not-print-this";
  fixture.env.NEXT_PUBLIC_STRIPE_WEBHOOK_SECRET = "whsec_do-not-print-this";
  fixture.env.TOKENLESS_X402_RELAYER_PRIVATE_KEY = fixture.env.TOKENLESS_CREDENTIAL_ISSUER_SIGNER_PRIVATE_KEY;
  fixture.env.TOKENLESS_X402_RELAYER_EXPECTED_ADDRESS = fixture.env.TOKENLESS_CREDENTIAL_ISSUER_SIGNER_EXPECTED_ADDRESS;
  fixture.env.TOKENLESS_DEPLOYMENT_BLOCK = "124";
  const errors = validateTokenlessProductionReadiness(fixture);
  const output = errors.join("\n");
  assert.match(output, /NEXT_PUBLIC_TOKENLESS_PIPELINE_TOKEN is forbidden/);
  assert.match(output, /NEXT_PUBLIC_CRON_SECRET is forbidden/);
  assert.match(output, /NEXT_PUBLIC_TOKENLESS_NOTIFICATION_UNSUBSCRIBE_SECRET is forbidden/);
  assert.match(output, /NEXT_PUBLIC_TOKENLESS_PSEUDONYM_KEY is forbidden/);
  assert.match(output, /NEXT_PUBLIC_TOKENLESS_KMS_KEY_RESOURCE is forbidden/);
  assert.match(output, /NEXT_PUBLIC_TOKENLESS_EXPERTISE_OPERATOR_ACCOUNTS is forbidden/);
  assert.match(output, /NEXT_PUBLIC_TOKENLESS_WORM_S3_CREDENTIALS_JSON is forbidden/);
  assert.match(output, /NEXT_PUBLIC_TOKENLESS_GRC_CREDENTIALS_JSON is forbidden/);
  assert.match(output, /NEXT_PUBLIC_TOKENLESS_ATTESTATION_AWS_CREDENTIALS_JSON is forbidden/);
  assert.match(output, /NEXT_PUBLIC_STRIPE_WEBHOOK_SECRET is forbidden/);
  assert.match(output, /Platform signer EVM addresses must be distinct/);
  assert.match(output, /Production key roles must be distinct/);
  assert.match(output, /complete active tokenless v4 registry/);
  assert.doesNotMatch(output, /do-not-print-this/);
  assert.doesNotMatch(output, /also-do-not-print-this/);
  assert.doesNotMatch(output, /unsubscribe-do-not-print-this/);
  assert.doesNotMatch(output, /pseudonym-do-not-print-this/);
  assert.doesNotMatch(output, /kms-resource-do-not-print-this/);
  assert.doesNotMatch(output, /expertise-accounts-do-not-print-this/);
  assert.doesNotMatch(output, /worm-do-not-print-this/);
  assert.doesNotMatch(output, /grc-do-not-print-this/);
  assert.doesNotMatch(output, /whsec_do-not-print-this/);
  assert.doesNotMatch(output, /0x11111111/);
});

test("hosted release rejects migration-only artifact keys and AWS provider configuration", () => {
  const fixture = validFixture();
  fixture.env.TOKENLESS_ARTIFACT_MASTER_KEY = encodedKey(1);
  fixture.env.TOKENLESS_KMS_PROVIDER = "aws-kms";
  const output = validateTokenlessProductionReadiness(fixture).join("\n");
  assert.match(output, /TOKENLESS_ARTIFACT_MASTER_KEY is migration-only/);
  assert.match(output, /TOKENLESS_KMS_PROVIDER is forbidden/);
});

test("hosted release requires a dedicated pseudonym key at the platform-secret vault boundary", () => {
  const fixture = validFixture();
  fixture.env.TOKENLESS_PSEUDONYM_KEY = "too-short";
  assert.match(validateTokenlessProductionReadiness(fixture).join("\n"), /PSEUDONYM_KEY must encode exactly 32 bytes/);
});

test("hosted thirdweb wallet issuance is refused until export recovery is verifiable", () => {
  const missing = validFixture();
  missing.env.TOKENLESS_THIRDWEB_WALLET_ENABLED = "true";
  assert.match(
    validateTokenlessProductionReadiness(missing).join("\n"),
    /must remain false.*externally verifiable wallet export and recovery/i,
  );

  const enabledWithLegacyAws = validFixture();
  Object.assign(enabledWithLegacyAws.env, {
    TOKENLESS_THIRDWEB_WALLET_ENABLED: "true",
    NEXT_PUBLIC_THIRDWEB_CLIENT_ID: "public-client-id",
    TOKENLESS_THIRDWEB_WALLET_AUDIENCE: "thirdweb-project-audience",
    TOKENLESS_THIRDWEB_WALLET_KEY_ID: `ed25519:${"ab".repeat(12)}`,
    TOKENLESS_THIRDWEB_WALLET_KMS_KEY_RESOURCE:
      "arn:aws:kms:eu-central-1:123456789012:key/66666666-6666-6666-6666-666666666666",
    TOKENLESS_THIRDWEB_WALLET_KMS_REGION: "eu-central-1",
    TOKENLESS_THIRDWEB_WALLET_KMS_ROLE_ARN: "arn:aws:iam::123456789012:role/rateloop-wallet-jwt",
  });
  const output = validateTokenlessProductionReadiness(enabledWithLegacyAws).join("\n");
  assert.match(output, /must remain false.*externally verifiable wallet export and recovery/i);
  assert.match(output, /TOKENLESS_THIRDWEB_WALLET_KMS_KEY_RESOURCE is forbidden/i);
});

test("hosted release requires a thirdweb client ID while managed wallet issuance remains disabled", () => {
  const fixture = validFixture();
  fixture.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID = "";
  const output = validateTokenlessProductionReadiness(fixture).join("\n");
  assert.match(output, /NEXT_PUBLIC_THIRDWEB_CLIENT_ID is required.*self-custodial funding and payout/i);
  assert.doesNotMatch(output, /must remain false.*export and recovery/i);
});

test("hosted release requires valid server-only Stripe configuration only when subscriptions are enabled", () => {
  const disabled = validFixture();
  assert.deepEqual(validateTokenlessProductionReadiness(disabled), []);

  const missing = validFixture();
  missing.env.TOKENLESS_SUBSCRIPTIONS_ENABLED = "true";
  const missingOutput = validateTokenlessProductionReadiness(missing).join("\n");
  assert.match(missingOutput, /STRIPE_SECRET_KEY is required/);
  assert.match(missingOutput, /STRIPE_WEBHOOK_SECRET is required/);
  assert.match(missingOutput, /STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID is required/);

  const valid = validFixture();
  Object.assign(valid.env, {
    TOKENLESS_SUBSCRIPTIONS_ENABLED: "true",
    STRIPE_SECRET_KEY: `sk_live_${"a".repeat(32)}`,
    STRIPE_WEBHOOK_SECRET: `whsec_${"b".repeat(32)}`,
    STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID: `price_${"c".repeat(24)}`,
  });
  assert.deepEqual(validateTokenlessProductionReadiness(valid), []);

  valid.env.STRIPE_SECRET_KEY = `sk_test_${"d".repeat(32)}`;
  assert.match(validateTokenlessProductionReadiness(valid).join("\n"), /live-mode secret/);
});

test("prepaid top-ups require the live USD invoice rail when enabled", () => {
  const missing = validFixture();
  missing.env.TOKENLESS_PREPAID_TOPUP_ENABLED = "true";
  const output = validateTokenlessProductionReadiness(missing).join("\n");
  assert.match(output, /STRIPE_PREPAID_TOPUP_TAX_CODE is required/);
  assert.match(output, /STRIPE_PREPAID_TOPUP_BANK_TRANSFER_TYPE is required/);

  const valid = validFixture();
  Object.assign(valid.env, {
    TOKENLESS_PREPAID_TOPUP_ENABLED: "true",
    STRIPE_SECRET_KEY: `sk_live_${"a".repeat(32)}`,
    STRIPE_WEBHOOK_SECRET: `whsec_${"b".repeat(32)}`,
    STRIPE_PREPAID_TOPUP_TAX_CODE: "txcd_10103000",
    STRIPE_PREPAID_TOPUP_BANK_TRANSFER_TYPE: "us_bank_transfer",
  });
  assert.deepEqual(validateTokenlessProductionReadiness(valid), []);
});

test("enterprise identity requires explicit HTTPS OIDC issuer origins", () => {
  const missing = validFixture();
  missing.env.TOKENLESS_ENTERPRISE_IDENTITY_ENABLED = "true";
  delete missing.env.TOKENLESS_SSO_TRUSTED_ISSUERS;
  assert.match(validateTokenlessProductionReadiness(missing).join("\n"), /TOKENLESS_SSO_TRUSTED_ISSUERS is required/);

  const disabled = validFixture();
  disabled.env.TOKENLESS_ENTERPRISE_IDENTITY_ENABLED = "false";
  assert.match(
    validateTokenlessProductionReadiness(disabled).join("\n"),
    /TOKENLESS_ENTERPRISE_IDENTITY_ENABLED must be true in production/,
  );

  const valid = validFixture();
  valid.env.TOKENLESS_ENTERPRISE_IDENTITY_ENABLED = "true";
  valid.env.TOKENLESS_SSO_TRUSTED_ISSUERS = "https://login.example.com";
  assert.deepEqual(validateTokenlessProductionReadiness(valid), []);
});
const { derivePaidLaneActivationReference } = paidLaneActivationModule.default ?? paidLaneActivationModule;
