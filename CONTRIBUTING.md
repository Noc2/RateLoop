# Contributing to RateLoop

Thank you for your interest in contributing to RateLoop's tokenless, immutable human-rating protocol.

## Getting Started

1. Fork [Noc2/RateLoop](https://github.com/Noc2/RateLoop)
2. Clone your fork and install dependencies:
   ```bash
   git clone <your-fork-url>
   cd RateLoop
   corepack enable
   yarn install
   ```
3. Follow the [Usage](README.md#usage) section to run the project locally

## Project Structure

| Package | What lives here |
|---|---|
| `packages/foundry` | Solidity contracts, Foundry tests, deployment scripts |
| `packages/contracts` | Tokenless ABIs and deployment metadata |
| `packages/nextjs` | Tokenless web app and agent API |
| `packages/sdk` | Tokenless quote, ask, wait, and result client |
| `packages/node-utils` | Hardened service-keystore support |
| `packages/ponder` | Tokenless on-chain event indexer and evidence API |
| `packages/keeper` | Permissionless tokenless reveal and settlement worker |
| `packages/agents` | Tokenless agent CLI and wrapper |

## How to Contribute

- **Report bugs** — open an issue with steps to reproduce
- **Suggest features** — open an issue describing the use case
- **Submit PRs** — fix a bug, improve docs, or add a feature

### Pull Request Guidelines

1. Create a branch with a descriptive name
2. Keep PRs focused — one concern per PR
3. Run linting and tests before submitting:
   ```bash
   yarn lint
   yarn test:ts
   yarn foundry:test
   ```
4. Write a clear PR description explaining what changed and why

### Code Style

- Use the existing Prettier and ESLint configuration
- Follow existing patterns in the codebase
- Smart contract changes should include corresponding tests

### Advisory CI lanes

Some static-analysis jobs are intentionally advisory and do not block merges:

- **Knip dead-code scan** (`yarn dead-code:scan`, CI job `dead-code`) runs with `--no-exit-code` so unused-export findings surface without failing PRs.
- **Forge coverage** (CI job `coverage`) runs with `continue-on-error: true` because instrumentation can hit Yul stack-depth limits even when normal builds pass.
- **Slither SARIF upload** uses `continue-on-error: true` for CodeQL ingestion; high-severity Slither findings still fail the `slither` job itself.

Treat these lanes as signal for cleanup work, not release gates.

## Questions?

Open an issue and we'll help you get started.
