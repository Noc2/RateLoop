# RateLoop

RateLoop is a tokenless, USDC-funded human judgment protocol for people and agents. A funder asks a binary or head-to-head question, eligible raters submit sealed responses, and an immutable panel contract settles an equal base reward plus a bounded prediction-accuracy bonus.

The `tokenless` branch is a greenfield redesign. It does not preserve the former token, governance, registry, oracle, staking, or payout-root system.

## Live test deployment

The isolated test stack runs on Base Sepolia (`84532`). Its deployment identity is:

```text
tokenless-v1:84532:0x0627e4f7f746e84edbd3ec066a58a7fdc3227e16:0xb046277842f11a0c371d860504694fd79a5afb40:0x442581f4732b0f18ed47bcfa46415a65e13f8a5e
```

- `TokenlessPanel`: `0x0627e4f7f746E84EdbD3EC066a58a7FDC3227E16`
- `CredentialIssuer`: `0xB046277842F11a0c371D860504694fD79A5AfB40`
- `X402PanelSubmitter`: `0x442581f4732B0F18eD47bcfA46415A65E13F8a5E`
- unrestricted test `tUSDC`: `0x2FB6B468D9FCF89446cDadAA61e230419f76a838`

Canonical metadata and generated ABIs are in [`packages/foundry/deployments/tokenless-v1/84532.json`](packages/foundry/deployments/tokenless-v1/84532.json) and [`packages/contracts/src/tokenless`](packages/contracts/src/tokenless).

This is a test deployment. Test USDC is freely mintable, admission is issuer-attested, sealing depends on drand/tlock availability, and a normal payout claim publicly links a vote key to its payout destination.

## Architecture

- `packages/foundry` — immutable panel, credential issuer, stateless x402 adapter, tests, and Base Sepolia deployment tooling.
- `packages/contracts` — tokenless-only generated ABIs and live deployment metadata.
- `packages/ponder` — tokenless event indexer and public evidence/status API.
- `packages/keeper` — permissionless reveal, settlement, claim, compensation, and stale-return automation.
- `packages/sdk` — versioned quote → ask → wait → result client and JSON schema.
- `packages/agents` — tokenless agent CLI.
- `packages/nextjs` — funder/rater UX and durable agent API.

The contract core has no owner, pause, sweep, setter, proxy, or operator path to funds. The separate issuer can rotate signers for future vouchers but cannot alter accepted commits or move escrowed funds.

## Development

Requirements: Node.js 24, Yarn 3.2.3, Foundry, and Docker for the hosted-service images.

```bash
yarn install --immutable
yarn foundry:test
yarn contracts:test
yarn sdk:test
yarn ponder:check-types && yarn workspace @rateloop/ponder test
yarn keeper:check-types && yarn workspace @rateloop/keeper test
yarn agents:check-types && yarn workspace @rateloop/agents test
yarn next:check-types && yarn next:test
```

The authoritative design is [`docs/tokenless-immutable-implementation-plan-2026-07.md`](docs/tokenless-immutable-implementation-plan-2026-07.md). The legal/revenue and strategy documents are supporting references.

## License and security

See [`SECURITY.md`](SECURITY.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
