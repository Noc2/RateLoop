import { checkHostedOperations } from "./operations.mjs";
import { safeHostedSummary, validateHostedRun } from "./safety.mjs";
import { readFile } from "node:fs/promises";

const mode = process.argv[2];
const checkoutSha = process.env.E2E_CHECKOUT_SHA?.trim() ?? "";

try {
  const context = validateHostedRun({ checkoutSha, mode });
  const deployment = JSON.parse(
    await readFile(new URL("../../../foundry/deployments/tokenless-v4/84532.json", import.meta.url), "utf8"),
  );
  if (
    deployment?.schemaVersion !== "rateloop-tokenless-deployment-v4" ||
    deployment?.deploymentComplete !== true ||
    deployment?.sourceCompatibility !== undefined
  ) {
    throw new Error(
      deployment?.sourceCompatibility === "fresh_deployment_required"
        ? "The checked-in Base Sepolia tokenless-v4 deployment artifact is stale; a fresh complete deployment is required."
        : "The checked-in Base Sepolia tokenless-v4 deployment artifact is incomplete or invalid.",
    );
  }
  const operations = await checkHostedOperations({
    expectedDeployment: deployment,
    keeperAuthToken: process.env.E2E_KEEPER_AUTH_TOKEN,
    keeperUrl: process.env.E2E_KEEPER_URL ?? "",
    ponderUrl: process.env.E2E_PONDER_URL ?? "",
    requireAuthenticatedKeeper: mode === "core" || mode === "funded",
  });
  process.stdout.write(`${JSON.stringify({ operations, run: safeHostedSummary(context) }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Hosted E2E preflight failed."}\n`);
  process.exitCode = 1;
}
