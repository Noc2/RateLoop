import { createPrivateKey } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TOKENLESS_VERCEL_PROJECT = {
  projectId: "prj_H6C2pfWKEAupFroHbLfzhquaNCLm",
  projectName: "rateloop-tokenless",
};

function normalizedHost(value) {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).host.toLowerCase();
  } catch {
    return null;
  }
}

function configuredOriginHost(env) {
  const raw =
    env.APP_URL ||
    env.NEXT_PUBLIC_APP_URL ||
    (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : null) ||
    (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : null);
  return normalizedHost(raw);
}

function has(value) {
  return Boolean(value?.trim());
}

function validateOptionalProviderPair(env, idName, secretName, label, errors) {
  if (has(env[idName]) !== has(env[secretName])) {
    errors.push(`${label} requires both ${idName} and ${secretName}, or neither.`);
  }
}

function validateThirdwebWalletIssuer(env, errors) {
  const enabled = env.TOKENLESS_THIRDWEB_WALLET_ENABLED?.trim().toLowerCase();
  if (enabled !== "true" && enabled !== "false") {
    errors.push("TOKENLESS_THIRDWEB_WALLET_ENABLED must be explicitly true or false.");
    return;
  }
  if (enabled === "false") return;
  for (const name of ["NEXT_PUBLIC_THIRDWEB_CLIENT_ID", "TOKENLESS_THIRDWEB_WALLET_AUDIENCE", "TOKENLESS_THIRDWEB_WALLET_KEY_ID"]) {
    if (!has(env[name])) errors.push(`${name} is required when optional thirdweb wallet creation is enabled.`);
  }
  const localKey = has(env.TOKENLESS_THIRDWEB_WALLET_PRIVATE_JWK);
  const managedKey = has(env.TOKENLESS_THIRDWEB_WALLET_KMS_KEY_RESOURCE);
  if (localKey && managedKey) errors.push("Configure exactly one thirdweb wallet signing key source.");
  if (env.VERCEL_GIT_COMMIT_REF === "main") {
    if (localKey) errors.push("TOKENLESS_THIRDWEB_WALLET_PRIVATE_JWK is forbidden on main; use managed KMS signing.");
    for (const name of [
      "TOKENLESS_THIRDWEB_WALLET_KMS_KEY_RESOURCE",
      "TOKENLESS_THIRDWEB_WALLET_KMS_REGION",
      "TOKENLESS_THIRDWEB_WALLET_KMS_ROLE_ARN",
    ]) {
      if (!has(env[name])) errors.push(`${name} is required when optional thirdweb wallet creation is enabled.`);
    }
  } else if (!localKey && !managedKey) {
    errors.push("A thirdweb wallet signing key source is required when optional wallet creation is enabled.");
  }
  if (!localKey) return;
  try {
    const jwk = JSON.parse(env.TOKENLESS_THIRDWEB_WALLET_PRIVATE_JWK);
    const key = createPrivateKey({ key: jwk, format: "jwk" });
    if (key.asymmetricKeyType !== "ed25519" || jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.d || !jwk.x) {
      throw new Error("invalid key");
    }
  } catch {
    errors.push("TOKENLESS_THIRDWEB_WALLET_PRIVATE_JWK must be a private Ed25519 JWK.");
  }
}

export function validateIdentityDeployment({ env, projectLinks = [], hosted = false }) {
  const errors = [];
  const originHost = configuredOriginHost(env);

  if (!hosted) return errors;

  if ((env.BETTER_AUTH_SECRET?.trim().length ?? 0) < 32) {
    errors.push("BETTER_AUTH_SECRET must contain at least 32 characters.");
  }
  if (!originHost) errors.push("APP_URL or NEXT_PUBLIC_APP_URL must define the tokenless origin.");
  const passkeyRpId = env.BETTER_AUTH_PASSKEY_RP_ID?.trim().toLowerCase();
  if (!passkeyRpId) errors.push("BETTER_AUTH_PASSKEY_RP_ID is required for hosted passkeys.");
  else if (passkeyRpId && originHost && passkeyRpId !== originHost) {
    errors.push(`Better Auth passkey RP ID ${passkeyRpId} does not match tokenless origin ${originHost}.`);
  }
  if (originHost === "rateloop.ai" || originHost === "www.rateloop.ai") {
    errors.push("Tokenless authentication must never target rateloop.ai.");
  }
  validateOptionalProviderPair(
    env,
    "BETTER_AUTH_GOOGLE_CLIENT_ID",
    "BETTER_AUTH_GOOGLE_CLIENT_SECRET",
    "Google sign-in",
    errors,
  );
  validateOptionalProviderPair(
    env,
    "BETTER_AUTH_APPLE_CLIENT_ID",
    "BETTER_AUTH_APPLE_CLIENT_SECRET",
    "Apple sign-in",
    errors,
  );
  for (const name of [
    "NEXT_PUBLIC_BETTER_AUTH_SECRET",
    "NEXT_PUBLIC_BETTER_AUTH_GOOGLE_CLIENT_SECRET",
    "NEXT_PUBLIC_BETTER_AUTH_APPLE_CLIENT_SECRET",
    "NEXT_PUBLIC_TOKENLESS_THIRDWEB_WALLET_PRIVATE_JWK",
  ]) {
    if (has(env[name])) errors.push(`${name} is forbidden because identity secrets must remain server-only.`);
  }
  validateThirdwebWalletIssuer(env, errors);

  const systemLink =
    env.VERCEL_PROJECT_ID || env.VERCEL_PROJECT_NAME
      ? { projectId: env.VERCEL_PROJECT_ID, projectName: env.VERCEL_PROJECT_NAME }
      : null;
  const links = systemLink ? [...projectLinks, systemLink] : projectLinks;
  if (links.length === 0) {
    errors.push("The Vercel project link is unavailable; expected rateloop-tokenless.");
  }
  for (const link of links) {
    const projectIdMismatch = !link.projectId || link.projectId !== TOKENLESS_VERCEL_PROJECT.projectId;
    const projectNameMismatch = link.projectName != null && link.projectName !== TOKENLESS_VERCEL_PROJECT.projectName;
    if (projectIdMismatch || projectNameMismatch) {
      errors.push(
        `Unexpected Vercel project ${link.projectName ?? "unknown"} (${link.projectId ?? "unknown"}); expected ${TOKENLESS_VERCEL_PROJECT.projectName} (${TOKENLESS_VERCEL_PROJECT.projectId}).`,
      );
    }
  }
  return errors;
}

function readProjectLink(candidate) {
  if (!fs.existsSync(candidate)) return null;
  try {
    return JSON.parse(fs.readFileSync(candidate, "utf8"));
  } catch {
    return { projectId: null, projectName: null };
  }
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(scriptDir, "..");
  const repoRoot = path.resolve(packageRoot, "../..");
  const projectLinks = [
    readProjectLink(path.join(packageRoot, ".vercel/project.json")),
    readProjectLink(path.join(repoRoot, ".vercel/project.json")),
  ].filter(Boolean);
  const hosted =
    process.argv.includes("--production") ||
    process.env.VERCEL === "1" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.VERCEL_ENV === "preview";
  const errors = validateIdentityDeployment({ env: process.env, projectLinks, hosted });
  if (errors.length > 0) {
    console.error(`Tokenless identity deployment check failed:\n- ${errors.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    hosted
      ? "Tokenless identity deployment check passed."
      : "Tokenless identity deployment check skipped outside a hosted deployment.",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
