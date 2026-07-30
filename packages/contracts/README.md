# `@rateloop/contracts`

TypeScript artifacts for the isolated tokenless protocol.

The package exports exactly five ABIs:

- `TokenlessPanelAbi`
- `CredentialIssuerAbi`
- `X402PanelSubmitterAbi`
- `TokenlessFeedbackBonusAbi`
- `TokenlessTestUSDCAbi`

`tokenlessDeployedContracts` is intentionally empty until a fresh Base Sepolia deployment matches the current fund
core and produces a complete validated v4 artifact. The checked-in v4 deployment file at block `44390557` is historical
evidence only; it is incomplete for the current schema and must not be used by an app or service. Older chain-`84532`
metadata remains available only through `tokenlessHistoricalDeployments`.

```ts
import {
  TokenlessPanelAbi,
  tokenlessDeployedContracts,
  tokenlessDeploymentSchema,
  tokenlessHistoricalDeployments,
} from "@rateloop/contracts";

console.log(tokenlessDeploymentSchema, tokenlessDeployedContracts[84532]); // v4, undefined until a fresh deployment
console.log(tokenlessHistoricalDeployments[84532].deploymentStatus); // historical
```

The first lookup returns `undefined` until deployment. The same exports are available from
`@rateloop/contracts/tokenless`. There are no address fallbacks: hosted consumers must match a newly generated complete
v4 deployment key.

The package ships ESM, CommonJS, and TypeScript declarations. Run:

```bash
yarn build
yarn check-types
yarn test
```
