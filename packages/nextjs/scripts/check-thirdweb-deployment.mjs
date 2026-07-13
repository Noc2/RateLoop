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

export function validateThirdwebDeployment({ env, projectLinks = [], production = false }) {
  const errors = [];
  const authDomain = normalizedHost(env.NEXT_PUBLIC_THIRDWEB_AUTH_DOMAIN);
  const originHost = configuredOriginHost(env);

  if (!production) return errors;

  if (!env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID?.trim()) errors.push("NEXT_PUBLIC_THIRDWEB_CLIENT_ID is required.");
  if (!env.THIRDWEB_SECRET_KEY?.trim()) errors.push("THIRDWEB_SECRET_KEY is required.");
  if (!authDomain) errors.push("NEXT_PUBLIC_THIRDWEB_AUTH_DOMAIN must be a valid host.");
  if (!originHost) errors.push("APP_URL or NEXT_PUBLIC_APP_URL must define the tokenless origin.");
  if (authDomain && originHost && authDomain !== originHost) {
    errors.push(`Thirdweb auth domain ${authDomain} does not match tokenless origin ${originHost}.`);
  }
  if (originHost === "rateloop.ai" || originHost === "www.rateloop.ai") {
    errors.push("Tokenless authentication must never target rateloop.ai.");
  }
  if (env.NEXT_PUBLIC_THIRDWEB_SECRET_KEY?.trim()) {
    errors.push("THIRDWEB_SECRET_KEY must never have a NEXT_PUBLIC variant.");
  }

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
  const production =
    process.argv.includes("--production") ||
    process.env.VERCEL === "1" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.VERCEL_ENV === "preview";
  const errors = validateThirdwebDeployment({ env: process.env, projectLinks, production });
  if (errors.length > 0) {
    console.error(`Thirdweb tokenless deployment check failed:\n- ${errors.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    production
      ? "Thirdweb tokenless deployment check passed."
      : "Thirdweb deployment check skipped outside hosted production/preview.",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
