# RateLoop

RateLoop is **human assurance for AI-enabled workflows**. Agents and teams can send a focused question to a blinded
human panel, pay for accepted work in USDC, and receive a decision packet with independently checkable evidence.

## How it works

1. An agent or buyer freezes the question, audience policy, panel size, and economic terms.
2. Eligible reviewers commit blinded answers and reveal them after the round closes.
3. RateLoop combines the panel signal, written reasons, settlement evidence, and complete fund accounting in a
   versioned result. The customer remains responsible for the final decision.

The integration contract is deliberately small: `quote -> ask -> wait -> result`. Remote MCP browser handoffs keep the
outbound payload approval-bound, while scoped workspace API keys support autonomous agent workflows. The underlying
mechanisms include x402 USDC funding, proof-of-human admission, commit-reveal voting, drand/tlock reveal timing, Robust
Bayesian Truth Serum, Surprisingly Popular incentives, and permissionless settlement on Base.

## Deployment

The isolated tokenless application is at <https://rateloop-tokenless.vercel.app>. Its supporting Ponder and keeper
services are also isolated from the legacy RateLoop deployment.

The checked-in Base Sepolia deployment is `tokenless-v3`, deployed at block `44132668`:

```text
tokenless-v3:84532:0xf97d28e02f7301b4f6cb19160e1176eaf3e4f19a:0x67a89f76ae9a89866a0e62785d7999efe1c5e592:0x8a9b7af03f3cf362ba98180700bc92fbb72fcbc9
```

Hosted releases use the same persisted workflow as production. Release checks fail closed until the configured chain,
database, regional resources, signing roles, private storage, and operational evidence all match the approved
deployment manifest. The current release record is maintained internally in
[`docs/tokenless-production-readiness-2026-07.md`](docs/tokenless-production-readiness-2026-07.md).

## Identity and privacy

Browser accounts use Better Auth and resolve to an opaque RateLoop principal. A wallet is optional and is connected
only for an explicit funding, payout, or recovery action; it never grants workspace access. Server-to-server callers
use scoped, revocable workspace API keys.

Private artifacts are encrypted before storage and released through workspace membership, project assignment, and
short reviewer leases. Workspaces carry data-classification, permitted-use, retention, legal-hold, and regional
policies. Paid settlement evidence remains publicly verifiable, while private project material stays access-controlled.

## Architecture

- `packages/foundry` — immutable fund custody and settlement, credential issuance, and the stateless x402 adapter.
- `packages/contracts` — generated tokenless ABIs and deployment metadata.
- `packages/ponder` — tokenless event indexer and evidence/status API.
- `packages/keeper` — permissionless reveal, settlement, claims, compensation, and stale-return automation.
- `packages/sdk` — the versioned `quote -> ask -> wait -> result` client and schemas.
- `packages/agents` — the tokenless agent CLI and assurance project/run helpers.
- `packages/nextjs` — browser product, authentication, buyer/rater workflows, evidence packets, and agent APIs.

The contract core has no owner, pause, sweep, setter, proxy, or operator path to funds. The separate credential issuer
can rotate admission signers for future work but cannot alter accepted commits or move escrowed funds.

## Development

Requirements: Node.js 24, Yarn 3.2.3, Foundry, and Docker for hosted-service images.

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

The design of record is
[`docs/tokenless-immutable-implementation-plan-2026-07.md`](docs/tokenless-immutable-implementation-plan-2026-07.md).

## License and security

See [`SECURITY.md`](SECURITY.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), and
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
