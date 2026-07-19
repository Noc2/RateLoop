import { beforeAll, describe, expect, it } from "vitest";

const PANEL = "0x0000000000000000000000000000000000000011";
const ISSUER = "0x0000000000000000000000000000000000000022";
const FEEDBACK_BONUS = "0x0000000000000000000000000000000000000033";
const BEACON_VERIFIER = "0x0000000000000000000000000000000000000044";
const KEEPER = "0x0000000000000000000000000000000000000055";
const ZERO = "0x0000000000000000000000000000000000000000";
const KMS_KEY_ARN =
  "arn:aws:kms:eu-central-1:123456789012:key/11111111-1111-1111-1111-111111111111";
const KMS_ROLE_ARN =
  "arn:aws:iam::123456789012:role/rateloop-tokenless-keeper";

let loadConfig: typeof import("../config.js").loadConfig;
let buildTokenlessDeploymentKey: typeof import("../config.js").buildTokenlessDeploymentKey;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.CHAIN_ID = "31337";
  process.env.RPC_URL = "http://127.0.0.1:8545";
  process.env.TOKENLESS_PANEL_ADDRESS = PANEL;
  process.env.TOKENLESS_CREDENTIAL_ISSUER_ADDRESS = ISSUER;
  process.env.TOKENLESS_FEEDBACK_BONUS_ADDRESS = FEEDBACK_BONUS;
  process.env.TOKENLESS_BEACON_VERIFIER_ADDRESS = BEACON_VERIFIER;
  process.env.TOKENLESS_DEPLOYMENT_KEY = `tokenless-v4:31337:${PANEL}:${ISSUER}:${ZERO}:${FEEDBACK_BONUS}`;
  process.env.KEEPER_PRIVATE_KEY = `0x${"11".repeat(32)}`;
  ({ loadConfig, buildTokenlessDeploymentKey } = await import("../config.js"));
});

function productionEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    TOKENLESS_HOME_REGION: "eu",
    RAILWAY_REPLICA_REGION: "europe-west4-drams3a",
    RAILWAY_PROJECT_ID: "prj-tokenless-eu",
    TOKENLESS_RAILWAY_PROJECT_ID: "prj-tokenless-eu",
    RAILWAY_SERVICE_ID: "svc-tokenless-keeper-eu",
    TOKENLESS_KEEPER_SERVICE_ID: "svc-tokenless-keeper-eu",
    CHAIN_ID: "84532",
    RPC_URL: "https://sepolia.base.org",
    RPC_FALLBACK_URLS: "https://base-sepolia-fallback.example",
    TOKENLESS_PANEL_ADDRESS: PANEL,
    TOKENLESS_CREDENTIAL_ISSUER_ADDRESS: ISSUER,
    TOKENLESS_FEEDBACK_BONUS_ADDRESS: FEEDBACK_BONUS,
    TOKENLESS_BEACON_VERIFIER_ADDRESS: BEACON_VERIFIER,
    TOKENLESS_DEPLOYMENT_KEY: `tokenless-v4:84532:${PANEL}:${ISSUER}:${ZERO}:${FEEDBACK_BONUS}`,
    TOKENLESS_DEPLOYMENT_BLOCK: "123",
    TOKENLESS_PONDER_URL: "https://tokenless-ponder.example",
    PONDER_KEEPER_WORK_TOKEN: "keeper-work-secret",
    TOKENLESS_KEEPER_KMS_KEY_RESOURCE: KMS_KEY_ARN,
    TOKENLESS_KEEPER_KMS_EXPECTED_ADDRESS: KEEPER,
    TOKENLESS_KEEPER_KMS_REGION: "eu-central-1",
    TOKENLESS_KEEPER_KMS_ROLE_ARN: KMS_ROLE_ARN,
    AWS_ROLE_ARN: KMS_ROLE_ARN,
    AWS_WEB_IDENTITY_TOKEN_FILE:
      "/var/run/secrets/rateloop/aws-oidc-token",
    METRICS_BIND_ADDRESS: "0.0.0.0",
    METRICS_AUTH_TOKEN: "0123456789abcdef",
  };
}

describe("tokenless keeper config", () => {
  it("builds the versioned isolated deployment identity", () => {
    expect(
      buildTokenlessDeploymentKey({
        chainId: 84532,
        panel: PANEL,
        credentialIssuer: ISSUER,
        feedbackBonus: FEEDBACK_BONUS,
      }),
    ).toBe(`tokenless-v4:84532:${PANEL}:${ISSUER}:${ZERO}:${FEEDBACK_BONUS}`);
  });

  it("accepts a complete Base Sepolia deployment", () => {
    const config = loadConfig(productionEnv());
    expect(config.chainId).toBe(84532);
    expect(config.deployment.blockNumber).toBe(123n);
    expect(config.deployment.panel).toBe(PANEL);
    expect(config.signer).toEqual({
      kind: "aws-kms",
      expectedAddress: KEEPER,
      keyResource: KMS_KEY_ARN,
      region: "eu-central-1",
      roleArn: KMS_ROLE_ARN,
      roleSessionName: "rateloop-tokenless-keeper",
      webIdentityTokenFile: "/var/run/secrets/rateloop/aws-oidc-token",
    });
    expect(config.rpcFallbackUrls).toEqual([
      "https://base-sepolia-fallback.example/",
    ]);
  });

  it("requires a nonzero deployment block in production", () => {
    expect(() =>
      loadConfig({ ...productionEnv(), TOKENLESS_DEPLOYMENT_BLOCK: "0" }),
    ).toThrow(/TOKENLESS_DEPLOYMENT_BLOCK must be positive/);
  });

  it("fails closed when the v4 feedback bonus address is missing", () => {
    expect(() =>
      loadConfig({
        ...productionEnv(),
        TOKENLESS_FEEDBACK_BONUS_ADDRESS: undefined,
      }),
    ).toThrow(/TOKENLESS_FEEDBACK_BONUS_ADDRESS is required/);
  });

  it("rejects mainnet and mixed deployment keys", () => {
    expect(() => loadConfig({ ...productionEnv(), CHAIN_ID: "8453" })).toThrow(
      /CHAIN_ID must be 31337 or 84532/,
    );
    expect(() =>
      loadConfig({
        ...productionEnv(),
        TOKENLESS_DEPLOYMENT_KEY: `tokenless-v2:84532:${PANEL}:${ISSUER}:${ZERO}`,
      }),
    ).toThrow(/does not match/);
  });

  it("requires HTTPS and authenticated hosted metrics", () => {
    expect(() =>
      loadConfig({
        ...productionEnv(),
        RPC_URL: "http://sepolia.example",
        METRICS_AUTH_TOKEN: "short",
      }),
    ).toThrow(/RPC_URL must use HTTPS/);
  });

  it("requires an independent HTTPS RPC fallback in production", () => {
    expect(() =>
      loadConfig({ ...productionEnv(), RPC_FALLBACK_URLS: undefined }),
    ).toThrow(/must contain at least one independent HTTPS RPC/);
    expect(() =>
      loadConfig({
        ...productionEnv(),
        RPC_FALLBACK_URLS: "http://fallback.example",
      }),
    ).toThrow(/RPC_FALLBACK_URLS must use HTTPS/);
    expect(() =>
      loadConfig({
        ...productionEnv(),
        RPC_FALLBACK_URLS: "https://sepolia.base.org",
      }),
    ).toThrow(/must be distinct/);
  });

  it("does not allow hosted gas-balance alerting to be disabled", () => {
    expect(() =>
      loadConfig({ ...productionEnv(), MIN_GAS_BALANCE_WEI: "0" }),
    ).toThrow(/MIN_GAS_BALANCE_WEI must be positive in production/);
  });

  it("requires the exact EU Railway runtime identity", () => {
    const verifiedEu = productionEnv();
    expect(loadConfig(verifiedEu).chainId).toBe(84532);
    expect(() =>
      loadConfig({ ...verifiedEu, RAILWAY_REPLICA_REGION: "us-east4-eqdc4a" }),
    ).toThrow(/RAILWAY_REPLICA_REGION must be europe-west4-drams3a/);
    expect(() =>
      loadConfig({ ...verifiedEu, RAILWAY_SERVICE_ID: "legacy-keeper" }),
    ).toThrow(/RAILWAY_SERVICE_ID must match TOKENLESS_KEEPER_SERVICE_ID/);
  });

  it("requires a complete web-identity KMS signer in production", () => {
    expect(() =>
      loadConfig({
        ...productionEnv(),
        AWS_WEB_IDENTITY_TOKEN_FILE: undefined,
      }),
    ).toThrow(/AWS_WEB_IDENTITY_TOKEN_FILE is required/);
    expect(() =>
      loadConfig({
        ...productionEnv(),
        TOKENLESS_KEEPER_KMS_EXPECTED_ADDRESS: ZERO,
      }),
    ).toThrow(/must be a non-zero address/);
    expect(() =>
      loadConfig({
        ...productionEnv(),
        TOKENLESS_KEEPER_KMS_KEY_RESOURCE: "alias/tokenless-keeper",
      }),
    ).toThrow(/must be an exact AWS KMS key ARN/);
  });

  it("binds the KMS key, role, and region to the configured keeper", () => {
    expect(() =>
      loadConfig({
        ...productionEnv(),
        TOKENLESS_KEEPER_KMS_REGION: "us-east-1",
      }),
    ).toThrow(/must be an EU AWS region/);
    expect(() =>
      loadConfig({
        ...productionEnv(),
        AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/different-role",
      }),
    ).toThrow(/AWS_ROLE_ARN must match/);
  });

  it("forbids raw keeper and AWS credentials in production", () => {
    expect(() =>
      loadConfig({
        ...productionEnv(),
        KEEPER_PRIVATE_KEY: `0x${"22".repeat(32)}`,
      }),
    ).toThrow(/forbids KEYSTORE_ACCOUNT and KEEPER_PRIVATE_KEY/);
    expect(() =>
      loadConfig({
        ...productionEnv(),
        AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
        AWS_SECRET_ACCESS_KEY: "not-a-production-secret",
      }),
    ).toThrow(/forbids static AWS credential environment variables/);
  });
});
