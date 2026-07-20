# `@rateloop/contracts`

TypeScript artifacts for the isolated tokenless protocol.

The package exports exactly five ABIs:

- `TokenlessPanelAbi`
- `CredentialIssuerAbi`
- `X402PanelSubmitterAbi`
- `TokenlessFeedbackBonusAbi`
- `TokenlessTestUSDCAbi`

The active `tokenlessDeployedContracts` registry contains the complete v4 Base Sepolia test bundle deployed at block `44390557`. Older chain-`84532` metadata remains available only through `tokenlessHistoricalDeployments` and is incompatible with the current fund core.

```ts
import {
  TokenlessPanelAbi,
  tokenlessDeployedContracts,
  tokenlessDeploymentSchema,
  tokenlessHistoricalDeployments,
} from "@rateloop/contracts";

console.log(tokenlessDeploymentSchema, tokenlessDeployedContracts[84532]); // v4, released
console.log(tokenlessHistoricalDeployments[84532].deploymentStatus); // historical
```

The same exports are available from `@rateloop/contracts/tokenless`. There are no address fallbacks: hosted consumers must match the complete v4 deployment key.

The package ships ESM, CommonJS, and TypeScript declarations. Run:

```bash
yarn build
yarn check-types
yarn test
```
