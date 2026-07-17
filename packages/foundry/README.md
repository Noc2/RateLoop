# RateLoop tokenless contracts

This package contains the disposable Base Sepolia tokenless protocol:

- `TokenlessPanel`: the only fund-holding core, with no owner, proxy, pause, setter, sweep, or operator payout path.
- `CredentialIssuer`: the separately disclosed admission trust point with bounded signer epochs and no fund access.
- `X402PanelSubmitter`: a stateless EIP-3009 funding adapter with no retained balance or mutable wiring.
- `TokenlessFeedbackBonus`: an optional feedback-bonus pool that escrows a funder's USDC award and returns the unawarded remainder, with no protocol fund authority.
- `MockERC20`: unrestricted test currency used only by the isolated test deployment.

The checked-in `deployments/tokenless-v1`, `deployments/tokenless-v2`, and `deployments/tokenless-v3` artifacts are explicitly historical and must not be used as a live compatibility target. The deployment tooling now writes the `rateloop-tokenless-deployment-v4` schema and `tokenless-v4:*` five-slot identity (panel, credential issuer, x402 adapter, and Feedback Bonus) for the next fresh deployment, exporting `deployments/tokenless-v4/84532.json` without overwriting the historical evidence.

## Commands

From the repository root, inspect a local Foundry account and deploy with an interactive account selection:

```bash
yarn account
yarn foundry:deploy:tokenless --network baseSepolia
```

The equivalent package commands are:

```bash
yarn test
yarn build
yarn lint
yarn check:sizes
yarn test:tooling
yarn account
yarn deploy --network baseSepolia
yarn deploy --network baseSepolia --keystore <foundry-account>
```

`yarn account` and a deploy without `--keystore` present the safe local Foundry accounts from `~/.foundry/keystores`; `scaffold-eth-default` is excluded from live deployment. Account inspection uses the public V3-keystore address when present; keystores that omit that optional field request their password so Foundry can derive the address. Foundry also requests the password when deployment transactions are signed. Use the explicit `--keystore` form for automation. Import an account with `cast wallet import <account-name> --interactive`.

Deployment requires `BASE_SEPOLIA_RPC_URL`, `TOKENLESS_ROTATION_AUTHORITY`, and `TOKENLESS_INITIAL_SIGNER`. The wrapper verifies RPC chain ID `84532` before broadcasting. Before a keystore is opened or any transaction is broadcast, the deploy-profile build must be warning-free and a hard gate checks the exact five deployment runtimes against EIP-170 and their complete initcodes, including constructor arguments, against EIP-3860. The Solidity script repeats those checks before `vm.startBroadcast()`. After a successful broadcast it exports the isolated deployment JSON and regenerates only the tokenless TypeScript artifacts.

Contracts are disposable until the Phase 5 hardening deployment. No storage-layout, upgrade, address-continuity, or governed migration promise applies to this test stack.
