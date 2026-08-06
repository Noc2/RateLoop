# `@rateloop/contracts`

TypeScript artifacts for the isolated tokenless protocol.

The package exports exactly five ABIs:

- `TokenlessPanelAbi`
- `CredentialIssuerAbi`
- `X402PanelSubmitterAbi`
- `TokenlessFeedbackBonusAbi`
- `TokenlessTestUSDCAbi`

`tokenlessDeployedContracts` exposes the current released v4 Base Sepolia test deployment beginning at block
`45115708`, and `tokenlessDeploymentStatus` marks it `released`. Apps and services must match its complete deployment
key. Older chain-`84532` metadata remains available only through `tokenlessHistoricalDeployments`.

```ts
import {
  TokenlessPanelAbi,
  tokenlessDeployedContracts,
  tokenlessDeploymentSchema,
  tokenlessHistoricalDeployments,
} from "@rateloop/contracts";

console.log(tokenlessDeploymentSchema, tokenlessDeployedContracts[84532]); // released v4 test deployment
console.log(tokenlessHistoricalDeployments[84532].deploymentStatus); // historical
```

The same exports are available from `@rateloop/contracts/tokenless`. There are no address fallbacks: after a fresh
deployment, hosted consumers must match the generated complete v4 deployment key.

The package ships ESM, CommonJS, and TypeScript declarations. Run:

```bash
yarn build
yarn check-types
yarn test
```
