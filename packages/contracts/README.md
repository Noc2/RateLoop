# `@rateloop/contracts`

Generated TypeScript artifacts for the isolated tokenless-v1 protocol.

The package exports exactly four ABIs:

- `TokenlessPanelAbi`
- `CredentialIssuerAbi`
- `X402PanelSubmitterAbi`
- `TokenlessTestUSDCAbi`

It also exports `tokenlessDeployedContracts` and `tokenlessDeploymentSchema`. The checked-in chain-`84532` metadata records a historical disposable Base Sepolia stack and is stale after current fund-core changes. Do not use it as a live compatibility target. A fresh deployment will replace it atomically; its key will bind the panel, issuer, and adapter addresses.

```ts
import {
  TokenlessPanelAbi,
  tokenlessDeployedContracts,
  tokenlessDeploymentSchema,
} from "@rateloop/contracts";

const deployment = tokenlessDeployedContracts[84532];
console.log(tokenlessDeploymentSchema, deployment.deploymentKey);
```

The same exports are available from `@rateloop/contracts/tokenless`. There are no compatibility subpaths or address fallbacks. A new deployment must be generated from the isolated Foundry deployment artifact and replaces this package surface atomically.

The package ships ESM, CommonJS, and TypeScript declarations. Run:

```bash
yarn build
yarn check-types
yarn test
```
