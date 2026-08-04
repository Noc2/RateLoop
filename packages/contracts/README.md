# `@rateloop/contracts`

TypeScript artifacts for the isolated tokenless protocol.

The package exports exactly five ABIs:

- `TokenlessPanelAbi`
- `CredentialIssuerAbi`
- `X402PanelSubmitterAbi`
- `TokenlessFeedbackBonusAbi`
- `TokenlessTestUSDCAbi`

`tokenlessDeployedContracts` retains the stale v4 Base Sepolia test deployment beginning at block `44915850` as
evidence, while `tokenlessDeploymentStatus` marks it `fresh_deployment_required`. It must not configure an app or
service until a fresh complete Base Sepolia deployment replaces it. Older chain-`84532` metadata remains available
only through `tokenlessHistoricalDeployments`.

```ts
import {
  TokenlessPanelAbi,
  tokenlessDeployedContracts,
  tokenlessDeploymentSchema,
  tokenlessHistoricalDeployments,
} from "@rateloop/contracts";

console.log(tokenlessDeploymentSchema, tokenlessDeployedContracts[84532]); // stale v4 deployment evidence
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
