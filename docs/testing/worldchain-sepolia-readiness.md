# World Chain Sepolia Readiness Checks

The local Playwright stack is useful for fast regression coverage, but it cannot catch every deployment-environment mismatch. Run the Sepolia readiness check before or after deploying to confirm the shared artifacts and deployed services still agree.

```bash
yarn worldchain-sepolia:check
```

The offline check validates:

- `packages/foundry/deployments/4801.json` is complete and targets `worldchainSepolia`.
- Every contract Ponder and the app depend on has a World Chain Sepolia address.
- `packages/contracts/src/deployedContracts.ts` matches the Foundry deployment artifact.
- Ponder-indexed contracts have generated `deployedOnBlock` values, so start blocks do not silently fall back to zero or stale env overrides.
- The Next.js USDC default for chain `4801` is configured.

For deployed environments, add live probes:

```bash
WORLDCHAIN_SEPOLIA_RPC_URL=https://... \
WORLDCHAIN_SEPOLIA_PONDER_URL=https://... \
WORLDCHAIN_SEPOLIA_APP_URL=https://... \
yarn worldchain-sepolia:check --live
```

Live mode verifies the RPC reports chain ID `4801`, deployed contracts have bytecode, Ponder `/status` is indexed at or beyond the deployment block, and key app routes return below HTTP 500.
Add `--require-live-targets` in scheduled or release-gate jobs so missing live endpoints fail the check instead of being reported as skipped.

GitHub Actions runs the offline check on pushes and pull requests. The scheduled/manual workflow runs live probes with `--require-live-targets`, so configure these repository settings before enabling the live path:

- Secret: `WORLDCHAIN_SEPOLIA_RPC_URL`
- Variables: `WORLDCHAIN_SEPOLIA_PONDER_URL`, `WORLDCHAIN_SEPOLIA_APP_URL`

This check is intentionally a deploy/readiness gate, not a replacement for local E2E. Use it next to the local Playwright suites when a change touches contract artifacts, Ponder indexing, USDC bounty submission, voting transactions, or deployment configuration.
