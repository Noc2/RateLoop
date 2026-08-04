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

function inspectTokenlessProduction({ packageRoot, repoRoot, spawn }) {
  const result = spawn(
    "yarn",
    ["exec", "vercel", "inspect", TOKENLESS_PRODUCTION_ALIAS, "--format=json", "--non-interactive", "--cwd", repoRoot],
    { cwd: packageRoot, encoding: "utf8" },
  );
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
  const previousDeploymentId = verifiesProduction ? inspectTokenlessProduction({ packageRoot, repoRoot, spawn }) : null;
  const result = spawn("yarn", ["exec", "vercel", "--cwd", repoRoot, ...forwardedArgs], {
    cwd: packageRoot,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  const status = result.status ?? 1;
  if (status !== 0 || !verifiesProduction) return status;

  const deployedId = inspectTokenlessProduction({ packageRoot, repoRoot, spawn });
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
  return 0;
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(scriptDir, "..");
  const repoRoot = path.resolve(packageRoot, "../..");
  try {
    process.exitCode = runTokenlessVercel({
      forwardedArgs: process.argv.slice(2),
      packageRoot,
      repoRoot,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
