# World ID Testing

RateLoop has two useful World ID test lanes:

- deterministic local coverage, which uses the local `MockWorldIDRouter` and does not contact World ID services
- a manual World Chain Sepolia simulator pass, which uses staging IDKit with Worldcoin's simulator identity picker

Keep the app action aligned across the deploy and frontend/server runtime. The default action is `rateloop-human-credential-v1`.
The default proof mode is `legacy`, which preserves the current World ID 3.0 on-chain path.

## Deterministic Local Lane

This lane proves the wallet-bound on-chain credential flow without relying on World ID infrastructure.

Run the focused checks:

```sh
yarn world-id:test
```

That expands to:

```sh
yarn world-id:test:contracts
yarn world-id:test:next
```

The contract slice runs `RaterRegistryTest` and `DeployRateLoopAllocationsTest`, including:

- storing a World ID human credential for `msg.sender`
- binding the proof signal to the wallet address
- checking the local app/action external-nullifier hash vector
- rejecting reused nullifiers
- rejecting active identity switches
- bubbling invalid proof failures from `MockWorldIDRouter`

The Next.js slice runs the World ID API and client parsing tests under:

- `packages/nextjs/app/api/world-id`
- `packages/nextjs/lib/world-id`

For the browser E2E suite against the deterministic local chain:

```sh
yarn chain
yarn deploy
yarn dev:stack
yarn world-id:e2e:local
```

Notes:

- `yarn deploy` on `localhost` deploys `MockWorldIDRouter` and derives the deployed registry's World ID external nullifier hash from `NEXT_PUBLIC_WORLD_ID_APP_ID` and `NEXT_PUBLIC_WORLD_ID_ACTION`.
- If `NEXT_PUBLIC_WORLD_ID_APP_ID` is unset for local deploys, the deploy script uses `app_staging_rateloop_local`.
- The local E2E suite is deterministic because the World ID proof acceptance path is mocked on-chain.
- The Playwright helper `installLocalE2EWorldIdMock` writes a parser-compatible World ID 3.0 legacy response into localStorage before navigation.
- The component only reads the local mock on localhost when the local E2E wallet session is present.
- The mock result still uses a `signal_hash` derived from the connected wallet address and still submits `RaterRegistry.attestHumanCredentialWithProof`.
- Local deterministic World ID E2E should not require `WORLD_ID_SIGNING_KEY` or the hosted simulator.
- Keep `NEXT_PUBLIC_WORLD_ID_PROOF_MODE=legacy` for this lane until the local `RaterRegistry` deployment exposes a v4 attest method.

Use `app_staging_rateloop_local` and `rateloop-human-credential-v1` unless the local deploy used different values.

## World Chain Sepolia Simulator Lane

Use this lane when you want a real IDKit staging request and simulator approval flow before production.

### 1. Configure World ID staging values

Create or update the Next.js local env:

```sh
cp packages/nextjs/.env.example packages/nextjs/.env.local
```

Set these values from the staging app/action in the World developer portal:

```sh
NEXT_PUBLIC_TARGET_NETWORKS=4801
NEXT_PUBLIC_WORLD_ID_APP_ID=<staging app id>
NEXT_PUBLIC_WORLD_ID_ACTION=rateloop-human-credential-v1
NEXT_PUBLIC_WORLD_ID_ENVIRONMENT=staging
NEXT_PUBLIC_WORLD_ID_PROOF_MODE=legacy
WORLD_ID_RP_ID=<rp id, or the same value as NEXT_PUBLIC_WORLD_ID_APP_ID if that is how the app is configured>
WORLD_ID_SIGNING_KEY=<staging request signing key>
NEXT_PUBLIC_PONDER_URL=<reachable Ponder URL for this deployment>
```

Optional RPC overrides:

```sh
NEXT_PUBLIC_RPC_URL_4801=<browser RPC URL>
WORLDCHAIN_SEPOLIA_RPC_URL=<deploy RPC URL>
```

If you change `NEXT_PUBLIC_WORLD_ID_ACTION`, redeploy contracts with the same value. `RaterRegistry` stores the action-derived external nullifier hash at deployment time.

Proof mode values:

- `legacy`: current production-safe path; requests World ID 3.0 legacy proofs and submits `RaterRegistry.attestHumanCredentialWithProof`.
- `compat`: migration path; accepts typed v3 or v4 IDKit responses. A v3 response still uses the current method, while a v4 response is submitted only if the deployed ABI exposes `attestHumanCredentialWithV4Proof`.
- `v4`: v4-only path; rejects legacy responses and requires a deployment with `attestHumanCredentialWithV4Proof`.

### 2. Deploy contracts to World Chain Sepolia

From the repo root:

```sh
yarn deploy --network worldchainSepolia --keystore <foundry keystore name>
```

The deploy wrapper reads `WORLDCHAIN_SEPOLIA_RPC_URL` from `packages/foundry/.env` when set; otherwise it uses the public `worldchainSepolia` endpoint in `packages/foundry/foundry.toml`.

World Chain verification is manual:

```sh
cd packages/foundry
make verify-blockscout NETWORK=worldchainSepolia CONTRACT_ADDRESS=0x... CONTRACT_NAME=MyContract
```

### 3. Run the app against Sepolia

Start the app with the Sepolia env above:

```sh
yarn start
```

Open the app, connect a wallet on World Chain Sepolia, and go to:

```text
/settings#identity
```

Click `Verify with World ID`. The app will request a short-lived RP context from:

```text
/api/world-id/rp-context
```

The UI should show a QR code or World App handoff while it polls for the simulator result.

### 4. Approve with the simulator

In a separate browser tab, open:

```text
https://simulator.worldcoin.org/select-id
```

Select a simulator identity for the same staging app/action, then approve the pending request. Return to RateLoop and wait for the wallet transaction that calls:

```text
RaterRegistry.attestHumanCredentialWithProof
```

Expected result:

- the transaction confirms on World Chain Sepolia
- the identity settings card shows the wallet as World ID verified
- a repeated attempt with the same simulator identity fails as a reused nullifier

## Troubleshooting

- `World ID is not configured for this deployment.` means `NEXT_PUBLIC_WORLD_ID_APP_ID`, `WORLD_ID_RP_ID`, or `WORLD_ID_SIGNING_KEY` is missing at runtime.
- `invalid_rp_signature` usually means `WORLD_ID_SIGNING_KEY`, `WORLD_ID_RP_ID`, or `NEXT_PUBLIC_WORLD_ID_ENVIRONMENT` does not match the staging app.
- `World ID action does not match this deployment.` means the IDKit result action differs from `NEXT_PUBLIC_WORLD_ID_ACTION`.
- `World ID proof is not bound to the connected wallet.` means the proof signal was generated for a different wallet address than the transaction sender.
- A contract revert from the router on Sepolia usually means the app/action pair, external nullifier hash, signal, or proof environment differs from the deployed `RaterRegistry` configuration.
