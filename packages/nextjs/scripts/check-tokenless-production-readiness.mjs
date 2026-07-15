import { validateTokenlessEuDeployment } from "../../../scripts/validate-tokenless-eu-deployment.mjs";
import {
  tokenlessDeployedContracts,
  tokenlessDeploymentSchema,
} from "../../contracts/src/tokenless/deployedContracts.ts";
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_SEPOLIA_CHAIN_ID = 84_532;
const DEPLOYMENT_SCHEMA = "rateloop-tokenless-deployment-v3";
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/u;

export const DEFAULT_NON_SANDBOX_RELEASE_CAPABILITIES = Object.freeze({
  managedSigning: false,
  paidAssignmentSettlement: false,
});

const NON_SANDBOX_RELEASE_CAPABILITY_LABELS = Object.freeze({
  managedSigning: "managed signing for credential issuance and chain transactions",
  paidAssignmentSettlement: "paid assignment reservation, voucher, commit, and settlement orchestration",
});

export const REQUIRED_TOKENLESS_PRODUCTION_VARIABLES = [
  "APP_URL",
  "NEXT_PUBLIC_APP_URL",
  "DATABASE_URL",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_PASSKEY_RP_ID",
  "TOKENLESS_THIRDWEB_WALLET_ENABLED",
  "BLOB_READ_WRITE_TOKEN",
  "TOKENLESS_KMS_PROVIDER",
  "TOKENLESS_KMS_KEY_RESOURCE",
  "TOKENLESS_ARTIFACT_KEY_VERSION",
  "TOKENLESS_PSEUDONYM_KEY",
  "TOKENLESS_ASSURANCE_RATIONALE_VAULT_KEY_VERSION",
  "TOKENLESS_ASSURANCE_RATIONALE_VAULT_KEYS",
  "TOKENLESS_ASSURANCE_REVIEWER_MAPPING_KEY_VERSION",
  "TOKENLESS_ASSURANCE_REVIEWER_MAPPING_KEYS",
  "TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY",
  "TOKENLESS_EVIDENCE_SIGNING_KEY_ID",
  "TOKENLESS_EVIDENCE_TENANT_COMMITMENT_KEY",
  "TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY",
  "TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY_VERSION",
  "TOKENLESS_MCP_RATE_LIMIT_SECRET",
  "TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY",
  "TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION",
  "TOKENLESS_PIPELINE_TOKEN",
  "CRON_SECRET",
  "TOKENLESS_NOTIFICATION_UNSUBSCRIBE_SECRET",
  "TOKENLESS_PONDER_URL",
  "TOKENLESS_WEBHOOK_ENCRYPTION_KEY",
  "TOKENLESS_DEPLOYMENT_SCHEMA",
  "TOKENLESS_CHAIN_ID",
  "TOKENLESS_DEPLOYMENT_KEY",
  "TOKENLESS_DEPLOYMENT_BLOCK",
  "TOKENLESS_PANEL_ADDRESS",
  "TOKENLESS_CREDENTIAL_ISSUER_ADDRESS",
  "TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS",
  "TOKENLESS_USDC_ADDRESS",
  "TOKENLESS_USDC_EIP712_NAME",
  "TOKENLESS_USDC_EIP712_VERSION",
  "TOKENLESS_FEE_RECIPIENT",
  "TOKENLESS_REVEAL_WINDOW_SECONDS",
  "TOKENLESS_BEACON_FAILURE_GRACE_SECONDS",
  "TOKENLESS_CLAIM_GRACE_PERIOD_SECONDS",
  "BASE_SEPOLIA_RPC_URL",
  "NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL",
  "TOKENLESS_CREDENTIAL_ISSUER_SIGNER_PRIVATE_KEY",
  "TOKENLESS_X402_RELAYER_PRIVATE_KEY",
  "TOKENLESS_PREPAID_FUNDER_PRIVATE_KEY",
  "TOKENLESS_SURPRISE_BONUS_FUNDER_PRIVATE_KEY",
  "TOKENLESS_VOUCHER_ISSUER_EPOCH",
  "TOKENLESS_ELIGIBILITY_PROVIDER_ID",
  "TOKENLESS_ELIGIBILITY_PROVIDER_PUBLIC_KEY",
  "TOKENLESS_ELIGIBILITY_PROVIDER_START_URL",
  "TOKENLESS_ELIGIBILITY_HANDOFF_SECRET",
  "TOKENLESS_PROVIDER_EVIDENCE_VAULT_KEY_VERSION",
  "TOKENLESS_PROVIDER_EVIDENCE_VAULT_KEYS",
  "TOKENLESS_TAX_VAULT_KEY_VERSION",
  "TOKENLESS_TAX_VAULT_KEYS",
  "TOKENLESS_VOTE_MAPPING_VAULT_KEY_VERSION",
  "TOKENLESS_VOTE_MAPPING_VAULT_KEYS",
  "TOKENLESS_DAC7_POLICY",
  "TOKENLESS_NETWORK_PANELS_ENABLED",
  "TOKENLESS_SUBSCRIPTIONS_ENABLED",
  "WORLD_ID_APP_ID",
  "WORLD_ID_RP_ID",
  "WORLD_ID_RP_SIGNING_KEY",
  "WORLD_ID_PROOF_OF_HUMAN_ACTION_VERSION",
  "WORLD_ID_PROOF_OF_HUMAN_ACTION",
  "WORLD_ID_ENVIRONMENT",
  "TOKENLESS_PROVIDER_SUBJECT_HMAC_KEY_VERSION",
  "TOKENLESS_PROVIDER_SUBJECT_HMAC_KEYS",
  "TOKENLESS_WORLD_ID_EVIDENCE_KEY_VERSION",
  "TOKENLESS_WORLD_ID_EVIDENCE_KEYS",
  "TOKENLESS_WORLD_ID_CREDENTIAL_MIN_TTL_SECONDS",
];

const FORBIDDEN_PUBLIC_SECRETS = [
  "NEXT_PUBLIC_DATABASE_URL",
  "NEXT_PUBLIC_BLOB_READ_WRITE_TOKEN",
  "NEXT_PUBLIC_BETTER_AUTH_SECRET",
  "NEXT_PUBLIC_BETTER_AUTH_GOOGLE_CLIENT_SECRET",
  "NEXT_PUBLIC_BETTER_AUTH_APPLE_CLIENT_SECRET",
  "NEXT_PUBLIC_TOKENLESS_THIRDWEB_WALLET_PRIVATE_JWK",
  "NEXT_PUBLIC_TOKENLESS_ARTIFACT_MASTER_KEY",
  "NEXT_PUBLIC_TOKENLESS_PSEUDONYM_KEY",
  "NEXT_PUBLIC_TOKENLESS_ASSURANCE_RATIONALE_VAULT_KEYS",
  "NEXT_PUBLIC_TOKENLESS_ASSURANCE_REVIEWER_MAPPING_KEYS",
  "NEXT_PUBLIC_TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY",
  "NEXT_PUBLIC_TOKENLESS_EVIDENCE_TENANT_COMMITMENT_KEY",
  "NEXT_PUBLIC_TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY",
  "NEXT_PUBLIC_TOKENLESS_MCP_RATE_LIMIT_SECRET",
  "NEXT_PUBLIC_TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY",
  "NEXT_PUBLIC_TOKENLESS_CREDENTIAL_ISSUER_SIGNER_PRIVATE_KEY",
  "NEXT_PUBLIC_TOKENLESS_X402_RELAYER_PRIVATE_KEY",
  "NEXT_PUBLIC_TOKENLESS_PREPAID_FUNDER_PRIVATE_KEY",
  "NEXT_PUBLIC_TOKENLESS_SURPRISE_BONUS_FUNDER_PRIVATE_KEY",
  "NEXT_PUBLIC_TOKENLESS_ELIGIBILITY_HANDOFF_SECRET",
  "NEXT_PUBLIC_TOKENLESS_PROVIDER_EVIDENCE_VAULT_KEYS",
  "NEXT_PUBLIC_TOKENLESS_TAX_VAULT_KEYS",
  "NEXT_PUBLIC_TOKENLESS_VOTE_MAPPING_VAULT_KEYS",
  "NEXT_PUBLIC_TOKENLESS_PIPELINE_TOKEN",
  "NEXT_PUBLIC_CRON_SECRET",
  "NEXT_PUBLIC_TOKENLESS_NOTIFICATION_UNSUBSCRIBE_SECRET",
  "NEXT_PUBLIC_TOKENLESS_WEBHOOK_ENCRYPTION_KEY",
  "NEXT_PUBLIC_STRIPE_SECRET_KEY",
  "NEXT_PUBLIC_STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID",
  "NEXT_PUBLIC_WORLD_ID_RP_SIGNING_KEY",
  "NEXT_PUBLIC_TOKENLESS_PROVIDER_SUBJECT_HMAC_KEYS",
  "NEXT_PUBLIC_TOKENLESS_WORLD_ID_EVIDENCE_KEYS",
];

function value(env, name) {
  return env[name]?.trim() || "";
}

function positiveInteger(raw) {
  return /^(?:[1-9]\d*)$/u.test(raw) && Number.isSafeInteger(Number(raw));
}

function httpsUrl(raw) {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.hash;
  } catch {
    return false;
  }
}

function decode32(raw, encoding = "base64url") {
  try {
    const decoded = /^[0-9a-fA-F]{64}$/u.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, encoding);
    return decoded.byteLength === 32 ? decoded : null;
  } catch {
    return null;
  }
}

function currentKey(env, prefix, encoding, errors) {
  const versionName = `${prefix}_KEY_VERSION`;
  const keysName = `${prefix}_KEYS`;
  const version = value(env, versionName);
  try {
    const parsed = JSON.parse(value(env, keysName));
    const encoded = parsed && typeof parsed === "object" ? parsed[version] : undefined;
    const key = typeof encoded === "string" ? decode32(encoded, encoding) : null;
    if (!key) errors.push(`${keysName} must contain the configured 32-byte current key.`);
    return key;
  } catch {
    errors.push(`${keysName} must be a JSON keyring containing the configured current version.`);
    return null;
  }
}

function activeDeployment(activeRegistry, errors) {
  const keys = Object.keys(activeRegistry ?? {});
  if (keys.length !== 1 || keys[0] !== String(BASE_SEPOLIA_CHAIN_ID)) {
    errors.push("The active tokenless v3 registry must contain exactly the Base Sepolia deployment.");
    return null;
  }
  const active = activeRegistry[keys[0]];
  if (!active || active.schemaVersion !== DEPLOYMENT_SCHEMA || active.deploymentComplete !== true) {
    errors.push("The active Base Sepolia deployment must be a complete tokenless v3 artifact.");
    return null;
  }
  return active;
}

function addSecretRole(roles, name, secret) {
  if (!secret) return;
  const fingerprint = Buffer.isBuffer(secret) ? secret.toString("hex") : secret.toLowerCase().replace(/^0x/u, "");
  const existing = roles.get(fingerprint);
  if (existing) existing.push(name);
  else roles.set(fingerprint, [name]);
}

export function validateTokenlessProductionReadiness({
  env,
  activeRegistry,
  deploymentSchema = tokenlessDeploymentSchema,
  releaseCapabilities = DEFAULT_NON_SANDBOX_RELEASE_CAPABILITIES,
  production = env.VERCEL_ENV === "production",
}) {
  const errors = [];
  if (!production) return errors;

  const sandboxMode = value(env, "TOKENLESS_SANDBOX_MODE").toLowerCase();
  if (sandboxMode !== "true" && sandboxMode !== "false") {
    return ["TOKENLESS_SANDBOX_MODE must be explicitly true or false in production."];
  }
  errors.push(...validateTokenlessEuDeployment({ env, sandbox: sandboxMode === "true" }));
  if (sandboxMode === "true") return errors;

  for (const [capability, label] of Object.entries(NON_SANDBOX_RELEASE_CAPABILITY_LABELS)) {
    if (releaseCapabilities[capability] !== true) {
      errors.push(`Non-sandbox release is blocked until ${label} is implemented and reviewed.`);
    }
  }

  let missingConfiguration = false;
  for (const name of REQUIRED_TOKENLESS_PRODUCTION_VARIABLES) {
    if (!value(env, name)) {
      errors.push(`${name} is required for non-sandbox production.`);
      missingConfiguration = true;
    }
  }
  for (const name of FORBIDDEN_PUBLIC_SECRETS) {
    if (value(env, name)) errors.push(`${name} is forbidden because production secrets must remain server-only.`);
  }
  if (value(env, "TOKENLESS_ARTIFACT_MASTER_KEY")) {
    errors.push(
      "TOKENLESS_ARTIFACT_MASTER_KEY is sandbox-only; non-sandbox production must use the managed KMS vault boundary.",
    );
  }
  const subscriptionsEnabled = value(env, "TOKENLESS_SUBSCRIPTIONS_ENABLED");
  if (subscriptionsEnabled !== "true" && subscriptionsEnabled !== "false") {
    errors.push("TOKENLESS_SUBSCRIPTIONS_ENABLED must be explicitly true or false in production.");
  }
  if (subscriptionsEnabled === "true") {
    for (const name of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID"]) {
      if (!value(env, name)) errors.push(`${name} is required when tokenless subscriptions are enabled.`);
    }
    if (value(env, "STRIPE_SECRET_KEY") && !/^sk_live_[A-Za-z0-9_]+$/u.test(value(env, "STRIPE_SECRET_KEY"))) {
      errors.push("STRIPE_SECRET_KEY must be a live-mode secret in production when subscriptions are enabled.");
    }
    if (value(env, "STRIPE_WEBHOOK_SECRET") && !/^whsec_[A-Za-z0-9_]+$/u.test(value(env, "STRIPE_WEBHOOK_SECRET"))) {
      errors.push("STRIPE_WEBHOOK_SECRET must be a Stripe webhook signing secret.");
    }
    if (
      value(env, "STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID") &&
      !/^price_[A-Za-z0-9_]+$/u.test(value(env, "STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID"))
    ) {
      errors.push("STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID must be a Stripe Price ID.");
    }
  }
  if (value(env, "BETTER_AUTH_SECRET").length < 32) {
    errors.push("BETTER_AUTH_SECRET must contain at least 32 characters.");
  }
  try {
    const appHost = new URL(value(env, "APP_URL")).hostname.toLowerCase();
    if (value(env, "BETTER_AUTH_PASSKEY_RP_ID").toLowerCase() !== appHost) {
      errors.push("BETTER_AUTH_PASSKEY_RP_ID must exactly match the tokenless APP_URL hostname.");
    }
  } catch {
    // APP_URL receives its canonical URL error after the missing-configuration guard.
  }
  for (const [idName, secretName, label] of [
    ["BETTER_AUTH_GOOGLE_CLIENT_ID", "BETTER_AUTH_GOOGLE_CLIENT_SECRET", "Google sign-in"],
    ["BETTER_AUTH_APPLE_CLIENT_ID", "BETTER_AUTH_APPLE_CLIENT_SECRET", "Apple sign-in"],
  ]) {
    if (Boolean(value(env, idName)) !== Boolean(value(env, secretName))) {
      errors.push(`${label} requires both ${idName} and ${secretName}, or neither.`);
    }
  }
  const thirdwebWalletEnabled = value(env, "TOKENLESS_THIRDWEB_WALLET_ENABLED").toLowerCase();
  if (thirdwebWalletEnabled !== "true" && thirdwebWalletEnabled !== "false") {
    errors.push("TOKENLESS_THIRDWEB_WALLET_ENABLED must be explicitly true or false in production.");
  }
  if (thirdwebWalletEnabled === "true") {
    for (const name of [
      "NEXT_PUBLIC_THIRDWEB_CLIENT_ID",
      "TOKENLESS_THIRDWEB_WALLET_AUDIENCE",
      "TOKENLESS_THIRDWEB_WALLET_KEY_ID",
      "TOKENLESS_THIRDWEB_WALLET_PRIVATE_JWK",
    ]) {
      if (!value(env, name)) errors.push(`${name} is required when optional thirdweb wallet creation is enabled.`);
    }
  }
  if (missingConfiguration) return errors;

  if (deploymentSchema !== DEPLOYMENT_SCHEMA || value(env, "TOKENLESS_DEPLOYMENT_SCHEMA") !== DEPLOYMENT_SCHEMA) {
    errors.push(`TOKENLESS_DEPLOYMENT_SCHEMA must be ${DEPLOYMENT_SCHEMA}.`);
  }
  if (value(env, "TOKENLESS_CHAIN_ID") !== String(BASE_SEPOLIA_CHAIN_ID)) {
    errors.push(`TOKENLESS_CHAIN_ID must be ${BASE_SEPOLIA_CHAIN_ID}.`);
  }
  const addresses = [
    "TOKENLESS_PANEL_ADDRESS",
    "TOKENLESS_CREDENTIAL_ISSUER_ADDRESS",
    "TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS",
    "TOKENLESS_USDC_ADDRESS",
    "TOKENLESS_FEE_RECIPIENT",
  ];
  for (const name of addresses) {
    const address = value(env, name);
    if (!ADDRESS_PATTERN.test(address) || /^0x0{40}$/iu.test(address)) {
      errors.push(`${name} must be a non-zero EVM address.`);
    }
  }
  for (const name of [
    "TOKENLESS_DEPLOYMENT_BLOCK",
    "TOKENLESS_REVEAL_WINDOW_SECONDS",
    "TOKENLESS_BEACON_FAILURE_GRACE_SECONDS",
    "TOKENLESS_CLAIM_GRACE_PERIOD_SECONDS",
    "TOKENLESS_VOUCHER_ISSUER_EPOCH",
    "TOKENLESS_WORLD_ID_CREDENTIAL_MIN_TTL_SECONDS",
  ]) {
    if (!positiveInteger(value(env, name))) errors.push(`${name} must be a positive integer.`);
  }
  for (const name of [
    "APP_URL",
    "NEXT_PUBLIC_APP_URL",
    "BASE_SEPOLIA_RPC_URL",
    "NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL",
    "TOKENLESS_ELIGIBILITY_PROVIDER_START_URL",
    "TOKENLESS_PONDER_URL",
  ]) {
    if (!httpsUrl(value(env, name)))
      errors.push(`${name} must be an HTTPS URL without embedded credentials or fragments.`);
  }
  if (value(env, "WORLD_ID_ENVIRONMENT") !== "production") {
    errors.push("WORLD_ID_ENVIRONMENT must be production for non-sandbox production.");
  }
  if (value(env, "TOKENLESS_NETWORK_PANELS_ENABLED") !== "true") {
    errors.push("TOKENLESS_NETWORK_PANELS_ENABLED must be true for the production public network.");
  }
  if (!/^app_[A-Za-z0-9_-]{8,128}$/u.test(value(env, "WORLD_ID_APP_ID"))) {
    errors.push("WORLD_ID_APP_ID is invalid.");
  }
  if (!/^rp_[A-Za-z0-9_-]{8,128}$/u.test(value(env, "WORLD_ID_RP_ID"))) {
    errors.push("WORLD_ID_RP_ID is invalid.");
  }
  const worldCredentialTtl = Number(value(env, "TOKENLESS_WORLD_ID_CREDENTIAL_MIN_TTL_SECONDS"));
  if (worldCredentialTtl < 3_600 || worldCredentialTtl > 90 * 86_400) {
    errors.push("TOKENLESS_WORLD_ID_CREDENTIAL_MIN_TTL_SECONDS must be between one hour and 90 days.");
  }
  const claimGrace = Number(value(env, "TOKENLESS_CLAIM_GRACE_PERIOD_SECONDS"));
  if (claimGrace > 30 * 86_400) {
    errors.push("TOKENLESS_CLAIM_GRACE_PERIOD_SECONDS must not exceed 30 days.");
  }
  if (
    value(env, "TOKENLESS_USDC_EIP712_NAME") !== "RateLoop Tokenless Test USDC" ||
    value(env, "TOKENLESS_USDC_EIP712_VERSION") !== "2"
  ) {
    errors.push("The Base Sepolia USDC EIP-712 name and version must match the active test currency.");
  }
  const dac7Policy = value(env, "TOKENLESS_DAC7_POLICY").toLowerCase();
  if (!["all", "eu", "configured"].includes(dac7Policy)) {
    errors.push("TOKENLESS_DAC7_POLICY must be all, eu, or configured.");
  }
  if (dac7Policy === "configured" && !value(env, "TOKENLESS_DAC7_REQUIRED_COUNTRIES")) {
    errors.push("TOKENLESS_DAC7_REQUIRED_COUNTRIES is required when TOKENLESS_DAC7_POLICY is configured.");
  }

  const privateRoles = [
    "TOKENLESS_CREDENTIAL_ISSUER_SIGNER_PRIVATE_KEY",
    "TOKENLESS_X402_RELAYER_PRIVATE_KEY",
    "TOKENLESS_PREPAID_FUNDER_PRIVATE_KEY",
    "TOKENLESS_SURPRISE_BONUS_FUNDER_PRIVATE_KEY",
  ];
  const secretRoles = new Map();
  for (const name of privateRoles) {
    const secret = value(env, name);
    if (!PRIVATE_KEY_PATTERN.test(secret)) errors.push(`${name} must be a 32-byte hex private key.`);
    else addSecretRole(secretRoles, name, secret);
  }
  const worldSigningKey = value(env, "WORLD_ID_RP_SIGNING_KEY").replace(/^0x/u, "");
  if (!/^[0-9a-fA-F]{64}$/u.test(worldSigningKey)) errors.push("WORLD_ID_RP_SIGNING_KEY must be a 32-byte hex key.");
  else addSecretRole(secretRoles, "WORLD_ID_RP_SIGNING_KEY", worldSigningKey);

  for (const [prefix, encoding] of [
    ["TOKENLESS_ASSURANCE_RATIONALE_VAULT", "base64url"],
    ["TOKENLESS_ASSURANCE_REVIEWER_MAPPING", "base64url"],
    ["TOKENLESS_PROVIDER_EVIDENCE_VAULT", "base64"],
    ["TOKENLESS_TAX_VAULT", "base64"],
    ["TOKENLESS_VOTE_MAPPING_VAULT", "base64"],
    ["TOKENLESS_PROVIDER_SUBJECT_HMAC", "base64url"],
    ["TOKENLESS_WORLD_ID_EVIDENCE", "base64url"],
  ]) {
    addSecretRole(secretRoles, prefix, currentKey(env, prefix, encoding, errors));
  }
  const pseudonymKey = decode32(value(env, "TOKENLESS_PSEUDONYM_KEY"), "base64url");
  if (!pseudonymKey) errors.push("TOKENLESS_PSEUDONYM_KEY must encode exactly 32 bytes.");
  addSecretRole(secretRoles, "TOKENLESS_PSEUDONYM_KEY", pseudonymKey);
  for (const [name, encoding] of [
    ["TOKENLESS_EVIDENCE_TENANT_COMMITMENT_KEY", "base64url"],
    ["TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY", "base64url"],
    ["TOKENLESS_WEBHOOK_ENCRYPTION_KEY", "base64url"],
  ]) {
    const secret = decode32(value(env, name), encoding);
    if (!secret) errors.push(`${name} must encode exactly 32 bytes.`);
    addSecretRole(secretRoles, name, secret);
  }
  for (const names of secretRoles.values()) {
    if (names.length > 1) errors.push(`Production key roles must be distinct: ${names.join(", ")}.`);
  }

  try {
    const signingKey = value(env, "TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY");
    const privateKey = signingKey.includes("BEGIN PRIVATE KEY")
      ? createPrivateKey(signingKey)
      : createPrivateKey({ key: Buffer.from(signingKey, "base64url"), format: "der", type: "pkcs8" });
    if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
    const publicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" });
    const expectedKeyId = `ed25519:${createHash("sha256").update(publicKey).digest("hex").slice(0, 24)}`;
    if (value(env, "TOKENLESS_EVIDENCE_SIGNING_KEY_ID") !== expectedKeyId) {
      errors.push("TOKENLESS_EVIDENCE_SIGNING_KEY_ID must match the Ed25519 public-key fingerprint.");
    }
  } catch {
    errors.push("TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY must be a dedicated Ed25519 private key.");
  }
  try {
    createPublicKey(value(env, "TOKENLESS_ELIGIBILITY_PROVIDER_PUBLIC_KEY").replaceAll("\\n", "\n"));
  } catch {
    errors.push("TOKENLESS_ELIGIBILITY_PROVIDER_PUBLIC_KEY must be a valid public key.");
  }
  const eligibilityHandoffSecret = Buffer.from(value(env, "TOKENLESS_ELIGIBILITY_HANDOFF_SECRET"), "base64");
  if (eligibilityHandoffSecret.byteLength < 32) {
    errors.push("TOKENLESS_ELIGIBILITY_HANDOFF_SECRET must contain at least 32 bytes.");
  }
  addSecretRole(secretRoles, "TOKENLESS_ELIGIBILITY_HANDOFF_SECRET", eligibilityHandoffSecret);
  const adaptiveSamplerKey = decode32(value(env, "TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY"));
  if (!adaptiveSamplerKey) errors.push("TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY must encode exactly 32 bytes.");
  addSecretRole(secretRoles, "TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY", adaptiveSamplerKey);
  for (const name of [
    "TOKENLESS_MCP_RATE_LIMIT_SECRET",
    "TOKENLESS_PIPELINE_TOKEN",
    "CRON_SECRET",
    "TOKENLESS_NOTIFICATION_UNSUBSCRIBE_SECRET",
    "BETTER_AUTH_SECRET",
  ]) {
    if (value(env, name).length < 32) errors.push(`${name} must contain at least 32 characters.`);
    addSecretRole(secretRoles, name, Buffer.from(value(env, name), "utf8"));
  }
  if (value(env, "TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION").length > 80) {
    errors.push("TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION must not exceed 80 characters.");
  }
  if (thirdwebWalletEnabled === "true") {
    if (value(env, "TOKENLESS_THIRDWEB_WALLET_KEY_ID").length > 128) {
      errors.push("TOKENLESS_THIRDWEB_WALLET_KEY_ID must not exceed 128 characters.");
    }
    if (value(env, "TOKENLESS_THIRDWEB_WALLET_AUDIENCE").length > 256) {
      errors.push("TOKENLESS_THIRDWEB_WALLET_AUDIENCE must not exceed 256 characters.");
    }
    try {
      const jwk = JSON.parse(value(env, "TOKENLESS_THIRDWEB_WALLET_PRIVATE_JWK"));
      const walletIssuerKey = createPrivateKey({ key: jwk, format: "jwk" });
      if (
        walletIssuerKey.asymmetricKeyType !== "ed25519" ||
        jwk.kty !== "OKP" ||
        jwk.crv !== "Ed25519" ||
        !jwk.d ||
        !jwk.x
      ) {
        throw new Error("wrong key type");
      }
      addSecretRole(
        secretRoles,
        "TOKENLESS_THIRDWEB_WALLET_PRIVATE_JWK",
        walletIssuerKey.export({ format: "der", type: "pkcs8" }),
      );
    } catch {
      errors.push("TOKENLESS_THIRDWEB_WALLET_PRIVATE_JWK must be a dedicated Ed25519 private JWK.");
    }
  }
  for (const names of secretRoles.values()) {
    const message = `Production key roles must be distinct: ${names.join(", ")}.`;
    if (names.length > 1 && !errors.includes(message)) errors.push(message);
  }

  const active = activeDeployment(activeRegistry, errors);
  if (active) {
    const expectedKey = [
      "tokenless-v3",
      BASE_SEPOLIA_CHAIN_ID,
      value(env, "TOKENLESS_PANEL_ADDRESS").toLowerCase(),
      value(env, "TOKENLESS_CREDENTIAL_ISSUER_ADDRESS").toLowerCase(),
      value(env, "TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS").toLowerCase(),
    ].join(":");
    const matches = [
      active.deploymentKey === expectedKey && value(env, "TOKENLESS_DEPLOYMENT_KEY").toLowerCase() === expectedKey,
      Number(active.deploymentBlockNumber) === Number(value(env, "TOKENLESS_DEPLOYMENT_BLOCK")),
      active.contracts?.TokenlessPanel?.address?.toLowerCase() === value(env, "TOKENLESS_PANEL_ADDRESS").toLowerCase(),
      active.contracts?.CredentialIssuer?.address?.toLowerCase() ===
        value(env, "TOKENLESS_CREDENTIAL_ISSUER_ADDRESS").toLowerCase(),
      active.contracts?.X402PanelSubmitter?.address?.toLowerCase() ===
        value(env, "TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS").toLowerCase(),
      active.contracts?.TestUSDC?.address?.toLowerCase() === value(env, "TOKENLESS_USDC_ADDRESS").toLowerCase(),
    ];
    if (matches.some(match => !match)) {
      errors.push("The configured chain bundle must exactly match the complete active tokenless v3 registry.");
    }
  }
  return errors;
}

function main() {
  const production = process.argv.includes("--production") || process.env.VERCEL_ENV === "production";
  const errors = validateTokenlessProductionReadiness({
    env: process.env,
    activeRegistry: tokenlessDeployedContracts,
    production,
  });
  if (errors.length > 0) {
    throw new Error(`Tokenless non-sandbox production preflight refused:\n- ${errors.join("\n- ")}`);
  }
  const sandbox = value(process.env, "TOKENLESS_SANDBOX_MODE").toLowerCase() === "true";
  console.log(
    production && !sandbox
      ? "Tokenless non-sandbox production preflight passed."
      : "Tokenless non-sandbox production preflight skipped.",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Tokenless production preflight failed.");
    process.exitCode = 1;
  }
}
