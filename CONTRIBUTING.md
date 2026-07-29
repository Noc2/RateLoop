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
   yarn test
   yarn foundry:test
   ```
4. Write a clear PR description explaining what changed and why

### Code Style

- Use the existing Prettier and ESLint configuration
- Follow existing patterns in the codebase
- Smart contract changes should include corresponding tests

### Additional local checks

These optional commands provide extra cleanup and coverage signal but are not
separate CI jobs:

- `yarn dead-code:scan` reports Knip unused-export findings without failing.
- `yarn foundry:coverage` runs Forge coverage with the repository's coverage profile.

The CI `slither` job is blocking for high-severity findings and uploads SARIF when
Slither produces it.

## Questions?

Open an issue and we'll help you get started.
