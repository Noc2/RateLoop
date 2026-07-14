import {
  DEFAULT_NON_SANDBOX_RELEASE_CAPABILITIES,
  REQUIRED_TOKENLESS_PRODUCTION_VARIABLES,
  validateTokenlessProductionReadiness,
} from "./check-tokenless-production-readiness.mjs";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const address = index => `0x${index.toString(16).padStart(40, "0")}`;
const encodedKey = index => Buffer.alloc(32, index).toString("base64url");

function validFixture() {
  const panel = address(1);
  const issuer = address(2);
  const adapter = address(3);
  const usdc = address(4);
  const deploymentKey = `tokenless-v3:84532:${panel}:${issuer}:${adapter}`;
  const evidence = generateKeyPairSync("ed25519");
  const provider = generateKeyPairSync("ed25519");
  const env = Object.fromEntries(REQUIRED_TOKENLESS_PRODUCTION_VARIABLES.map(name => [name, `configured-${name}`]));
  Object.assign(env, {
    VERCEL_ENV: "production",
    TOKENLESS_SANDBOX_MODE: "false",
    APP_URL: "https://rateloop-tokenless.vercel.app",
    NEXT_PUBLIC_APP_URL: "https://rateloop-tokenless.vercel.app",
    BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org",
    NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org",
    TOKENLESS_ELIGIBILITY_PROVIDER_START_URL: "https://eligibility.example/start",
    TOKENLESS_PONDER_URL: "https://tokenless-ponder.example",
    TOKENLESS_DEPLOYMENT_SCHEMA: "rateloop-tokenless-deployment-v3",
    TOKENLESS_CHAIN_ID: "84532",
    TOKENLESS_DEPLOYMENT_KEY: deploymentKey,
    TOKENLESS_DEPLOYMENT_BLOCK: "123",
    TOKENLESS_PANEL_ADDRESS: panel,
    TOKENLESS_CREDENTIAL_ISSUER_ADDRESS: issuer,
    TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS: adapter,
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
    WORLD_ID_RP_SIGNING_KEY: `0x${"44".repeat(32)}`,
    WORLD_ID_APP_ID: "app_production123",
    WORLD_ID_RP_ID: "rp_production123",
    WORLD_ID_ENVIRONMENT: "production",
    TOKENLESS_NETWORK_PANELS_ENABLED: "true",
    TOKENLESS_DAC7_POLICY: "eu",
    TOKENLESS_ARTIFACT_MASTER_KEY: encodedKey(1),
    TOKENLESS_EVIDENCE_TENANT_COMMITMENT_KEY: encodedKey(9),
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
    TOKENLESS_PIPELINE_TOKEN: "p".repeat(32),
    THIRDWEB_SECRET_KEY: "t".repeat(32),
  });
  const keyrings = [
    ["TOKENLESS_ASSURANCE_RATIONALE_VAULT", 2, "base64url"],
    ["TOKENLESS_ASSURANCE_REVIEWER_MAPPING", 3, "base64url"],
    ["TOKENLESS_PROVIDER_EVIDENCE_VAULT", 4, "base64"],
    ["TOKENLESS_TAX_VAULT", 5, "base64"],
    ["TOKENLESS_VOTE_MAPPING_VAULT", 6, "base64"],
    ["TOKENLESS_PROVIDER_SUBJECT_HMAC", 7, "base64url"],
    ["TOKENLESS_WORLD_ID_EVIDENCE", 8, "base64url"],
  ];
  for (const [prefix, fill, encoding] of keyrings) {
    env[`${prefix}_KEY_VERSION`] = "v1";
    env[`${prefix}_KEYS`] = JSON.stringify({ v1: Buffer.alloc(32, fill).toString(encoding) });
  }
  return {
    env,
    releaseCapabilities: Object.fromEntries(
      Object.keys(DEFAULT_NON_SANDBOX_RELEASE_CAPABILITIES).map(capability => [capability, true]),
    ),
    activeRegistry: {
      84532: {
        schemaVersion: "rateloop-tokenless-deployment-v3",
        deploymentComplete: true,
        deploymentBlockNumber: 123,
        deploymentKey,
        contracts: {
          TokenlessPanel: { address: panel },
          CredentialIssuer: { address: issuer },
          X402PanelSubmitter: { address: adapter },
          TestUSDC: { address: usdc },
        },
      },
    },
  };
}

test("sandbox production and non-hosted builds do not require live credentials", () => {
  assert.deepEqual(
    validateTokenlessProductionReadiness({
      env: { VERCEL_ENV: "production", TOKENLESS_SANDBOX_MODE: "true" },
      activeRegistry: {},
    }),
    [],
  );
  assert.deepEqual(validateTokenlessProductionReadiness({ env: {}, activeRegistry: {} }), []);
});

test("the production preflight runs before hosted migrations", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const build = packageJson.scripts.build;
  assert.ok(build.indexOf("check-tokenless-production-readiness.mjs") >= 0);
  assert.ok(build.indexOf("check-tokenless-production-readiness.mjs") < build.indexOf("migrate-hosted-database.mjs"));
});

test("non-sandbox production accepts only a complete matching v3 bundle", () => {
  const fixture = validFixture();
  assert.deepEqual(validateTokenlessProductionReadiness(fixture), []);
});

test("non-sandbox production remains blocked while required product capabilities are incomplete", () => {
  const fixture = validFixture();
  delete fixture.releaseCapabilities;
  const errors = validateTokenlessProductionReadiness(fixture);
  assert.match(errors.join("\n"), /managed signing/i);
  assert.match(errors.join("\n"), /paid assignment reservation/i);
});

test("non-sandbox production rejects an empty active v3 registry", () => {
  const fixture = validFixture();
  fixture.activeRegistry = {};
  assert.match(
    validateTokenlessProductionReadiness(fixture).join("\n"),
    /active tokenless v3 registry must contain exactly the Base Sepolia deployment/i,
  );
});

test("non-sandbox production fails closed before migrations without required config or active deployment", () => {
  const errors = validateTokenlessProductionReadiness({
    env: { VERCEL_ENV: "production", TOKENLESS_SANDBOX_MODE: "false" },
    activeRegistry: {},
  });
  assert.match(errors.join("\n"), /TOKENLESS_DEPLOYMENT_KEY is required/);
  assert.match(errors.join("\n"), /WORLD_ID_RP_SIGNING_KEY is required/);
  assert.equal(
    errors.some(error => error.includes("configured-")),
    false,
  );
});

test("non-sandbox production rejects public secrets, reused roles, and mixed deployment identity without leaking values", () => {
  const fixture = validFixture();
  fixture.env.NEXT_PUBLIC_TOKENLESS_PIPELINE_TOKEN = "do-not-print-this";
  fixture.env.TOKENLESS_X402_RELAYER_PRIVATE_KEY = fixture.env.TOKENLESS_CREDENTIAL_ISSUER_SIGNER_PRIVATE_KEY;
  fixture.env.TOKENLESS_DEPLOYMENT_BLOCK = "124";
  const errors = validateTokenlessProductionReadiness(fixture);
  const output = errors.join("\n");
  assert.match(output, /NEXT_PUBLIC_TOKENLESS_PIPELINE_TOKEN is forbidden/);
  assert.match(output, /Production key roles must be distinct/);
  assert.match(output, /complete active tokenless v3 registry/);
  assert.doesNotMatch(output, /do-not-print-this/);
  assert.doesNotMatch(output, /0x11111111/);
});
