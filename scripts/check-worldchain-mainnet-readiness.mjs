import { fileURLToPath } from "node:url";

export const WORLDCHAIN_MAINNET_READINESS_RETIRED_NOTICE =
  "World Chain mainnet readiness is retired for the Base production deployment. Use `yarn base:check` or `yarn base-mainnet:check` for production changes and `yarn base-sepolia:check` for staging validation.";

async function main() {
  console.error(WORLDCHAIN_MAINNET_READINESS_RETIRED_NOTICE);
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
