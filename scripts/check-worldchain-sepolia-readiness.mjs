import { fileURLToPath } from "node:url";
import {
  WORLDCHAIN_SEPOLIA_READINESS_CONFIG,
} from "./readiness-core.mjs";

export * from "./readiness-core.mjs";

export const WORLDCHAIN_SEPOLIA_READINESS_RETIRED_NOTICE =
  "World Chain Sepolia readiness is retired for the fresh Base deployment. Use `yarn base-sepolia:check` for staging validation.";

async function main() {
  console.error(WORLDCHAIN_SEPOLIA_READINESS_RETIRED_NOTICE);
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
