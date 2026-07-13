# `@rateloop/contracts`

TypeScript artifacts for the isolated tokenless protocol.

The package exports exactly four ABIs:

- `TokenlessPanelAbi`
- `CredentialIssuerAbi`
- `X402PanelSubmitterAbi`
- `TokenlessTestUSDCAbi`

The active `tokenlessDeployedContracts` registry is intentionally empty and reserves deployment schema v2. The old chain-`84532` metadata is available only through `tokenlessHistoricalDeployments`; it records a disposable v1 Base Sepolia stack that is incompatible with the current fund core.

```ts
import {
  TokenlessPanelAbi,
  tokenlessDeployedContracts,
  tokenlessDeploymentSchema,
  tokenlessHistoricalDeployments,
} from "@rateloop/contracts";

console.log(tokenlessDeploymentSchema, tokenlessDeployedContracts); // v2, {}
console.log(tokenlessHistoricalDeployments[84532].deploymentStatus); // historical
```

The same exports are available from `@rateloop/contracts/tokenless`. There are no address fallbacks. Only a fresh v2 Foundry deployment may repopulate the active registry.

The package ships ESM, CommonJS, and TypeScript declarations. Run:

```bash
yarn build
yarn check-types
yarn test
```
