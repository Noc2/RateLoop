import { execFileSync, spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PREFLIGHT = fileURLToPath(new URL("./run-preflight.mjs", import.meta.url));

function gitValue(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function execute(step, options) {
  return new Promise((resolveStep, rejectStep) => {
    const child = spawn(step.command, step.args, {
      cwd: options.cwd,
      env: step.env,
      stdio: "inherit",
    });
    child.once("error", rejectStep);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveStep();
        return;
      }
      rejectStep(
        new Error(`${step.label} failed${signal ? ` after signal ${signal}` : ` with exit code ${String(code)}`}.`),
      );
    });
  });
}

export function hostedReleaseSteps({ checkoutSha, environment = process.env, yarnCommand } = {}) {
  if (!SHA_PATTERN.test(checkoutSha ?? "")) throw new Error("Hosted release requires an exact checkout SHA.");
  const yarn = yarnCommand ?? (process.platform === "win32" ? "yarn.cmd" : "yarn");
  const env = { ...environment, E2E_CHECKOUT_SHA: checkoutSha };
  return [
    {
      label: "Hosted preflight",
      command: process.execPath,
      args: [PREFLIGHT, "core"],
      env,
    },
    {
      label: "Hosted read-only smoke",
      command: yarn,
      args: ["e2e:hosted:smoke"],
      env,
    },
    {
      label: "Hosted mutating core journey",
      command: yarn,
      args: ["e2e:hosted:core"],
      env,
    },
  ];
}

export async function runHostedRelease(options = {}) {
  const cwd = options.cwd ?? PACKAGE_ROOT;
  const environment = options.environment ?? process.env;
  const readGit = options.readGit ?? (args => gitValue(args, cwd));
  const runStep = options.runStep ?? (step => execute(step, { cwd }));
  const branch = await readGit(["branch", "--show-current"]);
  if (branch !== "tokenless") throw new Error("Hosted release must run from the tokenless branch.");
  const checkoutSha = (await readGit(["rev-parse", "HEAD"])).toLowerCase();
  if (!SHA_PATTERN.test(checkoutSha)) throw new Error("Git did not return an exact checkout SHA.");
  const expectedSha = environment.E2E_EXPECTED_GIT_SHA?.trim().toLowerCase() ?? "";
  if (expectedSha !== checkoutSha) {
    throw new Error("E2E_EXPECTED_GIT_SHA must match the checked-out tokenless commit.");
  }
  const expectedRef = environment.E2E_EXPECTED_GIT_REF?.trim() || "tokenless";
  if (expectedRef !== "tokenless") throw new Error("E2E_EXPECTED_GIT_REF must be exactly tokenless.");

  const steps = hostedReleaseSteps({ checkoutSha, environment, yarnCommand: options.yarnCommand });
  for (const step of steps) await runStep(step);
  return { branch, checkoutSha, steps: steps.map(step => step.label) };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runHostedRelease()
    .then(summary => process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`))
    .catch(error => {
      process.stderr.write(`${error instanceof Error ? error.message : "Hosted release failed."}\n`);
      process.exitCode = 1;
    });
}
