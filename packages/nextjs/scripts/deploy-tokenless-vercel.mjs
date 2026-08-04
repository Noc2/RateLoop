import { tokenlessVercelProjectLinkError } from "./tokenless-vercel-project.mjs";
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

export function runTokenlessVercel({
  forwardedArgs,
  packageRoot,
  readFileSync = fs.readFileSync,
  repoRoot,
  spawn = spawnSync,
}) {
  validateTokenlessVercelLinks({ packageRoot, readFileSync, repoRoot });
  const result = spawn("yarn", ["exec", "vercel", "--cwd", repoRoot, ...forwardedArgs], {
    cwd: packageRoot,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
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
