import { TOKENLESS_VERCEL_PROJECT, tokenlessVercelProjectLinkError } from "./tokenless-vercel-project.mjs";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function readProjectLink(candidate, readFileSync) {
  try {
    return JSON.parse(readFileSync(candidate, "utf8"));
  } catch {
    return null;
  }
}

export function validateTokenlessVercelLinks({ packageRoot, readFileSync = fs.readFileSync, repoRoot }) {
  const candidates = [path.join(repoRoot, ".vercel/project.json"), path.join(packageRoot, ".vercel/project.json")];
  const errors = candidates.flatMap(candidate => {
    const error = tokenlessVercelProjectLinkError(readProjectLink(candidate, readFileSync));
    return error ? [`${candidate}: ${error}`] : [];
  });
  if (errors.length > 0) {
    throw new Error(`Tokenless Vercel deployment aborted before contacting Vercel:\n- ${errors.join("\n- ")}`);
  }
}

const TOKENLESS_PRODUCTION_ALIAS = "rateloop-tokenless.vercel.app";

/**
 * Minutes of session life a deploy is assumed to need. The Next.js build alone
 * takes roughly two, and the Vercel CLI checks its token once at startup with no
 * safety margin, so a session that expires mid-build kills the CLI while Vercel's
 * builder carries on and finishes. That is what happened on 7 August: 204 seconds
 * of token life remained when the deploy began.
 */
const REQUIRED_SESSION_MINUTES = 20;

/** Where the Vercel CLI keeps its OAuth session, per platform. */
function vercelAuthConfigPath(env, platform) {
  if (env.VERCEL_TOKEN || env.NOW_TOKEN) return null; // token auth does not expire
  const home = env.HOME ?? "";
  if (!home) return null;
  return platform === "darwin"
    ? path.join(home, "Library", "Application Support", "com.vercel.cli", "auth.json")
    : path.join(home, ".config", "com.vercel.cli", "auth.json");
}

/**
 * Refuses to start a deploy that the session cannot outlive. Reads only the
 * expiry timestamp — never the token itself.
 */
export function assertVercelSessionOutlivesDeploy({ env, now, platform, readFileSync }) {
  const authPath = vercelAuthConfigPath(env, platform);
  if (!authPath) return;
  let expiresAt;
  try {
    expiresAt = JSON.parse(readFileSync(authPath, "utf8"))?.expiresAt;
  } catch {
    return; // no session file yet; the CLI will prompt or fail on its own terms
  }
  if (typeof expiresAt !== "number") return; // no expiry recorded means token auth
  const minutesLeft = Math.floor((expiresAt * 1000 - now) / 60_000);
  if (minutesLeft >= REQUIRED_SESSION_MINUTES) return;
  throw new Error(
    minutesLeft <= 0
      ? "The Vercel session has expired. Re-authenticate before deploying; the CLI checks its token only at startup."
      : `The Vercel session expires in ${minutesLeft}m and a deploy needs about ${REQUIRED_SESSION_MINUTES}m. ` +
        "Re-authenticate first — the CLI dies mid-build while Vercel finishes, which reports a failure for a deployment that succeeded.",
  );
}

/**
 * Distinguishes "the deployment is wrong" from "we could not ask". Collapsing
 * both into null is what made a succeeded-but-unverified deploy indistinguishable
 * from a failed one.
 */
function inspectTokenlessProduction({ packageRoot, repoRoot, spawn }) {
  const result = spawn(
    "yarn",
    ["exec", "vercel", "inspect", TOKENLESS_PRODUCTION_ALIAS, "--format=json", "--non-interactive", "--cwd", repoRoot],
    { cwd: packageRoot, encoding: "utf8" },
  );
  if (/not authorized|credentials|token/iu.test(String(result.stderr ?? "")))
    return { ok: false, reason: "unauthorized" };
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") return null;
  const jsonStart = result.stdout.indexOf("{");
  if (jsonStart < 0) return null;
  try {
    const deployment = JSON.parse(result.stdout.slice(jsonStart));
    if (
      typeof deployment?.id !== "string" ||
      deployment.name !== TOKENLESS_VERCEL_PROJECT.projectName ||
      deployment.target !== "production" ||
      deployment.readyState !== "READY" ||
      !Array.isArray(deployment.aliases) ||
      !deployment.aliases.includes(TOKENLESS_PRODUCTION_ALIAS)
    ) {
      return null;
    }
    return deployment.id;
  } catch {
    return null;
  }
}

export function runTokenlessVercel({
  forwardedArgs,
  packageRoot,
  readFileSync = fs.readFileSync,
  repoRoot,
  spawn = spawnSync,
}) {
  validateTokenlessVercelLinks({ packageRoot, readFileSync, repoRoot });
  const verifiesProduction = forwardedArgs.includes("--prod");
  const previousInspect = verifiesProduction ? inspectTokenlessProduction({ packageRoot, repoRoot, spawn }) : null;
  const previousDeploymentId = typeof previousInspect === "string" ? previousInspect : null;
  const result = spawn("yarn", ["exec", "vercel", "--cwd", repoRoot, ...forwardedArgs], {
    cwd: packageRoot,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  const status = result.status ?? 1;
  if (!verifiesProduction) return status;

  // Always ask Vercel what happened, even when the CLI failed. The CLI can die
  // locally — an expired session is the common way — while the build completes
  // and promotes normally, and returning the CLI's status without checking
  // reports that success as a failure.
  const inspected = inspectTokenlessProduction({ packageRoot, repoRoot, spawn });
  if (inspected && typeof inspected === "object" && inspected.reason === "unauthorized") {
    throw new Error(
      "The deploy status is unknown: Vercel refused the verification request. Re-authenticate and re-inspect " +
        `${TOKENLESS_PRODUCTION_ALIAS} before deploying again — a blind retry may duplicate a deployment that succeeded.`,
    );
  }
  const deployedId = typeof inspected === "string" ? inspected : null;
  if (!deployedId) {
    throw new Error(
      `Vercel did not expose a ready production deployment on ${TOKENLESS_PRODUCTION_ALIAS}; refusing to report success.`,
    );
  }
  if (previousDeploymentId && deployedId === previousDeploymentId) {
    throw new Error(
      `Vercel left ${TOKENLESS_PRODUCTION_ALIAS} on ${deployedId}; refusing to report a no-op deployment as successful.`,
    );
  }
  if (status !== 0) {
    // Exit 2, not 0 and not 1: the site is correct but the run was not clean, so
    // a script chaining on this should stop without being told the deploy failed.
    console.error(
      `The Vercel CLI exited ${status}, but ${TOKENLESS_PRODUCTION_ALIAS} now serves a new ready production ` +
        `deployment (${deployedId}). The site is correct; the local run failed, most likely an expired session.`,
    );
    return 2;
  }
  return 0;
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(scriptDir, "..");
  const repoRoot = path.resolve(packageRoot, "../..");
  try {
    const forwardedArgs = process.argv.slice(2);
    if (forwardedArgs.includes("--prod")) {
      assertVercelSessionOutlivesDeploy({
        env: process.env,
        now: Date.now(),
        platform: process.platform,
        readFileSync: fs.readFileSync,
      });
    }
    process.exitCode = runTokenlessVercel({ forwardedArgs, packageRoot, repoRoot });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
