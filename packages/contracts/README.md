# RateLoop Contracts

Generated TypeScript contract artifacts for RateLoop integrations.

## Contents

- ABIs for the deployed RateLoop contracts.
- Shared deployment metadata for supported chains.
- Protocol constants and helpers used by the app, SDK, agents, keeper, and indexer.
- Vote commit helpers for the tlock-backed private voting flow.

## Usage

```ts
import {
  ROUND_STATE,
  deployedContracts,
  getSharedDeploymentAddress,
} from "@rateloop/contracts";
import { packVoteRoundContext } from "@rateloop/contracts/votingCore";

const contentRegistry = getSharedDeploymentAddress(4801, "ContentRegistry");
const roundContext = packVoteRoundContext(1n, 5000);
```

The package ships dual ESM/CJS builds and TypeScript declarations. Published
artifacts are generated from the monorepo build; do not edit `dist` by hand.
