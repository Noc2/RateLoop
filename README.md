# RateLoop

RateLoop is **human assurance for AI-enabled workflows**. On the current hosted path, a workspace policy routes an
agent's output to named reviewers the workspace invited. They judge it without seeing each other's answers, and
RateLoop returns a versioned result carrying the panel signal, the written reasons, and the recorded disagreement. The
customer remains responsible for the final action.

**What is available.** Only the private, invited, unpaid review lane is live. USDC-paid review, the RateLoop reviewer
network, hybrid panels, and every fund-backed mechanism named below are separately gated architecture, not generally
available service — see [`reviewCapabilities.ts`](packages/nextjs/lib/tokenless/reviewCapabilities.ts) and
[`paidLaneActivation.ts`](packages/nextjs/lib/tokenless/paidLaneActivation.ts). The chain deployment is a disposable
Base Sepolia bundle whose currency is an unrestricted mock token; this is not a real-value deployment. Evidence
packets export today, but RateLoop does not claim an externally exercised offline verification capability for them.

## How it works

1. A workspace freezes the review policy: the question, the options, the audience, the panel size, and the rule.
2. Invited reviewers answer independently, without seeing each other's answers.
3. RateLoop records go, revise, or stop with reasons and surfaced disagreement, and returns a versioned result. The
   owner decision is a separate artifact from the review result.

The integration contract is deliberately small: `quote -> ask -> wait -> result`. Remote MCP browser handoffs keep the
outbound payload approval-bound, while scoped workspace API keys support autonomous agent workflows.

The separately gated fund-backed mechanisms — none of them reachable on the hosted deployment — are x402 USDC funding,
proof-of-human admission, commit-reveal voting, drand/tlock reveal timing, Robust Bayesian Truth Serum, Surprisingly
Popular incentives, and permissionless settlement on Base.

## Deployment

The isolated tokenless application is at <https://rateloop-tokenless.vercel.app>. Its supporting Ponder and keeper
services are also isolated from the legacy RateLoop deployment.

The current disposable `tokenless-v4` Base Sepolia test bundle was released at block `45115708`. The app, indexer,
and keeper must all use this exact complete deployment identity:

```text
tokenless-v4:84532:0xedf08f770135db33cec87f00e415c2ae39a3a885:0x7a1b58f9338886169ab3ec53bf042458bc0897c4:0xceddb0b2e34d3d332f347fe76fc5efcb9df5ae03:0xee5785e51d7e8a4438dc029a3c642bac2d558bc4
```

Hosted releases use the same persisted workflow as production. Release checks fail closed until the configured chain,
database, regional resources, signing roles, private storage, and operational evidence all match the approved
deployment manifest. The currency is an unrestricted mock token; this is not a real-value deployment.

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
