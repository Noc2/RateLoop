# RateLoop tokenless contracts

This package contains the disposable Base Sepolia tokenless protocol:

- `TokenlessPanel`: the only fund-holding core, with no owner, proxy, pause, setter, sweep, or operator payout path.
- `CredentialIssuer`: the separately disclosed admission trust point with bounded signer epochs and no fund access.
- `X402PanelSubmitter`: a stateless EIP-3009 funding adapter with no retained balance or mutable wiring.
- `TokenlessFeedbackBonus`: an optional feedback-bonus pool that escrows a funder's USDC award and returns the unawarded remainder, with no protocol fund authority.
- `MockERC20`: unrestricted test currency used only by the isolated test deployment.

`deployments/tokenless-v4/84532.json` retains the stale disposable Base Sepolia test bundle beginning at block
`44915850` as evidence. A fresh complete Base Sepolia deployment is required before the app, indexer, or keeper may
use a `tokenless-v4:*` identity. Other checked-in deployment artifacts are historical evidence and never live
compatibility targets.

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

Deployment requires `BASE_SEPOLIA_RPC_URL` and nonzero `TOKENLESS_ROTATION_AUTHORITY`, `TOKENLESS_INITIAL_SIGNER`, and `TOKENLESS_FEE_RECIPIENT` addresses. The wrapper validates all three deployment identity addresses before account selection, RPC probing, or any deployment child process so a missing export-only value cannot strand a partial broadcast. This disposable Base Sepolia stack permits a regular nonzero EOA as the rotation authority; keep it separate from the initial admission signer when practical. Compromise can affect future admission until the signer is rotated or the bundle is abandoned, but neither role holds funds or can alter accepted commits. A multisig or equivalent hardened authority remains a real-money release gate, not a prerequisite for this test stack. Before account selection or keystore unlock, the wrapper verifies RPC chain ID `84532`. Before any transaction is broadcast, the deploy-profile build must be warning-free and a hard gate checks the exact six deployment runtimes against EIP-170 and their complete initcodes, including constructor arguments, against EIP-3860. The Solidity script repeats the size checks and pins the deployed beacon-verifier runtime before `vm.stopBroadcast()`. After a successful broadcast, export requires every Forge CREATE input to equal the current deploy-profile creation bytecode plus its encoded constructor arguments, records creation/input/runtime fingerprints for all six contracts, and regenerates only the tokenless TypeScript artifacts. Later generation rejects a fingerprint that no longer matches the compiled source.

Contracts are disposable until the Phase 5 hardening deployment. No storage-layout, upgrade, address-continuity, or governed migration promise applies to this test stack.
