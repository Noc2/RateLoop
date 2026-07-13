# RateLoop

RateLoop is being redesigned as **human assurance for AI-enabled workflows**: blinded baseline-versus-candidate evaluation by relevant reviewers, a private decision packet, and independently checkable settlement evidence. The current code supplies the case-level USDC-funded settlement primitive; the [human-assurance redesign plan](docs/tokenless-human-assurance-redesign-plan-2026-07.md) defines the product work still required.

## Deployment status

The disposable tokenless contracts deployed to Base Sepolia on 13 July 2026 at block `44083251` are now historical.
The checked-in `tokenless-v1/84532.json` artifact and generated `@rateloop/contracts/tokenless` metadata are stale after
current fund-core changes and must not be used as a live compatibility target. A fresh isolated deployment is required
after the planned contract commits.

- isolated app: <https://rateloop-tokenless.vercel.app>
- isolated Ponder service: <https://tokenless-ponder-production.up.railway.app>
- isolated keeper service: <https://tokenless-keeper-production.up.railway.app/live>

```text
tokenless-v1:84532:0x9f21adbac4c007dd45c55d24e38f0067d1e1c5ba:0x830bee10d5304142cd87acac983af140d946def0:0x226891915c1ccce315ddfe58195fdc0a16bd977d
```

- `TokenlessPanel`: `0x9f21ADBAC4C007dd45c55D24E38F0067D1e1C5ba`
- `CredentialIssuer`: `0x830BEe10D5304142cD87ACAC983Af140D946dEf0`
- `X402PanelSubmitter`: `0x226891915c1CCCe315ddFE58195Fdc0A16bd977D`
- unrestricted test `tUSDC`: `0x1A63AF26F6bD65De51B20DBaeF093C088A52C9df`

After the next redeployment, regenerate [`packages/foundry/deployments/tokenless-v1/84532.json`](packages/foundry/deployments/tokenless-v1/84532.json) and [`packages/contracts/src/tokenless`](packages/contracts/src/tokenless), then update Vercel, Ponder, keeper, and the deployment-scoped database together.

The explicit sandbox remains deterministic and simulated. Production mode implements Base Account funding, prepaid and
x402 execution, paid eligibility and vouchers, sponsored sealed commits, permissionless keeper settlement, indexed
evidence, analytics publication, and signed webhooks. The Vercel deployment remains explicitly sandboxed until the
complete live secret/provider bundle is provisioned; configuring the contract identity alone does not enable paid mode.

## Architecture

- `packages/foundry` — immutable panel, credential issuer, stateless x402 adapter, tests, and Base Sepolia deployment tooling.
- `packages/contracts` — tokenless-only generated ABIs and deployment metadata; the checked-in Base Sepolia metadata is currently stale.
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

The authoritative design is [`docs/tokenless-immutable-implementation-plan-2026-07.md`](docs/tokenless-immutable-implementation-plan-2026-07.md). The detailed redesign sequence is [`docs/tokenless-human-assurance-redesign-plan-2026-07.md`](docs/tokenless-human-assurance-redesign-plan-2026-07.md). The legal/revenue document is a supporting reference.

## License and security

See [`SECURITY.md`](SECURITY.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
