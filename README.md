# RateLoop

RateLoop is a tokenless, USDC-funded human judgment protocol for people and agents. A funder asks a binary or head-to-head question, eligible raters submit sealed responses, and an immutable panel contract settles an equal base reward plus a bounded prediction-accuracy bonus.

The `tokenless` branch is a greenfield redesign. It does not preserve the former token, governance, registry, oracle, staking, or payout-root system.

## Deployment status

The production implementation is complete in code. A fresh Base Sepolia deployment is required because the fund-core
contract changed after the previous isolated sandbox deployment. The checked-in `tokenless-v1/84532.json` artifact and
the addresses below are therefore historical test evidence, not the deployment to configure for this revision.

- isolated sandbox app: <https://rateloop-tokenless.vercel.app>
- previous isolated Ponder service: <https://tokenless-ponder-production.up.railway.app>
- previous isolated keeper service: <https://tokenless-keeper-production.up.railway.app/live>

```text
tokenless-v1:84532:0x0627e4f7f746e84edbd3ec066a58a7fdc3227e16:0xb046277842f11a0c371d860504694fd79a5afb40:0x442581f4732b0f18ed47bcfa46415a65e13f8a5e
```

- `TokenlessPanel`: `0x0627e4f7f746E84EdbD3EC066a58a7FDC3227E16`
- `CredentialIssuer`: `0xB046277842F11a0c371D860504694fD79A5AfB40`
- `X402PanelSubmitter`: `0x442581f4732B0F18eD47bcfA46415A65E13F8a5E`
- unrestricted test `tUSDC`: `0x2FB6B468D9FCF89446cDadAA61e230419f76a838`

After redeployment, regenerate [`packages/foundry/deployments/tokenless-v1/84532.json`](packages/foundry/deployments/tokenless-v1/84532.json) and [`packages/contracts/src/tokenless`](packages/contracts/src/tokenless), then update Vercel, Ponder, keeper, and the deployment-scoped database together.

The explicit sandbox remains deterministic and simulated. Production mode implements Base Account funding, prepaid and
x402 execution, paid eligibility and vouchers, sponsored sealed commits, permissionless keeper settlement, indexed
evidence, analytics publication, and signed webhooks. Live E2E verification resumes only after the fresh contract
deployment and complete environment bundle are available.

## Architecture

- `packages/foundry` — immutable panel, credential issuer, stateless x402 adapter, tests, and Base Sepolia deployment tooling.
- `packages/contracts` — tokenless-only generated ABIs and live deployment metadata.
- `packages/ponder` — tokenless event indexer and public evidence/status API.
- `packages/keeper` — permissionless reveal, settlement, claim, compensation, and stale-return automation.
- `packages/sdk` — versioned quote → ask → wait → result client and JSON schema.
- `packages/agents` — tokenless agent CLI.
- `packages/nextjs` — funder/rater UX and durable agent API.

See [`TRUST.md`](TRUST.md) for the exact operator, issuer, USDC, drand, privacy, and deployment trust boundaries.

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
