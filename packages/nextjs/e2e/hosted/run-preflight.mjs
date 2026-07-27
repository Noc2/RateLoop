import { checkHostedOperations } from "./operations.mjs";
import { safeHostedSummary, validateHostedRun } from "./safety.mjs";

const mode = process.argv[2];
const checkoutSha = process.env.E2E_CHECKOUT_SHA?.trim() ?? "";

try {
  const context = validateHostedRun({ checkoutSha, mode });
  const operations = await checkHostedOperations({
    keeperAuthToken: process.env.E2E_KEEPER_AUTH_TOKEN,
    keeperUrl: process.env.E2E_KEEPER_URL ?? "",
    ponderUrl: process.env.E2E_PONDER_URL ?? "",
  });
  process.stdout.write(`${JSON.stringify({ operations, run: safeHostedSummary(context) }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Hosted E2E preflight failed."}\n`);
  process.exitCode = 1;
}
