import { manifestDigest, tokenlessEuDeploymentManifest } from "../../../scripts/validate-tokenless-eu-deployment.mjs";
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

const address = index => `0x${index.toString(16).padStart(40, "0")}`;
const encodedKey = index => Buffer.alloc(32, index).toString("base64url");
const tokenlessGoldKeyring = (index = 16) => ({
  TOKENLESS_GOLD_INJECTION_KEY_VERSION: "v1",
  TOKENLESS_GOLD_INJECTION_KEYS: JSON.stringify({ v1: encodedKey(index) }),
});
const tokenlessTestDatabase = () => {
  const DATABASE_URL = "postgresql://rateloop:secret@tokenless-db.example/tokenless?sslmode=require";
  return { DATABASE_URL, TOKENLESS_DATABASE_IDENTITY: deriveHostedDatabaseIdentity(DATABASE_URL) };
};

function validFixture() {
  const panel = address(1);
  const issuer = address(2);
  const adapter = address(3);
  const usdc = address(4);
  const feedbackBonus = address(6);
  const deploymentKey = `tokenless-v4:84532:${panel}:${issuer}:${adapter}:${feedbackBonus}`;
  const evidence = generateKeyPairSync("ed25519");
  const provider = generateKeyPairSync("ed25519");
  const deploymentManifestSigner = generateKeyPairSync("ed25519");
  const euManifestDigest = manifestDigest();
  const env = Object.fromEntries(REQUIRED_TOKENLESS_PRODUCTION_VARIABLES.map(name => [name, `configured-${name}`]));
  Object.assign(env, {
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_REF: "main",
    TOKENLESS_DATA_PLANE_MODE: "verified-eu",
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
    TOKENLESS_USDC_ADDRESS: usdc,
    TOKENLESS_USDC_EIP712_NAME: "RateLoop Tokenless Test USDC",
    TOKENLESS_USDC_EIP712_VERSION: "2",
    TOKENLESS_FEE_RECIPIENT: address(5),
    TOKENLESS_REVEAL_WINDOW_SECONDS: "120",
    TOKENLESS_BEACON_FAILURE_GRACE_SECONDS: "300",
    TOKENLESS_CLAIM_GRACE_PERIOD_SECONDS: "604800",
    TOKENLESS_VOUCHER_ISSUER_EPOCH: "1",
    TOKENLESS_WORLD_ID_CREDENTIAL_MIN_TTL_SECONDS: "2592000",
    TOKENLESS_CREDENTIAL_ISSUER_SIGNER_PRIVATE_KEY: `0x${"11".repeat(32)}`,
    TOKENLESS_X402_RELAYER_PRIVATE_KEY: `0x${"22".repeat(32)}`,
    TOKENLESS_PREPAID_FUNDER_PRIVATE_KEY: `0x${"33".repeat(32)}`,
    TOKENLESS_SURPRISE_BONUS_FUNDER_PRIVATE_KEY: `0x${"55".repeat(32)}`,
    WORLD_ID_RP_SIGNING_KEY: `0x${"44".repeat(32)}`,
    WORLD_ID_APP_ID: "app_production123",
    WORLD_ID_RP_ID: "rp_production123",
    WORLD_ID_ENVIRONMENT: "production",
    TOKENLESS_NETWORK_PANELS_ENABLED: "true",
    TOKENLESS_SUBSCRIPTIONS_ENABLED: "false",
    TOKENLESS_PREPAID_TOPUP_ENABLED: "false",
    TOKENLESS_ENTERPRISE_IDENTITY_ENABLED: "false",
    TOKENLESS_DAC7_POLICY: "eu",
    TOKENLESS_EVIDENCE_TENANT_COMMITMENT_KEY: encodedKey(9),
    TOKENLESS_PSEUDONYM_KEY: encodedKey(14),
    TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY: encodedKey(10),
    TOKENLESS_WEBHOOK_ENCRYPTION_KEY: encodedKey(11),
    TOKENLESS_ELIGIBILITY_HANDOFF_SECRET: Buffer.alloc(32, 12).toString("base64"),
    TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY: evidence.privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64url"),
    TOKENLESS_EVIDENCE_SIGNING_KEY_ID: `ed25519:${createHash("sha256")
      .update(evidence.publicKey.export({ format: "der", type: "spki" }))
      .digest("hex")
      .slice(0, 24)}`,
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
    env[resource.regionEnv] = resource.region;
    if (resource.accessEnv) env[resource.accessEnv] = resource.expectedAccess;
    if (resource.providerEnv) env[resource.providerEnv] = resource.allowedProviders[0];
  }
  for (const [name, processor] of Object.entries(tokenlessEuDeploymentManifest.externalProcessors)) {
    env[processor.evidenceEnv] = `approved-${name}-evidence`;
    if (processor.deliveryRegionEnv) env[processor.deliveryRegionEnv] = processor.deliveryRegion;
  }
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

test("main hosted builds fail closed while local builds skip the release gate", () => {
  for (const env of [
    { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" },
    { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "main" },
    { VERCEL: "1", VERCEL_GIT_COMMIT_REF: "main" },
  ]) {
    const errors = validateTokenlessProductionReadiness({ env, activeRegistry: {} });
    assert.match(errors.join("\n"), /APP_URL is required for a hosted release/);
    assert.match(errors.join("\n"), /managed signing/i);
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
    ...tokenlessTestDatabase(),
    TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET: encodedKey(18),
    ...tokenlessGoldKeyring(),
  };
  assert.deepEqual(validateTokenlessProductionReadiness({ env, activeRegistry: {} }), []);
  const cliDeploymentEnv = { ...env };
  delete cliDeploymentEnv.VERCEL_GIT_COMMIT_REF;
  assert.deepEqual(validateTokenlessProductionReadiness({ env: cliDeploymentEnv, activeRegistry: {} }), []);

  for (const [name, invalidValue, expected] of [
    ["VERCEL_ENV", "preview", /production target/i],
    ["VERCEL_PROJECT_ID", "prj_legacy", /requires Vercel project prj_H6C2/i],
    ["VERCEL_PROJECT_NAME", "rate-loop-nextjs", /requires Vercel project rateloop-tokenless/i],
    ["APP_URL", "https://rateloop.ai", /must remain https:\/\/rateloop-tokenless\.vercel\.app/i],
    ["NEXT_PUBLIC_APP_URL", "https://www.rateloop.ai", /must remain https:\/\/rateloop-tokenless\.vercel\.app/i],
    ["TOKENLESS_NETWORK_PANELS_ENABLED", "true", /must remain false/i],
  ]) {
    const invalid = { ...env, [name]: invalidValue };
    assert.match(validateTokenlessProductionReadiness({ env: invalid, activeRegistry: {} }).join("\n"), expected);
  }

  const mainErrors = validateTokenlessProductionReadiness({
    env: { ...env, VERCEL_GIT_COMMIT_REF: "main" },
    activeRegistry: {},
  }).join("\n");
  assert.match(mainErrors, /managed signing/i);
  assert.match(mainErrors, /APP_URL is required for a hosted release|TOKENLESS_DATA_PLANE_MODE/u);
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
    ...tokenlessTestDatabase(),
    TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET: encodedKey(18),
    ...tokenlessGoldKeyring(),
    NEXT_PUBLIC_TOKENLESS_PIPELINE_TOKEN: "must-not-ship",
    NEXT_PUBLIC_TOKENLESS_GOLD_INJECTION_KEY_VERSION: "must-not-ship-version",
    NEXT_PUBLIC_TOKENLESS_GOLD_INJECTION_KEYS: "must-not-ship-keys",
    NEXT_PUBLIC_TOKENLESS_KMS_KEY_RESOURCE: "must-not-ship-kms-resource",
    NEXT_PUBLIC_TOKENLESS_EXPERTISE_OPERATOR_ACCOUNTS: "must-not-ship-expertise-accounts",
  };
  const output = validateTokenlessProductionReadiness({ env, activeRegistry: {} }).join("\n");
  assert.match(output, /NEXT_PUBLIC_TOKENLESS_PIPELINE_TOKEN is forbidden/);
  assert.match(output, /NEXT_PUBLIC_TOKENLESS_GOLD_INJECTION_KEY_VERSION is forbidden/);
  assert.match(output, /NEXT_PUBLIC_TOKENLESS_GOLD_INJECTION_KEYS is forbidden/);
  assert.match(output, /NEXT_PUBLIC_TOKENLESS_KMS_KEY_RESOURCE is forbidden/);
  assert.match(output, /NEXT_PUBLIC_TOKENLESS_EXPERTISE_OPERATOR_ACCOUNTS is forbidden/);
  assert.doesNotMatch(output, /must-not-ship(?:-version|-keys|-kms-resource|-expertise-accounts)?/);
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
    ...tokenlessTestDatabase(),
    ...tokenlessGoldKeyring(),
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
    ...tokenlessTestDatabase(),
    TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET: encodedKey(18),
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
    ...tokenlessTestDatabase(),
    ...tokenlessGoldKeyring(),
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
  assert.match(errors.join("\n"), /managed signing/i);
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

test("hosted release rejects local artifact keys and non-managed vault providers", () => {
  const fixture = validFixture();
  fixture.env.TOKENLESS_ARTIFACT_MASTER_KEY = encodedKey(1);
  fixture.env.TOKENLESS_KMS_PROVIDER = "local";
  const output = validateTokenlessProductionReadiness(fixture).join("\n");
  assert.match(output, /TOKENLESS_ARTIFACT_MASTER_KEY is forbidden/);
  assert.match(output, /TOKENLESS_KMS_PROVIDER must select an approved managed provider/);
});

test("hosted release requires a dedicated pseudonym key at the managed-vault boundary", () => {
  const fixture = validFixture();
  fixture.env.TOKENLESS_PSEUDONYM_KEY = "too-short";
  assert.match(validateTokenlessProductionReadiness(fixture).join("\n"), /PSEUDONYM_KEY must encode exactly 32 bytes/);
});

test("optional thirdweb wallet issuance is gated separately from Better Auth", () => {
  const missing = validFixture();
  missing.env.TOKENLESS_THIRDWEB_WALLET_ENABLED = "true";
  assert.match(
    validateTokenlessProductionReadiness(missing).join("\n"),
    /TOKENLESS_THIRDWEB_WALLET_PRIVATE_JWK is required/i,
  );

  const { privateKey } = generateKeyPairSync("ed25519");
  const enabled = validFixture();
  Object.assign(enabled.env, {
    TOKENLESS_THIRDWEB_WALLET_ENABLED: "true",
    NEXT_PUBLIC_THIRDWEB_CLIENT_ID: "public-client-id",
    TOKENLESS_THIRDWEB_WALLET_AUDIENCE: "thirdweb-project-audience",
    TOKENLESS_THIRDWEB_WALLET_KEY_ID: "rateloop-wallet-v1",
    TOKENLESS_THIRDWEB_WALLET_PRIVATE_JWK: JSON.stringify(privateKey.export({ format: "jwk" })),
  });
  assert.deepEqual(validateTokenlessProductionReadiness(enabled), []);
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
  assert.match(validateTokenlessProductionReadiness(missing).join("\n"), /TOKENLESS_SSO_TRUSTED_ISSUERS is required/);

  const valid = validFixture();
  valid.env.TOKENLESS_ENTERPRISE_IDENTITY_ENABLED = "true";
  valid.env.TOKENLESS_SSO_TRUSTED_ISSUERS = "https://login.example.com";
  assert.deepEqual(validateTokenlessProductionReadiness(valid), []);
});
