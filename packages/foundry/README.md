# RateLoop tokenless-v1 contracts

This package contains the disposable Base Sepolia tokenless protocol:

- `TokenlessPanel`: the only fund-holding core, with no owner, proxy, pause, setter, sweep, or operator payout path.
- `CredentialIssuer`: the separately disclosed admission trust point with bounded signer epochs and no fund access.
- `X402PanelSubmitter`: a stateless EIP-3009 funding adapter with no retained balance or mutable wiring.
- `MockERC20`: unrestricted test currency used only by the isolated test deployment.

The checked-in live artifact is `deployments/tokenless-v1/84532.json`. Its versioned deployment key binds chain, panel, issuer, and optional adapter addresses. It must never be merged with another deployment schema.

## Commands

```bash
yarn test
yarn build
yarn lint
yarn check:sizes
yarn test:tooling
yarn deploy --network baseSepolia --keystore <foundry-account>
```

Deployment requires `BASE_SEPOLIA_RPC_URL`, `TOKENLESS_ROTATION_AUTHORITY`, and `TOKENLESS_INITIAL_SIGNER`. The wrapper verifies RPC chain ID `84532` before broadcasting. After a successful broadcast it exports the isolated deployment JSON and regenerates only the tokenless TypeScript artifacts.

Contracts are disposable until the Phase 5 hardening deployment. No storage-layout, upgrade, address-continuity, or governed migration promise applies to this test stack.
