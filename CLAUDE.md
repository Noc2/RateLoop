# Claude Workflow Notes

## Base deployment notes

- Base mainnet (`8453`) is now the production smart-contract deployment boundary, with addresses recorded in `packages/foundry/deployments/8453.json`.
- Treat Base Sepolia (`84532`) as the staging and validation environment for future contract or integration changes before touching production.
- Do not redeploy the production smart contracts as a routine fix. Only consider a full redeploy for a major issue or protocol-breaking problem that cannot be safely repaired with governed upgrades, configuration changes, application changes, keeper/indexer changes, or a targeted runbook.
- Preserve the current production contract addresses by default when updating app, Ponder, Keeper, docs, or environment wiring.
- Ponder and Keeper services should resolve Base addresses from the shared `@rateloop/contracts` deployment artifacts for chain `84532` or `8453`; remove stale live address overrides instead of carrying World Chain values forward.
