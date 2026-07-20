import {
  tokenlessEuDeploymentManifest,
  validateTokenlessEuDeployment,
} from "../../../scripts/validate-tokenless-eu-deployment.mjs";
import {
  tokenlessDeployedContracts,
  tokenlessDeploymentSchema,
} from "../../contracts/src/tokenless/deployedContracts.ts";
import { TOKENLESS_VERCEL_PROJECT } from "./check-identity-deployment.mjs";
import { validateHostedDatabaseIdentity } from "./migrate-hosted-database.mjs";
import { createHash, createPublicKey } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAddress, zeroAddress } from "viem";

const BASE_SEPOLIA_CHAIN_ID = 84_532;
const DEPLOYMENT_SCHEMA = "rateloop-tokenless-deployment-v4";
const MINIMUM_REVEAL_WINDOW_SECONDS = 300;
const TOKENLESS_REVIEW_ORIGIN = "https://rateloop-tokenless.vercel.app";
const MANAGED_EVM_SIGNER_ROLES = ["CREDENTIAL_ISSUER", "X402_RELAYER", "PREPAID_FUNDER", "SURPRISE_BONUS_FUNDER"];
const FORBIDDEN_HOSTED_PRIVATE_KEYS = [
  "TOKENLESS_CREDENTIAL_ISSUER_SIGNER_PRIVATE_KEY",
  "TOKENLESS_X402_RELAYER_PRIVATE_KEY",
  "TOKENLESS_PREPAID_FUNDER_PRIVATE_KEY",
  "TOKENLESS_SURPRISE_BONUS_FUNDER_PRIVATE_KEY",
  "TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY",
];

export const DEFAULT_HOSTED_RELEASE_CAPABILITIES = Object.freeze({
  managedSigning: false,
  paidAssignmentSettlement: false,
  feedbackBonusLiveWiringVerification: false,
  feedbackBonusHumanAwardExecution: false,
  feedbackBonusReceiptReconciliation: false,
});

const HOSTED_RELEASE_CAPABILITY_LABELS = Object.freeze({
  managedSigning: "managed signing for credential issuance and chain transactions",
  paidAssignmentSettlement: "paid assignment reservation, voucher, commit, and settlement orchestration",
  feedbackBonusLiveWiringVerification: "live Feedback Bonus USDC and credential-issuer immutable wiring verification",
  feedbackBonusHumanAwardExecution: "human-signed Feedback Bonus award execution without a server-held awarder key",
  feedbackBonusReceiptReconciliation:
    "idempotent Feedback Bonus transaction reconciliation and append-only receipt projection",
});

export const REQUIRED_TOKENLESS_PRODUCTION_VARIABLES = [
  "APP_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_THIRDWEB_CLIENT_ID",
  "DATABASE_URL",
  "TOKENLESS_DATABASE_IDENTITY",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_PASSKEY_RP_ID",
  "TOKENLESS_THIRDWEB_WALLET_ENABLED",
  "BLOB_READ_WRITE_TOKEN",
  "TOKENLESS_KMS_PROVIDER",
  "TOKENLESS_KMS_KEY_RESOURCE",
  "TOKENLESS_AWS_KMS_REGION",
  "TOKENLESS_AWS_KMS_ROLE_ARN",
  "TOKENLESS_ARTIFACT_KEY_VERSION",
  "TOKENLESS_PSEUDONYM_KEY",
  "TOKENLESS_ASSURANCE_RATIONALE_VAULT_KEY_VERSION",
  "TOKENLESS_ASSURANCE_RATIONALE_VAULT_KEYS",
  "TOKENLESS_ASSURANCE_REVIEWER_MAPPING_KEY_VERSION",
  "TOKENLESS_ASSURANCE_REVIEWER_MAPPING_KEYS",
  "TOKENLESS_PUBLIC_RATER_RESPONSE_VAULT_KEY_VERSION",
  "TOKENLESS_PUBLIC_RATER_RESPONSE_VAULT_KEYS",
  "TOKENLESS_EVIDENCE_SIGNING_KEY_ID",
  "TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS",
  "TOKENLESS_EVIDENCE_KMS_KEY_RESOURCE",
  "TOKENLESS_EVIDENCE_KMS_REGION",
  "TOKENLESS_EVIDENCE_KMS_ROLE_ARN",
  "TOKENLESS_EVIDENCE_TENANT_COMMITMENT_KEY",
  "TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY",
  "TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY_VERSION",
  "TOKENLESS_MCP_RATE_LIMIT_SECRET",
  "TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET",
  "TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY",
  "TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION",
  "TOKENLESS_GOLD_INJECTION_KEY_VERSION",
  "TOKENLESS_GOLD_INJECTION_KEYS",
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
  "TOKENLESS_FEEDBACK_BONUS_ADDRESS",
  "TOKENLESS_BEACON_VERIFIER_ADDRESS",
  "TOKENLESS_USDC_ADDRESS",
  "TOKENLESS_USDC_EIP712_NAME",
  "TOKENLESS_USDC_EIP712_VERSION",
  "TOKENLESS_FEE_RECIPIENT",
  "TOKENLESS_REVEAL_WINDOW_SECONDS",
  "TOKENLESS_BEACON_FAILURE_GRACE_SECONDS",
  "TOKENLESS_CLAIM_GRACE_PERIOD_SECONDS",
  "BASE_SEPOLIA_RPC_URL",
  "BASE_SEPOLIA_RPC_FALLBACK_URLS",
  "NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL",
  ...MANAGED_EVM_SIGNER_ROLES.flatMap(role => [
    `TOKENLESS_${role}_KMS_KEY_RESOURCE`,
    `TOKENLESS_${role}_KMS_EXPECTED_ADDRESS`,
    `TOKENLESS_${role}_KMS_REGION`,
    `TOKENLESS_${role}_KMS_ROLE_ARN`,
  ]),
  "TOKENLESS_KEEPER_KMS_KEY_RESOURCE",
  "TOKENLESS_KEEPER_KMS_EXPECTED_ADDRESS",
  "TOKENLESS_KEEPER_KMS_REGION",
  "TOKENLESS_KEEPER_KMS_ROLE_ARN",
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
  "TOKENLESS_PREPAID_TOPUP_ENABLED",
  "TOKENLESS_ENTERPRISE_IDENTITY_ENABLED",
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
  "NEXT_PUBLIC_TOKENLESS_KMS_KEY_RESOURCE",
  "NEXT_PUBLIC_TOKENLESS_PSEUDONYM_KEY",
  "NEXT_PUBLIC_TOKENLESS_ASSURANCE_RATIONALE_VAULT_KEYS",
  "NEXT_PUBLIC_TOKENLESS_ASSURANCE_REVIEWER_MAPPING_KEYS",
  "NEXT_PUBLIC_TOKENLESS_PUBLIC_RATER_RESPONSE_VAULT_KEY_VERSION",
  "NEXT_PUBLIC_TOKENLESS_PUBLIC_RATER_RESPONSE_VAULT_KEYS",
  "NEXT_PUBLIC_TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY",
  "NEXT_PUBLIC_TOKENLESS_EVIDENCE_TENANT_COMMITMENT_KEY",
  "NEXT_PUBLIC_TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY",
  "NEXT_PUBLIC_TOKENLESS_MCP_RATE_LIMIT_SECRET",
  "NEXT_PUBLIC_TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET",
  "NEXT_PUBLIC_TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY",
  "NEXT_PUBLIC_TOKENLESS_GOLD_INJECTION_KEY_VERSION",
  "NEXT_PUBLIC_TOKENLESS_GOLD_INJECTION_KEYS",
  "NEXT_PUBLIC_TOKENLESS_EXPERTISE_OPERATOR_ACCOUNTS",
  "NEXT_PUBLIC_TOKENLESS_CREDENTIAL_ISSUER_SIGNER_PRIVATE_KEY",
  "NEXT_PUBLIC_TOKENLESS_X402_RELAYER_PRIVATE_KEY",
  "NEXT_PUBLIC_TOKENLESS_PREPAID_FUNDER_PRIVATE_KEY",
  "NEXT_PUBLIC_TOKENLESS_SURPRISE_BONUS_FUNDER_PRIVATE_KEY",
  "NEXT_PUBLIC_TOKENLESS_FEEDBACK_BONUS_AWARDER_PRIVATE_KEY",
  "NEXT_PUBLIC_TOKENLESS_FEEDBACK_BONUS_AWARD_WORKER_PRIVATE_KEY",
  "NEXT_PUBLIC_TOKENLESS_ELIGIBILITY_HANDOFF_SECRET",
  "NEXT_PUBLIC_TOKENLESS_PROVIDER_EVIDENCE_VAULT_KEYS",
  "NEXT_PUBLIC_TOKENLESS_TAX_VAULT_KEYS",
  "NEXT_PUBLIC_TOKENLESS_VOTE_MAPPING_VAULT_KEYS",
  "NEXT_PUBLIC_TOKENLESS_PIPELINE_TOKEN",
  "NEXT_PUBLIC_CRON_SECRET",
  "NEXT_PUBLIC_TOKENLESS_NOTIFICATION_UNSUBSCRIBE_SECRET",
  "NEXT_PUBLIC_TOKENLESS_WEBHOOK_ENCRYPTION_KEY",
  "NEXT_PUBLIC_TOKENLESS_WORM_S3_CREDENTIALS_JSON",
  "NEXT_PUBLIC_TOKENLESS_GRC_CREDENTIALS_JSON",
  "NEXT_PUBLIC_TOKENLESS_ATTESTATION_AWS_CREDENTIALS_JSON",
  "NEXT_PUBLIC_STRIPE_SECRET_KEY",
  "NEXT_PUBLIC_STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID",
  "NEXT_PUBLIC_WORLD_ID_RP_SIGNING_KEY",
  "NEXT_PUBLIC_TOKENLESS_PROVIDER_SUBJECT_HMAC_KEYS",
  "NEXT_PUBLIC_TOKENLESS_WORLD_ID_EVIDENCE_KEYS",
];

const FORBIDDEN_FEEDBACK_BONUS_CUSTODY_SECRETS = [
  "TOKENLESS_FEEDBACK_BONUS_AWARDER_PRIVATE_KEY",
  "TOKENLESS_FEEDBACK_BONUS_AWARD_WORKER_PRIVATE_KEY",
];

function value(env, name) {
  return env[name]?.trim() || "";
}

function nonZeroEvmAddress(address) {
  return isAddress(address) && address.toLowerCase() !== zeroAddress;
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

function validateRpcFallbacks(env, errors) {
  const rpcFallbackUrls = value(env, "BASE_SEPOLIA_RPC_FALLBACK_URLS")
    .split(",")
    .map(entry => entry.trim())
    .filter(Boolean);
  if (rpcFallbackUrls.length === 0 || rpcFallbackUrls.length > 3) {
    errors.push("BASE_SEPOLIA_RPC_FALLBACK_URLS must contain between one and three independent HTTPS URLs.");
  }
  for (const rpcUrl of rpcFallbackUrls) {
    if (!httpsUrl(rpcUrl)) {
      errors.push("BASE_SEPOLIA_RPC_FALLBACK_URLS must contain HTTPS URLs without embedded credentials or fragments.");
    }
  }
  const normalizedRpcUrls = [value(env, "BASE_SEPOLIA_RPC_URL"), ...rpcFallbackUrls];
  if (new Set(normalizedRpcUrls).size !== normalizedRpcUrls.length) {
    errors.push("BASE_SEPOLIA_RPC_URL and BASE_SEPOLIA_RPC_FALLBACK_URLS must be distinct.");
  }
}

function hostedPostgresUrl(raw) {
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    return (
      (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") &&
      Boolean(host) &&
      !["localhost", "127.0.0.1", "::1"].includes(host) &&
      parsed.pathname.length > 1
    );
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

function decodePublicMediaPreviewSecret(raw) {
  if (/^[0-9a-fA-F]{64}$/u.test(raw)) return Buffer.from(raw, "hex");
  if (/^[A-Za-z0-9_-]{43}$/u.test(raw)) {
    const decoded = Buffer.from(raw, "base64url");
    return decoded.byteLength === 32 ? decoded : null;
  }
  return null;
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
    errors.push("The active tokenless v4 registry must contain exactly the Base Sepolia deployment.");
    return null;
  }
  const active = activeRegistry[keys[0]];
  if (!active || active.schemaVersion !== DEPLOYMENT_SCHEMA || active.deploymentComplete !== true) {
    errors.push("The active Base Sepolia deployment must be a complete tokenless v4 artifact.");
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

function validateManagedKmsInventory(env, errors) {
  const kms = tokenlessEuDeploymentManifest.resources.kms;
  if (!value(env, kms.resourceIdEnv)) {
    errors.push(`${kms.resourceIdEnv} is required for a hosted deployment.`);
  }
  if (!kms.allowedProviders.includes(value(env, kms.providerEnv))) {
    errors.push(`${kms.providerEnv} must select an approved managed provider.`);
  }
  if (value(env, kms.regionEnv) !== kms.region) {
    errors.push(`${kms.regionEnv} must be ${kms.region}.`);
  }
}

function validateTokenlessTestVault(env, errors) {
  const kms = tokenlessEuDeploymentManifest.resources.kms;
  const localKeyRaw = value(env, "TOKENLESS_ARTIFACT_MASTER_KEY");
  const managedValues = [kms.providerEnv, kms.regionEnv, kms.resourceIdEnv].map(name => value(env, name));
  if (localKeyRaw && managedValues.some(Boolean)) {
    errors.push("Configure exactly one tokenless test vault: the isolated review key or the managed KMS inventory.");
    return null;
  }
  if (localKeyRaw) {
    const localKey = decode32(localKeyRaw);
    if (!localKey)
      errors.push("TOKENLESS_ARTIFACT_MASTER_KEY must encode exactly 32 bytes for the isolated review vault.");
    return localKey;
  }
  validateManagedKmsInventory(env, errors);
  return null;
}

function validateTokenlessTestDeployment(env) {
  const errors = [];
  errors.push(...validateHostedDatabaseIdentity(env));
  const isolatedReviewVaultKey = validateTokenlessTestVault(env, errors);
  if (env.VERCEL_ENV !== "production") {
    errors.push("The tokenless test deployment may run only as the isolated project's production target.");
  }
  if (env.VERCEL_PROJECT_ID !== TOKENLESS_VERCEL_PROJECT.projectId) {
    errors.push(`The tokenless test deployment requires Vercel project ${TOKENLESS_VERCEL_PROJECT.projectId}.`);
  }
  if (env.VERCEL_PROJECT_NAME !== TOKENLESS_VERCEL_PROJECT.projectName) {
    errors.push(`The tokenless test deployment requires Vercel project ${TOKENLESS_VERCEL_PROJECT.projectName}.`);
  }
  if (value(env, "VERCEL_GIT_COMMIT_REF") && env.VERCEL_GIT_COMMIT_REF !== "tokenless") {
    errors.push("The tokenless test deployment requires the tokenless Git branch.");
  }
  for (const name of ["APP_URL", "NEXT_PUBLIC_APP_URL"]) {
    if (value(env, name) !== TOKENLESS_REVIEW_ORIGIN) {
      errors.push(`${name} must remain ${TOKENLESS_REVIEW_ORIGIN} for a tokenless test deployment.`);
    }
  }
  if (!httpsUrl(value(env, "BASE_SEPOLIA_RPC_URL"))) {
    errors.push("BASE_SEPOLIA_RPC_URL must be an HTTPS URL without embedded credentials or fragments.");
  }
  if (value(env, "TOKENLESS_DEPLOYMENT_SCHEMA") !== DEPLOYMENT_SCHEMA) {
    errors.push(`TOKENLESS_DEPLOYMENT_SCHEMA must be ${DEPLOYMENT_SCHEMA}.`);
  }
  if (value(env, "TOKENLESS_CHAIN_ID") !== String(BASE_SEPOLIA_CHAIN_ID)) {
    errors.push(`TOKENLESS_CHAIN_ID must be ${BASE_SEPOLIA_CHAIN_ID}.`);
  }
  const chainAddresses = [
    "TOKENLESS_PANEL_ADDRESS",
    "TOKENLESS_CREDENTIAL_ISSUER_ADDRESS",
    "TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS",
    "TOKENLESS_FEEDBACK_BONUS_ADDRESS",
    "TOKENLESS_BEACON_VERIFIER_ADDRESS",
    "TOKENLESS_USDC_ADDRESS",
    "TOKENLESS_FEE_RECIPIENT",
  ];
  for (const name of chainAddresses) {
    if (!nonZeroEvmAddress(value(env, name))) {
      errors.push(`${name} must be a non-zero EVM address.`);
    }
  }
  const expectedDeploymentKey = [
    "tokenless-v4",
    BASE_SEPOLIA_CHAIN_ID,
    value(env, "TOKENLESS_PANEL_ADDRESS").toLowerCase(),
    value(env, "TOKENLESS_CREDENTIAL_ISSUER_ADDRESS").toLowerCase(),
    value(env, "TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS").toLowerCase(),
    value(env, "TOKENLESS_FEEDBACK_BONUS_ADDRESS").toLowerCase(),
  ].join(":");
  if (value(env, "TOKENLESS_DEPLOYMENT_KEY").toLowerCase() !== expectedDeploymentKey) {
    errors.push("TOKENLESS_DEPLOYMENT_KEY must match the complete configured tokenless v4 bundle.");
  }
  for (const name of [
    "TOKENLESS_DEPLOYMENT_BLOCK",
    "TOKENLESS_REVEAL_WINDOW_SECONDS",
    "TOKENLESS_BEACON_FAILURE_GRACE_SECONDS",
    "TOKENLESS_CLAIM_GRACE_PERIOD_SECONDS",
  ]) {
    if (!positiveInteger(value(env, name))) errors.push(`${name} must be a positive integer.`);
  }
  const testRevealWindowSeconds = value(env, "TOKENLESS_REVEAL_WINDOW_SECONDS");
  if (positiveInteger(testRevealWindowSeconds) && Number(testRevealWindowSeconds) < MINIMUM_REVEAL_WINDOW_SECONDS) {
    errors.push(`TOKENLESS_REVEAL_WINDOW_SECONDS must be at least ${MINIMUM_REVEAL_WINDOW_SECONDS} seconds.`);
  }
  const testBeaconFailureGraceSeconds = value(env, "TOKENLESS_BEACON_FAILURE_GRACE_SECONDS");
  if (positiveInteger(testBeaconFailureGraceSeconds) && Number(testBeaconFailureGraceSeconds) < 21_600) {
    errors.push("TOKENLESS_BEACON_FAILURE_GRACE_SECONDS must be at least 21600 seconds.");
  }
  for (const name of ["TOKENLESS_USDC_EIP712_NAME", "TOKENLESS_USDC_EIP712_VERSION"]) {
    if (!value(env, name)) errors.push(`${name} is required for live tokenless chain execution.`);
  }
  if (value(env, "TOKENLESS_NETWORK_PANELS_ENABLED") !== "false") {
    errors.push("TOKENLESS_NETWORK_PANELS_ENABLED must remain false for a tokenless test deployment.");
  }
  for (const name of FORBIDDEN_PUBLIC_SECRETS) {
    if (value(env, name)) errors.push(`${name} is forbidden because secrets must remain server-only.`);
  }
  for (const name of FORBIDDEN_FEEDBACK_BONUS_CUSTODY_SECRETS) {
    if (value(env, name)) {
      errors.push(`${name} is forbidden because Feedback Bonus award authority must remain with the configured human.`);
    }
  }
  const previewSecret = decodePublicMediaPreviewSecret(value(env, "TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET"));
  if (!value(env, "TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET")) {
    errors.push("TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET is required for the tokenless test deployment.");
  } else if (!previewSecret) {
    errors.push("TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET must encode exactly 32 bytes.");
  }
  const testSecretRoles = new Map();
  addSecretRole(testSecretRoles, "TOKENLESS_ARTIFACT_MASTER_KEY", isolatedReviewVaultKey);
  addSecretRole(testSecretRoles, "TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET", previewSecret);
  const goldVersion = value(env, "TOKENLESS_GOLD_INJECTION_KEY_VERSION");
  const goldKeys = value(env, "TOKENLESS_GOLD_INJECTION_KEYS");
  if (!goldVersion) {
    errors.push("TOKENLESS_GOLD_INJECTION_KEY_VERSION is required for the tokenless test deployment.");
  }
  if (!goldKeys) {
    errors.push("TOKENLESS_GOLD_INJECTION_KEYS is required for the tokenless test deployment.");
  }
  const goldKey = goldVersion && goldKeys ? currentKey(env, "TOKENLESS_GOLD_INJECTION", "base64url", errors) : null;
  addSecretRole(testSecretRoles, "TOKENLESS_GOLD_INJECTION", goldKey);
  for (const name of [
    "TOKENLESS_MCP_RATE_LIMIT_SECRET",
    "TOKENLESS_PIPELINE_TOKEN",
    "CRON_SECRET",
    "TOKENLESS_NOTIFICATION_UNSUBSCRIBE_SECRET",
    "BETTER_AUTH_SECRET",
  ]) {
    if (value(env, name)) addSecretRole(testSecretRoles, name, Buffer.from(value(env, name), "utf8"));
  }
  validateRpcFallbacks(env, errors);
  for (const name of [
    "TOKENLESS_PSEUDONYM_KEY",
    "TOKENLESS_EVIDENCE_TENANT_COMMITMENT_KEY",
    "TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY",
    "TOKENLESS_WEBHOOK_ENCRYPTION_KEY",
    "TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY",
  ]) {
    addSecretRole(testSecretRoles, name, decode32(value(env, name), "base64url"));
  }
  for (const name of [
    "TOKENLESS_CREDENTIAL_ISSUER_SIGNER_PRIVATE_KEY",
    "TOKENLESS_X402_RELAYER_PRIVATE_KEY",
    "TOKENLESS_PREPAID_FUNDER_PRIVATE_KEY",
    "TOKENLESS_SURPRISE_BONUS_FUNDER_PRIVATE_KEY",
    "WORLD_ID_RP_SIGNING_KEY",
  ]) {
    const raw = value(env, name).replace(/^0x/u, "");
    if (/^[0-9a-fA-F]{64}$/u.test(raw)) addSecretRole(testSecretRoles, name, Buffer.from(raw, "hex"));
  }
  for (const names of testSecretRoles.values()) {
    if (names.length > 1) errors.push(`Tokenless test key roles must be distinct: ${names.join(", ")}.`);
  }
  return errors;
}

export function validateTokenlessProductionReadiness({
  env,
  activeRegistry,
  deploymentSchema = tokenlessDeploymentSchema,
  releaseCapabilities = DEFAULT_HOSTED_RELEASE_CAPABILITIES,
  hosted = env.VERCEL === "1" || env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview",
}) {
  const errors = [];
  if (!hosted) return errors;

  if (value(env, "VERCEL_GIT_COMMIT_REF") !== "main") {
    return validateTokenlessTestDeployment(env);
  }

  errors.push(...validateTokenlessEuDeployment({ env }));

  for (const [capability, label] of Object.entries(HOSTED_RELEASE_CAPABILITY_LABELS)) {
    if (releaseCapabilities[capability] !== true) {
      errors.push(`Hosted release is blocked until ${label} is implemented and reviewed.`);
    }
  }

  let missingConfiguration = false;
  for (const name of REQUIRED_TOKENLESS_PRODUCTION_VARIABLES) {
    if (!value(env, name)) {
      errors.push(
        name === "NEXT_PUBLIC_THIRDWEB_CLIENT_ID"
          ? "NEXT_PUBLIC_THIRDWEB_CLIENT_ID is required for self-custodial funding and payout wallet connections."
          : `${name} is required for a hosted release.`,
      );
      missingConfiguration = true;
    }
  }
  for (const name of FORBIDDEN_PUBLIC_SECRETS) {
    if (value(env, name)) errors.push(`${name} is forbidden because production secrets must remain server-only.`);
  }
  for (const name of FORBIDDEN_FEEDBACK_BONUS_CUSTODY_SECRETS) {
    if (value(env, name)) {
      errors.push(`${name} is forbidden because Feedback Bonus award authority must remain with the configured human.`);
    }
  }
  for (const name of FORBIDDEN_HOSTED_PRIVATE_KEYS) {
    if (value(env, name)) errors.push(`${name} is forbidden; hosted signing keys must remain inside managed KMS.`);
  }
  if (value(env, "DATABASE_URL") && !hostedPostgresUrl(value(env, "DATABASE_URL"))) {
    errors.push("DATABASE_URL must identify a non-local hosted Postgres database.");
  }
  if (value(env, "TOKENLESS_ARTIFACT_MASTER_KEY")) {
    errors.push("TOKENLESS_ARTIFACT_MASTER_KEY is forbidden; hosted releases must use the managed KMS vault boundary.");
  }
  if (value(env, "TOKENLESS_KMS_PROVIDER") !== "aws-kms") {
    errors.push("TOKENLESS_KMS_PROVIDER must select the implemented aws-kms production adapter.");
  }
  if (!/\{(?:workspaceId|projectId)\}/u.test(value(env, "TOKENLESS_KMS_KEY_RESOURCE"))) {
    errors.push("TOKENLESS_KMS_KEY_RESOURCE must use a workspace- or project-scoped key alias template.");
  }
  if (!/^eu-[a-z]+-\d+$/u.test(value(env, "TOKENLESS_AWS_KMS_REGION"))) {
    errors.push("TOKENLESS_AWS_KMS_REGION must be a concrete EU AWS region.");
  }
  if (!/^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_\/-]{1,512}$/u.test(value(env, "TOKENLESS_AWS_KMS_ROLE_ARN"))) {
    errors.push("TOKENLESS_AWS_KMS_ROLE_ARN must identify the workload-identity KMS role.");
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
  const prepaidTopupsEnabled = value(env, "TOKENLESS_PREPAID_TOPUP_ENABLED");
  if (prepaidTopupsEnabled !== "true" && prepaidTopupsEnabled !== "false") {
    errors.push("TOKENLESS_PREPAID_TOPUP_ENABLED must be explicitly true or false in production.");
  }
  if (prepaidTopupsEnabled === "true") {
    for (const name of [
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_PREPAID_TOPUP_TAX_CODE",
      "STRIPE_PREPAID_TOPUP_BANK_TRANSFER_TYPE",
    ]) {
      if (!value(env, name)) errors.push(`${name} is required when prepaid top-ups are enabled.`);
    }
    if (!/^sk_live_[A-Za-z0-9_]+$/u.test(value(env, "STRIPE_SECRET_KEY"))) {
      errors.push("STRIPE_SECRET_KEY must be a live-mode secret in production when prepaid top-ups are enabled.");
    }
    if (!/^whsec_[A-Za-z0-9_]+$/u.test(value(env, "STRIPE_WEBHOOK_SECRET"))) {
      errors.push("STRIPE_WEBHOOK_SECRET must be a Stripe webhook signing secret when prepaid top-ups are enabled.");
    }
    if (!/^txcd_[A-Za-z0-9_]+$/u.test(value(env, "STRIPE_PREPAID_TOPUP_TAX_CODE"))) {
      errors.push("STRIPE_PREPAID_TOPUP_TAX_CODE must be a Stripe Tax code.");
    }
    if (value(env, "STRIPE_PREPAID_TOPUP_BANK_TRANSFER_TYPE") !== "us_bank_transfer") {
      errors.push("STRIPE_PREPAID_TOPUP_BANK_TRANSFER_TYPE must be us_bank_transfer for USD top-ups.");
    }
  }
  const enterpriseIdentityEnabled = value(env, "TOKENLESS_ENTERPRISE_IDENTITY_ENABLED");
  if (enterpriseIdentityEnabled !== "true" && enterpriseIdentityEnabled !== "false") {
    errors.push("TOKENLESS_ENTERPRISE_IDENTITY_ENABLED must be explicitly true or false in production.");
  }
  if (enterpriseIdentityEnabled === "true") {
    const issuers = value(env, "TOKENLESS_SSO_TRUSTED_ISSUERS").split(",").filter(Boolean);
    if (issuers.length === 0)
      errors.push("TOKENLESS_SSO_TRUSTED_ISSUERS is required when enterprise identity is enabled.");
    for (const issuer of issuers) {
      try {
        const url = new URL(issuer.trim());
        if (url.protocol !== "https:" || url.origin !== issuer.trim().replace(/\/$/u, "") || url.pathname !== "/") {
          throw new Error("invalid");
        }
      } catch {
        errors.push("TOKENLESS_SSO_TRUSTED_ISSUERS must contain comma-separated HTTPS origins without paths.");
        break;
      }
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
    errors.push(
      "TOKENLESS_THIRDWEB_WALLET_ENABLED must remain false for hosted releases until externally verifiable wallet export and recovery are implemented.",
    );
  }
  if (missingConfiguration) return errors;

  validateRpcFallbacks(env, errors);

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
    "TOKENLESS_FEEDBACK_BONUS_ADDRESS",
    "TOKENLESS_BEACON_VERIFIER_ADDRESS",
    "TOKENLESS_USDC_ADDRESS",
    "TOKENLESS_FEE_RECIPIENT",
  ];
  for (const name of addresses) {
    const address = value(env, name);
    if (!nonZeroEvmAddress(address)) {
      errors.push(`${name} must be a non-zero EVM address.`);
    }
  }
  const feedbackBonusAddress = value(env, "TOKENLESS_FEEDBACK_BONUS_ADDRESS").toLowerCase();
  for (const name of [
    "TOKENLESS_PANEL_ADDRESS",
    "TOKENLESS_CREDENTIAL_ISSUER_ADDRESS",
    "TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS",
    "TOKENLESS_USDC_ADDRESS",
    "TOKENLESS_FEE_RECIPIENT",
  ]) {
    if (feedbackBonusAddress && feedbackBonusAddress === value(env, name).toLowerCase()) {
      errors.push(`TOKENLESS_FEEDBACK_BONUS_ADDRESS must be a dedicated escrow address distinct from ${name}.`);
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
  const revealWindowSeconds = value(env, "TOKENLESS_REVEAL_WINDOW_SECONDS");
  if (positiveInteger(revealWindowSeconds) && Number(revealWindowSeconds) < MINIMUM_REVEAL_WINDOW_SECONDS) {
    errors.push(`TOKENLESS_REVEAL_WINDOW_SECONDS must be at least ${MINIMUM_REVEAL_WINDOW_SECONDS} seconds.`);
  }
  const beaconFailureGraceSeconds = value(env, "TOKENLESS_BEACON_FAILURE_GRACE_SECONDS");
  if (positiveInteger(beaconFailureGraceSeconds) && Number(beaconFailureGraceSeconds) < 21_600) {
    errors.push("TOKENLESS_BEACON_FAILURE_GRACE_SECONDS must be at least 21600 seconds.");
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
    errors.push("WORLD_ID_ENVIRONMENT must be production for a hosted release.");
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
  const evidenceFinalityBlockTag = value(env, "TOKENLESS_EVIDENCE_FINALITY_BLOCK_TAG").toLowerCase();
  const evidenceConfirmationDepth = value(env, "TOKENLESS_EVIDENCE_CONFIRMATION_DEPTH");
  if (Boolean(evidenceFinalityBlockTag) === Boolean(evidenceConfirmationDepth)) {
    errors.push(
      "Configure exactly one of TOKENLESS_EVIDENCE_FINALITY_BLOCK_TAG or TOKENLESS_EVIDENCE_CONFIRMATION_DEPTH.",
    );
  } else if (evidenceFinalityBlockTag && !["safe", "finalized"].includes(evidenceFinalityBlockTag)) {
    errors.push('TOKENLESS_EVIDENCE_FINALITY_BLOCK_TAG must be "safe" or "finalized".');
  } else if (
    evidenceConfirmationDepth &&
    (!positiveInteger(evidenceConfirmationDepth) || Number(evidenceConfirmationDepth) < 64)
  ) {
    errors.push("TOKENLESS_EVIDENCE_CONFIRMATION_DEPTH must be an integer of at least 64.");
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

  const secretRoles = new Map();
  const managedSignerResources = new Map();
  const managedSignerAddresses = new Map();
  const managedSignerRoleArns = new Map();
  const addDistinctManagedSignerValue = (kind, role, identifier, inventory) => {
    if (!identifier) return;
    const roles = inventory.get(identifier) ?? [];
    roles.push(role);
    inventory.set(identifier, roles);
    if (roles.length > 1) errors.push(`Managed signer ${kind} must be distinct: ${roles.join(", ")}.`);
  };
  for (const role of MANAGED_EVM_SIGNER_ROLES) {
    const prefix = `TOKENLESS_${role}_KMS`;
    const keyResource = value(env, `${prefix}_KEY_RESOURCE`);
    const expectedAddress = value(env, `${prefix}_EXPECTED_ADDRESS`).toLowerCase();
    const region = value(env, `${prefix}_REGION`);
    const roleArn = value(env, `${prefix}_ROLE_ARN`);
    if (!/^arn:aws:kms:eu-[a-z]+-\d+:\d{12}:(?:key\/[0-9a-f-]{36}|alias\/[A-Za-z0-9/_+=,.@-]+)$/u.test(keyResource)) {
      errors.push(`${prefix}_KEY_RESOURCE must identify a dedicated AWS KMS key or alias in an EU region.`);
    }
    if (!nonZeroEvmAddress(expectedAddress)) {
      errors.push(`${prefix}_EXPECTED_ADDRESS must be a non-zero EVM address.`);
    }
    if (!/^eu-[a-z]+-\d+$/u.test(region)) {
      errors.push(`${prefix}_REGION must be a concrete EU AWS region.`);
    }
    if (!/^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_\/-]{1,512}$/u.test(roleArn)) {
      errors.push(`${prefix}_ROLE_ARN must identify the role-specific workload-identity signer role.`);
    }
    for (const [kind, identifier, inventory] of [
      ["KMS key resources", keyResource.toLowerCase(), managedSignerResources],
      ["EVM addresses", expectedAddress, managedSignerAddresses],
      ["IAM role ARNs", roleArn.toLowerCase(), managedSignerRoleArns],
    ]) {
      addDistinctManagedSignerValue(kind, role, identifier, inventory);
    }
  }
  const evidenceKeyResource = value(env, "TOKENLESS_EVIDENCE_KMS_KEY_RESOURCE");
  if (
    !/^arn:aws:kms:eu-[a-z]+-\d+:\d{12}:(?:key\/[0-9a-f-]{36}|alias\/[A-Za-z0-9/_+=,.@-]+)$/u.test(evidenceKeyResource)
  ) {
    errors.push("TOKENLESS_EVIDENCE_KMS_KEY_RESOURCE must identify a dedicated AWS KMS key or alias in an EU region.");
  }
  if (managedSignerResources.has(evidenceKeyResource.toLowerCase())) {
    errors.push("TOKENLESS_EVIDENCE_KMS_KEY_RESOURCE must be distinct from every EVM signer key.");
  }
  if (!/^eu-[a-z]+-\d+$/u.test(value(env, "TOKENLESS_EVIDENCE_KMS_REGION"))) {
    errors.push("TOKENLESS_EVIDENCE_KMS_REGION must be a concrete EU AWS region.");
  }
  if (!/^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_\/-]{1,512}$/u.test(value(env, "TOKENLESS_EVIDENCE_KMS_ROLE_ARN"))) {
    errors.push("TOKENLESS_EVIDENCE_KMS_ROLE_ARN must identify the evidence workload-identity signer role.");
  }
  addDistinctManagedSignerValue(
    "KMS key resources",
    "EVIDENCE",
    evidenceKeyResource.toLowerCase(),
    managedSignerResources,
  );
  addDistinctManagedSignerValue(
    "IAM role ARNs",
    "EVIDENCE",
    value(env, "TOKENLESS_EVIDENCE_KMS_ROLE_ARN").toLowerCase(),
    managedSignerRoleArns,
  );
  const keeperKeyResource = value(env, "TOKENLESS_KEEPER_KMS_KEY_RESOURCE");
  const keeperExpectedAddress = value(env, "TOKENLESS_KEEPER_KMS_EXPECTED_ADDRESS").toLowerCase();
  const keeperRegion = value(env, "TOKENLESS_KEEPER_KMS_REGION");
  const keeperRoleArn = value(env, "TOKENLESS_KEEPER_KMS_ROLE_ARN");
  if (!/^arn:aws:kms:eu-[a-z]+-\d+:\d{12}:key\/[0-9a-f-]{36}$/u.test(keeperKeyResource)) {
    errors.push("TOKENLESS_KEEPER_KMS_KEY_RESOURCE must identify the keeper's exact AWS KMS key in an EU region.");
  }
  if (!nonZeroEvmAddress(keeperExpectedAddress)) {
    errors.push("TOKENLESS_KEEPER_KMS_EXPECTED_ADDRESS must be a non-zero EVM address.");
  }
  if (!/^eu-[a-z]+-\d+$/u.test(keeperRegion)) {
    errors.push("TOKENLESS_KEEPER_KMS_REGION must be a concrete EU AWS region.");
  }
  if (!/^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_\/-]{1,512}$/u.test(keeperRoleArn)) {
    errors.push("TOKENLESS_KEEPER_KMS_ROLE_ARN must identify the keeper workload-identity signer role.");
  }
  addDistinctManagedSignerValue("KMS key resources", "KEEPER", keeperKeyResource.toLowerCase(), managedSignerResources);
  addDistinctManagedSignerValue("EVM addresses", "KEEPER", keeperExpectedAddress, managedSignerAddresses);
  addDistinctManagedSignerValue("IAM role ARNs", "KEEPER", keeperRoleArn.toLowerCase(), managedSignerRoleArns);
  addDistinctManagedSignerValue(
    "IAM role ARNs",
    "ARTIFACT_VAULT",
    value(env, "TOKENLESS_AWS_KMS_ROLE_ARN").toLowerCase(),
    managedSignerRoleArns,
  );
  if (!/^p256:[0-9a-f]{24}$/u.test(value(env, "TOKENLESS_EVIDENCE_SIGNING_KEY_ID"))) {
    errors.push("TOKENLESS_EVIDENCE_SIGNING_KEY_ID must be the configured P-256 KMS public-key fingerprint.");
  }
  try {
    const entries = JSON.parse(value(env, "TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS"));
    const current =
      Array.isArray(entries) &&
      entries.filter(
        entry =>
          entry &&
          typeof entry === "object" &&
          !Array.isArray(entry) &&
          entry.algorithm === "ECDSA-SHA256" &&
          entry.status === "current" &&
          entry.keyId === value(env, "TOKENLESS_EVIDENCE_SIGNING_KEY_ID") &&
          typeof entry.publicKey === "string",
      );
    if (!current || current.length !== 1) throw new Error("missing current key");
    const publicKey = createPublicKey({
      key: Buffer.from(current[0].publicKey, "base64url"),
      format: "der",
      type: "spki",
    });
    if (publicKey.asymmetricKeyType !== "ec" || publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
      throw new Error("wrong key type");
    }
    const fingerprint = `p256:${createHash("sha256")
      .update(publicKey.export({ format: "der", type: "spki" }))
      .digest("hex")
      .slice(0, 24)}`;
    if (fingerprint !== current[0].keyId) throw new Error("wrong fingerprint");
  } catch {
    errors.push("TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS must publish exactly one current P-256 KMS evidence key.");
  }
  const worldSigningKey = value(env, "WORLD_ID_RP_SIGNING_KEY").replace(/^0x/u, "");
  if (!/^[0-9a-fA-F]{64}$/u.test(worldSigningKey)) errors.push("WORLD_ID_RP_SIGNING_KEY must be a 32-byte hex key.");
  else addSecretRole(secretRoles, "WORLD_ID_RP_SIGNING_KEY", worldSigningKey);

  for (const [prefix, encoding] of [
    ["TOKENLESS_ASSURANCE_RATIONALE_VAULT", "base64url"],
    ["TOKENLESS_ASSURANCE_REVIEWER_MAPPING", "base64url"],
    ["TOKENLESS_PUBLIC_RATER_RESPONSE_VAULT", "base64url"],
    ["TOKENLESS_PROVIDER_EVIDENCE_VAULT", "base64"],
    ["TOKENLESS_TAX_VAULT", "base64"],
    ["TOKENLESS_VOTE_MAPPING_VAULT", "base64"],
    ["TOKENLESS_PROVIDER_SUBJECT_HMAC", "base64url"],
    ["TOKENLESS_WORLD_ID_EVIDENCE", "base64url"],
    ["TOKENLESS_GOLD_INJECTION", "base64url"],
  ]) {
    addSecretRole(secretRoles, prefix, currentKey(env, prefix, encoding, errors));
  }
  const pseudonymKey = decode32(value(env, "TOKENLESS_PSEUDONYM_KEY"), "base64url");
  if (!pseudonymKey) errors.push("TOKENLESS_PSEUDONYM_KEY must encode exactly 32 bytes.");
  addSecretRole(secretRoles, "TOKENLESS_PSEUDONYM_KEY", pseudonymKey);
  const publicMediaPreviewSecret = decodePublicMediaPreviewSecret(value(env, "TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET"));
  if (!publicMediaPreviewSecret) {
    errors.push("TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET must encode exactly 32 bytes.");
  }
  addSecretRole(secretRoles, "TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET", publicMediaPreviewSecret);
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
  for (const names of secretRoles.values()) {
    const message = `Production key roles must be distinct: ${names.join(", ")}.`;
    if (names.length > 1 && !errors.includes(message)) errors.push(message);
  }

  const active = activeDeployment(activeRegistry, errors);
  if (active) {
    const expectedKey = [
      "tokenless-v4",
      BASE_SEPOLIA_CHAIN_ID,
      value(env, "TOKENLESS_PANEL_ADDRESS").toLowerCase(),
      value(env, "TOKENLESS_CREDENTIAL_ISSUER_ADDRESS").toLowerCase(),
      value(env, "TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS").toLowerCase(),
      value(env, "TOKENLESS_FEEDBACK_BONUS_ADDRESS").toLowerCase(),
    ].join(":");
    const matches = [
      active.deploymentKey === expectedKey && value(env, "TOKENLESS_DEPLOYMENT_KEY").toLowerCase() === expectedKey,
      Number(active.deploymentBlockNumber) === Number(value(env, "TOKENLESS_DEPLOYMENT_BLOCK")),
      active.contracts?.TokenlessPanel?.address?.toLowerCase() === value(env, "TOKENLESS_PANEL_ADDRESS").toLowerCase(),
      active.contracts?.CredentialIssuer?.address?.toLowerCase() ===
        value(env, "TOKENLESS_CREDENTIAL_ISSUER_ADDRESS").toLowerCase(),
      active.contracts?.X402PanelSubmitter?.address?.toLowerCase() ===
        value(env, "TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS").toLowerCase(),
      active.contracts?.TokenlessFeedbackBonus?.address?.toLowerCase() ===
        value(env, "TOKENLESS_FEEDBACK_BONUS_ADDRESS").toLowerCase(),
      active.contracts?.TestUSDC?.address?.toLowerCase() === value(env, "TOKENLESS_USDC_ADDRESS").toLowerCase(),
      active.beaconVerifier?.toLowerCase() === value(env, "TOKENLESS_BEACON_VERIFIER_ADDRESS").toLowerCase(),
    ];
    if (matches.some(match => !match)) {
      errors.push("The configured chain bundle must exactly match the complete active tokenless v4 registry.");
    }
  }
  return errors;
}

function main() {
  const hosted =
    process.argv.includes("--hosted") ||
    process.argv.includes("--production") ||
    process.env.VERCEL === "1" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.VERCEL_ENV === "preview";
  const errors = validateTokenlessProductionReadiness({
    env: process.env,
    activeRegistry: tokenlessDeployedContracts,
    hosted,
  });
  if (errors.length > 0) {
    throw new Error(`Tokenless hosted-release preflight refused:\n- ${errors.join("\n- ")}`);
  }
  const testDeployment = hosted && value(process.env, "VERCEL_GIT_COMMIT_REF") !== "main";
  console.log(
    testDeployment
      ? "Isolated tokenless test-deployment preflight passed."
      : hosted
        ? "Tokenless hosted-release preflight passed."
        : "Tokenless hosted-release preflight skipped.",
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
