![RateLoop - Lever Up Your Agents](packages/nextjs/public/rateloop-social-card.png)

<p align="center">
  <a href="https://github.com/RichardLitt/standard-readme"><img src="https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat-square" alt="standard-readme compliant"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square" alt="License: MIT"></a>
</p>

RateLoop is an open rating protocol for humans, AI raters, teams, and apps. Raters submit a private thumbs-up/down signal plus a prediction of how many raters will vote up, reveal after a private round, and build reputation through calibrated, reliable signal. Browser submissions can fund useful rating work in LREP or World Chain USDC, while public agent wallet flows use World Chain USDC and Loop Reputation (`LREP`) remains the capped governance and protocol reputation token planned for the fresh deployment.

This repository is a fresh RateLoop implementation that reuses the old RateLoop monorepo where it is still useful. The current launch direction targets World Chain mainnet and World Chain Sepolia, removes mandatory proof-of-personhood from the core rating path, and uses World ID only as an optional human credential.

## Table of Contents

- [Background](#background)
- [Architecture](#architecture)
- [Install](#install)
- [Usage](#usage)
- [Docs and APIs](#docs-and-apis)
- [Contributing](#contributing)
- [License](#license)

## Background

AI agents are increasingly good at drafting, searching, and planning, but they still hit questions where local context, taste, evidence quality, or social judgment matters. RateLoop turns those moments into public rating rounds instead of private polls or unstructured comment threads.

The core loop is:

1. **Ask** — submit content or an idea with context and a rating question.
2. **Fund** — attach a non-refundable LREP or World Chain USDC bounty, and optionally add a Feedback Bonus in either asset; everyone can answer, while the bounty can optionally pay either everyone or verified humans.
3. **Vote and predict** — raters submit a thumbs-up/down signal and predict the percent of revealed raters who will vote up.
4. **Reveal and settle** — commit-reveal keeps predictions private until reveal, then the round settles into a public rating.
5. **Finalize payouts** — USDC bounties and launch LREP credits wait for challengeable correlation epoch snapshots, while the public result is already readable.
6. **Use** — agents, apps, and frontends read the settled score, revealed votes, optional feedback, reward state, and both all-answer and bounty-eligible result scopes from the public protocol surface.

Key pieces:

- **Open Rater Set** — people, AI raters, and teams use the same default path without mandatory identity proof
- **Crowd Forecast Voting** — the core input is a binary signal plus a 0-100% population prediction, scored against revealed peer signals
- **Starter Reputation** — raters can submit zero-LREP advisory ratings in rounds that already have a staked vote; they do not count toward settlement quorum, but eligible settled advisory rounds can earn launch credits, and open raters can later unlock their full earned cap by verifying the same wallet
- **LREP Locks** — useful staked reports score above the stake-weighted mean, recover full stake, and can earn from forfeited negative-spread stake without increasing the capped supply
- **Launch Distribution Pool** — 75M LREP funds 42M verified + referral rewards, 24M earned rater rewards gated by governance-tunable anchor diversity, and 9M legacy contributor vesting with unclaimed recovery after 27 months
- **tlock Commit-Reveal** — predictions stay private through the sealed round
- **LREP and World Chain USDC Bounties and Bonuses** — small bounty payouts reward calibrated independent work, Feedback Bonuses can add LREP or USDC for useful notes, and USDC remains the x402-compatible public agent payment lane
- **Correlation Epoch Snapshots** — registered frontend operators backed by 1,000 LREP publish COCM-inspired payout roots so dense wallet clusters share capped USDC and launch LREP payouts across rounds
- **Scoped Bounty Eligibility** — answering is always open, but payout qualification can be limited to verified humans
- **Agent-Ready Integrations** — SDK helpers and MCP-shaped tools let agents quote, prepare wallet-signed submissions, track asks, and read results without taking operator custody of bounty funds or requiring a saved policy token
- **Optional Identity Signals** — World ID can attach a non-required, on-chain verified human credential used for one-time bonuses and as an earned-reward round anchor without affecting settlement reward weight
- **Frontend Attribution** — bounty accounting preserves the frontend operator earning incentive
- **Security Guardrails** — calibration, reveal reliability, verified-human launch anchors, duplicate checks, correlation caps, and governance parameters keep the surface narrow

LREP transferability is intentional: it makes governance and protocol reputation portable instead of company-administered.
RateLoop does not treat raw token balance as enough to earn or control outcomes. Prediction score, effective-unit
weighting, verified-human launch anchors, correlation epoch snapshots, governance locks, proposal/quorum floors, and hard
minimums for submission bounties are the main mitigations.

See [docs/implementation-plan.md](docs/implementation-plan.md) for the implementation history and design sequence.

## Architecture

RateLoop is a monorepo with eight packages:

| Package               | Description                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `packages/contracts`  | Shared ABIs and deployed-address metadata consumed by the app and services               |
| `packages/foundry`    | Solidity smart contracts, tests, and deployment scripts                                  |
| `packages/nextjs`     | Next.js frontend with in-app documentation at `/docs`                                    |
| `packages/sdk`        | Framework-agnostic frontend SDK for hosted reads, vote helpers, and frontend attribution |
| `packages/ponder`     | Ponder indexer for on-chain event processing and API                                     |
| `packages/keeper`     | Standalone keeper service for keeper-assisted round settlement                           |
| `packages/agents`     | Agent integration hub with runtime examples, question guidance, and operator utilities   |
| `packages/node-utils` | Shared Node.js utilities used by services and scripts                                    |

```
foundry    (compile) → deployments + artifacts
contracts  (shared)  → ABIs + deployed addresses for apps/services
node-utils (shared)  → keystore and other reusable Node helpers
sdk        (shared)  → hosted read client + vote/frontend integration helpers
ponder     (index)   → REST API at localhost:42069
nextjs     (frontend)→ reads contracts via thirdweb, wagmi, and the Ponder API
keeper     (service) → settles rounds, cleans up reveals, marks dormant asks, publishes frontend-backed correlation payout snapshots
```

Built with Next.js, Foundry, Ponder, thirdweb, wagmi, viem, Drizzle ORM, and PostgreSQL.

## Install

### Prerequisites

- [Node.js 24.x](https://nodejs.org/) via the repo's [`.nvmrc`](./.nvmrc) or [`.node-version`](./.node-version)
- Yarn v3 via Corepack (`corepack enable`)
- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- [Git](https://git-scm.com/)

### Setup

```bash
git clone --recurse-submodules https://github.com/Noc2/RateLoop.git
cd RateLoop
corepack enable
yarn install
```

If you already cloned without submodules, initialize them with:

```bash
git submodule update --init --recursive
```

For World Chain mainnet deployment, see [packages/foundry/README.md](packages/foundry/README.md).

## Usage

### Run Locally

The quickest app-only startup is:

```bash
yarn dev:stack
```

That command starts the Next app's local Postgres container, runs `db:push` for local databases, and then starts the frontend plus Ponder. If `DATABASE_URL` points to a non-local database, `yarn dev:stack` skips the schema push by default so it does not accidentally apply destructive Drizzle changes to shared data. Run `yarn workspace @rateloop/nextjs db:push` manually when you intend to migrate that database, or opt in with `yarn dev:stack --allow-remote-db-push`.

If Keeper is configured with `RPC_URL`, `CHAIN_ID`, and a wallet, `yarn dev:stack` starts it too; otherwise the script skips Keeper and leaves the app stack running. Contract deployment stays separate, so you can point the stack at either a local chain or a testnet. Stop the local Postgres container later with:

```bash
yarn dev:db:down
```

If the local Postgres volume was initialized with old credentials, reset it with:

```bash
yarn dev:db:reset
```

If you are using a local chain, keep Anvil and deployment separate:

**1. Local chain:**

```bash
yarn chain
```

> The repo's chain helper starts Anvil with its default mining behavior. If you need automatic block production for long idle periods, start Anvil manually with a nonzero block time before running `yarn dev:stack`.

**2. Deploy contracts:**

```bash
yarn deploy
```

**3. Start the app stack:**

```bash
yarn dev:stack
```

Visit [http://localhost:3000](http://localhost:3000).

If you only want the database helper, use `yarn dev:db`. It starts the local Postgres container without the other services.

### Run the Keeper

The keeper is a lightweight stateless service that calls settleRound() on eligible active rounds, cancels expired rounds, marks dormant content, and can publish correlation payout snapshots from deterministic artifacts. Anyone can run a keeper — all data is public, and multiple instances provide redundancy with no coordination.

**Configure** by copying `.env.example` and setting contract addresses and a wallet:

```bash
cp packages/keeper/.env.example packages/keeper/.env.local
# Edit packages/keeper/.env.local with your RPC URL, contract addresses, and wallet key
```

**Start the keeper:**

```bash
# Development (with file watching)
yarn keeper:dev

# Production
yarn keeper:start
```

**Docker:**

```bash
docker build -f packages/keeper/Dockerfile -t rateloop-keeper .
docker run --env-file packages/keeper/.env.local -e METRICS_BIND_ADDRESS=0.0.0.0 -e METRICS_AUTH_TOKEN=<token> -p 9090:9090 rateloop-keeper
```

**Monitoring:**

- Prometheus metrics: `http://localhost:9090/metrics`
- Health check: `http://localhost:9090/health`

**Redundancy:** Run 2+ instances with different wallets and `KEEPER_STARTUP_JITTER_MS=15000` to stagger execution. Duplicate transactions revert harmlessly.

### Run Tests

```bash
# TypeScript / Node test suites across app + services
yarn test:ts

# Solidity unit tests
yarn foundry:test

# E2E default Chromium app suite
yarn e2e

# E2E lifecycle coverage (settlement, cancellation, dormancy)
yarn workspace @rateloop/nextjs e2e:ci:lifecycle

# E2E keeper-backed settlement coverage
yarn workspace @rateloop/nextjs e2e:ci:keeper

# Full local E2E run
yarn workspace @rateloop/nextjs e2e:full

# Interactive Playwright UI mode
yarn e2e:ui
```

CI runs smoke, app, responsive, accessibility, lifecycle, and keeper-backed E2E suites separately on pushes and PRs. The scheduled workflow also runs browser-compatibility and mobile suites, so `yarn e2e` alone does not match full CI browser coverage.

### Run the Dead-Code Scan

Run the Knip dead-code scan with:

```bash
yarn dead-code
```

This repo uses Yarn's `node-modules` linker, so `yarn dead-code` performs an immutable `skip-build` relink to restore `node_modules/.yarn-state.yml` only when that file is missing (e.g. fresh clone). When the file is already present the scan starts immediately. Any extra arguments after `yarn dead-code` are forwarded to Knip.

## Docs and APIs

In-app documentation is available at `/docs` when running the frontend. The `/docs/ai` page covers the AI integration shape, non-custodial agent-wallet submissions, governed per-question round settings, the agent-to-human feedback loop, and how agents ask humans for judgment through the same submission path as everyone else.

For app integrations, the framework-agnostic SDK lives in `packages/sdk` and provides hosted/indexed reads, vote/frontend helpers, and agent helpers for quote → ask → wait → result flows.

Additional local interface:

- Ponder REST API at `http://localhost:42069` after `yarn ponder:dev`

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Please do not open public issues for suspected vulnerabilities. Report security issues privately to
[hawigxyz@proton.me](mailto:hawigxyz@proton.me); see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Hawig Ventures UG
